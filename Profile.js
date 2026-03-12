const SESSION_KEY = "connection-quest-session-token-v1";

const deleteElements = {
	form: document.querySelector("#delete-account-form"),
	pin: document.querySelector("#delete-account-pin"),
	feedback: document.querySelector("#delete-account-feedback"),
	button: document.querySelector("#delete-account-button"),
};

deleteElements.form.addEventListener("submit", handleDeleteAccount);

initialize();

async function initialize() {
	try {
		const [sessionPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/session"),
			apiRequest("/api/cq/pulse"),
		]);
		renderProfile(sessionPayload.currentUser, pulsePayload || {});
	} catch (error) {
		renderProfile(null, {});
		document.querySelector("#profile-copy").textContent = error.message;
	}
}

function renderProfile(currentUser, pulse) {
	const stats = currentUser?.stats || buildEmptyStats();
	document.querySelector("#profile-handle").textContent = currentUser?.handle || "Kein Spieler aktiv";
	document.querySelector("#profile-copy").textContent = currentUser
		? `${currentUser.handle} verbindet Journal, Games und Rückkehr-Schleifen in einem Profil.`
		: "Logge dich in Connection Quest ein, damit das Profilzentrum mit deinen Daten gefuellt wird.";
	document.querySelector("#profile-score").textContent = String(stats.score);
	document.querySelector("#profile-level").textContent = String(stats.level);
	document.querySelector("#profile-streak").textContent = `${stats.currentStreak}`;
	document.querySelector("#profile-placement").textContent = `#${currentUser?.placement || 0}`;

	renderRecommendations(pulse.recommendations || []);
	renderMissions("#profile-missions", pulse.missions || [], "Keine Daily-Daten.");
	renderMissions("#profile-weekly", pulse.weeklyChallenges || [], "Keine Weekly-Daten.");
	renderSnapshot(stats);
	renderEntries(currentUser?.entries || []);
	renderBadges(stats);
	renderDangerZone(Boolean(currentUser));
}

async function handleDeleteAccount(event) {
	event.preventDefault();
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	if (!sessionToken) {
		setDeleteFeedback("Du musst eingeloggt sein, um deinen Account zu loeschen.", true);
		return;
	}
	const pin = deleteElements.pin.value.trim();
	if (pin.length < 4) {
		setDeleteFeedback("Bitte zuerst deine PIN eingeben.", true);
		return;
	}
	if (!window.confirm("Willst du deinen Account wirklich dauerhaft loeschen? Dieser Schritt kann nicht rueckgaengig gemacht werden.")) {
		return;
	}
	deleteElements.button.disabled = true;
	setDeleteFeedback("Account wird geloescht ...", false);
	try {
		await apiRequest("/api/cq/account", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pin }),
		});
		window.localStorage.removeItem(SESSION_KEY);
		deleteElements.form.reset();
		setDeleteFeedback("Dein Account wurde geloescht.", false);
		renderProfile(null, {});
	} catch (error) {
		setDeleteFeedback(error.message, true);
	} finally {
		deleteElements.button.disabled = false;
	}
}

function renderDangerZone(hasCurrentUser) {
	deleteElements.form.hidden = !hasCurrentUser;
	setDeleteFeedback(
		hasCurrentUser
			? "Nur mit korrekter PIN wird der Account serverseitig geloescht."
			: "Logge dich ein, damit du deinen eigenen Account verwalten kannst.",
		false,
	);
	if (!hasCurrentUser) {
		deleteElements.form.reset();
	}
}

function setDeleteFeedback(message, isError) {
	deleteElements.feedback.textContent = message || "";
	deleteElements.feedback.classList.toggle("is-error", Boolean(isError));
	deleteElements.feedback.classList.toggle("is-success", Boolean(message) && !isError);
}

function renderRecommendations(items) {
	const node = document.querySelector("#profile-recommendations");
	renderListItems(node, items.map((item) => ({
		title: item.title,
		copy: item.copy,
		tag: item.tag || "Hint",
	})), "Noch keine Empfehlungen.");
}

