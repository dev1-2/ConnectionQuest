const CACHE_NAME = "connection-quest-v9";
const APP_SHELL = [
	"/",
	"/index.html",
	"/Hub.html",
	"/Guide.html",
	"/SocialRank.html",
	"/Blog.html",
	"/About.html",
	"/ConnectionQuest.html",
	"/Games.html",
	"/Leaderboard.html",
	"/Welcome.css",
	"/Welcome.js",
	"/Hub.css",
	"/Hub.js",
	"/Guide.css",
	"/Guide.js",
	"/Admin.css",
	"/Admin.js",
	"/AdminAccess.css",
	"/AdminAccess.js",
	"/AdminMessages.css",
	"/AdminMessages.js",
	"/SocialRank.css",
	"/SocialRank.js",
	"/Connectionqueststyles.css",
	"/Connectionquestscript.js",
	"/Games.css",
	"/Games.js",
	"/Leaderboard.css",
	"/Leaderboard.js",
	"/Profile.html",
	"/Profile.css",
	"/Profile.js",
	"/Community.html",
	"/Community.css",
	"/Community.js",
	"/Blog.css",
	"/Blog.js",
	"/Notifications.html",
	"/Notifications.css",
	"/Notifications.js",
	"/Network.html",
	"/Network.css",
	"/Network.js",
	"/Rewards.html",
	"/Rewards.css",
	"/Rewards.js",
	"/Events.html",
	"/Events.css",
	"/Events.js",
	"/Analytics.html",
	"/Analytics.css",
	"/Analytics.js",
	"/About.css",
	"/About.js",
	"/app-shell.js",
	"/manifest.webmanifest",
	"/icon.svg"
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))))).then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") {
		return;
	}
	if (request.url.includes("/api/") || request.url.includes("/Admin.html") || request.url.includes("/AdminMessages.html")) {
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) {
				return cached;
			}
			return fetch(request).then((response) => {
				if (!response || response.status !== 200) {
					return response;
				}
				const clone = response.clone();
				caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
				return response;
			}).catch(() => caches.match("/index.html"));
		}),
	);
});