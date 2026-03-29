"use strict";

const SESSION_KEY = "connection-quest-session-token-v1";
const HS_KEY = "cq-snake-highscore";

// ── Canvas & DOM ──────────────────────────────────────────────────────────────
const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const overlayTitle = document.querySelector("#overlay-title");
const overlayCopy = document.querySelector("#overlay-copy");
const overlaySub = document.querySelector("#overlay-sub");
const overlayBtn = document.querySelector("#overlay-btn");
const hudScore = document.querySelector("#hud-score");
const hudHigh = document.querySelector("#hud-high");
const hudLevel = document.querySelector("#hud-level");
const hudLives = document.querySelector("#hud-lives");
const badgeName = document.querySelector("#badge-name");
const badgeScore = document.querySelector("#badge-score");
const rewardsCopy = document.querySelector("#rewards-copy");
const runLogList = document.querySelector("#run-log-list");

// ── Grid constants ────────────────────────────────────────────────────────────
const CELL = 24;
const COLS = canvas.width / CELL;   // 24
const ROWS = canvas.height / CELL;  // 18

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
	bg:        "#050505",
	gridLine:  "rgba(255,255,255,0.045)",
	border:    "rgba(255,255,255,0.14)",
	head:      "#20c997",
	headGlow:  "rgba(32,201,151,0.75)",
	body1:     "#17a289",
	body2:     "#0c5c4a",
	apple:     "#ff6b6b",
	appleGlow: "rgba(255,107,107,0.8)",
	gold:      "#ffd700",
	goldGlow:  "rgba(255,215,0,0.85)",
	dead:      "#ff4757",
	eyes:      "#ffffff",
};

// ── Game state factory ────────────────────────────────────────────────────────
function makeState() {
	return {
		phase: "idle",   // idle | playing | dead | gameover
		snake: [{ x: 13, y: 9 }, { x: 12, y: 9 }, { x: 11, y: 9 }],
		dir:     { x: 1, y: 0 },
		nextDir: { x: 1, y: 0 },
		apple:   null,
		golden:  null,
		goldenTimer:      0,
		goldenSpawnTimer: 20,
		score:    0,
		lives:    3,
		level:    1,
		eaten:    0,
		tickMs:   150,
		lastTick: 0,
		deathTime: 0,
		animId:   null,
		highScore: Number(localStorage.getItem(HS_KEY)) || 0,
		currentUser: null,
		runLog: [],
	};
}

let g = makeState();

// ── Input ─────────────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
	const acted = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d"," ","Enter"].includes(e.key);
	if (acted) e.preventDefault();

	if (g.phase === "idle" || g.phase === "gameover") {
		if (e.key === " " || e.key === "Enter") startGame();
		return;
	}
	if (g.phase !== "playing") return;

	const MAP = {
		ArrowUp:    { x: 0, y: -1 }, w: { x: 0, y: -1 },
		ArrowDown:  { x: 0, y:  1 }, s: { x: 0, y:  1 },
		ArrowLeft:  { x: -1, y: 0 }, a: { x: -1, y: 0 },
		ArrowRight: { x:  1, y: 0 }, d: { x:  1, y: 0 },
	};
	const d = MAP[e.key];
	if (d) queueDir(d);
});

// Touch / swipe on canvas
let touchOrigin = null;
canvas.addEventListener("touchstart", (e) => {
	touchOrigin = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
canvas.addEventListener("touchend", (e) => {
	if (!touchOrigin) return;
	const dx = e.changedTouches[0].clientX - touchOrigin.x;
	const dy = e.changedTouches[0].clientY - touchOrigin.y;
	touchOrigin = null;
	if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
		if (g.phase === "idle" || g.phase === "gameover") startGame();
		return;
	}
	if (Math.abs(dx) > Math.abs(dy)) {
		queueDir(dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 });
	} else {
		queueDir(dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 });
	}
}, { passive: true });

// D-pad buttons
document.querySelector("#btn-up").addEventListener("click",    () => queueDir({ x: 0, y: -1 }));
document.querySelector("#btn-down").addEventListener("click",  () => queueDir({ x: 0, y:  1 }));
document.querySelector("#btn-left").addEventListener("click",  () => queueDir({ x: -1, y: 0 }));
document.querySelector("#btn-right").addEventListener("click", () => queueDir({ x:  1, y: 0 }));
overlayBtn.addEventListener("click", () => {
	if (g.phase === "idle" || g.phase === "gameover") startGame();
});

