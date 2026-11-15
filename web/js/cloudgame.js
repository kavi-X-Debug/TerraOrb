// "Rain Cloud": a steering game (#/learn/cloud), in the style of a slider game.
//
//   Part 1  Fly the cloud over the sea. Warm water (yellow/green) fills the cloud with water; cool water (dark blue) does not.
//   Part 2  Fly over the land and stop over the tanks. The cloud rains on a tank and fills it up.
//
// You move the cloud left and right with a slider (or the arrow buttons, or the arrow keys, or by dragging the picture).
// The idea it teaches is true: warm seas give the air more water, and the monsoon carries that water to the land as rain.
// The sea-warmth map is only game art (it is NOT data, and says so on screen). Everything is drawn with code (no picture files),
// and the music is made live by cloudaudio.js. Five levels, easy to hard, unlock one by one.
// Only the "music on / off" choice and the stars you won on each level are remembered (in this browser).
// All text is in si.json / en.json (keys "cg.*").
import { t } from "./i18n.js";
import { escapeHtml } from "./ui.js";
import { createAudio } from "./cloudaudio.js";
import { reward } from "./rewards.js";

const W = 640, H = 360;                 // size of the picture
const LOW = 2;                          // the sea map is drawn at half size (320 x 180) and scaled up
// Five levels, easy to hard. Each one changes the same few things:
//   speed    how fast the map scrolls (pixels per second)
//   sea/land how long each part of the map is
//   tanks / need   how many tanks there are, and how much water each one drinks (a full cloud holds 100)
//   r              how wide the warm path through the sea is (narrower = harder)
//   leak     water the cloud loses over cool sea      drain   water it loses over plain land
//   hit      how wide the "rain zone" under the cloud is when it tries to fill a tank
const LEVELS = [
  { speed: 46, sea: 780, land: 640, tanks: 2, need: 25, r: [64, 80], leak: 1, drain: 3, hit: 58 },
  { speed: 54, sea: 840, land: 700, tanks: 3, need: 25, r: [54, 68], leak: 2, drain: 4, hit: 52 },
  { speed: 62, sea: 880, land: 780, tanks: 4, need: 25, r: [46, 58], leak: 3, drain: 4, hit: 46 },
  { speed: 72, sea: 920, land: 860, tanks: 4, need: 25, r: [40, 50], leak: 6, drain: 8, hit: 40 },
  { speed: 82, sea: 960, land: 960, tanks: 5, need: 20, r: [34, 44], leak: 8, drain: 10, hit: 34 },
];
let SPEED = 62, SEA_LEN = 880, LAND_LEN = 780;        // set from the chosen level when a round starts
const CLOUD_Y = 250;                    // where the cloud sits on the picture
const RAIN_Y = CLOUD_Y + 40;            // where its rain lands (a tank must be here to be filled)
let TANK_COUNT = 4, TANK_NEED = 25;                   // how many tanks, and the water units each needs (set by the level)
const STOPS = [[20, 92, 160], [30, 134, 192], [44, 178, 212], [96, 218, 210], [200, 246, 224]];     // cool ... warm
const LUT = Array.from({ length: 101 }, (_, i) => {                       // sea colour for warmth 0..1, blended smoothly
  const x = (i / 100) * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(x)), f = x - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The cloud picture (made with Google Flow, see the Data sources page). If it has not loaded, the game draws a plain cloud instead.
const cloudImg = new Image();
cloudImg.src = "img/game/cloud.png";
const sprite = {};                                                        // palm, tank, paddy, sun (also made with Google Flow)
for (const n of ["palm", "tank", "paddy", "sun"]) { sprite[n] = new Image(); sprite[n].src = `img/game/${n}.png`; }
const ready = (n) => sprite[n].complete && sprite[n].naturalWidth > 0;     // if a picture is missing, the code-drawn version is used
let stormImg = null;                                                      // the same cloud, tinted grey-blue; faded in as the cloud fills up
cloudImg.onload = () => {
  const c = document.createElement("canvas");
  c.width = cloudImg.naturalWidth; c.height = cloudImg.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(cloudImg, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(90,110,148,.55)"; g.fillRect(0, 0, c.width, c.height);
  stormImg = c;
};

// ---- Scenery made once with code (no picture files) ---------------------------------------------------------
// It is a "seamless" tile, so it can repeat and scroll without any visible joins.
const TILE = 256;
let landTile = null, seaTex = null;

// Two seamless grey pictures used to light the sea, made once from smooth random noise:
//   caustic  a bright honeycomb of thin lines, like sunlight rippling on a sandy sea bed (strongest in the shallow, warm water)
//   swell    soft broad light and dark patches, like long ocean swells
function makeSeaTextures() {
  const octaves = [[8, 1], [16, 0.5], [32, 0.25]], total = 1.75;
  const grids = octaves.map(([n]) => Float32Array.from({ length: n * n }, Math.random));
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (gr, n, x, y) => {                                         // wraps around, so there are no seams
    const fx = x / TILE * n, fy = y / TILE * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = gr[(y0 % n) * n + (x0 % n)], b = gr[(y0 % n) * n + ((x0 + 1) % n)], cc = gr[((y0 + 1) % n) * n + (x0 % n)], d = gr[((y0 + 1) % n) * n + ((x0 + 1) % n)];
    return (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
  };
  const caustic = new Uint8Array(TILE * TILE), swell = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    let v = 0;
    octaves.forEach(([n, w], k) => { v += sample(grids[k], n, x, y) * w; });
    v /= total;
    swell[y * TILE + x] = Math.round(Math.min(1, Math.max(0, (v - 0.25) * 2)) * 255);
  }
  const N = 18, cell = TILE / N, pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([(i + 0.1 + Math.random() * 0.8) * cell, (j + 0.1 + Math.random() * 0.8) * cell]);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    let d1 = 1e9, d2 = 1e9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const q = pts[((cj + dj + N) % N) * N + ((ci + di + N) % N)];
      let dx = Math.abs(x - q[0]), dy = Math.abs(y - q[1]);
      if (dx > TILE / 2) dx = TILE - dx;
      if (dy > TILE / 2) dy = TILE - dy;
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    caustic[y * TILE + x] = Math.round(Math.pow(Math.max(0, 1 - (d2 - d1) / 3), 2) * 255);
  }
  return { caustic, swell };
}

// Dry, sun-baked earth seen from above (this is the Dry Zone): soft patches of three earth colours with a darker outline,
// pebbles, dry grass tufts, cracks and a few tiny green sprouts. Smooth random noise picks the patch; the tile wraps on every side.
function makeLandTile() {
  const c = document.createElement("canvas"); c.width = c.height = TILE;
  const g = c.getContext("2d"), im = g.createImageData(TILE, TILE);
  const octaves = [[4, 1], [8, 0.5]], total = 1.5;
  const grids = octaves.map(([n]) => Float32Array.from({ length: n * n }, Math.random));
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (gr, n, x, y) => {
    const fx = x / TILE * n, fy = y / TILE * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = gr[(y0 % n) * n + (x0 % n)], b = gr[(y0 % n) * n + ((x0 + 1) % n)], cc = gr[((y0 + 1) % n) * n + (x0 % n)], d = gr[((y0 + 1) % n) * n + ((x0 + 1) % n)];
    return (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
  };
  const shades = [[228, 198, 142], [214, 178, 120], [240, 214, 160]];                     // medium, darker, light
  const outline = [184, 146, 96];
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    let v = 0;
    octaves.forEach(([n, w], k) => { v += sample(grids[k], n, x, y) * w; });
    v /= total;
    const band = v < 0.4 ? 1 : v > 0.6 ? 2 : 0;
    const near = Math.min(Math.abs(v - 0.4), Math.abs(v - 0.6)) < 0.012;
    const col = near ? outline : shades[band];
    const grain = (Math.random() - 0.5) * 7, i = (y * TILE + x) * 4;
    im.data[i] = col[0] + grain; im.data[i + 1] = col[1] + grain; im.data[i + 2] = col[2] + grain * 0.8; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const at = (fn) => { for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) fn(ox, oy); };       // drawn again at the edges so it wraps
  g.lineCap = "round"; g.lineJoin = "round";
  for (let k = 0; k < 16; k++) {                                                            // cracks in the dry earth
    const x = Math.random() * TILE, y = Math.random() * TILE, an = Math.random() * 6.3;
    g.strokeStyle = "rgba(150,112,70,.55)"; g.lineWidth = 1.6;
    at((ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(an) * 9, y + oy + Math.sin(an) * 9); g.lineTo(x + ox + Math.cos(an + 0.7) * 17, y + oy + Math.sin(an + 0.7) * 17); g.stroke(); });
  }
  for (let k = 0; k < 44; k++) {                                                            // pebbles
    const x = Math.random() * TILE, y = Math.random() * TILE, r = 2 + Math.random() * 2.2;
    at((ox, oy) => {
      g.fillStyle = "rgba(120,92,60,.28)"; g.beginPath(); g.ellipse(x + ox + 1.2, y + oy + 1.4, r * 1.2, r * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = "#C9B08C"; g.beginPath(); g.ellipse(x + ox, y + oy, r * 1.2, r * 0.85, 0, 0, 7); g.fill();
      g.fillStyle = "rgba(255,255,255,.45)"; g.beginPath(); g.ellipse(x + ox - r * 0.3, y + oy - r * 0.3, r * 0.4, r * 0.25, 0, 0, 7); g.fill();
    });
  }
  const dryGrass = ["rgba(160,150,70,.9)", "rgba(196,170,84,.9)"];
  for (let k = 0; k < 36; k++) {                                                            // dry grass tufts
    const x = Math.random() * TILE, y = Math.random() * TILE;
    g.strokeStyle = dryGrass[k % 2]; g.lineWidth = 2;
    at((ox, oy) => { g.beginPath(); g.moveTo(x + ox - 4, y + oy); g.lineTo(x + ox - 6, y + oy - 6); g.moveTo(x + ox, y + oy); g.lineTo(x + ox, y + oy - 8); g.moveTo(x + ox + 4, y + oy); g.lineTo(x + ox + 6, y + oy - 6); g.stroke(); });
  }
  for (let k = 0; k < 10; k++) {                                                            // a few tiny green sprouts
    const x = Math.random() * TILE, y = Math.random() * TILE;
    at((ox, oy) => {
      g.strokeStyle = "#5FAE4A"; g.lineWidth = 2; g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox, y + oy - 6); g.stroke();
      g.fillStyle = "#7BCB5E"; g.beginPath(); g.ellipse(x + ox - 3, y + oy - 6, 3, 1.8, -0.5, 0, 7); g.ellipse(x + ox + 3, y + oy - 6, 3, 1.8, 0.5, 0, 7); g.fill();
    });
  }
  return c;
}

