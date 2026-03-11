document.addEventListener("DOMContentLoaded", () => {
	const anchor = window.location.hash;
	if (!anchor) {
		return;
	}
	const target = document.querySelector(anchor);
	if (target) {
		target.scrollIntoView({ behavior: "smooth", block: "start" });
	}
});