const SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const [sessionPayload, leaderboardPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/session"),
			apiRequest("/api/cq/leaderboard"),
			apiRequest("/api/cq/pulse"),
		]);
		renderNetwork(sessionPayload.currentUser, leaderboardPayload.leaderboard || [], pulsePayload || {});
	} catch (error) {
		renderNetwork(null, [], {});
		document.querySelector("#network-copy").textContent = error.message;
	}
}

function renderNetwork(currentUser, leaderboard, pulse) {
	document.querySelector("#network-title").textContent = currentUser ? `${currentUser.handle} im Netz` : "Kein Netzprofil";
	document.querySelector("#network-copy").textContent = currentUser
		? `Platz #${currentUser.placement} mit ${currentUser.stats.score} Score. Der Hub verbindet jetzt direkte Rivalen, Cluster und Discovery-Routen.`
		: "Sobald ein aktiver Spieler vorhanden ist, zeigt der Network-Hub Rivalen, Aufstiegsrouten und soziale Cluster.";
	renderTopline(currentUser, leaderboard, pulse);
	renderRivals(currentUser, leaderboard);
	renderClusters(leaderboard);
	renderDiscovery(currentUser, leaderboard, pulse);
}

function renderTopline(currentUser, leaderboard, pulse) {
	const node = document.querySelector("#network-topline");
	node.innerHTML = "";
	[
		{ label: "Spieler", value: leaderboard.length },
		{ label: "Aktive 7 Tage", value: pulse.communityStats?.activePlayers7d || 0 },
		{ label: "Rang", value: currentUser ? `#${currentUser.placement}` : "-" },
		{ label: "Signale", value: (pulse.activityFeed || []).length },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderRivals(currentUser, leaderboard) {
	const node = document.querySelector("#network-rivals");
	if (!currentUser) {
		node.classList.add("empty-state");
		node.textContent = "Noch keine Rivalen sichtbar.";
		return;
	}
	const index = leaderboard.findIndex((entry) => entry.id === currentUser.id);
	const candidates = [leaderboard[index - 1], leaderboard[index + 1], ...leaderboard.filter((entry) => entry.id !== currentUser.id)].filter(Boolean);
	const rivals = Array.from(new Map(candidates.map((entry) => [entry.id, entry])).values()).slice(0, 4);
	node.classList.remove("empty-state");
	node.innerHTML = "";
	rivals.forEach((entry) => {
		const gap = Math.abs((entry.stats.score || 0) - currentUser.stats.score);
		const card = document.createElement("article");
		card.className = "list-item";
		card.innerHTML = `
			<div class="item-head">
				<h3>${escapeHtml(entry.handle)}</h3>
				<span class="item-tag">#${entry.placement}</span>
			</div>
			<p>${gap} Score Abstand • ${entry.stats.gameWins || 0} Wins • ${entry.stats.currentStreak || 0} Tage Streak</p>
		`;
		node.appendChild(card);
	});
}

function renderClusters(leaderboard) {
	const node = document.querySelector("#network-clusters");
	node.innerHTML = "";
	[
		makeCluster("Score Grinder", leaderboard.slice().sort((a, b) => (b.stats.score || 0) - (a.stats.score || 0))[0], "Hoher Gesamtscore"),
		makeCluster("Streak Holder", leaderboard.slice().sort((a, b) => (b.stats.currentStreak || 0) - (a.stats.currentStreak || 0))[0], "Konstanz und taegliche Rueckkehr"),
		makeCluster("Arcade Head", leaderboard.slice().sort((a, b) => (b.stats.gameWins || 0) - (a.stats.gameWins || 0))[0], "Games tragen das Profil"),
		makeCluster("Journal Core", leaderboard.slice().sort((a, b) => (b.stats.totalEntries || 0) - (a.stats.totalEntries || 0))[0], "Logs tragen das Profil"),
	].filter(Boolean).forEach((item) => {
		const card = document.createElement("article");
		card.className = "cluster-item";
		card.innerHTML = `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.copy)}</p>`;
		node.appendChild(card);
	});
}

function renderDiscovery(currentUser, leaderboard, pulse) {
	const node = document.querySelector("#network-discovery");
	const items = [];
	if (!currentUser) {
		items.push({ title: "Profil aktivieren", copy: "Erst mit aktivem Spieler werden Rivalen, Rangwege und persoenliche Entdeckungsrouten exakt berechnet.", tag: "Login" });
	} else {
		const higher = leaderboard.find((entry) => entry.placement === currentUser.placement - 1);
		if (higher) {
			items.push({ title: `Jagd auf ${higher.handle}`, copy: `Der direkte Weg nach oben fuehrt ueber ${higher.handle}. Checke Journal, Games oder Inbox fuer den schnellsten Hebel.`, tag: "Climb" });
		}
		items.push(...(pulse.recommendations || []).slice(0, 3).map((item) => ({ title: item.title, copy: item.copy, tag: item.tag || "Hint" })));
	}
	if (!items.length) {
		node.classList.add("empty-state");
		node.textContent = "Noch keine Discovery-Karten.";
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
				<span class="item-tag">${escapeHtml(item.tag)}</span>
			</div>
			<p>${escapeHtml(item.copy)}</p>
		`;
		node.appendChild(card);
	});
}

function makeCluster(title, entry, suffix) {
	if (!entry) {
		return null;
	}
	return {
		title,
		copy: `${entry.handle} fuehrt dieses Segment an. ${suffix}. Platz #${entry.placement}.`,
	};
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Network konnte nicht geladen werden.");
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