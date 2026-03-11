const CACHE_NAME = "connection-quest-v3";
const APP_SHELL = [
	"/",
	"/index.html",
	"/ConnectionQuest.html",
	"/Games.html",
	"/Leaderboard.html",
	"/Welcome.css",
	"/Welcome.js",
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
	if (request.url.includes("/api/")) {
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