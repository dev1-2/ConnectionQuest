const USERS_KEY = "connection-quest-users-v2";
const SESSION_KEY = "connection-quest-session-v2";
const XP_PER_LEVEL = 180;

const ACHIEVEMENTS = [
	{
		id: "first-entry",
		title: "First Contact",
		icon: "01",
		description: "Speichere den ersten Eintrag.",
		unlocked: (stats) => stats.totalEntries >= 1,
	},
	{
		id: "network-builder",
		title: "Network Builder",
		icon: "02",
		description: "Erfasse 3 verschiedene Connections.",
		unlocked: (stats) => stats.uniqueConnections >= 3,
	},
	{
		id: "variety-run",
		title: "Variety Run",
		icon: "03",
		description: "Nutze mindestens 4 Moment-Typen.",
		unlocked: (stats) => stats.typeVariety >= 4,
	},
	{
		id: "streak-starter",
		title: "Consistency Spark",
		icon: "04",
		description: "Schaffe eine 3-Tage-Serie.",
		unlocked: (stats) => stats.currentStreak >= 3,
	},
	{
		id: "score-climber",
		title: "Score Climber",
		icon: "05",
		description: "Erreiche 600 Score.",
		unlocked: (stats) => stats.score >= 600,
	},
	{
		id: "legend-path",
		title: "Legend Path",
		icon: "06",
		description: "Erreiche Level 5.",
		unlocked: (stats) => stats.level >= 5,
	},
];

const state = {
	users: loadUsers(),
	currentUserId: loadSession(),
	selectedDate: todayString(),
	visibleMonth: startOfMonth(new Date()),
};

const form = document.querySelector("#entry-form");
const authForm = document.querySelector("#auth-form");
const logoutButton = document.querySelector("#logout-player");
const clearAllButton = document.querySelector("#clear-all");
const nameInput = document.querySelector("#name");
const dateInput = document.querySelector("#date");
const typeInput = document.querySelector("#type");
const notesInput = document.querySelector("#notes");
const authHandleInput = document.querySelector("#auth-handle");
const authPinInput = document.querySelector("#auth-pin");
const calendarGrid = document.querySelector("#calendar-grid");
const calendarLabel = document.querySelector("#calendar-label");
const selectedDateLabel = document.querySelector("#selected-date-label");
const selectedDateSummary = document.querySelector("#selected-date-summary");
const selectedDayList = document.querySelector("#selected-day-list");
const recentList = document.querySelector("#recent-list");
const achievementList = document.querySelector("#achievement-list");
const leaderboardList = document.querySelector("#leaderboard-list");
const entryTemplate = document.querySelector("#entry-template");

document.querySelector("#prev-month").addEventListener("click", () => changeMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => changeMonth(1));
document.querySelector("#today-btn").addEventListener("click", jumpToToday);
clearAllButton.addEventListener("click", clearAllEntries);
form.addEventListener("submit", handleSubmit);
authForm.addEventListener("submit", handleAuthSubmit);
logoutButton.addEventListener("click", handleLogout);

dateInput.value = state.selectedDate;
render();

function handleAuthSubmit(event) {
	event.preventDefault();
	const handle = authHandleInput.value.trim();
	const pin = authPinInput.value.trim();
	const intent = String(event.submitter?.value || "login");

	if (!handle || pin.length < 4) {
		setAuthMessage("Bitte Spielername und eine PIN mit mindestens 4 Zeichen eingeben.", true);
		return;
	}

	if (intent === "register") {
		handleRegister(handle, pin);
		return;
	}

	handleLogin(handle, pin);
}

function handleRegister(handle, pin) {
	const handleKey = toHandleKey(handle);
	if (state.users.some((user) => user.handleKey === handleKey)) {
		setAuthMessage("Dieser Spielername existiert bereits. Bitte einloggen.", true);
		return;
	}

	const user = {
		id: crypto.randomUUID(),
		handle: normalizeHandle(handle),
		handleKey,
		pin,
		createdAt: Date.now(),
		entries: [],
	};

	state.users.unshift(user);
	state.currentUserId = user.id;
	saveUsers(state.users);
	saveSession(user.id);
	authForm.reset();
	setAuthMessage(`${user.handle} wurde erstellt und eingeloggt.`);
	render();
}

