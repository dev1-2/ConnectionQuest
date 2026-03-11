const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const helmet = require("helmet");
const path = require("path");
const { Pool } = require("pg");

loadEnvironmentFile(path.join(__dirname, ".env"));

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

const CQ_SINGLE_GAMES = {
	"signal-sprint": { maxRawScore: 60, scoreMultiplier: 14, xpMultiplier: 5 },
	"pattern-pulse": { maxRawScore: 12, scoreMultiplier: 90, xpMultiplier: 30 },
};

const CQ_DUEL_GAMES = {
	"reaction-duel": {
		winnerScore: 260,
		winnerXp: 110,
		loserScore: 90,
		loserXp: 30,
	},
};

const CQ_DAILY_MISSIONS = [
	{
		id: "daily-log",
		title: "Daily Log",
		description: "Lege heute mindestens einen neuen Moment an.",
		target: 1,
		rewardLabel: "+90 XP Momentum",
		metric: (engagement) => engagement.entriesToday,
	},
	{
		id: "fresh-faces",
		title: "Fresh Faces",
		description: "Logge heute 2 verschiedene Connections.",
		target: 2,
		rewardLabel: "+120 Score Push",
		metric: (engagement) => engagement.uniqueConnectionsToday,
	},
	{
		id: "arcade-return",
		title: "Arcade Return",
		description: "Spiele heute mindestens eine Game-Session.",
		target: 1,
		rewardLabel: "+1 Return Check",
		metric: (engagement) => engagement.gamesToday,
	},
	{
		id: "triple-pressure",
		title: "Triple Pressure",
		description: "Erreiche heute insgesamt 3 Aktionen aus Logs und Games.",
		target: 3,
		rewardLabel: "+180 XP Burst",
		metric: (engagement) => engagement.entriesToday + engagement.gamesToday,
	},
];

const CQ_WEEKLY_CHALLENGES = [
	{
		id: "weekly-logs",
		title: "Weekly Journal Push",
		description: "Erreiche 5 neue Logs innerhalb von 7 Tagen.",
		target: 5,
		rewardLabel: "+420 XP Weekly",
		metric: (engagement) => engagement.entries7d,
	},
	{
		id: "weekly-network",
		title: "Network Expansion",
		description: "Logge 4 verschiedene Connections in den letzten 7 Tagen.",
		target: 4,
		rewardLabel: "+350 Score Spread",
		metric: (engagement) => engagement.uniqueConnections7d,
	},
	{
		id: "weekly-arcade",
		title: "Arcade Habit",
		description: "Spiele 4 Game-Sessions in den letzten 7 Tagen.",
		target: 4,
		rewardLabel: "+2 Prestige Pings",
		metric: (engagement) => engagement.games7d,
	},
	{
		id: "weekly-rivalry",
		title: "Rivalry Loop",
		description: "Spiele 2 Duels in den letzten 7 Tagen.",
		target: 2,
		rewardLabel: "+1 Duel Badge Pulse",
		metric: (engagement) => engagement.duels7d,
	},
];

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required to start the server.");
}

