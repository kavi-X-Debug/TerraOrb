// "Little Lessons" (#/learn/lessons): short picture stories for children, each followed by a tiny game. Sixteen lessons.
//
//   #/learn/lessons            the lesson cards (rain, seasons, tanks, satellites, sharing, crops, forecasts, sowing, fire, landslides, El Niño, carbon, the water cycle, glaciers)
//   #/learn/lessons/<id>       one lesson: 3 story pictures (move with Next/Back) -> a game -> stars
//
// The pictures and their short animations were made with Google Flow (AI-generated, see the Data sources page). The lessons teach general facts, not tank data,
// so nothing here is a measurement. Progress (stars per lesson) is saved in this browser only (localStorage "mc-lessons").
// The game types are: "order" (tap the pictures in the right order), "sort" (put each card in one of two boxes) and "quiz" (pick the answer).
// All words are in si.json / en.json under "ls.*"; this file only holds the structure (which picture, which answer is right).
import { t } from "./i18n.js";
import { escapeHtml } from "./ui.js";
import { gameSound } from "./gamesound.js";
import { reward } from "./rewards.js";

// ---------------------------------------------------------------------------
// The lessons: structure only (words are looked up as ls.<id>.*)
// ---------------------------------------------------------------------------
const LESSONS = [
  { id: "water", imgs: ["water1", "water2", "water3"],
    game: { type: "order" } },                                                       // the 3 story pictures, in the order they happen
  { id: "seasons", imgs: ["seasons1", "seasons2", "seasons3"],
    game: { type: "sort", bins: ["a", "b"], items: [["i1", "a"], ["i2", "b"], ["i3", "a"], ["i4", "b"], ["i5", "a"], ["i6", "b"]] } },
  { id: "cascade", imgs: ["cascade1", "cascade2", "cascade3"],
    game: { type: "quiz", questions: [{ q: "q1", right: 0 }, { q: "q2", right: 1 }, { q: "q3", right: 2 }] } },   // right = which option is correct (0, 1 or 2)
  { id: "sat", imgs: ["sat1", "sat2", "sat3"],
    game: { type: "sort", bins: ["a", "b"], items: [["i1", "a"], ["i2", "b"], ["i3", "a"], ["i4", "b"], ["i5", "a"], ["i6", "b"]] } },
  { id: "bethma", imgs: ["bethma1", "bethma2", "bethma3"], game: { type: "order" } },
  { id: "crops", imgs: ["crops1", "crops2", "crops3"],
    game: { type: "sort", bins: ["a", "b"], items: [["i1", "a"], ["i2", "b"], ["i3", "b"], ["i4", "a"], ["i5", "b"], ["i6", "b"]] } },      // a = big drinker, b = small sipper
  { id: "forecast", imgs: ["forecast1", "forecast2", "forecast3"],
    game: { type: "quiz", questions: [{ q: "q1", right: 1 }, { q: "q2", right: 0 }, { q: "q3", right: 2 }] } },
  { id: "sowing", imgs: ["sowing1", "sowing2", "sowing3"], game: { type: "order" } },
  // Hazards and the Earth system (general facts, no tank data)
  { id: "fire", imgs: ["fire1", "fire2", "fire3"],
    game: { type: "sort", bins: ["a", "b"], items: [["i1", "a"], ["i2", "b"], ["i3", "a"], ["i4", "b"], ["i5", "a"], ["i6", "b"]] } },      // a = starts a fire, b = keeps us safe
  { id: "slide", imgs: ["slide1", "slide2", "slide3"],
    game: { type: "quiz", questions: [{ q: "q1", right: 0 }, { q: "q2", right: 1 }, { q: "q3", right: 1 }] } },
  { id: "elnino", imgs: ["elnino1", "elnino2", "elnino3"], game: { type: "order" } },
  { id: "lanina", imgs: ["lanina1", "lanina2", "lanina3"],
    game: { type: "sort", bins: ["a", "b"], items: [["i1", "a"], ["i2", "b"], ["i3", "a"], ["i4", "b"], ["i5", "a"], ["i6", "b"]] } },      // a = El Niño, b = La Niña
  { id: "carbon", imgs: ["carbon1", "carbon2", "carbon3"],
    game: { type: "sort", bins: ["a", "b"], items: [["i1", "a"], ["i2", "b"], ["i3", "a"], ["i4", "b"], ["i5", "a"], ["i6", "b"]] } },      // a = takes CO2 from the air, b = puts CO2 into the air
  { id: "warming", imgs: ["warming1", "warming2", "warming3"],
    game: { type: "quiz", questions: [{ q: "q1", right: 0 }, { q: "q2", right: 1 }, { q: "q3", right: 0 }] } },
  { id: "cycle", imgs: ["cycle1", "cycle2", "cycle3"],
    game: { type: "quiz", questions: [{ q: "q1", right: 0 }, { q: "q2", right: 1 }, { q: "q3", right: 2 }] } },
  { id: "ice", imgs: ["ice1", "ice2", "ice3"], game: { type: "order" } },
];

