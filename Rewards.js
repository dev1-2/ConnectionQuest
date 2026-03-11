const SESSION_KEY = "connection-quest-session-token-v1";

const REWARD_DEFINITIONS = [
	{ id: "title-rookie", name: "Title: Rookie Signal", requirement: (stats) => stats.totalEntries >= 1, copy: "Erster Log im Netz.", category: "Title" },
	{ id: "title-streak", name: "Title: Streak Driver", requirement: (stats) => stats.currentStreak >= 5, copy: "Fuer konstante taegliche Rueckkehr.", category: "Title" },
	{ id: "theme-arcade", name: "Theme: Arcade Pulse", requirement: (stats) => (stats.gameWins || 0) >= 3, copy: "Arcade-Fokus sichtbar machen.", category: "Theme" },
	{ id: "theme-network", name: "Theme: Network Gold", requirement: (stats) => stats.uniqueConnections >= 5, copy: "Viele verschiedene Connections geloggt.", category: "Theme" },
	{ id: "prestige-board", name: "Prestige: Board Pressure", requirement: (_stats, currentUser) => (currentUser?.placement || 99) <= 3, copy: "Top 3 im Ranking erreicht.", category: "Prestige" },
	{ id: "prestige-legend", name: "Prestige: Legend Path", requirement: (stats) => stats.level >= 5, copy: "Level 5 oder hoeher erreicht.", category: "Prestige" },
];

initialize();

async function initialize() {
	try {
		const [sessionPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/session"),
			apiRequest("/api/cq/pulse"),
		]);
		renderRewards(sessionPayload.currentUser, pulsePayload || {});
	} catch (error) {
		renderRewards(null, {});
		document.querySelector("#rewards-copy").textContent = error.message;
	}
}

function renderRewards(currentUser, pulse) {
	const stats = currentUser?.stats || buildEmptyStats();
	document.querySelector("#rewards-player").textContent = currentUser?.handle || "Kein Spieler aktiv";
	document.querySelector("#rewards-copy").textContent = currentUser
		? `${currentUser.handle} hat ${stats.unlockedAchievements} Badges und kann daraus weitere Status-Rewards ableiten.`
		: "Mit aktivem Spieler zeigen sich hier deine freischaltbaren Titel, kosmetischen Statuswerte und naechsten Unlocks.";
	renderVault(stats, currentUser);
	renderRewardsLists(stats, currentUser);
	renderPrestige(stats, currentUser, pulse);
}

function renderVault(stats, currentUser) {
	const node = document.querySelector("#vault-stats");
	node.innerHTML = "";
	[
		{ label: "Score", value: stats.score },
		{ label: "Level", value: stats.level },
		{ label: "Game Wins", value: stats.gameWins || 0 },
		{ label: "Platz", value: `#${currentUser?.placement || 0}` },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderRewardsLists(stats, currentUser) {
	const owned = REWARD_DEFINITIONS.filter((reward) => reward.requirement(stats, currentUser));
	const locked = REWARD_DEFINITIONS.filter((reward) => !reward.requirement(stats, currentUser));
	renderRewardGrid("#owned-rewards", owned, true, "Noch keine Rewards sichtbar.");
	renderRewardGrid("#locked-rewards", locked, false, "Noch keine kommenden Rewards sichtbar.");
}

function renderRewardGrid(selector, items, owned, emptyCopy) {
	const node = document.querySelector(selector);
	if (!items.length) {
		node.classList.add("empty-state");
		node.textContent = emptyCopy;
		return;
	}
	node.classList.remove("empty-state");
	node.innerHTML = "";
	items.forEach((item) => {
		const card = document.createElement("article");
		card.className = "reward-item";
		card.innerHTML = `
			<div class="reward-head">
				<h3>${escapeHtml(item.name)}</h3>
				<span class="reward-tag${owned ? " is-owned" : ""}">${owned ? "Owned" : escapeHtml(item.category)}</span>
			</div>
			<p>${escapeHtml(item.copy)}</p>
		`;
		node.appendChild(card);
	});
}

function renderPrestige(stats, currentUser, pulse) {
	const node = document.querySelector("#prestige-list");
	node.innerHTML = "";
	[
		{ name: "Momentum Rank", copy: `${(pulse.missions || []).filter((item) => item.completed).length} Daily Clears heute`, category: "Loop" },
		{ name: "Weekly Pressure", copy: `${(pulse.weeklyChallenges || []).filter((item) => !item.completed).length} Weekly-Ziele offen`, category: "Weekly" },
		{ name: "Board Status", copy: `Platz #${currentUser?.placement || 0}`, category: "Board" },
		{ name: "Journal Identity", copy: `${stats.uniqueConnections} Connections geloggt`, category: "Journal" },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "reward-item";
		card.innerHTML = `<div class="reward-head"><h3>${escapeHtml(item.name)}</h3><span class="reward-tag">${escapeHtml(item.category)}</span></div><p>${escapeHtml(item.copy)}</p>`;
		node.appendChild(card);
	});
}

function buildEmptyStats() {
	return { score: 0, level: 1, totalEntries: 0, currentStreak: 0, gameWins: 0, uniqueConnections: 0, unlockedAchievements: 0 };
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Rewards konnten nicht geladen werden.");
	}
	return payload;
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}