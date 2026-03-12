const BANNER_DISMISS_KEY = "cq-dismissed-banner-v1";

const adminChannelState = {
	messages: [],
};

const elements = {
	status: document.querySelector("#admin-channel-status"),
	highlight: document.querySelector("#admin-channel-highlight"),
	feed: document.querySelector("#admin-channel-feed"),
};

initialize();

async function initialize() {
	try {
		const payload = await fetchJson("/api/messages");
		adminChannelState.messages = payload.messages || [];
		if (adminChannelState.messages[0]?.id) {
			window.localStorage.setItem(BANNER_DISMISS_KEY, String(adminChannelState.messages[0].id));
		}
		renderPage();
	} catch (error) {
		elements.status.textContent = error.message || "Mitteilungen konnten nicht geladen werden.";
		elements.highlight.textContent = "Die Ankuendigungen sind gerade nicht erreichbar.";
		elements.feed.textContent = "Bitte spaeter erneut versuchen.";
	}
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
	const preview = latest.body.length > 220 ? `${latest.body.slice(0, 220).trim()}...` : latest.body;
	elements.highlight.classList.remove("empty-state");
	elements.highlight.innerHTML = `
		<p class="eyebrow">Neueste Mitteilung</p>
		<h3>${escapeHtml(latest.title)}</h3>
		<div class="feed-meta">
			<span class="meta-chip meta-chip-hero">${escapeHtml(latest.authorName)}</span>
			<span class="meta-chip">${escapeHtml(formatDate(latest.createdAt))}</span>
		</div>
		<p>${escapeHtml(preview)}</p>
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
		item.innerHTML = `
			<div class="feed-head">
				<div>
					<p class="eyebrow">Mitteilung</p>
					<h3>${escapeHtml(entry.title)}</h3>
				</div>
				<div class="feed-meta">
					<span class="meta-chip">${escapeHtml(entry.authorName)}</span>
					<span class="meta-chip">${escapeHtml(formatDate(entry.createdAt))}</span>
				</div>
			</div>
			<p>${escapeHtml(entry.body)}</p>
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
