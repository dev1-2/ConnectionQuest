const USERS_KEY = "connection-quest-users-v2";
const SESSION_KEY = "connection-quest-session-v2";
const XP_PER_LEVEL = 180;

const ACHIEVEMENTS = [
	{ id: "first-entry", unlocked: (stats) => stats.totalEntries >= 1 },
	{ id: "network-builder", unlocked: (stats) => stats.uniqueConnections >= 3 },
	{ id: "variety-run", unlocked: (stats) => stats.typeVariety >= 4 },
	{ id: "streak-starter", unlocked: (stats) => stats.currentStreak >= 3 },
	{ id: "score-climber", unlocked: (stats) => stats.score >= 600 },
	{ id: "legend-path", unlocked: (stats) => stats.level >= 5 },
];

const users = loadUsers();
const currentUserId = window.localStorage.getItem(SESSION_KEY) || "";

renderLeaderboardPage();

function renderLeaderboardPage() {
	const rankedUsers = users
		.map((user) => ({
			user,
			stats: buildStats(user.entries || []),
		}))
		.sort((left, right) => {
			if (right.stats.score !== left.stats.score) {
				return right.stats.score - left.stats.score;
			}
			if (right.stats.xp !== left.stats.xp) {
				return right.stats.xp - left.stats.xp;
			}
			return right.stats.totalEntries - left.stats.totalEntries;
		});

	renderCurrentPlayer(rankedUsers);
	renderSummary(rankedUsers);
	renderPodium(rankedUsers);
	renderList(rankedUsers);
}

function renderCurrentPlayer(rankedUsers) {
	const current = rankedUsers.find((entry) => entry.user.id === currentUserId);
	document.querySelector("#current-player-name").textContent = current ? current.user.handle : "Kein Spieler aktiv";
	document.querySelector("#current-player-copy").textContent = current
		? `Aktuell markiert im Ranking mit Platz ${rankedUsers.findIndex((entry) => entry.user.id === currentUserId) + 1}.`
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

function renderPodium(rankedUsers) {
	const podium = document.querySelector("#podium");
	podium.innerHTML = "";
	podium.classList.toggle("empty-state", rankedUsers.length === 0);

	if (!rankedUsers.length) {
		podium.textContent = "Noch keine Spieler vorhanden.";
		return;
	}

	rankedUsers.slice(0, 3).forEach((entry, index) => {
		const item = document.createElement("article");
		item.className = `podium-item${entry.user.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<strong class="podium-rank">#${index + 1}</strong>
			<div class="podium-copy">
				<h3>${escapeHtml(entry.user.handle)}</h3>
				<p>${entry.stats.score} Score • Level ${entry.stats.level}</p>
				<p>${entry.stats.totalEntries} Interaktionen • ${entry.stats.unlockedAchievements} Badges</p>
			</div>
		`;
		podium.appendChild(item);
	});
}

function renderList(rankedUsers) {
	const list = document.querySelector("#leaderboard-list");
	list.innerHTML = "";
	list.classList.toggle("empty-state", rankedUsers.length === 0);

	if (!rankedUsers.length) {
		list.textContent = "Noch keine Spieler vorhanden.";
		return;
	}

	rankedUsers.forEach((entry, index) => {
		const item = document.createElement("article");
		item.className = `leaderboard-item${entry.user.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<div class="leaderboard-rank">#${index + 1}</div>
			<div class="leaderboard-copy">
				<h3>${escapeHtml(entry.user.handle)}</h3>
				<p>Level ${entry.stats.level} • ${entry.stats.xp} XP • ${entry.stats.currentStreak} Tage Streak</p>
				<p>${entry.stats.totalEntries} Interaktionen • ${entry.stats.uniqueConnections} Connections • ${entry.stats.unlockedAchievements} Badges</p>
			</div>
			<div class="leaderboard-score">${entry.stats.score}</div>
		`;
		list.appendChild(item);
	});
}

function buildStats(entries) {
	const uniqueConnections = new Set(entries.map((entry) => entry.name.toLowerCase())).size;
	const typeVariety = new Set(entries.map((entry) => entry.type)).size;
	const dailyKeys = Array.from(new Set(entries.map((entry) => entry.date))).sort((left, right) => right.localeCompare(left));
	const currentStreak = calculateCurrentStreak(dailyKeys);
	const bestMonthCount = calculateBestMonthCount(entries);
	const xp = (entries.length * 35) + (uniqueConnections * 30) + (typeVariety * 20) + (currentStreak * 25) + (bestMonthCount * 10);
	const level = Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
	const provisionalStats = {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		level,
		score: 0,
	};
	const provisionalAchievements = ACHIEVEMENTS.filter((achievement) => achievement.unlocked(provisionalStats)).length;
	const score = xp + (entries.length * 12) + (provisionalAchievements * 100);
	const unlockedAchievements = ACHIEVEMENTS.filter((achievement) => achievement.unlocked({ ...provisionalStats, score })).length;

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

function calculateCurrentStreak(sortedDescDates) {
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

function calculateBestMonthCount(entries) {
	const counts = new Map();
	entries.forEach((entry) => {
		const monthKey = entry.date.slice(0, 7);
		counts.set(monthKey, (counts.get(monthKey) || 0) + 1);
	});
	return counts.size ? Math.max(...counts.values()) : 0;
}

function loadUsers() {
	try {
		const raw = window.localStorage.getItem(USERS_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
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

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}