let muted = false;                                                        // music on / off (remembered)
try { muted = localStorage.getItem("mc-cloud-muted") === "1"; } catch { /* private window: just start with music on */ }

// stars won on each level (0..tanks), kept in this browser only
const loadStars = () => { try { return JSON.parse(localStorage.getItem("mc-cloud-stars")) || []; } catch { return []; } };
const saveStar = (lvl, n) => { try { const a = loadStars(); a[lvl] = Math.max(a[lvl] || 0, n); localStorage.setItem("mc-cloud-stars", JSON.stringify(a)); } catch { /* not saved: fine */ } };
const passMark = (L) => Math.ceil(L.tanks / 2);                        // fill half of the tanks (rounded up) to unlock the next level
const unlocked = (i, stars) => i === 0 || (stars[i - 1] || 0) >= passMark(LEVELS[i - 1]);

let stopper = null;                     // stops the animation when the page changes
function guard(view, fn) {
  stopper?.();
  stopper = fn;
  const leave = () => { if (!view.isConnected || !location.hash.startsWith("#/learn/cloud")) { fn(); window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave);
}

const frame = (body) => `
  <div class="tank-head learn-head">
    <button type="button" class="back" data-go="#/learn/kids">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
      ${escapeHtml(t("kd.back"))}
    </button>
    <h1>${escapeHtml(t("cg.title"))}</h1>
  </div>
  <div class="panel-body mg cg">${body}</div>`;
const wire = (view) => view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });

