const STORAGE_KEY = "connection-quest-entries";

const ACHIEVEMENTS = [
	{
		id: "first-entry",
		title: "First Contact",
		icon: "01",
		description: "Speichere den ersten Eintrag.",
		unlocked: (stats) => stats.totalEntries >= 1,
	},
	{
		id: "three-connections",
		title: "Social Radar",
		icon: "02",
		description: "Erfasse 3 verschiedene Namen.",
		unlocked: (stats) => stats.uniqueConnections >= 3,
	},
	{
		id: "variety-run",
		title: "Variety Run",
		icon: "03",
		description: "Nutze mindestens 4 verschiedene Moment-Typen.",
		unlocked: (stats) => stats.typeVariety >= 4,
	},
	{
		id: "streak-starter",
		title: "Consistency Spark",
		icon: "04",
		description: "Schaffe eine 3-Tage-Serie mit Einträgen.",
		unlocked: (stats) => stats.currentStreak >= 3,
	},
	{
		id: "power-month",
		title: "Power Month",
		icon: "05",
		description: "Lege 8 Einträge in einem Monat an.",
		unlocked: (stats) => stats.bestMonthCount >= 8,
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
	entries: loadEntries(),
	selectedDate: todayString(),
	visibleMonth: startOfMonth(new Date()),
};

const form = document.querySelector("#entry-form");
const nameInput = document.querySelector("#name");
const dateInput = document.querySelector("#date");
const typeInput = document.querySelector("#type");
const notesInput = document.querySelector("#notes");
const calendarGrid = document.querySelector("#calendar-grid");
const calendarLabel = document.querySelector("#calendar-label");
const selectedDateLabel = document.querySelector("#selected-date-label");
const selectedDateSummary = document.querySelector("#selected-date-summary");
const selectedDayList = document.querySelector("#selected-day-list");
const recentList = document.querySelector("#recent-list");
const achievementList = document.querySelector("#achievement-list");
const entryTemplate = document.querySelector("#entry-template");

document.querySelector("#prev-month").addEventListener("click", () => changeMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => changeMonth(1));
document.querySelector("#today-btn").addEventListener("click", jumpToToday);
document.querySelector("#clear-all").addEventListener("click", clearAllEntries);
form.addEventListener("submit", handleSubmit);

dateInput.value = state.selectedDate;
render();

function handleSubmit(event) {
	event.preventDefault();

	const name = nameInput.value.trim();
	const date = dateInput.value;
	const type = typeInput.value;
	const notes = notesInput.value.trim();

	if (!name || !date || !type) {
		return;
	}

	state.entries.unshift({
		id: crypto.randomUUID(),
		name,
		date,
		type,
		notes,
		createdAt: Date.now(),
	});

	state.selectedDate = date;
	state.visibleMonth = startOfMonth(new Date(date));
	saveEntries(state.entries);
	form.reset();
	dateInput.value = state.selectedDate;
	typeInput.value = "Chat";
	render();
}

function clearAllEntries() {
	if (!state.entries.length) {
		return;
	}

	const confirmed = window.confirm("Wirklich alle Einträge löschen?");
	if (!confirmed) {
		return;
	}

	state.entries = [];
	saveEntries(state.entries);
	state.selectedDate = todayString();
	state.visibleMonth = startOfMonth(new Date());
	dateInput.value = state.selectedDate;
	render();
}

function deleteEntry(id) {
	state.entries = state.entries.filter((entry) => entry.id !== id);
	saveEntries(state.entries);
	render();
}

function render() {
	const stats = buildStats(state.entries);
	renderStats(stats);
	renderCalendar();
	renderSelectedDay();
	renderAchievements(stats);
	renderRecentEntries();
}

function renderStats(stats) {
	document.querySelector("#unique-count").textContent = String(stats.uniqueConnections);
	document.querySelector("#entry-count").textContent = String(stats.totalEntries);
	document.querySelector("#streak-count").textContent = `${stats.currentStreak} ${stats.currentStreak === 1 ? "Tag" : "Tage"}`;
	document.querySelector("#achievement-count").textContent = String(stats.unlockedAchievements);

	document.querySelector("#unique-copy").textContent =
		stats.uniqueConnections > 0 ? `Mit ${stats.uniqueConnections} verschiedenen Namen geloggt.` : "Noch keine Namen erfasst.";
	document.querySelector("#entry-copy").textContent =
		stats.totalEntries > 0 ? `Letzter Log: ${formatDate(stats.latestDate)}` : "Dein Journal wartet auf den ersten Log.";
	document.querySelector("#streak-copy").textContent =
		stats.currentStreak > 0 ? `Aktiv an ${stats.currentStreak} Tagen in Folge.` : "Noch keine Aktivität in Folge.";
	document.querySelector("#achievement-copy").textContent =
		stats.unlockedAchievements > 0 ? `${stats.unlockedAchievements} von ${ACHIEVEMENTS.length} Badges aktiviert.` : "Keine Badges freigeschaltet.";

	document.querySelector("#level-value").textContent = String(stats.level);
	document.querySelector("#xp-value").textContent = `${stats.xp} XP`;
	document.querySelector("#progress-text").textContent = `${stats.xpIntoLevel} / ${stats.xpToNextLevel} XP`;
	document.querySelector("#progress-fill").style.width = `${stats.progressPercent}%`;
	document.querySelector("#level-note").textContent = stats.levelMessage;
}

function renderCalendar() {
	calendarGrid.innerHTML = "";
	calendarLabel.textContent = monthFormatter(state.visibleMonth);

	const monthStart = startOfMonth(state.visibleMonth);
	const startWeekday = (monthStart.getDay() + 6) % 7;
	const gridStart = addDays(monthStart, -startWeekday);
	const entriesByDate = groupEntriesByDate(state.entries);

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
			<small>${items.length ? `${items.length} Log${items.length > 1 ? "s" : ""}` : ""}</small>
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

function renderSelectedDay() {
	const dayEntries = state.entries
		.filter((entry) => entry.date === state.selectedDate)
		.sort((left, right) => right.createdAt - left.createdAt);

	selectedDateLabel.textContent = formatDate(state.selectedDate);
	selectedDateSummary.textContent = dayEntries.length
		? `${dayEntries.length} Eintrag${dayEntries.length > 1 ? "e" : ""} an diesem Tag.`
		: "Noch keine Einträge für diesen Tag.";

	selectedDayList.innerHTML = "";
	selectedDayList.classList.toggle("empty-state", dayEntries.length === 0);

	if (!dayEntries.length) {
		selectedDayList.textContent = "Noch keine Einträge für diesen Tag.";
		return;
	}

	dayEntries.forEach((entry) => {
		selectedDayList.appendChild(buildEntryNode(entry));
	});
}

function renderAchievements(stats) {
	achievementList.innerHTML = "";

	ACHIEVEMENTS.forEach((achievement) => {
		const unlocked = achievement.unlocked(stats);
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

function renderRecentEntries() {
	recentList.innerHTML = "";
	recentList.classList.toggle("empty-state", state.entries.length === 0);

	if (!state.entries.length) {
		recentList.textContent = "Noch keine Einträge vorhanden.";
		return;
	}

	state.entries
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

function buildStats(entries) {
	const uniqueConnections = new Set(entries.map((entry) => entry.name.toLowerCase())).size;
	const typeVariety = new Set(entries.map((entry) => entry.type)).size;
	const dailyKeys = Array.from(new Set(entries.map((entry) => entry.date))).sort((left, right) => right.localeCompare(left));
	const currentStreak = calculateCurrentStreak(dailyKeys);
	const bestMonthCount = calculateBestMonthCount(entries);
	const latestDate = entries.length ? entries.reduce((latest, entry) => entry.date > latest ? entry.date : latest, entries[0].date) : null;

	const baseXp = (entries.length * 20) + (uniqueConnections * 35) + (typeVariety * 25) + (currentStreak * 15);
	const level = Math.max(1, Math.floor(baseXp / 120) + 1);
	const xpIntoLevel = baseXp % 120;
	const xpToNextLevel = 120;
	const unlockedAchievements = ACHIEVEMENTS.filter((achievement) => achievement.unlocked({
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		level,
	})).length;

	return {
		totalEntries: entries.length,
		uniqueConnections,
		typeVariety,
		currentStreak,
		bestMonthCount,
		latestDate,
		xp: baseXp,
		level,
		xpIntoLevel,
		xpToNextLevel,
		progressPercent: Math.round((xpIntoLevel / xpToNextLevel) * 100),
		unlockedAchievements,
		levelMessage: buildLevelMessage(level, entries.length),
	};
}

function buildLevelMessage(level, totalEntries) {
	if (totalEntries === 0) {
		return "Starte mit dem ersten Eintrag.";
	}
	if (level < 3) {
		return "Momentum baut sich auf. Noch ein paar Logs bis zur nächsten Stufe.";
	}
	if (level < 5) {
		return "Stabile Serie. Der Tracker sammelt langsam echte Historie.";
	}
	return "Starke Aktivität. Dein Board sieht bereits nach Endgame aus.";
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

function loadEntries() {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveEntries(entries) {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
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