function queueDir(d) {
	if (d.x === -g.dir.x && d.y === -g.dir.y) return;
	g.nextDir = d;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
async function init() {
	try {
		const token = localStorage.getItem(SESSION_KEY);
		if (token) {
			const payload = await apiRequest("/api/cq/session");
			if (payload.currentUser) {
				g.currentUser = payload.currentUser;
				badgeName.textContent = payload.currentUser.handle;
				badgeScore.textContent = `CQ Score: ${payload.currentUser.stats.score}`;
				rewardsCopy.textContent = "+Score & +XP werden direkt gespeichert.";
			}
		}
	} catch (_) { /* no session */ }

	showOverlay("Snake Escape", "Fresse Äpfel. Wachse. Überlebe.\nPfeiltasten, WASD oder D-Pad.", "SPIELEN", "");
	draw(0); // draw initial idle canvas behind overlay
}

function startGame() {
	if (g.animId) cancelAnimationFrame(g.animId);

	// Preserve cross-run data
	const preserved = {
		currentUser: g.currentUser,
		highScore: Math.max(g.highScore, Number(localStorage.getItem(HS_KEY)) || 0),
		runLog: g.runLog,
	};
	g = makeState();
	Object.assign(g, preserved);

	g.phase = "playing";
	overlay.hidden = true;
	spawnApple();
	g.lastTick = performance.now();
	g.animId = requestAnimationFrame(loop);
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop(now) {
	g.animId = requestAnimationFrame(loop);
	const elapsed = now - g.lastTick;
	if (elapsed >= g.tickMs) {
		g.lastTick = now - (elapsed % g.tickMs);
		tick();
	}
	draw(now);
}

// ── Tick (logic step) ─────────────────────────────────────────────────────────
function tick() {
	if (g.phase !== "playing") return;

	g.dir = g.nextDir;
	const head = g.snake[0];
	const next = { x: head.x + g.dir.x, y: head.y + g.dir.y };

	// Wall collision
	if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
		die(); return;
	}
	// Self collision (exclude tail tip – it's about to move away)
	for (let i = 0; i < g.snake.length - 1; i++) {
		if (g.snake[i].x === next.x && g.snake[i].y === next.y) { die(); return; }
	}

	g.snake.unshift(next);

	let grow = false;

	if (g.apple && next.x === g.apple.x && next.y === g.apple.y) {
		g.score += 10 * g.level;
		g.eaten++;
		grow = true;
		spawnApple();
		checkLevelUp();
	} else if (g.golden && next.x === g.golden.x && next.y === g.golden.y) {
		g.score += 50 * g.level;
		g.eaten++;
		grow = true;
		g.golden = null;
		g.goldenTimer = 0;
		checkLevelUp();
	}

	if (!grow) g.snake.pop();

	// Tick golden apple lifetime
	if (g.golden) {
		g.goldenTimer--;
		if (g.goldenTimer <= 0) {
			g.golden = null;
			g.goldenSpawnTimer = 15 + Math.floor(Math.random() * 18);
		}
	} else {
		g.goldenSpawnTimer--;
		if (g.goldenSpawnTimer <= 0) {
			spawnGolden();
			g.goldenSpawnTimer = 18 + Math.floor(Math.random() * 20);
		}
	}

	if (g.score > g.highScore) {
		g.highScore = g.score;
		localStorage.setItem(HS_KEY, String(g.highScore));
	}

	updateHud();
}

function die() {
	g.lives--;
	g.phase = "dead";
	g.deathTime = performance.now();
	updateHud();

	if (g.lives <= 0) {
		setTimeout(async () => {
			g.phase = "gameover";
			await submitResult(g.eaten);
			showOverlay(
				"GAME OVER",
				`Score: ${g.score}  •  Level ${g.level}  •  ${g.eaten} Äpfel`,
				"NOCHMAL",
				g.score >= g.highScore && g.score > 0 ? `🏆 Neuer Highscore: ${g.highScore}` : `Highscore: ${g.highScore}`,
			);
		}, 950);
	} else {
		setTimeout(() => {
			g.snake = [{ x: 13, y: 9 }, { x: 12, y: 9 }, { x: 11, y: 9 }];
			g.dir = { x: 1, y: 0 };
			g.nextDir = { x: 1, y: 0 };
			g.phase = "playing";
			updateHud();
		}, 850);
	}
}

function checkLevelUp() {
	const newLevel = 1 + Math.floor(g.eaten / 5);
	if (newLevel > g.level) {
		g.level = newLevel;
		g.tickMs = Math.max(60, 150 - (g.level - 1) * 11);
	}
}

function spawnApple() {
	g.apple = randomFreeCell();
}

function spawnGolden() {
	g.golden = randomFreeCell();
	g.goldenTimer = 14;
}

function randomFreeCell() {
	const occupied = new Set(g.snake.map((s) => `${s.x},${s.y}`));
	if (g.apple)  occupied.add(`${g.apple.x},${g.apple.y}`);
	if (g.golden) occupied.add(`${g.golden.x},${g.golden.y}`);
	let pos;
	let tries = 0;
	do {
		pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
		tries++;
	} while (occupied.has(`${pos.x},${pos.y}`) && tries < 600);
	return pos;
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function draw(now) {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Background
	ctx.fillStyle = C.bg;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	drawGrid();
	if (g.apple)  drawApple(now);
	if (g.golden) drawGolden(now);
	drawSnake(now);
	if (g.phase === "dead" || g.phase === "gameover") drawDeathFlash(now);
}

function drawGrid() {
	ctx.strokeStyle = C.gridLine;
	ctx.lineWidth = 0.5;
	for (let x = 0; x <= COLS; x++) {
		ctx.beginPath();
		ctx.moveTo(x * CELL, 0);
		ctx.lineTo(x * CELL, canvas.height);
		ctx.stroke();
	}
	for (let y = 0; y <= ROWS; y++) {
		ctx.beginPath();
		ctx.moveTo(0, y * CELL);
		ctx.lineTo(canvas.width, y * CELL);
		ctx.stroke();
	}
	ctx.strokeStyle = C.border;
	ctx.lineWidth = 1.5;
	ctx.strokeRect(0.75, 0.75, canvas.width - 1.5, canvas.height - 1.5);
}

function drawSnake(now) {
	const len = g.snake.length;
	for (let i = len - 1; i >= 0; i--) {
		const seg = g.snake[i];
		const t = i / Math.max(1, len - 1);
		const shrink = i === 0 ? 0 : Math.min(4, 1 + i * 0.08);
		const x = seg.x * CELL + shrink;
		const y = seg.y * CELL + shrink;
		const size = CELL - shrink * 2;
		const r = i === 0 ? 9 : 5;
		const alpha = g.phase === "dead" ? 0.3 + (1 - t) * 0.25 : 0.35 + (1 - t) * 0.65;

		ctx.globalAlpha = alpha;
		ctx.shadowBlur = i === 0 ? 18 : 0;
		ctx.shadowColor = C.headGlow;
		ctx.fillStyle = i === 0 ? C.head : lerpHex(C.body1, C.body2, t);
		roundRect(ctx, x, y, size, size, r);
		ctx.fill();
	}
	ctx.shadowBlur = 0;
	ctx.globalAlpha = 1;

	// Eyes on head
	if (g.snake.length > 0 && g.phase !== "dead" && g.phase !== "gameover") {
		const seg = g.snake[0];
		const cx = seg.x * CELL + CELL / 2;
		const cy = seg.y * CELL + CELL / 2;
		const ex = g.dir.x;
		const ey = g.dir.y;
		const px = -ey;
		const py = ex;
		const eye1 = { x: cx + ex * 4 + px * 5, y: cy + ey * 4 + py * 5 };
		const eye2 = { x: cx + ex * 4 - px * 5, y: cy + ey * 4 - py * 5 };
		ctx.fillStyle = C.eyes;
		ctx.beginPath();
		ctx.arc(eye1.x, eye1.y, 2.4, 0, Math.PI * 2);
		ctx.arc(eye2.x, eye2.y, 2.4, 0, Math.PI * 2);
		ctx.fill();
		// Pupils
		ctx.fillStyle = "#050505";
		ctx.beginPath();
		ctx.arc(eye1.x + ex * 0.8, eye1.y + ey * 0.8, 1.2, 0, Math.PI * 2);
		ctx.arc(eye2.x + ex * 0.8, eye2.y + ey * 0.8, 1.2, 0, Math.PI * 2);
		ctx.fill();
	}
}

function drawApple(now) {
	const pulse = 0.88 + Math.sin(now / 360) * 0.12;
	const x = g.apple.x * CELL + CELL / 2;
	const y = g.apple.y * CELL + CELL / 2;
	const r = (CELL / 2 - 3) * pulse;
	ctx.shadowColor = C.appleGlow;
	ctx.shadowBlur = 18;
	ctx.fillStyle = C.apple;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.shadowBlur = 0;
	// Stem
	ctx.strokeStyle = "rgba(255,180,130,0.7)";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(x, y - r);
	ctx.lineTo(x + 3, y - r - 4);
	ctx.stroke();
}

function drawGolden(now) {
	const pulse = 0.82 + Math.sin(now / 190) * 0.18;
	const x = g.golden.x * CELL + CELL / 2;
	const y = g.golden.y * CELL + CELL / 2;
	const r = (CELL / 2 - 2) * pulse;
	const fade = Math.max(0.4, g.goldenTimer / 14);

	ctx.globalAlpha = fade;
	ctx.shadowColor = C.goldGlow;
	ctx.shadowBlur = 26;
	ctx.fillStyle = C.gold;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.globalAlpha = Math.min(1, fade * 1.2);
	// Star glyph
	ctx.fillStyle = "rgba(255,255,255,0.88)";
	ctx.font = `bold ${Math.round(r * 1.05)}px Space Grotesk, sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("★", x, y + 1);
	ctx.globalAlpha = 1;
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
}

function drawDeathFlash(now) {
	const elapsed = now - g.deathTime;
	const duration = g.lives <= 0 ? 950 : 850;
	const t = Math.min(1, elapsed / duration);
	const flash = Math.sin(Math.PI * t * 4) * (1 - t);
	const alpha = Math.max(0, 0.52 * flash);
	if (alpha > 0.005) {
		ctx.fillStyle = `rgba(255,71,87,${alpha.toFixed(3)})`;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHud() {
	hudScore.textContent = String(g.score);
	hudHigh.textContent  = String(g.highScore);
	hudLevel.textContent = String(g.level);
	const hearts = "♥".repeat(Math.max(0, g.lives)) + "♡".repeat(Math.max(0, 3 - g.lives));
	hudLives.textContent = hearts;
}

function showOverlay(title, copy, btnLabel, sub) {
	overlay.hidden = false;
	overlayTitle.textContent = title;
	overlayCopy.innerHTML = escapeHtml(copy).replaceAll("\n", "<br>");
	overlayBtn.textContent = btnLabel;
	overlaySub.textContent = sub;
}

// ── Score submission ──────────────────────────────────────────────────────────
async function submitResult(eaten) {
	const capped = Math.min(eaten, 50);
	pushRunLog(capped > 0 ? `${capped} Äpfel gefressen (Score: ${g.score})` : "Kein Fortschritt.");
	if (capped <= 0 || !g.currentUser) return;
	try {
		const payload = await apiRequest("/api/cq/games/single", {
			method: "POST",
			body: { gameType: "snake-escape", rawScore: capped, summary: `Snake Escape: ${capped} Äpfel. Score: ${g.score}.` },
		});
		const r = payload.rewards;
		const entry = `+${r.score} Score • +${r.xp} XP`;
		pushRunLog(entry);
		rewardsCopy.textContent = entry;
		if (payload.currentUser) {
			g.currentUser = payload.currentUser;
			badgeScore.textContent = `CQ Score: ${payload.currentUser.stats.score}`;
		}
	} catch (err) {
		pushRunLog("Score-Sync fehlgeschlagen.");
	}
}

function pushRunLog(text) {
	g.runLog.unshift(text);
	g.runLog = g.runLog.slice(0, 8);
	runLogList.innerHTML = g.runLog
		.map((t) => `<p class="run-entry">${escapeHtml(t)}</p>`)
		.join("");
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function roundRect(context, x, y, w, h, r) {
	context.beginPath();
	context.moveTo(x + r, y);
	context.lineTo(x + w - r, y);
	context.quadraticCurveTo(x + w, y, x + w, y + r);
	context.lineTo(x + w, y + h - r);
	context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	context.lineTo(x + r, y + h);
	context.quadraticCurveTo(x, y + h, x, y + h - r);
	context.lineTo(x, y + r);
	context.quadraticCurveTo(x, y, x + r, y);
	context.closePath();
}

function lerpHex(a, b, t) {
	const parse = (hex) => {
		const n = parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	};
	const ca = parse(a);
	const cb = parse(b);
	const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
	const g2 = Math.round(ca[1] + (cb[1] - ca[1]) * t);
	const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
	return `rgb(${r},${g2},${bl})`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

async function apiRequest(url, options = {}) {
	const token = localStorage.getItem(SESSION_KEY) || "";
	const headers = { "Content-Type": "application/json" };
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(url, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || "Fehler");
	return data;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