const SOUND_ON = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
const SOUND_OFF = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>';
const soundIcon = (on) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${on ? SOUND_ON : SOUND_OFF}</svg>`;

// The big "Music" button, the same on every screen. In the game it also tells the running audio.
const soundInner = () => `${soundIcon(!muted)}<span>${escapeHtml(t("cg.music"))}</span><b>${escapeHtml(t(muted ? "cg.off" : "cg.on"))}</b>`;
function soundButton() {
  return `<button type="button" class="cg-sound" data-sound aria-pressed="${muted ? "false" : "true"}" aria-label="${escapeHtml(t(muted ? "cg.sound.off" : "cg.sound.on"))}">${soundInner()}</button>`;
}
function wireSound(view, getAudio) {
  view.querySelectorAll("[data-sound]").forEach((btn) => {
    btn.onclick = () => {
      muted = !muted;
      try { localStorage.setItem("mc-cloud-muted", muted ? "1" : "0"); } catch { /* not saved: fine */ }
      getAudio?.()?.setMuted(muted);
      btn.innerHTML = soundInner();
      btn.setAttribute("aria-pressed", String(!muted));
      btn.setAttribute("aria-label", t(muted ? "cg.sound.off" : "cg.sound.on"));
    };
  });
}

// ---------------------------------------------------------------------------
// A new round: warm patches of sea, the tanks, and little decorations (waves, palm trees)
// ---------------------------------------------------------------------------
function newWorld(L) {
  // The warm water is a narrow path that winds across the sea. It is a chain of small warm patches laid along a wavy line,
  // plus a few little side pools. Narrower patches = a harder level.
  const blobs = [], r0 = L.r[0], r1 = L.r[1], ph = rand(0, 6.3);
  for (let d = -330; d < SEA_LEN + 60; d += 0.55 * r0) {
    const x = W / 2 + 150 * Math.sin(d / 210 + ph) + 45 * Math.sin(d / 87 + ph * 2);
    blobs.push({ x: clamp(x, 56, W - 56), d, r: rand(r0, r1), s: 0.75 });
  }
  for (let i = 0; i < 4; i++) blobs.push({ x: rand(70, W - 70), d: rand(0, SEA_LEN - 120), r: rand(r0 * 0.6, r0 * 0.85), s: 0.8 });
  const tanks = [];
  for (let i = 0; i < TANK_COUNT; i++) {
    tanks.push({ x: rand(100, W - 100), d: SEA_LEN + 120 + (i / (TANK_COUNT - 1)) * (LAND_LEN - 200), level: 0, ripple: 0 });
  }
  const waves = Array.from({ length: 70 }, () => ({ x: rand(10, W - 10), d: rand(-330, SEA_LEN - 20), ph: rand(0, 6.3) }));
  const palms = [];
  for (let i = 0; i < 16; i++) {
    const d = rand(SEA_LEN + 60, SEA_LEN + LAND_LEN + 300), x = rand(24, W - 24);
    if (tanks.some((tk) => Math.abs(tk.d - d) < 60 && Math.abs(tk.x - x) < 80)) continue;      // keep palms off the tanks
    palms.push({ x, d, s: rand(0.8, 1.2), ph: rand(0, 6.3) });
  }
  const paddies = [];
  for (let i = 0; i < 14; i++) {
    const d = rand(SEA_LEN + 50, SEA_LEN + LAND_LEN + 300), x = rand(20, W - 20);
    if (tanks.some((tk) => Math.abs(tk.d - d) < 50 && Math.abs(tk.x - x) < 80)) continue;
    paddies.push({ x, d, s: rand(0.8, 1.15), ph: rand(0, 6.3) });
  }
  const sparkles = Array.from({ length: 56 }, () => ({ x: rand(0, W), d: rand(-330, SEA_LEN), ph: rand(0, 6.3) }));
  const birds = Array.from({ length: 5 }, (_, i) => ({ x: rand(0, W), y: rand(30, 190), v: rand(18, 34), ph: i }));
  return { blobs, tanks, waves, palms, paddies, sparkles, birds };
}

// How warm is the sea at map point (x, d)?  0 = cool ... 1 = warm
function warmth(blobs, x, d) {
  let w = 0.04;
  for (const b of blobs) {
    const dx = (x - b.x) / b.r, dy = (d - b.d) / b.r;
    w += b.s * Math.exp(-(dx * dx + dy * dy) * 1.6);
  }
  return Math.min(1, w);
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
function intro(view) {
  view.innerHTML = frame(`
    <section class="mg-card mg-intro cg-intro">
      <img class="cg-sun" src="img/game/sun.png" width="240" height="240" alt="">
      <div class="cg-hero" aria-hidden="true">${cloudSvg()}</div>
      <h2>${escapeHtml(t("cg.intro.title"))}</h2>
      <p>${escapeHtml(t("cg.intro.text"))}</p>
      <p class="mg-help">${escapeHtml(t("cg.help"))}</p>
      <button type="button" class="mg-big" id="cg-play">${escapeHtml(t("cg.play"))}</button>
      ${soundButton()}
      <div class="cg-waves" aria-hidden="true"><i></i><i></i></div>
    </section>`);
  wire(view); wireSound(view);
  view.querySelector("#cg-play").onclick = () => guide(view);
}

// ---------------------------------------------------------------------------
// "How to play": four picture steps, shown before the level choice (and from the level screen)
// ---------------------------------------------------------------------------
function guide(view) {
  const steps = [
    { art: `<span class="cg-g-slider" aria-hidden="true"><i>&#9664;</i><b></b><i>&#9654;</i></span>`, k: "s1" },
    { art: `<span class="cg-g-swatch warm"></span><img src="img/game/cloud.png" width="72" alt="">`, k: "s2" },
    { art: `<span class="cg-g-swatch cool"></span><img src="img/game/cloud.png" width="72" alt="" class="cg-g-dim">`, k: "s3" },
    { art: `<img src="img/game/cloud_full.png" width="64" alt=""><img src="img/game/tank.png" width="92" alt="">`, k: "s4" },
  ];
  view.innerHTML = frame(`
    <section class="mg-card cg-guide">
      <img class="cg-sun" src="img/game/sun.png" width="240" height="240" alt="">
      <h2>${escapeHtml(t("cg.guide.title"))}</h2>
      <p class="cg-goal">${escapeHtml(t("cg.guide.goal"))}</p>
      <ol class="cg-steps">${steps.map((s, i) => `
        <li style="--i:${i}">
          <span class="cg-step-n">${i + 1}</span>
          <div class="cg-step-art" aria-hidden="true">${s.art}</div>
          <div><strong>${escapeHtml(t(`cg.guide.${s.k}.title`))}</strong><p>${escapeHtml(t(`cg.guide.${s.k}.text`))}</p></div>
        </li>`).join("")}
      </ol>
      <p class="cg-tip">${escapeHtml(t("cg.guide.tip"))}</p>
      <button type="button" class="mg-big" id="cg-go">${escapeHtml(t("cg.guide.go"))}</button>
      ${soundButton()}
    </section>`);
  wire(view); wireSound(view);
  view.querySelector("#cg-go").onclick = () => levels(view);
}

