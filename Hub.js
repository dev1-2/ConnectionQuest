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
	document.querySelector("#hub-title").textContent = currentUser ? `${currentUser.handle} kann direkt weitermachen` : "Klarer Einstieg";
	document.querySelector("#hub-copy").textContent = currentUser
		? `Score ${currentUser.stats.score}, Platz #${currentUser.placement} und offene Loops koennen jetzt ohne Navigationschaos erreicht werden.`
		: "Der Hub gruppiert jetzt alle Bereiche nach Funktion statt sie ungefiltert nebeneinander zu zeigen.";
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
		items.push({ title: "1. Spieler aktivieren", copy: "Starte in Connection Quest mit Login oder Registrierung. Danach werden Profil, Inbox, Rewards und Events persoenlich relevant." });
		items.push({ title: "2. Erstes Cluster waehlen", copy: "Wenn du lieber direkt spielst, gehe in Games. Wenn du zuerst Struktur willst, gehe in Profil oder Community." });
	} else {
		if ((pulse.missions || []).some((item) => !item.completed)) {
			items.push({ title: "Tagesloop offen", copy: "Connection Quest oder Games sind heute die schnellsten Wege, um offene Daily-Loops zu schliessen." });
		}
		items.push({ title: "Soziale Lage pruefen", copy: "Community, Network und Inbox zeigen dir Rangdruck, Rivalen und Live-Signale ohne Sucherei." });
		items.push({ title: "Meta-Ebene nutzen", copy: "Rewards, Events und Analytics sind jetzt bewusst als eigene Meta-Ebene vom Kern getrennt." });
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