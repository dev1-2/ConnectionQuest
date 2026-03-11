const SESSION_KEY = "connection-quest-session-token-v1";

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

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
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