const STORAGE_KEY = "teacher-matchup-state";

const DEFAULT_TEACHERS = [
	"Herr Becker | Mathematik |",
	"Frau Sommer | Deutsch |",
	"Herr Nguyen | Physik |",
	"Frau König | Englisch |",
	"Herr Demir | Geschichte |",
	"Frau Wagner | Biologie |",
	"Herr Hartmann | Informatik |",
	"Frau Aydin | Kunst |",
];

const elements = {
	roundCount: document.querySelector("#round-count"),
	teacherCount: document.querySelector("#teacher-count"),
	battleStatus: document.querySelector("#battle-status"),
	winnerBanner: document.querySelector("#winner-banner"),
	leftCard: document.querySelector("#left-card"),
	rightCard: document.querySelector("#right-card"),
	leftAvatar: document.querySelector("#left-avatar"),
	rightAvatar: document.querySelector("#right-avatar"),
	leftName: document.querySelector("#left-name"),
	rightName: document.querySelector("#right-name"),
	leftSubject: document.querySelector("#left-subject"),
	rightSubject: document.querySelector("#right-subject"),
	leftMeta: document.querySelector("#left-meta"),
	rightMeta: document.querySelector("#right-meta"),
	rankingList: document.querySelector("#ranking-list"),
	teacherInput: document.querySelector("#teacher-input"),
	applyButton: document.querySelector("#apply-button"),
	resetButton: document.querySelector("#reset-button"),
};

const state = loadState();

elements.leftCard.addEventListener("click", () => handleVote("left"));
elements.rightCard.addEventListener("click", () => handleVote("right"));
elements.applyButton.addEventListener("click", applyTeacherList);
elements.resetButton.addEventListener("click", resetTournament);

render();

function handleVote(side) {
	if (!state.currentPair.left || !state.currentPair.right) {
		return;
	}

	const winner = side === "left" ? state.currentPair.left : state.currentPair.right;
	const loser = side === "left" ? state.currentPair.right : state.currentPair.left;

	winner.wins += 1;
	winner.matches += 1;
	loser.losses += 1;
	loser.matches += 1;
	state.rounds += 1;

	advanceBattle(winner.id, loser.id);
	saveState();
	render(`${winner.name} gewinnt gegen ${loser.name}.`);
}

function applyTeacherList() {
	const teachers = parseTeacherInput(elements.teacherInput.value);
	if (teachers.length < 2) {
		elements.battleStatus.textContent = "Mindestens zwei Profile werden benötigt.";
		return;
	}

	state.teachers = teachers;
	state.rounds = 0;
	state.queue = [];
	state.currentPair = { left: null, right: null };
	setupBattle();
	saveState();
	render("Neue Profile übernommen.");
}

function resetTournament() {
	state.teachers = parseTeacherInput(elements.teacherInput.value);
	state.rounds = 0;
	state.queue = [];
	state.currentPair = { left: null, right: null };
	setupBattle();
	saveState();
	render("Turnier wurde zurückgesetzt.");
}

function setupBattle() {
	if (state.teachers.length < 2) {
		state.currentPair = { left: null, right: null };
		state.queue = [];
		return;
	}

	state.queue = shuffle(state.teachers.map((teacher) => teacher.id));
	const leftId = state.queue.shift();
	const rightId = state.queue.shift();
	state.currentPair.left = findTeacher(leftId);
	state.currentPair.right = findTeacher(rightId);
}

function advanceBattle(winnerId, loserId) {
	const winner = findTeacher(winnerId);
	const loser = findTeacher(loserId);

	state.currentPair.left = winner;

	if (loser && loser.id !== winner.id) {
		state.queue.push(loser.id);
	}

	let nextChallenger = null;
	while (state.queue.length > 0 && !nextChallenger) {
		const candidateId = state.queue.shift();
		if (candidateId !== winner.id) {
			nextChallenger = findTeacher(candidateId);
		}
	}

	if (!nextChallenger) {
		nextChallenger = state.teachers.find((teacher) => teacher.id !== winner.id) || null;
	}

	state.currentPair.right = nextChallenger;
}

function render(message) {
	elements.teacherInput.value = formatTeacherInput(state.teachers);
	elements.roundCount.textContent = String(state.rounds);
	elements.teacherCount.textContent = String(state.teachers.length);
	renderBattle(message);
	renderRanking();
}

function renderBattle(message) {
	const { left, right } = state.currentPair;
	if (!left || !right) {
		elements.leftCard.disabled = true;
		elements.rightCard.disabled = true;
		elements.battleStatus.textContent = "Bitte erst mindestens zwei Profile eintragen.";
		elements.winnerBanner.hidden = true;
		return;
	}

	elements.leftCard.disabled = false;
	elements.rightCard.disabled = false;
	elements.battleStatus.textContent = message || `${left.name} gegen ${right.name}. Wer gewinnt diese Runde?`;
	elements.winnerBanner.hidden = !message;
	elements.winnerBanner.textContent = message || "";
	paintCard(left, elements.leftAvatar, elements.leftName, elements.leftSubject, elements.leftMeta);
	paintCard(right, elements.rightAvatar, elements.rightName, elements.rightSubject, elements.rightMeta);
}

function paintCard(teacher, avatarNode, nameNode, subjectNode, metaNode) {
	nameNode.textContent = teacher.name;
	subjectNode.textContent = teacher.subject || "Ohne Fachangabe";
	metaNode.textContent = `${teacher.wins} Siege • ${teacher.matches} Duelle`;
	avatarNode.textContent = initialsFor(teacher.name);
	avatarNode.style.backgroundImage = teacher.image ? `linear-gradient(rgba(29, 31, 34, 0.15), rgba(29, 31, 34, 0.15)), url("${teacher.image}")` : "";
	avatarNode.style.backgroundColor = accentFor(teacher.name);
	avatarNode.style.color = teacher.image ? "transparent" : "rgba(255, 255, 255, 0.92)";
	avatarNode.setAttribute("aria-label", teacher.image ? `${teacher.name} Bild` : `${teacher.name} Initialen`);
}