const pool = new Pool({
	connectionString: databaseUrl,
	ssl: resolveDatabaseSsl(databaseUrl),
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.get("/", (_request, response) => {
	response.sendFile(path.join(publicDir, "index.html"));
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

app.get("/api/cq/pulse", async (request, response) => {
	try {
		const session = await loadCqSession(request);
		const [communityStats, highlights, activityFeed, currentUser, engagement] = await Promise.all([
			loadCqCommunityStats(),
			loadCqHighlights(),
			loadCqActivityFeed(),
			session ? loadCqPlayerProfile(session.playerId) : Promise.resolve(null),
			session ? loadCqPlayerEngagement(session.playerId) : Promise.resolve(null),
		]);

		response.json({
			currentUserId: session?.playerId || null,
			communityStats,
			highlights,
			activityFeed,
			missions: currentUser && engagement ? buildCqDailyMissions(engagement) : [],
			weeklyChallenges: currentUser && engagement ? buildCqWeeklyChallenges(engagement) : [],
			recommendations: currentUser && engagement ? buildCqRecommendations(currentUser, engagement) : buildAnonymousRecommendations(),
			returnBonus: currentUser && engagement ? buildCqReturnBonus(currentUser, engagement) : buildAnonymousReturnBonus(),
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

app.post("/api/cq/games/single", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const payload = normalizeSingleGamePayload(request.body);
		if (!payload) {
			response.status(400).json({ error: "Ungültiges Single-Player-Ergebnis." });
			return;
		}

		const rewards = buildSingleGameRewards(payload.gameType, payload.rawScore);
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				`INSERT INTO cq_game_results (
					id, game_type, mode, primary_player_id, primary_points, primary_xp, payload, created_at
				 ) VALUES ($1, $2, 'single', $3, $4, $5, $6::jsonb, NOW())`,
				[
					crypto.randomUUID(),
					payload.gameType,
					session.playerId,
					rewards.score,
					rewards.xp,
					JSON.stringify({ rawScore: payload.rawScore, summary: payload.summary }),
				],
			);
			await client.query(
				`UPDATE cq_players
				 SET game_sessions = game_sessions + 1,
				     game_score = game_score + $2,
				     game_xp = game_xp + $3,
				     updated_at = NOW()
				 WHERE id = $1`,
				[session.playerId, rewards.score, rewards.xp],
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
		response.status(201).json({ currentUser: profile, rewards });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/games/duel", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const payload = normalizeDuelGamePayload(request.body);
		if (!payload) {
			response.status(400).json({ error: "Ungültiges Duel-Ergebnis." });
			return;
		}

		if (payload.opponentPlayerId === session.playerId) {
			response.status(400).json({ error: "Du kannst nicht gegen dich selbst spielen." });
			return;
		}

		if (payload.winnerPlayerId !== session.playerId && payload.winnerPlayerId !== payload.opponentPlayerId) {
			response.status(400).json({ error: "Der Sieger muss einer der beiden Spieler sein." });
			return;
		}

		const opponentResult = await pool.query("SELECT id FROM cq_players WHERE id = $1", [payload.opponentPlayerId]);
		if (!opponentResult.rows[0]) {
			response.status(404).json({ error: "Gegner nicht gefunden." });
			return;
		}

		const rewards = CQ_DUEL_GAMES[payload.gameType];
		const winnerId = payload.winnerPlayerId;
		const loserId = winnerId === session.playerId ? payload.opponentPlayerId : session.playerId;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				`INSERT INTO cq_game_results (
					id, game_type, mode, primary_player_id, opponent_player_id, winner_player_id,
					primary_points, opponent_points, primary_xp, opponent_xp, payload, created_at
				 ) VALUES ($1, $2, 'duel', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())`,
				[
					crypto.randomUUID(),
					payload.gameType,
					session.playerId,
					payload.opponentPlayerId,
					winnerId,
					winnerId === session.playerId ? rewards.winnerScore : rewards.loserScore,
					winnerId === payload.opponentPlayerId ? rewards.winnerScore : rewards.loserScore,
					winnerId === session.playerId ? rewards.winnerXp : rewards.loserXp,
					winnerId === payload.opponentPlayerId ? rewards.winnerXp : rewards.loserXp,
					JSON.stringify({ summary: payload.summary || "" }),
				],
			);
			await applyDuelGameRewards(client, winnerId, rewards.winnerScore, rewards.winnerXp, true);
			await applyDuelGameRewards(client, loserId, rewards.loserScore, rewards.loserXp, false);
			await recalculateCqPlayerStats(client, session.playerId);
			await recalculateCqPlayerStats(client, payload.opponentPlayerId);
			await refreshCqPlacements(client);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const profile = await loadCqPlayerProfile(session.playerId);
		response.status(201).json({ currentUser: profile, winnerPlayerId: winnerId });
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
			game_sessions INTEGER NOT NULL DEFAULT 0,
			game_wins INTEGER NOT NULL DEFAULT 0,
			game_score INTEGER NOT NULL DEFAULT 0,
			game_xp INTEGER NOT NULL DEFAULT 0,
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

		CREATE TABLE IF NOT EXISTS cq_game_results (
			id TEXT PRIMARY KEY,
			game_type VARCHAR(32) NOT NULL,
			mode VARCHAR(16) NOT NULL,
			primary_player_id TEXT NOT NULL REFERENCES cq_players(id) ON DELETE CASCADE,
			opponent_player_id TEXT REFERENCES cq_players(id) ON DELETE SET NULL,
			winner_player_id TEXT REFERENCES cq_players(id) ON DELETE SET NULL,
			primary_points INTEGER NOT NULL DEFAULT 0,
			opponent_points INTEGER NOT NULL DEFAULT 0,
			primary_xp INTEGER NOT NULL DEFAULT 0,
			opponent_xp INTEGER NOT NULL DEFAULT 0,
			payload JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`);

	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_sessions INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_wins INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_score INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_xp INTEGER NOT NULL DEFAULT 0");

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

function normalizeSingleGamePayload(body) {
	const gameType = String(body?.gameType || "").trim();
	const rawScore = Number(body?.rawScore);
	const summary = String(body?.summary || "").trim().slice(0, 180);
	if (!CQ_SINGLE_GAMES[gameType] || !Number.isFinite(rawScore) || rawScore < 0) {
		return null;
	}
	return {
		gameType,
		rawScore: Math.round(rawScore),
		summary,
	};
}

function normalizeDuelGamePayload(body) {
	const gameType = String(body?.gameType || "").trim();
	const opponentPlayerId = String(body?.opponentPlayerId || "").trim();
	const winnerPlayerId = String(body?.winnerPlayerId || "").trim();
	const summary = String(body?.summary || "").trim().slice(0, 180);
	if (!CQ_DUEL_GAMES[gameType] || !opponentPlayerId || !winnerPlayerId) {
		return null;
	}
	return { gameType, opponentPlayerId, winnerPlayerId, summary };
}

function buildSingleGameRewards(gameType, rawScore) {
	const config = CQ_SINGLE_GAMES[gameType];
	const normalizedRawScore = Math.max(0, Math.min(config.maxRawScore, Math.round(rawScore)));
	return {
		rawScore: normalizedRawScore,
		score: normalizedRawScore * config.scoreMultiplier,
		xp: normalizedRawScore * config.xpMultiplier,
	};
}

async function loadCqPlayerProfile(playerId) {
	const [playerResult, entriesResult] = await Promise.all([
		pool.query(
			`SELECT id, handle, login_count, last_login_at, total_entries, unique_connections, type_variety,
			        current_streak, best_month_count, game_sessions, game_wins, game_score, game_xp,
			        xp, level, score, unlocked_achievements, placement,
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
		        current_streak, best_month_count, game_sessions, game_wins, game_score, game_xp,
		        xp, level, score, unlocked_achievements, placement,
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
			gameSessions: Number(row.game_sessions) || 0,
			gameWins: Number(row.game_wins) || 0,
			gameScore: Number(row.game_score) || 0,
			gameXp: Number(row.game_xp) || 0,
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

async function loadCqPlayerEngagement(playerId) {
	const [playerResult, entryResult, gameResult] = await Promise.all([
		pool.query(
			`SELECT last_login_at
			 FROM cq_players
			 WHERE id = $1`,
			[playerId],
		),
		pool.query(
			`SELECT
				COUNT(*) FILTER (WHERE entry_date = CURRENT_DATE)::int AS entries_today,
				COUNT(*) FILTER (WHERE entry_date >= CURRENT_DATE - INTERVAL '6 days')::int AS entries_7d,
				COUNT(DISTINCT CASE WHEN entry_date = CURRENT_DATE THEN LOWER(name) END)::int AS unique_connections_today,
				COUNT(DISTINCT CASE WHEN entry_date >= CURRENT_DATE - INTERVAL '6 days' THEN LOWER(name) END)::int AS unique_connections_7d,
				COUNT(DISTINCT CASE WHEN entry_date = CURRENT_DATE THEN type END)::int AS type_variety_today,
				MAX(created_at) AS last_entry_at
			 FROM cq_entries
			 WHERE player_id = $1`,
			[playerId],
		),
		pool.query(
			`SELECT
				COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS games_today,
				COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS games_7d,
				COUNT(*) FILTER (
					WHERE mode = 'duel'
					  AND created_at >= NOW() - INTERVAL '7 days'
					  AND (primary_player_id = $1 OR opponent_player_id = $1)
				)::int AS duels_7d,
				MAX(created_at) AS last_game_at
			 FROM cq_game_results
			 WHERE primary_player_id = $1 OR opponent_player_id = $1`,
			[playerId],
		),
	]);

	const player = playerResult.rows[0] || {};
	const entry = entryResult.rows[0] || {};
	const game = gameResult.rows[0] || {};
	const lastActivityAt = [player.last_login_at, entry.last_entry_at, game.last_game_at]
		.filter(Boolean)
		.map((value) => new Date(value))
		.sort((left, right) => right.getTime() - left.getTime())[0] || null;

	return {
		entriesToday: Number(entry.entries_today) || 0,
		entries7d: Number(entry.entries_7d) || 0,
		uniqueConnectionsToday: Number(entry.unique_connections_today) || 0,
		uniqueConnections7d: Number(entry.unique_connections_7d) || 0,
		typeVarietyToday: Number(entry.type_variety_today) || 0,
		gamesToday: Number(game.games_today) || 0,
		games7d: Number(game.games_7d) || 0,
		duels7d: Number(game.duels_7d) || 0,
		lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
	};
}

async function loadCqCommunityStats() {
	const [playersResult, entriesResult, gamesResult, activePlayersResult] = await Promise.all([
		pool.query("SELECT COUNT(*)::int AS player_count FROM cq_players"),
		pool.query(
			`SELECT
				COUNT(*) FILTER (WHERE entry_date = CURRENT_DATE)::int AS entries_today,
				COUNT(*) FILTER (WHERE entry_date >= CURRENT_DATE - INTERVAL '6 days')::int AS entries_7d
			 FROM cq_entries`,
		),
		pool.query(
			`SELECT
				COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS games_today,
				COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS games_7d
			 FROM cq_game_results`,
		),
		pool.query(
			`SELECT COUNT(DISTINCT player_id)::int AS active_players_7d
			 FROM (
				SELECT player_id
				FROM cq_entries
				WHERE entry_date >= CURRENT_DATE - INTERVAL '6 days'
				UNION
				SELECT primary_player_id AS player_id
				FROM cq_game_results
				WHERE created_at >= NOW() - INTERVAL '7 days'
				UNION
				SELECT opponent_player_id AS player_id
				FROM cq_game_results
				WHERE opponent_player_id IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days'
			 ) AS recent_players`,
		),
	]);

	return {
		playerCount: Number(playersResult.rows[0]?.player_count) || 0,
		entriesToday: Number(entriesResult.rows[0]?.entries_today) || 0,
		entries7d: Number(entriesResult.rows[0]?.entries_7d) || 0,
		gamesToday: Number(gamesResult.rows[0]?.games_today) || 0,
		games7d: Number(gamesResult.rows[0]?.games_7d) || 0,
		activePlayers7d: Number(activePlayersResult.rows[0]?.active_players_7d) || 0,
	};
}

async function loadCqHighlights() {
	const result = await pool.query(
		`SELECT handle, score, current_streak, game_wins, total_entries, placement
		 FROM cq_players
		 ORDER BY placement ASC, created_at ASC`,
	);

	const players = result.rows;
	const scoreLeader = players[0] || null;
	const streakLeader = players.reduce((best, row) => (
		!best || Number(row.current_streak) > Number(best.current_streak) ? row : best
	), null);
	const gameLeader = players.reduce((best, row) => (
		!best || Number(row.game_wins) > Number(best.game_wins) ? row : best
	), null);

	return {
		scoreLeader: scoreLeader ? {
			handle: scoreLeader.handle,
			value: Number(scoreLeader.score) || 0,
			label: `#${Number(scoreLeader.placement) || 1} im Gesamtranking`,
		} : null,
		streakLeader: streakLeader ? {
			handle: streakLeader.handle,
			value: Number(streakLeader.current_streak) || 0,
			label: "Tage aktuelle Streak",
		} : null,
		gameLeader: gameLeader ? {
			handle: gameLeader.handle,
			value: Number(gameLeader.game_wins) || 0,
			label: "Game Wins gesamt",
		} : null,
	};
}

async function loadCqActivityFeed() {
	const result = await pool.query(
		`SELECT *
		 FROM (
			SELECT
				e.id,
				e.created_at AS occurred_at,
				'entry' AS event_type,
				p.handle AS actor_handle,
				e.type AS entry_type,
				e.name AS target_name,
				NULL::TEXT AS opponent_handle,
				NULL::TEXT AS winner_handle,
				e.notes AS summary
			FROM cq_entries e
			JOIN cq_players p ON p.id = e.player_id

			UNION ALL

			SELECT
				g.id,
				g.created_at AS occurred_at,
				'game' AS event_type,
				p.handle AS actor_handle,
				g.game_type AS entry_type,
				NULL::TEXT AS target_name,
				opponent.handle AS opponent_handle,
				winner.handle AS winner_handle,
				COALESCE(g.payload->>'summary', '') AS summary
			FROM cq_game_results g
			JOIN cq_players p ON p.id = g.primary_player_id
			LEFT JOIN cq_players opponent ON opponent.id = g.opponent_player_id
			LEFT JOIN cq_players winner ON winner.id = g.winner_player_id
		 ) AS feed
		 ORDER BY occurred_at DESC
		 LIMIT 12`,
	);

	return result.rows.map((row) => ({
		id: row.id,
		type: row.event_type,
		actorHandle: row.actor_handle,
		occurredAt: row.occurred_at,
		title: row.event_type === "entry"
			? `${row.actor_handle} hat ${row.entry_type} mit ${row.target_name} geloggt`
			: buildCqGameFeedTitle(row),
		detail: buildCqFeedDetail(row),
	}));
}

async function recalculateCqPlayerStats(client, playerId) {
	const playerResult = await client.query(
		"SELECT game_sessions, game_wins, game_score, game_xp FROM cq_players WHERE id = $1",
		[playerId],
	);
	const gameStats = playerResult.rows[0] || { game_sessions: 0, game_wins: 0, game_score: 0, game_xp: 0 };

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
	const stats = buildCqStats(entries, {
		gameSessions: Number(gameStats.game_sessions) || 0,
		gameWins: Number(gameStats.game_wins) || 0,
		gameScore: Number(gameStats.game_score) || 0,
		gameXp: Number(gameStats.game_xp) || 0,
	});

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
		 ORDER BY score DESC, xp DESC, game_wins DESC, total_entries DESC, created_at ASC`,
	);

	for (const [index, row] of result.rows.entries()) {
		await client.query("UPDATE cq_players SET placement = $2 WHERE id = $1", [row.id, index + 1]);
	}
}

async function applyDuelGameRewards(client, playerId, scoreGain, xpGain, isWinner) {
	await client.query(
		`UPDATE cq_players
		 SET game_sessions = game_sessions + 1,
		     game_wins = game_wins + $2,
		     game_score = game_score + $3,
		     game_xp = game_xp + $4,
		     updated_at = NOW()
		 WHERE id = $1`,
		[playerId, isWinner ? 1 : 0, scoreGain, xpGain],
	);
}

function buildCqStats(entries, bonusStats = {}) {
	const uniqueConnections = new Set(entries.map((entry) => entry.name.toLowerCase())).size;
	const typeVariety = new Set(entries.map((entry) => entry.type)).size;
	const dailyKeys = Array.from(new Set(entries.map((entry) => entry.date))).sort((left, right) => right.localeCompare(left));
	const currentStreak = calculateCqCurrentStreak(dailyKeys);
	const bestMonthCount = calculateCqBestMonthCount(entries);
	const journalXp = (entries.length * 35) + (uniqueConnections * 30) + (typeVariety * 20) + (currentStreak * 25) + (bestMonthCount * 10);
	const journalScoreBase = (entries.length * 12);
	const gameXp = Number(bonusStats.gameXp) || 0;
	const gameScore = Number(bonusStats.gameScore) || 0;
	const xp = journalXp + gameXp;
	const level = Math.max(1, Math.floor(xp / CQ_XP_PER_LEVEL) + 1);
	const provisionalStats = {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		gameSessions: Number(bonusStats.gameSessions) || 0,
		gameWins: Number(bonusStats.gameWins) || 0,
		gameScore,
		gameXp,
		level,
		score: 0,
	};
	const provisionalAchievements = CQ_ACHIEVEMENTS.filter((achievement) => achievement.unlocked(provisionalStats)).length;
	const score = xp + journalScoreBase + gameScore + (provisionalAchievements * 100);
	const unlockedAchievements = CQ_ACHIEVEMENTS.filter((achievement) => achievement.unlocked({ ...provisionalStats, score })).length;

	return {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		gameSessions: Number(bonusStats.gameSessions) || 0,
		gameWins: Number(bonusStats.gameWins) || 0,
		gameScore,
		gameXp,
		xp,
		level,
		score,
		unlockedAchievements,
	};
}

function buildCqDailyMissions(engagement) {
	return CQ_DAILY_MISSIONS.map((mission) => {
		const current = Math.max(0, Number(mission.metric(engagement)) || 0);
		const target = Math.max(1, mission.target);
		return {
			id: mission.id,
			title: mission.title,
			description: mission.description,
			rewardLabel: mission.rewardLabel,
			current,
			target,
			completed: current >= target,
			progressPercent: Math.min(100, Math.round((Math.min(current, target) / target) * 100)),
		};
	});
}

function buildCqWeeklyChallenges(engagement) {
	return CQ_WEEKLY_CHALLENGES.map((mission) => {
		const current = Math.max(0, Number(mission.metric(engagement)) || 0);
		const target = Math.max(1, mission.target);
		return {
			id: mission.id,
			title: mission.title,
			description: mission.description,
			rewardLabel: mission.rewardLabel,
			current,
			target,
			completed: current >= target,
			progressPercent: Math.min(100, Math.round((Math.min(current, target) / target) * 100)),
		};
	});
}

function buildCqRecommendations(currentUser, engagement) {
	const cards = [];
	if ((engagement.entriesToday || 0) === 0) {
		cards.push({
			id: "rec-log",
			title: "Heute fehlt noch ein Log",
			copy: "Ein einziger neuer Eintrag aktiviert sofort Daily-Progress, Streak-Druck und mehr Sichtbarkeit im Feed.",
			tag: "Journal",
		});
	}
	if ((engagement.gamesToday || 0) === 0) {
		cards.push({
			id: "rec-game",
			title: "Arcade-Loop heute noch offen",
			copy: "Ein kurzer Sprint oder ein Duel bringt sofort Game-Score, Feed-Aktivitaet und Weekly-Fortschritt.",
			tag: "Arcade",
		});
	}
	if ((engagement.uniqueConnections7d || 0) < 4) {
		cards.push({
			id: "rec-network",
			title: "Mehr Variety hebt dein Profil",
			copy: `Nur noch ${Math.max(0, 4 - (engagement.uniqueConnections7d || 0))} neue Connection${Math.max(0, 4 - (engagement.uniqueConnections7d || 0)) === 1 ? "" : "s"} bis zur Weekly Network Expansion.`,
			tag: "Growth",
		});
	}
	if ((currentUser?.stats?.currentStreak || 0) >= 3) {
		cards.push({
			id: "rec-streak",
			title: "Deine Streak ist jetzt sichtbar wertvoll",
			copy: `${currentUser.handle} hat schon ${currentUser.stats.currentStreak} Tage aufgebaut. Heute nicht auslassen, sonst faellt der Druckmoment weg.`,
			tag: "Streak",
		});
	}

	if (!cards.length) {
		cards.push({
			id: "rec-hot",
			title: "Profil laeuft bereits heiss",
			copy: "Halte den Mix aus Journal und Games stabil, damit dein Ranking nicht nur durch einen Kanal getragen wird.",
			tag: "Momentum",
		});
	}

	return cards.slice(0, 3);
}

function buildAnonymousRecommendations() {
	return [
		{
			id: "rec-anon-1",
			title: "Spieler aktivieren",
			copy: "Erst mit Login werden Daily- und Weekly-Loops, persoenliche Empfehlungen und Rueckkehr-Ziele freigeschaltet.",
			tag: "Login",
		},
		{
			id: "rec-anon-2",
			title: "Journal plus Arcade kombinieren",
			copy: "Die App bindet staerker, wenn Logs, Games und Ranking im selben Profil zusammenlaufen.",
			tag: "Mix",
		},
	];
}

function buildCqReturnBonus(currentUser, engagement) {
	const streak = Number(currentUser?.stats?.currentStreak) || 0;
	const milestones = [3, 5, 7, 14, 30];
	const nextMilestone = milestones.find((value) => value > streak) || (streak + 7);
	const progressPercent = Math.min(100, Math.round((Math.min(streak, nextMilestone) / nextMilestone) * 100));
	const daysSinceActivity = calculateDaysSince(engagement.lastActivityAt);

	if (streak === 0) {
		return {
			title: daysSinceActivity > 1 ? "Comeback-Fenster offen" : "Momentum starten",
			description: daysSinceActivity > 1
				? `Du warst ${daysSinceActivity} Tage inaktiv. Ein Log oder ein Game startet den Push neu.`
				: "Ein neuer Log heute aktiviert wieder deinen Tagesfluss und die Daily-Missions.",
			progressLabel: `0 / ${nextMilestone} Tage bis zur ersten echten Streak`,
			progressPercent: 0,
			status: daysSinceActivity > 1 ? "Comeback" : "Start",
		};
	}

	return {
		title: `Streak auf ${nextMilestone} Tage ziehen`,
		description: `${currentUser.handle} ist bereits ${streak} Tage in Folge aktiv. Heute zaehlt direkt fuer den naechsten Meilenstein.`,
		progressLabel: `${streak} / ${nextMilestone} Tage`,
		progressPercent,
		status: streak >= 7 ? "Hot" : "Building",
	};
}

function buildAnonymousReturnBonus() {
	return {
		title: "Logge dich ein fuer Daily-Loops",
		description: "Mit aktivem Spieler bekommst du taegliche Missionen, Community-Momentum und persoenliche Rueckkehr-Ziele.",
		progressLabel: "Login erforderlich",
		progressPercent: 0,
		status: "Locked",
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

function buildCqGameFeedTitle(row) {
	if (row.opponent_handle) {
		const winner = row.winner_handle || row.actor_handle;
		return `${row.actor_handle} spielte ${row.entry_type} gegen ${row.opponent_handle} - Sieger: ${winner}`;
	}
	return `${row.actor_handle} hat ${row.entry_type} abgeschlossen`;
}

function buildCqFeedDetail(row) {
	if (row.summary) {
		return String(row.summary).slice(0, 180);
	}
	if (row.event_type === "entry") {
		return "Neuer Journal-Eintrag im Live-Feed.";
	}
	return row.opponent_handle ? "Duel-Rewards wurden direkt ins Ranking geschrieben." : "Game-Rewards wurden direkt ins Profil uebernommen.";
}

function calculateDaysSince(value) {
	if (!value) {
		return 999;
	}

	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp)) {
		return 999;
	}

	return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
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

function loadEnvironmentFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return;
	}

	const content = fs.readFileSync(filePath, "utf8");
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}

		const separatorIndex = line.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		if (!key || process.env[key]) {
			continue;
		}

		let value = line.slice(separatorIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		process.env[key] = value;
	}
}

function resolveDatabaseSsl(connectionString) {
	const explicitMode = String(process.env.PGSSLMODE || "").toLowerCase();
	if (explicitMode === "disable") {
		return false;
	}

	if (explicitMode === "require" || explicitMode === "prefer") {
		return { rejectUnauthorized: false };
	}

	try {
		const parsed = new URL(connectionString);
		const sslMode = parsed.searchParams.get("sslmode");
		if (sslMode && sslMode.toLowerCase() === "disable") {
			return false;
		}

		const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
		return isLocalHost ? false : { rejectUnauthorized: false };
	} catch {
		return isProduction ? { rejectUnauthorized: false } : false;
	}
}