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
	adminForm: document.querySelector("#admin-form"),
	adminToggle: document.querySelector("#admin-toggle"),
	adminBody: document.querySelector("#admin-body"),
	adminPassword: document.querySelector("#admin-password"),
	loginButton: document.querySelector("#login-button"),
	logoutButton: document.querySelector("#logout-button"),
	authStatus: document.querySelector("#auth-status"),
	controlPanel: document.querySelector(".control-panel"),
	controlLockNote: document.querySelector("#control-lock-note"),
};

const state = {
	teachers: [],
	rounds: 0,
	queue: [],
	currentPair: { left: null, right: null },
	isBusy: false,
	isAdmin: false,
	adminConfigured: false,
	adminPanelOpen: false,
};

elements.leftCard.addEventListener("click", () => handleVote("left"));
elements.rightCard.addEventListener("click", () => handleVote("right"));
elements.applyButton.addEventListener("click", applyTeacherList);
elements.resetButton.addEventListener("click", resetTournament);
elements.adminForm.addEventListener("submit", handleLogin);
elements.logoutButton.addEventListener("click", handleLogout);
elements.adminToggle.addEventListener("click", toggleAdminPanel);
window.addEventListener("keydown", handleKeyboardVote);

initializeApp();

async function initializeApp() {
	setBusy(true);
	try {
		const payload = await fetchJson("/api/state");
		applyServerState(payload.state, payload.auth);
		render();
	} catch (error) {
		renderError(error.message);
	} finally {
		setBusy(false);
	}
}

async function handleVote(side) {
	if (state.isBusy || !state.currentPair.left || !state.currentPair.right) {
		return;
	}

	setBusy(true);
	try {
		const payload = await fetchJson("/api/vote", {
			method: "POST",
			body: JSON.stringify({ side }),
		});
		applyServerState(payload.state, payload.auth);
		render(payload.message);
	} catch (error) {
		renderError(error.message);
	} finally {
		setBusy(false);
	}
}

async function applyTeacherList() {
	if (!state.isAdmin) {
		renderError("Nur Admins können Profile bearbeiten.");
		return;
	}

	const teachers = parseTeacherInput(elements.teacherInput.value);
	if (teachers.length < 2) {
		renderError("Mindestens zwei Profile werden benötigt.");
		return;
	}

	setBusy(true);
	try {
		const payload = await fetchJson("/api/teachers", {
			method: "PUT",
			body: JSON.stringify({ teachers }),
		});
		applyServerState(payload.state, payload.auth);
		render(payload.message);
	} catch (error) {
		renderError(error.message);
	} finally {
		setBusy(false);
	}
}

async function resetTournament() {
	if (!state.isAdmin) {
		renderError("Nur Admins können das Turnier zurücksetzen.");
		return;
	}

	const teachers = parseTeacherInput(elements.teacherInput.value);
	if (teachers.length < 2) {
		renderError("Mindestens zwei Profile werden benötigt.");
		return;
	}

	setBusy(true);
	try {
		const payload = await fetchJson("/api/reset", {
			method: "POST",
			body: JSON.stringify({ teachers }),
		});
		applyServerState(payload.state, payload.auth);
		render(payload.message);
	} catch (error) {
		renderError(error.message);
	} finally {
		setBusy(false);
	}
}

async function handleLogin(event) {
	event.preventDefault();
	if (state.isBusy) {
		return;
	}

	const password = elements.adminPassword.value;
	if (!password) {
		renderError("Bitte ein Admin-Passwort eingeben.");
		return;
	}

	setBusy(true);
	try {
		const payload = await fetchJson("/api/admin/login", {
			method: "POST",
			body: JSON.stringify({ password }),
		});
		state.adminPanelOpen = true;
		elements.adminPassword.value = "";
		applyServerState(payload.state, payload.auth);
		render(payload.message);
	} catch (error) {
		renderError(error.message);
	} finally {
		setBusy(false);
	}
}

async function handleLogout() {
	if (state.isBusy) {
		return;
	}

	setBusy(true);
	try {
		const payload = await fetchJson("/api/admin/logout", {
			method: "POST",
		});
		state.adminPanelOpen = false;
		applyServerState(payload.state, payload.auth);
		render(payload.message);
	} catch (error) {
		renderError(error.message);
	} finally {
		setBusy(false);
	}
}

function render(message) {
	elements.teacherInput.value = formatTeacherInput(state.teachers);
	elements.roundCount.textContent = String(state.rounds);
	elements.teacherCount.textContent = String(state.teachers.length);
	renderAuthPanel();
	renderBattle(message);
	renderRanking();
	updateControlsState();
}

