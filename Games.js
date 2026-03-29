const SESSION_KEY = "connection-quest-session-token-v1";

const state = {
	currentUserId: "",
	currentUser: null,
	leaderboard: [],
	feed: [],
	pulseData: {
		missions: [],
		weeklyChallenges: [],
		recommendations: [],
		activityFeed: [],
	},
	sprint: {
		running: false,
		hits: 0,
		timeLeft: 20,
		intervalId: null,
	},
	pattern: {
		running: false,
		sequence: [],
		playerIndex: 0,
		round: 0,
		locked: false,
	},
	reactionFlash: {
		running: false,
		round: 0,
		succeeded: 0,
		flashActive: false,
		timeoutId: null,
		startTime: 0,
	},
	colorClash: {
		running: false,
		score: 0,
		timeLeft: 25,
		intervalId: null,
		correctColor: null,
	},
};

const sprintStartButton = document.querySelector("#sprint-start");
const sprintTarget = document.querySelector("#sprint-target");
const sprintStage = document.querySelector("#sprint-stage");
const patternStartButton = document.querySelector("#pattern-start");
const patternPads = Array.from(document.querySelectorAll(".pattern-pad"));
const flashStartButton = document.querySelector("#flash-start");
const flashOrb = document.querySelector("#flash-orb");
const clashStartButton = document.querySelector("#clash-start");
const clashChoiceBtns = Array.from(document.querySelectorAll(".clash-btn"));
const gamesMissions = document.querySelector("#games-missions");
const gamesRecommendations = document.querySelector("#games-recommendations");
const gamesCommunityFeed = document.querySelector("#games-community-feed");

initialize();

async function initialize() {
	await hydrate();
	bindEvents();
	renderAll();
}

function bindEvents() {
	sprintStartButton.addEventListener("click", startSprint);
	sprintTarget.addEventListener("click", handleSprintHit);
	patternStartButton.addEventListener("click", startPattern);
	patternPads.forEach((pad) => {
		pad.addEventListener("click", () => handlePatternInput(Number(pad.dataset.pad)));
	});
	flashStartButton.addEventListener("click", startReactionFlash);
	flashOrb.addEventListener("click", handleFlashClick);
	clashStartButton.addEventListener("click", startColorClash);
	clashChoiceBtns.forEach((btn) => {
		btn.addEventListener("click", () => handleClashChoice(btn.dataset.color));
	});
}

async function hydrate() {
	const [leaderboardPayload, pulsePayload] = await Promise.all([
		apiRequest("/api/cq/leaderboard"),
		apiRequest("/api/cq/pulse"),
	]);
	state.currentUserId = leaderboardPayload.currentUserId || "";
	state.leaderboard = leaderboardPayload.leaderboard || [];
	state.currentUser = state.leaderboard.find((entry) => entry.id === state.currentUserId) || null;
	state.pulseData = pulsePayload || state.pulseData;
}

function renderAll() {
	renderCurrentPlayer();
	renderLoopPanels();
	renderSprintHud();
	renderPatternHud();
	renderFlashHud();
	renderClashHud();
	renderFeed();
	updateLockState();
}

function renderLoopPanels() {
	const daily = state.pulseData?.missions || [];
	const weekly = state.pulseData?.weeklyChallenges || [];
	const recommendations = state.pulseData?.recommendations || [];
	const activityFeed = state.pulseData?.activityFeed || [];

	renderGameLoopList(gamesMissions, [
		...daily.map((item) => ({ ...item, tag: "Today" })),
		...weekly.slice(0, 2).map((item) => ({ ...item, tag: "Week" })),
	], !state.currentUser, "Login erforderlich fuer taegliche und woechentliche Ziele.");

	renderGameRecommendationList(recommendations);
	renderGameCommunityFeed(activityFeed);
}