function handleLogin(handle, pin) {
	const user = state.users.find((entry) => entry.handleKey === toHandleKey(handle));
	if (!user) {
		setAuthMessage("Kein passender Spieler gefunden. Bitte zuerst registrieren.", true);
		return;
	}

	if (user.pin !== pin) {
		setAuthMessage("Die PIN stimmt nicht.", true);
		return;
	}

	state.currentUserId = user.id;
	saveSession(user.id);
	authForm.reset();
	setAuthMessage(`${user.handle} ist jetzt aktiv.`);
	render();
}

function handleLogout() {
	state.currentUserId = "";
	window.localStorage.removeItem(SESSION_KEY);
	setAuthMessage("Spieler wurde ausgeloggt.");
	render();
}

function handleSubmit(event) {
	event.preventDefault();
	const currentUser = getCurrentUser();
	if (!currentUser) {
		setAuthMessage("Bitte zuerst einloggen, um Interaktionen zu speichern.", true);
		return;
	}

	const name = nameInput.value.trim();
	const date = dateInput.value;
	const type = typeInput.value;
	const notes = notesInput.value.trim();

	if (!name || !date || !type) {
		return;
	}

	currentUser.entries.unshift({
		id: crypto.randomUUID(),
		name,
		date,
		type,
		notes,
		createdAt: Date.now(),
	});

	state.selectedDate = date;
	state.visibleMonth = startOfMonth(new Date(date));
	saveUsers(state.users);
	form.reset();
	dateInput.value = state.selectedDate;
	typeInput.value = "Chat";
	render();
}

function clearAllEntries() {
	const currentUser = getCurrentUser();
	if (!currentUser || !currentUser.entries.length) {
		return;
	}

	const confirmed = window.confirm("Wirklich alle Interaktionen dieses Spielers löschen?");
	if (!confirmed) {
		return;
	}

	currentUser.entries = [];
	state.selectedDate = todayString();
	state.visibleMonth = startOfMonth(new Date());
	saveUsers(state.users);
	dateInput.value = state.selectedDate;
	render();
}

function deleteEntry(id) {
	const currentUser = getCurrentUser();
	if (!currentUser) {
		return;
	}

	currentUser.entries = currentUser.entries.filter((entry) => entry.id !== id);
	saveUsers(state.users);
	render();
}

function render() {
	const currentUser = getCurrentUser();
	const entries = currentUser?.entries || [];
	const stats = currentUser ? buildStats(entries) : buildEmptyStats();

	renderSession(currentUser, stats);
	renderAuth(currentUser, stats);
	renderStats(currentUser, stats);
	renderCalendar(entries, Boolean(currentUser));
	renderSelectedDay(entries, Boolean(currentUser));
	renderAchievements(stats, Boolean(currentUser));
	renderRecentEntries(entries, Boolean(currentUser));
	renderLeaderboard(currentUser?.id || "");
	updateInteractionLock(Boolean(currentUser));
}

function renderSession(currentUser, stats) {
	document.querySelector("#session-player").textContent = currentUser ? currentUser.handle : "Kein Spieler aktiv";
	document.querySelector("#session-score").textContent = `${stats.score} Score`;
	document.querySelector("#level-value").textContent = String(stats.level);
	document.querySelector("#xp-value").textContent = `${stats.xp} XP`;
	document.querySelector("#progress-text").textContent = `${stats.xpIntoLevel} / ${stats.xpToNextLevel} XP`;
	document.querySelector("#progress-fill").style.width = `${stats.progressPercent}%`;
	document.querySelector("#level-note").textContent = currentUser ? stats.levelMessage : "Starte mit einem Login und deinem ersten Log.";
	document.querySelector("#player-note").textContent = currentUser
		? `${currentUser.handle} sammelt mit jeder Interaktion Score, XP und Badges.`
		: "Login erforderlich, um Punkte zu sammeln.";
}

