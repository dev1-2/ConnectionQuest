const elements = {
	status: document.querySelector("#admin-access-status"),
	form: document.querySelector("#admin-access-form"),
	password: document.querySelector("#admin-access-password"),
	feedback: document.querySelector("#admin-access-feedback"),
};

elements.form.addEventListener("submit", handleLogin);

initialize();

async function initialize() {
	try {
		const payload = await fetchJson("/api/admin/status");
		const auth = payload.auth || { isAdmin: false, adminConfigured: false };
		if (auth.isAdmin) {
			window.location.replace("Admin.html");
			return;
		}
		elements.status.textContent = auth.adminConfigured
			? "Admin-Zugang ist aktiv. Anmeldung erforderlich."
			: "Admin-Zugang ist auf dem Server noch nicht konfiguriert.";
	} catch (error) {
		setFeedback(error.message, true);
	}
}

async function handleLogin(event) {
	event.preventDefault();
	const password = elements.password.value.trim();
	if (!password) {
		setFeedback("Bitte Admin-Passwort eingeben.", true);
		return;
	}

	try {
		setFeedback("Anmeldung wird geprueft ...", false);
		await fetchJson("/api/admin/login", {
			method: "POST",
			body: { password },
		});
		window.location.replace("Admin.html");
	} catch (error) {
		setFeedback(error.message, true);
	}
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		method: options.method || "GET",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", ...(options.headers || {}) },
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Anfrage fehlgeschlagen.");
	}
	return payload;
}

function setFeedback(message, isError) {
	elements.feedback.textContent = message || "";
	elements.feedback.classList.toggle("is-error", Boolean(isError));
	elements.feedback.classList.toggle("is-success", Boolean(message) && !isError);
}