const STORE = "mc-lessons";
const stars = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const saveStars = (id, n) => { try { const s = stars(); s[id] = Math.max(s[id] || 0, n); localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* not saved: fine */ } };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const sound = gameSound("farm");
let stopper = null;                                       // stops timers and music when the page changes
function guard(view, fn) {
  stopper = () => { fn(); sound.stop(); };
  const leave = () => { if (!view.isConnected || !location.hash.startsWith("#/learn/lessons")) { stopper?.(); stopper = null; window.removeEventListener("hashchange", leave); } };
  window.addEventListener("hashchange", leave);
}

const frame = (title, backHash, body) => `
  <div class="tank-head learn-head">
    <button type="button" class="back" data-go="${backHash}">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
      ${escapeHtml(t("kd.back"))}
    </button>
    <h1>${escapeHtml(title)}</h1>
  </div>
  <div class="panel-body mg ls">${body}</div>`;
const wire = (view) => view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });
const img = (name, cls = "") => `<img class="${cls}" src="img/lessons/${name}.jpg" alt="" width="960" height="536" draggable="false">`;

// a story picture that moves: a short looping video (made from the picture with Google Flow) fades in over the still picture.
// The still picture stays underneath, so nothing is empty while the video loads or if it cannot play (or for people who prefer less motion).
function movingPic(name) {
  return `${img(name, "ls-kb")}<video class="ls-vid" src="img/lessons/${name}.mp4" muted loop playsinline autoplay preload="auto" aria-hidden="true" tabindex="-1" onplaying="this.classList.add('on')"></video>`;
}

// ---------------------------------------------------------------------------
// The lesson list
// ---------------------------------------------------------------------------
function hub(view) {
  const got = stars();
  view.innerHTML = frame(t("ls.title"), "#/learn", `
    <section class="mg-card ls-hub">
      <div class="tf-speech"><img src="img/farm/farmer.png" width="72" height="72" alt="" class="tf-farmer"><div class="tf-bubble">${escapeHtml(t("ls.hub.hello"))}</div></div>
      <div class="ls-cards">${LESSONS.map((L, i) => `
        <a class="ls-card" href="#/learn/lessons/${L.id}" style="--i:${i}">
          <span class="ls-card-art">${img(L.imgs[0])}${got[L.id] ? `<b class="ls-got" aria-label="${escapeHtml(t("kd.stars", { n: got[L.id], total: 3 }))}">${"★".repeat(got[L.id])}</b>` : ""}</span>
          <strong>${escapeHtml(t(`ls.${L.id}.title`))}</strong>
          <span>${escapeHtml(t(`ls.${L.id}.about`))}</span>
        </a>`).join("")}
      </div>
      ${sound.button()}
    </section>`);
  wire(view); sound.wire(view);
}

