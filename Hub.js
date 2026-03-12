const HUB_SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const [sessionPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/session"),
			apiRequest("/api/cq/pulse"),
		]);
		renderHub(sessionPayload.currentUser, pulsePayload || {});
	} catch (error) {
		renderHub(null, {});
		document.querySelector("#hub-copy").textContent = error.message;
	}
}

function renderHub(currentUser, pulse) {
	const stats = pulse.communityStats || {};
	document.querySelector("#hub-title").textContent = currentUser ? `${currentUser.handle} hat einen klaren naechsten Schritt` : "Weniger Chaos, klarere Wege";
	document.querySelector("#hub-copy").textContent = currentUser
		? `Score ${currentUser.stats.score}, Platz #${currentUser.placement} und offene Aufgaben werden jetzt ueber wenige Hauptwege statt ueber doppelte Menues erreicht.`
		: "Der Hub zeigt zuerst nur die wirklich wichtigen Einstiege. Alles andere bleibt erreichbar, steht aber nicht mehr dauernd im Weg.";
	renderTopline(currentUser, stats);
	renderFocus(currentUser, pulse);
}

function renderTopline(currentUser, stats) {
	const node = document.querySelector("#hub-topline");
	node.innerHTML = "";
	[
		{ label: "Aktiver Spieler", value: currentUser?.handle || "Gast" },
		{ label: "Aktive 7 Tage", value: stats.activePlayers7d || 0 },
		{ label: "Logs heute", value: stats.entriesToday || 0 },
		{ label: "Games 7 Tage", value: stats.games7d || 0 },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderFocus(currentUser, pulse) {
	const node = document.querySelector("#hub-focus");
	const items = [];
	if (!currentUser) {
		items.push({ title: "1. Im Journal einloggen", copy: "Connection Quest ist weiterhin der zentrale Start fuer Login, Registrierung und persoenlichen Fortschritt." });
		items.push({ title: "2. Danach einen Hauptweg nehmen", copy: "Fuer Kontakte und Nachrichten gehe in Messenger oder Community. Fuer Tempo und Score direkt in Games." });
		items.push({ title: "3. Nur bei Bedarf tiefer gehen", copy: "Seltener genutzte Seiten wie Events, Network oder Intro stehen unten kompakt bereit statt den Hub zu ueberladen." });
	} else {
		if ((pulse.missions || []).some((item) => !item.completed)) {
			items.push({ title: "Offene Tagesaufgabe", copy: "Journal oder Games sind heute die schnellsten Wege, um offene Daily-Loops wirklich abzuschliessen." });
		}
		items.push({ title: "Direkt schreiben statt suchen", copy: "Messenger ist jetzt der klare Ort fuer Nutzer-zu-Nutzer-Nachrichten. Community und Blog bleiben fuer oeffentliche Inhalte." });
		items.push({ title: "Status an einer Stelle pruefen", copy: "Profil und Leaderboard decken persoenlichen Stand und Vergleich ab, ohne dass derselbe Zweck mehrfach im Hub auftaucht." });
		items.push({ title: "Nur Admin-Sachen getrennt oeffnen", copy: "Admin Channel ist oeffentlich fuer News. Admin und Admin Messages bleiben nur fuer Verwaltung und interne Posts." });
	}
	if (!items.length) {
		node.classList.add("empty-state");
		node.textContent = "Noch keine Fokus-Routen geladen.";
		return;
	}
	node.classList.remove("empty-state");
	node.innerHTML = "";
	items.forEach((item) => {
		const card = document.createElement("article");
		card.className = "focus-item";
		card.innerHTML = `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.copy)}</p>`;
		node.appendChild(card);
	});
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(HUB_SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Hub konnte nicht geladen werden.");
	}
	return payload;
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}