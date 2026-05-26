// server.js
// Deal Duck Voice Likes OBS Widget
// Railway-ready, no npm packages needed.
// OBS Browser Source: Width 800, Height 600
// Put taksi.mp3 next to this file.

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  PORT: Number(process.env.PORT || 3000),

  // Roblox PlaceId / UniverseId
  ROBLOX_ID: Number(process.env.ROBLOX_ID || 9901911212),

  // Проверка лайков
  POLL_MS: Number(process.env.POLL_MS || 10000),

  // На Railway лучше поставить STATE_FILE=/data/likes-state.json
  STATE_FILE: process.env.STATE_FILE || (
    fs.existsSync("/data") ? "/data/likes-state.json" : "./likes-state.json"
  ),

  SOUND_FILE: process.env.SOUND_FILE || "./taksi.mp3",

  DEFAULT_GAME_NAME: "Deal Duck Voice [BETA]"
};

let state = {
  placeId: CONFIG.ROBLOX_ID,
  universeId: null,
  name: CONFIG.DEFAULT_GAME_NAME,

  realLikes: 0,
  shownLikes: 0,
  recordLikes: 0,

  eventSerial: 0,
  ready: false,
  error: null,
  lastCheckAt: 0
};

let firstSuccessfulPoll = true;

function loadSavedState() {
  try {
    if (!fs.existsSync(CONFIG.STATE_FILE)) return;

    const data = JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, "utf8"));

    if (typeof data.placeId === "number") state.placeId = data.placeId;
    if (typeof data.universeId === "number") state.universeId = data.universeId;
    if (typeof data.name === "string" && data.name.length > 0) state.name = data.name;
    if (typeof data.realLikes === "number") state.realLikes = data.realLikes;
    if (typeof data.shownLikes === "number") state.shownLikes = data.shownLikes;
    if (typeof data.recordLikes === "number") state.recordLikes = data.recordLikes;
    if (typeof data.eventSerial === "number") state.eventSerial = data.eventSerial;
  } catch (err) {
    console.log("[LOAD SAVE ERROR]", err.message);
  }
}

function saveState() {
  try {
    const dir = path.dirname(CONFIG.STATE_FILE);

    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      CONFIG.STATE_FILE,
      JSON.stringify(
        {
          placeId: state.placeId,
          universeId: state.universeId,
          name: state.name,
          realLikes: state.realLikes,
          shownLikes: state.shownLikes,
          recordLikes: state.recordLikes,
          eventSerial: state.eventSerial,
          savedAt: Date.now()
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log("[SAVE ERROR]", err.message);
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "DealDuckVoice-Likes-OBS-Widget/1.0"
        }
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error("HTTP " + res.statusCode + " | " + url));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error("JSON parse error: " + err.message));
          }
        });
      }
    );

    req.on("error", reject);

    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

async function resolveGame() {
  if (state.universeId) return;

  try {
    const url =
      "https://games.roblox.com/v1/games/multiget-place-details?placeIds=" +
      CONFIG.ROBLOX_ID;

    const data = await getJson(url);
    const item = Array.isArray(data) ? data[0] : null;

    if (item && item.universeId) {
      state.placeId = Number(item.placeId || CONFIG.ROBLOX_ID);
      state.universeId = Number(item.universeId);
      state.name = String(item.name || state.name);

      console.log("[GAME] PlaceId:", state.placeId);
      console.log("[GAME] UniverseId:", state.universeId);
      console.log("[GAME] Name:", state.name);

      saveState();
      return;
    }
  } catch (err) {
    console.log("[RESOLVE PLACE FAILED]", err.message);
  }

  try {
    const url =
      "https://games.roblox.com/v1/games?universeIds=" +
      CONFIG.ROBLOX_ID;

    const data = await getJson(url);
    const item = data && Array.isArray(data.data) ? data.data[0] : null;

    if (item && item.id) {
      state.universeId = Number(item.id);
      state.placeId = Number(item.rootPlaceId || CONFIG.ROBLOX_ID);
      state.name = String(item.name || state.name);

      console.log("[GAME] UniverseId:", state.universeId);
      console.log("[GAME] PlaceId:", state.placeId);
      console.log("[GAME] Name:", state.name);

      saveState();
      return;
    }
  } catch (err) {
    console.log("[RESOLVE UNIVERSE FAILED]", err.message);
  }

  throw new Error("Не смог найти Roblox режим по ID " + CONFIG.ROBLOX_ID);
}