function renderAuth(currentUser, stats) {
	const authStateCopy = document.querySelector("#auth-state-copy");
	const profileSummary = document.querySelector("#profile-summary");
	if (!currentUser) {
		authStateCopy.textContent = "Registriere einen Spieler oder logge dich ein.";
		profileSummary.classList.add("empty-state");
		profileSummary.innerHTML = "Logge dich ein, um dein Profil, XP und Interaktionen zu sehen.";
		logoutButton.hidden = true;
		return;
	}

	authStateCopy.textContent = `Aktiv: ${currentUser.handle}`;
	profileSummary.classList.remove("empty-state");
	profileSummary.innerHTML = `
		<div class="profile-grid">
			<div>
				<p class="mini-label">Spieler</p>
				<h3>${escapeHtml(currentUser.handle)}</h3>
			</div>
			<div>
				<p class="mini-label">Level</p>
				<h3>${stats.level}</h3>
			</div>
			<div>
				<p class="mini-label">XP</p>
				<h3>${stats.xp}</h3>
			</div>
			<div>
				<p class="mini-label">Streak</p>
				<h3>${stats.currentStreak} Tage</h3>
			</div>
		</div>
	`;
	logoutButton.hidden = false;
}

function renderStats(currentUser, stats) {
	document.querySelector("#score-count").textContent = String(stats.score);
	document.querySelector("#entry-count").textContent = String(stats.totalEntries);
	document.querySelector("#unique-count").textContent = String(stats.uniqueConnections);
	document.querySelector("#streak-count").textContent = `${stats.currentStreak} ${stats.currentStreak === 1 ? "Tag" : "Tage"}`;
	document.querySelector("#achievement-count").textContent = String(stats.unlockedAchievements);

	document.querySelector("#score-copy").textContent = currentUser
		? `Jede Interaktion gibt Punkte. ${stats.score} Score bisher.`
		: "Noch keine Punkte gesammelt.";
	document.querySelector("#entry-copy").textContent = currentUser
		? (stats.totalEntries > 0 ? `Letzte Interaktion: ${formatDate(stats.latestDate)}` : "Dein Journal wartet auf den ersten Log.")
		: "Login erforderlich für Interaktionen.";
	document.querySelector("#unique-copy").textContent = currentUser
		? (stats.uniqueConnections > 0 ? `${stats.uniqueConnections} verschiedene Namen geloggt.` : "Noch keine Namen erfasst.")
		: "Noch keine Namen erfasst.";
	document.querySelector("#streak-copy").textContent = currentUser
		? (stats.currentStreak > 0 ? `Aktiv an ${stats.currentStreak} Tagen in Folge.` : "Noch keine Aktivität in Folge.")
		: "Noch keine Aktivität in Folge.";
	document.querySelector("#achievement-copy").textContent = currentUser
		? (stats.unlockedAchievements > 0 ? `${stats.unlockedAchievements} von ${ACHIEVEMENTS.length} Badges aktiviert.` : "Keine Badges freigeschaltet.")
		: "Keine Badges freigeschaltet.";
}

function renderCalendar(entries, hasUser) {
	calendarGrid.innerHTML = "";
	calendarLabel.textContent = monthFormatter(state.visibleMonth);

	const monthStart = startOfMonth(state.visibleMonth);
	const startWeekday = (monthStart.getDay() + 6) % 7;
	const gridStart = addDays(monthStart, -startWeekday);
	const entriesByDate = groupEntriesByDate(entries);

	for (let index = 0; index < 42; index += 1) {
		const day = addDays(gridStart, index);
		const dayKey = toDateKey(day);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "calendar-day";

		if (day.getMonth() !== state.visibleMonth.getMonth()) {
			button.classList.add("other-month");
		}
		if (dayKey === todayString()) {
			button.classList.add("today");
		}
		if (dayKey === state.selectedDate) {
			button.classList.add("selected");
		}

		const items = entriesByDate.get(dayKey) || [];
		if (items.length) {
			button.classList.add("has-entry");
		}

		button.innerHTML = `
			<span class="day-number">${day.getDate()}</span>
			<div class="day-dots">${items.slice(0, 4).map(() => "<span></span>").join("")}</div>
			<small>${hasUser && items.length ? `${items.length} Log${items.length > 1 ? "s" : ""}` : ""}</small>
		`;
		button.addEventListener("click", () => {
			state.selectedDate = dayKey;
			dateInput.value = dayKey;
			if (day.getMonth() !== state.visibleMonth.getMonth() || day.getFullYear() !== state.visibleMonth.getFullYear()) {
				state.visibleMonth = startOfMonth(day);
			}
			render();
		});

		calendarGrid.appendChild(button);
	}
}