function renderRanking() {
	const ranking = [...state.teachers].sort((left, right) => {
		if (right.wins !== left.wins) {
			return right.wins - left.wins;
		}
		if (right.matches !== left.matches) {
			return right.matches - left.matches;
		}
		return left.name.localeCompare(right.name, "de");
	});

	elements.rankingList.innerHTML = "";

	if (!ranking.length) {
		const item = document.createElement("li");
		item.className = "empty-ranking";
		item.textContent = "Noch keine Profile vorhanden.";
		elements.rankingList.appendChild(item);
		return;
	}

	ranking.forEach((teacher, index) => {
		const item = document.createElement("li");
		item.innerHTML = `
			<div>
				<div class="ranking-rank">#${index + 1}</div>
			</div>
			<div class="ranking-copy">
				<div class="ranking-name">${escapeHtml(teacher.name)}</div>
				<div class="ranking-meta">${escapeHtml(teacher.subject || "Ohne Fach")} • ${teacher.wins} Siege • ${teacher.losses} Niederlagen</div>
			</div>
		`;
		elements.rankingList.appendChild(item);
	});
}

function parseTeacherInput(input) {
	return input
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => {
			const [namePart = "", subjectPart = "", imagePart = ""] = line.split("|").map((part) => part.trim());
			return {
				id: `teacher-${index + 1}-${slugify(namePart || `profil-${index + 1}`)}`,
				name: namePart || `Profil ${index + 1}`,
				subject: subjectPart,
				image: imagePart,
				wins: 0,
				losses: 0,
				matches: 0,
			};
		});
}

function formatTeacherInput(teachers) {
	return teachers.map((teacher) => `${teacher.name} | ${teacher.subject || ""} | ${teacher.image || ""}`).join("\n");
}

function loadState() {
	const fallbackTeachers = parseTeacherInput(DEFAULT_TEACHERS.join("\n"));
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return buildInitialState(fallbackTeachers);
		}

		const parsed = JSON.parse(raw);
		if (!parsed || !Array.isArray(parsed.teachers)) {
			return buildInitialState(fallbackTeachers);
		}

		const teachers = parsed.teachers.map((teacher, index) => ({
			id: teacher.id || `teacher-${index + 1}`,
			name: teacher.name || `Profil ${index + 1}`,
			subject: teacher.subject || "",
			image: teacher.image || "",
			wins: Number(teacher.wins) || 0,
			losses: Number(teacher.losses) || 0,
			matches: Number(teacher.matches) || 0,
		}));
		const result = {
			teachers,
			rounds: Number(parsed.rounds) || 0,
			queue: Array.isArray(parsed.queue) ? parsed.queue.filter((id) => teachers.some((teacher) => teacher.id === id)) : [],
			currentPair: { left: null, right: null },
		};

		result.currentPair.left = teachers.find((teacher) => teacher.id === parsed.currentPair?.leftId) || teachers[0] || null;
		result.currentPair.right = teachers.find((teacher) => teacher.id === parsed.currentPair?.rightId) || teachers[1] || null;

		if (!result.currentPair.left || !result.currentPair.right) {
			setupStateBattle(result);
		}

		return result;
	} catch {
		return buildInitialState(fallbackTeachers);
	}
}

function buildInitialState(teachers) {
	const initialState = {
		teachers,
		rounds: 0,
		queue: [],
		currentPair: { left: null, right: null },
	};
	setupStateBattle(initialState);
	return initialState;
}

function setupStateBattle(targetState) {
	if (targetState.teachers.length < 2) {
		targetState.currentPair = { left: null, right: null };
		targetState.queue = [];
		return;
	}

	targetState.queue = shuffle(targetState.teachers.map((teacher) => teacher.id));
	targetState.currentPair.left = targetState.teachers.find((teacher) => teacher.id === targetState.queue.shift()) || null;
	targetState.currentPair.right = targetState.teachers.find((teacher) => teacher.id === targetState.queue.shift()) || null;
	if (!targetState.currentPair.left || !targetState.currentPair.right) {
		targetState.currentPair.left = targetState.teachers[0] || null;
		targetState.currentPair.right = targetState.teachers[1] || null;
	}
	targetState.queue = targetState.queue.filter(
		(id) => id !== targetState.currentPair.left?.id && id !== targetState.currentPair.right?.id,
	);
	if (!targetState.queue.length) {
		targetState.queue = shuffle(
			targetState.teachers
				.map((teacher) => teacher.id)
				.filter((id) => id !== targetState.currentPair.left?.id && id !== targetState.currentPair.right?.id),
		);
	}
}

function saveState() {
	window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			teachers: state.teachers,
			rounds: state.rounds,
			queue: state.queue,
			currentPair: {
				leftId: state.currentPair.left?.id || null,
				rightId: state.currentPair.right?.id || null,
			},
		}),
	);
}

function findTeacher(id) {
	return state.teachers.find((teacher) => teacher.id === id) || null;
}

function shuffle(items) {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
	}
	return result;
}

function initialsFor(name) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() || "")
		.join("") || "?";
}

function accentFor(name) {
	const palette = ["#d95d39", "#2c8c6b", "#1f365c", "#9a4d9f", "#d58a2f", "#387aa3"];
	let total = 0;
	for (const char of name) {
		total += char.charCodeAt(0);
	}
	return palette[total % palette.length];
}

function slugify(value) {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") || "profil";
}

function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}