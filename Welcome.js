const elements = {
	introPrefix: document.querySelector("#intro-prefix"),
	mainTitle: document.querySelector("#main-title"),
	creditLine: document.querySelector("#credit-line"),
	statusLine: document.querySelector("#status-line"),
	enterLink: document.querySelector("#enter-link"),
};

const EREBOS_MESSAGES = [
	"EREBOS ERWACHT...",
	"PROTOKOLL WIRD GELADEN...",
	"IDENTITÄT WIRD ANALYSIERT...",
	"DU WIRST BEOBACHTET...",
	"RANGPOSITION WIRD BERECHNET...",
	"ZUGANG WIRD GEPRÜFT...",
];

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

initializeIntro();

async function initializeIntro() {
	elements.enterLink.addEventListener("click", handleEnterClick);

	if (prefersReducedMotion) {
		elements.introPrefix.classList.add("is-visible");
		renderText(elements.mainTitle, elements.mainTitle.dataset.text || "");
		activateAll(elements.mainTitle);
		renderText(elements.creditLine, elements.creditLine.dataset.text || "");
		activateAll(elements.creditLine);
		unlockEnter("ZUGANG GEWÄHRT");
		return;
	}

	for (let i = 0; i < EREBOS_MESSAGES.length - 2; i++) {
		elements.statusLine.textContent = EREBOS_MESSAGES[i];
		await wait(320);
	}

	elements.introPrefix.classList.add("is-visible");
	elements.statusLine.textContent = "TITEL WIRD ENTSCHLÜSSELT...";

	await animateLetters(elements.mainTitle, elements.mainTitle.dataset.text || "", 90);
	elements.statusLine.textContent = "BOTSCHAFT WIRD ÜBERMITTELT...";

	await wait(380);
	await animateLetters(elements.creditLine, elements.creditLine.dataset.text || "", 45);

	unlockEnter("ZUGANG GEWÄHRT — BETRITT DAS SPIEL");
}

async function animateLetters(node, text, delay) {
	renderText(node, text);
	const chars = Array.from(node.querySelectorAll(".char"));
	for (const char of chars) {
		await wait(delay);
		char.classList.add("is-on");
	}
}

function renderText(node, text) {
	node.innerHTML = "";
	const fragment = document.createDocumentFragment();
	const words = text.split(" ");

	words.forEach((word) => {
		const wordGroup = document.createElement("span");
		wordGroup.className = "word-group";

		for (const character of word) {
			const span = document.createElement("span");
			span.className = "char";
			span.textContent = character;
			wordGroup.appendChild(span);
		}

		fragment.appendChild(wordGroup);
	});

	if (!text.length) {
		const span = document.createElement("span");
		span.className = "char";
		span.textContent = "";
		fragment.appendChild(span);
	}
	node.appendChild(fragment);
}

function activateAll(node) {
	Array.from(node.querySelectorAll(".char")).forEach((char) => {
		char.classList.add("is-on");
	});
}

function unlockEnter(statusText) {
	elements.statusLine.textContent = statusText;
	elements.enterLink.classList.remove("is-locked");
	elements.enterLink.classList.add("is-ready");
	elements.enterLink.removeAttribute("aria-disabled");
}

function handleEnterClick(event) {
	if (elements.enterLink.classList.contains("is-locked")) {
		event.preventDefault();
	}
}

function wait(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

// Load live player count into ribbon
async function loadPlayerCount() {
	try {
		const response = await fetch("/api/cq/leaderboard");
		if (!response.ok) return;
		const data = await response.json();
		const count = (data.leaderboard || []).length;
		const el = document.querySelector("#player-count-ribbon");
		if (el) el.textContent = count + " AKTIV";
	} catch {
		// silently fail - ribbon stays at default
	}
}

loadPlayerCount();

async function animateLetters(node, text, delay) {
	renderText(node, text);
	const chars = Array.from(node.querySelectorAll(".char"));
	for (const char of chars) {
		await wait(delay);
		char.classList.add("is-on");
	}
}

function renderText(node, text) {
	node.innerHTML = "";
	const fragment = document.createDocumentFragment();
	const words = text.split(" ");

	words.forEach((word, wordIndex) => {
		const wordGroup = document.createElement("span");
		wordGroup.className = "word-group";

		for (const character of word) {
			const span = document.createElement("span");
			span.className = "char";
			span.textContent = character;
			wordGroup.appendChild(span);
		}

		fragment.appendChild(wordGroup);
	});

	if (!text.length) {
		const span = document.createElement("span");
		span.className = "char";
		span.textContent = "";
		fragment.appendChild(span);
	}
	node.appendChild(fragment);
}

function activateAll(node) {
	Array.from(node.querySelectorAll(".char")).forEach((char) => {
		char.classList.add("is-on");
	});
}

function unlockEnter(statusText) {
	elements.statusLine.textContent = statusText;
	elements.enterLink.classList.remove("is-locked");
	elements.enterLink.classList.add("is-ready");
	elements.enterLink.removeAttribute("aria-disabled");
}

function handleEnterClick(event) {
	if (elements.enterLink.classList.contains("is-locked")) {
		event.preventDefault();
	}
}

function wait(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}