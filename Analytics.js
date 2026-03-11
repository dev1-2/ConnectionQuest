const ANALYTICS_SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const [leaderboardPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/leaderboard"),
			apiRequest("/api/cq/pulse"),
		]);
		renderAnalytics(leaderboardPayload.leaderboard || [], pulsePayload || {});
	} catch (error) {
		renderAnalytics([], {});
		document.querySelector("#analytics-copy").textContent = error.message;
	}
}

function renderAnalytics(leaderboard, pulse) {
	const stats = pulse.communityStats || {};
	document.querySelector("#analytics-title").textContent = leaderboard.length ? `${leaderboard.length} Profile im System` : "Keine Signale";
	document.querySelector("#analytics-copy").textContent = leaderboard.length
		? `Die Plattform zeigt ${stats.entriesToday || 0} Logs heute, ${stats.games7d || 0} Games in 7 Tagen und ${stats.activePlayers7d || 0} aktive Spieler in der letzten Woche.`
		: "Sobald genug Daten vorliegen, zeigt dieser Bereich Produkt- und Aktivitaetsmuster statt nur rohe Listen.";
	renderTopline(stats, leaderboard);
	renderStats(stats, leaderboard);
	renderSegments(leaderboard);
	renderRetention(pulse, leaderboard);
}

function renderTopline(stats, leaderboard) {
	const node = document.querySelector("#analytics-topline");
	node.innerHTML = "";
	[
		{ label: "Top Score", value: leaderboard[0]?.stats.score || 0 },
		{ label: "Top Streak", value: leaderboard.reduce((max, item) => Math.max(max, item.stats.currentStreak || 0), 0) },
		{ label: "Top Wins", value: leaderboard.reduce((max, item) => Math.max(max, item.stats.gameWins || 0), 0) },
		{ label: "Aktiv 7 Tage", value: stats.activePlayers7d || 0 },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderStats(stats, leaderboard) {
	const node = document.querySelector("#analytics-stats");
	node.innerHTML = "";
	const totalScore = leaderboard.reduce((sum, item) => sum + (item.stats.score || 0), 0);
	const totalGames = leaderboard.reduce((sum, item) => sum + (item.stats.gameSessions || 0), 0);
	const totalEntries = leaderboard.reduce((sum, item) => sum + (item.stats.totalEntries || 0), 0);
	[
		{ label: "Total Score", value: totalScore },
		{ label: "Total Games", value: totalGames },
		{ label: "Total Logs", value: totalEntries },
		{ label: "Avg Score", value: leaderboard.length ? Math.round(totalScore / leaderboard.length) : 0 },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "metric-item";
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderSegments(leaderboard) {
	const node = document.querySelector("#analytics-segments");
	node.innerHTML = "";
	const journalHeavy = leaderboard.filter((item) => (item.stats.totalEntries || 0) > ((item.stats.gameSessions || 0) * 2)).length;
	const arcadeHeavy = leaderboard.filter((item) => (item.stats.gameSessions || 0) > (item.stats.totalEntries || 0)).length;
	const balanced = leaderboard.length - journalHeavy - arcadeHeavy;
	[
		{ title: "Journal Heavy", copy: `${journalHeavy} Profile setzen staerker auf Logs als auf Games.` },
		{ title: "Arcade Heavy", copy: `${arcadeHeavy} Profile holen ihren Druck eher aus Games und Duels.` },
		{ title: "Balanced Users", copy: `${Math.max(0, balanced)} Profile nutzen Journal und Games relativ gemischt.` },
		{ title: "Competitive Core", copy: `${leaderboard.filter((item) => (item.stats.currentStreak || 0) >= 3 || (item.stats.gameWins || 0) >= 3).length} Profile zeigen klaren Wiederkehrdruck.` },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "panel-item";
		card.innerHTML = `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.copy)}</p>`;
		node.appendChild(card);
	});
}

function renderRetention(pulse, leaderboard) {
	const node = document.querySelector("#analytics-retention");
	node.innerHTML = "";
	[
		{ title: "Daily Loops", copy: `${(pulse.missions || []).length} taegliche Missionstypen erzeugen Kurzfristdruck und Rueckkehrgruende.` },
		{ title: "Weekly Loops", copy: `${(pulse.weeklyChallenges || []).length} woechentliche Ziele halten Nutzer laenger im System.` },
		{ title: "Feed Pressure", copy: `${(pulse.activityFeed || []).length} Feed-Signale erhoehen soziale Sichtbarkeit und FOMO.` },
		{ title: "Ranking Tension", copy: `${leaderboard.filter((item) => (item.placement || 99) <= 5).length} Profile sitzen aktuell im sichtbaren Top-Bereich.` },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "panel-item";
		card.innerHTML = `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.copy)}</p>`;
		node.appendChild(card);
	});
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(ANALYTICS_SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Analytics konnten nicht geladen werden.");
	}
	return payload;
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}