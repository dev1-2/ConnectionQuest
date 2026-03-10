const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
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

const ADMIN_COOKIE_NAME = "cq_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const databaseUrl = process.env.DATABASE_URL;
const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessionSecret = process.env.SESSION_SECRET || "";
const isProduction = process.env.NODE_ENV === "production";

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required to start the server.");
}

const pool = new Pool({
	connectionString: databaseUrl,
	ssl: isProduction ? { rejectUnauthorized: false } : false,
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/", rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 400,
	standardHeaders: true,
	legacyHeaders: false,
}));
app.use(express.static(publicDir, {
	extensions: ["html"],
}));

const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Zu viele Login-Versuche. Bitte später erneut probieren." },
});

app.get("/health", async (_request, response) => {
	try {
		await pool.query("SELECT 1");
		response.json({ ok: true });
	} catch (error) {
		response.status(500).json({ ok: false, error: error.message });
	}
});

app.get("/api/state", async (request, response) => {
	try {
		const state = await loadRuntimeState();
		response.json({
			state: serializeState(state),
			auth: buildAuthState(request),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/admin/login", loginLimiter, async (request, response) => {
	try {
		if (!isAdminConfigured()) {
			response.status(503).json({ error: "Admin-Zugang ist noch nicht konfiguriert." });
			return;
		}

		const password = String(request.body?.password || "");
		if (!passwordsMatch(password, adminPassword)) {
			response.status(401).json({ error: "Admin-Passwort ist falsch." });
			return;
		}

		response.setHeader("Set-Cookie", buildSessionCookie(createSessionToken()));
		const state = await loadRuntimeState();
		response.json({
			message: "Admin-Anmeldung erfolgreich.",
			state: serializeState(state),
			auth: { isAdmin: true, adminConfigured: true },
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/admin/logout", async (request, response) => {
	try {
		response.setHeader("Set-Cookie", clearSessionCookie());
		const state = await loadRuntimeState();
		response.json({
			message: "Admin wurde abgemeldet.",
			state: serializeState(state),
			auth: { isAdmin: false, adminConfigured: isAdminConfigured() },
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.put("/api/teachers", requireAdmin, async (request, response) => {
	try {
		const teachers = normalizeTeacherPayload(request.body?.teachers);
		if (teachers.length < 2) {
			response.status(400).json({ error: "Mindestens zwei Profile werden benötigt." });
			return;
		}

		const state = createStateFromTeachers(teachers);
		await replaceRuntimeState(state);
		response.json({
			message: "Neue Profile übernommen.",
			state: serializeState(state),
			auth: buildAuthState(request),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/reset", requireAdmin, async (request, response) => {
	try {
		const requestedTeachers = Array.isArray(request.body?.teachers) ? request.body.teachers : null;
		const teachers = requestedTeachers ? normalizeTeacherPayload(requestedTeachers) : normalizeTeacherPayload((await loadRuntimeState()).teachers);
		if (teachers.length < 2) {
			response.status(400).json({ error: "Mindestens zwei Profile werden benötigt." });
			return;
		}

		const state = createStateFromTeachers(teachers);
		await replaceRuntimeState(state);
		response.json({
			message: "Turnier wurde zurückgesetzt.",
			state: serializeState(state),
			auth: buildAuthState(request),
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
		await persistBattleState(state, [winner.id, loser.id]);

		response.json({
			message: `${winner.name} gewinnt gegen ${loser.name}.`,
			state: serializeState(state),
			auth: buildAuthState(request),
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
		await replaceRuntimeState(state);
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

	if (teachers.length >= 2 && (!state.currentPair.left || !state.currentPair.right)) {
		setupBattle(state);
		await persistBattleState(state);
	}

	return state;
}

async function replaceRuntimeState(state) {
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

async function persistBattleState(state, teacherIds = null) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const teacherIdSet = Array.isArray(teacherIds) ? new Set(teacherIds) : null;
		const teachersToUpdate = teacherIdSet
			? state.teachers.filter((teacher) => teacherIdSet.has(teacher.id))
			: [];

		for (const teacher of teachersToUpdate) {
			await client.query(
				`UPDATE teachers
				 SET wins = $2,
				     losses = $3,
				     matches = $4
				 WHERE id = $1`,
				[
					teacher.id,
					teacher.wins,
					teacher.losses,
					teacher.matches,
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
			name: String(teacher?.name || "").trim().slice(0, 120),
			subject: String(teacher?.subject || "").trim().slice(0, 160),
			image: sanitizeImageUrl(teacher?.image),
		}))
		.filter((teacher) => teacher.name.length > 0)
		.slice(0, 200)
		.map((teacher, index) => ({
			id: (index + 1).toString(36),
			name: teacher.name || `Profil ${index + 1}`,
			subject: teacher.subject,
			image: teacher.image,
			wins: 0,
			losses: 0,
			matches: 0,
		}));
}

function sanitizeImageUrl(value) {
	const input = String(value || "").trim();
	if (!input) {
		return "";
	}

	try {
		const parsed = new URL(input);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
	} catch {
		return "";
	}
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

function buildAuthState(request) {
	return {
		isAdmin: isAuthenticated(request),
		adminConfigured: isAdminConfigured(),
	};
}

function requireAdmin(request, response, next) {
	if (!isAdminConfigured()) {
		response.status(503).json({ error: "Admin-Zugang ist noch nicht konfiguriert." });
		return;
	}

	if (!isAuthenticated(request)) {
		response.status(401).json({ error: "Admin-Anmeldung erforderlich." });
		return;
	}

	next();
}

function isAdminConfigured() {
	return adminPassword.length > 0 && sessionSecret.length > 0;
}

function isAuthenticated(request) {
	if (!isAdminConfigured()) {
		return false;
	}

	const cookies = parseCookies(request.headers.cookie || "");
	const token = cookies[ADMIN_COOKIE_NAME];
	if (!token) {
		return false;
	}

	const payload = verifySessionToken(token);
	return Boolean(payload && payload.role === "admin" && payload.exp > Date.now());
}

function createSessionToken() {
	const payload = {
		role: "admin",
		exp: Date.now() + SESSION_TTL_MS,
	};
	const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
	return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
	const parts = String(token || "").split(".");
	if (parts.length !== 2) {
		return null;
	}

	const [encoded, signature] = parts;
	const expected = crypto.createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
	if (!safeCompare(signature, expected)) {
		return null;
	}

	try {
		return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

function buildSessionCookie(token) {
	return `${ADMIN_COOKIE_NAME}=${token}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${isProduction ? "; Secure" : ""}`;
}

function clearSessionCookie() {
	return `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${isProduction ? "; Secure" : ""}`;
}

function parseCookies(cookieHeader) {
	return cookieHeader.split(";").reduce((cookies, part) => {
		const [key, ...rest] = part.trim().split("=");
		if (!key) {
			return cookies;
		}
		cookies[key] = rest.join("=");
		return cookies;
	}, {});
}

function passwordsMatch(input, expected) {
	return safeCompare(input, expected);
}

function safeCompare(left, right) {
	const leftBuffer = Buffer.from(String(left));
	const rightBuffer = Buffer.from(String(right));
	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}
	return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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

function sendServerError(response, error) {
	console.error(error);
	response.status(500).json({ error: "Serverfehler beim Verarbeiten der Anfrage." });
}