// ---------------------------------------------------------------------------
// Level screen: five levels, each unlocked by passing the one before
// ---------------------------------------------------------------------------
function levels(view) {
  const stars = loadStars();
  view.innerHTML = frame(`
    <section class="mg-card cg-intro">
      <h2>${escapeHtml(t("cg.levels.title"))}</h2>
      <p>${escapeHtml(t("cg.levels.text"))}</p>
      <div class="cg-levels">${LEVELS.map((L, i) => {
        const open = unlocked(i, stars), got = Math.min(stars[i] || 0, L.tanks);
        return `<button type="button" class="cg-level ${open ? "" : "locked"} lv${i + 1}" data-level="${i}" ${open ? "" : "disabled"}>
          <span class="cg-level-n">${open ? i + 1 : "&#128274;"}</span>
          <strong>${escapeHtml(t(`cg.lvl.${i + 1}`))}</strong>
          <span class="cg-level-stars" aria-label="${escapeHtml(t("cg.tanks", { n: got, total: L.tanks }))}">${Array.from({ length: L.tanks }, (_, k) => `<i class="${k < got ? "on" : ""}">&#9733;</i>`).join("")}</span>
          <small>${escapeHtml(open ? t("cg.lvl.tanks", { n: L.tanks }) : t("cg.locked"))}</small>
        </button>`;
      }).join("")}</div>
      <div class="cg-row"><button type="button" class="action" id="cg-howto">${escapeHtml(t("cg.guide.link"))}</button>${soundButton()}</div>
    </section>`);
  wire(view); wireSound(view);
  view.querySelector("#cg-howto").onclick = () => guide(view);
  view.querySelectorAll("[data-level]").forEach((b) => { b.onclick = () => play(view, Number(b.dataset.level)); });
}

