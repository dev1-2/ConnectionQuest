const adminState = {
	auth: { isAdmin: false, adminConfigured: false },
	overview: null,
	invites: [],
	members: [],
	players: [],
	blogPosts: [],
};

const adminElements = {
	status: document.querySelector("#admin-status"),
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
	messages: document.querySelector("#admin-messages"),
	playerList: document.querySelector("#admin-player-list"),
	blogList: document.querySelector("#admin-blog-list"),
};

adminElements.logout.addEventListener("click", handleAdminLogout);
adminElements.inviteForm.addEventListener("submit", handleInviteCreate);
adminElements.messages.addEventListener("click", handleAdminActionClick);
adminElements.playerList.addEventListener("click", handleAdminActionClick);
adminElements.blogList.addEventListener("click", handleAdminActionClick);

initializeAdminPage();

async function initializeAdminPage() {
	try {
		await hydrateAdminStatus();
		if (!adminState.auth.isAdmin) {
			window.location.replace("Admin.html");
			return;
		}
		await hydrateAdminData();
		renderAdminPage();
	} catch (error) {
		setFeedback(adminElements.feedback, error.message, true);
	}
}

async function hydrateAdminStatus() {
	const payload = await fetchJson("/api/admin/status");
	adminState.auth = payload.auth || { isAdmin: false, adminConfigured: false };
}

async function hydrateAdminData() {
	const [overviewPayload, innerCirclePayload, moderationPayload] = await Promise.all([
		fetchJson("/api/admin/overview"),
		fetchJson("/api/admin/inner-circle"),
		fetchJson("/api/admin/moderation"),
	]);
	adminState.overview = overviewPayload.overview || null;
	adminState.invites = innerCirclePayload.invites || [];
	adminState.members = innerCirclePayload.members || [];
	adminState.players = moderationPayload.players || [];
	adminState.blogPosts = moderationPayload.blogPosts || [];
}

async function handleAdminLogout() {
	try {
		await fetchJson("/api/admin/logout", { method: "POST" });
		window.location.replace("Admin.html");
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
	renderMessages();
	renderPlayers();
	renderBlogPosts();
}

function renderAuth() {
	adminElements.status.textContent = adminState.auth.isAdmin
		? "Admin-Sitzung aktiv. Dieses Dashboard wird serverseitig nur an angemeldete Admins ausgeliefert."
		: "Keine aktive Admin-Sitzung.";
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
		{ label: "Admin Messages", value: stats.adminMessages },
		{ label: "Blog Posts", value: stats.blogPosts },
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

function renderMessages() {
	adminElements.messages.innerHTML = "";
	const messages = adminState.overview?.recentAdminMessages || [];
	if (!messages.length) {
		adminElements.messages.innerHTML = '<article class="stack-item"><strong>Keine Nachrichten</strong><p>Neue Admin-Posts erscheinen hier nach dem ersten Eintrag.</p></article>';
		return;
	}
	messages.forEach((entry) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.category)} • ${escapeHtml(entry.authorName)} • ${formatRelativeTime(entry.createdAt)}</p><button class="danger-button" data-action="delete-message" data-id="${escapeHtml(entry.id)}">Nachricht loeschen</button>`;
		adminElements.messages.appendChild(item);
	});
}

function renderPlayers() {
	adminElements.playerList.innerHTML = "";
	if (!adminState.players.length) {
		adminElements.playerList.innerHTML = '<article class="stack-item"><strong>Keine Spieler</strong><p>Sobald Konten existieren, erscheinen sie hier.</p></article>';
		return;
	}
	adminState.players.forEach((player) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>#${player.placement || 0} ${escapeHtml(player.handle)}</strong><p>${escapeHtml(player.statusTier)} • Score ${player.score} • Level ${player.level} • ${player.totalEntries} Logs • ${player.gameSessions} Games</p><button class="danger-button" data-action="delete-player" data-id="${escapeHtml(player.id)}" data-label="${escapeHtml(player.handle)}">Account loeschen</button>`;
		adminElements.playerList.appendChild(item);
	});
}

function renderBlogPosts() {
	adminElements.blogList.innerHTML = "";
	if (!adminState.blogPosts.length) {
		adminElements.blogList.innerHTML = '<article class="stack-item"><strong>Keine Blog-Posts</strong><p>Oeffentliche Blog-Posts erscheinen hier zur Moderation.</p></article>';
		return;
	}
	adminState.blogPosts.forEach((post) => {
		const item = document.createElement("article");
		item.className = "stack-item";
		item.innerHTML = `<strong>${escapeHtml(post.title)}</strong><p>${escapeHtml(post.authorName)} • ${formatRelativeTime(post.createdAt)} • ${escapeHtml(post.body.slice(0, 120))}${post.body.length > 120 ? "..." : ""}</p><button class="danger-button" data-action="delete-blog" data-id="${escapeHtml(post.id)}">Blog-Post loeschen</button>`;
		adminElements.blogList.appendChild(item);
	});
}

async function handleAdminActionClick(event) {
	const button = event.target.closest("button[data-action]");
	if (!button) {
		return;
	}
	const action = button.dataset.action;
	const id = button.dataset.id || "";
	const label = button.dataset.label || "diesen Eintrag";
	try {
		if (action === "delete-message") {
			if (!window.confirm("Diese Admin-Nachricht wirklich loeschen?")) {
				return;
			}
			const payload = await fetchJson(`/api/admin/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
			if (adminState.overview) {
				adminState.overview.recentAdminMessages = payload.messages || [];
				if (adminState.overview.stats) {
					adminState.overview.stats.adminMessages = Math.max(0, Number(adminState.overview.stats.adminMessages || 0) - 1);
				}
			}
			setFeedback(adminElements.feedback, payload.message, false);
			renderMessages();
			renderOverview();
			return;
		}

		if (action === "delete-player") {
			if (!window.confirm(`Den Account von ${label} wirklich dauerhaft loeschen?`)) {
				return;
			}
			const payload = await fetchJson(`/api/admin/players/${encodeURIComponent(id)}`, { method: "DELETE" });
			adminState.players = payload.players || [];
			adminState.overview = payload.overview || adminState.overview;
			setFeedback(adminElements.feedback, payload.message, false);
			renderAdminPage();
			return;
		}

		if (action === "delete-blog") {
			if (!window.confirm("Diesen Blog-Post wirklich loeschen?")) {
				return;
			}
			const payload = await fetchJson(`/api/admin/blog-posts/${encodeURIComponent(id)}`, { method: "DELETE" });
			adminState.blogPosts = payload.blogPosts || [];
			if (adminState.overview?.stats) {
				adminState.overview.stats.blogPosts = adminState.blogPosts.length;
			}
			setFeedback(adminElements.feedback, payload.message, false);
			renderBlogPosts();
			renderOverview();
		}
	} catch (error) {
		setFeedback(adminElements.feedback, error.message, true);
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
		if (response.status === 401) {
			window.location.replace("Admin.html");
		}
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