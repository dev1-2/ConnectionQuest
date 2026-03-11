const SESSION_KEY = "connection-quest-session-token-v1";

const state = {
	sessionToken: window.localStorage.getItem(SESSION_KEY) || "",
	data: buildEmptyState(),
	admin: {
		isAdmin: false,
		adminConfigured: false,
		invites: [],
		members: [],
	},
};

const elements = {
	ratingForm: document.querySelector("#rating-form"),
	personName: document.querySelector("#person-name"),
	personRating: document.querySelector("#person-rating"),
	ratingValue: document.querySelector("#rating-value"),
	personNotes: document.querySelector("#person-notes"),
	rankFeedback: document.querySelector("#rank-feedback"),
	rankAuthNote: document.querySelector("#rank-auth-note"),
	statusTitle: document.querySelector("#status-title"),
	statusCopy: document.querySelector("#status-copy"),
	statusPills: document.querySelector("#status-pills"),
	summaryGrid: document.querySelector("#summary-grid"),
	groupGrid: document.querySelector("#group-grid"),
	directoryList: document.querySelector("#directory-list"),
	myRatings: document.querySelector("#my-ratings"),
	innerCirclePanel: document.querySelector("#inner-circle-panel"),
	adminStatus: document.querySelector("#admin-status"),
	adminLoginBlock: document.querySelector("#admin-login-block"),
	adminLoginForm: document.querySelector("#admin-login-form"),
	adminPassword: document.querySelector("#admin-password"),
	adminPanel: document.querySelector("#admin-panel"),
	inviteForm: document.querySelector("#invite-form"),
	inviteLabel: document.querySelector("#invite-label"),
	invitePassword: document.querySelector("#invite-password"),
	inviteDays: document.querySelector("#invite-days"),
	adminFeedback: document.querySelector("#admin-feedback"),
	inviteList: document.querySelector("#invite-list"),
	memberList: document.querySelector("#member-list"),
	adminLogout: document.querySelector("#admin-logout"),
};

elements.personRating.addEventListener("input", () => {
	elements.ratingValue.textContent = `${elements.personRating.value} / 10`;
});
elements.ratingForm.addEventListener("submit", handleRatingSubmit);
elements.adminLoginForm.addEventListener("submit", handleAdminLogin);
elements.inviteForm.addEventListener("submit", handleInviteCreate);
elements.adminLogout.addEventListener("click", handleAdminLogout);

initialize();

async function initialize() {
	await Promise.all([hydrateSocialRank(), hydrateAdminStatus()]);
	render();
}

async function hydrateSocialRank() {
	state.data = await apiRequest("/api/cq/social-rank");
	if (state.data.currentUserId && !state.sessionToken) {
		state.sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	}
}

async function hydrateAdminStatus() {
	const payload = await fetchJson("/api/admin/status");
	state.admin.isAdmin = Boolean(payload.auth?.isAdmin);
	state.admin.adminConfigured = Boolean(payload.auth?.adminConfigured);
	if (state.admin.isAdmin) {
		await hydrateAdminPanel();
	}
}

async function hydrateAdminPanel() {
	const payload = await fetchJson("/api/admin/inner-circle");
	state.admin.invites = payload.invites || [];
	state.admin.members = payload.members || [];
	state.admin.isAdmin = Boolean(payload.auth?.isAdmin);
	state.admin.adminConfigured = Boolean(payload.auth?.adminConfigured);
}

async function handleRatingSubmit(event) {
	event.preventDefault();
	if (!state.data.currentUserId) {
		setFeedback(elements.rankFeedback, "Bitte zuerst im Journal als Spieler einloggen.", true);
		return;
	}

	try {
		const payload = await apiRequest("/api/cq/social-rank/ratings", {
			method: "POST",
			body: {
				name: elements.personName.value.trim(),
				rating: Number(elements.personRating.value),
				notes: elements.personNotes.value.trim(),
			},
		});
		state.data = payload;
		elements.ratingForm.reset();
		elements.personRating.value = "7";
		elements.ratingValue.textContent = "7 / 10";
		setFeedback(elements.rankFeedback, payload.message, false);
		render();
	} catch (error) {
		setFeedback(elements.rankFeedback, error.message, true);
	}
}