async function updateGameInfo() {
  if (!state.universeId) return;

  const url =
    "https://games.roblox.com/v1/games?universeIds=" +
    state.universeId;

  const data = await getJson(url);
  const item = data && Array.isArray(data.data) ? data.data[0] : null;

  if (item) {
    state.name = String(item.name || state.name);
    state.placeId = Number(item.rootPlaceId || state.placeId);
  }
}

async function getVotes() {
  await resolveGame();

  const url =
    "https://games.roblox.com/v1/games/votes?universeIds=" +
    state.universeId;

  const data = await getJson(url);
  const item = data && Array.isArray(data.data) ? data.data[0] : null;

  if (!item || typeof item.upVotes === "undefined") {
    throw new Error("Roblox не вернул upVotes");
  }

  return {
    upVotes: Number(item.upVotes || 0),
    downVotes: Number(item.downVotes || 0)
  };
}

async function pollLikes() {
  try {
    await resolveGame();

    if (firstSuccessfulPoll) {
      await updateGameInfo();
    }

    const votes = await getVotes();
    const realLikes = votes.upVotes;

    state.realLikes = realLikes;
    state.lastCheckAt = Date.now();
    state.ready = true;
    state.error = null;

    if (firstSuccessfulPoll) {
      if (realLikes > state.recordLikes) {
        state.recordLikes = realLikes;
        state.shownLikes = realLikes;
      } else {
        state.shownLikes = state.recordLikes;
      }

      firstSuccessfulPoll = false;
      saveState();

      console.log("[LIKES] Первый запуск:", realLikes);
      return;
    }

    // Защита:
    // лайки вниз не идут;
    // снял лайк и вернул обратно — звука нет;
    // звук и фейерверк только если лайки стали выше рекорда.
    if (realLikes > state.recordLikes) {
      state.recordLikes = realLikes;
      state.shownLikes = realLikes;
      state.eventSerial += 1;

      console.log("[NEW LIKE RECORD]", realLikes);
      saveState();
    } else {
      state.shownLikes = state.recordLikes;
    }
  } catch (err) {
    state.error = err.message;
    console.log("[POLL ERROR]", err.message);
  }
}

function sendJson(res, data) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(html);
}

function sendSound(res) {
  const filePath = path.resolve(CONFIG.SOUND_FILE);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end("taksi.mp3 not found");
    return;
  }

  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=60"
  });

  fs.createReadStream(filePath).pipe(res);
}

function obsHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Deal Duck Likes OBS</title>
  <style>
    :root {
      --bg0: rgba(9, 10, 13, 0.91);
      --bg1: rgba(28, 31, 36, 0.88);
      --line: rgba(255, 255, 255, 0.13);
      --text: #f5f7fb;
      --muted: rgba(245, 247, 251, 0.58);
      --gold: #ffcc3d;
      --gold2: #ff9f22;
      --green: #34d86d;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      font-family: "Builder Sans", "Gotham SSm", "Segoe UI", Arial, sans-serif;
    }

    .fireworks {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 50;
    }

    .stage {
      position: relative;
      width: 100vw;
      height: 100vh;
    }

    /* Под OBS 800x600 */
    .widgetStack {
      position: absolute;
      right: 58px;
      bottom: 58px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 22px;
      z-index: 20;
    }

    /* Напоминалка теперь выше и ближе именно к счётчику */
    .promptWrap {
      align-self: flex-end;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      margin-right: 8px;
      opacity: 0;
      transform: translateY(18px) scale(0.96);
      pointer-events: none;
    }

    .promptWrap.show {
      animation: promptInOut 5s ease-in-out forwards;
    }

    .promptText {
      padding: 9px 16px 10px;
      border-radius: 999px;
      background:
        radial-gradient(circle at 20% 0%, rgba(255,255,255,0.17), transparent 42%),
        linear-gradient(135deg, rgba(34,37,44,0.95), rgba(10,11,15,0.95));
      border: 1px solid rgba(255,255,255,0.17);
      box-shadow:
        0 13px 38px rgba(0,0,0,0.44),
        0 0 22px rgba(255,204,61,0.08),
        inset 0 1px 0 rgba(255,255,255,0.15);
      color: #ffffff;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: -0.25px;
      white-space: nowrap;
      text-shadow: 0 2px 10px rgba(0,0,0,0.65);
    }

    .promptText .gold {
      color: var(--gold);
      text-shadow:
        0 2px 10px rgba(0,0,0,0.65),
        0 0 14px rgba(255,204,61,0.36);
    }

    .promptArrow {
      font-size: 36px;
      line-height: 1;
      color: var(--gold);
      text-shadow:
        0 4px 16px rgba(0,0,0,0.85),
        0 0 20px rgba(255,204,61,0.58);
      animation: arrowBlink 1s ease-in-out infinite;
    }

    .card {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 14px;
      max-width: 640px;
      padding: 12px 14px;
      border-radius: 22px;
      background:
        radial-gradient(circle at 16% 0%, rgba(255,255,255,0.13), transparent 35%),
        linear-gradient(135deg, var(--bg1), var(--bg0) 58%, rgba(5,6,9,0.94));
      border: 1px solid var(--line);
      box-shadow:
        0 18px 48px rgba(0,0,0,0.46),
        inset 0 1px 0 rgba(255,255,255,0.13),
        inset 0 -1px 0 rgba(0,0,0,0.42);
      color: var(--text);
      overflow: hidden;
      transform-origin: right bottom;
    }

    .card::before {
      content: "";
      position: absolute;
      inset: 1px;
      border-radius: 21px;
      border: 1px solid rgba(255,255,255,0.055);
      pointer-events: none;
    }

    .card::after {
      content: "";
      position: absolute;
      width: 210px;
      height: 80px;
      left: -62px;
      top: -54px;
      background: rgba(255,255,255,0.12);
      filter: blur(34px);
      pointer-events: none;
    }

    .iconBox {
      position: relative;
      width: 54px;
      height: 54px;
      flex: 0 0 54px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 45% 28%, rgba(255, 220, 86, 0.36), transparent 45%),
        linear-gradient(145deg, rgba(255,255,255,0.1), rgba(0,0,0,0.25));
      border: 1px solid rgba(255, 210, 70, 0.3);
      box-shadow:
        0 9px 22px rgba(0,0,0,0.38),
        0 0 24px rgba(255,190,40,0.17),
        inset 0 1px 0 rgba(255,255,255,0.18);
      z-index: 2;
    }

    .icon {
      font-size: 32px;
      transform: translateY(-1px);
      filter:
        drop-shadow(0 4px 8px rgba(0,0,0,0.42))
        drop-shadow(0 0 9px rgba(255,190,42,0.36));
    }

    .main {
      min-width: 0;
      width: 325px;
      z-index: 2;
    }

    .title {
      font-size: 22px;
      font-weight: 850;
      letter-spacing: -0.35px;
      line-height: 1.05;
      color: var(--text);
      text-shadow: 0 2px 10px rgba(0,0,0,0.62);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sub {
      margin-top: 6px;
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12.5px;
      font-weight: 750;
      line-height: 1;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px rgba(52,216,109,0.8);
    }

    .divider {
      width: 1px;
      height: 52px;
      flex: 0 0 1px;
      background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.18), transparent);
      z-index: 2;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 13px 9px 11px;
      border-radius: 18px;
      background: linear-gradient(145deg, rgba(0,0,0,0.19), rgba(255,255,255,0.06));
      border: 1px solid rgba(255,255,255,0.085);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
      min-width: 134px;
      justify-content: flex-end;
      z-index: 2;
    }

    .miniLike {
      font-size: 26px;
      filter: drop-shadow(0 0 10px rgba(255,196,47,0.38));
    }

    .numWrap {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      line-height: 1;
    }

    .likes {
      font-size: 36px;
      font-weight: 950;
      letter-spacing: -1px;
      color: #ffffff;
      text-shadow:
        0 2px 0 rgba(0,0,0,0.35),
        0 5px 16px rgba(0,0,0,0.62);
    }

    .label {
      margin-top: 4px;
      color: rgba(245,247,251,0.55);
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .shine {
      position: absolute;
      inset: -2px;
      opacity: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at 80% 50%, rgba(255,204,67,0.3), transparent 34%),
        linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.19) 45%, transparent 62%);
      z-index: 1;
    }

    .error {
      display: none;
      position: absolute;
      right: 10px;
      bottom: -18px;
      font-size: 11px;
      font-weight: 700;
      color: rgba(255,120,120,0.95);
      text-shadow: 0 2px 8px rgba(0,0,0,0.75);
    }

    .card.pulse {
      animation: pop 0.85s cubic-bezier(.2,.8,.2,1);
    }

    .shine.play {
      animation: shine 1.15s ease;
    }

    .card.pulse .iconBox {
      animation: iconPop 0.85s cubic-bezier(.2,.8,.2,1);
    }

    .card.pulse .likes {
      animation: numberPop 0.85s cubic-bezier(.2,.8,.2,1);
    }

    .card.pulse .stat {
      animation: statGlow 1.05s ease;
    }

    @keyframes promptInOut {
      0% {
        opacity: 0;
        transform: translateY(18px) scale(0.96);
      }
      13% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      78% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateY(14px) scale(0.97);
      }
    }

    @keyframes arrowBlink {
      0%, 100% {
        opacity: 0.34;
        transform: translateY(-2px);
      }
      50% {
        opacity: 1;
        transform: translateY(9px);
      }
    }

    @keyframes pop {
      0% { transform: scale(1); }
      24% { transform: scale(1.055); }
      55% { transform: scale(0.992); }
      100% { transform: scale(1); }
    }

    @keyframes iconPop {
      0% { transform: scale(1) rotate(0deg); }
      35% { transform: scale(1.17) rotate(-5deg); }
      100% { transform: scale(1) rotate(0deg); }
    }

    @keyframes numberPop {
      0% { transform: translateY(0) scale(1); }
      35% { transform: translateY(-4px) scale(1.08); }
      100% { transform: translateY(0) scale(1); }
    }

    @keyframes statGlow {
      0% {
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.08),
          0 0 0 rgba(255,204,61,0);
      }
      35% {
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.12),
          0 0 38px rgba(255,204,61,0.38);
      }
      100% {
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,0.08),
          0 0 0 rgba(255,204,61,0);
      }
    }

    @keyframes shine {
      0% { opacity: 0; transform: translateX(-35%); }
      18% { opacity: 1; }
      100% { opacity: 0; transform: translateX(35%); }
    }
  </style>
