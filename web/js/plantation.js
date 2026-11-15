// "My Farm" (#/learn/play/farm): the plantation part of Tank Farmer, shown as a MAP like a village-builder game (Clash of Clans style).
//
//   * There are 8 crop plots. Water the plots to PLANT a crop and then UPGRADE it, level 1 to 5 (the last level is "Golden harvest").
//   * Water comes from the cups you catch in Tank Farmer's "Catch the rain" game. Cups are kept in your farm tank (up to 40).
//   * Thirsty crops cost more cups. The cost comes from the REAL water need of each crop at a real tank (1 cup = about 150 mm),
//     so the game teaches something true: paddy is far thirstier than mung bean.
//   * Every upgrade gives farm points; points raise your farmer rank.
// Your farm is saved only in this browser (localStorage). No account, nothing is sent anywhere.
// All text is in si.json / en.json (keys "farm.*"). The pictures were made with Google Flow (see the Data sources page).
import { t } from "./i18n.js";
import { escapeHtml, tankName, num } from "./ui.js";
import { checkBadges } from "./rewards.js";

const CUP_MM = 150;
const MAX_STORE = 40;                       // the farm tank holds at most 40 cups
const MAX_LEVEL = 5;
const KEY = "mc-farm";
// The 8 crops, easy to cheap first ... paddy last. "pic" = the picture file (img/<dir>/<name>.png).
export const FARM_CROPS = [
  { id: "mung_bean", pic: "farm/bean" },
  { id: "maize", pic: "farm/maize" },
  { id: "groundnut", pic: "farm/groundnut" },
  { id: "big_onion", pic: "farm/onion" },
  { id: "pumpkin", pic: "farm/pumpkin" },
  { id: "chilli", pic: "farm/chilli" },
  { id: "brinjal", pic: "farm/brinjal" },
  { id: "paddy", pic: "game/paddy" },
];
const MULT = [0.4, 0.6, 0.8, 1, 1.4];       // how the cost grows level by level (times the crop's base cups)
const RANKS = [0, 10, 30, 55, 85];          // farm points needed for each rank (names: farm.rank.1 ... 5)

// ---- saving (only in this browser) --------------------------------------------------------------------------------------
export function loadFarm() {
  try {
    const f = JSON.parse(localStorage.getItem(KEY));
    if (f && typeof f.cups === "number") return { cups: f.cups, levels: f.levels || {}, hello: !!f.hello };
  } catch { /* no saved farm, or a private window */ }
  return { cups: 3, levels: {}, hello: false };                     // a welcome gift of 3 cups
}
export function saveFarm(f) { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* not saved: fine */ } }
export function bankCups(n) { const f = loadFarm(); f.cups = Math.min(MAX_STORE, f.cups + n); saveFarm(f); return f; }

// ---- the numbers ---------------------------------------------------------------------------------------------------------
// real water need (mm) of each farm crop, from one real tank's data
function realNeeds(state) {
  const tank = state.tanks.find((x) => x.doc?.crops?.items && !x.demo) || state.tanks.find((x) => x.doc?.crops?.items);
  const map = {};
  tank?.doc.crops.items.forEach((i) => { if (i.need_mm) map[i.id] = i.need_mm; });
  return { tank, map };
}
const baseCups = (mm) => Math.max(1, Math.round((mm || CUP_MM) / CUP_MM));
const upgradeCost = (base, nextLevel) => Math.max(1, Math.round(base * MULT[nextLevel - 1]));
const totalCost = (base, level) => { let s = 0; for (let l = 1; l <= level; l++) s += upgradeCost(base, l); return s; };
const rankOf = (points) => RANKS.reduce((r, min, i) => (points >= min ? i + 1 : r), 1);

