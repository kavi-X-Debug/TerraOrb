// Learn Mode: practice challenges for students (#/learn/challenges, /quiz, /ladder, /week).
//
//   quiz    10 questions of common knowledge about tanks, seasons, rain and crops (answers explained)
//   ladder  put 4 crops in order from "needs least water" to "needs most", using the REAL water figures of a tank
//   week    tap a week that is a good (or a bad) time to sow, using the REAL sowing calendar of a tank
//
// The quiz questions are fixed facts. The other two games read the tank files, so their answers are never invented.
// Nothing is saved: scores live only on the page. All text is in si.json / en.json (keys "challenge.*").
import { t } from "./i18n.js";
import { signalIcon, escapeHtml, date, tankName, num } from "./ui.js";
import { cropIcon } from "./cropicons.js";
import { reward } from "./rewards.js";

const ICON_FOR = { good: "green", possible: "amber", not_now: "red" };
const ROUNDS = 5;
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const cropName = (id) => t(`crop.${id}`);
const shortDate = (iso) => date(iso, { day: "numeric", month: "short" });

// n = number of answer options, ok = number of the right one (1-based). Text: challenge.quiz.<id>.q / .o1 / .o2 ... / .why
const QUIZ = [
  { id: "maha", n: 3, ok: 2 }, { id: "wewa", n: 3, ok: 1 }, { id: "water_need", n: 3, ok: 1, data: true },
  { id: "late_rain", n: 3, ok: 2 }, { id: "red", n: 3, ok: 3 }, { id: "bethma", n: 3, ok: 1 },
  { id: "legumes", n: 3, ok: 2 }, { id: "elnino", n: 3, ok: 1 }, { id: "evaporation", n: 3, ok: 2 },
  { id: "not_nasa", n: 3, ok: 3 }, { id: "forecast", n: 3, ok: 2 }, { id: "check_signal", n: 3, ok: 1 },
  { id: "irrigated", n: 3, ok: 1 }, { id: "clouds", n: 3, ok: 3 },
];

// A real tank whose crop data we can use (a real one if there is one)
const dataTanks = (state) => {
  const all = state.tanks.filter((x) => x.doc?.crops?.calendar);
  const real = all.filter((x) => !x.demo && !x.doc.demo);
  return real.length ? real : all;
};

function frame(titleKey, body, extra = "") {
  return `
    <div class="tank-head learn-head">
      <button type="button" class="back" data-go="#/learn">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
        ${escapeHtml(t("challenge.back"))}
      </button>
      <h1>${escapeHtml(t(titleKey))}</h1>
      ${extra}
    </div>
    <div class="panel-body chal">${body}</div>`;
}
const wire = (view) => view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });
const progress = (i, total, score) => `
  <div class="chal-bar" role="status">
    <span>${escapeHtml(t("challenge.progress", { n: Math.min(i + 1, total), total }))}</span>
    <span class="chal-score">${escapeHtml(t("challenge.score", { score }))}</span>
  </div>
  <div class="learn-progress" aria-hidden="true">${Array.from({ length: total }, (_, k) => `<span class="${k <= i ? "on" : ""}"></span>`).join("")}</div>`;