function renderGameLoopList(node, items, locked, emptyCopy) {
	node.innerHTML = "";
	node.classList.toggle("empty-state", locked || items.length === 0);
	if (locked) {
		node.textContent = emptyCopy;
		return;
	}
	if (!items.length) {
		node.textContent = "Noch keine Loop-Daten vorhanden.";
		return;
	}
	items.forEach((item) => {
		const article = document.createElement("article");
		article.className = "loop-item";
		article.innerHTML = `
			<div class="loop-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="loop-tag">${escapeHtml(item.tag || "Loop")}</span>
			</div>
			<p>${escapeHtml(item.description || "")}</p>
			<div class="loop-progress" aria-hidden="true"><span style="width:${item.progressPercent || 0}%"></span></div>
			<div class="loop-meta">${item.current || 0} / ${item.target || 0} • ${escapeHtml(item.rewardLabel || "")}</div>
		`;
		node.appendChild(article);
	});
}

function renderGameRecommendationList(items) {
	gamesRecommendations.innerHTML = "";
	gamesRecommendations.classList.toggle("empty-state", items.length === 0);
	if (!items.length) {
		gamesRecommendations.textContent = "Noch keine Empfehlungen.";
		return;
	}
	items.forEach((item) => {
		const article = document.createElement("article");
		article.className = "loop-item";
		article.innerHTML = `
			<div class="loop-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="loop-tag">${escapeHtml(item.tag || "Hint")}</span>
			</div>
			<p>${escapeHtml(item.copy || "")}</p>
		`;
		gamesRecommendations.appendChild(article);
	});
}

function renderGameCommunityFeed(items) {
	gamesCommunityFeed.innerHTML = "";
	gamesCommunityFeed.classList.toggle("empty-state", items.length === 0);
	if (!items.length) {
		gamesCommunityFeed.textContent = "Noch keine Activity sichtbar.";
		return;
	}
	items.slice(0, 6).forEach((item) => {
		const article = document.createElement("article");
		article.className = "feed-item";
		article.innerHTML = `
			<h3>${escapeHtml(item.title)}</h3>
			<p>${escapeHtml(item.detail || "")}</p>
		`;
		gamesCommunityFeed.appendChild(article);
	});
}

function renderCurrentPlayer() {
	document.querySelector("#current-player-name").textContent = state.currentUser ? state.currentUser.handle : "Kein Spieler aktiv";
	document.querySelector("#current-player-copy").textContent = state.currentUser
		? `Game-Punkte laufen direkt in Platz #${state.currentUser.placement}.`
		: "Logge dich in Connection Quest ein, damit Gewinne und Runs direkt gespeichert werden.";
	document.querySelector("#current-player-score").textContent = String(state.currentUser?.stats.score || 0);
	document.querySelector("#current-player-wins").textContent = String(state.currentUser?.stats.gameWins || 0);
	document.querySelector("#current-player-sessions").textContent = String(state.currentUser?.stats.gameSessions || 0);
	document.querySelector("#current-player-placement").textContent = `#${state.currentUser?.placement || 0}`;
}

function renderSprintHud() {
	document.querySelector("#sprint-hits").textContent = String(state.sprint.hits);
	document.querySelector("#sprint-time").textContent = String(state.sprint.timeLeft);
}

function renderPatternHud() {
	document.querySelector("#pattern-round").textContent = String(state.pattern.round);
	document.querySelector("#pattern-phase").textContent = state.pattern.running ? (state.pattern.locked ? "Watch" : "Repeat") : "Idle";
	patternPads.forEach((pad) => {
		pad.disabled = !state.currentUser || !state.pattern.running || state.pattern.locked;
	});
}

function renderFeed() {
	const node = document.querySelector("#game-feed");
	node.innerHTML = "";
	node.classList.toggle("empty-state", state.feed.length === 0);
	if (!state.feed.length) {
		node.textContent = "Noch keine Game-Rewards in dieser Sitzung.";
		return;
	}

	state.feed.forEach((item) => {
		const article = document.createElement("article");
		article.className = "feed-item";
		article.innerHTML = `
			<h3>${escapeHtml(item.title)}</h3>
			<p>${escapeHtml(item.copy)}</p>
		`;
		node.appendChild(article);
	});
	}

