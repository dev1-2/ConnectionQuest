let deferredInstallPrompt = null;

const PAGE_META = {
	"index.html": {
		title: "Intro",
		category: "Start",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Games.html", "Leaderboard.html"],
	},
	"Hub.html": {
		title: "Hub",
		category: "Start",
		quickLinks: ["ConnectionQuest.html", "Games.html", "Leaderboard.html", "Guide.html"],
	},
	"Guide.html": {
		title: "Guide",
		category: "Start",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Games.html", "Leaderboard.html"],
	},
	"Admin.html": {
		title: "Admin",
		category: "Operations",
		quickLinks: ["Hub.html", "LehrerRanking.html", "SocialRank.html", "Analytics.html"],
	},
	"SocialRank.html": {
		title: "Social Rank",
		category: "Social",
		quickLinks: ["Hub.html", "Network.html", "Community.html", "Guide.html"],
	},
	"ConnectionQuest.html": {
		title: "Journal",
		category: "Core",
		quickLinks: ["Hub.html", "Games.html", "Leaderboard.html", "Guide.html"],
	},
	"Games.html": {
		title: "Games",
		category: "Core",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Leaderboard.html", "Network.html"],
	},
	"Leaderboard.html": {
		title: "Leaderboard",
		category: "Core",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Profile.html", "Community.html"],
	},
	"Profile.html": {
		title: "Profil",
		category: "Identity",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Rewards.html", "Notifications.html"],
	},
	"Community.html": {
		title: "Community",
		category: "Social",
		quickLinks: ["Hub.html", "Network.html", "Notifications.html", "Leaderboard.html"],
	},
	"Notifications.html": {
		title: "Inbox",
		category: "Social",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Games.html", "Network.html"],
	},
	"Network.html": {
		title: "Network",
		category: "Social",
		quickLinks: ["Hub.html", "Community.html", "Notifications.html", "Games.html"],
	},
	"Rewards.html": {
		title: "Rewards",
		category: "Meta",
		quickLinks: ["Hub.html", "Profile.html", "Events.html", "Analytics.html"],
	},
	"Events.html": {
		title: "Events",
		category: "Meta",
		quickLinks: ["Hub.html", "Community.html", "Rewards.html", "Analytics.html"],
	},
	"Analytics.html": {
		title: "Analytics",
		category: "Meta",
		quickLinks: ["Hub.html", "Community.html", "Events.html", "Rewards.html"],
	},
	"LehrerRanking.html": {
		title: "Teacher Ranking",
		category: "Other",
		quickLinks: ["Hub.html", "index.html", "ConnectionQuest.html", "Leaderboard.html"],
	},
};

const NAV_GROUPS = [
	{
		label: "Start",
		links: ["Hub.html", "Guide.html", "index.html"],
	},
	{
		label: "Use",
		links: ["ConnectionQuest.html", "Games.html", "Leaderboard.html", "Profile.html"],
	},
	{
		label: "Network",
		links: ["Community.html", "Network.html", "SocialRank.html", "Notifications.html"],
	},
	{
		label: "System",
		links: ["Rewards.html", "Events.html", "Analytics.html"],
	},
	{
		label: "Operations",
		links: ["Admin.html", "LehrerRanking.html"],
	},
];

initializeAppShell();

async function initializeAppShell() {
	injectShellStyles();
	renderGlobalShell();
	simplifyHeroActions();
	registerServiceWorker();
	setupInstallPrompt();
}

function getCurrentPageName() {
	const raw = window.location.pathname.split("/").pop() || "index.html";
	return raw || "index.html";
}

function getPageMeta(pageName = getCurrentPageName()) {
	return PAGE_META[pageName] || {
		title: pageName.replace(/\.html$/i, ""),
		category: "Page",
		quickLinks: ["Hub.html", "ConnectionQuest.html", "Games.html", "Leaderboard.html"],
	};
}

