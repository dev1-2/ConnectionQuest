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
const CQ_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CQ_XP_PER_LEVEL = 180;
const databaseUrl = process.env.DATABASE_URL;
const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessionSecret = process.env.SESSION_SECRET || "";
const isProduction = process.env.NODE_ENV === "production";

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

const CQ_ACHIEVEMENTS = [
	{ id: "first-entry", unlocked: (stats) => stats.totalEntries >= 1 },
	{ id: "network-builder", unlocked: (stats) => stats.uniqueConnections >= 3 },
	{ id: "variety-run", unlocked: (stats) => stats.typeVariety >= 4 },
	{ id: "streak-starter", unlocked: (stats) => stats.currentStreak >= 3 },
	{ id: "score-climber", unlocked: (stats) => stats.score >= 600 },
	{ id: "legend-path", unlocked: (stats) => stats.level >= 5 },
];

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
app.get("/", (_request, response) => {
	response.sendFile(path.join(publicDir, "Welcome.html"));
});
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

app.post("/api/admin/purge", requireAdmin, async (request, response) => {
	try {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("UPDATE app_state SET left_id = NULL, right_id = NULL, queue = '[]'::jsonb, rounds = 0, updated_at = NOW() WHERE state_key = 'main'");
			await client.query("DELETE FROM teachers");
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const state = await loadRuntimeState();
		response.json({
			message: "Datenbank wurde vollständig gelöscht.",
			state: serializeState(state),
			auth: buildAuthState(request),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/vote", async (request, response) => {
	try {
		const { leftId, rightId, side } = request.body || {};
		if (side !== "left" && side !== "right") {
			response.status(400).json({ error: "Ungültige Auswahl." });
			return;
		}
		if (!leftId || !rightId || leftId === rightId) {
			response.status(400).json({ error: "Ungültiges Duell." });
			return;
		}

		const winnerId = side === "left" ? leftId : rightId;
		const loserId = side === "left" ? rightId : leftId;

		const client = await pool.connect();
		let winnerRow, loserRow;
		try {
			await client.query("BEGIN");
			const winnerResult = await client.query(
				"UPDATE teachers SET wins = wins + 1, matches = matches + 1 WHERE id = $1 RETURNING *",
				[winnerId],
			);
			const loserResult = await client.query(
				"UPDATE teachers SET losses = losses + 1, matches = matches + 1 WHERE id = $1 RETURNING *",
				[loserId],
			);
			await client.query(
				"UPDATE app_state SET rounds = rounds + 1, updated_at = NOW() WHERE state_key = 'main'",
			);
			await client.query("COMMIT");
			winnerRow = winnerResult.rows[0];
			loserRow = loserResult.rows[0];
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		if (!winnerRow || !loserRow) {
			response.status(400).json({ error: "Lehrer nicht gefunden." });
			return;
		}

		const state = await loadRuntimeState();
		response.json({
			message: `${winnerRow.name} gewinnt gegen ${loserRow.name}.`,
			state: serializeState(state),
			auth: buildAuthState(request),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/cq/session", async (request, response) => {
	try {
		const session = await loadCqSession(request);
		if (!session) {
			response.json({ currentUser: null });
			return;
		}

		const profile = await loadCqPlayerProfile(session.playerId);
		response.json({ currentUser: profile });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/cq/leaderboard", async (request, response) => {
	try {
		const session = await loadCqSession(request);
		const leaderboard = await loadCqLeaderboard();
		response.json({
			currentUserId: session?.playerId || null,
			leaderboard,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/register", loginLimiter, async (request, response) => {
	try {
		const handle = normalizeCqHandle(request.body?.handle);
		const pin = String(request.body?.pin || "").trim();
		if (!handle || pin.length < 4) {
			response.status(400).json({ error: "Bitte Spielername und PIN mit mindestens 4 Zeichen angeben." });
			return;
		}

		const handleKey = handle.toLowerCase();
		const existing = await pool.query("SELECT id FROM cq_players WHERE handle_key = $1", [handleKey]);
		if (existing.rows[0]) {
			response.status(409).json({ error: "Dieser Spielername existiert bereits." });
			return;
		}

		const client = await pool.connect();
		let sessionToken;
		let playerId;
		try {
			await client.query("BEGIN");
			playerId = crypto.randomUUID();
			await client.query(
				`INSERT INTO cq_players (
					id, handle, handle_key, pin_hash, login_count, last_login_at
				 ) VALUES ($1, $2, $3, $4, 1, NOW())`,
				[playerId, handle, handleKey, hashSecret(pin)],
			);

			sessionToken = createCqSessionToken();
			await client.query(
				`INSERT INTO cq_sessions (token_hash, player_id, expires_at)
				 VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval)`,
				[hashSessionToken(sessionToken), playerId, String(CQ_SESSION_TTL_MS)],
			);
			await refreshCqPlacements(client);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const profile = await loadCqPlayerProfile(playerId);
		response.status(201).json({ sessionToken, currentUser: profile });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/login", loginLimiter, async (request, response) => {
	try {
		const handle = normalizeCqHandle(request.body?.handle);
		const pin = String(request.body?.pin || "").trim();
		if (!handle || pin.length < 4) {
			response.status(400).json({ error: "Bitte Spielername und PIN mit mindestens 4 Zeichen angeben." });
			return;
		}

		const playerResult = await pool.query(
			"SELECT id, pin_hash FROM cq_players WHERE handle_key = $1",
			[handle.toLowerCase()],
		);
		const player = playerResult.rows[0];
		if (!player || !verifySecret(pin, player.pin_hash)) {
			response.status(401).json({ error: "Spielername oder PIN ist falsch." });
			return;
		}

		const client = await pool.connect();
		let sessionToken;
		try {
			await client.query("BEGIN");
			await client.query(
				`UPDATE cq_players
				 SET login_count = login_count + 1,
				     last_login_at = NOW(),
				     updated_at = NOW()
				 WHERE id = $1`,
				[player.id],
			);
			sessionToken = createCqSessionToken();
			await client.query(
				`INSERT INTO cq_sessions (token_hash, player_id, expires_at)
				 VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval)`,
				[hashSessionToken(sessionToken), player.id, String(CQ_SESSION_TTL_MS)],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const profile = await loadCqPlayerProfile(player.id);
		response.json({ sessionToken, currentUser: profile });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/logout", async (request, response) => {
	try {
		const token = getBearerToken(request);
		if (token) {
			await pool.query("DELETE FROM cq_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
		}
		response.json({ ok: true });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/entries", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const payload = normalizeCqEntryPayload(request.body);
		if (!payload) {
			response.status(400).json({ error: "Ungültiger Eintrag." });
			return;
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				`INSERT INTO cq_entries (id, player_id, name, entry_date, type, notes, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
				[crypto.randomUUID(), session.playerId, payload.name, payload.date, payload.type, payload.notes],
			);
			await recalculateCqPlayerStats(client, session.playerId);
			await refreshCqPlacements(client);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const profile = await loadCqPlayerProfile(session.playerId);
		response.status(201).json({ currentUser: profile });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/cq/entries/:entryId", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("DELETE FROM cq_entries WHERE id = $1 AND player_id = $2", [String(request.params.entryId || ""), session.playerId]);
			await recalculateCqPlayerStats(client, session.playerId);
			await refreshCqPlacements(client);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const profile = await loadCqPlayerProfile(session.playerId);
		response.json({ currentUser: profile });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/cq/entries", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("DELETE FROM cq_entries WHERE player_id = $1", [session.playerId]);
			await recalculateCqPlayerStats(client, session.playerId);
			await refreshCqPlacements(client);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const profile = await loadCqPlayerProfile(session.playerId);
		response.json({ currentUser: profile });
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

		CREATE TABLE IF NOT EXISTS cq_players (
			id TEXT PRIMARY KEY,
			handle VARCHAR(32) NOT NULL,
			handle_key VARCHAR(32) NOT NULL UNIQUE,
			pin_hash TEXT NOT NULL,
			login_count INTEGER NOT NULL DEFAULT 0,
			last_login_at TIMESTAMPTZ,
			total_entries INTEGER NOT NULL DEFAULT 0,
			unique_connections INTEGER NOT NULL DEFAULT 0,
			type_variety INTEGER NOT NULL DEFAULT 0,
			current_streak INTEGER NOT NULL DEFAULT 0,
			best_month_count INTEGER NOT NULL DEFAULT 0,
			xp INTEGER NOT NULL DEFAULT 0,
			level INTEGER NOT NULL DEFAULT 1,
			score INTEGER NOT NULL DEFAULT 0,
			unlocked_achievements INTEGER NOT NULL DEFAULT 0,
			placement INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS cq_entries (
			id TEXT PRIMARY KEY,
			player_id TEXT NOT NULL REFERENCES cq_players(id) ON DELETE CASCADE,
			name VARCHAR(40) NOT NULL,
			entry_date DATE NOT NULL,
			type VARCHAR(24) NOT NULL,
			notes VARCHAR(180) NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS cq_sessions (
			token_hash TEXT PRIMARY KEY,
			player_id TEXT NOT NULL REFERENCES cq_players(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL
		);
	`);

	await pool.query("DELETE FROM cq_sessions WHERE expires_at <= NOW()");

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

	const appState = appStateResult.rows[0] || { rounds: 0 };

	return {
		teachers,
		rounds: Number(appState.rounds) || 0,
		currentPair: generateRandomPair(teachers),
	};
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
			     queue = '[]'::jsonb,
			     left_id = NULL,
			     right_id = NULL,
			     updated_at = NOW()
			 WHERE state_key = 'main'`,
			[state.rounds],
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
	return {
		teachers: normalizeTeacherPayload(teachers),
		rounds: 0,
		currentPair: { left: null, right: null },
	};
}

function generateRandomPair(teachers) {
	if (teachers.length < 2) {
		return { left: null, right: null };
	}
	const shuffled = shuffle(teachers);
	return { left: shuffled[0], right: shuffled[1] };
}

function serializeState(state) {
	return {
		teachers: state.teachers,
		rounds: state.rounds,
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

async function requireCqPlayer(request, response) {
	const session = await loadCqSession(request);
	if (!session) {
		response.status(401).json({ error: "Login erforderlich." });
		return null;
	}
	return session;
}

async function loadCqSession(request) {
	const token = getBearerToken(request);
	if (!token) {
		return null;
	}

	const tokenHash = hashSessionToken(token);
	const result = await pool.query(
		`SELECT token_hash, player_id
		 FROM cq_sessions
		 WHERE token_hash = $1 AND expires_at > NOW()`,
		[tokenHash],
	);

	if (!result.rows[0]) {
		return null;
	}

	return {
		tokenHash,
		playerId: result.rows[0].player_id,
	};
}

function getBearerToken(request) {
	const authHeader = String(request.headers.authorization || "");
	if (!authHeader.startsWith("Bearer ")) {
		return "";
	}
	return authHeader.slice(7).trim();
}

function createCqSessionToken() {
	return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
	return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function hashSecret(secret) {
	const salt = crypto.randomBytes(16).toString("hex");
	const derived = crypto.scryptSync(String(secret), salt, 64).toString("hex");
	return `${salt}:${derived}`;
}

function verifySecret(input, storedHash) {
	const [salt, expected] = String(storedHash || "").split(":");
	if (!salt || !expected) {
		return false;
	}
	const derived = crypto.scryptSync(String(input), salt, 64).toString("hex");
	return safeCompare(derived, expected);
}

function normalizeCqHandle(value) {
	return String(value || "")
		.trim()
		.slice(0, 32)
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function normalizeCqEntryPayload(body) {
	const name = String(body?.name || "").trim().slice(0, 40);
	const date = String(body?.date || "").trim();
	const type = String(body?.type || "").trim().slice(0, 24);
	const notes = String(body?.notes || "").trim().slice(0, 180);
	if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !type) {
		return null;
	}
	return { name, date, type, notes };
}

async function loadCqPlayerProfile(playerId) {
	const [playerResult, entriesResult] = await Promise.all([
		pool.query(
			`SELECT id, handle, login_count, last_login_at, total_entries, unique_connections, type_variety,
			        current_streak, best_month_count, xp, level, score, unlocked_achievements, placement,
			        created_at, updated_at
			 FROM cq_players WHERE id = $1`,
			[playerId],
		),
		pool.query(
			`SELECT id, name, entry_date, type, notes, created_at
			 FROM cq_entries
			 WHERE player_id = $1
			 ORDER BY entry_date DESC, created_at DESC`,
			[playerId],
		),
	]);

	if (!playerResult.rows[0]) {
		return null;
	}

	return serializeCqPlayer(playerResult.rows[0], entriesResult.rows);
}

async function loadCqLeaderboard() {
	const result = await pool.query(
		`SELECT id, handle, login_count, last_login_at, total_entries, unique_connections, type_variety,
		        current_streak, best_month_count, xp, level, score, unlocked_achievements, placement,
		        created_at, updated_at
		 FROM cq_players
		 ORDER BY placement ASC, created_at ASC`,
	);
	return result.rows.map((row) => serializeCqPlayer(row));
}

function serializeCqPlayer(row, entries = []) {
	const xp = Number(row.xp) || 0;
	const latestDate = entries[0]
		? (entries[0].entry_date instanceof Date ? entries[0].entry_date.toISOString().slice(0, 10) : String(entries[0].entry_date).slice(0, 10))
		: null;
	return {
		id: row.id,
		handle: row.handle,
		loginCount: Number(row.login_count) || 0,
		lastLoginAt: row.last_login_at,
		placement: Number(row.placement) || 0,
		stats: {
			totalEntries: Number(row.total_entries) || 0,
			uniqueConnections: Number(row.unique_connections) || 0,
			typeVariety: Number(row.type_variety) || 0,
			currentStreak: Number(row.current_streak) || 0,
			bestMonthCount: Number(row.best_month_count) || 0,
			latestDate,
			xp,
			level: Number(row.level) || 1,
			score: Number(row.score) || 0,
			unlockedAchievements: Number(row.unlocked_achievements) || 0,
			xpIntoLevel: xp % CQ_XP_PER_LEVEL,
			xpToNextLevel: CQ_XP_PER_LEVEL,
			progressPercent: Math.round(((xp % CQ_XP_PER_LEVEL) / CQ_XP_PER_LEVEL) * 100),
			levelMessage: buildCqLevelMessage(Number(row.level) || 1, Number(row.total_entries) || 0),
		},
		entries: entries.map((entry) => ({
			id: entry.id,
			name: entry.name,
			date: entry.entry_date instanceof Date ? entry.entry_date.toISOString().slice(0, 10) : String(entry.entry_date).slice(0, 10),
			type: entry.type,
			notes: entry.notes,
			createdAt: new Date(entry.created_at).getTime(),
		})),
	};
}

async function recalculateCqPlayerStats(client, playerId) {
	const entriesResult = await client.query(
		`SELECT name, entry_date, type
		 FROM cq_entries
		 WHERE player_id = $1
		 ORDER BY entry_date DESC, created_at DESC`,
		[playerId],
	);

	const entries = entriesResult.rows.map((row) => ({
		name: row.name,
		date: row.entry_date instanceof Date ? row.entry_date.toISOString().slice(0, 10) : String(row.entry_date).slice(0, 10),
		type: row.type,
	}));
	const stats = buildCqStats(entries);

	await client.query(
		`UPDATE cq_players
		 SET total_entries = $2,
		     unique_connections = $3,
		     type_variety = $4,
		     current_streak = $5,
		     best_month_count = $6,
		     xp = $7,
		     level = $8,
		     score = $9,
		     unlocked_achievements = $10,
		     updated_at = NOW()
		 WHERE id = $1`,
		[
			playerId,
			stats.totalEntries,
			stats.uniqueConnections,
			stats.typeVariety,
			stats.currentStreak,
			stats.bestMonthCount,
			stats.xp,
			stats.level,
			stats.score,
			stats.unlockedAchievements,
		],
	);
}

async function refreshCqPlacements(client) {
	const result = await client.query(
		`SELECT id
		 FROM cq_players
		 ORDER BY score DESC, xp DESC, total_entries DESC, created_at ASC`,
	);

	for (const [index, row] of result.rows.entries()) {
		await client.query("UPDATE cq_players SET placement = $2 WHERE id = $1", [row.id, index + 1]);
	}
}

function buildCqStats(entries) {
	const uniqueConnections = new Set(entries.map((entry) => entry.name.toLowerCase())).size;
	const typeVariety = new Set(entries.map((entry) => entry.type)).size;
	const dailyKeys = Array.from(new Set(entries.map((entry) => entry.date))).sort((left, right) => right.localeCompare(left));
	const currentStreak = calculateCqCurrentStreak(dailyKeys);
	const bestMonthCount = calculateCqBestMonthCount(entries);
	const xp = (entries.length * 35) + (uniqueConnections * 30) + (typeVariety * 20) + (currentStreak * 25) + (bestMonthCount * 10);
	const level = Math.max(1, Math.floor(xp / CQ_XP_PER_LEVEL) + 1);
	const provisionalStats = {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		level,
		score: 0,
	};
	const provisionalAchievements = CQ_ACHIEVEMENTS.filter((achievement) => achievement.unlocked(provisionalStats)).length;
	const score = xp + (entries.length * 12) + (provisionalAchievements * 100);
	const unlockedAchievements = CQ_ACHIEVEMENTS.filter((achievement) => achievement.unlocked({ ...provisionalStats, score })).length;

	return {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		xp,
		level,
		score,
		unlockedAchievements,
	};
}

function calculateCqCurrentStreak(sortedDescDates) {
	if (!sortedDescDates.length) {
		return 0;
	}

	const today = toDateKey(new Date());
	const yesterday = toDateKey(addDays(new Date(), -1));
	if (sortedDescDates[0] !== today && sortedDescDates[0] !== yesterday) {
		return 0;
	}

	let streak = 1;
	for (let index = 1; index < sortedDescDates.length; index += 1) {
		const previous = new Date(sortedDescDates[index - 1]);
		const current = new Date(sortedDescDates[index]);
		const difference = Math.round((previous - current) / 86400000);
		if (difference === 1) {
			streak += 1;
		} else {
			break;
		}
	}
	return streak;
}

function calculateCqBestMonthCount(entries) {
	const counts = new Map();
	entries.forEach((entry) => {
		const monthKey = entry.date.slice(0, 7);
		counts.set(monthKey, (counts.get(monthKey) || 0) + 1);
	});
	return counts.size ? Math.max(...counts.values()) : 0;
}

function buildCqLevelMessage(level, totalEntries) {
	if (totalEntries === 0) {
		return "Starte mit dem ersten Eintrag.";
	}
	if (level < 3) {
		return "Momentum baut sich auf. Jede Interaktion zaehlt in den Score.";
	}
	if (level < 5) {
		return "Stabile Serie. Dein Profil arbeitet sich im Leaderboard nach oben.";
	}
	return "Starke Aktivitaet. Dein Board sieht bereits nach Endgame aus.";
}

function addDays(date, days) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function toDateKey(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
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