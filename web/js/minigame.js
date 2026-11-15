// "Tank Farmer": a little game for small children (#/learn/play), in the same style as the Rain Cloud game.
//
//   Guide    a picture guide is shown before the game starts
//   Level 1  Catch the rain: tap the falling raindrops before they hit the ground. Each pair of drops puts a "cup" of water in the tank.
//            Now and then a glowing SPECIAL drop falls (at random): gold = 3 drops, magnet = catches every drop on screen,
//            clock = +3 seconds, storm = a few seconds of very heavy rain.
//   Level 2  Feed the crops: give cups of water to three thirsty crops. Paddy drinks a LOT, mung bean only a little.
//
// How much each crop drinks comes from the real water-need figures of a real tank (1 cup = CUP_MM millimetres of water),
// so the game teaches something true: thirsty paddy vs. small-drinker pulses. Almost no reading: big pictures and buttons.
// The cartoon pictures were made with Google Flow (AI-generated, see the Data sources page); the music is made live by cloudaudio.js.
// Nothing is saved except the "music on / off" choice (shared with the Rain Cloud game). All text is in si.json / en.json (keys "mg.*", "tf.*").
import { t } from "./i18n.js";
import { escapeHtml, tankName, num } from "./ui.js";
import { createAudio } from "./cloudaudio.js";
import { renderFarm, bankCups } from "./plantation.js";
import { reward } from "./rewards.js";

const W = 640, H = 360;                   // size of the level 1 picture
const GAME_SECONDS = 20;
const MAX_CUPS = 10;
const CUP_MM = 150;                       // one "cup" in the game = 150 mm of crop water need (real figures are shown at the end)
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const cropName = (id) => t(`crop.${id}`);