async function handleAdminLogin(event) {
	event.preventDefault();
	const password = elements.adminPassword.value.trim();
	if (!password) {
		setFeedback(elements.adminFeedback, "Bitte Admin-Passwort eingeben.", true);
		return;
	}
	try {
		await fetchJson("/api/admin/login", { method: "POST", body: { password } });
		elements.adminPassword.value = "";
		await hydrateAdminStatus();
		setFeedback(elements.adminFeedback, "Admin aktiv.", false);
		renderAdmin();
	} catch (error) {
		setFeedback(elements.adminFeedback, error.message, true);
	}
}

async function handleInviteCreate(event) {
	event.preventDefault();
	try {
		const payload = await fetchJson("/api/admin/inner-circle/invites", {
			method: "POST",
			body: {
				label: elements.inviteLabel.value.trim(),
				password: elements.invitePassword.value.trim(),
				expiresInDays: Number(elements.inviteDays.value),
			},
		});
		state.admin.invites = payload.invites || [];
		state.admin.members = payload.members || [];
		elements.inviteForm.reset();
		elements.inviteDays.value = "14";
		setFeedback(elements.adminFeedback, `${payload.message} Code: ${payload.invite.inviteCode}`, false);
		renderAdmin();
	} catch (error) {
		setFeedback(elements.adminFeedback, error.message, true);
	}
}

async function handleAdminLogout() {
	try {
		await fetchJson("/api/admin/logout", { method: "POST" });
		state.admin.isAdmin = false;
		state.admin.invites = [];
		state.admin.members = [];
		setFeedback(elements.adminFeedback, "Admin ausgeloggt.", false);
		renderAdmin();
	} catch (error) {
		setFeedback(elements.adminFeedback, error.message, true);
	}
}

function render() {
	renderStatus();
	renderSummary();
	renderGroups();
	renderDirectory();
	renderMyRatings();
	renderInnerCircle();
	renderAdmin();
}

function renderStatus() {
	const currentUser = state.data.currentUser;
	elements.rankAuthNote.textContent = currentUser
		? `${currentUser.handle} ist aktiv und kann jetzt Personen bewerten.`
		: "Bitte zuerst im Journal einloggen, damit deine Wertung gespeichert werden kann.";
	elements.statusTitle.textContent = currentUser ? currentUser.handle : "Noch kein Spieler aktiv";
	elements.statusCopy.textContent = currentUser
		? currentUser.status?.isInnerCircle
			? "Innerer Kreis aktiv. Dein geheimer Benefit ist unten freigeschaltet."
			: "Standardstatus aktiv. Mit Admin-Invite kannst du den Inneren Kreis freischalten."
		: "Ohne Spieler-Session kannst du nur das offene soziale Ranking lesen.";
	elements.statusPills.innerHTML = "";
	const pills = currentUser
		? [
			`Level ${currentUser.stats.level}`,
			`Score ${currentUser.stats.score}`,
			currentUser.status?.isInnerCircle ? "Inner Circle" : "Standard",
		]
		: ["Gastmodus", "Nur Lesesicht"];
	pills.forEach((value) => {
		const pill = document.createElement("span");
		pill.className = "pill";
		pill.textContent = value;
		elements.statusPills.appendChild(pill);
	});
}

