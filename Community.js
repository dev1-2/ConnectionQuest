const SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const [leaderboardPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/leaderboard"),
			apiRequest("/api/cq/pulse"),
		]);
		renderCommunity(leaderboardPayload.leaderboard || [], pulsePayload || {});
	} catch (error) {
		renderCommunity([], {});
		document.querySelector("#community-copy").textContent = error.message;
	}
}

function renderCommunity(leaderboard, pulse) {
	const stats = pulse.communityStats || {};
	document.querySelector("#community-title").textContent = stats.playerCount ? `${stats.playerCount} Profile im Netz` : "Kein Live-Puls";
	document.querySelector("#community-copy").textContent = stats.playerCount
		? `${stats.entriesToday || 0} Logs heute, ${stats.games7d || 0} Games in 7 Tagen und ${stats.activePlayers7d || 0} aktive Spieler in der letzten Woche.`
		: "Die Community-Dichte erscheint hier, sobald Profile, Logs und Games vorhanden sind.";

	renderTopline(stats, pulse.highlights || {});
	renderStatsGrid(stats);
	renderLeaders(leaderboard);
	renderFeed(pulse.activityFeed || []);
	renderBoards(leaderboard);
}

function renderTopline(stats, highlights) {
	const node = document.querySelector("#community-topline");
	node.innerHTML = "";
	[
		{ label: "Aktiv 7 Tage", value: stats.activePlayers7d || 0 },
		{ label: "Top Score", value: highlights.scoreLeader?.handle || "-" },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderStatsGrid(stats) {
	const node = document.querySelector("#community-stats-grid");
	node.innerHTML = "";
	[
		{ label: "Spieler", value: stats.playerCount || 0 },
		{ label: "Logs heute", value: stats.entriesToday || 0 },
		{ label: "Logs 7 Tage", value: stats.entries7d || 0 },
		{ label: "Games 7 Tage", value: stats.games7d || 0 },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "stat-item";
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${item.value}</strong>`;
		node.appendChild(card);
	});
}

function renderLeaders(leaderboard) {
	const node = document.querySelector("#community-leaders");
	node.innerHTML = "";
	const leaders = [
		makeLeader("Score Leader", leaderboard[0]),
		makeLeader("Streak Leader", leaderboard.slice().sort((a, b) => (b.stats.currentStreak || 0) - (a.stats.currentStreak || 0))[0]),
		makeLeader("Game Leader", leaderboard.slice().sort((a, b) => (b.stats.gameWins || 0) - (a.stats.gameWins || 0))[0]),
		makeLeader("Journal Leader", leaderboard.slice().sort((a, b) => (b.stats.totalEntries || 0) - (a.stats.totalEntries || 0))[0]),
	].filter(Boolean);

	if (!leaders.length) {
		node.classList.add("empty-state");
		node.textContent = "Noch keine Leader sichtbar.";
		return;
	}

	node.classList.remove("empty-state");
	leaders.forEach((item) => {
		const card = document.createElement("article");
		card.className = "leader-item";
		card.innerHTML = `
			<div class="item-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="item-tag">${escapeHtml(item.tag)}</span>
			</div>
			<p>${escapeHtml(item.copy)}</p>
		`;
		node.appendChild(card);
	});
}

function renderFeed(items) {
	const node = document.querySelector("#community-feed");
	node.innerHTML = "";
	node.classList.toggle("empty-state", items.length === 0);
	if (!items.length) {
		node.textContent = "Noch keine Community-Aktivitaet sichtbar.";
		return;
	}
	items.forEach((item) => {
		const card = document.createElement("article");
		card.className = "feed-item";
		card.innerHTML = `
			<div class="item-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="item-tag">${item.type === "game" ? "Game" : "Log"}</span>
			</div>
			<p>${escapeHtml(item.detail || "")}</p>
		`;
		node.appendChild(card);
	});
}

function renderBoards(leaderboard) {
	const node = document.querySelector("#community-boards");
	node.innerHTML = "";
	[
		{ title: "Top 3 Score", entries: leaderboard.slice(0, 3).map((entry) => `${entry.handle} • ${entry.stats.score}`) },
		{ title: "Top 3 Streak", entries: leaderboard.slice().sort((a, b) => (b.stats.currentStreak || 0) - (a.stats.currentStreak || 0)).slice(0, 3).map((entry) => `${entry.handle} • ${entry.stats.currentStreak} Tage`) },
		{ title: "Top 3 Games", entries: leaderboard.slice().sort((a, b) => (b.stats.gameWins || 0) - (a.stats.gameWins || 0)).slice(0, 3).map((entry) => `${entry.handle} • ${entry.stats.gameWins || 0} Wins`) },
		{ title: "Top 3 Journal", entries: leaderboard.slice().sort((a, b) => (b.stats.totalEntries || 0) - (a.stats.totalEntries || 0)).slice(0, 3).map((entry) => `${entry.handle} • ${entry.stats.totalEntries} Logs`) },
	].forEach((board) => {
		const card = document.createElement("article");
		card.className = "board-item";
		card.innerHTML = `<h3>${escapeHtml(board.title)}</h3><p>${escapeHtml(board.entries.join(" | ") || "Noch leer")}</p>`;
		node.appendChild(card);
	});
}

function makeLeader(title, entry) {
	if (!entry) {
		return null;
	}
	return {
		title,
		tag: entry.handle,
		copy: `Level ${entry.stats.level} • Score ${entry.stats.score} • Platz #${entry.placement}`,
	};
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Community konnte nicht geladen werden.");
	}
	return payload;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}