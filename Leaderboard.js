const SESSION_KEY = "connection-quest-session-token-v1";

const state = {
	leaderboard: [],
	currentUserId: "",
	pulseData: {
		highlights: {},
		activityFeed: [],
	},
	searchTerm: "",
	sortMode: "score",
};

document.querySelector("#leaderboard-search").addEventListener("input", (event) => {
	state.searchTerm = event.target.value.trim().toLowerCase();
	renderLeaderboardPage();
});

document.querySelector("#leaderboard-sort").addEventListener("change", (event) => {
	state.sortMode = event.target.value;
	renderLeaderboardPage();
});

initialize();

async function initialize() {
	try {
		const [leaderboardPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/leaderboard"),
			apiRequest("/api/cq/pulse"),
		]);
		state.leaderboard = leaderboardPayload.leaderboard || [];
		state.currentUserId = leaderboardPayload.currentUserId || "";
		state.pulseData = pulsePayload || state.pulseData;
		renderLeaderboardPage();
	} catch (error) {
		const list = document.querySelector("#leaderboard-list");
		list.textContent = error.message;
		list.classList.add("empty-state");
	}
}

function renderLeaderboardPage() {
	renderCurrentPlayer(state.leaderboard, state.currentUserId);
	renderSummary(state.leaderboard);
	renderPodium(state.leaderboard, state.currentUserId);
	renderHighlights(state.pulseData.highlights || {});
	renderFeed(state.pulseData.activityFeed || []);
	renderList(getFilteredRankedUsers(), state.currentUserId);
}

function renderCurrentPlayer(rankedUsers, currentUserId) {
	const current = rankedUsers.find((entry) => entry.id === currentUserId);
	const nameEl = document.querySelector("#current-player-name");
	const copyEl = document.querySelector("#current-player-copy");
	const scoreEl = document.querySelector("#current-player-score");
	const levelEl = document.querySelector("#current-player-level");
	const rankEl = document.querySelector("#current-player-rank");
	const rivalBanner = document.querySelector("#rivalry-banner");

	nameEl.textContent = current ? current.handle.toUpperCase() : "KEIN SPIELER AKTIV";
	copyEl.textContent = current
		? `EREBOS hat dich lokalisiert. Du stehst auf Platz #${current.placement} der Hierarchie.`
		: "Betritt das Spiel, um deinen Rang in der Hierarchie zu sehen.";
	scoreEl.textContent = String(current?.stats.score || 0);
	levelEl.textContent = String(toRomanNumeral(current?.stats.level || 1));
	rankEl.textContent = current ? `#${current.placement}` : "—";

	if (current && rivalBanner) {
		rivalBanner.hidden = false;
		const idx = rankedUsers.findIndex((e) => e.id === currentUserId);
		const above = rankedUsers[idx - 1];
		const below = rankedUsers[idx + 1];

		const aboveNameEl = document.querySelector("#rival-above-name");
		const aboveGapEl = document.querySelector("#rival-above-gap");
		const belowNameEl = document.querySelector("#rival-below-name");
		const belowGapEl = document.querySelector("#rival-below-gap");

		if (aboveNameEl) aboveNameEl.textContent = above ? above.handle.toUpperCase() : "NIEMAND DARÜBER";
		if (aboveGapEl && above) aboveGapEl.textContent = `${above.stats.score - current.stats.score} MACHT ÜBERLEGEN`;
		if (aboveGapEl && !above) aboveGapEl.textContent = "DU BIST AN DER SPITZE";

		if (belowNameEl) belowNameEl.textContent = below ? below.handle.toUpperCase() : "NIEMAND DARUNTER";
		if (belowGapEl && below) belowGapEl.textContent = `${current.stats.score - below.stats.score} MACHT VOR IHM`;
		if (belowGapEl && !below) belowGapEl.textContent = "DU BIST AM BODEN DER HIERARCHIE";
	} else if (rivalBanner) {
		rivalBanner.hidden = true;
	}
}

function toRomanNumeral(n) {
	const map = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
	let result = "";
	for (const [val, sym] of map) {
		while (n >= val) { result += sym; n -= val; }
	}
	return result || "I";
}

function renderSummary(rankedUsers) {
	const totalLogs = rankedUsers.reduce((sum, entry) => sum + entry.stats.totalEntries, 0);
	document.querySelector("#player-count").textContent = String(rankedUsers.length);
	document.querySelector("#top-score").textContent = String(rankedUsers[0]?.stats.score || 0);
	document.querySelector("#top-level").textContent = String(rankedUsers.reduce((max, entry) => Math.max(max, entry.stats.level), 1));
	document.querySelector("#total-logs").textContent = String(totalLogs);
}

function renderPodium(rankedUsers, currentUserId) {
	const podium = document.querySelector("#podium");
	podium.innerHTML = "";
	podium.classList.toggle("empty-state", rankedUsers.length === 0);

	if (!rankedUsers.length) {
		podium.textContent = "EREBOS hat noch niemanden als würdig eingestuft.";
		return;
	}

	rankedUsers.slice(0, 3).forEach((entry) => {
		const item = document.createElement("article");
		item.className = `podium-item${entry.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<strong class="podium-rank">#${entry.placement}</strong>
			<div class="podium-copy">
				<h3>${escapeHtml(entry.handle.toUpperCase())}</h3>
				<p>${entry.stats.score} MACHT • RANG ${toRomanNumeral(entry.stats.level)}</p>
				<p>${entry.stats.totalEntries} ZÜGE • ${entry.stats.gameWins || 0} ARENAKAMPF-SIEGE • ${entry.stats.unlockedAchievements} PRÜFUNGEN</p>
			</div>
		`;
		podium.appendChild(item);
	});
}