function renderSummary() {
	elements.summaryGrid.innerHTML = "";
	[
		{ label: "Personen", value: state.data.community?.totalPeople || 0 },
		{ label: "Ratings", value: state.data.community?.totalRatings || 0 },
		{ label: "Top Band", value: state.data.community?.topBand || "-" },
	].forEach((item) => {
		const card = document.createElement("article");
		card.innerHTML = `<p class="eyebrow">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		elements.summaryGrid.appendChild(card);
	});
}

function renderGroups() {
	elements.groupGrid.innerHTML = "";
	const groups = state.data.groups || [];
	if (!groups.length) {
		elements.groupGrid.innerHTML = '<article class="group-card"><h3>Noch leer</h3><p>Sobald erste Bewertungen eingehen, entstehen hier Ranggruppen.</p></article>';
		return;
	}
	groups.forEach((group) => {
		const card = document.createElement("article");
		card.className = "group-card";
		card.innerHTML = `<h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.blurb)}</p>`;
		const people = document.createElement("div");
		people.className = "group-people";
		group.people.forEach((person) => {
			const pill = document.createElement("span");
			pill.className = "pill";
			pill.textContent = `${person.name} ${formatScore(person.averageRating)}`;
			people.appendChild(pill);
		});
		card.appendChild(people);
		elements.groupGrid.appendChild(card);
	});
}

function renderDirectory() {
	elements.directoryList.innerHTML = "";
	const people = state.data.directory || [];
	if (!people.length) {
		elements.directoryList.innerHTML = '<article class="directory-item"><div></div><div><strong>Noch keine Personen</strong><p class="directory-meta">Sobald Bewertungen da sind, erscheint hier das Board.</p></div><div></div></article>';
		return;
	}
	people.slice(0, 14).forEach((person) => {
		const item = document.createElement("article");
		item.className = "directory-item";
		item.innerHTML = `
			<div class="directory-score">${formatScore(person.averageRating)}</div>
			<div>
				<strong>${escapeHtml(person.name)}</strong>
				<p class="directory-meta">${escapeHtml(person.rankGroup.title)} • ${person.ratingCount} Ratings</p>
			</div>
			<div class="pill">${escapeHtml(person.rankGroup.title)}</div>
		`;
		elements.directoryList.appendChild(item);
	});
}

function renderMyRatings() {
	elements.myRatings.innerHTML = "";
	const ratings = state.data.myRatings || [];
	if (!ratings.length) {
		elements.myRatings.innerHTML = '<article class="stack-item"><strong>Noch nichts bewertet</strong><p>Deine letzten Wertungen erscheinen hier.</p></article>';
		return;
	}
	ratings.forEach((rating) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(rating.name)} • ${rating.rating}/10</strong><p>${escapeHtml(rating.notes || "Keine Notiz hinterlegt.")}</p>`;
		elements.myRatings.appendChild(item);
	});
}

function renderInnerCircle() {
	const innerCircle = state.data.innerCircle || {};
	const currentUser = state.data.currentUser;
	elements.innerCirclePanel.innerHTML = "";
	if (!currentUser) {
		elements.innerCirclePanel.innerHTML = '<article class="inner-panel"><h3>Spieler-Login noetig</h3><p>Nur aktive Spieler koennen einen Invite einloesen.</p></article>';
		return;
	}
	if (innerCircle.isMember) {
		const panel = document.createElement("article");
		panel.className = "inner-panel";
		panel.innerHTML = `<h3>${escapeHtml(innerCircle.secretBenefit?.title || "Inner Circle")}</h3><p>${escapeHtml(innerCircle.secretBenefit?.copy || "Geheimer Benefit aktiv.")}</p>`;
		const targets = document.createElement("div");
		targets.className = "stack-list";
		(innerCircle.secretBenefit?.shadowTargets || []).forEach((target) => {
			const item = document.createElement("article");
			item.className = "stack-item";
			item.innerHTML = `<strong>${escapeHtml(target.name)} • ${formatScore(target.averageRating)}</strong><p>${escapeHtml(target.reason)}</p>`;
			targets.appendChild(item);
		});
		if (!targets.children.length) {
			targets.innerHTML = '<article class="stack-item"><strong>Kein Shadow Target offen</strong><p>Gerade gibt es keine unterbewerteten Spitzenkandidaten.</p></article>';
		}
		panel.appendChild(targets);
		elements.innerCirclePanel.appendChild(panel);
	} else {
		const wrapper = document.createElement("article");
		wrapper.className = "inner-panel";
		wrapper.innerHTML = `
			<h3>Zugang einloesen</h3>
			<p>${escapeHtml(innerCircle.lockedMessage || "Invite und Passwort erforderlich.")}</p>
			<form id="redeem-form" class="inline-form">
				<input id="redeem-code" type="text" placeholder="Invite-Code" required>
				<input id="redeem-password" type="password" placeholder="Passwort" required>
				<button type="submit" class="primary-button">Inneren Kreis oeffnen</button>
			</form>
			<p id="redeem-feedback" class="feedback"></p>
		`;
		elements.innerCirclePanel.appendChild(wrapper);
		wrapper.querySelector("#redeem-form").addEventListener("submit", async (event) => {
			event.preventDefault();
			const code = wrapper.querySelector("#redeem-code").value.trim();
			const password = wrapper.querySelector("#redeem-password").value.trim();
			const feedback = wrapper.querySelector("#redeem-feedback");
			try {
				const payload = await apiRequest("/api/cq/inner-circle/redeem", {
					method: "POST",
					body: { inviteCode: code, password },
				});
				state.data = payload;
				setFeedback(feedback, payload.message, false);
				render();
			} catch (error) {
				setFeedback(feedback, error.message, true);
			}
		});
	}

	const memberPanel = document.createElement("article");
	memberPanel.className = "inner-panel";
	memberPanel.innerHTML = `<h3>Mitglieder</h3><p>${innerCircle.memberCount || 0} Person(en) im hoechsten Status.</p>`;
	const memberRow = document.createElement("div");
	memberRow.className = "member-row";
	(innerCircle.members || []).forEach((member) => {
		const chip = document.createElement("span");
		chip.className = "pill";
		chip.textContent = `${member.handle} L${member.level}`;
		memberRow.appendChild(chip);
	});
	if (!memberRow.children.length) {
		memberRow.innerHTML = '<span class="pill">Noch keine Mitglieder</span>';
	}
	memberPanel.appendChild(memberRow);
	elements.innerCirclePanel.appendChild(memberPanel);
}

