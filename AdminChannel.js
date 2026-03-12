const BANNER_DISMISS_KEY = "cq-dismissed-banner-v1";
const REFRESH_INTERVAL_MS = 60_000;

const adminChannelState = {
	messages: [],
};

const elements = {
	status: document.querySelector("#admin-channel-status"),
	highlight: document.querySelector("#admin-channel-highlight"),
	feed: document.querySelector("#admin-channel-feed"),
	loading: document.querySelector("#channel-loading"),
};

initialize();
setInterval(refresh, REFRESH_INTERVAL_MS);

async function initialize() {
	setLoading(true);
	try {
		const payload = await fetchJson("/api/messages");
		adminChannelState.messages = payload.messages || [];
		if (adminChannelState.messages[0]?.id) {
			window.localStorage.setItem(BANNER_DISMISS_KEY, String(adminChannelState.messages[0].id));
		}
		renderPage();
	} catch (error) {
		elements.status.textContent = error.message || "Mitteilungen konnten nicht geladen werden.";
		elements.highlight.classList.add("empty-state");
		elements.highlight.textContent = "Die Mitteilungen sind gerade nicht erreichbar.";
		elements.feed.classList.add("empty-state");
		elements.feed.textContent = "Bitte spaeter erneut versuchen.";
	} finally {
		setLoading(false);
	}
}

async function refresh() {
	try {
		const payload = await fetchJson("/api/messages");
		adminChannelState.messages = payload.messages || [];
		renderPage();
	} catch {
		// silent – Nutzer sehen noch den letzten Stand
	}
}

function setLoading(isLoading) {
	if (elements.loading) elements.loading.hidden = !isLoading;
	elements.feed.setAttribute("aria-busy", String(isLoading));
}

function isNew(dateStr) {
	const date = new Date(dateStr);
	return !Number.isNaN(date.getTime()) && Date.now() - date.getTime() < 86_400_000;
}

function renderPage() {
	const total = adminChannelState.messages.length;
	elements.status.textContent = total
		? `${total} Mitteilung${total === 1 ? "" : "en"} verfuegbar.`
		: "Noch keine Mitteilungen vorhanden.";
	renderHighlight();
	renderFeed();
}

function renderHighlight() {
	const latest = adminChannelState.messages[0];
	if (!latest) {
		elements.highlight.classList.add("empty-state");
		elements.highlight.textContent = "Noch keine Mitteilungen vorhanden.";
		return;
	}
	elements.highlight.classList.remove("empty-state");
	elements.highlight.innerHTML = `
		${isNew(latest.createdAt) ? '<span class="badge-new">Neu</span>' : ""}
		<p class="eyebrow">${latest.category ? escapeHtml(latest.category) : "Neueste Mitteilung"}</p>
		<h3>${escapeHtml(latest.title)}</h3>
		<div class="feed-meta">
			<span class="meta-chip meta-chip-hero">${escapeHtml(latest.authorName)}</span>
			<span class="meta-chip">${escapeHtml(formatDate(latest.createdAt))}</span>
		</div>
		<p class="highlight-body">${escapeHtml(latest.body)}</p>
	`;
}

function renderFeed() {
	elements.feed.innerHTML = "";
	elements.feed.classList.toggle("empty-state", adminChannelState.messages.length === 0);
	if (!adminChannelState.messages.length) {
		elements.feed.textContent = "Noch keine Mitteilungen vorhanden.";
		return;
	}
	adminChannelState.messages.forEach((entry) => {
		const item = document.createElement("article");
		item.className = "feed-item";
		item.setAttribute("aria-label", entry.title);
		item.innerHTML = `
			<div class="feed-head">
				<div class="feed-title-block">
					${isNew(entry.createdAt) ? '<span class="badge-new">Neu</span>' : ""}
					${entry.category ? `<p class="eyebrow">${escapeHtml(entry.category)}</p>` : ""}
					<h3>${escapeHtml(entry.title)}</h3>
				</div>
				<div class="feed-meta">
					<span class="meta-chip meta-chip-author">${escapeHtml(entry.authorName)}</span>
					<time class="meta-chip" datetime="${escapeHtml(entry.createdAt)}">${escapeHtml(formatDate(entry.createdAt))}</time>
				</div>
			</div>
			<p class="feed-body">${escapeHtml(entry.body)}</p>
		`;
		elements.feed.appendChild(item);
	});
}

async function fetchJson(url) {
	const response = await fetch(url, {
		method: "GET",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
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

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