// ---------------------------------------------------------------------------
// The story: three pictures, each with a short sentence from the guide
// ---------------------------------------------------------------------------
function story(view, L, i = 0) {
  const last = i === L.imgs.length - 1;
  view.innerHTML = frame(t(`ls.${L.id}.title`), "#/learn/lessons", `
    <section class="mg-card ls-story">
      <div class="ls-pic">${movingPic(L.imgs[i])}<span class="ls-badge">${escapeHtml(t("ls.step", { n: i + 1, total: L.imgs.length }))}</span></div>
      <div class="ls-side">
        <div class="tf-speech"><img src="img/farm/farmer.png" width="72" height="72" alt="" class="tf-farmer"><div class="tf-bubble" role="status" aria-live="polite"><div><strong>${escapeHtml(t(`ls.${L.id}.s${i + 1}.h`))}</strong><p>${escapeHtml(t(`ls.${L.id}.s${i + 1}.t`))}</p></div></div></div>
        <div class="ls-dots" aria-hidden="true">${L.imgs.map((_, k) => `<span class="${k === i ? "on" : k < i ? "past" : ""}"></span>`).join("")}</div>
        <div class="mg-end-buttons">
          ${i > 0 ? `<button type="button" class="mg-small" id="ls-prev">${escapeHtml(t("ls.prev"))}</button>` : ""}
          <button type="button" class="mg-big" id="ls-next">${escapeHtml(t(last ? "ls.start_game" : "ls.next"))}</button>
        </div>
        ${sound.button()}
      </div>
    </section>`);
  wire(view); sound.wire(view);
  const prev = view.querySelector("#ls-prev"); if (prev) prev.onclick = () => story(view, L, i - 1);
  const next = view.querySelector("#ls-next");
  next.onclick = () => { sound.audio?.pop(); if (last) game(view, L); else story(view, L, i + 1); };
  next.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// The game after the story
// ---------------------------------------------------------------------------
function game(view, L) {
  const g = L.game;
  const body = g.type === "order" ? orderBody(L) : g.type === "sort" ? sortBody(L) : quizBody(L);
  view.innerHTML = frame(t(`ls.${L.id}.title`), "#/learn/lessons", `
    <section class="mg-card ls-game">
      <div class="cg-status"><p class="cg-lvl-tag">${escapeHtml(t("ls.game"))}</p><div class="cg-tools"><p class="cg-count" id="ls-count" aria-live="polite"></p>${sound.button()}</div></div>
      <div class="tf-speech"><img src="img/farm/farmer.png" width="72" height="72" alt="" class="tf-farmer"><div class="tf-bubble" id="ls-msg" role="status" aria-live="polite">${escapeHtml(t(`ls.${g.type}.help`))}</div></div>
      <div id="ls-stage">${body}</div>
    </section>`);
  wire(view); sound.wire(view);
  const ctx = {
    view, L, msg: view.querySelector("#ls-msg"), count: view.querySelector("#ls-count"), stage: view.querySelector("#ls-stage"),
    wrong: 0, timer: 0,
    say: (key, params) => { ctx.msg.textContent = t(key, params); },
    done: () => { ctx.timer = setTimeout(() => finish(view, L, ctx.wrong), 900); },
  };
  guard(view, () => clearTimeout(ctx.timer));
  ({ order: orderWire, sort: sortWire, quiz: quizWire })[g.type](ctx);
}

// "order": tap the pictures in the order things happen
const orderBody = (L) => `<div class="ls-order">${shuffle(L.imgs.map((name, k) => ({ name, k }))).map((c) => `
  <button type="button" class="ls-ocard" data-k="${c.k}"><span class="ls-onum" aria-hidden="true"></span>${img(c.name)}<strong>${escapeHtml(t(`ls.${L.id}.o${c.k + 1}`))}</strong></button>`).join("")}</div>`;
function orderWire(c) {
  let next = 0;
  const cards = [...c.stage.querySelectorAll(".ls-ocard")];
  c.count.textContent = t("ls.order.count", { a: 0, b: cards.length });
  cards.forEach((b) => {
    b.onclick = () => {
      if (b.classList.contains("done")) return;
      if (Number(b.dataset.k) === next) {
        next++; b.classList.add("done"); b.querySelector(".ls-onum").textContent = String(next);
        sound.audio?.chime(); c.count.textContent = t("ls.order.count", { a: next, b: cards.length }); c.say("ls.right");
        if (next === cards.length) c.done();
      } else {
        c.wrong++; b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); sound.audio?.sip(); c.say("ls.order.wrong");
      }
    };
  });
}

// "sort": one card at a time goes into box A or box B
const sortBody = (L) => `<div class="ls-sortstage" id="ls-card"></div>
  <div class="ls-bins">${L.game.bins.map((b) => `<button type="button" class="ls-bin ${b}" data-bin="${b}"><strong>${escapeHtml(t(`ls.${L.id}.bin.${b}`))}</strong></button>`).join("")}</div>`;
function sortWire(c) {
  const queue = shuffle(c.L.game.items);
  let i = 0;
  const show = () => { c.stage.querySelector("#ls-card").innerHTML = `<div class="ls-bigcard" aria-live="polite"><strong>${escapeHtml(t(`ls.${c.L.id}.${queue[i][0]}`))}</strong></div>`; c.count.textContent = `${i + 1} / ${queue.length}`; };
  show();
  c.stage.querySelectorAll(".ls-bin").forEach((b) => {
    b.onclick = () => {
      if (c.locked) return;
      if (b.dataset.bin !== queue[i][1]) { c.wrong++; b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); sound.audio?.sip(); c.say("ls.sort.wrong"); return; }
      sound.audio?.chime(); c.say("ls.right"); i++;
      if (i < queue.length) { c.locked = true; setTimeout(() => { c.locked = false; show(); }, 600); } else { c.stage.querySelector("#ls-card").innerHTML = ""; c.done(); }
    };
  });
}