function renderSelectedDay(entries, hasUser) {
	const dayEntries = entries
		.filter((entry) => entry.date === state.selectedDate)
		.sort((left, right) => right.createdAt - left.createdAt);

	selectedDateLabel.textContent = hasUser ? formatDate(state.selectedDate) : "Login erforderlich";
	selectedDateSummary.textContent = !hasUser
		? "Logge dich ein, um deine Tagesansicht zu sehen."
		: (dayEntries.length ? `${dayEntries.length} Eintrag${dayEntries.length > 1 ? "e" : ""} an diesem Tag.` : "Noch keine Einträge für diesen Tag.");

	selectedDayList.innerHTML = "";
	selectedDayList.classList.toggle("empty-state", dayEntries.length === 0 || !hasUser);

	if (!hasUser) {
		selectedDayList.textContent = "Login erforderlich, um deine Interaktionen zu sehen.";
		return;
	}

	if (!dayEntries.length) {
		selectedDayList.textContent = "Noch keine Einträge für diesen Tag.";
		return;
	}

	dayEntries.forEach((entry) => {
		selectedDayList.appendChild(buildEntryNode(entry));
	});
}

function renderAchievements(stats, hasUser) {
	achievementList.innerHTML = "";

	ACHIEVEMENTS.forEach((achievement) => {
		const unlocked = hasUser && achievement.unlocked(stats);
		const item = document.createElement("article");
		item.className = `achievement-item${unlocked ? "" : " locked"}`;
		item.innerHTML = `
			<div class="achievement-mark">${achievement.icon}</div>
			<div class="achievement-copy">
				<h3>${achievement.title}</h3>
				<p>${achievement.description}</p>
			</div>
			<strong>${unlocked ? "Unlocked" : "Locked"}</strong>
		`;
		achievementList.appendChild(item);
	});
}

function renderRecentEntries(entries, hasUser) {
	recentList.innerHTML = "";
	recentList.classList.toggle("empty-state", entries.length === 0 || !hasUser);

	if (!hasUser) {
		recentList.textContent = "Login erforderlich, um letzte Interaktionen zu sehen.";
		return;
	}

	if (!entries.length) {
		recentList.textContent = "Noch keine Einträge vorhanden.";
		return;
	}

	entries
		.slice()
		.sort((left, right) => {
			if (left.date === right.date) {
				return right.createdAt - left.createdAt;
			}
			return right.date.localeCompare(left.date);
		})
		.slice(0, 8)
		.forEach((entry) => {
			const node = buildEntryNode(entry);
			node.querySelector(".entry-notes").textContent = entry.notes
				? `${formatDate(entry.date)} • ${entry.notes}`
				: `${formatDate(entry.date)} • Keine Notiz`;
			recentList.appendChild(node);
		});
}

function renderLeaderboard(currentUserId) {
	leaderboardList.innerHTML = "";

	if (!state.users.length) {
		leaderboardList.textContent = "Noch keine Spieler vorhanden.";
		leaderboardList.classList.add("empty-state");
		return;
	}

	leaderboardList.classList.remove("empty-state");
	const sortedUsers = state.users
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

	sortedUsers.forEach(({ user, stats }, index) => {
		const item = document.createElement("article");
		item.className = `leaderboard-item${user.id === currentUserId ? " is-active" : ""}`;
		item.innerHTML = `
			<div class="leaderboard-rank">#${index + 1}</div>
			<div class="leaderboard-copy">
				<h3>${escapeHtml(user.handle)}</h3>
				<p>Level ${stats.level} • ${stats.totalEntries} Interaktionen • ${stats.unlockedAchievements} Badges</p>
			</div>
			<div class="leaderboard-score">${stats.score}</div>
		`;
		leaderboardList.appendChild(item);
	});
}

function buildEntryNode(entry) {
	const node = entryTemplate.content.firstElementChild.cloneNode(true);
	node.querySelector(".entry-name").textContent = entry.name;
	node.querySelector(".entry-type").textContent = entry.type;
	node.querySelector(".entry-notes").textContent = entry.notes || "Keine Notiz hinterlegt.";
	node.querySelector(".delete-btn").addEventListener("click", () => deleteEntry(entry.id));
	return node;
}