const dropIcon = '<svg viewBox="0 0 40 52" width="16" height="20" aria-hidden="true"><path d="M20 4C20 4 6 24 6 33a14 14 0 0 0 28 0C34 24 20 4 20 4z" fill="#4DB0E8" stroke="#2477B0" stroke-width="2.5"/></svg>';
const star = (on) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="${on ? "#FFC83D" : "#E3EAF0"}" stroke="${on ? "#D9962B" : "#C6D2DC"}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------------------
// The farm MAP. A little isometric island (seen from above at an angle, like a village-builder game):
// the village tank in the middle, a ring of 8 plots around it, the farmer, palms, bushes and flowers.
// Tap a plot to open its panel and upgrade it. A badge shows each plot's level; a bouncing green arrow shows plots you can afford to upgrade.
// api comes from minigame.js: { frame, wire, soundButton, wireSound, catchRain(), sound(), ensureSound(), guard() }
// ---------------------------------------------------------------------------
const MAPW = 920, MAPH = 620, TW = 128, TH = 64, GN = 7;             // picture size, tile size, island size (7 x 7 tiles)
const OX = MAPW / 2, OY = 150;                                         // where tile (0,0) is drawn
const iso = (i, j) => [OX + (i - j) * TW / 2, OY + (i + j) * TH / 2];  // tile (i, j) -> screen position of its middle
const PLOT_TILES = [[1, 1], [3, 1], [5, 1], [1, 3], [5, 3], [1, 5], [3, 5], [5, 5]];   // same order as FARM_CROPS (paddy, the thirstiest, is at the far corner)
const TANK_TILE = [3, 3];
const SPRITE_SCALE = [0, 0.5, 0.66, 0.82, 0.98, 1.12];               // how big the crop is at each level
const IMGS = {};
const pic = (path) => { if (!IMGS[path]) { const i = new Image(); i.src = `img/${path}.png`; IMGS[path] = i; } return IMGS[path]; };
const ok = (i) => i.complete && i.naturalWidth > 0;
const rand = (a, b) => a + Math.random() * (b - a);
const hash = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };

export function renderFarm(state, view, api) {
  const farm = loadFarm();
  const { tank, map } = realNeeds(state);
  const plots = FARM_CROPS.map((c, k) => ({ ...c, k, base: baseCups(map[c.id]), mm: map[c.id], tile: PLOT_TILES[k], pop: 0 }));
  let selected = null, busy = false, raf = 0, last = performance.now(), clock = 0, ended = false, hover = null;
  const flyers = [], bursts = [];
  const sound = () => api.sound();
  api.guard(view, () => { ended = true; cancelAnimationFrame(raf); });
  // sound can only start after a tap: start the farm tune on the first tap anywhere on this screen
  view.addEventListener("pointerdown", () => { api.ensureSound(); api.sound()?.setPhase("sea"); }, { once: true });
  ["farmer", "drop"].forEach((n) => pic(`farm/${n}`));
  ["tank", "palm", "cloud"].forEach((n) => pic(`game/${n}`));
  FARM_CROPS.forEach((c) => pic(c.pic));

  const lvOf = (p) => farm.levels[p.id] || 0;
  const points = () => plots.reduce((s, p) => s + totalCost(p.base, lvOf(p)), 0);
  const costOf = (p) => (lvOf(p) >= MAX_LEVEL ? 0 : upgradeCost(p.base, lvOf(p) + 1));

  view.innerHTML = api.frame(`
    <section class="mg-card pl-card">
      <div class="pl-top">
        <div class="pl-rank"><span class="pl-rank-badge" id="pl-badge"></span><div><strong id="pl-rank"></strong><span id="pl-points"></span></div></div>
        <div class="pl-store" id="pl-store" aria-live="polite"><img src="img/game/tank.png" width="64" alt=""><div><span id="pl-cups"></span><div class="pl-bar"><i id="pl-fill"></i></div></div></div>
        <div class="pl-actions"><button type="button" class="mg-big pl-rain" id="pl-rain">${escapeHtml(t("farm.catch"))}</button>${api.soundButton()}</div>
      </div>
      <div class="tf-speech"><img src="img/farm/farmer.png" width="72" height="72" alt="" class="tf-farmer"><p class="tf-bubble" id="pl-msg"></p></div>
      <div class="pl-map"><canvas id="pl-canvas" aria-label="${escapeHtml(t("farm.map"))}"></canvas></div>
      <ul class="pl-keys" aria-label="${escapeHtml(t("farm.plots"))}">${plots.map((p) => `<li><button type="button" data-k="${p.k}"></button></li>`).join("")}<li><button type="button" data-k="tank"></button></li></ul>
      <div class="pl-panel" id="pl-panel" hidden></div>
      <p class="note">${escapeHtml(t("farm.real", { tank: tank ? tankName(tank) : "—", mm: CUP_MM }))}</p>
      <button type="button" class="mg-small pl-reset" id="pl-reset">${escapeHtml(t("farm.reset"))}</button>
    </section>`);
  api.wire(view); api.wireSound(view);
  const $ = (s) => view.querySelector(s);
  const msg = (text) => { $("#pl-msg").textContent = text; };
  const canvas = $("#pl-canvas"), ctx = canvas.getContext("2d");
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = MAPW * DPR; canvas.height = MAPH * DPR;

  // ---- the HUD above the map ----
  function drawTop() {
    const pts = points(), rank = rankOf(pts), next = RANKS[rank];
    $("#pl-badge").textContent = rank;
    $("#pl-rank").textContent = t(`farm.rank.${rank}`);
    $("#pl-points").textContent = next != null ? ` · ${t("farm.points", { p: pts })} · ${t("farm.next", { n: next - pts, rank: t(`farm.rank.${rank + 1}`) })}` : ` · ${t("farm.points", { p: pts })} · ${t("farm.toprank")}`;
    $("#pl-cups").textContent = t("farm.cups", { c: farm.cups });
    $("#pl-fill").style.width = `${Math.round((farm.cups / MAX_STORE) * 100)}%`;
    // the hidden keyboard list (the map itself is a picture)
    view.querySelectorAll(".pl-keys button").forEach((b) => {
      const k = b.dataset.k;
      if (k === "tank") b.textContent = t("farm.tank");
      else { const p = plots[Number(k)], lv = lvOf(p); b.textContent = `${t(`crop.${p.id}`)}, ${t("farm.level", { n: lv })}${lv >= MAX_LEVEL ? "" : `, ${t(lv ? "farm.upgrade" : "farm.plant")} ${costOf(p)}`}`; }
      b.onclick = () => select(k === "tank" ? "tank" : Number(k));
    });
  }

  // ---- the info panel under the map (opens when a plot or the tank is tapped) ----
  function select(k) { selected = k; drawPanel(); }
  function drawPanel() {
    const panel = $("#pl-panel");
    if (selected == null) { panel.hidden = true; return; }
    panel.hidden = false;
    if (selected === "tank") {
      panel.innerHTML = `<img src="img/game/tank.png" alt="" class="pl-panel-img">
        <div class="pl-panel-main"><strong>${escapeHtml(t("farm.tank"))}</strong><span>${escapeHtml(t("farm.cups", { c: farm.cups }))}</span><small>${escapeHtml(t("farm.tank.text", { max: MAX_STORE }))}</small></div>
        <button type="button" class="mg-big pl-rain" id="pl-rain2">${escapeHtml(t("farm.catch"))}</button><button type="button" class="pl-x" id="pl-x" aria-label="${escapeHtml(t("assistant.close"))}">&times;</button>`;
      $("#pl-rain2").onclick = () => { api.ensureSound(); api.catchRain(); };
    } else {
      const p = plots[selected], lv = lvOf(p), max = lv >= MAX_LEVEL, cost = costOf(p), can = !max && farm.cups >= cost;
      panel.innerHTML = `<img src="img/${p.pic}.png" alt="" class="pl-panel-img">
        <div class="pl-panel-main"><strong>${escapeHtml(t(`crop.${p.id}`))}</strong>
          <span class="pl-stars" aria-label="${escapeHtml(t("farm.level", { n: lv }))}">${Array.from({ length: MAX_LEVEL }, (_, i) => star(i < lv)).join("")}</span>
          <span class="pl-stage">${escapeHtml(t(`farm.stage.${lv}`))}</span>
          <div class="pl-lvbar"><i style="width:${lv * 20}%"></i></div>
          <small>${escapeHtml(p.mm ? t("farm.need", { mm: num(p.mm, 0), c: p.base }) : "")}</small></div>
        ${max ? `<span class="pl-maxtag">${escapeHtml(t("farm.max"))}</span>`
          : `<button type="button" class="pl-water ${can ? "" : "poor"}" id="pl-up"><span>${escapeHtml(t(lv ? "farm.upgrade" : "farm.plant"))}</span><b>${dropIcon}${cost}</b></button>`}
        <button type="button" class="pl-x" id="pl-x" aria-label="${escapeHtml(t("assistant.close"))}">&times;</button>`;
      const up = $("#pl-up"); if (up) up.onclick = () => water(p);
    }
    $("#pl-x").onclick = () => select(null);
  }

  // ---- water a plot: a drop flies from the tank, then the crop grows ----
  function water(p) {
    if (busy) return;
    const lv = lvOf(p), cost = costOf(p);
    if (farm.cups < cost) {
      msg(t("farm.nowater", { c: cost - farm.cups }));
      const s = $("#pl-store"); s.classList.remove("shake"); void s.offsetWidth; s.classList.add("shake");
      return;
    }
    busy = true;
    const [tx, ty] = iso(...TANK_TILE), [px, py] = iso(...p.tile);
    flyers.push({ x0: tx, y0: ty - 50, x1: px, y1: py - 30, p: 0, plot: p, lv, cost });
    sound()?.sip();
  }
  function landed(f) {
    const p = f.plot, before = rankOf(points());
    farm.cups -= f.cost; farm.levels[p.id] = f.lv + 1; farm.hello = true; saveFarm(farm);
    if (f.lv + 1 >= MAX_LEVEL) checkBadges();                                  // a crop at the top level can unlock a badge (rewards.js)
    const after = rankOf(points());
    if (f.lv + 1 >= MAX_LEVEL) sound()?.win(); else sound()?.chime();
    msg(after > before ? t("farm.rankup", { rank: t(`farm.rank.${after}`) }) : f.lv === 0 ? t("farm.planted", { crop: t(`crop.${p.id}`) }) : t("farm.up", { crop: t(`crop.${p.id}`), n: f.lv + 1 }));
    const [px, py] = iso(...p.tile);
    for (let i = 0; i < 18; i++) bursts.push({ x: px, y: py - 40, vx: rand(-120, 120), vy: rand(-220, -60), a: 1, r: rand(3, 6), gold: i % 2 === 0 });
    p.pop = 1; busy = false;
    drawTop(); drawPanel();
  }

  // ---- drawing the map ----
  const diamond = (cx, cy, w = TW, h = TH) => { ctx.beginPath(); ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + w / 2, cy); ctx.lineTo(cx, cy + h / 2); ctx.lineTo(cx - w / 2, cy); ctx.closePath(); };
  function sprite(path, cx, baseY, w, rot = 0) {                                    // anchored at the bottom middle
    const i = pic(path); if (!ok(i)) return;
    const h = w * i.naturalHeight / i.naturalWidth;
    ctx.save(); ctx.translate(cx, baseY); ctx.rotate(rot); ctx.drawImage(i, -w / 2, -h, w, h); ctx.restore();
  }
  const isPlotTile = (i, j) => PLOT_TILES.some(([a, b]) => a === i && b === j);

  function drawIsland() {
    // water under the island, with drifting clouds
    const sky = ctx.createLinearGradient(0, 0, 0, MAPH); sky.addColorStop(0, "#A9DDF5"); sky.addColorStop(1, "#E7F7FC");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, MAPW, MAPH);
    ctx.globalAlpha = 0.7;
    for (let k = 0; k < 3; k++) { const x = ((clock * (6 + k * 3) + k * 330) % (MAPW + 260)) - 130; if (ok(pic("game/cloud"))) { const w = 120 + k * 30; ctx.drawImage(pic("game/cloud"), x - w / 2, 24 + k * 38, w, w * pic("game/cloud").naturalHeight / pic("game/cloud").naturalWidth); } }
    ctx.globalAlpha = 1;
    // the island's thick edge (earth), then the grass top is drawn tile by tile
    const top = iso(-0.5, -0.5), right = iso(GN - 0.5, -0.5), bottom = iso(GN - 0.5, GN - 0.5), left = iso(-0.5, GN - 0.5);
    const T = 46;
    ctx.fillStyle = "rgba(60,140,190,.25)"; ctx.beginPath(); ctx.ellipse(OX, bottom[1] + T - 8, 470, 62, 0, 0, 7); ctx.fill();   // shadow on the water
    let g = ctx.createLinearGradient(0, left[1], 0, left[1] + T); g.addColorStop(0, "#A8754A"); g.addColorStop(1, "#6E4526");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(left[0], left[1]); ctx.lineTo(bottom[0], bottom[1]); ctx.lineTo(bottom[0], bottom[1] + T); ctx.lineTo(left[0], left[1] + T - 6); ctx.closePath(); ctx.fill();
    g = ctx.createLinearGradient(0, right[1], 0, right[1] + T); g.addColorStop(0, "#946038"); g.addColorStop(1, "#5E3A20");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(bottom[0], bottom[1]); ctx.lineTo(right[0], right[1]); ctx.lineTo(right[0], right[1] + T - 6); ctx.lineTo(bottom[0], bottom[1] + T); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(left[0], left[1] + 4); ctx.lineTo(bottom[0], bottom[1] + 4); ctx.lineTo(right[0], right[1] + 4); ctx.stroke();
    void top;
  }

  function drawPlot(p, cx, cy) {
    const lv = lvOf(p), cost = costOf(p), can = lv < MAX_LEVEL && farm.cups >= cost, sel = selected === p.k;
    // the soil patch with furrows
    diamond(cx, cy, TW * 0.9, TH * 0.9);
    const g = ctx.createLinearGradient(0, cy - TH / 2, 0, cy + TH / 2); g.addColorStop(0, "#9A6B3C"); g.addColorStop(1, "#6E4526");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#5A371C"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 2;
    for (let f = -2; f <= 2; f++) { ctx.beginPath(); ctx.moveTo(cx + f * 14 - 30, cy + f * 7 + 15); ctx.lineTo(cx + f * 14 + 30, cy + f * 7 - 15); ctx.stroke(); }
    if (lv === 0) {                                                       // an empty plot: a little seed bobs
      const bob = Math.sin(clock * 3 + p.k) * 3;
      ctx.fillStyle = "#E9C98A"; ctx.beginPath(); ctx.ellipse(cx, cy - 6 + bob, 8, 11, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "#B4894A"; ctx.lineWidth = 2; ctx.stroke();
    } else {
      const sc = SPRITE_SCALE[lv] * (1 + p.pop * 0.18 * Math.sin(p.pop * Math.PI));
      if (lv >= MAX_LEVEL) {                                              // golden glow
        const gl = ctx.createRadialGradient(cx, cy - 40, 6, cx, cy - 40, 80); gl.addColorStop(0, "rgba(255,225,110,.7)"); gl.addColorStop(1, "rgba(255,225,110,0)");
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy - 40, 80, 0, 7); ctx.fill();
      }
      ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.beginPath(); ctx.ellipse(cx + 4, cy + 4, 34 * sc, 11 * sc, 0, 0, 7); ctx.fill();
      sprite(p.pic, cx, cy + 12, 104 * sc, Math.sin(clock * 1.6 + p.k) * 0.035);
      if (lv >= MAX_LEVEL) {
        for (let s = 0; s < 3; s++) { const a = (Math.sin(clock * 2.4 + s * 2 + p.k) + 1) / 2; ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(cx + (s - 1) * 34, cy - 34 - s * 18, 2 + a * 3, 0, 7); ctx.fill(); }
      }
    }
    // level badge (like a building level in a village game)
    const bx = cx + 40, by = cy - 22 - (lv ? 14 : 0);
    ctx.fillStyle = lv >= MAX_LEVEL ? "#FFC83D" : lv ? "#3F9AD8" : "#9AA8B2";
    ctx.beginPath(); ctx.arc(bx, by, 14, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = lv >= MAX_LEVEL ? "#7A4A00" : "#fff"; ctx.font = "800 15px 'Noto Sans', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(lv), bx, by + 1);
    // the bouncing green arrow when you can afford the upgrade
    if (can) {
      const ay = cy - 100 - (lv ? SPRITE_SCALE[lv] * 30 : 0) + Math.sin(clock * 5 + p.k) * 5;
      ctx.fillStyle = "#4FC36B"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 14, ay); ctx.lineTo(cx, ay - 16); ctx.lineTo(cx + 14, ay); ctx.lineTo(cx + 6, ay); ctx.lineTo(cx + 6, ay + 12); ctx.lineTo(cx - 6, ay + 12); ctx.lineTo(cx - 6, ay); ctx.closePath(); ctx.stroke(); ctx.fill();
    }
    if (sel || hover === p.k) {                                           // selection ring
      diamond(cx, cy, TW * 0.98, TH * 0.98);
      ctx.strokeStyle = sel ? `rgba(255,255,255,${0.7 + Math.sin(clock * 6) * 0.3})` : "rgba(255,255,255,.6)"; ctx.lineWidth = sel ? 4 : 3; ctx.stroke();
    }
    p.pop = Math.max(0, p.pop - 0.02);
  }

  const hits = [];                                                        // what is where, for taps: { k, cx, cy }
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, MAPW, MAPH);
    drawIsland();
    hits.length = 0;
    for (let s = 0; s <= (GN - 1) * 2; s++) {
      for (let i = 0; i < GN; i++) {
        const j = s - i; if (j < 0 || j >= GN) continue;
        const [cx, cy] = iso(i, j);
        // the ground tile: dirt on the two paths, grass elsewhere
        const path = (i === 3 || j === 3) && !(i === 3 && j === 3);
        diamond(cx, cy);
        ctx.fillStyle = path ? ((i + j) % 2 ? "#E8CC94" : "#E0C186") : ((i + j) % 2 ? "#92D26E" : "#86CB64"); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 1.5; ctx.stroke();
        const pk = PLOT_TILES.findIndex(([a, b]) => a === i && b === j);
        if (pk >= 0) { drawPlot(plots[pk], cx, cy); hits.push({ k: pk, cx, cy }); continue; }
        if (i === TANK_TILE[0] && j === TANK_TILE[1]) {
          if (ok(pic("game/tank"))) {
            const tw = 176, th = tw * pic("game/tank").naturalHeight / pic("game/tank").naturalWidth;
            ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.beginPath(); ctx.ellipse(cx + 4, cy + 10, 76, 24, 0, 0, 7); ctx.fill();
            ctx.drawImage(pic("game/tank"), cx - tw / 2, cy - th * 0.46, tw, th);
            // the water in the tank: dry when empty, full of blue when there are many cups
            const full = farm.cups / MAX_STORE;
            ctx.fillStyle = `rgba(201,188,160,${Math.max(0, 1 - full * 1.6) * 0.9})`; ctx.beginPath(); ctx.ellipse(cx, cy - th * 0.46 + th * 0.34, tw * 0.335, th * 0.215, 0, 0, 7); ctx.fill();
          }
          ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2477B0"; ctx.lineWidth = 3;
          const chip = `${farm.cups}`; ctx.font = "800 16px 'Noto Sans', sans-serif";
          ctx.beginPath(); ctx.roundRect(cx - 26, cy - 92, 52, 26, 13); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "#1F5E85"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(chip, cx, cy - 78);
          if (selected === "tank" || hover === "tank") { diamond(cx, cy, TW * 0.98, TH * 0.98); ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 4; ctx.stroke(); }
          hits.push({ k: "tank", cx, cy });
          continue;
        }
        if (i === 4 && j === 4) { sprite("farm/farmer", cx - 4, cy + 10, 62 + Math.sin(clock * 3) * 1.2, Math.sin(clock * 2) * 0.03); continue; }          // the farmer
        // scenery: palms, bushes and flowers
        const h = hash(i, j);
        const edge = i === 0 || j === 0 || i === GN - 1 || j === GN - 1;                 // trees only grow around the edge, so the plots stay clear
        if (!path && edge && h < 0.55) sprite("game/palm", cx, cy + 14, 62 + h * 40, Math.sin(clock * 1.3 + i) * 0.04);
        else if (!path && h < 0.38) { ctx.fillStyle = "#55B04A"; ctx.beginPath(); ctx.ellipse(cx - 8, cy, 17, 12, 0, 0, 7); ctx.ellipse(cx + 9, cy - 3, 15, 11, 0, 0, 7); ctx.fill(); ctx.fillStyle = "#6BC85C"; ctx.beginPath(); ctx.ellipse(cx - 4, cy - 6, 11, 8, 0, 0, 7); ctx.fill(); }
        else if (!path && h < 0.7) { for (let f = 0; f < 3; f++) { ctx.fillStyle = ["#fff", "#FFC2D8", "#FFE066"][f]; ctx.beginPath(); ctx.arc(cx + (f - 1) * 18 + h * 6, cy + (f % 2 ? 6 : -6), 3.2, 0, 7); ctx.fill(); } }
      }
    }
    // a drop flying from the tank, and sparkles when a crop grows
    for (const f of flyers) {
      const e = f.p * f.p * (3 - 2 * f.p), x = f.x0 + (f.x1 - f.x0) * e, y = f.y0 + (f.y1 - f.y0) * e - Math.sin(Math.PI * f.p) * 70;
      const d = pic("farm/drop"); if (ok(d)) ctx.drawImage(d, x - 20, y - 26, 40, 40 * d.naturalHeight / d.naturalWidth);
    }
    for (const b of bursts) { ctx.fillStyle = b.gold ? `rgba(255,208,70,${b.a})` : `rgba(110,200,255,${b.a})`; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); }
  }

  function step(now) {
    if (ended) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    for (const f of flyers) f.p += dt / 0.55;
    for (let i = flyers.length - 1; i >= 0; i--) if (flyers[i].p >= 1) { landed(flyers[i]); flyers.splice(i, 1); }
    for (const b of bursts) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 420 * dt; b.a -= dt * 1.3; }
    while (bursts.length && bursts[0].a <= 0) bursts.shift();
    draw();
    raf = requestAnimationFrame(step);
  }

  // ---- taps and hovering on the map ----
  const hitAt = (e) => {
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * MAPW / r.width, y = (e.clientY - r.top) * MAPH / r.height;
    let best = null, bd = 1e9;
    for (const h of hits) {
      const inDiamond = Math.abs(x - h.cx) / (TW / 2) + Math.abs(y - h.cy) / (TH / 2) <= 1;
      const inSprite = Math.abs(x - h.cx) < 46 && y > h.cy - 110 && y < h.cy + 8;                                            // the crop standing on the tile
      if (inDiamond || inSprite) { const d = Math.abs(x - h.cx) + Math.abs(y - h.cy); if (d < bd) { bd = d; best = h.k; } }
    }
    return best;
  };
  canvas.addEventListener("pointermove", (e) => { hover = hitAt(e); canvas.style.cursor = hover != null ? "pointer" : "default"; });
  canvas.addEventListener("pointerleave", () => { hover = null; });
  canvas.addEventListener("pointerdown", (e) => { const k = hitAt(e); select(k === selected ? null : k); if (k != null && k !== "tank") msg(plots[k].mm ? t("farm.tapped", { crop: t(`crop.${plots[k].id}`) }) : ""); });

  $("#pl-rain").onclick = () => { api.ensureSound(); api.catchRain(); };
  let armed = false;
  $("#pl-reset").onclick = (e) => {
    if (!armed) { armed = true; e.currentTarget.textContent = t("farm.reset.sure"); setTimeout(() => { armed = false; e.currentTarget.textContent = t("farm.reset"); }, 3500); return; }
    farm.cups = 3; farm.levels = {}; saveFarm(farm); armed = false;
    e.currentTarget.textContent = t("farm.reset"); msg(t("farm.hello")); drawTop(); drawPanel();
  };

  msg(farm.hello ? t("farm.back") : t("farm.hello"));
  drawTop(); drawPanel();
  raf = requestAnimationFrame((now) => { last = now; step(now); });
}