function updateLockState() {
	const locked = !state.currentUser;
	sprintStartButton.disabled = locked || state.sprint.running;
	patternStartButton.disabled = locked || state.pattern.running;
	flashStartButton.disabled = locked || state.reactionFlash.running;
	clashStartButton.disabled = locked || state.colorClash.running;
	sprintTarget.hidden = !state.sprint.running;
	flashOrb.disabled = !state.reactionFlash.flashActive;
	clashChoiceBtns.forEach((btn) => { btn.disabled = !state.colorClash.running; });
	if (!locked) {
		return;
	}
	document.querySelector("#sprint-status").textContent = "Login erforderlich für Sprint-Rewards.";
	document.querySelector("#pattern-status").textContent = "Login erforderlich für Pattern-Rewards.";
	document.querySelector("#flash-status").textContent = "Login erforderlich für Flash-Rewards.";
	document.querySelector("#clash-status").textContent = "Login erforderlich für Clash-Rewards.";
}

function startSprint() {
	if (!state.currentUser || state.sprint.running) {
		return;
	}
	state.sprint.running = true;
	state.sprint.hits = 0;
	state.sprint.timeLeft = 20;
	document.querySelector("#sprint-status").textContent = "Run aktiv.";
	moveSprintTarget();
	renderSprintHud();
	updateLockState();
	state.sprint.intervalId = window.setInterval(async () => {
		state.sprint.timeLeft -= 1;
		renderSprintHud();
		if (state.sprint.timeLeft <= 0) {
			window.clearInterval(state.sprint.intervalId);
			state.sprint.running = false;
			sprintTarget.hidden = true;
			await submitSingleResult("signal-sprint", state.sprint.hits, `Signal Sprint mit ${state.sprint.hits} Hits beendet.`);
			updateLockState();
		}
	}, 1000);
}

function handleSprintHit() {
	if (!state.sprint.running) {
		return;
	}
	state.sprint.hits += 1;
	renderSprintHud();
	moveSprintTarget();
}

function moveSprintTarget() {
	const rect = sprintStage.getBoundingClientRect();
	const left = Math.max(0, Math.floor(Math.random() * Math.max(1, rect.width - 90)));
	const top = Math.max(0, Math.floor(Math.random() * Math.max(1, rect.height - 90)));
	Object.assign(sprintTarget.style, { left: `${left}px`, top: `${top}px` });
	sprintTarget.hidden = false;
}

async function startPattern() {
	if (!state.currentUser || state.pattern.running) {
		return;
	}
	state.pattern.running = true;
	state.pattern.sequence = [];
	state.pattern.playerIndex = 0;
	state.pattern.round = 0;
	document.querySelector("#pattern-status").textContent = "Pattern startet.";
	await nextPatternRound();
}

async function nextPatternRound() {
	state.pattern.round += 1;
	state.pattern.playerIndex = 0;
	state.pattern.sequence.push(Math.floor(Math.random() * 4));
	state.pattern.locked = true;
	renderPatternHud();
	await playPatternSequence();
	state.pattern.locked = false;
	renderPatternHud();
	}

async function playPatternSequence() {
	for (const step of state.pattern.sequence) {
		setPadActive(step, true);
		await wait(420);
		setPadActive(step, false);
		await wait(160);
	}
	}

async function handlePatternInput(index) {
	if (!state.pattern.running || state.pattern.locked) {
		return;
	}
	setPadActive(index, true);
	window.setTimeout(() => setPadActive(index, false), 140);

	if (state.pattern.sequence[state.pattern.playerIndex] !== index) {
		const completedRounds = Math.max(0, state.pattern.round - 1);
		state.pattern.running = false;
		state.pattern.locked = false;
		document.querySelector("#pattern-status").textContent = `Fehler in Runde ${state.pattern.round}.`;
		renderPatternHud();
		await submitSingleResult("pattern-pulse", completedRounds, `Pattern Pulse bis Runde ${completedRounds}.`);
		updateLockState();
		return;
	}

	state.pattern.playerIndex += 1;
	if (state.pattern.playerIndex === state.pattern.sequence.length) {
		document.querySelector("#pattern-status").textContent = `Runde ${state.pattern.round} geschafft.`;
		if (state.pattern.round >= 12) {
			state.pattern.running = false;
			state.pattern.locked = false;
			renderPatternHud();
			await submitSingleResult("pattern-pulse", state.pattern.round, `Pattern Pulse perfekt mit ${state.pattern.round} Runden.`);
			updateLockState();
			return;
		}
		await wait(500);
		await nextPatternRound();
	}
	}

