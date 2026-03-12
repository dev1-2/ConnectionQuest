initialize();

document.querySelector("#blog-form").addEventListener("submit", handleSubmit);

async function initialize() {
	try {
		const payload = await apiRequest("/api/cq/blog-posts");
		renderBlog(payload.posts || []);
	} catch (error) {
		renderBlog([]);
		setStatus(error.message, true);
		document.querySelector("#blog-copy").textContent = error.message;
	}
}

async function handleSubmit(event) {
	event.preventDefault();
	const button = document.querySelector("#publish-button");
	const form = event.currentTarget;
	const formData = new FormData(form);
	const payload = {
		authorName: String(formData.get("authorName") || ""),
		title: String(formData.get("title") || ""),
		body: String(formData.get("body") || ""),
	};

	button.disabled = true;
	setStatus("Beitrag wird gespeichert ...", false);

	try {
		const result = await apiRequest("/api/cq/blog-posts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		form.reset();
		prependPost(result.post);
		setStatus(result.message || "Beitrag wurde veroeffentlicht.", false);
	} catch (error) {
		setStatus(error.message, true);
	} finally {
		button.disabled = false;
	}
}

function renderBlog(posts) {
	renderHeader(posts);
	renderFeed(posts);
}

function renderHeader(posts) {
	const title = document.querySelector("#blog-title");
	const copy = document.querySelector("#blog-copy");
	const topline = document.querySelector("#blog-topline");
	const uniqueAuthors = new Set(posts.map((post) => post.authorName.toLowerCase())).size;
	const latest = posts[0];

	title.textContent = posts.length ? `${posts.length} Gedanken im Feed` : "Noch keine Gedanken im Feed";
	copy.textContent = posts.length
		? `Neuester Beitrag: ${latest.title} von ${latest.authorName}. Der Feed speichert derzeit bis zu 50 Eintraege.`
		: "Sobald der erste Beitrag veroeffentlicht wurde, entsteht hier ein oeffentlicher Stream fuer Gedanken aus der Community.";

	topline.innerHTML = "";
	[
		{ label: "Beitraege", value: posts.length },
		{ label: "Autorinnen und Autoren", value: uniqueAuthors },
	].forEach((item) => {
		const card = document.createElement("div");
		card.innerHTML = `<p class="mini-label">${escapeHtml(item.label)}</p><strong>${escapeHtml(String(item.value))}</strong>`;
		topline.appendChild(card);
	});
}

function renderFeed(posts) {
	const node = document.querySelector("#blog-feed");
	node.innerHTML = "";
	node.classList.toggle("empty-state", posts.length === 0);
	if (!posts.length) {
		node.textContent = "Noch keine Beitraege sichtbar. Schreib den ersten Gedanken.";
		return;
	}

	posts.forEach((post) => {
		node.appendChild(buildPostCard(post));
	});
}

function prependPost(post) {
	const node = document.querySelector("#blog-feed");
	const cards = Array.from(node.querySelectorAll(".post-card"));
	const nextPosts = [post, ...cards.map((card) => ({
		id: card.dataset.postId,
		authorName: card.dataset.authorName,
		title: card.dataset.title,
		body: card.querySelector(".post-body").textContent,
		createdAt: card.dataset.createdAt,
	}))].slice(0, 50);
	renderBlog(nextPosts);
}

function buildPostCard(post) {
	const card = document.createElement("article");
	card.className = "post-card";
	card.dataset.postId = post.id;
	card.dataset.authorName = post.authorName;
	card.dataset.title = post.title;
	card.dataset.createdAt = post.createdAt;
	card.innerHTML = `
		<div class="post-head">
			<div>
				<p class="mini-label">Thought Drop</p>
				<h3>${escapeHtml(post.title)}</h3>
			</div>
			<div class="post-meta">
				<span class="author-chip">${escapeHtml(post.authorName)}</span>
				<span class="time-chip">${escapeHtml(formatTimestamp(post.createdAt))}</span>
			</div>
		</div>
		<p class="post-body">${escapeHtml(post.body)}</p>
	`;
	return card;
}

function setStatus(message, isError) {
	const node = document.querySelector("#blog-form-status");
	node.textContent = message;
	node.classList.toggle("is-error", Boolean(isError));
}

async function apiRequest(url, options = {}) {
	const response = await fetch(url, options);
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.error || "Blog konnte nicht geladen werden.");
	}
	return payload;
}

function formatTimestamp(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "gerade eben";
	}
	return new Intl.DateTimeFormat("de-DE", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
