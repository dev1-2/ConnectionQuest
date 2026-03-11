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
	duel: {
		arming: false,
		goLive: false,
		timeoutId: null,
	},
};

const opponentSelect = document.querySelector("#duel-opponent");
const duelStartButton = document.querySelector("#duel-start");
const duelStatus = document.querySelector("#duel-status");
const duelSignal = document.querySelector("#duel-signal");
const sprintStartButton = document.querySelector("#sprint-start");
const sprintTarget = document.querySelector("#sprint-target");
const sprintStage = document.querySelector("#sprint-stage");
const patternStartButton = document.querySelector("#pattern-start");
const patternPads = Array.from(document.querySelectorAll(".pattern-pad"));
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
	duelStartButton.addEventListener("click", startDuel);
	sprintStartButton.addEventListener("click", startSprint);
	sprintTarget.addEventListener("click", handleSprintHit);
	patternStartButton.addEventListener("click", startPattern);
	patternPads.forEach((pad) => {
		pad.addEventListener("click", () => handlePatternInput(Number(pad.dataset.pad)));
	});
	document.addEventListener("keydown", handleDuelKeydown);
	opponentSelect.addEventListener("change", renderDuelNames);
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
	renderOpponents();
	renderDuelNames();
	renderSprintHud();
	renderPatternHud();
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

function renderOpponents() {
	const options = state.leaderboard.filter((entry) => entry.id !== state.currentUserId);
	opponentSelect.innerHTML = "";
	if (!options.length) {
		const option = document.createElement("option");
		option.value = "";
		option.textContent = "Kein Gegner verfügbar";
		opponentSelect.appendChild(option);
		return;
	}

	options.forEach((entry) => {
		const option = document.createElement("option");
		option.value = entry.id;
		option.textContent = `${entry.handle} • Platz #${entry.placement}`;
		opponentSelect.appendChild(option);
	});
}

function renderDuelNames() {
	document.querySelector("#duel-left-name").textContent = state.currentUser?.handle || "Du";
	const opponent = getSelectedOpponent();
	document.querySelector("#duel-right-name").textContent = opponent?.handle || "Gegner";
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
	duelStartButton.disabled = locked || !getSelectedOpponent();
	sprintStartButton.disabled = locked || state.sprint.running;
	patternStartButton.disabled = locked || state.pattern.running;
	opponentSelect.disabled = locked || !getSelectedOpponent();
	sprintTarget.hidden = !state.sprint.running;
	if (!locked) {
		return;
	}
	duelStatus.textContent = "Login erforderlich für Duel-Rewards.";
	document.querySelector("#sprint-status").textContent = "Login erforderlich für Sprint-Rewards.";
	document.querySelector("#pattern-status").textContent = "Login erforderlich für Pattern-Rewards.";
}

async function startDuel() {
	if (!state.currentUser) {
		return;
	}
	const opponent = getSelectedOpponent();
	if (!opponent) {
		duelStatus.textContent = "Erst einen Gegner wählen.";
		return;
	}
	if (state.duel.arming || state.duel.goLive) {
		return;
	}

	state.duel.arming = true;
	state.duel.goLive = false;
	duelSignal.textContent = "Warte...";
	duelStatus.textContent = `Duel wird gegen ${opponent.handle} geladen.`;
	state.duel.timeoutId = window.setTimeout(() => {
		state.duel.goLive = true;
		state.duel.arming = false;
		duelSignal.textContent = "GO";
		duelStatus.textContent = "Jetzt A oder L drücken.";
	}, 1400 + Math.floor(Math.random() * 2200));
	updateLockState();
}

async function handleDuelKeydown(event) {
	if (!state.currentUser || (!state.duel.arming && !state.duel.goLive)) {
		return;
	}
	const key = event.key.toLowerCase();
	if (key !== "a" && key !== "l") {
		return;
	}

	const opponent = getSelectedOpponent();
	if (!opponent) {
		return;
	}

	if (state.duel.arming && !state.duel.goLive) {
		const winnerId = key === "a" ? opponent.id : state.currentUser.id;
		await submitDuelResult(winnerId, `Fehlstart von ${key === "a" ? state.currentUser.handle : opponent.handle}`);
		return;
	}

	if (state.duel.goLive) {
		const winnerId = key === "a" ? state.currentUser.id : opponent.id;
		await submitDuelResult(winnerId, `${key === "a" ? state.currentUser.handle : opponent.handle} war schneller.`);
	}
	}

async function submitDuelResult(winnerPlayerId, summary) {
	window.clearTimeout(state.duel.timeoutId);
	state.duel.arming = false;
	state.duel.goLive = false;
	const opponent = getSelectedOpponent();
	try {
		const payload = await apiRequest("/api/cq/games/duel", {
			method: "POST",
			body: {
				gameType: "reaction-duel",
				opponentPlayerId: opponent.id,
				winnerPlayerId,
				summary,
			},
		});
		await applyCurrentUser(payload.currentUser);
		const winnerName = winnerPlayerId === state.currentUser.id ? state.currentUser.handle : opponent.handle;
		duelSignal.textContent = winnerName;
		duelStatus.textContent = `${winnerName} gewinnt das Duel.`;
		pushFeed("Reaction Duel", `${summary} Reward gespeichert und ins Leaderboard übertragen.`);
	} catch (error) {
		duelSignal.textContent = "ERROR";
		duelStatus.textContent = error.message;
	}
	updateLockState();
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
	try {
		const payload = await apiRequest("/api/cq/games/single", {
			method: "POST",
			body: { gameType, rawScore, summary },
		});
		await applyCurrentUser(payload.currentUser);
		const gameLabel = gameType === "signal-sprint" ? "Signal Sprint" : "Pattern Pulse";
		const rewardText = `+${payload.rewards.score} Score • +${payload.rewards.xp} XP`;
		const statusId = gameType === "signal-sprint" ? "#sprint-status" : "#pattern-status";
		document.querySelector(statusId).textContent = `${summary} ${rewardText}`;
		pushFeed(gameLabel, `${summary} ${rewardText}`);
	} catch (error) {
		const statusId = gameType === "signal-sprint" ? "#sprint-status" : "#pattern-status";
		document.querySelector(statusId).textContent = error.message;
	}
	}

async function applyCurrentUser(currentUser) {
	state.currentUser = currentUser;
	await hydrate();
	renderAll();
}

function getSelectedOpponent() {
	return state.leaderboard.find((entry) => entry.id === opponentSelect.value) || null;
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