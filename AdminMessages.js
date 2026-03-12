const adminMessagesState = {
	auth: { isAdmin: false, adminConfigured: false },
	messages: [],
};

const BANNER_DISMISS_KEY = "cq-dismissed-banner-v1";

const elements = {
	status: document.querySelector("#admin-messages-status"),
	logout: document.querySelector("#admin-messages-logout"),
	form: document.querySelector("#admin-message-form"),
	readonly: document.querySelector("#admin-message-readonly"),
	author: document.querySelector("#message-author"),
	category: document.querySelector("#message-category"),
	title: document.querySelector("#message-title"),
	body: document.querySelector("#message-body"),
	feedback: document.querySelector("#admin-message-feedback"),
	feed: document.querySelector("#admin-message-feed"),
};

elements.logout.addEventListener("click", handleLogout);
elements.form.addEventListener("submit", handleSubmit);
elements.feed.addEventListener("click", handleFeedClick);

initialize();

async function initialize() {
	try {
		await hydrateStatus();
		if (!adminMessagesState.auth.isAdmin) {
			window.location.replace("Admin.html");
			return;
		}
		await hydrateMessages();
		renderPage();
	} catch (error) {
		setFeedback(error.message, true);
	}
}

async function hydrateStatus() {
	const payload = await fetchJson("/api/admin/status");
	adminMessagesState.auth = payload.auth || { isAdmin: false, adminConfigured: false };
}

async function hydrateMessages() {
	const payload = await fetchJson(adminMessagesState.auth.isAdmin ? "/api/admin/messages" : "/api/messages");
	adminMessagesState.messages = payload.messages || [];
}

async function handleSubmit(event) {
	event.preventDefault();
	try {
		setFeedback("Nachricht wird gespeichert ...", false);
		const payload = await fetchJson("/api/admin/messages", {
			method: "POST",
			body: {
				authorName: elements.author.value.trim(),
				category: elements.category.value.trim(),
				title: elements.title.value.trim(),
				body: elements.body.value.trim(),
			},
		});
		adminMessagesState.messages = payload.messages || [];
		elements.title.value = "";
		elements.body.value = "";
		setFeedback(payload.message || "Gespeichert.", false);
		renderPage();
	} catch (error) {
		setFeedback(error.message, true);
	}
}

async function handleLogout() {
	try {
		await fetchJson("/api/admin/logout", { method: "POST" });
		window.location.replace("Admin.html");
	} catch (error) {
		setFeedback(error.message, true);
	}
}

function renderPage() {
	elements.status.textContent = "Admin aktiv. Neue Nachrichten werden direkt serverseitig gespeichert.";
	elements.form.hidden = false;
	elements.readonly.hidden = true;
	elements.logout.hidden = false;
	renderFeed();
}

function renderFeed() {
	elements.feed.innerHTML = "";
	elements.feed.classList.toggle("empty-state", adminMessagesState.messages.length === 0);
	if (!adminMessagesState.messages.length) {
		elements.feed.textContent = "Noch keine Admin-Nachrichten vorhanden.";
		return;
	}
	adminMessagesState.messages.forEach((entry) => {
		const item = document.createElement("article");
		item.className = "feed-item";
		item.innerHTML = `
			<div class="feed-head">
				<div>
					<p class="eyebrow">Admin Channel Post</p>
					<h3>${escapeHtml(entry.title)}</h3>
				</div>
				<div class="feed-meta">
					${entry.isBanner ? '<span class="meta-chip meta-chip-banner">Neue News</span>' : ""}
					<span class="meta-chip">${escapeHtml(entry.authorName)}</span>
					<span class="meta-chip">${escapeHtml(formatDate(entry.createdAt))}</span>
				</div>
			</div>
			<p>${escapeHtml(entry.body)}</p>
			${adminMessagesState.auth.isAdmin ? `<button class="danger-button" data-message-id="${escapeHtml(entry.id)}">Nachricht loeschen</button>` : ""}
		`;
		elements.feed.appendChild(item);
	});
}

async function handleFeedClick(event) {
	const button = event.target.closest("button[data-message-id]");
	if (!button) {
		return;
	}
	if (!window.confirm("Diese Admin-Nachricht wirklich loeschen?")) {
		return;
	}
	try {
		const payload = await fetchJson(`/api/admin/messages/${encodeURIComponent(button.dataset.messageId)}`, { method: "DELETE" });
		adminMessagesState.messages = payload.messages || [];
		setFeedback(payload.message || "Nachricht geloescht.", false);
		renderPage();
	} catch (error) {
		setFeedback(error.message, true);
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

function formatDate(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "gerade eben";
	}
	return new Intl.DateTimeFormat("de-DE", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function setFeedback(message, isError) {
	elements.feedback.textContent = message || "";
	elements.feedback.classList.toggle("is-error", Boolean(isError));
	elements.feedback.classList.toggle("is-success", Boolean(message) && !isError);
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