function finish(view, titleKey, score, total, again) {
  const share = score / total;
  reward("chal", titleKey.split(".")[1], share === 1 ? 3 : share >= 0.7 ? 2 : share >= 0.4 ? 1 : 0);   // drops and badges (rewards.js)
  const msg = share === 1 ? "challenge.end.perfect" : share >= 0.7 ? "challenge.end.good" : share >= 0.4 ? "challenge.end.ok" : "challenge.end.try";
  view.innerHTML = frame(titleKey, `
    <section class="block chal-end">
      <p class="chal-big">${escapeHtml(t("challenge.end.score", { score, total }))}</p>
      <p>${escapeHtml(t(msg))}</p>
      <div class="plan-actions">
        <button type="button" class="action" id="chal-again">${escapeHtml(t("challenge.again"))}</button>
        <button type="button" class="action" data-go="#/learn/challenges">${escapeHtml(t("challenge.more"))}</button>
      </div>
    </section>`);
  view.querySelector("#chal-again").onclick = again;
  wire(view);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function menu(view) {
  const cards = [["quiz", "quiz"], ["ladder", "ladder"], ["week", "week"]].map(([id]) => `
    <button type="button" class="chal-card" data-go="#/learn/challenges/${id}">
      <strong>${escapeHtml(t(`challenge.${id}.title`))}</strong>
      <span>${escapeHtml(t(`challenge.${id}.about`))}</span>
      <em>${escapeHtml(t("challenge.start"))}</em>
    </button>`).join("");
  view.innerHTML = frame("challenge.menu_title", `
    <section class="block"><p>${escapeHtml(t("challenge.menu_text"))}</p></section>
    <div class="chal-menu">${cards}</div>
    <section class="block mg-entry">
      <h2>${escapeHtml(t("mg.entry_title"))}</h2>
      <p>${escapeHtml(t("mg.entry_text"))}</p>
      <button type="button" class="action" data-go="#/learn/kids">${escapeHtml(t("mg.entry_button"))}</button>
    </section>`);
  wire(view);
}

// ---------------------------------------------------------------------------
// Game 1: quiz
// ---------------------------------------------------------------------------
function quiz(state, view) {
  const order = shuffle(QUIZ).slice(0, 10);
  const tank = pick(dataTanks(state));
  const need = (id) => tank?.doc.crops.items.find((i) => i.id === id)?.need_mm;
  const fill = { paddy: num(need("paddy"), 0), mung: num(need("mung_bean"), 0), tank: tank ? tankName(tank) : "" };
  let i = 0, score = 0;

  function draw() {
    const q = order[i];
    const opts = Array.from({ length: q.n }, (_, k) => `
      <button type="button" class="chal-opt" data-k="${k + 1}"><span class="chal-letter">${"ABCD"[k]}</span><span>${escapeHtml(t(`challenge.quiz.${q.id}.o${k + 1}`, fill))}</span></button>`).join("");
    view.innerHTML = frame("challenge.quiz.title", `
      ${progress(i, order.length, score)}
      <section class="block">
        <h2 class="chal-q">${escapeHtml(t(`challenge.quiz.${q.id}.q`, fill))}</h2>
        <div class="chal-opts">${opts}</div>
        <div class="chal-feedback" id="chal-fb" role="status" hidden></div>
      </section>`);
    wire(view);
    view.querySelectorAll(".chal-opt").forEach((b) => {
      b.onclick = () => {
        const k = Number(b.dataset.k), right = k === q.ok;
        if (right) score++;
        view.querySelectorAll(".chal-opt").forEach((o) => {
          o.disabled = true;
          if (Number(o.dataset.k) === q.ok) o.classList.add("is-right");
        });
        if (!right) b.classList.add("is-wrong");
        const fb = view.querySelector("#chal-fb");
        fb.hidden = false;
        fb.className = `chal-feedback ${right ? "ok" : "no"}`;
        fb.innerHTML = `<strong>${escapeHtml(t(right ? "challenge.right" : "challenge.wrong"))}</strong>
          <p>${escapeHtml(t(`challenge.quiz.${q.id}.why`, fill))}</p>
          <button type="button" class="action" id="chal-next">${escapeHtml(t(i + 1 < order.length ? "challenge.next" : "challenge.see_score"))}</button>`;
        view.querySelector(".chal-score").textContent = t("challenge.score", { score });
        const next = view.querySelector("#chal-next");
        next.onclick = () => { i++; i < order.length ? draw() : finish(view, "challenge.quiz.title", score, order.length, () => quiz(state, view)); };
        next.focus();
      };
    });
  }
  draw();
}

// ---------------------------------------------------------------------------
// Game 2: water ladder (real water-need figures of a real tank)
// ---------------------------------------------------------------------------
function ladder(state, view) {
  const tanks = dataTanks(state);
  let round = 0, score = 0;

  // four crops whose water needs differ clearly (at least 12 %), so there is one right order
  function newRound() {
    const tank = pick(tanks);
    const items = tank.doc.crops.items.filter((i) => i.need_mm);
    for (let tries = 0; tries < 200; tries++) {
      const four = shuffle(items).slice(0, 4).sort((a, b) => a.need_mm - b.need_mm);
      if (four.every((c, k) => k === 0 || c.need_mm >= four[k - 1].need_mm * 1.12)) return { tank, right: four };
    }
    return { tank, right: items.slice().sort((a, b) => a.need_mm - b.need_mm).filter((_, k) => k % 3 === 0).slice(0, 4) };
  }

  function draw() {
    const r = newRound();
    const shown = shuffle(r.right);
    let chosen = [];
    view.innerHTML = frame("challenge.ladder.title", `
      ${progress(round, ROUNDS, score)}
      <section class="block">
        <h2 class="chal-q">${escapeHtml(t("challenge.ladder.q"))}</h2>
        <p class="note">${escapeHtml(t("challenge.ladder.hint", { tank: tankName(r.tank) }))}</p>
        <div class="chal-slots" id="chal-slots"></div>
        <div class="chal-crops" id="chal-crops"></div>
        <div class="plan-actions">
          <button type="button" class="action" id="chal-check" disabled>${escapeHtml(t("challenge.check"))}</button>
          <button type="button" class="action" id="chal-reset">${escapeHtml(t("challenge.reset"))}</button>
        </div>
        <div class="chal-feedback" id="chal-fb" role="status" hidden></div>
      </section>`);
    wire(view);
    const slots = view.querySelector("#chal-slots"), pool = view.querySelector("#chal-crops"), check = view.querySelector("#chal-check");
    const cropBtn = (c, extra = "") => `<button type="button" class="chal-crop ${extra}" data-id="${escapeHtml(c.id)}">${cropIcon(c.id, "chal-crop-icon")}<span>${escapeHtml(cropName(c.id))}</span></button>`;
    function sync() {
      slots.innerHTML = [0, 1, 2, 3].map((k) => `<div class="chal-slot${chosen[k] ? " full" : ""}"><b>${k + 1}</b>${chosen[k] ? cropBtn(chosen[k], "in-slot") : `<span class="chal-slot-empty">${escapeHtml(k === 0 ? t("challenge.ladder.least") : k === 3 ? t("challenge.ladder.most") : "")}</span>`}</div>`).join("");
      pool.innerHTML = shown.filter((c) => !chosen.includes(c)).map((c) => cropBtn(c)).join("");
      check.disabled = chosen.length !== 4;
      pool.querySelectorAll(".chal-crop").forEach((b) => { b.onclick = () => { chosen.push(shown.find((c) => c.id === b.dataset.id)); sync(); }; });
      slots.querySelectorAll(".chal-crop").forEach((b) => { b.onclick = () => { chosen = chosen.filter((c) => c.id !== b.dataset.id); sync(); }; });
    }
    sync();
    view.querySelector("#chal-reset").onclick = () => { chosen = []; sync(); };
    check.onclick = () => {
      const right = chosen.every((c, k) => c === r.right[k]);
      if (right) score++;
      view.querySelectorAll(".chal-crop, #chal-check, #chal-reset").forEach((b) => { b.disabled = true; });
      const fb = view.querySelector("#chal-fb");
      fb.hidden = false;
      fb.className = `chal-feedback ${right ? "ok" : "no"}`;
      fb.innerHTML = `<strong>${escapeHtml(t(right ? "challenge.right" : "challenge.wrong"))}</strong>
        <p>${escapeHtml(t("challenge.ladder.answer"))}</p>
        <ol class="chal-answer">${r.right.map((c) => `<li>${cropIcon(c.id, "chal-crop-icon")}<span>${escapeHtml(cropName(c.id))}</span><b>${escapeHtml(t("challenge.mm", { mm: num(c.need_mm, 0) }))}</b></li>`).join("")}</ol>
        <p class="note">${escapeHtml(t("challenge.ladder.why"))}</p>
        <button type="button" class="action" id="chal-next">${escapeHtml(t(round + 1 < ROUNDS ? "challenge.next" : "challenge.see_score"))}</button>`;
      view.querySelector(".chal-score").textContent = t("challenge.score", { score });
      const next = view.querySelector("#chal-next");
      next.onclick = () => { round++; round < ROUNDS ? draw() : finish(view, "challenge.ladder.title", score, ROUNDS, () => ladder(state, view)); };
      next.focus();
    };
  }
  draw();
}

// ---------------------------------------------------------------------------
// Game 3: pick the week (real sowing calendar of a real tank)
// ---------------------------------------------------------------------------
function weekGame(state, view) {
  const tanks = dataTanks(state);
  let round = 0, score = 0;

  function newRound() {
    for (let tries = 0; tries < 200; tries++) {
      const tank = pick(tanks);
      const weeks = tank.doc.crops.calendar;
      const crop = pick(weeks[0].items.filter((i) => i.kind === "ofc")).id;
      const rate = (k) => weeks[k].items.find((i) => i.id === crop).rating;
      const ratings = weeks.map((_, k) => rate(k));
      const mode = Math.random() < 0.5 ? "bad" : "good";
      const target = mode === "bad" ? "not_now" : "good";
      if (ratings.includes(target) && ratings.some((x) => x !== target)) return { tank, weeks, crop, mode, target };
    }
    const tank = tanks[0], weeks = tank.doc.crops.calendar;
    return { tank, weeks, crop: "mung_bean", mode: "good", target: "good" };
  }

  function draw() {
    const r = newRound();
    const weeksHtml = r.weeks.map((w, k) => `<button type="button" class="chal-week" data-k="${k}"><strong>${new Date(`${w.start}T00:00:00Z`).getUTCDate()}</strong><span>${escapeHtml(date(w.start, { month: "short" }))}</span></button>`).join("");
    view.innerHTML = frame("challenge.week.title", `
      ${progress(round, ROUNDS, score)}
      <section class="block">
        <div class="chal-prompt">${cropIcon(r.crop, "chal-crop-icon big")}
          <h2 class="chal-q">${escapeHtml(t(r.mode === "good" ? "challenge.week.q_good" : "challenge.week.q_bad", { crop: cropName(r.crop), tank: tankName(r.tank) }))}</h2></div>
        <p class="note">${escapeHtml(t("challenge.week.hint"))}</p>
        <div class="chal-weeks">${weeksHtml}</div>
        <div class="chal-feedback" id="chal-fb" role="status" hidden></div>
      </section>`);
    wire(view);
    view.querySelectorAll(".chal-week").forEach((b) => {
      b.onclick = () => {
        const k = Number(b.dataset.k), item = r.weeks[k].items.find((i) => i.id === r.crop);
        const right = item.rating === r.target;
        if (right) score++;
        // show the whole picture: colour + shape of every week
        view.querySelectorAll(".chal-week").forEach((el) => {
          const it = r.weeks[Number(el.dataset.k)].items.find((i) => i.id === r.crop);
          el.disabled = true;
          el.classList.add(`rating-${it.rating}`);
          el.insertAdjacentHTML("beforeend", signalIcon(ICON_FOR[it.rating]));
        });
        b.classList.add(right ? "is-right" : "is-wrong");
        const fb = view.querySelector("#chal-fb");
        fb.hidden = false;
        fb.className = `chal-feedback ${right ? "ok" : "no"}`;
        fb.innerHTML = `<strong>${escapeHtml(t(right ? "challenge.right" : "challenge.wrong"))}</strong>
          <p>${escapeHtml(t("challenge.week.result", { date: shortDate(r.weeks[k].start), rating: t(`crops.rating.${item.rating}`).toLowerCase() }))}
          ${item.past_years ? escapeHtml(t("calendar.detail.history", { ok: item.past_years_ok, years: item.past_years })) : ""}</p>
          <p class="note">${escapeHtml(t("challenge.week.why"))}</p>
          <button type="button" class="action" id="chal-next">${escapeHtml(t(round + 1 < ROUNDS ? "challenge.next" : "challenge.see_score"))}</button>`;
        view.querySelector(".chal-score").textContent = t("challenge.score", { score });
        const next = view.querySelector("#chal-next");
        next.onclick = () => { round++; round < ROUNDS ? draw() : finish(view, "challenge.week.title", score, ROUNDS, () => weekGame(state, view)); };
        next.focus();
      };
    });
  }
  draw();
}

export function renderChallenges(state, parts, view) {
  if (!dataTanks(state).length && parts[0] !== "quiz") {
    view.innerHTML = frame("challenge.menu_title", `<section class="block"><p>${escapeHtml(t("challenge.no_data"))}</p></section>`);
    wire(view);
    return;
  }
  if (parts[0] === "quiz") return quiz(state, view);
  if (parts[0] === "ladder") return ladder(state, view);
  if (parts[0] === "week") return weekGame(state, view);
  return menu(view);
}