function renderGlobalShell() {
	const pageName = getCurrentPageName();
	const pageMeta = getPageMeta(pageName);
	const shell = document.createElement("div");
	shell.className = "cq-shell";
	shell.innerHTML = `
		<div class="cq-shell__bar">
			<a class="cq-shell__brand" href="Hub.html">Connection Quest</a>
			<div class="cq-shell__meta">
				<span class="cq-shell__category">${escapeHtml(pageMeta.category)}</span>
				<strong class="cq-shell__title">${escapeHtml(pageMeta.title)}</strong>
			</div>
			<nav class="cq-shell__quick" aria-label="Schnellnavigation"></nav>
			<button type="button" class="cq-shell__menu-btn">Alle Bereiche</button>
		</div>
		<div class="cq-shell__drawer" hidden>
			<div class="cq-shell__drawer-head">
				<strong>Seitenstruktur</strong>
				<button type="button" class="cq-shell__close-btn">Schliessen</button>
			</div>
			<div class="cq-shell__groups"></div>
		</div>
	`;
	document.body.prepend(shell);
	document.body.classList.add("cq-shell-body");

	const quick = shell.querySelector(".cq-shell__quick");
	pageMeta.quickLinks.forEach((link) => {
		quick.appendChild(buildShellLink(link, pageName, "cq-shell__quick-link"));
	});

	const groupsNode = shell.querySelector(".cq-shell__groups");
	NAV_GROUPS.forEach((group) => {
		const section = document.createElement("section");
		section.className = "cq-shell__group";
		const heading = document.createElement("h2");
		heading.textContent = group.label;
		section.appendChild(heading);
		const linkList = document.createElement("div");
		linkList.className = "cq-shell__group-links";
		group.links.forEach((link) => {
			linkList.appendChild(buildShellLink(link, pageName, "cq-shell__drawer-link"));
		});
		section.appendChild(linkList);
		groupsNode.appendChild(section);
	});

	const drawer = shell.querySelector(".cq-shell__drawer");
	shell.querySelector(".cq-shell__menu-btn").addEventListener("click", () => {
		drawer.hidden = !drawer.hidden;
	});
	shell.querySelector(".cq-shell__close-btn").addEventListener("click", () => {
		drawer.hidden = true;
	});
}

function buildShellLink(target, currentPageName, className) {
	const meta = getPageMeta(target);
	const link = document.createElement("a");
	link.className = `${className}${target === currentPageName ? " is-active" : ""}`;
	link.href = target;
	link.textContent = meta.title;
	return link;
}

function simplifyHeroActions() {
	const pageName = getCurrentPageName();
	const pageMeta = getPageMeta(pageName);
	const containers = document.querySelectorAll(".hero-actions");
	containers.forEach((container) => {
		container.innerHTML = "";
		pageMeta.quickLinks.forEach((target) => {
			const link = document.createElement("a");
			link.className = "cq-shell__context-link";
			link.href = target;
			link.textContent = getPageMeta(target).title;
			container.appendChild(link);
		});
		const moreButton = document.createElement("button");
		moreButton.type = "button";
		moreButton.className = "cq-shell__context-more";
		moreButton.textContent = "Alle Bereiche";
		moreButton.addEventListener("click", () => {
			document.querySelector(".cq-shell__drawer")?.removeAttribute("hidden");
		});
		container.appendChild(moreButton);
	});
}