// ---- pictures (cartoon sprites made with Google Flow; a missing picture is simply not drawn) -------------------------
const IMGS = {};
const pic = (dir, name) => { const k = `${dir}/${name}`; if (!IMGS[k]) { const i = new Image(); i.src = `img/${dir}/${name}.png`; IMGS[k] = i; } return IMGS[k]; };
const ok = (i) => i.complete && i.naturalWidth > 0;
["cloud", "tank", "paddy", "sun", "palm"].forEach((n) => pic("game", n));
["farmer", "drop", "bean", "maize", "seedling"].forEach((n) => pic("farm", n));
// ---- special drops: they come at random while you catch the rain ----------------------------------------------------------
const POWERS = { gold: { color: "#FFC83D" }, magnet: { color: "#E0623A" }, clock: { color: "#3FB765" }, storm: { color: "#8A5BD8" } };
const POWER_KINDS = Object.keys(POWERS);
const TINTS = {};                                                    // the plain drop picture, coloured once for each power
function tinted(kind) {
  if (TINTS[kind]) return TINTS[kind];
  const i = pic("farm", "drop");
  if (!ok(i)) return null;
  const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight;
  const g = c.getContext("2d"); g.drawImage(i, 0, 0);
  g.globalCompositeOperation = "source-atop"; g.fillStyle = `${POWERS[kind].color}B3`; g.fillRect(0, 0, c.width, c.height);
  return (TINTS[kind] = c);
}
// the little symbol on a special drop
function drawPowerIcon(ctx, kind, x, y) {
  const col = POWERS[kind].color;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.fillStyle = "#fff"; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
  if (kind === "gold") { ctx.font = "800 13px 'Noto Sans', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("x3", x, y + 1); }
  else if (kind === "magnet") { ctx.beginPath(); ctx.arc(x, y, 5.5, Math.PI, 0); ctx.moveTo(x - 5.5, y); ctx.lineTo(x - 5.5, y + 6); ctx.moveTo(x + 5.5, y); ctx.lineTo(x + 5.5, y + 6); ctx.stroke(); }
  else if (kind === "clock") { ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 7); ctx.moveTo(x, y); ctx.lineTo(x, y - 4); ctx.moveTo(x, y); ctx.lineTo(x + 3.4, y + 1.2); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(x + 2, y - 8); ctx.lineTo(x - 4.5, y + 1); ctx.lineTo(x - 0.5, y + 1); ctx.lineTo(x - 2.5, y + 8); ctx.lineTo(x + 5, y - 2); ctx.lineTo(x + 1, y - 2); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

const BEANS = ["mung_bean", "cowpea", "black_gram", "soybean", "groundnut"];
const cropPic = (id) => (/^paddy/.test(id) ? "game/paddy" : id === "maize" ? "farm/maize" : BEANS.includes(id) ? "farm/bean" : "farm/seedling");

// ---- music on / off (the same remembered choice as the Rain Cloud game) -------------------------------------------------
let muted = false;
try { muted = localStorage.getItem("mc-cloud-muted") === "1"; } catch { /* private window: start with music on */ }
let sound = null;                         // the running audio, if any
const SOUND_ON = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
const SOUND_OFF = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>';
const soundIcon = (on) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${on ? SOUND_ON : SOUND_OFF}</svg>`;
const soundInner = () => `${soundIcon(!muted)}<span>${escapeHtml(t("cg.music"))}</span><b>${escapeHtml(t(muted ? "cg.off" : "cg.on"))}</b>`;
const soundButton = () => `<button type="button" class="cg-sound" data-sound aria-pressed="${muted ? "false" : "true"}" aria-label="${escapeHtml(t(muted ? "cg.sound.off" : "cg.sound.on"))}">${soundInner()}</button>`;
function wireSound(view) {
  view.querySelectorAll("[data-sound]").forEach((btn) => {
    btn.onclick = () => {
      muted = !muted;
      try { localStorage.setItem("mc-cloud-muted", muted ? "1" : "0"); } catch { /* not saved: fine */ }
      sound?.setMuted(muted);
      view.querySelectorAll("[data-sound]").forEach((b) => {
        b.innerHTML = soundInner();
        b.setAttribute("aria-pressed", String(!muted));
        b.setAttribute("aria-label", t(muted ? "cg.sound.off" : "cg.sound.on"));
      });
    };
  });
}

// ---- stopping everything when the page changes -------------------------------------------------------------------------
let stopper = null;                       // stops timers and music when the page changes
function guard(view, fn) {
  stopper = () => { fn(); sound?.stop(); sound = null; };
  const leave = () => { if (!view.isConnected || !location.hash.startsWith("#/learn/play")) { stopper?.(); stopper = null; window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave);
}

const frame = (body) => `
  <div class="tank-head learn-head">
    <button type="button" class="back" data-go="#/learn/kids">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
      ${escapeHtml(t("kd.back"))}
    </button>
    <h1>${escapeHtml(t("mg.title"))}</h1>
  </div>
  <div class="panel-body mg tf">${body}</div>`;
const wire = (view) => view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });

// ---------------------------------------------------------------------------
// Start screen, then the guide
// ---------------------------------------------------------------------------
function intro(state, view) {
  view.innerHTML = frame(`
    <section class="mg-card mg-intro cg-intro">
      <img class="cg-sun" src="img/game/sun.png" width="240" height="240" alt="">
      <div class="cg-hero"><img src="img/farm/farmer.png" width="220" height="220" alt="" class="tf-hero"></div>
      <h2>${escapeHtml(t("mg.intro.title"))}</h2>
      <p>${escapeHtml(t("mg.intro.text"))}</p>
      <button type="button" class="mg-big" id="mg-play">${escapeHtml(t("mg.play"))}</button>
      <button type="button" class="action pl-open" data-go="#/learn/play/farm">${escapeHtml(t("farm.open"))}</button>
      ${soundButton()}
      <div class="cg-waves" aria-hidden="true"><i></i><i></i></div>
    </section>`);
  wire(view); wireSound(view);
  view.querySelector("#mg-play").onclick = () => guide(state, view);
}

// the four special drops, as little pictures for the guide (the same colours and symbols as in the game)
const POWER_SVG = {
  gold: '<text x="12" y="16" text-anchor="middle" font-size="11" font-weight="800" fill="#FFC83D" font-family="sans-serif">x3</text>',
  magnet: '<path d="M6.5 14V11a5.5 5.5 0 0 1 11 0v3" fill="none" stroke="#E0623A" stroke-width="3" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="6.5" fill="none" stroke="#3FB765" stroke-width="2.4"/><path d="M12 12V8M12 12l3.4 1.2" stroke="#3FB765" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  storm: '<path d="M14 4l-6.5 9h4l-2 7 7.5-10h-4z" fill="#8A5BD8" stroke="#8A5BD8" stroke-width="1.5" stroke-linejoin="round"/>',
};
const POWERS_ART = POWER_KINDS.map((k) => `<span class="tf-pw ${k}"><img src="img/farm/drop.png" width="34" alt=""><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" stroke="${POWERS[k].color}" stroke-width="2.4"/>${POWER_SVG[k]}</svg></span>`).join("");

function guide(state, view) {
  const steps = [
    { art: `<img src="img/farm/drop.png" width="56" alt="" class="tf-bounce"><img src="img/game/cloud.png" width="74" alt="">`, k: "s1" },
    { art: `<img src="img/farm/drop.png" width="40" alt=""><span class="tf-arrow">&#10140;</span><img src="img/game/tank.png" width="96" alt="">`, k: "s2" },
    { art: `<img src="img/game/paddy.png" width="64" alt=""><img src="img/farm/bean.png" width="56" alt="">`, k: "s3" },
    { art: POWERS_ART, k: "s4" },
  ];
  view.innerHTML = frame(`
    <section class="mg-card cg-guide">
      <img class="cg-sun" src="img/game/sun.png" width="240" height="240" alt="">
      <h2>${escapeHtml(t("tf.guide.title"))}</h2>
      <p class="cg-goal">${escapeHtml(t("tf.guide.goal"))}</p>
      <ol class="cg-steps">${steps.map((s, i) => `
        <li style="--i:${i}">
          <span class="cg-step-n">${i + 1}</span>
          <div class="cg-step-art" aria-hidden="true">${s.art}</div>
          <div><strong>${escapeHtml(t(`tf.guide.${s.k}.title`))}</strong><p>${escapeHtml(t(`tf.guide.${s.k}.text`))}</p></div>
        </li>`).join("")}
      </ol>
      <p class="cg-tip">${escapeHtml(t("tf.guide.tip"))}</p>
      <button type="button" class="mg-big" id="mg-go">${escapeHtml(t("tf.guide.go"))}</button>
      ${soundButton()}
    </section>`);
  wire(view); wireSound(view);
  view.querySelector("#mg-go").onclick = () => {
    sound?.stop();
    sound = createAudio(muted, "farm");                       // the browser allows sound now: this click is the start
    levelRain(state, view);
  };
}

// ---------------------------------------------------------------------------
// Level 1: catch the rain (a picture on a canvas)
// ---------------------------------------------------------------------------
function levelRain(state, view, opts = {}) {
  view.innerHTML = frame(`
    <section class="mg-card tf-card">
      <div class="cg-status">
        <p class="cg-phase">${escapeHtml(t("mg.l1.title"))}</p>
        <div class="cg-tools"><p id="mg-count" class="cg-count" aria-live="polite"></p>${soundButton()}</div>
      </div>
      <p class="mg-help">${escapeHtml(t("mg.l1.help"))} ${escapeHtml(t("tf.l1.special"))}</p>
      <div class="mg-timer" aria-hidden="true"><span id="mg-timer"></span></div>
      <div class="cg-stage"><canvas id="tf-canvas" width="${W}" height="${H}" aria-label="${escapeHtml(t("tf.canvas"))}"></canvas></div>
    </section>`);
  wire(view); wireSound(view);
  sound?.setPhase("sea"); sound?.setRain(true);

  const canvas = view.querySelector("#tf-canvas"), ctx = canvas.getContext("2d"), count = view.querySelector("#mg-count"), bar = view.querySelector("#mg-timer");
  const drops = [], pops = [], flyers = [], splashes = [];
  let caught = 0, ended = false, raf = 0, clock = 0, spawn = 0, cheer = 0, ripple = 0, last = performance.now();
  const cups = () => Math.min(MAX_CUPS, Math.floor(caught / 2));
  const TANK = { x: W / 2 - 20, y: H - 70 };                  // the middle of the tank's water
  let shownCups = -1;
  let stormUntil = 0;                                         // while clock < stormUntil it is a rain storm
  const popups = [];                                          // floating words like "+3 seconds!"

  function usePower(d) {
    const col = POWERS[d.power].color;
    sound?.power();
    popups.push({ text: t(`tf.power.${d.power}`), x: clamp(d.x, 110, W - 110), y: Math.max(70, d.y - 24), age: 0, color: col });
    for (let i = 0; i < 18; i++) pops.push({ x: d.x, y: d.y, vx: rand(-170, 170), vy: rand(-210, 40), a: 1.3, r: rand(3, 6), color: col });
    if (d.power === "gold") { caught += 3; for (let k = 0; k < 3; k++) flyers.push({ x: d.x + (k - 1) * 18, y: d.y, p: -k * 0.14 }); }
    else if (d.power === "magnet") { for (const o of drops) if (!o.gone) catchDrop(o); }
    else if (d.power === "clock") started += 3000;
    else if (d.power === "storm") stormUntil = clock + 4;
  }
  function catchDrop(d) {
    if (d.gone) return;
    d.gone = true; cheer = 1;
    if (d.power) return usePower(d);
    caught++;
    sound?.pop();
    for (let i = 0; i < 9; i++) pops.push({ x: d.x, y: d.y, vx: rand(-90, 90), vy: rand(-120, 20), a: 1, r: rand(2, 4.5) });
    flyers.push({ x: d.x, y: d.y, p: 0 });                    // the drop hops into the tank
  }
  const lowest = () => drops.filter((d) => !d.gone && d.y > 20).sort((a, b) => b.y - a.y)[0];

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    let best = null, bd = 44;                                  // a generous touch area, for small fingers
    for (const d of drops) { const dd = Math.hypot(d.x - x, d.y - y); if (!d.gone && dd < bd) { bd = dd; best = d; } }
    if (best) catchDrop(best);
  });
  const keys = (e) => {
    if (ended || (e.key !== " " && e.key !== "Enter" && e.key !== "ArrowDown")) return;
    const d = lowest(); if (!d) return;
    e.preventDefault(); catchDrop(d);
  };
  document.addEventListener("keydown", keys);

  let started = performance.now();
  function stop() { ended = true; cancelAnimationFrame(raf); document.removeEventListener("keydown", keys); sound?.setRain(false); }
  guard(view, stop);

  function step(now) {
    if (ended) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    const left = Math.max(0, GAME_SECONDS * 1000 - (now - started));
    bar.style.width = `${(left / (GAME_SECONDS * 1000)) * 100}%`;
    const cloudX = W / 2 + Math.sin(clock * 0.7) * 230;
    spawn -= dt;
    if (spawn <= 0 && left > 600) {
      const storm = clock < stormUntil;
      spawn = storm ? rand(0.08, 0.16) : rand(0.4, 0.75);          // a storm drops a lot more rain
      const nd = { x: clamp(cloudX + rand(-50, 50), 30, W - 30), y: 78, v: rand(110, 170) + clock * 2.2, ph: rand(0, 6.3) };
      if (!storm && clock > 3 && !drops.some((o) => o.power) && Math.random() < 0.17) { nd.power = POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)]; nd.v *= 0.72; }     // now and then, a special drop (slower, so it can be caught)
      drops.push(nd);
    }
    for (const d of drops) {
      d.y += d.v * dt;
      if (!d.gone && d.y > H - 62) { d.gone = true; splashes.push({ x: d.x, y: H - 56, age: 0 }); }         // missed: it splashes on the ground
    }
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].gone) drops.splice(i, 1);
    for (const f of flyers) f.p += dt / 0.45;
    for (const pu of popups) pu.age += dt * 0.8;
    while (popups.length && popups[0].age >= 1) popups.shift();
    for (let i = flyers.length - 1; i >= 0; i--) if (flyers[i].p >= 1) { ripple = 1; flyers.splice(i, 1); }
    for (const q of pops) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 260 * dt; q.a -= dt * (q.color ? 1.6 : 2); }
    while (pops.length && pops[0].a <= 0) pops.shift();
    for (const s of splashes) s.age += dt * 2.4;
    while (splashes.length && splashes[0].age >= 1) splashes.shift();
    cheer = Math.max(0, cheer - dt * 2.4); ripple = Math.max(0, ripple - dt * 1.6);
    if (cups() !== shownCups) { shownCups = cups(); count.textContent = t("mg.cups", { c: shownCups }); count.classList.remove("pop"); void count.offsetWidth; count.classList.add("pop"); }
    draw(cloudX);
    if (left <= 0 && !drops.length) return end();
    raf = requestAnimationFrame(step);
  }

  function drawSprite(i, cx, cy, w, rot = 0) {                  // centre-anchored
    if (!ok(i)) return;
    const h = w * i.naturalHeight / i.naturalWidth;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.drawImage(i, -w / 2, -h / 2, w, h); ctx.restore();
  }
  function draw(cloudX) {
    // sky and soft hills
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#9ED8F5"); sky.addColorStop(0.6, "#DDF2FC"); sky.addColorStop(1, "#F4FBEA");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#B8E49A"; ctx.beginPath(); ctx.moveTo(0, H - 90);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H - 100 - Math.sin(x * 0.013 + 1) * 22 - Math.sin(x * 0.03) * 8);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = "#8ED06C"; ctx.beginPath(); ctx.moveTo(0, H - 60);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H - 66 - Math.sin(x * 0.02 + 3) * 10);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = "#7CC85A"; ctx.fillRect(0, H - 46, W, 46);
    ctx.fillStyle = "rgba(255,255,255,.18)"; for (let x = 0; x < W; x += 36) ctx.fillRect(x, H - 46, 18, 46);
    // sun, far clouds, palms
    if (ok(pic("game", "sun"))) { ctx.save(); ctx.translate(64, 54); ctx.rotate(clock * 0.15); ctx.drawImage(pic("game", "sun"), -34, -34, 68, 68); ctx.restore(); }
    ctx.globalAlpha = 0.55; drawSprite(pic("game", "cloud"), ((clock * 8) % (W + 200)) - 60, 40, 80); drawSprite(pic("game", "cloud"), ((clock * 5 + 330) % (W + 200)) - 60, 70, 60); ctx.globalAlpha = 1;
    drawSprite(pic("game", "palm"), 52, H - 70, 64, Math.sin(clock * 1.4) * 0.05);
    drawSprite(pic("game", "palm"), W - 40, H - 74, 58, Math.sin(clock * 1.2 + 1) * 0.05);

    // the tank: dry until the rain fills it
    const tk = pic("game", "tank");
    if (ok(tk)) {
      const tw = 168, th = tw * tk.naturalHeight / tk.naturalWidth;
      ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.beginPath(); ctx.ellipse(TANK.x + 4, TANK.y + th * 0.38, tw * 0.46, th * 0.18, 0, 0, 7); ctx.fill();
      ctx.drawImage(tk, TANK.x - tw / 2, TANK.y - th * 0.34, tw, th);
      const dry = 1 - cups() / MAX_CUPS;
      if (dry > 0.01) { ctx.fillStyle = `rgba(201,188,160,${dry * 0.92})`; ctx.beginPath(); ctx.ellipse(TANK.x, TANK.y, tw * 0.335, th * 0.215, 0, 0, 7); ctx.fill(); }
      if (ripple > 0) { ctx.strokeStyle = `rgba(255,255,255,${ripple})`; ctx.lineWidth = 2; const r = 8 + (1 - ripple) * 34; ctx.beginPath(); ctx.ellipse(TANK.x, TANK.y, r, r * 0.5, 0, 0, 7); ctx.stroke(); }
    }
    // the farmer cheers when you catch a drop
    drawSprite(pic("farm", "farmer"), W - 118, H - 78 - Math.sin(Math.min(1, cheer) * Math.PI) * 18, 108, cheer > 0 ? Math.sin(clock * 30) * 0.05 : 0);

    // the rain cloud
    const bob = Math.sin(clock * 2) * 3;
    ctx.fillStyle = "rgba(0,40,80,.1)"; ctx.beginPath(); ctx.ellipse(cloudX, 118, 50, 8, 0, 0, 7); ctx.fill();
    drawSprite(pic("game", "cloud"), cloudX, 46 + bob, 118);
    // raindrops, hopping drops, bursts, splashes
    ctx.shadowColor = "rgba(20,110,200,.75)"; ctx.shadowBlur = 9;                      // a blue glow, so the pale drops show on the light sky
    for (const d of drops) {
      if (!d.power) { drawSprite(pic("farm", "drop"), d.x, d.y, 42, Math.sin(clock * 5 + d.ph) * 0.18); continue; }
      const col = POWERS[d.power].color, pulse = 1 + Math.sin(clock * 8 + d.ph) * 0.08, tt = tinted(d.power);      // a special drop: bigger, coloured and glowing
      ctx.save(); ctx.shadowBlur = 0;
      const gl = ctx.createRadialGradient(d.x, d.y, 4, d.x, d.y, 46); gl.addColorStop(0, `${col}99`); gl.addColorStop(1, `${col}00`);
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(d.x, d.y, 46 * pulse, 0, 7); ctx.fill();
      ctx.shadowColor = col; ctx.shadowBlur = 14;
      if (tt) { const w = 58 * pulse, h = w * tt.height / tt.width; ctx.translate(d.x, d.y); ctx.rotate(Math.sin(clock * 5 + d.ph) * 0.14); ctx.drawImage(tt, -w / 2, -h / 2, w, h); }
      ctx.restore();
      drawPowerIcon(ctx, d.power, d.x + 21, d.y - 24);
    }
    ctx.shadowBlur = 0;
    for (const f of flyers) {
      if (f.p < 0) continue;
      const e = f.p * f.p * (3 - 2 * f.p), x = f.x + (TANK.x - f.x) * e, y = f.y + (TANK.y - 14 - f.y) * e - Math.sin(Math.PI * f.p) * 46;
      drawSprite(pic("farm", "drop"), x, y, 42 * (1 - 0.45 * f.p));
    }
    for (const q of pops) {
      if (q.color) { ctx.globalAlpha = clamp(q.a, 0, 1); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      else { ctx.fillStyle = `rgba(140,210,255,${Math.max(0, q.a)})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill(); }
    }
    if (clock < stormUntil) { ctx.fillStyle = `rgba(50,40,110,${0.1 + Math.sin(clock * 12) * 0.03})`; ctx.fillRect(0, 0, W, H); }          // the storm darkens the sky a little
    for (const pu of popups) {                                                                  // floating words: what the special drop did
      ctx.save(); ctx.globalAlpha = clamp(1.6 - pu.age * 1.4, 0, 1); ctx.font = "800 24px 'Noto Sans', 'Noto Sans Sinhala', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const y = pu.y - pu.age * 46;
      ctx.lineWidth = 6; ctx.strokeStyle = "#fff"; ctx.lineJoin = "round"; ctx.strokeText(pu.text, pu.x, y); ctx.fillStyle = pu.color; ctx.fillText(pu.text, pu.x, y); ctx.restore();
    }
    for (const s of splashes) { ctx.strokeStyle = `rgba(255,255,255,${1 - s.age})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(s.x, s.y, 4 + s.age * 14, 2 + s.age * 6, 0, 0, 7); ctx.stroke(); }
  }

  function end() {
    if (view.querySelector(".mg-result")) return;
    stop();
    reward("farmer", "catch", cups() >= 6 ? 3 : cups() >= 3 ? 2 : cups() >= 1 ? 1 : 0);   // drops and badges (rewards.js)
    if (opts.farm) {                                            // farm mode: the cups go into the farm tank
      const n = cups();
      view.querySelector(".mg-card").insertAdjacentHTML("beforeend", `
        <div class="mg-result" role="status">
          <p class="mg-big-text">${escapeHtml(t("mg.l1.done", { n: caught }))}</p>
          <p>${escapeHtml(t("farm.banked", { c: n }))}</p>
          <button type="button" class="mg-big" id="mg-next">${escapeHtml(t("farm.to_farm"))}</button>
          <button type="button" class="mg-small" id="mg-again1">${escapeHtml(t("mg.again"))}</button>
        </div>`);
      bankCups(n);
      const back = view.querySelector("#mg-next");
      back.onclick = () => farmScreen(state, view);
      view.querySelector("#mg-again1").onclick = () => levelRain(state, view, opts);
      back.focus();
      return;
    }
    const c = Math.max(4, cups());                              // at least 4 cups, so the next level can always be played
    view.querySelector(".mg-card").insertAdjacentHTML("beforeend", `
      <div class="mg-result" role="status">
        <p class="mg-big-text">${escapeHtml(t("mg.l1.done", { n: caught }))}</p>
        <p>${escapeHtml(t("mg.l1.cups", { c }))}</p>
        <button type="button" class="mg-big" id="mg-next">${escapeHtml(t("mg.next_level"))}</button>
      </div>`);
    const next = view.querySelector("#mg-next");
    next.onclick = () => levelFeed(state, view, c);
    next.focus();
  }
  raf = requestAnimationFrame((now) => { last = now; step(now); });
}

// ---------------------------------------------------------------------------
// Level 2: feed the crops (how much each crop drinks = its real water need)
// ---------------------------------------------------------------------------
function threeCrops(state) {
  const tanks = state.tanks.filter((x) => x.doc?.crops?.items && !x.demo);
  const tank = tanks.length ? tanks[Math.floor(Math.random() * tanks.length)] : state.tanks.find((x) => x.doc?.crops?.items);
  if (!tank) return null;
  const items = tank.doc.crops.items.filter((i) => i.need_mm);
  const cups = (i) => Math.max(1, Math.round(i.need_mm / CUP_MM));
  const paddy = shuffle(items.filter((i) => i.kind === "paddy"))[0];
  const small = shuffle(items.filter((i) => i.kind === "ofc" && cups(i) <= 3));
  const chosen = [paddy, small[0], small.find((i) => cups(i) !== cups(small[0])) || small[1]].filter(Boolean);
  return { tank, crops: shuffle(chosen).map((i) => ({ id: i.id, need_mm: i.need_mm, cups: cups(i), got: 0 })) };
}

const dropSvg = (on) => `<svg class="tf-need-drop ${on ? "on" : ""}" viewBox="0 0 40 52" aria-hidden="true"><path d="M20 4C20 4 6 24 6 33a14 14 0 0 0 28 0C34 24 20 4 20 4z"/></svg>`;

function levelFeed(state, view, startCups) {
  const setup = threeCrops(state);
  if (!setup) { view.innerHTML = frame(`<section class="mg-card"><p>${escapeHtml(t("mg.no_data"))}</p></section>`); wire(view); return; }
  const { tank, crops } = setup;
  let left = startCups, over = false, busy = false;
  sound?.setRain(false); sound?.setPhase("land");

  view.innerHTML = frame(`
    <section class="mg-card tf-card">
      <div class="cg-status">
        <p class="cg-phase">${escapeHtml(t("mg.l2.title"))}</p>
        <div class="cg-tools">${soundButton()}</div>
      </div>
      <div class="tf-speech"><img src="img/farm/farmer.png" width="96" height="96" alt="" class="tf-farmer"><p class="tf-bubble">${escapeHtml(t("mg.l2.help"))}</p></div>
      <div class="tf-supply"><img id="tf-tank" src="img/game/tank.png" width="130" alt=""><div><div id="mg-cups-left" class="tf-cuprow" aria-hidden="true"></div><span id="mg-left-text" class="tf-left" aria-live="polite"></span></div></div>
      <div class="tf-crops" id="mg-crops"></div>
      <button type="button" class="mg-small" id="mg-finish">${escapeHtml(t("mg.l2.finish"))}</button>
    </section>`);
  wire(view); wireSound(view);
  const row = view.querySelector("#mg-cups-left"), leftText = view.querySelector("#mg-left-text"), box = view.querySelector("#mg-crops"), tankEl = view.querySelector("#tf-tank");

  function draw() {
    row.innerHTML = Array.from({ length: startCups }, (_, k) => dropSvg(k < left)).join("");
    leftText.textContent = t("mg.l2.left", { c: left });
    box.innerHTML = crops.map((c, k) => {
      const full = c.got >= c.cups, thirsty = !full;
      return `<button type="button" class="tf-crop ${full ? "fed" : "thirsty"} ${over && thirsty ? "sad" : ""}" data-k="${k}" ${full || over ? "disabled" : ""} aria-label="${escapeHtml(cropName(c.id))}">
        <span class="tf-crop-art"><img src="img/${cropPic(c.id)}.png" alt=""></span>
        <span class="mg-crop-name">${escapeHtml(cropName(c.id))}</span>
        <span class="tf-need" aria-hidden="true">${Array.from({ length: c.cups }, (_, j) => dropSvg(j < c.got)).join("")}</span>
        <span class="mg-mood">${full ? escapeHtml(t("mg.l2.fed")) : over ? escapeHtml(t("mg.l2.thirsty")) : escapeHtml(t("mg.l2.tap"))}</span>
      </button>`;
    }).join("");
    box.querySelectorAll(".tf-crop").forEach((b) => { b.onclick = () => feed(b); });
  }

  // a drop of water hops from the tank to the crop that was tapped
  function feed(btn) {
    const c = crops[Number(btn.dataset.k)];
    if (busy || left <= 0 || c.got >= c.cups || over) return;
    busy = true;
    const a = tankEl.getBoundingClientRect(), b = btn.querySelector(".tf-crop-art").getBoundingClientRect();
    const fly = document.createElement("img");
    fly.src = "img/farm/drop.png"; fly.alt = ""; fly.className = "tf-fly";
    fly.style.left = `${a.left + a.width / 2 - 20}px`; fly.style.top = `${a.top + a.height / 3 - 20}px`;
    document.body.appendChild(fly);
    requestAnimationFrame(() => { fly.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 3)}px) scale(.7)`; });
    setTimeout(() => {
      fly.remove();
      c.got++; left--;
      sound?.sip();
      draw();
      const again = box.querySelector(`[data-k="${btn.dataset.k}"]`);
      again?.classList.add("gulp");
      busy = false;
      if (left <= 0 || crops.every((x) => x.got >= x.cups)) setTimeout(finish, 650);
    }, 480);
  }

  function finish() {
    if (over) return;
    over = true;
    draw();
    const fed = crops.filter((c) => c.got >= c.cups).length;
    reward("farmer", "feed", fed);                                                           // drops and badges (rewards.js)
    if (fed === crops.length) sound?.win(); else sound?.chime();
    const paddyHungry = crops.some((c) => /^paddy/.test(c.id) && c.got < c.cups);
    const lesson = fed === crops.length ? "mg.end.lesson_all" : paddyHungry ? "mg.end.lesson_paddy" : "mg.end.lesson_some";
    const facts = crops.map((c) => `${cropName(c.id)} ${num(c.need_mm, 0)} mm`).join(", ");
    view.querySelector(".mg-card").insertAdjacentHTML("beforeend", `
      <div class="mg-result" role="status">
        <div class="mg-stars" aria-label="${escapeHtml(t("mg.end.fed", { f: fed, n: crops.length }))}">${crops.map((_, k) => `<span class="mg-star ${k < fed ? "on" : ""}" style="--k:${k}">★</span>`).join("")}</div>
        <p class="mg-big-text">${escapeHtml(t(fed === crops.length ? "mg.end.title" : "mg.end.title_try"))}</p>
        <p>${escapeHtml(t("mg.end.fed", { f: fed, n: crops.length }))}</p>
        <p class="mg-lesson">${escapeHtml(t(lesson))}</p>
        <p class="note">${escapeHtml(t("mg.end.facts", { list: facts, tank: tankName(tank) }))} ${escapeHtml(t("mg.end.cupnote", { mm: CUP_MM }))}</p>
        <div class="mg-end-buttons">
          <button type="button" class="mg-big" id="mg-again">${escapeHtml(t("mg.again"))}</button>
          <button type="button" class="mg-small" id="mg-tofarm">${escapeHtml(t("farm.open"))}</button>
          <button type="button" class="mg-small" data-go="#/learn/challenges">${escapeHtml(t("mg.more"))}</button>
        </div>
      </div>`);
    view.querySelector("#mg-tofarm").onclick = () => { if (left > 0) bankCups(left); farmScreen(state, view); };
    view.querySelector("#mg-finish").hidden = true;
    wire(view);
    view.querySelector("#mg-again").onclick = () => { if (!sound) sound = createAudio(muted, "farm"); levelRain(state, view); };
    view.querySelector("#mg-again").focus();
  }
  view.querySelector("#mg-finish").onclick = finish;
  guard(view, () => {});
  draw();
}

// the farm screen gets the pieces it needs from this file
function farmScreen(state, view) {
  if (stopper) { stopper(); stopper = null; }
  renderFarm(state, view, {
    frame, wire, soundButton, wireSound, guard,
    catchRain: () => levelRain(state, view, { farm: true }),
    sound: () => sound,
    ensureSound: () => { if (!sound) sound = createAudio(muted, "farm"); },
  });
}

export function renderMiniGame(state, view, parts = []) {
  if (stopper) { stopper(); stopper = null; }
  if (parts[0] === "farm") return farmScreen(state, view);
  intro(state, view);
}