function renderAuthPanel() {
	if (!state.adminConfigured) {
		state.adminPanelOpen = false;
		elements.authStatus.textContent = "Admin-Passwort ist noch nicht konfiguriert. Setze ADMIN_PASSWORD und SESSION_SECRET in Render.";
		elements.adminBody.hidden = true;
		elements.adminForm.hidden = true;
		elements.adminToggle.hidden = true;
		elements.logoutButton.hidden = true;
		return;
	}

	if (state.isAdmin) {
		elements.authStatus.textContent = "Als Admin angemeldet. Profile und Reset sind freigeschaltet.";
		elements.adminForm.hidden = true;
		elements.adminBody.hidden = !state.adminPanelOpen;
		elements.adminToggle.hidden = false;
		elements.adminToggle.textContent = state.adminPanelOpen ? "Admin schließen" : "Admin öffnen";
		elements.logoutButton.hidden = false;
		return;
	}

	elements.authStatus.textContent = "Admin-Rechte sind für Bearbeiten und Reset erforderlich.";
	elements.adminBody.hidden = !state.adminPanelOpen;
	elements.adminForm.hidden = !state.adminPanelOpen;
	elements.adminToggle.hidden = false;
	elements.adminToggle.textContent = state.adminPanelOpen ? "Admin schließen" : "Admin öffnen";
	elements.logoutButton.hidden = true;
}

function renderBattle(message) {
	const { left, right } = state.currentPair;
	if (!left || !right) {
		elements.leftCard.disabled = true;
		elements.rightCard.disabled = true;
		elements.battleStatus.textContent = state.isBusy ? "Lade Daten..." : "Bitte erst mindestens zwei Profile eintragen.";
		elements.winnerBanner.hidden = true;
		return;
	}

	elements.leftCard.disabled = state.isBusy;
	elements.rightCard.disabled = state.isBusy;
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
		.map(parseTeacherLine)
		.filter((teacher) => teacher.name.length > 0);
}

function parseTeacherLine(line) {
	if (line.includes("|")) {
		const [namePart = "", subjectPart = "", imagePart = ""] = line.split("|").map((part) => part.trim());
		return {
			name: namePart,
			subject: subjectPart,
			image: imagePart,
		};
	}

	const rawMatch = line.match(/^(.*?)\s*\(([^)]*)\)\s*,\s*(.*)$/);
	if (rawMatch) {
		return {
			name: rawMatch[1].trim(),
			subject: rawMatch[3].trim(),
			image: "",
		};
	}

	const fallbackParts = line.split(",");
	if (fallbackParts.length >= 2) {
		const subject = fallbackParts.pop().trim();
		return {
			name: fallbackParts.join(",").trim(),
			subject,
			image: "",
		};
	}

	return {
		name: line.trim(),
		subject: "",
		image: "",
	};
}

function formatTeacherInput(teachers) {
	return teachers.map((teacher) => `${teacher.name} | ${teacher.subject || ""} | ${teacher.image || ""}`).join("\n");
}

function applyServerState(nextState, auth) {
	state.teachers = Array.isArray(nextState?.teachers) ? nextState.teachers : [];
	state.rounds = Number(nextState?.rounds) || 0;
	state.queue = Array.isArray(nextState?.queue) ? nextState.queue : [];
	state.currentPair = nextState?.currentPair || { left: null, right: null };
	state.isAdmin = Boolean(auth?.isAdmin);
	state.adminConfigured = Boolean(auth?.adminConfigured);
}

function updateControlsState() {
	const locked = !state.isAdmin;
	elements.controlPanel.classList.toggle("locked", locked);
	elements.controlLockNote.hidden = !locked;
	elements.controlLockNote.textContent = state.adminConfigured
		? "Bearbeiten und Zurücksetzen ist nur mit Admin-Rechten möglich."
		: "Bearbeiten ist gesperrt, bis ADMIN_PASSWORD und SESSION_SECRET in Render gesetzt sind.";
	elements.teacherInput.disabled = locked || state.isBusy;
	elements.applyButton.disabled = locked || state.isBusy;
	elements.resetButton.disabled = locked || state.isBusy;
	elements.loginButton.disabled = state.isBusy;
	elements.adminToggle.disabled = state.isBusy;
	elements.adminPassword.disabled = state.isBusy;
	elements.logoutButton.disabled = state.isBusy;
	if (!state.adminConfigured) {
		elements.teacherInput.disabled = true;
		elements.applyButton.disabled = true;
		elements.resetButton.disabled = true;
	}
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

function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function setBusy(isBusy) {
	state.isBusy = isBusy;
	updateControlsState();
	if (isBusy) {
		elements.battleStatus.textContent = "Lade Daten...";
	}
	if (!state.currentPair.left || !state.currentPair.right) {
		elements.leftCard.disabled = true;
		elements.rightCard.disabled = true;
	}
}

function toggleAdminPanel() {
	if (state.isBusy || !state.adminConfigured) {
		return;
	}

	state.adminPanelOpen = !state.adminPanelOpen;
	render();
	if (state.adminPanelOpen && !state.isAdmin) {
		elements.adminPassword.focus();
	}
}

function handleKeyboardVote(event) {
	const tagName = event.target?.tagName;
	if (tagName === "INPUT" || tagName === "TEXTAREA") {
		return;
	}

	if (event.key === "ArrowLeft") {
		event.preventDefault();
		handleVote("left");
	}

	if (event.key === "ArrowRight") {
		event.preventDefault();
		handleVote("right");
	}
}

function renderError(message) {
	elements.winnerBanner.hidden = false;
	elements.winnerBanner.textContent = message;
	elements.battleStatus.textContent = message;
}

async function fetchJson(url, options = {}) {
	const response = await window.fetch(url, {
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			...(options.headers || {}),
		},
		...options,
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Die Anfrage konnte nicht verarbeitet werden.");
	}
	return payload;
}