function renderAdmin() {
	if (!state.admin.adminConfigured) {
		elements.adminStatus.textContent = "Admin-Zugang ist nicht konfiguriert.";
		elements.adminLoginBlock.hidden = true;
		elements.adminPanel.hidden = true;
		return;
	}
	elements.adminStatus.textContent = state.admin.isAdmin
		? "Als Admin angemeldet. Invite-Erstellung ist frei."
		: "Fuer Invite-Erstellung ist Admin-Anmeldung erforderlich.";
	elements.adminLoginBlock.hidden = state.admin.isAdmin;
	elements.adminPanel.hidden = !state.admin.isAdmin;
	elements.inviteList.innerHTML = "";
	elements.memberList.innerHTML = "";
	state.admin.invites.forEach((invite) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(invite.label)}</strong><p><span class="inline-code">${escapeHtml(invite.inviteCode)}</span> • ${invite.isActive ? "aktiv" : "geschlossen"}</p>`;
		elements.inviteList.appendChild(item);
	});
	if (!state.admin.invites.length) {
		elements.inviteList.innerHTML = '<article class="stack-item"><strong>Keine Invites</strong><p>Noch keine Codes erzeugt.</p></article>';
	}
	state.admin.members.forEach((member) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(member.handle)}</strong><p>Level ${member.level} • Score ${member.score}</p>`;
		elements.memberList.appendChild(item);
	});
	if (!state.admin.members.length) {
		elements.memberList.innerHTML = '<article class="stack-item"><strong>Keine Mitglieder</strong><p>Der Innere Kreis ist noch leer.</p></article>';
	}
}

async function apiRequest(url, options = {}) {
	const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
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
		throw new Error(payload.error || "Anfrage fehlgeschlagen.");
	}
	return payload;
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		method: options.method || "GET",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", ...(options.headers || {}) },
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Anfrage fehlgeschlagen.");
	}
	return payload;
}

function setFeedback(node, message, isError) {
	node.textContent = message || "";
	node.classList.toggle("is-error", Boolean(isError));
	node.classList.toggle("is-success", Boolean(message) && !isError);
}

function formatScore(value) {
	return Number(value).toFixed(1);
}

function buildEmptyState() {
	return {
		currentUserId: null,
		currentUser: null,
		directory: [],
		groups: [],
		myRatings: [],
		community: { totalPeople: 0, totalRatings: 0, topBand: "-" },
		innerCircle: { isMember: false, memberCount: 0, members: [], secretBenefit: null, lockedMessage: "" },
	};
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}