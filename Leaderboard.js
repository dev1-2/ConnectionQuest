const SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const payload = await apiRequest("/api/cq/leaderboard");
		renderLeaderboardPage(payload.leaderboard || [], payload.currentUserId || "");
	} catch (error) {
		const list = document.querySelector("#leaderboard-list");
		list.textContent = error.message;
		list.classList.add("empty-state");
	}
}

function renderLeaderboardPage(rankedUsers, currentUserId) {
	renderCurrentPlayer(rankedUsers, currentUserId);
	renderSummary(rankedUsers);
	renderPodium(rankedUsers, currentUserId);
	renderList(rankedUsers, currentUserId);
}

function renderCurrentPlayer(rankedUsers, currentUserId) {
	const current = rankedUsers.find((entry) => entry.id === currentUserId);
	document.querySelector("#current-player-name").textContent = current ? current.handle : "Kein Spieler aktiv";
	document.querySelector("#current-player-copy").textContent = current
		? `Aktuell markiert im Ranking mit Platz ${current.placement}.`
		: "Logge dich in Connection Quest ein, damit dein Profil markiert wird.";
	document.querySelector("#current-player-score").textContent = String(current?.stats.score || 0);
	document.querySelector("#current-player-level").textContent = String(current?.stats.level || 1);
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
		podium.textContent = "Noch keine Spieler vorhanden.";
		return;
	}

	rankedUsers.slice(0, 3).forEach((entry) => {
		const item = document.createElement("article");
		item.className = `podium-item${entry.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<strong class="podium-rank">#${entry.placement}</strong>
			<div class="podium-copy">
				<h3>${escapeHtml(entry.handle)}</h3>
				<p>${entry.stats.score} Score • Level ${entry.stats.level}</p>
				<p>${entry.stats.totalEntries} Interaktionen • ${entry.stats.unlockedAchievements} Badges</p>
			</div>
		`;
		podium.appendChild(item);
	});
}

function renderList(rankedUsers, currentUserId) {
	const list = document.querySelector("#leaderboard-list");
	list.innerHTML = "";
	list.classList.toggle("empty-state", rankedUsers.length === 0);

	if (!rankedUsers.length) {
		list.textContent = "Noch keine Spieler vorhanden.";
		return;
	}

	rankedUsers.forEach((entry) => {
		const item = document.createElement("article");
		item.className = `leaderboard-item${entry.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<div class="leaderboard-rank">#${entry.placement}</div>
			<div class="leaderboard-copy">
				<h3>${escapeHtml(entry.handle)}</h3>
				<p>Level ${entry.stats.level} • ${entry.stats.xp} XP • ${entry.stats.currentStreak} Tage Streak</p>
				<p>${entry.stats.totalEntries} Interaktionen • ${entry.stats.uniqueConnections} Connections • ${entry.stats.unlockedAchievements} Badges • ${entry.loginCount} Logins</p>
			</div>
			<div class="leaderboard-score">${entry.stats.score}</div>
		`;
		list.appendChild(item);
	});
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

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}