async function submitSingleResult(gameType, rawScore, summary) {
	const STATUS_IDS = {
		"signal-sprint":  "#sprint-status",
		"pattern-pulse":  "#pattern-status",
		"reaction-flash": "#flash-status",
		"color-clash":    "#clash-status",
	};
	const GAME_LABELS = {
		"signal-sprint":  "Signal Sprint",
		"pattern-pulse":  "Pattern Pulse",
		"reaction-flash": "Reaction Flash",
		"color-clash":    "Color Clash",
	};
	const statusId = STATUS_IDS[gameType] || "#sprint-status";
	const gameLabel = GAME_LABELS[gameType] || gameType;
	try {
		const payload = await apiRequest("/api/cq/games/single", {
			method: "POST",
			body: { gameType, rawScore, summary },
		});
		await applyCurrentUser(payload.currentUser);
		const rewardText = `+${payload.rewards.score} Score • +${payload.rewards.xp} XP`;
		document.querySelector(statusId).textContent = `${summary} ${rewardText}`;
		pushFeed(gameLabel, `${summary} ${rewardText}`);
	} catch (error) {
		document.querySelector(statusId).textContent = error.message;
	}
	}

async function applyCurrentUser(currentUser) {
	state.currentUser = currentUser;
	await hydrate();
	renderAll();
}

function setPadActive(index, isActive) {
	patternPads[index]?.classList.toggle("is-active", isActive);
}

function pushFeed(title, copy) {
	state.feed.unshift({ title, copy });
	state.feed = state.feed.slice(0, 6);
	renderFeed();
}

async function apiRequest(url, options = {}) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = {
		"Content-Type": "application/json",
		...(options.headers || {}),
	};
	if (sessionToken) {
		headers.Authorization = `Bearer ${sessionToken}`;
	}

	const response = await fetch(url, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Game-Anfrage konnte nicht verarbeitet werden.");
	}
	return payload;
}

