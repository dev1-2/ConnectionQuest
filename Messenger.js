const SESSION_KEY = "connection-quest-session-token-v1";
const COMPACT_BREAKPOINT = 980;

const messengerState = {
	currentUser: null,
	contacts: [],
	selectedContactId: "",
	messages: [],
	isLoadingThread: false,
	isCompactThreadView: false,
};

const elements = {
	shell: document.querySelector(".messenger-shell"),
	heroCopy: document.querySelector("#messenger-hero-copy"),
	status: document.querySelector("#messenger-status"),
	currentUser: document.querySelector("#messenger-current-user"),
	contactsCard: document.querySelector("#messenger-contacts-card"),
	contacts: document.querySelector("#messenger-contacts"),
	threadCard: document.querySelector("#messenger-thread-card"),
	threadTitle: document.querySelector("#messenger-thread-title"),
	threadMeta: document.querySelector("#messenger-thread-meta"),
	backToContacts: document.querySelector("#messenger-back-to-contacts"),
	thread: document.querySelector("#messenger-thread"),
	form: document.querySelector("#messenger-form"),
	body: document.querySelector("#messenger-body"),
	feedback: document.querySelector("#messenger-feedback"),
	submit: document.querySelector("#messenger-submit"),
};

elements.contacts.addEventListener("click", handleContactClick);
elements.form.addEventListener("submit", handleSubmit);
elements.backToContacts.addEventListener("click", handleBackToContacts);
window.addEventListener("resize", handleViewportResize, { passive: true });

initialize();

async function initialize() {
	try {
		const sessionPayload = await apiRequest("/api/cq/session");
		messengerState.currentUser = sessionPayload.currentUser || null;
		if (!messengerState.currentUser) {
			renderLoggedOut();
			return;
		}

		const contactsPayload = await apiRequest("/api/cq/messages/contacts");
		messengerState.contacts = contactsPayload.contacts || [];
		messengerState.selectedContactId = messengerState.contacts[0]?.id || "";
		messengerState.isCompactThreadView = false;
		if (messengerState.selectedContactId) {
			await loadThread(messengerState.selectedContactId);
		} else {
			renderPage();
		}
	} catch (error) {
		renderFailure(error.message);
	}
}

async function loadThread(contactId) {
	if (!contactId) {
		messengerState.messages = [];
		renderPage();
		return;
	}
	messengerState.isLoadingThread = true;
	renderPage();
	try {
		const payload = await apiRequest(`/api/cq/messages/threads/${encodeURIComponent(contactId)}`);
		messengerState.contacts = payload.contacts || messengerState.contacts;
		messengerState.messages = payload.messages || [];
		messengerState.selectedContactId = contactId;
		messengerState.isLoadingThread = false;
		setFeedback("", false);
		renderPage();
	} catch (error) {
		setFeedback(error.message, true);
		messengerState.isLoadingThread = false;
		renderPage();
	}
}

async function handleSubmit(event) {
	event.preventDefault();
	if (!messengerState.currentUser) {
		setFeedback("Bitte zuerst in Connection Quest einloggen.", true);
		return;
	}
	if (!messengerState.selectedContactId) {
		setFeedback("Bitte zuerst einen Nutzer auswaehlen.", true);
		return;
	}
	const body = elements.body.value.trim();
	if (!body) {
		setFeedback("Bitte zuerst eine Nachricht eingeben.", true);
		return;
	}
	elements.submit.disabled = true;
	setFeedback("Nachricht wird serverseitig gesendet ...", false);
	try {
		const payload = await apiRequest(`/api/cq/messages/threads/${encodeURIComponent(messengerState.selectedContactId)}`, {
			method: "POST",
			body: { body },
		});
		messengerState.contacts = payload.contacts || messengerState.contacts;
		messengerState.messages = payload.messages || messengerState.messages;
		elements.form.reset();
		setFeedback(payload.message || "Nachricht gesendet.", false);
		renderPage();
	} catch (error) {
		setFeedback(error.message, true);
	} finally {
		elements.submit.disabled = false;
	}
}

