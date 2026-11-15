// Little Farmers' Games (#/learn/kids): tiny games that teach one simple idea each, for small children.
//
//   memory   Match each crop picture with its name: now its own file, matchgame.js           #/learn/kids/memory
//   sort     Does this crop drink a LOT of water or a little? (real water figures)             #/learn/kids/sort
//   grow     Water the plant just right: not too dry, not too wet                              #/learn/kids/grow
//   season   Is this Maha (rainy, main season) or Yala (drier season)?                          #/learn/kids/season
//   (Tank Farmer is its own game: #/learn/play)
//
// Almost no reading: a friendly drop ("Bindu") says ONE short sentence, pictures and big buttons do the rest.
// If the phone has a voice for the language, a speaker button reads the sentence aloud.
// Crop water figures come from the real tank data. Nothing is saved. Text: si.json / en.json (keys "kd.*").
import { t, getLang } from "./i18n.js";
import { escapeHtml, num, cropPhoto, tankName } from "./ui.js";
import { cropIcon, CROP_ICON_IDS } from "./cropicons.js";
import { renderMatch } from "./matchgame.js";
import { reward } from "./rewards.js";

const CROPS = CROP_ICON_IDS;                          // all crops that have an illustrated icon
const BIG_MM = 600;                                   // "drinks a LOT" = needs 600 mm or more over its life (paddy is above 1000 mm)
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const cropName = (id) => t(`crop.${id}`);