function wait(duration) {
	return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

// ── Reaction Flash ──────────────────────────────────────────

async function startReactionFlash() {
	if (!state.currentUser || state.reactionFlash.running) {
		return;
	}
	state.reactionFlash.running = true;
	state.reactionFlash.round = 0;
	state.reactionFlash.succeeded = 0;
	state.reactionFlash.flashActive = false;
	document.querySelector("#flash-status").textContent = "Mach dich bereit…";
	renderFlashHud();
	updateLockState();
	await nextFlashRound();
}

async function nextFlashRound() {
	if (state.reactionFlash.round >= 5) {
		const score = state.reactionFlash.succeeded;
		state.reactionFlash.running = false;
		state.reactionFlash.flashActive = false;
		flashOrb.className = "flash-orb";
		flashOrb.textContent = "WARTEN…";
		renderFlashHud();
		await submitSingleResult("reaction-flash", score, `Reaction Flash: ${score} von 5 getroffen.`);
		updateLockState();
		return;
	}
	state.reactionFlash.round += 1;
	state.reactionFlash.flashActive = false;
	flashOrb.className = "flash-orb flash-wait";
	flashOrb.textContent = "WARTEN…";
	flashOrb.disabled = true;
	renderFlashHud();

	const delay = 1500 + Math.random() * 2000;
	state.reactionFlash.timeoutId = window.setTimeout(() => {
		if (!state.reactionFlash.running) {
			return;
		}
		state.reactionFlash.flashActive = true;
		state.reactionFlash.startTime = Date.now();
		flashOrb.className = "flash-orb flash-go";
		flashOrb.textContent = "JETZT!";
		flashOrb.disabled = false;
		// auto-fail if player doesn’t react within 2s
		state.reactionFlash.timeoutId = window.setTimeout(async () => {
			if (!state.reactionFlash.running || !state.reactionFlash.flashActive) {
				return;
			}
			state.reactionFlash.flashActive = false;
			flashOrb.disabled = true;
			document.querySelector("#flash-status").textContent = `Runde ${state.reactionFlash.round}: Zu langsam!`;
			await nextFlashRound();
		}, 2000);
	}, delay);
}

async function handleFlashClick() {
	if (!state.reactionFlash.running || !state.reactionFlash.flashActive) {
		return;
	}
	const reactionMs = Date.now() - state.reactionFlash.startTime;
	window.clearTimeout(state.reactionFlash.timeoutId);
	state.reactionFlash.flashActive = false;
	flashOrb.disabled = true;
	flashOrb.className = "flash-orb flash-wait";
	if (reactionMs <= 800) {
		state.reactionFlash.succeeded += 1;
		document.querySelector("#flash-status").textContent = `Runde ${state.reactionFlash.round}: ${reactionMs}ms ✔`;
	} else {
		document.querySelector("#flash-status").textContent = `Runde ${state.reactionFlash.round}: ${reactionMs}ms – zu langsam!`;
	}
	renderFlashHud();
	await wait(600);
	await nextFlashRound();
}

function renderFlashHud() {
	document.querySelector("#flash-round").textContent = `${state.reactionFlash.round} / 5`;
	document.querySelector("#flash-hits").textContent = String(state.reactionFlash.succeeded);
}

// ── Color Clash ─────────────────────────────────────────────

const CLASH_COLORS = [
	{ id: "rot",  label: "ROT",  hex: "#ff4757" },
	{ id: "blau", label: "BLAU", hex: "#1e90ff" },
	{ id: "grün", label: "GRÜN", hex: "#2ed573" },
	{ id: "gelb", label: "GELB", hex: "#ffa502" },
];

function nextClashWord() {
	const wordIdx = Math.floor(Math.random() * CLASH_COLORS.length);
	let inkIdx;
	do {
		inkIdx = Math.floor(Math.random() * CLASH_COLORS.length);
	} while (inkIdx === wordIdx);
	state.colorClash.correctColor = CLASH_COLORS[inkIdx].id;
	const wordEl = document.querySelector("#clash-word");
	wordEl.textContent = CLASH_COLORS[wordIdx].label;
	wordEl.style.color = CLASH_COLORS[inkIdx].hex;
}

async function startColorClash() {
	if (!state.currentUser || state.colorClash.running) {
		return;
	}
	state.colorClash.running = true;
	state.colorClash.score = 0;
	state.colorClash.timeLeft = 25;
	document.querySelector("#clash-status").textContent = "Run aktiv.";
	renderClashHud();
	updateLockState();
	nextClashWord();
	state.colorClash.intervalId = window.setInterval(async () => {
		state.colorClash.timeLeft -= 1;
		renderClashHud();
		if (state.colorClash.timeLeft <= 0) {
			window.clearInterval(state.colorClash.intervalId);
			state.colorClash.running = false;
			document.querySelector("#clash-word").textContent = "";
			document.querySelector("#clash-word").style.color = "";
			renderClashHud();
			await submitSingleResult("color-clash", state.colorClash.score, `Color Clash: ${state.colorClash.score} richtige Antworten.`);
			updateLockState();
		}
	}, 1000);
}

function handleClashChoice(color) {
	if (!state.colorClash.running) {
		return;
	}
	if (color === state.colorClash.correctColor) {
		state.colorClash.score += 1;
		renderClashHud();
	}
	nextClashWord();
}

function renderClashHud() {
	document.querySelector("#clash-score").textContent = String(state.colorClash.score);
	document.querySelector("#clash-time").textContent = String(state.colorClash.timeLeft);
}