function renderHighlights(highlights) {
	const node = document.querySelector("#leaderboard-highlights");
	const items = [highlights.scoreLeader, highlights.streakLeader, highlights.gameLeader].filter(Boolean);
	node.innerHTML = "";
	node.classList.toggle("empty-state", items.length === 0);

	if (!items.length) {
		node.textContent = "EREBOS hat noch keinen Fokus gesetzt.";
		return;
	}

	items.forEach((item) => {
		const card = document.createElement("article");
		card.className = "highlight-item";
		card.innerHTML = `
			<h3>${escapeHtml(item.handle)}</h3>
			<p>${escapeHtml(item.label)}</p>
			<strong>${item.value}</strong>
		`;
		node.appendChild(card);
	});
}

function renderFeed(feedItems) {
	const node = document.querySelector("#leaderboard-feed");
	node.innerHTML = "";
	node.classList.toggle("empty-state", feedItems.length === 0);

	if (!feedItems.length) {
		node.textContent = "Keine aktuellen Bewegungen. Das Netzwerk ist still.";
		return;
	}

	feedItems.forEach((item) => {
		const card = document.createElement("article");
		card.className = "feed-item";
		card.innerHTML = `
			<div class="feed-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="feed-tag">${item.type === "game" ? "ARENA" : "PROTOKOLL"}</span>
			</div>
			<p>${escapeHtml(item.detail || "")}</p>
			<p>${formatRelativeTime(item.occurredAt)}</p>
		`;
		node.appendChild(card);
	});
}

function renderList(rankedUsers, currentUserId) {
	const list = document.querySelector("#leaderboard-list");
	list.innerHTML = "";
	list.classList.toggle("empty-state", rankedUsers.length === 0);

	if (!rankedUsers.length) {
		list.textContent = state.searchTerm ? "EREBOS findet niemanden unter diesem Namen." : "Die Hierarchie ist leer. EREBOS wartet.";
		return;
	}

	rankedUsers.forEach((entry) => {
		const item = document.createElement("article");
		item.className = `leaderboard-item${entry.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<div class="leaderboard-rank">#${entry.placement}</div>
			<div class="leaderboard-copy">
				<h3>${escapeHtml(entry.handle.toUpperCase())}</h3>
				<p>RANG ${toRomanNumeral(entry.stats.level)} • ${entry.stats.xp} XP • ${entry.stats.currentStreak} TAGE AUSDAUER • ${entry.stats.gameScore || 0} ARENAKAMPF-PUNKTE</p>
				<p>${entry.stats.totalEntries} ZÜGE • ${entry.stats.uniqueConnections} EINFLUSS • ${entry.stats.gameSessions || 0} ARENA-SESSIONS • ${entry.stats.gameWins || 0} SIEGE • ${entry.loginCount} LOGINS</p>
			</div>
			<div class="leaderboard-score">${entry.stats.score}</div>
		`;
		list.appendChild(item);
	});
}

function getFilteredRankedUsers() {
	const filtered = state.leaderboard.filter((entry) => entry.handle.toLowerCase().includes(state.searchTerm));
	return filtered.slice().sort(compareBySortMode(state.sortMode));
}

function compareBySortMode(mode) {
	if (mode === "streak") {
		return (left, right) => compareNumbers(right.stats.currentStreak, left.stats.currentStreak)
			|| compareNumbers(right.stats.score, left.stats.score)
			|| compareNumbers(left.placement, right.placement);
	}
	if (mode === "games") {
		return (left, right) => compareNumbers(right.stats.gameWins || 0, left.stats.gameWins || 0)
			|| compareNumbers(right.stats.gameScore || 0, left.stats.gameScore || 0)
			|| compareNumbers(left.placement, right.placement);
	}
	if (mode === "logins") {
		return (left, right) => compareNumbers(right.loginCount, left.loginCount)
			|| compareNumbers(right.stats.score, left.stats.score)
			|| compareNumbers(left.placement, right.placement);
	}
	if (mode === "entries") {
		return (left, right) => compareNumbers(right.stats.totalEntries, left.stats.totalEntries)
			|| compareNumbers(right.stats.uniqueConnections, left.stats.uniqueConnections)
			|| compareNumbers(right.stats.score, left.stats.score)
			|| compareNumbers(left.placement, right.placement);
	}
	return (left, right) => compareNumbers(right.stats.score, left.stats.score)
		|| compareNumbers(right.stats.xp, left.stats.xp)
		|| compareNumbers(left.placement, right.placement);
}

function compareNumbers(left, right) {
	return Number(left) - Number(right);
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Leaderboard konnte nicht geladen werden.");
	}
	return payload;
}

function formatRelativeTime(value) {
	if (!value) {
		return "Gerade eben";
	}

	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp)) {
		return "Gerade eben";
	}

	const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
	if (diffMinutes < 1) {
		return "Gerade eben";
	}
	if (diffMinutes < 60) {
		return `vor ${diffMinutes} Min.`;
	}
	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 24) {
		return `vor ${diffHours} Std.`;
	}
	const diffDays = Math.round(diffHours / 24);
	return `vor ${diffDays} Tag${diffDays === 1 ? "" : "en"}`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}