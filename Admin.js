const adminState = {
	auth: { isAdmin: false, adminConfigured: false },
	overview: null,
	invites: [],
	members: [],
};

const adminElements = {
	status: document.querySelector("#admin-status"),
	loginForm: document.querySelector("#admin-login-form"),
	password: document.querySelector("#admin-password"),
	logout: document.querySelector("#admin-logout"),
	feedback: document.querySelector("#admin-feedback"),
	overviewGrid: document.querySelector("#overview-grid"),
	recentPlayers: document.querySelector("#recent-players"),
	topPlayers: document.querySelector("#top-players"),
	inviteForm: document.querySelector("#invite-form"),
	inviteLabel: document.querySelector("#invite-label"),
	invitePassword: document.querySelector("#invite-password"),
	inviteDays: document.querySelector("#invite-days"),
	inviteFeedback: document.querySelector("#invite-feedback"),
	inviteList: document.querySelector("#invite-list"),
	memberList: document.querySelector("#member-list"),
};

adminElements.loginForm.addEventListener("submit", handleAdminLogin);
adminElements.logout.addEventListener("click", handleAdminLogout);
adminElements.inviteForm.addEventListener("submit", handleInviteCreate);

initializeAdminPage();

async function initializeAdminPage() {
	await hydrateAdminStatus();
	if (adminState.auth.isAdmin) {
		await hydrateAdminData();
	}
	renderAdminPage();
}

async function hydrateAdminStatus() {
	const payload = await fetchJson("/api/admin/status");
	adminState.auth = payload.auth || { isAdmin: false, adminConfigured: false };
}

async function hydrateAdminData() {
	const [overviewPayload, innerCirclePayload] = await Promise.all([
		fetchJson("/api/admin/overview"),
		fetchJson("/api/admin/inner-circle"),
	]);
	adminState.overview = overviewPayload.overview || null;
	adminState.invites = innerCirclePayload.invites || [];
	adminState.members = innerCirclePayload.members || [];
}

async function handleAdminLogin(event) {
	event.preventDefault();
	const password = adminElements.password.value.trim();
	if (!password) {
		setFeedback(adminElements.feedback, "Bitte Admin-Passwort eingeben.", true);
		return;
	}
	try {
		await fetchJson("/api/admin/login", { method: "POST", body: { password } });
		adminElements.password.value = "";
		await hydrateAdminStatus();
		await hydrateAdminData();
		setFeedback(adminElements.feedback, "Admin aktiv.", false);
		renderAdminPage();
	} catch (error) {
		setFeedback(adminElements.feedback, error.message, true);
	}
}

async function handleAdminLogout() {
	try {
		await fetchJson("/api/admin/logout", { method: "POST" });
		adminState.auth = { isAdmin: false, adminConfigured: adminState.auth.adminConfigured };
		adminState.overview = null;
		adminState.invites = [];
		adminState.members = [];
		setFeedback(adminElements.feedback, "Admin ausgeloggt.", false);
		renderAdminPage();
	} catch (error) {
		setFeedback(adminElements.feedback, error.message, true);
	}
}

async function handleInviteCreate(event) {
	event.preventDefault();
	try {
		const payload = await fetchJson("/api/admin/inner-circle/invites", {
			method: "POST",
			body: {
				label: adminElements.inviteLabel.value.trim(),
				password: adminElements.invitePassword.value.trim(),
				expiresInDays: Number(adminElements.inviteDays.value),
			},
		});
		adminState.invites = payload.invites || [];
		adminState.members = payload.members || [];
		adminElements.inviteForm.reset();
		adminElements.inviteDays.value = "14";
		setFeedback(adminElements.inviteFeedback, `${payload.message} Code: ${payload.invite.inviteCode}`, false);
		renderAdminPage();
	} catch (error) {
		setFeedback(adminElements.inviteFeedback, error.message, true);
	}
}

function renderAdminPage() {
	renderAuth();
	renderOverview();
	renderRecentPlayers();
	renderTopPlayers();
	renderInnerCircle();
}