function handleContactClick(event) {
	const button = event.target.closest("button[data-contact-id]");
	if (!button || button.dataset.contactId === messengerState.selectedContactId) {
		return;
	}
	if (isCompactViewport()) {
		messengerState.isCompactThreadView = true;
		syncResponsiveView();
		scrollCardIntoView(elements.threadCard);
	}
	loadThread(button.dataset.contactId);
}

function handleBackToContacts() {
	messengerState.isCompactThreadView = false;
	syncResponsiveView();
	scrollCardIntoView(elements.contactsCard);
}

function handleViewportResize() {
	if (!isCompactViewport()) {
		messengerState.isCompactThreadView = false;
	}
	syncResponsiveView();
}

function renderLoggedOut() {
	messengerState.contacts = [];
	messengerState.messages = [];
	messengerState.selectedContactId = "";
	messengerState.isCompactThreadView = false;
	elements.heroCopy.textContent = "Der Messenger nutzt dein aktives Connection-Quest-Konto. Logge dich zuerst im Journal ein, damit du serverseitig Nachrichten senden und empfangen kannst.";
	elements.status.textContent = "Kein Nutzer aktiv.";
	elements.currentUser.classList.add("empty-state");
	elements.currentUser.textContent = "Bitte zuerst in Connection Quest einloggen oder registrieren.";
	elements.threadTitle.textContent = "Login erforderlich";
	elements.threadMeta.textContent = "Ohne aktive CQ-Session kann kein Thread geladen werden.";
	elements.thread.classList.add("empty-state");
	elements.thread.textContent = "Nach dem Login erscheinen hier deine Direktnachrichten.";
	elements.contacts.classList.add("empty-state");
	elements.contacts.textContent = "Kontakte werden nach dem Login geladen.";
	elements.form.hidden = true;
	setFeedback("", false);
	syncResponsiveView();
}

function renderFailure(message) {
	messengerState.isCompactThreadView = false;
	elements.status.textContent = message || "Messenger konnte nicht geladen werden.";
	elements.currentUser.classList.add("empty-state");
	elements.currentUser.textContent = "Der Messenger ist gerade nicht verfuegbar.";
	elements.threadTitle.textContent = "Fehler";
	elements.threadMeta.textContent = "Der Verlauf konnte nicht geladen werden.";
	elements.thread.classList.add("empty-state");
	elements.thread.textContent = "Bitte spaeter erneut versuchen.";
	elements.contacts.classList.add("empty-state");
	elements.contacts.textContent = "Kontakte konnten nicht geladen werden.";
	elements.form.hidden = true;
	setFeedback(message || "", true);
	syncResponsiveView();
}

function renderPage() {
	renderCurrentUser();
	renderContacts();
	renderThread();
	const hasContacts = messengerState.contacts.length > 0;
	elements.form.hidden = !messengerState.currentUser || !messengerState.selectedContactId || !hasContacts;
	syncResponsiveView();
	if (!messengerState.currentUser) {
		return;
	}
	elements.status.textContent = hasContacts
		? `${messengerState.contacts.length} Nutzer verfuegbar.`
		: "Noch keine anderen Nutzer vorhanden.";
}

function renderCurrentUser() {
	if (!messengerState.currentUser) {
		return;
	}
	elements.currentUser.classList.remove("empty-state");
	elements.currentUser.innerHTML = `
		<p class="eyebrow">Aktive Session</p>
		<strong>${escapeHtml(messengerState.currentUser.handle)}</strong>
		<p>Level ${messengerState.currentUser.stats.level} • Score ${messengerState.currentUser.stats.score} • Platz #${messengerState.currentUser.placement}</p>
	`;
}

function renderContacts() {
	elements.contacts.innerHTML = "";
	elements.contacts.classList.toggle("empty-state", messengerState.contacts.length === 0);
	if (!messengerState.contacts.length) {
		elements.contacts.textContent = messengerState.currentUser
			? "Sobald weitere Nutzer registriert sind, kannst du hier direkt einen Thread starten."
			: "Kontakte werden nach dem Login geladen.";
		return;
	}
	messengerState.contacts.forEach((contact) => {
		const item = document.createElement("button");
		item.type = "button";
		item.className = `contact-item${contact.id === messengerState.selectedContactId ? " is-active" : ""}`;
		item.dataset.contactId = contact.id;
		item.innerHTML = `
			<div class="contact-head">
				<div>
					<p class="eyebrow">Spieler</p>
					<h3>${escapeHtml(contact.handle)}</h3>
				</div>
				<div class="contact-meta">
					<span class="meta-chip">Level ${contact.level}</span>
					<span class="meta-chip">#${contact.placement || 0}</span>
					${contact.unreadCount ? `<span class="meta-chip meta-chip-alert">${escapeHtml(contact.unreadCount)} neu</span>` : ""}
				</div>
			</div>
			<p class="contact-preview">${escapeHtml(contact.latestMessage?.body || "Noch kein Verlauf. Du kannst die erste Nachricht senden.")}</p>
		`;
		elements.contacts.appendChild(item);
	});
}

