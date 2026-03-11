const elements = {
	introPrefix: document.querySelector("#intro-prefix"),
	mainTitle: document.querySelector("#main-title"),
	creditLine: document.querySelector("#credit-line"),
	statusLine: document.querySelector("#status-line"),
	enterLink: document.querySelector("#enter-link"),
};

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
		unlockEnter("sequence complete");
		return;
	}

	await wait(250);
	elements.introPrefix.classList.add("is-visible");
	elements.statusLine.textContent = "loading title";

	await animateLetters(elements.mainTitle, elements.mainTitle.dataset.text || "", 55);
	elements.statusLine.textContent = "injecting credits";

	await wait(280);
	await animateLetters(elements.creditLine, elements.creditLine.dataset.text || "", 38);
	elements.statusLine.textContent = "sequence complete";

	unlockEnter("sequence complete");
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