function renderAuth() {
	if (!adminState.auth.adminConfigured) {
		adminElements.status.textContent = "Admin-Zugang ist nicht konfiguriert.";
		adminElements.loginForm.hidden = true;
		adminElements.logout.hidden = true;
		adminElements.inviteForm.hidden = true;
		return;
	}
	adminElements.status.textContent = adminState.auth.isAdmin
		? "Als Admin angemeldet. Alle Verwaltungsbereiche sind offen."
		: "Bitte als Admin anmelden, um die Verwaltung zu oeffnen.";
	adminElements.loginForm.hidden = false;
	adminElements.logout.hidden = !adminState.auth.isAdmin;
	adminElements.inviteForm.hidden = !adminState.auth.isAdmin;
}

function renderOverview() {
	adminElements.overviewGrid.innerHTML = "";
	if (!adminState.overview) {
		adminElements.overviewGrid.innerHTML = '<article><p class="eyebrow">Locked</p><strong>Admin Login noetig</strong></article>';
		return;
	}
	const stats = adminState.overview.stats || {};
	[
		{ label: "Spieler", value: stats.players },
		{ label: "Entries", value: stats.entries },
		{ label: "Ratings", value: stats.ratings },
		{ label: "Invites", value: stats.invites },
		{ label: "Social People", value: stats.people },
		{ label: "Inner Circle", value: stats.innerCircleMembers },
		{ label: "Teacher Profiles", value: stats.teacherProfiles },
		{ label: "System", value: "online" },
		].forEach((item) => {
		const card = document.createElement("article");
		card.innerHTML = `<p class="eyebrow">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value ?? 0)}</strong>`;
		adminElements.overviewGrid.appendChild(card);
	});
}

function renderRecentPlayers() {
	adminElements.recentPlayers.innerHTML = "";
	const players = adminState.overview?.recentPlayers || [];
	if (!players.length) {
		adminElements.recentPlayers.innerHTML = '<article class="stack-item"><strong>Keine Daten</strong><p>Nach Admin-Login erscheinen hier die letzten Logins.</p></article>';
		return;
	}
	players.forEach((player) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(player.handle)}</strong><p>${escapeHtml(player.statusTier)} • ${formatRelativeTime(player.lastLoginAt)}</p>`;
		adminElements.recentPlayers.appendChild(item);
	});
}

function renderTopPlayers() {
	adminElements.topPlayers.innerHTML = "";
	const players = adminState.overview?.topPlayers || [];
	if (!players.length) {
		adminElements.topPlayers.innerHTML = '<article class="stack-item"><strong>Keine Daten</strong><p>Top-Spieler erscheinen nach Admin-Login.</p></article>';
		return;
	}
	players.forEach((player) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>#${player.placement} ${escapeHtml(player.handle)}</strong><p>Score ${player.score} • Level ${player.level} • ${escapeHtml(player.statusTier)}</p>`;
		adminElements.topPlayers.appendChild(item);
	});
}

function renderInnerCircle() {
	adminElements.inviteList.innerHTML = "";
	adminElements.memberList.innerHTML = "";
	(adminState.invites || []).forEach((invite) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(invite.label)}</strong><p>${escapeHtml(invite.inviteCode)} • ${invite.isActive ? "aktiv" : "geschlossen"}</p>`;
		adminElements.inviteList.appendChild(item);
	});
	if (!adminState.invites.length) {
		adminElements.inviteList.innerHTML = '<article class="stack-item"><strong>Keine Invites</strong><p>Neue Codes werden hier gesammelt.</p></article>';
	}
	(adminState.members || []).forEach((member) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(member.handle)}</strong><p>Level ${member.level} • Score ${member.score}</p>`;
		adminElements.memberList.appendChild(item);
	});
	if (!adminState.members.length) {
		adminElements.memberList.innerHTML = '<article class="stack-item"><strong>Keine Mitglieder</strong><p>Der Innere Kreis ist noch leer.</p></article>';
	}
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

function formatRelativeTime(value) {
	if (!value) {
		return "keine Aktivitaet";
	}
	const diff = Date.now() - new Date(value).getTime();
	const hours = Math.round(diff / (1000 * 60 * 60));
	if (hours < 1) {
		return "gerade eben";
	}
	if (hours < 24) {
		return `vor ${hours}h`;
	}
	return `vor ${Math.round(hours / 24)}d`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}