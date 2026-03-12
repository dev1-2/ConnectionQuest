initialize();

async function initialize() {
	try {
		const payload = await apiRequest("/api/cq/pulse");
		renderStats(payload.communityStats || {}, payload.highlights || {});
	} catch (error) {
		renderStats({}, {});
		document.querySelector("#about-copy").textContent = error.message;
	}
}

function renderStats(stats, highlights) {
	const node = document.querySelector("#about-topline");
	const copy = document.querySelector("#about-copy");
	copy.textContent = stats.playerCount
		? `${stats.playerCount} Profile, ${stats.entriesToday || 0} Logs heute und ${stats.games7d || 0} Games in den letzten 7 Tagen.`
		: "Sobald Nutzung stattfindet, zeigt diese Seite hier den aktuellen Community-Stand.";
	node.innerHTML = "";
	[
		{ label: "Profile", value: stats.playerCount || 0 },
		{ label: "Aktiv 7 Tage", value: stats.activePlayers7d || 0 },
		{ label: "Top Score", value: highlights.scoreLeader?.handle || "-" },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="eyebrow">${escapeHtml(item.label)}</p><strong>${escapeHtml(String(item.value))}</strong>`;
		node.appendChild(card);
	});
}

async function apiRequest(url) {
	const response = await fetch(url);
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Daten konnten nicht geladen werden.");
	}
	return payload;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