// "quiz": a question with three answers
const quizBody = () => `<div class="ls-quiz" id="ls-q"></div>`;
function quizWire(c) {
  const qs = c.L.game.questions;
  let i = 0;
  const show = () => {
    const q = qs[i];
    c.count.textContent = `${i + 1} / ${qs.length}`;
    c.stage.querySelector("#ls-q").innerHTML = `
      <div class="ls-qpic">${img(c.L.imgs[i % c.L.imgs.length])}</div>
      <h2 class="ls-qtext">${escapeHtml(t(`ls.${c.L.id}.${q.q}`))}</h2>
      <div class="ls-answers">${[0, 1, 2].map((a) => `<button type="button" class="ls-answer" data-a="${a}">${escapeHtml(t(`ls.${c.L.id}.${q.q}.a${a + 1}`))}</button>`).join("")}</div>`;
    c.stage.querySelectorAll(".ls-answer").forEach((b) => {
      b.onclick = () => {
        if (c.locked) return;
        if (Number(b.dataset.a) !== q.right) { c.wrong++; b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake", "no"); b.disabled = true; sound.audio?.sip(); c.say("ls.quiz.wrong"); return; }
        b.classList.add("yes"); sound.audio?.chime(); c.say("ls.right"); c.locked = true; i++;
        if (i < qs.length) setTimeout(() => { c.locked = false; show(); }, 900); else c.done();
      };
    });
  };
  show();
}

// ---------------------------------------------------------------------------
// The end: stars
// ---------------------------------------------------------------------------
function finish(view, L, wrong) {
  const n = wrong === 0 ? 3 : wrong <= 2 ? 2 : 1;
  saveStars(L.id, n);
  reward("lesson", L.id, n);                              // drops, badges and the lesson card (rewards.js)
  if (n >= 2) sound.audio?.win(); else sound.audio?.chime();
  const idx = LESSONS.indexOf(L), nextL = LESSONS[idx + 1];
  const confetti = n >= 2 ? Array.from({ length: 26 }, (_, k) => `<i style="left:${(k * 37) % 100}%;background:${["#F2994A", "#5BB6E6", "#6FCF97", "#F2C94C", "#EB5757"][k % 5]};animation-delay:${((k * 53) % 100) / 100}s;animation-duration:${2.2 + (k % 5) * 0.4}s"></i>`).join("") : "";
  view.querySelector(".ls-game").innerHTML = `
    <div class="cg-confetti" aria-hidden="true">${confetti}</div>
    <div class="mg-stars" aria-label="${escapeHtml(t("kd.stars", { n, total: 3 }))}">${[0, 1, 2].map((k) => `<span class="mg-star ${k < n ? "on" : ""}" style="--k:${k}">★</span>`).join("")}</div>
    <p class="mg-big-text">${escapeHtml(t(n >= 3 ? "kd.end.great" : n === 2 ? "kd.end.good" : "kd.end.try"))}</p>
    <div class="kd-learned"><strong>${escapeHtml(t("kd.learned"))}</strong><p>${escapeHtml(t(`ls.${L.id}.learned`))}</p></div>
    <div class="mg-end-buttons">
      ${nextL ? `<button type="button" class="mg-big" data-go="#/learn/lessons/${nextL.id}">${escapeHtml(t("ls.next_lesson"))}</button>` : ""}
      <button type="button" class="${nextL ? "mg-small" : "mg-big"}" id="ls-again">${escapeHtml(t("ls.again"))}</button>
      <button type="button" class="mg-small" data-go="#/learn/lessons">${escapeHtml(t("ls.all"))}</button>
    </div>`;
  wire(view);
  view.querySelector("#ls-again").onclick = () => story(view, L, 0);
}

export function renderLessons(state, parts, view) {
  if (stopper) { stopper(); stopper = null; }
  guard(view, () => {});
  const L = LESSONS.find((x) => x.id === parts[0]);
  if (!L) return hub(view);
  sound.start();                                        // opened by a tap on a lesson card, so sound may start
  story(view, L, 0);
}
