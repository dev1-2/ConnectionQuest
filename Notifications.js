const SESSION_KEY = "connection-quest-session-token-v1";

initialize();

async function initialize() {
	try {
		const [sessionPayload, leaderboardPayload, pulsePayload] = await Promise.all([
			apiRequest("/api/cq/session"),
			apiRequest("/api/cq/leaderboard"),
			apiRequest("/api/cq/pulse"),
		]);
		renderNotifications(sessionPayload.currentUser, leaderboardPayload.leaderboard || [], pulsePayload || {});
	} catch (error) {
		renderNotifications(null, [], {});
		document.querySelector("#notify-copy").textContent = error.message;
	}
}

function renderNotifications(currentUser, leaderboard, pulse) {
	const groups = buildNotificationGroups(currentUser, leaderboard, pulse);
	document.querySelector("#notify-title").textContent = groups.urgent.length ? "Heute gibt es Druck" : "Inbox ruhig";
	document.querySelector("#notify-copy").textContent = currentUser
		? `${currentUser.handle} sieht hier unmittelbare Aktivitaets- und Konkurrenzsignale.`
		: "Auch ohne aktiven Spieler zeigt die Inbox, wie das Netz gerade arbeitet.";
	renderTopline(currentUser, pulse, groups);
	renderList("#urgent-list", groups.urgent, "Noch keine dringenden Hinweise.");
	renderList("#progress-list", groups.progress, "Noch keine Fortschrittsmeldungen.");
	renderList("#social-list", groups.social, "Noch keine sozialen Hinweise.");
}

function buildNotificationGroups(currentUser, leaderboard, pulse) {
	const missions = pulse.missions || [];
	const weekly = pulse.weeklyChallenges || [];
	const recommendations = pulse.recommendations || [];
	const currentIndex = leaderboard.findIndex((entry) => entry.id === currentUser?.id);
	const rivalAbove = currentIndex > 0 ? leaderboard[currentIndex - 1] : null;
	const urgent = [];
	const progress = [];
	const social = [];

	if (!currentUser) {
		urgent.push({ title: "Spieler aktivieren", copy: "Ohne Login bleiben persoenliche Missions-, Profil- und Rangsignale gesperrt.", tag: "Login" });
	} else {
		if (missions.some((item) => !item.completed)) {
			urgent.push({ title: "Daily Loop noch offen", copy: "Heute ist noch mindestens eine taegliche Mission offen. Ein kurzer Run oder neuer Log reicht oft schon.", tag: "Daily" });
		}
		if ((currentUser.stats.currentStreak || 0) >= 2 && missions.every((item) => item.current === 0 || !item.completed)) {
			urgent.push({ title: "Streak unter Druck", copy: `Deine ${currentUser.stats.currentStreak}-Tage-Streak braucht heute wieder Aktivitaet.`, tag: "Streak" });
		}
		if (rivalAbove && rivalAbove.stats.score - currentUser.stats.score <= 250) {
			social.push({ title: `Rangchance gegen ${rivalAbove.handle}`, copy: `Nur ${rivalAbove.stats.score - currentUser.stats.score} Score bis zum naechsten Platz.`, tag: "Rival" });
		}
	}

	missions.filter((item) => !item.completed && item.progressPercent >= 50).forEach((item) => {
		progress.push({ title: item.title, copy: `${item.current} / ${item.target} abgeschlossen. ${item.rewardLabel} liegt nah.`, tag: "Mission" });
	});
	weekly.filter((item) => !item.completed && item.progressPercent >= 50).forEach((item) => {
		progress.push({ title: item.title, copy: `${item.current} / ${item.target} in dieser Woche.`, tag: "Weekly" });
	});
	recommendations.slice(0, 2).forEach((item) => {
		progress.push({ title: item.title, copy: item.copy, tag: item.tag || "Hint" });
	});
	(pulse.activityFeed || []).slice(0, 4).forEach((item) => {
		social.push({ title: item.title, copy: item.detail || "Neue Bewegung im Netz.", tag: item.type === "game" ? "Game" : "Log" });
	});

	return { urgent: urgent.slice(0, 4), progress: progress.slice(0, 6), social: social.slice(0, 6) };
}

function renderTopline(currentUser, pulse, groups) {
	const node = document.querySelector("#notify-topline");
	node.innerHTML = "";
	[
		{ label: "Urgent", value: groups.urgent.length },
		{ label: "Open Weekly", value: (pulse.weeklyChallenges || []).filter((item) => !item.completed).length },
		{ label: "Spieler", value: currentUser?.handle || "Gast" },
		{ label: "Feed", value: (pulse.activityFeed || []).length },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(item.value)}</strong>`;
		node.appendChild(card);
	});
}

function renderList(selector, items, emptyCopy) {
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
				<span class="item-tag">${escapeHtml(item.tag)}</span>
			</div>
			<p>${escapeHtml(item.copy)}</p>
		`;
		node.appendChild(card);
	});
}

async function apiRequest(url) {
	const sessionToken = window.localStorage.getItem(SESSION_KEY) || "";
	const headers = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Notifications konnten nicht geladen werden.");
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