function injectShellStyles() {
	if (document.querySelector("#cq-shell-styles")) {
		return;
	}
	const style = document.createElement("style");
	style.id = "cq-shell-styles";
	style.textContent = `
		.cq-shell-body { padding-top: 86px; }
		.cq-shell { position: fixed; top: 0; left: 0; right: 0; z-index: 10000; pointer-events: none; }
		.cq-shell__bar, .cq-shell__drawer {
			pointer-events: auto;
			width: min(1240px, calc(100% - 1rem));
			margin: 0.75rem auto 0;
			background: rgba(8, 8, 8, 0.88);
			border: 1px solid rgba(255, 255, 255, 0.1);
			backdrop-filter: blur(18px);
			box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
		}
		.cq-shell__bar {
			display: grid;
			grid-template-columns: auto auto 1fr auto;
			align-items: center;
			gap: 0.9rem;
			padding: 0.85rem 1rem;
			border-radius: 18px;
		}
		.cq-shell__brand, .cq-shell__quick-link, .cq-shell__drawer-link, .cq-shell__context-link {
			text-decoration: none;
			color: #f5f5f5;
		}
		.cq-shell__brand {
			font-weight: 800;
			letter-spacing: 0.04em;
		}
		.cq-shell__meta {
			display: grid;
			gap: 0.1rem;
		}
		.cq-shell__category {
			font-size: 0.72rem;
			text-transform: uppercase;
			letter-spacing: 0.16em;
			color: rgba(255, 255, 255, 0.58);
		}
		.cq-shell__title {
			font-size: 0.98rem;
		}
		.cq-shell__quick {
			display: flex;
			gap: 0.5rem;
			justify-content: center;
			flex-wrap: wrap;
		}
		.cq-shell__quick-link, .cq-shell__drawer-link, .cq-shell__context-link, .cq-shell__context-more, .cq-shell__menu-btn, .cq-shell__close-btn {
			padding: 0.6rem 0.85rem;
			border-radius: 999px;
			border: 1px solid rgba(255, 255, 255, 0.12);
			background: rgba(255, 255, 255, 0.04);
			font: inherit;
			font-size: 0.9rem;
			color: #f5f5f5;
		}
		.cq-shell__quick-link.is-active, .cq-shell__drawer-link.is-active {
			background: linear-gradient(135deg, #ff6b6b, #ffd700);
			color: #111;
			border-color: transparent;
			font-weight: 700;
		}
		.cq-shell__menu-btn, .cq-shell__close-btn, .cq-shell__context-more {
			cursor: pointer;
		}
		.cq-shell__drawer {
			padding: 1rem;
			border-radius: 22px;
		}
		.cq-shell__drawer-head {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 1rem;
			margin-bottom: 1rem;
		}
		.cq-shell__groups {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 1rem;
		}
		.cq-shell__group {
			padding: 1rem;
			border-radius: 18px;
			background: rgba(255,255,255,0.03);
			border: 1px solid rgba(255,255,255,0.08);
		}
		.cq-shell__group h2 {
			margin: 0 0 0.8rem;
			font-size: 0.85rem;
			text-transform: uppercase;
			letter-spacing: 0.14em;
			color: rgba(255,255,255,0.58);
			font-family: inherit;
		}
		.cq-shell__group-links {
			display: grid;
			gap: 0.55rem;
		}
		.cq-shell__drawer-link {
			display: block;
		}
		.hero-actions {
			gap: 0.65rem !important;
		}
		.cq-shell__context-link, .cq-shell__context-more {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			text-decoration: none;
		}
		#cq-install-btn {
			right: 14px !important;
			bottom: 14px !important;
			padding: 0.72rem 0.95rem !important;
			font-size: 0.9rem !important;
		}
		@media (max-width: 1024px) {
			.cq-shell__bar {
				grid-template-columns: 1fr;
				justify-items: stretch;
			}
			.cq-shell__groups {
				grid-template-columns: 1fr 1fr;
			}
		}
		@media (max-width: 720px) {
			.cq-shell-body { padding-top: 112px; }
			.cq-shell__groups {
				grid-template-columns: 1fr;
			}
			.cq-shell__quick {
				justify-content: flex-start;
			}
			.cq-shell__quick-link, .cq-shell__context-link, .cq-shell__context-more {
				width: 100%;
			}
		}
	`;
	document.head.appendChild(style);
}

function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("sw.js").catch(() => {
			// Silent fail keeps the app usable even if service worker registration is blocked.
		});
	});
}

function setupInstallPrompt() {
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		deferredInstallPrompt = event;
		renderInstallButton();
	});

	window.addEventListener("appinstalled", () => {
		deferredInstallPrompt = null;
		removeInstallButton();
	});
}

function renderInstallButton() {
	if (document.querySelector("#cq-install-btn")) {
		return;
	}

	const button = document.createElement("button");
	button.type = "button";
	button.id = "cq-install-btn";
	button.textContent = "App installieren";
	Object.assign(button.style, {
		position: "fixed",
		right: "16px",
		bottom: "16px",
		zIndex: "9999",
		padding: "0.9rem 1.1rem",
		border: "1px solid rgba(255,255,255,0.24)",
		borderRadius: "999px",
		background: "linear-gradient(135deg, #ff6b6b, #ffd700)",
		color: "#111",
		fontWeight: "700",
		cursor: "pointer",
		boxShadow: "0 16px 30px rgba(0,0,0,0.25)",
	});
	button.addEventListener("click", installApp);
	document.body.appendChild(button);
}

async function installApp() {
	if (!deferredInstallPrompt) {
		return;
	}

	deferredInstallPrompt.prompt();
	try {
		await deferredInstallPrompt.userChoice;
	} finally {
		deferredInstallPrompt = null;
		removeInstallButton();
	}
}

function removeInstallButton() {
	document.querySelector("#cq-install-btn")?.remove();
}