function renderMissions(selector, items, emptyCopy) {
	const node = document.querySelector(selector);
	if (!items.length) {
		node.classList.add("empty-state");
		node.textContent = emptyCopy;
		return;
	}
	node.classList.remove("empty-state");
	node.innerHTML = "";
	items.forEach((item) => {
		const card = document.createElement("article");
		card.className = "list-item";
		card.innerHTML = `
			<div class="item-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="item-tag">${item.completed ? "Clear" : "Live"}</span>
			</div>
			<p>${escapeHtml(item.description || "")}</p>
			<div class="item-progress" aria-hidden="true"><span style="width:${item.progressPercent || 0}%"></span></div>
			<div class="item-meta">${item.current || 0} / ${item.target || 0} • ${escapeHtml(item.rewardLabel || "")}</div>
		`;
		node.appendChild(card);
	});
}

function renderSnapshot(stats) {
	const node = document.querySelector("#profile-snapshot");
	node.innerHTML = "";
	[
		{ label: "Journal Score", value: Math.max(0, stats.score - (stats.gameScore || 0)) },
		{ label: "Game Score", value: stats.gameScore || 0 },
		{ label: "Connections", value: stats.uniqueConnections },
		{ label: "Badges", value: stats.unlockedAchievements },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "metric-item";
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${item.value}</strong>`;
		node.appendChild(card);
	});
}

function renderEntries(entries) {
	const node = document.querySelector("#profile-entries");
	if (!entries.length) {
		node.classList.add("empty-state");
		node.textContent = "Noch keine Logs sichtbar.";
		return;
	}
	node.classList.remove("empty-state");
	node.innerHTML = "";
	entries.slice(0, 8).forEach((entry) => {
		const card = document.createElement("article");
		card.className = "list-item";
		card.innerHTML = `
			<div class="item-head">
				<h3>${escapeHtml(entry.name)}</h3>
				<span class="item-tag">${escapeHtml(entry.type)}</span>
			</div>
			<p>${formatDate(entry.date)}${entry.notes ? ` • ${escapeHtml(entry.notes)}` : ""}</p>
		`;
		node.appendChild(card);
	});
}

function renderBadges(stats) {
	const node = document.querySelector("#profile-badges");
	node.innerHTML = "";
	[
		{ title: "Level Drive", copy: `Level ${stats.level} aktiv`, value: `${stats.xp} XP` },
		{ title: "Streak Force", copy: "Aktuelle Aktivitaetsserie", value: `${stats.currentStreak} Tage` },
		{ title: "Arcade Layer", copy: "Games im Gesamtprofil", value: `${stats.gameSessions || 0} Sessions` },
		{ title: "Board Power", copy: "Gesammelte Badges", value: `${stats.unlockedAchievements}` },
	].forEach((item) => {
		const card = document.createElement("article");
		card.className = "badge-item";
		card.innerHTML = `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.copy)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderListItems(node, items, emptyCopy) {
	if (!items.length) {
		node.classList.add("empty-state");
		node.textContent = emptyCopy;
		return;
	}
	node.classList.remove("empty-state");
	node.innerHTML = "";
	items.forEach((item) => {
		const card = document.createElement("article");
		card.className = "list-item";
		card.innerHTML = `
			<div class="item-head">
				<h3>${escapeHtml(item.title)}</h3>
				<span class="item-tag">${escapeHtml(item.tag || "Hint")}</span>
			</div>
			<p>${escapeHtml(item.copy || "")}</p>
		`;
		node.appendChild(card);
	});
}

function buildEmptyStats() {
	return {
		score: 0,
		level: 1,
		currentStreak: 0,
		uniqueConnections: 0,
		unlockedAchievements: 0,
		gameScore: 0,
		gameSessions: 0,
		xp: 0,
	};
}

async function apiRequest(url, options = {}) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = { ...(options.headers || {}) };
	if (sessionToken) {
		headers.Authorization = `Bearer ${sessionToken}`;
	}
	const response = await fetch(url, {
		method: options.method || "GET",
		headers,
		body: options.body,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Profil konnte nicht geladen werden.");
	}
	return payload;
}

function formatDate(value) {
	return new Intl.DateTimeFormat("de-DE", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	}).format(new Date(value));
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}