function buildStats(entries) {
	const uniqueConnections = new Set(entries.map((entry) => entry.name.toLowerCase())).size;
	const typeVariety = new Set(entries.map((entry) => entry.type)).size;
	const dailyKeys = Array.from(new Set(entries.map((entry) => entry.date))).sort((left, right) => right.localeCompare(left));
	const currentStreak = calculateCurrentStreak(dailyKeys);
	const bestMonthCount = calculateBestMonthCount(entries);
	const latestDate = entries.length ? entries.reduce((latest, entry) => entry.date > latest ? entry.date : latest, entries[0].date) : null;

	const xp = (entries.length * 35) + (uniqueConnections * 30) + (typeVariety * 20) + (currentStreak * 25) + (bestMonthCount * 10);
	const level = Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
	const xpIntoLevel = xp % XP_PER_LEVEL;
	const xpToNextLevel = XP_PER_LEVEL;
	const baseStats = {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		level,
		score: 0,
	};
	const provisionalAchievements = ACHIEVEMENTS.filter((achievement) => achievement.unlocked(baseStats)).length;
	const score = xp + (entries.length * 12) + (provisionalAchievements * 100);
	const finalStats = {
		...baseStats,
		score,
	};
	const unlockedAchievements = ACHIEVEMENTS.filter((achievement) => achievement.unlocked(finalStats)).length;

	return {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		latestDate,
		xp,
		score,
		level,
		xpIntoLevel,
		xpToNextLevel,
		progressPercent: Math.round((xpIntoLevel / xpToNextLevel) * 100),
		unlockedAchievements,
		levelMessage: buildLevelMessage(level, entries.length),
	};
}

function buildEmptyStats() {
	return {
		totalEntries: 0,
		uniqueConnections: 0,
		typeVariety: 0,
		currentStreak: 0,
		bestMonthCount: 0,
		latestDate: null,
		xp: 0,
		score: 0,
		level: 1,
		xpIntoLevel: 0,
		xpToNextLevel: XP_PER_LEVEL,
		progressPercent: 0,
		unlockedAchievements: 0,
		levelMessage: "Starte mit dem ersten Eintrag.",
	};
}

function buildLevelMessage(level, totalEntries) {
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

function updateInteractionLock(isLoggedIn) {
	const locked = !isLoggedIn;
	Array.from(form.elements).forEach((element) => {
		element.disabled = locked;
	});
	clearAllButton.disabled = locked;
	document.querySelector("#form-lock-copy").textContent = locked
		? "Login erforderlich. Erst dann zaehlt jede Interaktion zu Score und XP."
		: "Alles bleibt lokal im Browser gespeichert.";
	if (locked) {
		dateInput.value = state.selectedDate;
	}
}

function setAuthMessage(message, isError = false) {
	const node = document.querySelector("#auth-message");
	node.textContent = message;
	node.classList.toggle("is-error", isError);
}

function getCurrentUser() {
	return state.users.find((user) => user.id === state.currentUserId) || null;
}

function calculateCurrentStreak(sortedDescDates) {
	if (!sortedDescDates.length) {
		return 0;
	}

	const today = todayString();
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

function groupEntriesByDate(entries) {
	return entries.reduce((map, entry) => {
		const list = map.get(entry.date) || [];
		list.push(entry);
		map.set(entry.date, list);
		return map;
	}, new Map());
}

function changeMonth(delta) {
	const next = new Date(state.visibleMonth);
	next.setMonth(next.getMonth() + delta);
	state.visibleMonth = startOfMonth(next);
	render();
}

function jumpToToday() {
	state.selectedDate = todayString();
	state.visibleMonth = startOfMonth(new Date());
	dateInput.value = state.selectedDate;
	render();
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

function saveUsers(users) {
	window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function loadSession() {
	return window.localStorage.getItem(SESSION_KEY) || "";
}

function saveSession(userId) {
	window.localStorage.setItem(SESSION_KEY, userId);
}

function todayString() {
	return toDateKey(new Date());
}

function startOfMonth(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1);
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

function formatDate(value) {
	if (!value) {
		return "Noch kein Datum";
	}
	return new Intl.DateTimeFormat("de-DE", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	}).format(new Date(value));
}

function monthFormatter(date) {
	return new Intl.DateTimeFormat("de-DE", {
		month: "long",
		year: "numeric",
	}).format(date);
}

function normalizeHandle(value) {
	return value
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function toHandleKey(value) {
	return value.trim().toLowerCase();
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
