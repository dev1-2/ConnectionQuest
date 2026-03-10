const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const DEFAULT_TEACHERS = [
	{ name: "Herr Becker", subject: "Mathematik", image: "" },
	{ name: "Frau Sommer", subject: "Deutsch", image: "" },
	{ name: "Herr Nguyen", subject: "Physik", image: "" },
	{ name: "Frau König", subject: "Englisch", image: "" },
	{ name: "Herr Demir", subject: "Geschichte", image: "" },
	{ name: "Frau Wagner", subject: "Biologie", image: "" },
	{ name: "Herr Hartmann", subject: "Informatik", image: "" },
	{ name: "Frau Aydin", subject: "Kunst", image: "" },
];

const databaseUrl = process.env.DATABASE_URL;
const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required to start the server.");
}

const pool = new Pool({
	connectionString: databaseUrl,
	ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir, {
	extensions: ["html"],
}));

app.get("/health", async (_request, response) => {
	try {
		await pool.query("SELECT 1");
		response.json({ ok: true });
	} catch (error) {
		response.status(500).json({ ok: false, error: error.message });
	}
});

app.get("/api/state", async (_request, response) => {
	try {
		const state = await loadRuntimeState();
		response.json({ state: serializeState(state) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.put("/api/teachers", async (request, response) => {
	try {
		const teachers = normalizeTeacherPayload(request.body?.teachers);
		if (teachers.length < 2) {
			response.status(400).json({ error: "Mindestens zwei Profile werden benötigt." });
			return;
		}

		const state = createStateFromTeachers(teachers);
		await persistRuntimeState(state);
		response.json({
			message: "Neue Profile übernommen.",
			state: serializeState(state),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/reset", async (request, response) => {
	try {
		const requestedTeachers = Array.isArray(request.body?.teachers) ? request.body.teachers : null;
		const teachers = requestedTeachers ? normalizeTeacherPayload(requestedTeachers) : normalizeTeacherPayload((await loadRuntimeState()).teachers);
		if (teachers.length < 2) {
			response.status(400).json({ error: "Mindestens zwei Profile werden benötigt." });
			return;
		}

		const state = createStateFromTeachers(teachers);
		await persistRuntimeState(state);
		response.json({
			message: "Turnier wurde zurückgesetzt.",
			state: serializeState(state),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/vote", async (request, response) => {
	try {
		const side = request.body?.side;
		if (side !== "left" && side !== "right") {
			response.status(400).json({ error: "Ungültige Auswahl." });
			return;
		}

		const state = await loadRuntimeState();
		if (!state.currentPair.left || !state.currentPair.right) {
			response.status(400).json({ error: "Kein aktives Duell vorhanden." });
			return;
		}

		const winner = side === "left" ? state.currentPair.left : state.currentPair.right;
		const loser = side === "left" ? state.currentPair.right : state.currentPair.left;

		winner.wins += 1;
		winner.matches += 1;
		loser.losses += 1;
		loser.matches += 1;
		state.rounds += 1;

		advanceBattle(state, winner.id, loser.id);
		await persistRuntimeState(state);

		response.json({
			message: `${winner.name} gewinnt gegen ${loser.name}.`,
			state: serializeState(state),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("*", (_request, response) => {
	response.sendFile(path.join(publicDir, "index.html"));
});

startServer();

async function startServer() {
	await initializeDatabase();
	app.listen(port, () => {
		console.log(`Server listening on port ${port}`);
	});
}

async function initializeDatabase() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS teachers (
			id TEXT PRIMARY KEY,
			name VARCHAR(120) NOT NULL,
			subject VARCHAR(160) NOT NULL DEFAULT '',
			image TEXT NOT NULL DEFAULT '',
			wins INTEGER NOT NULL DEFAULT 0,
			losses INTEGER NOT NULL DEFAULT 0,
			matches INTEGER NOT NULL DEFAULT 0,
			sort_order INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS app_state (
			state_key TEXT PRIMARY KEY,
			rounds INTEGER NOT NULL DEFAULT 0,
			queue JSONB NOT NULL DEFAULT '[]'::jsonb,
			left_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
			right_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

		await pool.query(
			`INSERT INTO app_state (state_key, rounds, queue, left_id, right_id)
			 VALUES ('main', 0, '[]'::jsonb, NULL, NULL)
			 ON CONFLICT (state_key) DO NOTHING`,
		);

		const teacherCountResult = await pool.query("SELECT COUNT(*)::int AS count FROM teachers");
		if (teacherCountResult.rows[0].count === 0) {
			const state = createStateFromTeachers(DEFAULT_TEACHERS);
			await persistRuntimeState(state);
		}
}

async function loadRuntimeState() {
	const [teachersResult, appStateResult] = await Promise.all([
		pool.query("SELECT * FROM teachers ORDER BY sort_order ASC, name ASC"),
		pool.query("SELECT * FROM app_state WHERE state_key = 'main'"),
	]);

	const teachers = teachersResult.rows.map((row) => ({
		id: row.id,
		name: row.name,
		subject: row.subject,
		image: row.image,
		wins: Number(row.wins),
		losses: Number(row.losses),
		matches: Number(row.matches),
	}));

	const appState = appStateResult.rows[0] || {
		rounds: 0,
		queue: [],
		left_id: null,
		right_id: null,
	};

	const validIds = new Set(teachers.map((teacher) => teacher.id));
	const state = {
		teachers,
		rounds: Number(appState.rounds) || 0,
		queue: Array.isArray(appState.queue) ? appState.queue.filter((id) => validIds.has(id)) : [],
		currentPair: {
			left: teachers.find((teacher) => teacher.id === appState.left_id) || null,
			right: teachers.find((teacher) => teacher.id === appState.right_id) || null,
		},
	};

	if ((teachers.length >= 2) && (!state.currentPair.left || !state.currentPair.right)) {
		setupBattle(state);
		await persistRuntimeState(state);
	}

	return state;
}

async function persistRuntimeState(state) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("UPDATE app_state SET left_id = NULL, right_id = NULL, queue = '[]'::jsonb, updated_at = NOW() WHERE state_key = 'main'");
		await client.query("DELETE FROM teachers");

		for (const [index, teacher] of state.teachers.entries()) {
			await client.query(
				`INSERT INTO teachers (id, name, subject, image, wins, losses, matches, sort_order)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				[
					teacher.id,
					teacher.name,
					teacher.subject,
					teacher.image,
					teacher.wins,
					teacher.losses,
					teacher.matches,
					index,
				],
			);
		}

		await client.query(
			`UPDATE app_state
			 SET rounds = $1,
			     queue = $2::jsonb,
			     left_id = $3,
			     right_id = $4,
			     updated_at = NOW()
			 WHERE state_key = 'main'`,
			[
				state.rounds,
				JSON.stringify(state.queue),
				state.currentPair.left?.id || null,
				state.currentPair.right?.id || null,
			],
		);

		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

function normalizeTeacherPayload(teachers) {
	if (!Array.isArray(teachers)) {
		return [];
	}

	return teachers
		.map((teacher) => ({
			name: String(teacher?.name || "").trim(),
			subject: String(teacher?.subject || "").trim(),
			image: String(teacher?.image || "").trim(),
		}))
		.filter((teacher) => teacher.name.length > 0)
		.map((teacher, index) => ({
			id: `teacher-${index + 1}-${slugify(teacher.name || `profil-${index + 1}`)}`,
			name: teacher.name || `Profil ${index + 1}`,
			subject: teacher.subject,
			image: teacher.image,
			wins: 0,
			losses: 0,
			matches: 0,
		}));
}

function createStateFromTeachers(teachers) {
	const state = {
		teachers: normalizeTeacherPayload(teachers),
		rounds: 0,
		queue: [],
		currentPair: { left: null, right: null },
	};
	setupBattle(state);
	return state;
}

function setupBattle(state) {
	if (state.teachers.length < 2) {
		state.currentPair = { left: null, right: null };
		state.queue = [];
		return;
	}

	state.queue = shuffle(state.teachers.map((teacher) => teacher.id));
	const leftId = state.queue.shift();
	const rightId = state.queue.shift();
	state.currentPair.left = findTeacher(state, leftId);
	state.currentPair.right = findTeacher(state, rightId);
	state.queue = state.queue.filter((id) => id !== leftId && id !== rightId);
	if (!state.currentPair.left || !state.currentPair.right) {
		state.currentPair.left = state.teachers[0] || null;
		state.currentPair.right = state.teachers[1] || null;
	}
}

function advanceBattle(state, winnerId, loserId) {
	const winner = findTeacher(state, winnerId);
	const loser = findTeacher(state, loserId);

	state.currentPair.left = winner;

	if (loser && loser.id !== winner.id) {
		state.queue.push(loser.id);
	}

	let nextChallenger = null;
	while (state.queue.length > 0 && !nextChallenger) {
		const candidateId = state.queue.shift();
		if (candidateId !== winner.id) {
			nextChallenger = findTeacher(state, candidateId);
		}
	}

	if (!nextChallenger) {
		nextChallenger = state.teachers.find((teacher) => teacher.id !== winner.id) || null;
	}

	state.currentPair.right = nextChallenger;
	state.queue = state.queue.filter((id) => id !== winner.id && id !== state.currentPair.right?.id);
	if (!state.queue.length) {
		state.queue = shuffle(
			state.teachers
				.map((teacher) => teacher.id)
				.filter((id) => id !== winner.id && id !== state.currentPair.right?.id),
		);
	}
}

function serializeState(state) {
	return {
		teachers: state.teachers,
		rounds: state.rounds,
		queue: state.queue,
		currentPair: state.currentPair,
	};
}

function findTeacher(state, id) {
	return state.teachers.find((teacher) => teacher.id === id) || null;
}

function shuffle(items) {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
	}
	return result;
}

function slugify(value) {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") || "profil";
}

function sendServerError(response, error) {
	console.error(error);
	response.status(500).json({ error: "Serverfehler beim Verarbeiten der Anfrage." });
}