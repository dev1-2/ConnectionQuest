let deferredInstallPrompt = null;

initializeAppShell();

async function initializeAppShell() {
	registerServiceWorker();
	setupInstallPrompt();
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