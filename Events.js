const EVENTS_SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const [leaderboardPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/leaderboard"),
			apiRequest("/api/cq/pulse"),
		]);
		renderEvents(leaderboardPayload.leaderboard || [], pulsePayload || {});
	} catch (error) {
		renderEvents([], {});
		document.querySelector("#events-copy").textContent = error.message;
	}
}

function renderEvents(leaderboard, pulse) {
	const stats = pulse.communityStats || {};
	document.querySelector("#events-title").textContent = stats.playerCount ? `Live-Fokus fuer ${stats.playerCount} Spieler` : "Kein Event-Fokus";
	document.querySelector("#events-copy").textContent = stats.playerCount
		? `${stats.entriesToday || 0} Logs heute und ${stats.gamesToday || 0} Games heute werden zu Event-Druck verdichtet.`
		: "Sobald genug Aktivitaet vorhanden ist, erzeugt die Seite daraus Event-Slots und Spotlights.";
	renderTopline(stats);
	renderSpotlights(leaderboard, pulse);
	renderWeekly(pulse.weeklyChallenges || []);
	renderSocial(pulse.activityFeed || [], leaderboard);
}

function renderTopline(stats) {
	const node = document.querySelector("#events-topline");
	node.innerHTML = "";
	[
		{ label: "Logs heute", value: stats.entriesToday || 0 },
		{ label: "Games heute", value: stats.gamesToday || 0 },
		{ label: "Aktiv 7 Tage", value: stats.activePlayers7d || 0 },
		{ label: "Events live", value: 4 },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderSpotlights(leaderboard, pulse) {
	const node = document.querySelector("#event-spotlights");
	const top = leaderboard[0];
	const items = [
		{ title: "Board Sprint", copy: top ? `${top.handle} fuehrt gerade. Die Community kann heute auf Rangdruck spielen.` : "Noch kein Board-Leader.", tag: "Board" },
		{ title: "Journal Burst", copy: `${pulse.communityStats?.entriesToday || 0} Logs heute machen das Journal zum Event-Thema.`, tag: "Journal" },
		{ title: "Arcade Window", copy: `${pulse.communityStats?.gamesToday || 0} Games heute halten den Arcade-Loop sichtbar.`, tag: "Arcade" },
	];
	renderList(node, items, "Noch keine Spotlights sichtbar.");
}

function renderWeekly(challenges) {
	const node = document.querySelector("#weekly-events");
	const items = challenges.length
		? challenges.map((item) => ({ title: item.title, copy: `${item.current} / ${item.target} • ${item.rewardLabel}`, tag: item.completed ? "Clear" : "Week" }))
		: [
			{ title: "Journal Week", copy: "Mehr Logs, mehr Verbindungen, mehr Rueckkehrdruck.", tag: "Theme" },
			{ title: "Arcade Week", copy: "Mehr Duels und Single-Runs fuer Score-Schuebe.", tag: "Theme" },
		];
	renderList(node, items, "Noch keine Themen sichtbar.");
}

function renderSocial(feed, leaderboard) {
	const node = document.querySelector("#social-events");
	const items = [
		...feed.slice(0, 3).map((item) => ({ title: item.title, copy: item.detail || "Neue Bewegung im Netz.", tag: item.type === "game" ? "Game" : "Log" })),
		...leaderboard.slice(0, 2).map((entry) => ({ title: `${entry.handle} im Fokus`, copy: `Platz #${entry.placement} mit ${entry.stats.score} Score. Kandidat fuer ein Community-Spotlight.`, tag: "Leader" })),
	].slice(0, 5);
	renderList(node, items, "Noch keine Social-Events sichtbar.");
}

function renderList(node, items, emptyCopy) {
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
		card.innerHTML = `<div class="item-head"><h3>${escapeHtml(item.title)}</h3><span class="item-tag">${escapeHtml(item.tag)}</span></div><p>${escapeHtml(item.copy)}</p>`;
		node.appendChild(card);
	});
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(EVENTS_SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Events konnten nicht geladen werden.");
	}
	return payload;
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}