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
];

const CQ_SOCIAL_RANK_GROUPS = [
	{ id: "elite-aura", title: "Elite Aura", min: 9, blurb: "Absolute Spitzenklasse mit maximalem sozialen Zug." },
	{ id: "high-orbit", title: "High Orbit", min: 8, blurb: "Sehr stark wahrgenommen und klar ueber dem Durchschnitt." },
	{ id: "social-core", title: "Social Core", min: 6, blurb: "Stabiler Kernbereich mit guter Resonanz." },
	{ id: "open-circle", title: "Open Circle", min: 4, blurb: "Sichtbar, aber noch mit Luft nach oben." },
	{ id: "low-signal", title: "Low Signal", min: 1, blurb: "Momentan eher schwache Wirkung im Ranking." },
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
app.get("/Admin.html", (request, response) => {
	const target = isAuthenticated(request) ? "Admin.html" : "AdminAccess.html";
	response.sendFile(path.join(publicDir, target));
});
app.get("/AdminMessages.html", (request, response) => {
	const target = isAuthenticated(request) ? "AdminMessages.html" : "AdminAccess.html";
	response.sendFile(path.join(publicDir, target));
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

app.get("/api/schools", async (_request, response) => {
	try {
		const schools = await loadSchools();
		response.json({ schools });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/schools", requireAdmin, async (request, response) => {
	const name = String(request.body?.name || "").trim().slice(0, 120);
	if (!name) {
		response.status(400).json({ error: "Schulname ist erforderlich." });
		return;
	}
	try {
		const id = crypto.randomBytes(5).toString("hex");
		const sortOrder = (await pool.query("SELECT COUNT(*)::int AS c FROM schools")).rows[0].c;
		await pool.query("INSERT INTO schools (id, name, sort_order) VALUES ($1, $2, $3)", [id, name, sortOrder]);
		const schools = await loadSchools();
		response.json({ schools });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/schools/:schoolId", requireAdmin, async (request, response) => {
	const { schoolId } = request.params;
	if (!/^[a-f0-9]{10}$/.test(schoolId)) {
		response.status(400).json({ error: "Ungültige Schul-ID." });
		return;
	}
	const stateKey = `school_${schoolId}`;
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("UPDATE app_state SET left_id = NULL, right_id = NULL WHERE state_key = $1", [stateKey]);
		await client.query("DELETE FROM teachers WHERE school_id = $1", [schoolId]);
		await client.query("DELETE FROM app_state WHERE state_key = $1", [stateKey]);
		await client.query("DELETE FROM schools WHERE id = $1", [schoolId]);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
	try {
		const schools = await loadSchools();
		response.json({ schools });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/state", async (request, response) => {
	const schoolId = request.query.school || null;
	try {
		const [state, schools] = await Promise.all([
			schoolId ? loadRuntimeStateForSchool(schoolId) : loadRuntimeState(),
			loadSchools(),
		]);
		response.json({
			state: serializeState(state),
			auth: buildAuthState(request),
			schools,
			schoolId,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/admin/status", async (request, response) => {
	try {
		response.json({ auth: buildAuthState(request) });
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
	const schoolId = request.body?.schoolId || null;
	if (schoolId && !/^[a-f0-9]{10}$/.test(schoolId)) {
		response.status(400).json({ error: "Ungültige Schul-ID." });
		return;
	}
	try {
		const teachers = normalizeTeacherPayload(request.body?.teachers);
		if (teachers.length < 2) {
			response.status(400).json({ error: "Mindestens zwei Profile werden benötigt." });
			return;
		}

		const state = createStateFromTeachers(teachers);
		if (schoolId) {
			await replaceRuntimeStateForSchool(state, schoolId);
		} else {
			await replaceRuntimeState(state);
		}
		const [updatedState, schools] = await Promise.all([
			schoolId ? loadRuntimeStateForSchool(schoolId) : loadRuntimeState(),
			loadSchools(),
		]);
		response.json({
			message: "Neue Profile übernommen.",
			state: serializeState(updatedState),
			auth: buildAuthState(request),
			schools,
			schoolId,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/reset", requireAdmin, async (request, response) => {
	const schoolId = request.body?.schoolId || null;
	if (schoolId && !/^[a-f0-9]{10}$/.test(schoolId)) {
		response.status(400).json({ error: "Ungültige Schul-ID." });
		return;
	}
	try {
		const requestedTeachers = Array.isArray(request.body?.teachers) ? request.body.teachers : null;
		let teachers;
		if (requestedTeachers) {
			teachers = normalizeTeacherPayload(requestedTeachers);
		} else if (schoolId) {
			teachers = normalizeTeacherPayload((await loadRuntimeStateForSchool(schoolId)).teachers);
		} else {
			teachers = normalizeTeacherPayload((await loadRuntimeState()).teachers);
		}
		if (teachers.length < 2) {
			response.status(400).json({ error: "Mindestens zwei Profile werden benötigt." });
			return;
		}

		const state = createStateFromTeachers(teachers);
		if (schoolId) {
			await replaceRuntimeStateForSchool(state, schoolId);
		} else {
			await replaceRuntimeState(state);
		}
		const [updatedState, schools] = await Promise.all([
			schoolId ? loadRuntimeStateForSchool(schoolId) : loadRuntimeState(),
			loadSchools(),
		]);
		response.json({
			message: "Turnier wurde zurückgesetzt.",
			state: serializeState(updatedState),
			auth: buildAuthState(request),
			schools,
			schoolId,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/admin/purge", requireAdmin, async (request, response) => {
	const schoolId = request.body?.schoolId || null;
	if (schoolId && !/^[a-f0-9]{10}$/.test(schoolId)) {
		response.status(400).json({ error: "Ungültige Schul-ID." });
		return;
	}
	const stateKey = schoolId ? `school_${schoolId}` : "main";
	try {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("UPDATE app_state SET left_id = NULL, right_id = NULL, queue = '[]'::jsonb, rounds = 0, updated_at = NOW() WHERE state_key = $1", [stateKey]);
			if (schoolId) {
				await client.query("DELETE FROM teachers WHERE school_id = $1", [schoolId]);
			} else {
				await client.query("DELETE FROM teachers WHERE school_id IS NULL");
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const [state, schools] = await Promise.all([
			schoolId ? loadRuntimeStateForSchool(schoolId) : loadRuntimeState(),
			loadSchools(),
		]);
		response.json({
			message: "Daten wurden gelöscht.",
			state: serializeState(state),
			auth: buildAuthState(request),
			schools,
			schoolId,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/vote", async (request, response) => {
	try {
		const { leftId, rightId, side, schoolId } = request.body || {};
		if (schoolId && !/^[a-f0-9]{10}$/.test(schoolId)) {
			response.status(400).json({ error: "Ungültige Schul-ID." });
			return;
		}
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
		const stateKey = schoolId ? `school_${schoolId}` : "main";

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
				"UPDATE app_state SET rounds = rounds + 1, updated_at = NOW() WHERE state_key = $1",
				[stateKey],
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

		const [state, schools] = await Promise.all([
			schoolId ? loadRuntimeStateForSchool(schoolId) : loadRuntimeState(),
			loadSchools(),
		]);
		response.json({
			message: `${winnerRow.name} gewinnt gegen ${loserRow.name}.`,
			state: serializeState(state),
			auth: buildAuthState(request),
			schools,
			schoolId: schoolId || null,
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

app.get("/api/cq/social-rank", async (request, response) => {
	try {
		const session = await loadCqSession(request);
		const [socialRank, currentUser] = await Promise.all([
			loadCqSocialRankOverview(session?.playerId || null),
			session ? loadCqPlayerProfile(session.playerId) : Promise.resolve(null),
		]);

		response.json({
			currentUserId: session?.playerId || null,
			currentUser,
			...socialRank,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/cq/blog-posts", async (_request, response) => {
	try {
		const result = await pool.query(
			`SELECT id, author_name, title, body, created_at
			 FROM cq_blog_posts
			 ORDER BY created_at DESC
			 LIMIT 50`,
		);

		response.json({
			posts: result.rows.map((row) => serializeBlogPost(row)),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/blog-posts", async (request, response) => {
	try {
		const payload = normalizeBlogPostInput(request.body);
		if (!payload) {
			response.status(400).json({ error: "Autor, Titel und Gedanke sind Pflichtfelder." });
			return;
		}

		const result = await pool.query(
			`INSERT INTO cq_blog_posts (id, author_name, title, body)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, author_name, title, body, created_at`,
			[crypto.randomUUID(), payload.authorName, payload.title, payload.body],
		);

		response.status(201).json({
			message: "Beitrag wurde veroeffentlicht.",
			post: serializeBlogPost(result.rows[0]),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/cq/messages/contacts", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const [currentUser, contacts] = await Promise.all([
			loadCqPlayerProfile(session.playerId),
			loadCqMessageContacts(session.playerId),
		]);

		response.json({ currentUser, contacts });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/cq/messages/threads/:playerId", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const otherPlayerId = String(request.params.playerId || "").trim();
		if (!otherPlayerId || otherPlayerId === session.playerId) {
			response.status(400).json({ error: "Bitte einen anderen Nutzer auswaehlen." });
			return;
		}

		const contact = await loadCqMessageContact(otherPlayerId);
		if (!contact) {
			response.status(404).json({ error: "Nutzer wurde nicht gefunden." });
			return;
		}

		await markCqMessagesAsRead(session.playerId, otherPlayerId);
		const [contacts, messages] = await Promise.all([
			loadCqMessageContacts(session.playerId),
			loadCqMessageThread(session.playerId, otherPlayerId),
		]);

		response.json({ contact, contacts, messages });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/messages/threads/:playerId", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const otherPlayerId = String(request.params.playerId || "").trim();
		if (!otherPlayerId || otherPlayerId === session.playerId) {
			response.status(400).json({ error: "Bitte einen anderen Nutzer auswaehlen." });
			return;
		}

		const payload = normalizeDirectMessageInput(request.body);
		if (!payload) {
			response.status(400).json({ error: "Bitte eine Nachricht mit Inhalt senden." });
			return;
		}

		const contact = await loadCqMessageContact(otherPlayerId);
		if (!contact) {
			response.status(404).json({ error: "Empfaenger wurde nicht gefunden." });
			return;
		}

		const entry = await createCqDirectMessage(session.playerId, otherPlayerId, payload);
		const [contacts, messages] = await Promise.all([
			loadCqMessageContacts(session.playerId),
			loadCqMessageThread(session.playerId, otherPlayerId),
		]);

		response.status(201).json({
			message: "Nachricht wurde serverseitig zugestellt.",
			entry,
			contact,
			contacts,
			messages,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/cq/messages/:messageId", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const messageId = String(request.params.messageId || "").trim();
		if (!messageId) {
			response.status(400).json({ error: "Keine Nachrichten-ID angegeben." });
			return;
		}

		const result = await pool.query(
			"DELETE FROM cq_direct_messages WHERE id = $1 AND sender_player_id = $2 RETURNING id",
			[messageId, session.playerId]
		);

		if (result.rowCount === 0) {
			response.status(404).json({ error: "Nachricht nicht gefunden oder keine Berechtigung." });
			return;
		}

		response.json({ message: "Nachricht wurde geloescht." });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/social-rank/ratings", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const payload = normalizeSocialRatingPayload(request.body);
		if (!payload) {
			response.status(400).json({ error: "Bitte Name und Bewertung von 1 bis 10 angeben." });
			return;
		}

		await upsertCqSocialRating(session.playerId, payload);
		const [currentUser, socialRank] = await Promise.all([
			loadCqPlayerProfile(session.playerId),
			loadCqSocialRankOverview(session.playerId),
		]);

		response.status(201).json({
			message: `${payload.name} wurde mit ${payload.rating}/10 bewertet.`,
			currentUser,
			...socialRank,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/cq/inner-circle/redeem", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const inviteCode = String(request.body?.inviteCode || "").trim().toUpperCase();
		const password = String(request.body?.password || "").trim();
		if (!inviteCode || password.length < 4) {
			response.status(400).json({ error: "Bitte Invite-Code und Passwort eingeben." });
			return;
		}

		const redeemResult = await redeemInnerCircleInvite(session.playerId, inviteCode, password);
		const [currentUser, socialRank] = await Promise.all([
			loadCqPlayerProfile(session.playerId),
			loadCqSocialRankOverview(session.playerId),
		]);

		response.json({
			message: redeemResult.message,
			currentUser,
			...socialRank,
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/admin/inner-circle", requireAdmin, async (request, response) => {
	try {
		const [invites, members] = await Promise.all([
			loadInnerCircleInvites(),
			loadInnerCircleMembers(),
		]);
		response.json({ invites, members, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/admin/overview", requireAdmin, async (request, response) => {
	try {
		const overview = await loadAdminOverview();
		response.json({ overview, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/banner", async (_request, response) => {
	try {
		const banner = await loadActiveAdminBanner();
		response.json({ banner });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/messages", async (_request, response) => {
	try {
		const messages = await loadAdminMessages();
		response.json({ messages });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/admin/messages", requireAdmin, async (request, response) => {
	try {
		const messages = await loadAdminMessages();
		response.json({ messages, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/admin/messages/:messageId", requireAdmin, async (request, response) => {
	try {
		const deleted = await deleteAdminMessage(String(request.params.messageId || ""));
		if (!deleted) {
			response.status(404).json({ error: "Nachricht wurde nicht gefunden." });
			return;
		}
		const messages = await loadAdminMessages();
		response.json({ message: "Admin-Nachricht wurde geloescht.", messages, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/admin/messages", requireAdmin, async (request, response) => {
	try {
		const payload = normalizeAdminMessageInput(request.body);
		if (!payload) {
			response.status(400).json({ error: "Bitte Autor, Titel, Kategorie und Nachricht angeben." });
			return;
		}

		const message = await createAdminMessage(payload);
		const messages = await loadAdminMessages();
		response.status(201).json({
			message: "Admin-Nachricht wurde gespeichert.",
			entry: message,
			messages,
			auth: buildAuthState(request),
		});
	} catch (error) {
		sendServerError(response, error);
	}
});

app.get("/api/admin/moderation", requireAdmin, async (request, response) => {
	try {
		const [players, blogPosts] = await Promise.all([
			loadAdminPlayers(),
			loadAdminBlogPosts(),
		]);
		response.json({ players, blogPosts, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/admin/blog-posts/:postId", requireAdmin, async (request, response) => {
	try {
		const deleted = await deleteBlogPost(String(request.params.postId || ""));
		if (!deleted) {
			response.status(404).json({ error: "Blog-Post wurde nicht gefunden." });
			return;
		}
		const blogPosts = await loadAdminBlogPosts();
		response.json({ message: "Blog-Post wurde geloescht.", blogPosts, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.delete("/api/admin/players/:playerId", requireAdmin, async (request, response) => {
	try {
		const playerId = String(request.params.playerId || "").trim();
		if (!playerId) {
			response.status(400).json({ error: "Spieler-ID fehlt." });
			return;
		}

		const deleted = await deleteCqPlayerAccount(playerId);
		if (!deleted) {
			response.status(404).json({ error: "Spieler wurde nicht gefunden." });
			return;
		}

		const [players, overview] = await Promise.all([
			loadAdminPlayers(),
			loadAdminOverview(),
		]);
		response.json({ message: "Spieleraccount wurde geloescht.", players, overview, auth: buildAuthState(request) });
	} catch (error) {
		sendServerError(response, error);
	}
});

app.post("/api/admin/inner-circle/invites", requireAdmin, async (request, response) => {
	try {
		const label = String(request.body?.label || "").trim().slice(0, 48);
		const password = String(request.body?.password || "").trim();
		const expiresInDays = Math.max(1, Math.min(60, Number(request.body?.expiresInDays) || 14));
		if (!label || password.length < 4) {
			response.status(400).json({ error: "Bitte Label und Passwort mit mindestens 4 Zeichen angeben." });
			return;
		}

		const invite = await createInnerCircleInvite({ label, password, expiresInDays });
		const [invites, members] = await Promise.all([
			loadInnerCircleInvites(),
			loadInnerCircleMembers(),
		]);

		response.status(201).json({
			message: `Invite ${invite.inviteCode} wurde erstellt.`,
			invite,
			invites,
			members,
			auth: buildAuthState(request),
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

app.delete("/api/cq/account", async (request, response) => {
	try {
		const session = await requireCqPlayer(request, response);
		if (!session) {
			return;
		}

		const pin = String(request.body?.pin || "").trim();
		if (pin.length < 4) {
			response.status(400).json({ error: "Bitte zur Bestaetigung deine PIN eingeben." });
			return;
		}

		const playerResult = await pool.query("SELECT pin_hash FROM cq_players WHERE id = $1", [session.playerId]);
		const player = playerResult.rows[0];
		if (!player || !verifySecret(pin, player.pin_hash)) {
			response.status(401).json({ error: "Die PIN ist falsch." });
			return;
		}

		await deleteCqPlayerAccount(session.playerId);
		response.json({ ok: true, message: "Dein Account wurde dauerhaft geloescht." });
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
			status_tier VARCHAR(24) NOT NULL DEFAULT 'standard',
			inner_circle_joined_at TIMESTAMPTZ,
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

		CREATE TABLE IF NOT EXISTS cq_social_people (
			id TEXT PRIMARY KEY,
			name VARCHAR(48) NOT NULL,
			name_key VARCHAR(48) NOT NULL UNIQUE,
			created_by_player_id TEXT REFERENCES cq_players(id) ON DELETE SET NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS cq_social_ratings (
			id TEXT PRIMARY KEY,
			person_id TEXT NOT NULL REFERENCES cq_social_people(id) ON DELETE CASCADE,
			player_id TEXT NOT NULL REFERENCES cq_players(id) ON DELETE CASCADE,
			rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
			notes VARCHAR(180) NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (person_id, player_id)
		);

		CREATE TABLE IF NOT EXISTS cq_inner_circle_invites (
			id TEXT PRIMARY KEY,
			invite_code VARCHAR(24) NOT NULL UNIQUE,
			label VARCHAR(48) NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ,
			redeemed_by_player_id TEXT REFERENCES cq_players(id) ON DELETE SET NULL,
			redeemed_at TIMESTAMPTZ
		);

		CREATE TABLE IF NOT EXISTS cq_blog_posts (
			id TEXT PRIMARY KEY,
			author_name VARCHAR(40) NOT NULL,
			title VARCHAR(80) NOT NULL,
			body VARCHAR(1200) NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS cq_admin_messages (
			id TEXT PRIMARY KEY,
			author_name VARCHAR(40) NOT NULL,
			title VARCHAR(80) NOT NULL,
			category VARCHAR(32) NOT NULL,
			body VARCHAR(1500) NOT NULL,
			is_banner BOOLEAN NOT NULL DEFAULT FALSE,
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS cq_direct_messages (
			id TEXT PRIMARY KEY,
			sender_player_id TEXT NOT NULL REFERENCES cq_players(id) ON DELETE CASCADE,
			recipient_player_id TEXT NOT NULL REFERENCES cq_players(id) ON DELETE CASCADE,
			body VARCHAR(1500) NOT NULL,
			read_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (sender_player_id <> recipient_player_id)
		);
	`);

	await pool.query("ALTER TABLE cq_admin_messages ADD COLUMN IF NOT EXISTS is_banner BOOLEAN NOT NULL DEFAULT FALSE");
	await pool.query("ALTER TABLE cq_admin_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ");
	await pool.query("CREATE INDEX IF NOT EXISTS idx_cq_direct_messages_thread ON cq_direct_messages (sender_player_id, recipient_player_id, created_at DESC)");
	await pool.query("CREATE INDEX IF NOT EXISTS idx_cq_direct_messages_unread ON cq_direct_messages (recipient_player_id, sender_player_id, read_at)");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_sessions INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_wins INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_score INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS game_xp INTEGER NOT NULL DEFAULT 0");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS status_tier VARCHAR(24) NOT NULL DEFAULT 'standard'");
	await pool.query("ALTER TABLE cq_players ADD COLUMN IF NOT EXISTS inner_circle_joined_at TIMESTAMPTZ");

	await pool.query(`
		CREATE TABLE IF NOT EXISTS schools (
			id TEXT PRIMARY KEY,
			name VARCHAR(120) NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);
	await pool.query("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id) ON DELETE SET NULL");

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

async function loadSchools() {
	const result = await pool.query("SELECT id, name FROM schools ORDER BY sort_order ASC, name ASC");
	return result.rows;
}

function mapTeacherRow(row) {
	return {
		id: row.id,
		name: row.name,
		subject: row.subject,
		image: row.image,
		wins: Number(row.wins),
		losses: Number(row.losses),
		matches: Number(row.matches),
	};
}

async function loadRuntimeState() {
	const [teachersResult, appStateResult] = await Promise.all([
		pool.query("SELECT * FROM teachers WHERE school_id IS NULL ORDER BY sort_order ASC, name ASC"),
		pool.query("SELECT * FROM app_state WHERE state_key = 'main'"),
	]);

	const teachers = teachersResult.rows.map(mapTeacherRow);
	const appState = appStateResult.rows[0] || { rounds: 0 };

	return {
		teachers,
		rounds: Number(appState.rounds) || 0,
		currentPair: generateRandomPair(teachers),
	};
}

async function loadRuntimeStateForSchool(schoolId) {
	const stateKey = `school_${schoolId}`;
	const [teachersResult, appStateResult] = await Promise.all([
		pool.query("SELECT * FROM teachers WHERE school_id = $1 ORDER BY sort_order ASC, name ASC", [schoolId]),
		pool.query("SELECT * FROM app_state WHERE state_key = $1", [stateKey]),
	]);

	const teachers = teachersResult.rows.map(mapTeacherRow);
	const appState = appStateResult.rows[0] || { rounds: 0 };

	return {
		teachers,
		rounds: Number(appState.rounds) || 0,
		currentPair: generateRandomPair(teachers),
	};
}

async function replaceRuntimeStateForSchool(state, schoolId) {
	const stateKey = `school_${schoolId}`;
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("UPDATE app_state SET left_id = NULL, right_id = NULL WHERE state_key = $1", [stateKey]);
		await client.query("DELETE FROM teachers WHERE school_id = $1", [schoolId]);

		for (const [index, teacher] of state.teachers.entries()) {
			await client.query(
				`INSERT INTO teachers (id, name, subject, image, wins, losses, matches, sort_order, school_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				[teacher.id, teacher.name, teacher.subject, teacher.image, teacher.wins, teacher.losses, teacher.matches, index, schoolId],
			);
		}

		await client.query(
			`INSERT INTO app_state (state_key, rounds, queue, left_id, right_id)
			 VALUES ($1, 0, '[]'::jsonb, NULL, NULL)
			 ON CONFLICT (state_key) DO UPDATE
			 SET rounds = 0, queue = '[]'::jsonb, left_id = NULL, right_id = NULL, updated_at = NOW()`,
			[stateKey],
		);

		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

async function replaceRuntimeState(state) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("UPDATE app_state SET left_id = NULL, right_id = NULL, queue = '[]'::jsonb, updated_at = NOW() WHERE state_key = 'main'");
		await client.query("DELETE FROM teachers WHERE school_id IS NULL");

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
			id: crypto.randomBytes(5).toString("hex"),
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

function normalizeSocialRatingPayload(body) {
	const name = normalizeSocialPersonName(body?.name);
	const rating = Math.round(Number(body?.rating));
	const notes = String(body?.notes || "").trim().slice(0, 180);
	if (!name || !Number.isFinite(rating) || rating < 1 || rating > 10) {
		return null;
	}
	return { name, rating, notes };
}

function normalizeSocialPersonName(value) {
	const normalized = String(value || "").replace(/\s+/g, " ").trim().slice(0, 48);
	return normalized.length >= 2 ? normalized : "";
}

function normalizeBlogPostInput(body) {
	const authorName = normalizeBlogShortText(body?.authorName, 40);
	const title = normalizeBlogShortText(body?.title, 80);
	const bodyText = normalizeBlogLongText(body?.body, 1200);
	if (!authorName || !title || !bodyText) {
		return null;
	}
	return {
		authorName,
		title,
		body: bodyText,
	};
}

function normalizeAdminMessageInput(body) {
	const authorName = normalizeBlogShortText(body?.authorName, 40);
	const title = normalizeBlogShortText(body?.title, 80);
	const category = normalizeBlogShortText(body?.category, 32);
	const messageBody = normalizeBlogLongText(body?.body, 1500);
	if (!authorName || !title || !category || !messageBody) {
		return null;
	}
	return {
		authorName,
		title,
		category,
		isBanner: true,
		body: messageBody,
	};
}

function normalizeDirectMessageInput(body) {
	const messageBody = normalizeBlogLongText(body?.body, 1500);
	if (!messageBody) {
		return null;
	}
	return {
		body: messageBody,
	};
}

function normalizeBlogShortText(value, maxLength) {
	const normalized = String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
	return normalized;
}

function normalizeBlogLongText(value, maxLength) {
	const normalized = String(value || "")
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, maxLength);
	return normalized;
}

function serializeBlogPost(row) {
	return {
		id: row.id,
		authorName: row.author_name,
		title: row.title,
		body: row.body,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
	};
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

async function upsertCqSocialRating(playerId, payload) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const personResult = await client.query(
			`INSERT INTO cq_social_people (id, name, name_key, created_by_player_id, updated_at)
			 VALUES ($1, $2, $3, $4, NOW())
			 ON CONFLICT (name_key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
			 RETURNING id`,
			[crypto.randomUUID(), payload.name, payload.name.toLowerCase(), playerId],
		);
		const personId = personResult.rows[0].id;
		await client.query(
			`INSERT INTO cq_social_ratings (id, person_id, player_id, rating, notes, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
			 ON CONFLICT (person_id, player_id)
			 DO UPDATE SET rating = EXCLUDED.rating, notes = EXCLUDED.notes, updated_at = NOW()`,
			[crypto.randomUUID(), personId, playerId, payload.rating, payload.notes],
		);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

async function loadCqSocialRankOverview(currentPlayerId) {
	const [directoryResult, myRatingsResult, membersResult, currentPlayerResult] = await Promise.all([
		pool.query(
			`SELECT p.id, p.name,
			        COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0) AS avg_rating,
			        COUNT(r.id)::int AS rating_count,
			        MAX(r.updated_at) AS last_rated_at
			 FROM cq_social_people p
			 LEFT JOIN cq_social_ratings r ON r.person_id = p.id
			 GROUP BY p.id, p.name
			 HAVING COUNT(r.id) > 0
			 ORDER BY avg_rating DESC, rating_count DESC, p.name ASC
			 LIMIT 80`,
		),
		currentPlayerId ? pool.query(
			`SELECT p.id, p.name, r.rating, r.notes, r.updated_at
			 FROM cq_social_ratings r
			 JOIN cq_social_people p ON p.id = r.person_id
			 WHERE r.player_id = $1
			 ORDER BY r.updated_at DESC, p.name ASC
			 LIMIT 12`,
			[currentPlayerId],
		) : Promise.resolve({ rows: [] }),
		loadInnerCircleMembers(),
		currentPlayerId ? pool.query(
			"SELECT handle, status_tier, inner_circle_joined_at FROM cq_players WHERE id = $1",
			[currentPlayerId],
		) : Promise.resolve({ rows: [] }),
	]);

	const directory = directoryResult.rows.map((row) => serializeSocialRankPerson(row));
	const groups = CQ_SOCIAL_RANK_GROUPS.map((group) => ({
		id: group.id,
		title: group.title,
		blurb: group.blurb,
		people: directory.filter((person) => person.rankGroup.id === group.id).slice(0, 12),
	})).filter((group) => group.people.length > 0);

	return {
		directory,
		groups,
		myRatings: myRatingsResult.rows.map((row) => ({
			id: row.id,
			name: row.name,
			rating: Number(row.rating) || 0,
			notes: row.notes,
			updatedAt: row.updated_at,
		})),
		community: {
			totalPeople: directory.length,
			totalRatings: directory.reduce((sum, person) => sum + person.ratingCount, 0),
			topBand: groups[0]?.title || "Noch kein Rang",
		},
		innerCircle: buildInnerCirclePayload(currentPlayerResult.rows[0] || null, membersResult, directory),
	};
}

function serializeSocialRankPerson(row) {
	const averageRating = Number(row.avg_rating) || 0;
	const rankGroup = resolveSocialRankGroup(averageRating);
	return {
		id: row.id,
		name: row.name,
		averageRating,
		ratingCount: Number(row.rating_count) || 0,
		lastRatedAt: row.last_rated_at,
		rankGroup,
	};
}

function resolveSocialRankGroup(averageRating) {
	const group = CQ_SOCIAL_RANK_GROUPS.find((entry) => averageRating >= entry.min) || CQ_SOCIAL_RANK_GROUPS[CQ_SOCIAL_RANK_GROUPS.length - 1];
	return { id: group.id, title: group.title, blurb: group.blurb };
}

function buildInnerCirclePayload(memberRow, members, directory) {
	const isMember = memberRow?.status_tier === "inner-circle";
	return {
		isMember,
		joinedAt: memberRow?.inner_circle_joined_at || null,
		memberCount: members.length,
		members,
		lockedMessage: isMember ? null : "Nur Admin-Einladung plus Passwort bringen dich in den Inneren Kreis.",
		secretBenefit: isMember ? buildInnerCircleSecretBenefit(directory) : null,
	};
}

function buildInnerCircleSecretBenefit(directory) {
	const shadowTargets = directory
		.filter((person) => person.averageRating >= 8 && person.ratingCount <= 2)
		.slice(0, 4)
		.map((person) => ({
			name: person.name,
			averageRating: person.averageRating,
			ratingCount: person.ratingCount,
			reason: "Starker Schnitt, aber noch wenig beachtet.",
		}));

	return {
		title: "Shadow Forecast",
		copy: "Du bekommst einen verdeckten Blick auf starke Personen mit noch wenig Aufmerksamkeit.",
		shadowTargets,
	};
}

async function createInnerCircleInvite({ label, password, expiresInDays }) {
	const inviteCode = `CIRCLE-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
	await pool.query(
		`INSERT INTO cq_inner_circle_invites (id, invite_code, label, password_hash, expires_at)
		 VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)`,
		[crypto.randomUUID(), inviteCode, label, hashSecret(password), String(expiresInDays)],
	);
	return {
		inviteCode,
		label,
		expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
	};
}

async function redeemInnerCircleInvite(playerId, inviteCode, password) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const playerResult = await client.query(
			"SELECT status_tier FROM cq_players WHERE id = $1 FOR UPDATE",
			[playerId],
		);
		const player = playerResult.rows[0];
		if (!player) {
			throw new Error("Spieler konnte nicht geladen werden.");
		}
		if (player.status_tier === "inner-circle") {
			throw new Error("Dieser Spieler ist bereits im Inneren Kreis.");
		}

		const inviteResult = await client.query(
			`SELECT id, password_hash, redeemed_by_player_id, expires_at
			 FROM cq_inner_circle_invites
			 WHERE invite_code = $1
			 FOR UPDATE`,
			[inviteCode],
		);
		const invite = inviteResult.rows[0];
		if (!invite) {
			throw new Error("Invite-Code wurde nicht gefunden.");
		}
		if (invite.redeemed_by_player_id) {
			throw new Error("Dieser Invite wurde bereits verwendet.");
		}
		if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
			throw new Error("Dieser Invite ist abgelaufen.");
		}
		if (!verifySecret(password, invite.password_hash)) {
			throw new Error("Passwort fuer den Inneren Kreis ist falsch.");
		}

		await client.query(
			`UPDATE cq_inner_circle_invites
			 SET redeemed_by_player_id = $2,
			     redeemed_at = NOW()
			 WHERE id = $1`,
			[invite.id, playerId],
		);
		await client.query(
			`UPDATE cq_players
			 SET status_tier = 'inner-circle',
			     inner_circle_joined_at = NOW(),
			     updated_at = NOW()
			 WHERE id = $1`,
			[playerId],
		);
		await refreshCqPlacements(client);
		await client.query("COMMIT");
		return { message: "Der Innere Kreis wurde freigeschaltet." };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

async function loadInnerCircleInvites() {
	const result = await pool.query(
		`SELECT invite_code, label, created_at, expires_at, redeemed_at, redeemed_by_player_id,
		        CASE WHEN redeemed_by_player_id IS NULL AND (expires_at IS NULL OR expires_at > NOW()) THEN TRUE ELSE FALSE END AS is_active
		 FROM cq_inner_circle_invites
		 ORDER BY created_at DESC
		 LIMIT 20`,
	);
	return result.rows.map((row) => ({
		inviteCode: row.invite_code,
		label: row.label,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		redeemedAt: row.redeemed_at,
		redeemedByPlayerId: row.redeemed_by_player_id || null,
		isActive: Boolean(row.is_active),
	}));
}

async function loadInnerCircleMembers() {
	const result = await pool.query(
		`SELECT handle, score, level, inner_circle_joined_at
		 FROM cq_players
		 WHERE status_tier = 'inner-circle'
		 ORDER BY inner_circle_joined_at DESC NULLS LAST, handle ASC
		 LIMIT 18`,
	);
	return result.rows.map((row) => ({
		handle: row.handle,
		score: Number(row.score) || 0,
		level: Number(row.level) || 1,
		joinedAt: row.inner_circle_joined_at,
	}));
}

async function loadCqMessageContact(playerId) {
	const result = await pool.query(
		`SELECT id, handle, placement, score, level, last_login_at
		 FROM cq_players
		 WHERE id = $1`,
		[playerId],
	);
	return result.rows[0] ? serializeCqMessageContact(result.rows[0]) : null;
}

async function loadCqMessageContacts(currentPlayerId, limit = 48) {
	const result = await pool.query(
		`SELECT p.id, p.handle, p.placement, p.score, p.level, p.last_login_at,
		        latest.body AS latest_body,
		        latest.created_at AS latest_created_at,
		        latest.sender_player_id AS latest_sender_player_id,
		        latest.recipient_player_id AS latest_recipient_player_id,
		        COALESCE(unread.unread_count, 0) AS unread_count
		 FROM cq_players p
		 LEFT JOIN LATERAL (
		 	SELECT body, created_at, sender_player_id, recipient_player_id
		 	FROM cq_direct_messages
		 	WHERE (sender_player_id = $1 AND recipient_player_id = p.id)
		 	   OR (sender_player_id = p.id AND recipient_player_id = $1)
		 	ORDER BY created_at DESC
		 	LIMIT 1
		 ) latest ON TRUE
		 LEFT JOIN LATERAL (
		 	SELECT COUNT(*)::int AS unread_count
		 	FROM cq_direct_messages
		 	WHERE sender_player_id = p.id
		 	  AND recipient_player_id = $1
		 	  AND read_at IS NULL
		 ) unread ON TRUE
		 WHERE p.id <> $1
		 ORDER BY CASE WHEN latest.created_at IS NULL THEN 1 ELSE 0 END ASC,
		          latest.created_at DESC NULLS LAST,
		          p.handle ASC
		 LIMIT $2`,
		[currentPlayerId, Math.max(1, Math.min(100, Number(limit) || 48))],
	);
	return result.rows.map((row) => serializeCqMessageContact(row));
}

async function loadCqMessageThread(currentPlayerId, otherPlayerId, limit = 80) {
	const result = await pool.query(
		`SELECT m.id, m.sender_player_id, m.recipient_player_id, m.body, m.read_at, m.created_at,
		        sender.handle AS sender_handle,
		        recipient.handle AS recipient_handle
		 FROM cq_direct_messages m
		 JOIN cq_players sender ON sender.id = m.sender_player_id
		 JOIN cq_players recipient ON recipient.id = m.recipient_player_id
		 WHERE (m.sender_player_id = $1 AND m.recipient_player_id = $2)
		    OR (m.sender_player_id = $2 AND m.recipient_player_id = $1)
		 ORDER BY m.created_at ASC
		 LIMIT $3`,
		[currentPlayerId, otherPlayerId, Math.max(1, Math.min(200, Number(limit) || 80))],
	);
	return result.rows.map((row) => serializeCqDirectMessage(row, currentPlayerId));
}

async function markCqMessagesAsRead(currentPlayerId, otherPlayerId) {
	await pool.query(
		`UPDATE cq_direct_messages
		 SET read_at = NOW()
		 WHERE sender_player_id = $1
		   AND recipient_player_id = $2
		   AND read_at IS NULL`,
		[otherPlayerId, currentPlayerId],
	);
}

async function createCqDirectMessage(senderPlayerId, recipientPlayerId, payload) {
	const result = await pool.query(
		`INSERT INTO cq_direct_messages (id, sender_player_id, recipient_player_id, body)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, sender_player_id, recipient_player_id, body, read_at, created_at`,
		[crypto.randomUUID(), senderPlayerId, recipientPlayerId, payload.body],
	);
	return serializeCqDirectMessage(result.rows[0], senderPlayerId);
}

async function loadAdminMessages(limit = 24) {
	const result = await pool.query(
		`SELECT id, author_name, title, category, body, is_banner, expires_at, created_at, updated_at
		 FROM cq_admin_messages
		 ORDER BY created_at DESC, updated_at DESC
		 LIMIT $1`,
		[Math.max(1, Math.min(100, Number(limit) || 24))],
	);
	return result.rows.map((row) => serializeAdminMessage(row));
}

async function deleteAdminMessage(messageId) {
	const result = await pool.query("DELETE FROM cq_admin_messages WHERE id = $1", [messageId]);
	return result.rowCount > 0;
}

async function loadActiveAdminBanner() {
	const result = await pool.query(
		`SELECT id, author_name, title, category, body, is_banner, expires_at, created_at, updated_at
		 FROM cq_admin_messages
		 ORDER BY updated_at DESC, created_at DESC
		 LIMIT 1`,
	);
	return result.rows[0] ? serializeAdminMessage(result.rows[0]) : null;
}

async function loadAdminPlayers(limit = 18) {
	const result = await pool.query(
		`SELECT id, handle, score, level, placement, status_tier, total_entries, game_sessions, last_login_at, created_at
		 FROM cq_players
		 ORDER BY last_login_at DESC NULLS LAST, created_at DESC
		 LIMIT $1`,
		[Math.max(1, Math.min(100, Number(limit) || 18))],
	);
	return result.rows.map((row) => ({
		id: row.id,
		handle: row.handle,
		score: Number(row.score) || 0,
		level: Number(row.level) || 1,
		placement: Number(row.placement) || 0,
		statusTier: row.status_tier || "standard",
		totalEntries: Number(row.total_entries) || 0,
		gameSessions: Number(row.game_sessions) || 0,
		lastLoginAt: row.last_login_at,
		createdAt: row.created_at,
	}));
}

async function loadAdminBlogPosts(limit = 18) {
	const result = await pool.query(
		`SELECT id, author_name, title, body, created_at
		 FROM cq_blog_posts
		 ORDER BY created_at DESC
		 LIMIT $1`,
		[Math.max(1, Math.min(100, Number(limit) || 18))],
	);
	return result.rows.map((row) => serializeBlogPost(row));
}

async function deleteBlogPost(postId) {
	const result = await pool.query("DELETE FROM cq_blog_posts WHERE id = $1", [postId]);
	return result.rowCount > 0;
}

async function deleteCqPlayerAccount(playerId) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const deleteResult = await client.query("DELETE FROM cq_players WHERE id = $1", [playerId]);
		if (deleteResult.rowCount === 0) {
			await client.query("ROLLBACK");
			return false;
		}
		await refreshCqPlacements(client);
		await client.query("COMMIT");
		return true;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

async function createAdminMessage(payload) {
	const result = await pool.query(
		`INSERT INTO cq_admin_messages (id, author_name, title, category, body, is_banner, expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, TRUE, NULL, NOW(), NOW())
		 RETURNING id, author_name, title, category, body, is_banner, expires_at, created_at, updated_at`,
		[crypto.randomUUID(), payload.authorName, payload.title, payload.category, payload.body],
	);
	return serializeAdminMessage(result.rows[0]);
}

function serializeAdminMessage(row) {
	return {
		id: row.id,
		authorName: row.author_name,
		title: row.title,
		category: row.category,
		body: row.body,
		isBanner: Boolean(row.is_banner),
		expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
		updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
	};
}

function serializeCqMessageContact(row) {
	return {
		id: row.id,
		handle: row.handle,
		placement: Number(row.placement) || 0,
		score: Number(row.score) || 0,
		level: Number(row.level) || 1,
		lastLoginAt: row.last_login_at || null,
		latestMessage: row.latest_body
			? {
				body: row.latest_body,
				createdAt: row.latest_created_at instanceof Date ? row.latest_created_at.toISOString() : row.latest_created_at,
				isFromCurrentUser: row.latest_sender_player_id ? String(row.latest_sender_player_id) !== String(row.id) : false,
			}
			: null,
		unreadCount: Number(row.unread_count) || 0,
	};
}

function serializeCqDirectMessage(row, currentPlayerId) {
	return {
		id: row.id,
		senderPlayerId: row.sender_player_id,
		recipientPlayerId: row.recipient_player_id,
		senderHandle: row.sender_handle || null,
		recipientHandle: row.recipient_handle || null,
		body: row.body,
		readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
		isOwn: String(row.sender_player_id) === String(currentPlayerId),
	};
}

async function loadAdminOverview() {
	const [
		playerCountResult,
		entryCountResult,
		ratingCountResult,
		peopleCountResult,
		inviteCountResult,
		messageCountResult,
		blogCountResult,
		teacherCountResult,
		latestPlayersResult,
		topPlayersResult,
	] = await Promise.all([
		pool.query("SELECT COUNT(*)::int AS count FROM cq_players"),
		pool.query("SELECT COUNT(*)::int AS count FROM cq_entries"),
		pool.query("SELECT COUNT(*)::int AS count FROM cq_social_ratings"),
		pool.query("SELECT COUNT(*)::int AS count FROM cq_social_people"),
		pool.query("SELECT COUNT(*)::int AS count FROM cq_inner_circle_invites"),
		pool.query("SELECT COUNT(*)::int AS count FROM cq_admin_messages"),
		pool.query("SELECT COUNT(*)::int AS count FROM cq_blog_posts"),
		pool.query("SELECT COUNT(*)::int AS count FROM teachers"),
		pool.query(
			`SELECT handle, last_login_at, status_tier
			 FROM cq_players
			 ORDER BY last_login_at DESC NULLS LAST, created_at DESC
			 LIMIT 8`,
		),
		pool.query(
			`SELECT handle, score, level, placement, status_tier
			 FROM cq_players
			 ORDER BY placement ASC, created_at ASC
			 LIMIT 6`,
		),
	]);

	const [members, recentAdminMessages] = await Promise.all([
		loadInnerCircleMembers(),
		loadAdminMessages(4),
	]);

	return {
		stats: {
			players: Number(playerCountResult.rows[0]?.count) || 0,
			entries: Number(entryCountResult.rows[0]?.count) || 0,
			ratings: Number(ratingCountResult.rows[0]?.count) || 0,
			people: Number(peopleCountResult.rows[0]?.count) || 0,
			invites: Number(inviteCountResult.rows[0]?.count) || 0,
			adminMessages: Number(messageCountResult.rows[0]?.count) || 0,
			blogPosts: Number(blogCountResult.rows[0]?.count) || 0,
			teacherProfiles: Number(teacherCountResult.rows[0]?.count) || 0,
			innerCircleMembers: members.length,
		},
		recentPlayers: latestPlayersResult.rows.map((row) => ({
			handle: row.handle,
			lastLoginAt: row.last_login_at,
			statusTier: row.status_tier || "standard",
		})),
		topPlayers: topPlayersResult.rows.map((row) => ({
			handle: row.handle,
			score: Number(row.score) || 0,
			level: Number(row.level) || 1,
			placement: Number(row.placement) || 0,
			statusTier: row.status_tier || "standard",
		})),
		recentAdminMessages,
		innerCircleMembers: members,
	};
}

async function loadCqPlayerProfile(playerId) {
	const [playerResult, entriesResult] = await Promise.all([
		pool.query(
			`SELECT id, handle, login_count, last_login_at, total_entries, unique_connections, type_variety,
			        current_streak, best_month_count, game_sessions, game_wins, game_score, game_xp,
			        xp, level, score, status_tier, inner_circle_joined_at, unlocked_achievements, placement,
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
		        xp, level, score, status_tier, inner_circle_joined_at, unlocked_achievements, placement,
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
		status: {
			tier: row.status_tier || "standard",
			isInnerCircle: row.status_tier === "inner-circle",
			innerCircleJoinedAt: row.inner_circle_joined_at || null,
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
			copy: "Ein kurzer Sprint oder ein Pattern-Run bringt sofort Game-Score, Feed-Aktivitaet und Weekly-Fortschritt.",
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