let stopper = null;                                    // stops running timers when the child leaves a game
function guard(view, fn) {
  stopper = fn;
  const leave = () => { if (!view.isConnected || !location.hash.startsWith("#/learn/kids")) { fn(); window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave);
}

// ---- the guide: a friendly water drop with a face and a speech bubble ---------------------------------------
const DROP = `<svg class="kd-bindu" viewBox="0 0 64 80" aria-hidden="true">
  <path d="M32 4C32 4 6 38 6 52a26 26 0 0 0 52 0C58 38 32 4 32 4z" fill="#5BB5E6" stroke="#2477B0" stroke-width="3"/>
  <path d="M16 52a16 16 0 0 0 10 15" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>
  <circle cx="24" cy="48" r="4.5" fill="#1B3A52"/><circle cx="40" cy="48" r="4.5" fill="#1B3A52"/>
  <circle cx="25.5" cy="46.5" r="1.5" fill="#fff"/><circle cx="41.5" cy="46.5" r="1.5" fill="#fff"/>
  <path d="M24 58q8 8 16 0" stroke="#1B3A52" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;

const canSpeak = () => "speechSynthesis" in window && (getLang() === "en" || speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith("si")));
function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = getLang() === "si" ? "si-LK" : "en-GB";
    u.rate = 0.85;
    speechSynthesis.speak(u);
  } catch { /* no voice: nothing happens */ }
}
const guide = (key, vars = {}) => {
  const text = t(key, vars);
  return `<div class="kd-guide" role="status">${DROP}<p>${escapeHtml(text)}</p>${canSpeak() ? `<button type="button" class="kd-speak" data-say="${escapeHtml(text)}" aria-label="${escapeHtml(t("kd.read_aloud"))}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>` : ""}</div>`;
};

function frame(titleKey, body) {
  return `
    <div class="tank-head learn-head">
      <button type="button" class="back" data-go="#/learn/kids">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
        ${escapeHtml(t("kd.back"))}
      </button>
      <h1>${escapeHtml(t(titleKey))}</h1>
    </div>
    <div class="panel-body mg kd">${body}</div>`;
}
function wire(view) {
  view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });
  view.querySelectorAll("[data-say]").forEach((el) => { el.onclick = () => speak(el.dataset.say); });
}
const stars = (n, total = 3) => `<div class="mg-stars" aria-label="${escapeHtml(t("kd.stars", { n, total }))}">${Array.from({ length: total }, (_, k) => `<span class="mg-star ${k < n ? "on" : ""}" style="--k:${k}">★</span>`).join("")}</div>`;

// The end screen of every game: stars, one sentence about what was learned, play again
function finish(view, { n, game, learned, again, vars = {}, extra = "" }) {
  reward("kids", game, n);                                                  // drops and badges (rewards.js)
  const box = document.createElement("div");
  box.className = "mg-result";
  box.setAttribute("role", "status");
  box.innerHTML = `${stars(n)}
    <p class="mg-big-text">${escapeHtml(t(n >= 3 ? "kd.end.great" : n === 2 ? "kd.end.good" : "kd.end.try"))}</p>
    <div class="kd-learned"><strong>${escapeHtml(t("kd.learned"))}</strong><p>${escapeHtml(t(learned, vars))}</p></div>
    ${extra}
    <div class="mg-end-buttons">
      <button type="button" class="mg-big" id="kd-again">${escapeHtml(t("mg.again"))}</button>
      <button type="button" class="mg-small" data-go="#/learn/kids">${escapeHtml(t("kd.more_games"))}</button>
    </div>`;
  view.querySelector(".mg-card").appendChild(box);
  wire(view);
  const again_ = view.querySelector("#kd-again");
  again_.onclick = again;
  again_.focus();
  box.scrollIntoView({ block: "center", behavior: "smooth" });
}

// real water need of crops, from a real tank (a map crop id -> mm)
function needs(state) {
  const tanks = state.tanks.filter((x) => x.doc?.crops?.items && !x.demo);
  const tank = tanks.length ? tanks[Math.floor(Math.random() * tanks.length)] : state.tanks.find((x) => x.doc?.crops?.items);
  const map = {};
  tank?.doc.crops.items.forEach((i) => { if (i.need_mm) map[i.id] = i.need_mm; });
  return { tank, map };
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------
const TILES = [
  { id: "play", hash: "#/learn/play", icons: ["paddy"], art: "tank" },
  { id: "cloud", hash: "#/learn/cloud", icons: ["mung_bean"] },
  { id: "memory", hash: "#/learn/kids/memory", icons: ["maize", "groundnut"] },
  { id: "sort", hash: "#/learn/kids/sort", icons: ["paddy", "mung_bean"] },
  { id: "grow", hash: "#/learn/kids/grow", icons: ["sweet_potato"] },
  { id: "season", hash: "#/learn/kids/season", icons: ["pumpkin"] },
];
function hub(view) {
  view.innerHTML = `
    <div class="tank-head learn-head">
      <button type="button" class="back" data-go="#/learn">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
        ${escapeHtml(t("mg.back"))}
      </button>
      <h1>${escapeHtml(t("kd.title"))}</h1>
    </div>
    <div class="panel-body mg kd">
      <section class="mg-card">${guide("kd.hub.hello")}
        <div class="kd-tiles">${TILES.map((x) => `
          <button type="button" class="kd-tile" data-go="${x.hash}">
            <span class="kd-tile-art">${x.icons.map((c) => cropIcon(c, "kd-tile-icon")).join("")}</span>
            <strong>${escapeHtml(t(`kd.${x.id}.title`))}</strong>
            <span>${escapeHtml(t(`kd.${x.id}.about`))}</span>
          </button>`).join("")}
        </div>
      </section>
    </div>`;
  wire(view);
}

// ---------------------------------------------------------------------------
// Game 2: big drinker or small drinker (real water need of each crop)
// ---------------------------------------------------------------------------
function sortGame(state, view) {
  const { tank, map } = needs(state);
  const ids = Object.keys(map);
  const big = shuffle(ids.filter((id) => map[id] >= BIG_MM)).slice(0, 2);
  const small = shuffle(ids.filter((id) => map[id] < BIG_MM)).slice(0, 5 - big.length);
  const queue = shuffle([...big, ...small]);
  let i = 0, wrong = 0;
  const DROPS = (n) => Array.from({ length: n }, () => '<svg viewBox="0 0 40 52" aria-hidden="true"><path d="M20 3C20 3 5 24 5 33a15 15 0 0 0 30 0C35 24 20 3 20 3z" fill="#4DA3D8" stroke="#2477B0" stroke-width="2.5"/></svg>').join("");

  view.innerHTML = frame("kd.sort.title", `
    <section class="mg-card">
      ${guide("kd.sort.help")}
      <div class="kd-sortstage" id="kd-stage"></div>
      <div class="kd-bins">
        <button type="button" class="kd-bin lot" data-bin="big"><span class="kd-drops">${DROPS(5)}</span><strong>${escapeHtml(t("kd.sort.lot"))}</strong></button>
        <button type="button" class="kd-bin little" data-bin="small"><span class="kd-drops">${DROPS(1)}</span><strong>${escapeHtml(t("kd.sort.little"))}</strong></button>
      </div>
      <div class="kd-caption" id="kd-cap" role="status" aria-live="polite"></div>
    </section>`);
  wire(view);
  const stage = view.querySelector("#kd-stage"), cap = view.querySelector("#kd-cap");
  const show = () => { stage.innerHTML = `<div class="kd-bigcrop">${cropIcon(queue[i], "kd-bigcrop-icon")}<strong>${escapeHtml(cropName(queue[i]))}</strong></div><p class="kd-count">${i + 1} / ${queue.length}</p>`; };
  show();
  view.querySelectorAll(".kd-bin").forEach((b) => {
    b.onclick = () => {
      const id = queue[i], isBig = map[id] >= BIG_MM, right = (b.dataset.bin === "big") === isBig;
      if (!right) {
        wrong++;
        b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake");
        cap.textContent = t("kd.sort.again");
        return;
      }
      cap.textContent = t(isBig ? "kd.sort.yes_lot" : "kd.sort.yes_little", { crop: cropName(id), mm: num(map[id], 0) });
      i++;
      if (i < queue.length) { setTimeout(show, 700); return; }
      const n = wrong === 0 ? 3 : wrong <= 2 ? 2 : 1;
      const facts = queue.map((c) => `${cropName(c)} ${num(map[c], 0)} mm`).join(", ");
      setTimeout(() => {
        stage.innerHTML = "";
        finish(view, { n, game: "sort", learned: "kd.sort.learned", again: () => sortGame(state, view), extra: `<p class="note">${escapeHtml(t("mg.end.facts", { tank: tank ? tankName(tank) : "", list: facts }))}</p>` });
      }, 700);
    };
  });
}

// ---------------------------------------------------------------------------
// Game 3: grow a plant (water it just right)
// ---------------------------------------------------------------------------
function grow(state, view) {
  const GOAL = 12;                                   // seconds of "just right" needed
  const crop = shuffle(["mung_bean", "maize", "groundnut", "sweet_potato", "chilli", "brinjal", "pumpkin", "sesame"])[0];
  let water = 50, good = 0, bad = 0, ended = false, last = performance.now();
  view.innerHTML = frame("kd.grow.title", `
    <section class="mg-card">
      ${guide("kd.grow.help")}
      <div class="kd-grow">
        <div class="kd-plantbox"><div class="kd-plant" id="kd-plant">${cropIcon(crop, "kd-plant-icon")}</div><div class="kd-soil"></div></div>
        <div class="kd-meterbox">
          <div class="kd-meter" aria-hidden="true"><div class="kd-zone dry"></div><div class="kd-zone ok"></div><div class="kd-zone wet"></div><div class="kd-level" id="kd-level"></div></div>
          <div class="kd-mood" id="kd-mood" role="status" aria-live="polite"></div>
        </div>
      </div>
      <div class="kd-progress" aria-hidden="true"><span id="kd-prog"></span></div>
      <button type="button" class="mg-big kd-water" id="kd-water">${escapeHtml(t("kd.grow.water"))}</button>
    </section>`);
  wire(view);
  const plant = view.querySelector("#kd-plant"), level = view.querySelector("#kd-level"), mood = view.querySelector("#kd-mood"), prog = view.querySelector("#kd-prog");
  const btn = view.querySelector("#kd-water");
  function paint(zone) {
    level.style.bottom = `${water}%`;
    prog.style.width = `${Math.min(100, (good / GOAL) * 100)}%`;
    const stage = good / GOAL;
    plant.style.setProperty("--s", String(0.7 + stage * 0.7));
    plant.classList.toggle("droop", zone === "dry");
    plant.classList.toggle("soggy", zone === "wet");
    mood.className = `kd-mood ${zone}`;
    mood.textContent = t(`kd.grow.${zone}`);
  }
  btn.onclick = () => { if (!ended) { water = Math.min(100, water + 14); } };
  const tick = setInterval(() => {
    const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (ended) return;
    water = Math.max(0, water - 5 * dt);                           // the soil dries slowly
    const zone = water < 35 ? "dry" : water > 70 ? "wet" : "ok";
    if (zone === "ok") { good += dt; bad = Math.max(0, bad - dt); } else bad += dt;
    paint(zone);
    if (good >= GOAL) end(true);
    else if (bad >= 7) end(false, zone);
  }, 100);
  function stop() { ended = true; clearInterval(tick); }
  guard(view, stop);
  paint("ok");
  function end(won, zone) {
    stop();
    btn.disabled = true;
    if (won) plant.classList.add("done");
    const n = won ? (bad < 0.5 ? 3 : 2) : 1;
    finish(view, { n, game: "grow", learned: won ? "kd.grow.learned" : zone === "dry" ? "kd.grow.learned_dry" : "kd.grow.learned_wet", again: () => grow(state, view) });
  }
}

// ---------------------------------------------------------------------------
// Game 4: Maha or Yala?
// ---------------------------------------------------------------------------
const SUN = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="13" fill="#F4B93B" stroke="#C98A00" stroke-width="2"/><g stroke="#F4B93B" stroke-width="4" stroke-linecap="round"><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13 13l6 6M45 45l6 6M13 51l6-6M45 19l6-6"/></g></svg>';
const RAIN = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 38a12 12 0 0 1 1-24 16 16 0 0 1 30 5 9 9 0 0 1-2 19z" fill="#8FA7BE" stroke="#5A7390" stroke-width="2"/><g stroke="#2F7FB3" stroke-width="4" stroke-linecap="round"><path d="M20 46l-3 9M32 46l-3 9M44 46l-3 9"/></g></svg>';
const tankArt = (full) => `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="4" y="38" width="56" height="20" rx="8" fill="#A3733F"/><rect x="10" y="30" width="44" height="22" rx="6" fill="#E9E1CB" stroke="#7A5230" stroke-width="2"/><rect x="10" y="${full ? 32 : 46}" width="44" height="${full ? 20 : 6}" rx="${full ? 5 : 3}" fill="#4DA3D8"/></svg>`;
const SEASON_ITEMS = [
  { id: "rain", season: "maha", art: RAIN }, { id: "sun", season: "yala", art: SUN },
  { id: "full", season: "maha", art: tankArt(true) }, { id: "low", season: "yala", art: tankArt(false) },
];
function season(state, view) {
  const queue = shuffle(SEASON_ITEMS);
  let i = 0, wrong = 0;
  view.innerHTML = frame("kd.season.title", `
    <section class="mg-card">
      ${guide("kd.season.help")}
      <div class="kd-sortstage" id="kd-stage"></div>
      <div class="kd-bins">
        <button type="button" class="kd-bin maha" data-bin="maha"><span class="kd-bin-art">${RAIN}</span><strong>${escapeHtml(t("kd.season.maha"))}</strong><small>${escapeHtml(t("kd.season.maha_about"))}</small></button>
        <button type="button" class="kd-bin yala" data-bin="yala"><span class="kd-bin-art">${SUN}</span><strong>${escapeHtml(t("kd.season.yala"))}</strong><small>${escapeHtml(t("kd.season.yala_about"))}</small></button>
      </div>
      <div class="kd-caption" id="kd-cap" role="status" aria-live="polite"></div>
    </section>`);
  wire(view);
  const stage = view.querySelector("#kd-stage"), cap = view.querySelector("#kd-cap");
  const show = () => { const it = queue[i]; stage.innerHTML = `<div class="kd-bigcrop"><span class="kd-season-art">${it.art}</span><strong>${escapeHtml(t(`kd.season.item.${it.id}`))}</strong></div><p class="kd-count">${i + 1} / ${queue.length}</p>`; };
  show();
  view.querySelectorAll(".kd-bin").forEach((b) => {
    b.onclick = () => {
      const it = queue[i];
      if (b.dataset.bin !== it.season) { wrong++; b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); cap.textContent = t("kd.sort.again"); return; }
      cap.textContent = t(`kd.season.yes_${it.season}`);
      i++;
      if (i < queue.length) { setTimeout(show, 800); return; }
      const n = wrong === 0 ? 3 : wrong <= 2 ? 2 : 1;
      setTimeout(() => { stage.innerHTML = ""; finish(view, { n, game: "season", learned: "kd.season.learned", again: () => season(state, view) }); }, 800);
    };
  });
}

export function renderKids(state, parts, view) {
  if (stopper) { stopper(); stopper = null; }
  if (parts[0] === "memory") return renderMatch(state, view);
  if (parts[0] === "sort") return sortGame(state, view);
  if (parts[0] === "grow") return grow(state, view);
  if (parts[0] === "season") return season(state, view);
  return hub(view);
}