function renderThread() {
	const selectedContact = messengerState.contacts.find((entry) => entry.id === messengerState.selectedContactId) || null;
	elements.thread.innerHTML = "";
	if (!selectedContact) {
		elements.threadTitle.textContent = messengerState.currentUser ? "Kontakt waehlen" : "Login erforderlich";
		elements.threadMeta.textContent = messengerState.currentUser
			? "Waehle links einen Nutzer aus, um einen echten Thread zu laden."
			: "Ohne aktive Session kann kein Thread geladen werden.";
		elements.thread.classList.add("empty-state");
		elements.thread.textContent = messengerState.currentUser
			? "Noch kein Kontakt ausgewaehlt."
			: "Nach dem Login erscheinen hier deine Threads.";
		return;
	}

	elements.thread.classList.toggle("empty-state", messengerState.messages.length === 0);
	elements.threadTitle.textContent = selectedContact.handle;
	elements.threadMeta.textContent = messengerState.isLoadingThread
		? "Thread wird geladen ..."
		: `Level ${selectedContact.level} • Score ${selectedContact.score} • Platz #${selectedContact.placement || 0}`;
	if (!messengerState.messages.length) {
		elements.thread.textContent = "Noch keine Nachrichten vorhanden. Schreibe die erste Direktnachricht.";
		return;
	}
	messengerState.messages.forEach((message) => {
		const item = document.createElement("article");
		item.className = `message-item ${message.isOwn ? "is-own" : "is-other"}`;
		item.innerHTML = `
			<div class="message-head">
				<div>
					<p class="eyebrow">${escapeHtml(message.isOwn ? "Du" : message.senderHandle || selectedContact.handle)}</p>
					<h3>${escapeHtml(formatDate(message.createdAt))}</h3>
				</div>
				<div class="message-meta">
					${message.isOwn ? `<span class="meta-chip">Gesendet</span>` : `<span class="meta-chip">Empfangen</span>`}
					${message.readAt && message.isOwn ? `<span class="meta-chip">Gelesen</span>` : ""}
				</div>
			</div>
			<p class="message-body">${escapeHtml(message.body)}</p>
		`;
		elements.thread.appendChild(item);
	});
	requestAnimationFrame(() => {
		elements.thread.scrollTop = elements.thread.scrollHeight;
	});
}

function syncResponsiveView() {
	const showCompactThreadView = Boolean(
		isCompactViewport()
		&& messengerState.currentUser
		&& messengerState.selectedContactId
		&& messengerState.contacts.length
		&& messengerState.isCompactThreadView
	);
	elements.shell.classList.toggle("is-compact-thread", showCompactThreadView);
	elements.backToContacts.hidden = !showCompactThreadView;
}

function isCompactViewport() {
	return window.innerWidth <= COMPACT_BREAKPOINT;
}

function scrollCardIntoView(element) {
	if (!element) {
		return;
	}
	requestAnimationFrame(() => {
		element.scrollIntoView({ behavior: "smooth", block: "start" });
	});
}

async function apiRequest(url, options = {}) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = {
		"Content-Type": "application/json",
		...(options.headers || {}),
	};
	if (sessionToken) {
		headers.Authorization = `Bearer ${sessionToken}`;
	}
	const response = await fetch(url, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Messenger-Anfrage fehlgeschlagen.");
	}
	return payload;
}

function setFeedback(message, isError) {
	elements.feedback.textContent = message || "";
	elements.feedback.classList.toggle("is-error", Boolean(isError));
	elements.feedback.classList.toggle("is-success", Boolean(message) && !isError);
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