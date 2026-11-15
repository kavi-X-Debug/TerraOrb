// "Match the crops" (#/learn/kids/memory): a memory card game for small children, remade with Google Flow pictures.
//
//   Every crop has TWO cards: its picture and its name. Turn over two cards; if they are a pair they stay up.
//   A picture guide is shown before the game. There are 10 levels, from 3 pairs (6 cards) up to 12 pairs (24 cards); each level opens
//   when you finish the one before (saved in this browser). You get a quick peek at the cards at the start, a longer one on bigger boards.
//   Cards turn over in 3D, pairs sparkle, and the music and sounds are made live by cloudaudio.js (see gamesound.js).
// The cartoon crop pictures, the card back and the meadow were made with Google Flow (AI-generated, see the Data sources page).
// The real crop photo appears when a pair is found. Nothing is saved except the music on/off choice. Text: si.json / en.json ("mc.*", "kd.*").
import { t } from "./i18n.js";
import { escapeHtml, cropPhoto } from "./ui.js";
import { gameSound } from "./gamesound.js";
import { reward } from "./rewards.js";

// the 12 crops that have their own cartoon picture (so no two cards look the same)
const CROPS = [
  { id: "mung_bean", pic: "farm/bean" }, { id: "maize", pic: "farm/maize" }, { id: "groundnut", pic: "farm/groundnut" }, { id: "big_onion", pic: "farm/onion" },
  { id: "pumpkin", pic: "farm/pumpkin" }, { id: "chilli", pic: "farm/chilli" }, { id: "brinjal", pic: "farm/brinjal" }, { id: "paddy", pic: "game/paddy" },
  { id: "sweet_potato", pic: "farm/sweetpotato" }, { id: "finger_millet", pic: "farm/millet" }, { id: "sesame", pic: "farm/sesame" }, { id: "cowpea", pic: "farm/cowpea" },
];
// 10 levels: more and more cards. pairs = how many crops; cols = how many cards in a row.
const LEVELS = [
  { pairs: 3, cols: 3 }, { pairs: 4, cols: 4 }, { pairs: 5, cols: 5 }, { pairs: 6, cols: 4 }, { pairs: 7, cols: 5 },
  { pairs: 8, cols: 4 }, { pairs: 9, cols: 6 }, { pairs: 10, cols: 5 }, { pairs: 11, cols: 6 }, { pairs: 12, cols: 6 },
];
const peekMs = (pairs) => 1500 + pairs * 220;                        // a longer peek when there are more cards
const starsFor = (tries, pairs) => (tries <= Math.ceil(pairs * 1.7) ? 3 : tries <= Math.ceil(pairs * 2.6) ? 2 : 1);
const PROGRESS_KEY = "mc-match-level";                               // how many levels are open (saved in this browser only)
const unlockedLevels = () => { try { return Math.min(LEVELS.length, Math.max(1, Number(localStorage.getItem(PROGRESS_KEY)) || 1)); } catch { return 1; } };
const unlock = (n) => { try { if (n > unlockedLevels()) localStorage.setItem(PROGRESS_KEY, String(Math.min(LEVELS.length, n))); } catch { /* not saved: fine */ } };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const cropName = (id) => t(`crop.${id}`);

const sound = gameSound("farm");
let stopper = null;                                       // stops timers and music when the page changes
function guard(view, fn) {
  stopper = () => { fn(); sound.stop(); };
  const leave = () => { if (!view.isConnected || !location.hash.startsWith("#/learn/kids/memory")) { stopper?.(); stopper = null; window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave);
}

const frame = (body) => `
  <div class="tank-head learn-head">
    <button type="button" class="back" data-go="#/learn/kids">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
      ${escapeHtml(t("kd.back"))}
    </button>
    <h1>${escapeHtml(t("kd.memory.title"))}</h1>
  </div>
  <div class="panel-body mg mc">${body}</div>`;
const wire = (view) => view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });

// ---------------------------------------------------------------------------
// The guide (shown before the game)
// ---------------------------------------------------------------------------
function guide(view) {
  const open = unlockedLevels(), sample = CROPS[1];
  const steps = [
    { art: `<span class="mc-mini back"><img src="img/match/cardback.png" alt=""></span><span class="tf-arrow">&#10140;</span><span class="mc-mini"><img src="img/${sample.pic}.png" alt=""></span>`, k: "s1" },
    { art: `<span class="mc-mini"><img src="img/${sample.pic}.png" alt=""></span><span class="mc-eq">=</span><span class="mc-mini name"><b>${escapeHtml(cropName(sample.id))}</b></span>`, k: "s2" },
    { art: `<span class="mc-stars"><i>&#9733;</i><i>&#9733;</i><i>&#9733;</i></span>`, k: "s3" },
  ];
  view.innerHTML = frame(`
    <section class="mg-card cg-guide">
      <img class="cg-sun" src="img/game/sun.png" width="240" height="240" alt="">
      <h2>${escapeHtml(t("mc.guide.title"))}</h2>
      <p class="cg-goal">${escapeHtml(t("mc.guide.goal"))}</p>
      <ol class="cg-steps">${steps.map((s, i) => `
        <li style="--i:${i}">
          <span class="cg-step-n">${i + 1}</span>
          <div class="cg-step-art" aria-hidden="true">${s.art}</div>
          <div><strong>${escapeHtml(t(`mc.guide.${s.k}.title`))}</strong><p>${escapeHtml(t(`mc.guide.${s.k}.text`))}</p></div>
        </li>`).join("")}
      </ol>
      <p class="cg-tip">${escapeHtml(t("mc.guide.tip"))}</p>
      <button type="button" class="mg-big" id="mc-go">${escapeHtml(t(open > 1 ? "mc.continue" : "mc.guide.go"))}</button>
      <div class="mc-levels" role="group" aria-label="${escapeHtml(t("mc.choose"))}">
        <strong>${escapeHtml(t("mc.choose"))}</strong>
        ${LEVELS.map((L, i) => `<button type="button" class="mc-lv" data-lv="${i}" ${i < open ? "" : "disabled"} aria-label="${escapeHtml(t("mc.level", { n: i + 1, total: LEVELS.length }))}">${i < open ? i + 1 : "&#128274;"}<small>${L.pairs * 2}</small></button>`).join("")}
      </div>
      ${sound.button()}
    </section>`);
  wire(view); sound.wire(view);
  view.querySelector("#mc-go").onclick = () => { sound.start(); play(view, open - 1); };
  view.querySelectorAll(".mc-lv").forEach((b) => { b.onclick = () => { sound.start(); play(view, Number(b.dataset.lv)); }; });
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------
function play(view, level) {
  const L = LEVELS[level], chosen = shuffle(CROPS).slice(0, L.pairs);
  const cards = shuffle(chosen.flatMap((c) => [{ ...c, kind: "pic" }, { ...c, kind: "name" }]));
  let open = [], lock = true, found = 0, tries = 0, timer = 0;
  const audio = () => sound.audio;

  view.innerHTML = frame(`
    <section class="mg-card mc-card-wrap">
      <div class="cg-status">
        <p class="cg-lvl-tag">${escapeHtml(t("mc.level", { n: level + 1, total: LEVELS.length }))} &middot; ${escapeHtml(t("mc.cards", { n: L.pairs * 2 }))}</p>
        <div class="cg-tools"><p class="cg-count" id="mc-count" aria-live="polite"></p>${sound.button()}</div>
      </div>
      <div class="tf-speech"><img src="img/farm/farmer.png" width="72" height="72" alt="" class="tf-farmer"><div class="tf-bubble" id="mc-msg" role="status" aria-live="polite"></div></div>
      <div class="mc-board" id="mc-board" style="--cols:${L.cols}">
        ${cards.map((c, k) => `
          <button type="button" class="mc-card" data-k="${k}" aria-label="${escapeHtml(t("kd.memory.card"))}" disabled>
            <span class="mc-inner">
              <span class="mc-back"><img src="img/match/cardback.png" alt="" draggable="false"></span>
              <span class="mc-front ${c.kind}">${c.kind === "pic" ? `<img src="img/${c.pic}.png" alt="${escapeHtml(cropName(c.id))}" draggable="false">` : `<b>${escapeHtml(cropName(c.id))}</b>`}</span>
            </span>
          </button>`).join("")}
      </div>
    </section>`);
  wire(view); sound.wire(view);
  guard(view, () => clearTimeout(timer));

  const $ = (s) => view.querySelector(s);
  const board = $("#mc-board"), msg = $("#mc-msg"), count = $("#mc-count");
  const els = [...board.querySelectorAll(".mc-card")];
  const say = (html) => { msg.innerHTML = html; };
  const status = () => { count.textContent = `${t("mc.pairs", { a: found, b: L.pairs })} · ${t("mc.tries", { n: tries })}`; };
  status();

  // a quick peek: all cards are shown for a moment, then turned face down
  say(escapeHtml(t("mc.peek")));
  els.forEach((e) => e.classList.add("up"));
  timer = setTimeout(() => {
    els.forEach((e) => { e.classList.remove("up"); e.disabled = false; });
    lock = false; say(escapeHtml(t("mc.go")));
  }, peekMs(L.pairs));

  els.forEach((b) => {
    b.onclick = () => {
      if (lock || b.classList.contains("up") || b.classList.contains("done")) return;
      b.classList.add("up"); audio()?.pop();
      open.push(Number(b.dataset.k));
      if (open.length < 2) return;
      tries++; status();
      const [ai, ci] = open, a = cards[ai], c = cards[ci], pair = [els[ai], els[ci]];
      open = [];
      if (a.id === c.id) {                                                      // a pair!
        lock = true;
        setTimeout(() => {
          pair.forEach((e) => e.classList.add("done"));
          audio()?.chime(); found++; status(); sparkle(pair);
          say(`${cropPhoto(a.id, cropName(a.id), "kd-photo")} <span>${escapeHtml(t("mc.match", { crop: cropName(a.id) }))}</span>`);
          lock = false;
          if (found === L.pairs) timer = setTimeout(() => finish(view, level, tries), 900);
        }, 450);
      } else {                                                                  // not a pair: turn both back over
        lock = true;
        setTimeout(() => pair.forEach((e) => e.classList.add("shake")), 380);
        audio()?.sip(); say(escapeHtml(t("mc.nomatch")));
        timer = setTimeout(() => { pair.forEach((e) => e.classList.remove("up", "shake")); lock = false; }, 1050);
      }
    };
  });
}

// little stars burst out of a found pair
function sparkle(pair) {
  pair.forEach((el) => {
    for (let i = 0; i < 7; i++) {
      const s = document.createElement("i");
      s.className = "mc-spark";
      s.style.setProperty("--dx", `${Math.round(Math.random() * 120 - 60)}px`);
      s.style.setProperty("--dy", `${Math.round(Math.random() * -110 - 10)}px`);
      s.style.animationDelay = `${i * 0.03}s`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  });
}

function finish(view, level, tries) {
  const L = LEVELS[level], n = starsFor(tries, L.pairs), last = level === LEVELS.length - 1;
  unlock(level + 2);                                                        // the next level opens
  reward("match", String(level), n);                                        // drops and badges (rewards.js)
  if (n >= 2) sound.audio?.win(); else sound.audio?.chime();
  const confetti = n >= 2 ? Array.from({ length: 26 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${["#F2994A", "#5BB6E6", "#6FCF97", "#F2C94C", "#EB5757"][i % 5]};animation-delay:${((i * 53) % 100) / 100}s;animation-duration:${2.2 + (i % 5) * 0.4}s"></i>`).join("") : "";
  view.querySelector(".mc-card-wrap").innerHTML = `
    <div class="cg-confetti" aria-hidden="true">${confetti}</div>
    <div class="mg-stars" aria-label="${escapeHtml(t("kd.stars", { n, total: 3 }))}">${[0, 1, 2].map((k) => `<span class="mg-star ${k < n ? "on" : ""}" style="--k:${k}">★</span>`).join("")}</div>
    <p class="mg-big-text">${escapeHtml(t(n >= 3 ? "kd.end.great" : n === 2 ? "kd.end.good" : "kd.end.try"))}</p>
    <p>${escapeHtml(t("mc.result", { tries, pairs: L.pairs }))}</p>
    <div class="kd-learned"><strong>${escapeHtml(t("kd.learned"))}</strong><p>${escapeHtml(t("kd.memory.learned"))}</p></div>
    ${last ? `<p class="cg-verdict ok">${escapeHtml(t("mc.all_done", { n: LEVELS.length }))}</p>` : `<p class="cg-verdict ok">${escapeHtml(t("mc.unlocked", { n: level + 2 }))}</p>`}
    <div class="mg-end-buttons">
      ${last ? "" : `<button type="button" class="mg-big" id="mc-next">${escapeHtml(t("mc.next"))}</button>`}
      <button type="button" class="${last ? "mg-big" : "mg-small"}" id="mc-again">${escapeHtml(t("mg.again"))}</button>
      <button type="button" class="mg-small" data-go="#/learn/kids">${escapeHtml(t("kd.more_games"))}</button>
    </div>`;
  wire(view);
  view.querySelector("#mc-again").onclick = () => play(view, level);
  const next = view.querySelector("#mc-next"); if (next) { next.onclick = () => play(view, level + 1); next.focus(); }
  view.querySelector(".mc-card-wrap").scrollIntoView({ block: "center", behavior: "smooth" });
}

export function renderMatch(state, view) {
  if (stopper) { stopper(); stopper = null; }
  guard(view, () => {});
  guide(view);
}