const cloudSvg = () => `<img src="img/game/cloud_full.png" width="300" height="267" alt="" class="cg-mascot">`;
const cloudSvgOld = () => `
  <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
    <defs><linearGradient id="cgc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#DCEBF5"/></linearGradient></defs>
    <path d="M30 52a16 16 0 0 1 2-31 22 22 0 0 1 42-4 18 18 0 0 1 16 35z" fill="url(#cgc)" stroke="#8FB7D0" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="50" cy="38" r="3.4" fill="#2B5430"/><circle cx="68" cy="38" r="3.4" fill="#2B5430"/>
    <circle cx="51" cy="37" r="1.1" fill="#fff"/><circle cx="69" cy="37" r="1.1" fill="#fff"/>
    <circle cx="42" cy="45" r="4" fill="#FFB4A8" opacity=".7"/><circle cx="76" cy="45" r="4" fill="#FFB4A8" opacity=".7"/>
    <path d="M53 46q6 6 12 0" fill="none" stroke="#2B5430" stroke-width="2.6" stroke-linecap="round"/>
    <path class="cg-drop d1" d="M44 62q-3 5 0 7t3-7z" fill="#5BB6E6"/><path class="cg-drop d2" d="M60 64q-3 5 0 7t3-7z" fill="#5BB6E6"/><path class="cg-drop d3" d="M76 62q-3 5 0 7t3-7z" fill="#5BB6E6"/>
  </svg>`;

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------
function play(view, level = 0) {
  const L = LEVELS[level];
  SPEED = L.speed; SEA_LEN = L.sea; LAND_LEN = L.land; TANK_COUNT = L.tanks; TANK_NEED = L.need;
  view.innerHTML = frame(`
    <section class="mg-card cg-card">
      <div class="cg-status">
        <p class="cg-lvl-tag">${escapeHtml(t("cg.level", { n: level + 1 }))} &middot; ${escapeHtml(t(`cg.lvl.${level + 1}`))}</p>
        <p id="cg-phase" class="cg-phase" role="status" aria-live="polite"></p>
        <div class="cg-tools">
          <p id="cg-tanks" class="cg-count"></p>
          ${soundButton()}
        </div>
      </div>
      <div class="cg-meter-row">
        <span class="cg-meter-label"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.5C8 8 5.5 11.2 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 11.2 16 8 12 2.5z" fill="#2E9BDA"/></svg>${escapeHtml(t("cg.moisture"))}</span>
        <div class="cg-meter" aria-hidden="true"><span id="cg-meter"></span></div>
        <span class="cg-scale" aria-hidden="true"><i style="background:${rgb(STOPS[0])}"></i>${escapeHtml(t("cg.cool"))}
          <i style="background:${rgb(STOPS[4])}"></i>${escapeHtml(t("cg.warm"))}</span>
      </div>
      <div class="cg-stage"><canvas id="cg-canvas" width="${W}" height="${H}" aria-label="${escapeHtml(t("cg.canvas"))}"></canvas></div>
      <div class="cg-controls">
        <button type="button" class="cg-arrow" id="cg-left" aria-label="${escapeHtml(t("cg.left"))}">&#9664;</button>
        <input type="range" id="cg-slider" min="0" max="100" step="0.5" value="50" aria-label="${escapeHtml(t("cg.slide"))}">
        <button type="button" class="cg-arrow" id="cg-right" aria-label="${escapeHtml(t("cg.right"))}">&#9654;</button>
      </div>
    </section>`);
  wire(view);

  const canvas = view.querySelector("#cg-canvas");
  const ctx = canvas.getContext("2d");
  const slider = view.querySelector("#cg-slider");
  const world = newWorld(L);
  const low = document.createElement("canvas");               // the small sea picture
  low.width = W / LOW; low.height = H / LOW;
  const lctx = low.getContext("2d");
  const img = lctx.createImageData(low.width, low.height);
  const shade = document.createElement("canvas");              // light from above and a soft dark edge, so it feels like a picture
  shade.width = W; shade.height = H;
  {
    const sc = shade.getContext("2d");
    const top = sc.createLinearGradient(0, 0, 0, H); top.addColorStop(0, "rgba(255,255,255,.14)"); top.addColorStop(0.4, "rgba(255,255,255,0)");
    sc.fillStyle = top; sc.fillRect(0, 0, W, H);
    const vg = sc.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,40,80,.14)");
    sc.fillStyle = vg; sc.fillRect(0, 0, W, H);
  }
  const audio = createAudio(muted);

  let scroll = 0, moisture = 0, ended = false, raf = 0, last = performance.now(), clock = 0, shownFull = 0;
  let mood = "happy", blinkAt = 2.5;
  const drops = [];                                           // falling rain: { x, y, v }
  const splashes = [];                                        // rings where the rain lands: { x, y, age }
  const vapour = [];                                          // little droplets rising from warm sea into the cloud
  const END = SEA_LEN + LAND_LEN + CLOUD_Y + 40;
  const cloudX = () => 50 + (Number(slider.value) / 100) * (W - 100);

  // steering: slider, arrows, keys, dragging the picture
  const nudge = (k) => { slider.value = clamp(Number(slider.value) + k, 0, 100); };
  view.querySelector("#cg-left").onclick = () => nudge(-8);
  view.querySelector("#cg-right").onclick = () => nudge(8);
  canvas.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") setFromPointer(e); });
  canvas.addEventListener("pointerdown", setFromPointer);
  function setFromPointer(e) {
    const r = canvas.getBoundingClientRect();
    slider.value = clamp(((e.clientX - r.left) / r.width * W - 50) / (W - 100) * 100, 0, 100);
  }
  const onKey = (e) => {
    if (e.target === slider) return;                          // the slider already handles its own keys
    if (e.key === "ArrowLeft") nudge(-6);
    if (e.key === "ArrowRight") nudge(6);
  };
  window.addEventListener("keydown", onKey);

  wireSound(view, () => audio);
  if (!audio) view.querySelectorAll("[data-sound]").forEach((b2) => { b2.hidden = true; });

  const stop = () => { ended = true; cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); audio?.stop(); };
  guard(view, stop);

  const phaseEl = view.querySelector("#cg-phase"), tanksEl = view.querySelector("#cg-tanks"), meterEl = view.querySelector("#cg-meter");
  let phaseNow = "";

  function step(now) {
    if (ended) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    scroll += SPEED * dt;
    const cx = cloudX(), cd = scroll - CLOUD_Y;               // the map point under the cloud
    const overSea = cd < SEA_LEN;
    let raining = false, w = 0;

    if (overSea) {
      w = warmth(world.blobs, cx, cd);
      moisture = clamp(moisture + (Math.pow(w, 1.6) * 24 - (1 - w) * L.leak) * dt, 0, 100);
      mood = w > 0.45 ? "happy" : "sad";
      if (w > 0.4 && moisture < 100 && Math.random() < w * 0.9) vapour.push({ x: cx + rand(-30, 30), y: CLOUD_Y + 78, v: rand(40, 70), a: 1 });
    } else if (moisture > 0) {
      // over land the cloud rains out; over a tank it rains much harder, and that water goes into the tank
      let over = null;
      for (const tk of world.tanks) {
        const sy = scroll - tk.d;
        if (Math.abs(cx - tk.x) < L.hit && Math.abs(RAIN_Y - sy) < 30 && tk.level < 1) { over = tk; break; }
      }
      const rate = over ? 40 : L.drain;
      const used = Math.min(moisture, rate * dt);
      moisture -= used;
      if (over) { over.level = Math.min(1, over.level + used / TANK_NEED); over.ripple = 1; }
      raining = used > 0;
      mood = raining ? "rain" : "happy";
    } else mood = "sad";
    if (raining) for (let i = 0; i < 2; i++) if (Math.random() < 0.7) drops.push({ x: cx + rand(-28, 28), y: CLOUD_Y + 22, v: rand(170, 240) });
    for (const d of drops) d.y += d.v * dt;
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].y >= RAIN_Y) { splashes.push({ x: drops[i].x, y: RAIN_Y + rand(-6, 6), age: 0 }); drops.splice(i, 1); }
    for (const s of splashes) s.age += dt * 2.2;
    while (splashes.length && splashes[0].age >= 1) splashes.shift();
    for (const v of vapour) { v.y -= v.v * dt; v.a -= dt * 1.1; }
    while (vapour.length && vapour[0].a <= 0) vapour.shift();
    for (const tk of world.tanks) tk.ripple = Math.max(0, tk.ripple - dt * 1.5);

    const full = world.tanks.filter((tk) => tk.level >= 1).length;
    const phase = overSea ? "sea" : "land";
    if (phase !== phaseNow) {
      phaseNow = phase; phaseEl.textContent = t(`cg.phase.${phase}`); audio?.setPhase(phase);
      phaseEl.classList.remove("pulse"); void phaseEl.offsetWidth; phaseEl.classList.add("pulse");
    }
    audio?.setRain(raining);
    if (full !== shownFull) {
      if (full > shownFull) audio?.chime();
      shownFull = full;
      tanksEl.classList.remove("pop"); void tanksEl.offsetWidth; tanksEl.classList.add("pop");
    }
    tanksEl.textContent = t("cg.tanks", { n: full, total: TANK_COUNT });
    meterEl.style.width = `${Math.round(moisture)}%`;

    draw(cx, w);
    if (scroll >= END) return finish(full);
    raf = requestAnimationFrame(step);
  }

  // ---- drawing ----------------------------------------------------------
  // The ground is painted one small pixel at a time, so this part must be cheap:
  // the warmth of a patch is  exp(-dx^2) * exp(-dy^2)  and dx never changes, so each patch's column values are worked out once.
  for (const bl of world.blobs) bl.ex = Float32Array.from({ length: low.width }, (_, px) => Math.exp(-(((px * LOW - bl.x) / bl.r) ** 2) * 1.6));
  const rowE = new Float32Array(world.blobs.length);
  // The land is one scrolling picture (made above). The sea map is painted on top of it, with no paint on land rows.
  landTile = landTile || makeLandTile();
  const landPat = ctx.createPattern(landTile, "repeat");
  function drawGround() {
    landPat.setTransform(new DOMMatrix().translate(0, scroll % TILE));
    ctx.fillStyle = landPat; ctx.fillRect(0, 0, W, H);

    seaTex = seaTex || makeSeaTextures();
    const oxC = Math.floor(clock * 6), oyC = Math.floor(scroll / LOW + clock * 3), oxS = Math.floor(-clock * 3), oyS = Math.floor(scroll / LOW * 0.8);
    const data = img.data, blobs = world.blobs;
    for (let py = 0; py < low.height; py++) {
      const d = scroll - py * LOW;
      let any = false;
      if (d < SEA_LEN) for (let k = 0; k < blobs.length; k++) {
        const dy = (d - blobs[k].d) / blobs[k].r;
        rowE[k] = Math.abs(dy) < 2.2 ? Math.exp(-dy * dy * 1.6) * blobs[k].s : 0;
        if (rowE[k] > 0.002) any = true;
      }
      for (let px = 0; px < low.width; px++) {
        const i = (py * low.width + px) * 4;
        let r, g, b, a = 255;
        if (d < SEA_LEN) {
          let w = 0.04;
          if (any) for (let k = 0; k < blobs.length; k++) if (rowE[k] > 0.002) w += rowE[k] * blobs[k].ex[px];
          if (w > 1) w = 1;
          // realistic look: smooth colour by warmth (cool = deep, warm = shallow), lit by sunlight lines and slow swells
          const c = LUT[(w * 100 + 0.5) | 0];
          const ci = (((oyC - py) & 255) << 8) | ((px + oxC) & 255), si = (((oyS - py) & 255) << 8) | ((px + oxS) & 255);
          const glow = seaTex.caustic[ci] * (0.03 + 0.34 * w * w), sw = (seaTex.swell[si] - 128) * 0.14;
          r = c[0] + glow * 0.85 + sw; g = c[1] + glow + sw; b = c[2] + glow * 0.9 + sw * 1.15;
        } else if (d < SEA_LEN + 34) {
          const k = (d - SEA_LEN) / 34;                                                           // beach: wet sand, then dry sand
          r = 206 + 34 * k; g = 188 + 34 * k; b = 132 + 30 * k;
          if (k > 0.8) a = Math.round(255 * (1 - (k - 0.8) / 0.2));                               // the dry sand fades into the fields
        } else { r = g = b = 0; a = 0; }
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    }
    lctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(low, 0, 0, W, H);

  }

  function drawSea() {
    // wave marks, drifting a little
    ctx.lineCap = "round"; ctx.lineWidth = 2;
    for (const wv of world.waves) {
      const sy = scroll - wv.d;
      if (sy < -10 || sy > H + 10 || wv.d > SEA_LEN - 14) continue;
      const bob = Math.sin(clock * 1.6 + wv.ph) * 3;
      ctx.strokeStyle = "rgba(235,248,255,.3)";
      ctx.beginPath(); ctx.moveTo(wv.x - 11 + bob, sy); ctx.quadraticCurveTo(wv.x - 5.5 + bob, sy - 5, wv.x + bob, sy); ctx.quadraticCurveTo(wv.x + 5.5 + bob, sy + 5, wv.x + 11 + bob, sy); ctx.stroke();
    }
    // sparkles on the warm water
    for (const sp of world.sparkles) {
      const sy = scroll - sp.d;
      if (sy < 0 || sy > H || sp.d > SEA_LEN) continue;
      const a = (Math.sin(clock * 3 + sp.ph) + 1) / 2 * (0.45 + 0.55 * warmth(world.blobs, sp.x, sp.d));
      if (a < 0.35) continue;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      const s = 2 + a * 3;
      ctx.beginPath(); ctx.moveTo(sp.x, sy - s); ctx.lineTo(sp.x + s * 0.3, sy - s * 0.3); ctx.lineTo(sp.x + s, sy); ctx.lineTo(sp.x + s * 0.3, sy + s * 0.3);
      ctx.lineTo(sp.x, sy + s); ctx.lineTo(sp.x - s * 0.3, sy + s * 0.3); ctx.lineTo(sp.x - s, sy); ctx.lineTo(sp.x - s * 0.3, sy - s * 0.3); ctx.fill();
    }
    // foam along the shore
    const sy = scroll - SEA_LEN;
    if (sy > -20 && sy < H + 20) {
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) { const y = sy + Math.sin(x * 0.05 + clock * 2.4) * 4 + 2; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) { const y = sy - 12 + Math.sin(x * 0.06 - clock * 2) * 5; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
  }

  function drawPalm(x, y, s, ph) {
    const sway = Math.sin(clock * 1.5 + ph) * 0.12;
    if (ready("palm")) {                                                                                          // the Flow picture, swaying from its base
      const pw = 60 * s, ph2 = pw * sprite.palm.naturalHeight / sprite.palm.naturalWidth;
      ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.ellipse(x + 4, y + 2, 22 * s, 7 * s, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(sway * 0.35); ctx.drawImage(sprite.palm, -pw / 2, -ph2 + 4, pw, ph2); ctx.restore();
      return;
    }
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.ellipse(8, 4, 20, 7, 0, 0, 7); ctx.fill();            // shadow
    ctx.strokeStyle = "#8A6A3E"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(4 + sway * 30, -16, 2 + sway * 40, -30); ctx.stroke();
    ctx.translate(2 + sway * 40, -30);
    ctx.fillStyle = "#2F8F4E";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + sway;
      ctx.save(); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -9, 24, 2); ctx.quadraticCurveTo(10, -2, 0, 0); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#6B4F2A"; ctx.beginPath(); ctx.arc(0, 1, 3, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawTank(tk, sy) {
    if (ready("tank")) {                                                                                          // the Flow picture; the pond looks dry until it fills
      const tw = 120, th = tw * sprite.tank.naturalHeight / sprite.tank.naturalWidth, px = tk.x, py = sy;           // (px, py) = middle of the pond
      ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.beginPath(); ctx.ellipse(px + 4, py + th * 0.4, tw * 0.46, th * 0.2, 0, 0, 7); ctx.fill();
      ctx.drawImage(sprite.tank, px - tw / 2, py - th * 0.34, tw, th);
      const dry = 1 - tk.level;
      if (dry > 0.01) { ctx.fillStyle = `rgba(201,188,160,${dry * 0.92})`; ctx.beginPath(); ctx.ellipse(px, py, tw * 0.335, th * 0.215, 0, 0, 7); ctx.fill(); }
      if (tk.ripple > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${tk.ripple * 0.9})`; ctx.lineWidth = 2;
        const r = 6 + (1 - tk.ripple) * 30; ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.5, 0, 0, 7); ctx.stroke();
      }
      if (tk.level >= 1) {
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py - 1, 12, 0, 7); ctx.fill();
        ctx.strokeStyle = "#2E9E5B"; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(px - 5, py - 1); ctx.lineTo(px - 1, py + 4); ctx.lineTo(px + 6, py - 6); ctx.stroke();
        const tw2 = (Math.sin(clock * 5) + 1) / 2;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + tw2 * 0.6})`; ctx.beginPath(); ctx.arc(px + 30, py - 16, 2 + tw2 * 2, 0, 7); ctx.fill();
      }
      return;
    }
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(tk.x + 3, sy + 7, 44, 24, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#7A5A30"; ctx.beginPath(); ctx.ellipse(tk.x, sy, 43, 24, 0, 0, 7); ctx.fill();               // the bund (earth wall)
    ctx.fillStyle = "#9A7744"; ctx.beginPath(); ctx.ellipse(tk.x, sy - 2, 43, 21, 0, Math.PI, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.ellipse(tk.x, sy, 35, 17, 0, 0, 7); ctx.clip();
    ctx.fillStyle = "#CFE2EC"; ctx.fillRect(tk.x - 36, sy - 18, 72, 36);                                          // empty tank
    if (tk.level > 0) {
      const top = sy + 17 - 34 * tk.level;
      const g = ctx.createLinearGradient(0, top, 0, sy + 18); g.addColorStop(0, "#4FB2EA"); g.addColorStop(1, "#1C6FB5");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(tk.x - 36, sy + 18);
      for (let x = -36; x <= 36; x += 6) ctx.lineTo(tk.x + x, top + Math.sin(clock * 3 + x * 0.2) * 1.6);
      ctx.lineTo(tk.x + 36, sy + 18); ctx.fill();
    }
    if (tk.ripple > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${tk.ripple * 0.8})`; ctx.lineWidth = 2;
      const r = 6 + (1 - tk.ripple) * 26;
      ctx.beginPath(); ctx.ellipse(tk.x, sy, r, r * 0.5, 0, 0, 7); ctx.stroke();
    }
    ctx.restore();
    if (tk.level >= 1) {                                                                                           // full: a tick and a twinkle
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(tk.x, sy - 1, 11, 0, 7); ctx.fill();
      ctx.strokeStyle = "#2E9E5B"; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(tk.x - 5, sy - 1); ctx.lineTo(tk.x - 1, sy + 3); ctx.lineTo(tk.x + 6, sy - 5); ctx.stroke();
      const tw = (Math.sin(clock * 5) + 1) / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.4 + tw * 0.6})`; ctx.beginPath(); ctx.arc(tk.x + 26, sy - 14, 2 + tw * 2, 0, 7); ctx.fill();
    }
  }

  function drawBird(b) {
    const flap = Math.sin(clock * 9 + b.ph) * 4;
    ctx.strokeStyle = "rgba(60,60,70,.75)"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(b.x - 8, b.y - flap); ctx.quadraticCurveTo(b.x - 3, b.y - 4, b.x, b.y); ctx.quadraticCurveTo(b.x + 3, b.y - 4, b.x + 8, b.y - flap); ctx.stroke();
  }

  function drawCloud(cx, cy, fill) {
    const sc = 0.95 + fill * 0.35;
    if (cloudImg.complete && cloudImg.naturalWidth) return drawCloudPicture(cx, cy, fill, sc);
    // its shadow on the sea or the land
    ctx.fillStyle = `rgba(0,20,60,${0.16 + fill * 0.1})`; ctx.beginPath(); ctx.ellipse(cx, CLOUD_Y + 84, 38 * sc, 9 * sc, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
    const grey = Math.round(255 - fill * 60), bumps = [[-26, 6, 17], [-9, -12, 22], [14, -8, 19], [28, 6, 15], [0, 8, 22]];
    ctx.lineJoin = "round"; ctx.strokeStyle = "#7FA6BF"; ctx.lineWidth = 7;
    bumps.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); });                    // outline first ...
    const g = ctx.createLinearGradient(0, -34, 0, 30); g.addColorStop(0, `rgb(255,255,255)`); g.addColorStop(1, `rgb(${grey - 24},${grey - 14},${grey})`);
    ctx.fillStyle = g;
    bumps.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); });                       // ... then the soft fill on top
    // face
    const blink = clock > blinkAt && clock < blinkAt + 0.13;
    if (clock > blinkAt + 0.13) blinkAt = clock + rand(2.5, 5);
    ctx.fillStyle = "#2B5430";
    if (blink) { ctx.fillRect(-13, 0, 8, 2.5); ctx.fillRect(5, 0, 8, 2.5); }
    else {
      ctx.beginPath(); ctx.ellipse(-9, 0, 3.4, 4.4, 0, 0, 7); ctx.ellipse(9, 0, 3.4, 4.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-8, -1.5, 1.3, 0, 7); ctx.arc(10, -1.5, 1.3, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,150,140,.55)"; ctx.beginPath(); ctx.arc(-19, 7, 4.5, 0, 7); ctx.arc(19, 7, 4.5, 0, 7); ctx.fill();
    ctx.strokeStyle = "#2B5430"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.beginPath();
    if (mood === "happy") ctx.arc(0, 6, 7, 0.2, Math.PI - 0.2);
    else if (mood === "sad") ctx.arc(0, 15, 6, Math.PI + 0.4, -0.4);
    else { ctx.arc(0, 10, 4, 0, 7); }                                                                              // raining: a little "o"
    ctx.stroke();
    ctx.restore();
  }

  // The cloud made from the Flow picture: it grows as it fills, turns stormy-grey, droops over cool water and shakes when it rains
  function drawCloudPicture(cx, cy, fill, sc) {
    const w = 118 * sc, h = w * cloudImg.naturalHeight / cloudImg.naturalWidth;
    ctx.fillStyle = `rgba(0,20,60,${0.16 + fill * 0.1})`; ctx.beginPath(); ctx.ellipse(cx, CLOUD_Y + 84, 38 * sc, 9 * sc, 0, 0, 7); ctx.fill();   // shadow on the sea or land
    ctx.save();
    ctx.translate(cx + (mood === "rain" ? Math.sin(clock * 40) * 1.6 : 0), cy);
    if (mood === "sad") ctx.rotate(Math.sin(clock * 3) * 0.04);
    const squash = mood === "sad" ? 0.94 : 1 + Math.sin(clock * 4) * 0.015;
    ctx.scale(1 / squash, squash);
    ctx.drawImage(cloudImg, -w / 2, -h / 2 - 6, w, h);
    const storm = Math.min(0.8, fill * 0.6 + (mood === "sad" ? 0.08 : 0));
    if (stormImg && storm > 0.02) { ctx.globalAlpha = storm; ctx.drawImage(stormImg, -w / 2, -h / 2 - 6, w, h); }
    ctx.restore();
  }

  function draw(cx, w) {
    drawGround();
    drawSea();
    // land things
    if (ready("paddy")) for (const r of world.paddies) {
      const sy = scroll - r.d;
      if (sy < -40 || sy > H + 40) continue;
      const rw = 46 * r.s, rh = rw * sprite.paddy.naturalHeight / sprite.paddy.naturalWidth, bob = Math.sin(clock * 2 + r.ph) * 1.2;
      ctx.drawImage(sprite.paddy, r.x - rw / 2, sy - rh + 8 + bob, rw, rh);
    }
    for (const p of world.palms) { const sy = scroll - p.d; if (sy > -50 && sy < H + 30) drawPalm(p.x, sy, p.s, p.ph); }
    for (const tk of world.tanks) { const sy = scroll - tk.d; if (sy > -50 && sy < H + 50) drawTank(tk, sy); }
    if (scroll - CLOUD_Y > SEA_LEN - 120) { for (const b of world.birds) { b.x += b.v / 60; if (b.x > W + 20) b.x = -20; drawBird(b); } }

    // water vapour rising into the cloud
    for (const v of vapour) { ctx.fillStyle = `rgba(190,235,255,${v.a * 0.9})`; ctx.beginPath(); ctx.arc(v.x + Math.sin(v.y * 0.08) * 4, v.y, 3.2, 0, 7); ctx.fill(); }
    // rain and splashes
    ctx.strokeStyle = "#CDEBFF"; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (const d of drops) { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 10); ctx.stroke(); }
    for (const s of splashes) { ctx.strokeStyle = `rgba(255,255,255,${1 - s.age})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(s.x, s.y, 3 + s.age * 11, 1.5 + s.age * 5, 0, 0, 7); ctx.stroke(); }

    drawCloud(cx, CLOUD_Y + Math.sin(clock * 2.2) * 3, moisture / 100);

    ctx.drawImage(shade, 0, 0);                                         // light from above and a soft dark edge (made once)
  }

  function finish(full) {
    ended = true;
    window.removeEventListener("keydown", onKey);
    if (full) audio?.win();
    saveStar(level, full);
    reward("cloud", String(level), full);                                // drops and badges (rewards.js)
    const passed = full >= passMark(L), last = level === LEVELS.length - 1;
    audio?.stop(2600);
    const confetti = full ? Array.from({ length: 28 }, (_, i) =>
      `<i style="left:${(i * 37) % 100}%;background:${["#F2994A", "#5BB6E6", "#6FCF97", "#F2C94C", "#EB5757"][i % 5]};animation-delay:${((i * 53) % 100) / 100}s;animation-duration:${2.2 + (i % 5) * 0.4}s"></i>`).join("") : "";
    view.querySelector(".mg-card").innerHTML = `
      <div class="cg-confetti" aria-hidden="true">${confetti}</div>
      <div class="cg-hero" aria-hidden="true">${cloudSvg()}</div>
      <h2>${escapeHtml(t("cg.result.title"))}</h2>
      <p class="mg-big-text">${escapeHtml(full ? t("cg.result.some", { n: full, total: TANK_COUNT }) : t("cg.result.none"))}</p>
      <div class="cg-stars" aria-hidden="true">${Array.from({ length: TANK_COUNT }, (_, i) => `<span class="${i < full ? "on" : ""}" style="animation-delay:${0.15 * i}s">&#9733;</span>`).join("")}</div>
      <p class="cg-verdict ${passed ? "ok" : ""}">${escapeHtml(passed ? t(last ? "cg.complete" : "cg.passed", { n: level + 2 }) : t("cg.notyet", { n: passMark(L), total: L.tanks }))}</p>
      <p>${escapeHtml(t("cg.lesson"))}</p>
      <div class="plan-actions">
        ${passed && !last ? `<button type="button" class="mg-big" id="cg-next">${escapeHtml(t("cg.next"))}</button>` : ""}
        <button type="button" class="${passed && !last ? "action" : "mg-big"}" id="cg-again">${escapeHtml(t("cg.again"))}</button>
        <button type="button" class="action" id="cg-levels">${escapeHtml(t("cg.levels.back"))}</button>
        <button type="button" class="action" data-go="#/">${escapeHtml(t("cg.check"))}</button>
      </div>`;
    wire(view);
    view.querySelector("#cg-again").onclick = () => play(view, level);
    view.querySelector("#cg-levels").onclick = () => levels(view);
    const nx = view.querySelector("#cg-next"); if (nx) nx.onclick = () => play(view, level + 1);
  }

  raf = requestAnimationFrame((now) => { last = now; step(now); });
}

export function renderCloudGame(state, view) {
  intro(view);
}
