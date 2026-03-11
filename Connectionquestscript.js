const SESSION_KEY = "connection-quest-session-token-v1";

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
	sessionToken: loadSessionToken(),
	currentUser: null,
	pulseData: buildEmptyPulse(),
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
const missionList = document.querySelector("#mission-list");
const returnBonus = document.querySelector("#return-bonus");
const weeklyList = document.querySelector("#weekly-list");
const recommendationList = document.querySelector("#recommendation-list");
const communityStats = document.querySelector("#community-stats");
const communityHighlights = document.querySelector("#community-highlights");
const communityFeed = document.querySelector("#community-feed");
const entryTemplate = document.querySelector("#entry-template");

document.querySelector("#prev-month").addEventListener("click", () => changeMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => changeMonth(1));
document.querySelector("#today-btn").addEventListener("click", jumpToToday);
clearAllButton.addEventListener("click", clearAllEntries);
form.addEventListener("submit", handleSubmit);
authForm.addEventListener("submit", handleAuthSubmit);
logoutButton.addEventListener("click", handleLogout);

dateInput.value = state.selectedDate;
initialize();

async function initialize() {
	await hydrateSession();
	await hydratePulse();
	render();
}

async function handleAuthSubmit(event) {
	event.preventDefault();
	const handle = authHandleInput.value.trim();
	const pin = authPinInput.value.trim();
	const intent = String(event.submitter?.value || "login");

	if (!handle || pin.length < 4) {
		setAuthMessage("Bitte Spielername und eine PIN mit mindestens 4 Zeichen eingeben.", true);
		return;
	}

	if (intent === "register") {
		await handleRegister(handle, pin);
		return;
	}

	await handleLogin(handle, pin);
}

async function handleRegister(handle, pin) {
	try {
		const payload = await apiRequest("/api/cq/register", {
			method: "POST",
			body: { handle, pin },
			auth: false,
		});
		state.sessionToken = payload.sessionToken;
		saveSessionToken(state.sessionToken);
		state.currentUser = payload.currentUser;
		authForm.reset();
		await hydratePulse();
		setAuthMessage(`${payload.currentUser.handle} wurde erstellt und in der Datenbank gespeichert.`);
		syncCurrentUserDate();
		render();
	} catch (error) {
		setAuthMessage(error.message, true);
	}
}

async function handleLogin(handle, pin) {
	try {
		const payload = await apiRequest("/api/cq/login", {
			method: "POST",
			body: { handle, pin },
			auth: false,
		});
		state.sessionToken = payload.sessionToken;
		saveSessionToken(state.sessionToken);
		state.currentUser = payload.currentUser;
		authForm.reset();
		await hydratePulse();
		setAuthMessage(`${payload.currentUser.handle} ist jetzt aktiv. Login wurde gespeichert.`);
		syncCurrentUserDate();
		render();
	} catch (error) {
		setAuthMessage(error.message, true);
	}
}

async function handleLogout() {
	try {
		await apiRequest("/api/cq/logout", { method: "POST" });
	} catch {
		// Ignore logout failures and clear local session anyway.
	}
	clearSession();
	await hydratePulse();
	setAuthMessage("Spieler wurde ausgeloggt.");
	render();
}

async function handleSubmit(event) {
	event.preventDefault();
	const currentUser = state.currentUser;
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

	try {
		const payload = await apiRequest("/api/cq/entries", {
			method: "POST",
			body: { name, date, type, notes },
		});
		state.currentUser = payload.currentUser;
		state.selectedDate = date;
		state.visibleMonth = startOfMonth(new Date(date));
		form.reset();
		dateInput.value = state.selectedDate;
		typeInput.value = "Chat";
		await hydratePulse();
		render();
	} catch (error) {
		setAuthMessage(error.message, true);
	}
}

async function clearAllEntries() {
	const currentUser = state.currentUser;
	if (!currentUser || !currentUser.entries.length) {
		return;
	}

	const confirmed = window.confirm("Wirklich alle Interaktionen dieses Spielers löschen?");
	if (!confirmed) {
		return;
	}

	try {
		const payload = await apiRequest("/api/cq/entries", { method: "DELETE" });
		state.currentUser = payload.currentUser;
		state.selectedDate = todayString();
		state.visibleMonth = startOfMonth(new Date());
		dateInput.value = state.selectedDate;
		await hydratePulse();
		render();
	} catch (error) {
		setAuthMessage(error.message, true);
	}
}