</head>
<body>
  <canvas class="fireworks" id="fireworks"></canvas>

  <div class="stage">
    <div class="widgetStack">
      <div class="promptWrap" id="promptWrap">
        <div class="promptText">Поставь <span class="gold">лайк</span>, будет сюрприз</div>
        <div class="promptArrow">↓</div>
      </div>

      <div class="card" id="card">
        <div class="shine" id="shine"></div>

        <div class="iconBox">
          <div class="icon">👍</div>
        </div>

        <div class="main">
          <div class="title" id="gameName">Deal Duck Voice [BETA]</div>
          <div class="sub">
            <span class="dot"></span>
            <span>живой счётчик лайков</span>
          </div>
        </div>

        <div class="divider"></div>

        <div class="stat" id="statBox">
          <div class="miniLike">👍</div>
          <div class="numWrap">
            <div class="likes" id="likes">0</div>
            <div class="label">лайков режима</div>
          </div>
        </div>

        <div class="error" id="errorBox">Ошибка обновления</div>
      </div>
    </div>
  </div>

  <audio id="likeSound" src="/taksi.mp3" preload="auto"></audio>

  <script>
    const card = document.getElementById("card");
    const shine = document.getElementById("shine");
    const statBox = document.getElementById("statBox");
    const gameName = document.getElementById("gameName");
    const likes = document.getElementById("likes");
    const errorBox = document.getElementById("errorBox");
    const likeSound = document.getElementById("likeSound");
    const promptWrap = document.getElementById("promptWrap");
    const canvas = document.getElementById("fireworks");
    const ctx = canvas.getContext("2d");

    let lastEventSerial = null;
    let particles = [];
    let fireworkRunning = false;

    const PROMPT_EVERY_MS = 5 * 60 * 1000;
    const PROMPT_DURATION_MS = 5000;

    likeSound.volume = 0.85;

    function formatNumber(n) {
      return Number(n || 0).toLocaleString("ru-RU");
    }

    function resizeCanvas() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    function playLikeSound() {
      try {
        likeSound.pause();
        likeSound.currentTime = 0;

        const p = likeSound.play();

        if (p && typeof p.catch === "function") {
          p.catch(function() {});
        }
      } catch (err) {}
    }

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function createBurst(x, y, count, power) {
      const colors = [
        "#ffcc3d",
        "#fff4a8",
        "#ff8a2a",
        "#ffffff",
        "#7dfcff",
        "#b68cff"
      ];

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = rand(power * 0.45, power);
        const size = rand(2.2, 4.8);

        particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.85, 1.25),
          maxLife: 1.25,
          size: size,
          color: colors[Math.floor(Math.random() * colors.length)],
          gravity: rand(0.028, 0.055)
        });
      }
    }

    function createSparkRain(x, y, count) {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: x + rand(-90, 90),
          y: y + rand(-25, 25),
          vx: rand(-1.4, 1.4),
          vy: rand(-4.2, -1.2),
          life: rand(0.75, 1.15),
          maxLife: 1.15,
          size: rand(1.6, 3.8),
          color: Math.random() > 0.5 ? "#ffcc3d" : "#ffffff",
          gravity: rand(0.04, 0.07)
        });
      }
    }

    function startFireworks() {
      resizeCanvas();

      const statRect = statBox.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      const cx = statRect.left + statRect.width * 0.5;
      const cy = statRect.top + statRect.height * 0.5;

      createBurst(cx, cy, 58, 5.8);
      createBurst(cardRect.left + 80, cardRect.top + 12, 34, 4.6);
      createBurst(cardRect.right - 44, cardRect.top + 8, 38, 4.9);
      createSparkRain(cx, cy - 22, 42);

      if (!fireworkRunning) {
        fireworkRunning = true;
        requestAnimationFrame(tickFireworks);
      }
    }

    function tickFireworks() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const dt = 0.016;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        p.life -= dt;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy *= 0.985;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        const alpha = Math.max(0, p.life / p.maxLife);
        const r = p.size * (0.75 + alpha * 0.55);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 14;

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      if (particles.length > 0) {
        requestAnimationFrame(tickFireworks);
      } else {
        fireworkRunning = false;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    function playEffect() {
      card.classList.remove("pulse");
      shine.classList.remove("play");

      void card.offsetWidth;
      void shine.offsetWidth;

      card.classList.add("pulse");
      shine.classList.add("play");

      playLikeSound();
      startFireworks();
    }

    function showPrompt() {
      promptWrap.classList.remove("show");
      void promptWrap.offsetWidth;
      promptWrap.classList.add("show");

      setTimeout(function() {
        promptWrap.classList.remove("show");
      }, PROMPT_DURATION_MS + 120);
    }

    async function update() {
      try {
        const res = await fetch("/state?t=" + Date.now());
        const data = await res.json();

        if (!data || !data.ok || !data.state) return;

        const s = data.state;

        gameName.textContent = s.name || "Deal Duck Voice [BETA]";
        likes.textContent = formatNumber(s.shownLikes || 0);

        if (s.error) {
          errorBox.style.display = "block";
          errorBox.textContent = "Ошибка обновления";
        } else {
          errorBox.style.display = "none";
        }

        const serial = Number(s.eventSerial || 0);

        if (lastEventSerial === null) {
          lastEventSerial = serial;
          return;
        }

        if (serial > lastEventSerial) {
          lastEventSerial = serial;
          playEffect();
        }
      } catch (err) {
        errorBox.style.display = "block";
        errorBox.textContent = "Нет связи";
      }
    }

    update();
    setInterval(update, 2000);

    setInterval(showPrompt, PROMPT_EVERY_MS);
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const cleanPath = req.url.split("?")[0];

  if (cleanPath === "/") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end("Deal Duck Likes Widget works. Open /obs");
    return;
  }

  if (cleanPath === "/state") {
    sendJson(res, {
      ok: true,
      state
    });
    return;
  }

  if (cleanPath === "/obs") {
    sendHtml(res, obsHtml());
    return;
  }

  if (cleanPath === "/taksi.mp3") {
    sendSound(res);
    return;
  }

  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("404");
});

loadSavedState();

server.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log("[SERVER] Started on port:", CONFIG.PORT);
  console.log("[LOCAL] http://localhost:" + CONFIG.PORT + "/obs");
  console.log("[ROBLOX_ID]", CONFIG.ROBLOX_ID);
  console.log("[STATE_FILE]", CONFIG.STATE_FILE);

  if (!fs.existsSync(CONFIG.SOUND_FILE)) {
    console.log("[SOUND WARNING] taksi.mp3 not found:", path.resolve(CONFIG.SOUND_FILE));
  }
});

pollLikes();
setInterval(pollLikes, CONFIG.POLL_MS);