async function deleteEntry(id) {
	const currentUser = state.currentUser;
	if (!currentUser) {
		return;
	}

	try {
		const payload = await apiRequest(`/api/cq/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
		state.currentUser = payload.currentUser;
		await hydratePulse();
		render();
	} catch (error) {
		setAuthMessage(error.message, true);
	}
}

function render() {
	const currentUser = state.currentUser;
	const entries = currentUser?.entries || [];
	const stats = currentUser?.stats || buildEmptyStats();

	renderSession(currentUser, stats);
	renderAuth(currentUser, stats);
	renderStats(currentUser, stats);
	renderPulse(currentUser);
	renderCalendar(entries, Boolean(currentUser));
	renderSelectedDay(entries, Boolean(currentUser));
	renderAchievements(stats, Boolean(currentUser));
	renderRecentEntries(entries, Boolean(currentUser));
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
				<p class="mini-label">Platz</p>
				<h3>#${currentUser.placement || 0}</h3>
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
				<p class="mini-label">Logins</p>
				<h3>${currentUser.loginCount}</h3>
			</div>
			<div>
				<p class="mini-label">Game Wins</p>
				<h3>${stats.gameWins || 0}</h3>
			</div>
			<div>
				<p class="mini-label">Game Sessions</p>
				<h3>${stats.gameSessions || 0}</h3>
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

	document.querySelector("#player-note").textContent = currentUser
		? `${currentUser.handle} sammelt mit Logs und Games Score, XP und Badges.`
		: "Login erforderlich, um Punkte zu sammeln.";
}

function renderPulse(currentUser) {
	const pulse = state.pulseData || buildEmptyPulse();
	renderMissions(pulse.missions || [], Boolean(currentUser));
	renderWeeklyChallenges(pulse.weeklyChallenges || [], Boolean(currentUser));
	renderRecommendations(pulse.recommendations || []);
	renderReturnBonus(pulse.returnBonus || buildEmptyPulse().returnBonus);
	renderCommunity(pulse);
}

function renderMissions(missions, hasUser) {
	missionList.innerHTML = "";
	missionList.classList.toggle("empty-state", !hasUser || missions.length === 0);

	if (!hasUser) {
		missionList.textContent = "Logge dich ein, um deine taeglichen Missionen zu sehen.";
		return;
	}

	if (!missions.length) {
		missionList.textContent = "Noch keine Missionen verfuegbar.";
		return;
	}

	missions.forEach((mission) => {
		const node = document.createElement("article");
		node.className = "mission-item";
		node.innerHTML = `
			<div class="mission-head">
				<div class="mission-copy">
					<h3>${escapeHtml(mission.title)}</h3>
					<p>${escapeHtml(mission.description)}</p>
				</div>
				<span class="mission-badge${mission.completed ? " is-complete" : ""}">${mission.completed ? "Complete" : "Active"}</span>
			</div>
			<div class="mission-progress" aria-hidden="true"><span style="width:${mission.progressPercent}%"></span></div>
			<div class="mission-foot">
				<span>${mission.current} / ${mission.target}</span>
				<strong>${escapeHtml(mission.rewardLabel)}</strong>
			</div>
		`;
		missionList.appendChild(node);
	});
}

function renderReturnBonus(data) {
	returnBonus.innerHTML = "";
	returnBonus.classList.remove("empty-state");
	const node = document.createElement("article");
	node.className = "return-bonus-shell";
	node.innerHTML = `
		<div class="feed-head">
			<div class="return-copy">
				<h3>${escapeHtml(data.title || "Noch kein Rueckkehr-Ziel aktiv")}</h3>
				<p>${escapeHtml(data.description || "")}</p>
			</div>
			<span class="return-status">${escapeHtml(data.status || "Idle")}</span>
		</div>
		<div class="return-progress" aria-hidden="true"><span style="width:${data.progressPercent || 0}%"></span></div>
		<div class="return-meta"><span>${escapeHtml(data.progressLabel || "")}</span></div>
	`;
	returnBonus.appendChild(node);
}

function renderWeeklyChallenges(challenges, hasUser) {
	weeklyList.innerHTML = "";
	weeklyList.classList.toggle("empty-state", !hasUser || challenges.length === 0);

	if (!hasUser) {
		weeklyList.textContent = "Weekly Challenges werden nach dem Login aktiviert.";
		return;
	}

	if (!challenges.length) {
		weeklyList.textContent = "Noch keine Weekly Challenges verfuegbar.";
		return;
	}

	challenges.forEach((challenge) => {
		const node = document.createElement("article");
		node.className = "mission-item";
		node.innerHTML = `
			<div class="mission-head">
				<div class="mission-copy">
					<h3>${escapeHtml(challenge.title)}</h3>
					<p>${escapeHtml(challenge.description)}</p>
				</div>
				<span class="mission-badge${challenge.completed ? " is-complete" : ""}">${challenge.completed ? "Weekly Clear" : "Week Live"}</span>
			</div>
			<div class="mission-progress" aria-hidden="true"><span style="width:${challenge.progressPercent}%"></span></div>
			<div class="mission-foot">
				<span>${challenge.current} / ${challenge.target}</span>
				<strong>${escapeHtml(challenge.rewardLabel)}</strong>
			</div>
		`;
		weeklyList.appendChild(node);
	});
}

function renderRecommendations(items) {
	recommendationList.innerHTML = "";
	recommendationList.classList.toggle("empty-state", items.length === 0);

	if (!items.length) {
		recommendationList.textContent = "Noch keine persoenlichen Empfehlungen sichtbar.";
		return;
	}

	items.forEach((item) => {
		const node = document.createElement("article");
		node.className = "recommendation-item";
		node.innerHTML = `
			<div class="mission-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="mission-badge">${escapeHtml(item.tag || "Hint")}</span>
			</div>
			<p>${escapeHtml(item.copy || "")}</p>
		`;
		recommendationList.appendChild(node);
	});
}

function renderCommunity(pulse) {
	const stats = pulse.communityStats || {};
	communityStats.innerHTML = "";
	[
		{ label: "Spieler", value: stats.playerCount || 0 },
		{ label: "Aktiv 7 Tage", value: stats.activePlayers7d || 0 },
		{ label: "Logs heute", value: stats.entriesToday || 0 },
		{ label: "Games 7 Tage", value: stats.games7d || 0 },
	].forEach((item) => {
		const node = document.createElement("article");
		node.className = "community-stat";
		node.innerHTML = `<small class="mini-label">${escapeHtml(item.label)}</small><strong>${item.value}</strong>`;
		communityStats.appendChild(node);
	});

	communityHighlights.innerHTML = "";
	const highlights = [pulse.highlights?.scoreLeader, pulse.highlights?.streakLeader, pulse.highlights?.gameLeader].filter(Boolean);
	if (!highlights.length) {
		communityHighlights.classList.add("empty-state");
		communityHighlights.textContent = "Noch keine Community-Highlights vorhanden.";
	} else {
		communityHighlights.classList.remove("empty-state");
		highlights.forEach((item) => {
			const node = document.createElement("article");
			node.className = "highlight-item";
			node.innerHTML = `
				<div class="highlight-head">
					<div class="highlight-copy">
						<h3>${escapeHtml(item.handle)}</h3>
						<p>${escapeHtml(item.label)}</p>
					</div>
					<strong>${item.value}</strong>
				</div>
			`;
			communityHighlights.appendChild(node);
		});
	}

	communityFeed.innerHTML = "";
	communityFeed.classList.toggle("empty-state", (pulse.activityFeed || []).length === 0);
	if (!(pulse.activityFeed || []).length) {
		communityFeed.textContent = "Noch keine Community-Aktivitaet sichtbar.";
		return;
	}

	pulse.activityFeed.forEach((entry) => {
		const node = document.createElement("article");
		const tag = entry.type === "game" ? "Game" : "Log";
		node.className = "feed-item";
		node.innerHTML = `
			<div class="feed-head">
				<h3>${escapeHtml(entry.title)}</h3>
				<span class="feed-tag">${tag}</span>
			</div>
			<div class="feed-copy">
				<p>${escapeHtml(entry.detail || "")}</p>
			</div>
			<div class="feed-meta">${formatRelativeTime(entry.occurredAt)}</div>
		`;
		communityFeed.appendChild(node);
	});
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

function buildEntryNode(entry) {
	const node = entryTemplate.content.firstElementChild.cloneNode(true);
	node.querySelector(".entry-name").textContent = entry.name;
	node.querySelector(".entry-type").textContent = entry.type;
	node.querySelector(".entry-notes").textContent = entry.notes || "Keine Notiz hinterlegt.";
	node.querySelector(".delete-btn").addEventListener("click", () => deleteEntry(entry.id));
	return node;
}

function buildEmptyStats() {
	return {
		totalEntries: 0,
		uniqueConnections: 0,
		typeVariety: 0,
		currentStreak: 0,
		bestMonthCount: 0,
		gameSessions: 0,
		gameWins: 0,
		gameScore: 0,
		gameXp: 0,
		latestDate: null,
		xp: 0,
		score: 0,
		level: 1,
		xpIntoLevel: 0,
		xpToNextLevel: 180,
		progressPercent: 0,
		unlockedAchievements: 0,
		levelMessage: "Starte mit dem ersten Eintrag.",
	};
}

function buildEmptyPulse() {
	return {
		communityStats: {
			playerCount: 0,
			activePlayers7d: 0,
			entriesToday: 0,
			games7d: 0,
		},
		highlights: {
			scoreLeader: null,
			streakLeader: null,
			gameLeader: null,
		},
		activityFeed: [],
		missions: [],
		weeklyChallenges: [],
		recommendations: [],
		returnBonus: {
			title: "Noch kein Rueckkehr-Ziel aktiv.",
			description: "",
			progressLabel: "",
			progressPercent: 0,
			status: "Idle",
		},
	};
}

function updateInteractionLock(isLoggedIn) {
	const locked = !isLoggedIn;
	Array.from(form.elements).forEach((element) => {
		element.disabled = locked;
	});
	clearAllButton.disabled = locked;
	document.querySelector("#form-lock-copy").textContent = locked
		? "Login erforderlich. Erst dann zaehlt jede Interaktion zu Score und XP."
		: "Deine Daten werden serverseitig in der Datenbank gespeichert.";
	if (locked) {
		dateInput.value = state.selectedDate;
	}
}

function setAuthMessage(message, isError = false) {
	const node = document.querySelector("#auth-message");
	node.textContent = message;
	node.classList.toggle("is-error", isError);
}

async function hydrateSession() {
	if (!state.sessionToken) {
		state.currentUser = null;
		return;
	}

	try {
		const payload = await apiRequest("/api/cq/session");
		state.currentUser = payload.currentUser;
		if (!state.currentUser) {
			clearSession();
			return;
		}
		syncCurrentUserDate();
		setAuthMessage(`Aktive Session für ${state.currentUser.handle}.`);
	} catch {
		clearSession();
	}
}

async function hydratePulse() {
	try {
		state.pulseData = await apiRequest("/api/cq/pulse");
	} catch {
		state.pulseData = buildEmptyPulse();
	}
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

function loadSessionToken() {
	return window.localStorage.getItem(SESSION_KEY) || "";
}

function saveSessionToken(token) {
	window.localStorage.setItem(SESSION_KEY, token);
}

function clearSession() {
	state.sessionToken = "";
	state.currentUser = null;
	window.localStorage.removeItem(SESSION_KEY);
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

function monthFormatter(date) {
	return new Intl.DateTimeFormat("de-DE", {
		month: "long",
		year: "numeric",
	}).format(date);
}

function syncCurrentUserDate() {
	const entries = state.currentUser?.entries || [];
	const latestDate = entries[0]?.date || todayString();
	state.selectedDate = latestDate;
	state.visibleMonth = startOfMonth(new Date(latestDate));
	dateInput.value = state.selectedDate;
}

async function apiRequest(url, options = {}) {
	const headers = {
		"Content-Type": "application/json",
		...(options.headers || {}),
	};
	if (options.auth !== false && state.sessionToken) {
		headers.Authorization = `Bearer ${state.sessionToken}`;
	}

	const response = await fetch(url, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		if (response.status === 401) {
			clearSession();
			render();
		}
		throw new Error(payload.error || "Anfrage konnte nicht verarbeitet werden.");
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

