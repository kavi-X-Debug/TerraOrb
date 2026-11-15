// "How it works" page (#/how-it-works): where the data comes from, how it becomes advice,
// whether the advice passes its tests, and what to keep in mind. Plain words, with animation.
//
// Numbers come from the data files, never typed here:
//   the test results   → data/validation.json (written by pipeline/validate.py)
//   tanks measured     → how many tank files have a real (non-demo) water section
// All text comes from si.json / en.json (keys "how.*").
import { t } from "./i18n.js";
import { escapeHtml, date } from "./ui.js";
import { loadValidation } from "./data.js";

// Small line icons (Lucide style, ISC licence), drawn inline so they take the text colour.
const I = {
  satellite: '<path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  scale: '<path d="m16 16 3-8 3 8c-.9.6-1.9 1-3 1s-2.1-.4-3-1Z"/><path d="m2 16 3-8 3 8c-.9.6-1.9 1-3 1s-2.1-.4-3-1Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  sprout: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
};
const icon = (name) => `<svg class="how-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`;

// Data sets: id → is it NASA data? (text keys: how.ds.<id>.name / .what / .use)
const DATASETS = [
  { id: "power", nasa: true },
  { id: "opera", nasa: true, measured: true },
  { id: "gibs", nasa: true },
  { id: "cmr", nasa: true },
  { id: "openmeteo", nasa: false },
  { id: "osm", nasa: false },
  { id: "fao", nasa: false },
];
// Each step has a realistic picture (AI-generated with Google Flow: see the Data sources page and the note at the bottom of this page).
const STEPS = [
  { id: "satellite", icon: "satellite", img: "satellite" }, { id: "clean", icon: "filter", img: "laptop" },
  { id: "rules", icon: "scale", img: "meeting" }, { id: "advice", icon: "sprout", img: "farmer" },
];
const LIMITS = ["crops", "water", "rain_grid", "rain_end", "forecast", "thresholds", "sinhala", "aid"];

// ---------------------------------------------------------------------------
function stepsBlock() {
  const items = STEPS.map((s, i) => `
    <li class="how-step has-photo reveal" style="--i:${i}">
      <figure class="how-step-photo"><img src="img/how/${s.img}.jpg" alt="" loading="lazy" decoding="async"><span class="how-step-num">${i + 1}</span><span class="how-step-ic">${icon(s.icon)}</span></figure>
      <h3>${escapeHtml(t(`how.step.${s.id}.title`))}</h3>
      <p>${escapeHtml(t(`how.step.${s.id}.text`))}</p>
    </li>`).join("");
  return `
  <section class="how-section" aria-labelledby="how-flow-title">
    <h2 class="reveal" id="how-flow-title">${escapeHtml(t("how.flow.title"))}</h2>
    <p class="how-lead reveal">${escapeHtml(t("how.flow.lead"))}</p>
    <ol class="how-steps">${items}</ol>
  </section>`;
}

function datasetsBlock(measuredCount) {
  const cards = DATASETS.map((d, i) => {
    const status = d.measured ? t("how.status.measured", { n: measuredCount }) : t("how.status.used");
    return `
    <article class="how-card reveal ${d.nasa ? "is-nasa" : "not-nasa"}" style="--i:${i % 3}">
      <span class="how-tag">${escapeHtml(t(d.nasa ? "how.tag.nasa" : "how.tag.other"))}</span>
      <h3>${escapeHtml(t(`how.ds.${d.id}.name`))}</h3>
      <p>${escapeHtml(t(`how.ds.${d.id}.what`))}</p>
      <p class="how-use"><strong>${escapeHtml(t("how.used_for"))}</strong> ${escapeHtml(t(`how.ds.${d.id}.use`))}</p>
      <p class="how-status">${escapeHtml(status)}</p>
    </article>`;
  }).join("");
  return `
  <section class="how-section" id="sources" aria-labelledby="how-data-title">
    <h2 class="reveal" id="how-data-title">${escapeHtml(t("how.data.title"))}</h2>
    <p class="how-lead reveal">${escapeHtml(t("how.data.lead"))}</p>
    <div class="how-cards">${cards}</div>
    <p class="how-lead reveal"><a class="action" href="#/data-sources">${escapeHtml(t("dsp.title"))}</a></p>
  </section>`;
}

// A bar that fills when it scrolls into view, with its number counting up.
function bar(label, value, tone) {
  const pct = Math.round(value * 100);
  return `
    <div class="how-bar ${tone}">
      <div class="how-bar-top"><span>${escapeHtml(label)}</span><strong data-count="${pct}">0%</strong></div>
      <div class="how-bar-track"><div class="how-bar-fill" style="--w:${pct}%"></div></div>
    </div>`;
}

// A wide band with a rain video: why the whole system exists (the monsoon fills the tanks)
function bannerBlock() {
  return `
  <section class="how-banner reveal" aria-labelledby="how-banner-title">
    <video class="how-banner-video" autoplay muted loop playsinline preload="none" poster="img/how/rain.jpg" aria-hidden="true" tabindex="-1">
      <source src="img/how/rain.mp4" type="video/mp4">
    </video>
    <div class="how-banner-shade" aria-hidden="true"></div>
    <div class="how-banner-text">
      <h2 id="how-banner-title">${escapeHtml(t("how.banner.title"))}</h2>
      <p>${escapeHtml(t("how.banner.text"))}</p>
    </div>
  </section>`;
}

function proofBlock(v) {
  const c = v?.crops?.summary;
  const first = v?.crops?.cells?.[0];
  if (!c || !c.n) {
    return `<section class="how-section"><h2 class="reveal">${escapeHtml(t("how.proof.title"))}</h2>
      <p class="how-lead reveal">${escapeHtml(t("how.proof.none"))}</p></section>`;
  }
  const tank = v.summary?.tank_model;
  return `
  <section class="how-section" aria-labelledby="how-proof-title">
    <h2 class="reveal" id="how-proof-title">${escapeHtml(t("how.proof.title"))}</h2>
    <p class="how-lead reveal">${escapeHtml(t("how.proof.intro", { train: first.train_period, test: first.test_period }))}</p>
    <div class="how-proof reveal">
      ${bar(t("how.proof.overall"), c.accuracy, "good")}
      ${bar(t("how.proof.guess"), c.accuracy_guessing, "muted")}
      ${c.good_was_right == null ? "" : bar(t("how.proof.good"), c.good_was_right, "good")}
      <p class="note">${escapeHtml(t(c.beats_guessing ? "how.proof.beats" : "how.proof.notbeats", { n: c.n }))}</p>
    </div>
    <div class="how-callouts">
      <div class="how-callout reveal"><h3>${escapeHtml(t("how.proof.caveat.title"))}</h3><p>${escapeHtml(t("how.proof.caveat"))}</p></div>
      <div class="how-callout reveal"><h3>${escapeHtml(t("how.proof.elnino.title"))}</h3><p>${escapeHtml(t("how.proof.elnino"))}</p></div>
      ${tank ? `<div class="how-callout reveal"><h3>${escapeHtml(t("how.proof.tank.title"))}</h3><p>${escapeHtml(t("how.proof.tank", {
        n: tank.tanks_tested, model: tank.mean_mae_model_pp, base: tank.mean_mae_baseline_pp }))}</p></div>` : ""}
    </div>
    <p class="note reveal">${escapeHtml(t("how.proof.run", { date: date(v.generated) }))}</p>
  </section>`;
}

function limitsBlock() {
  return `
  <section class="how-section" aria-labelledby="how-limits-title">
    <h2 class="reveal" id="how-limits-title">${escapeHtml(t("how.limits.title"))}</h2>
    <ul class="how-limits">${LIMITS.map((k, i) => `
      <li class="reveal" style="--i:${i % 2}">${icon("alert")}<span>${escapeHtml(t(`how.limit.${k}`))}</span></li>`).join("")}
    </ul>
  </section>`;
}

// ---------------------------------------------------------------------------
// Animations: sections rise in as they scroll into view; bars fill and numbers count up.
// With "reduce motion" switched on, everything simply shows at once.
// ---------------------------------------------------------------------------
function animate(root) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveal = (el) => {
    el.classList.add("in");
    el.querySelectorAll("[data-count]").forEach((n) => countUp(n, reduce));
  };
  if (reduce || !("IntersectionObserver" in window)) {
    root.querySelectorAll(".reveal").forEach(reveal);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  root.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

function countUp(el, reduce) {
  const target = Number(el.dataset.count);
  if (reduce) { el.textContent = `${target}%`; return; }
  const start = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - start) / 1200);
    el.textContent = `${Math.round(target * (1 - Math.pow(1 - k, 3)))}%`;     // eases out
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export async function renderAbout(state, view) {
  const measured = state.tanks.filter((x) => x.doc?.water && !x.doc.water.demo && x.doc.water.source).length;
  const validation = await loadValidation();
  if (!view.isConnected || !location.hash.startsWith("#/how-it-works")) return;      // the user already moved on
  view.innerHTML = `
    <div class="how-hero has-video">
      <video class="how-hero-video" autoplay muted loop playsinline preload="metadata" poster="img/how/wewa.jpg" aria-hidden="true" tabindex="-1">
        <source src="img/how/hero.mp4" type="video/mp4">
      </video>
      <div class="how-hero-shade" aria-hidden="true"></div>
      <div class="how-hero-text">
        <p class="hero-kicker">${escapeHtml(t("app.name"))}</p>
        <h1>${escapeHtml(t("how.title"))}</h1>
        <p class="hint">${escapeHtml(t("how.subtitle"))}</p>
      </div>
    </div>
    ${stepsBlock()}
    ${datasetsBlock(measured)}
    ${bannerBlock()}
    ${proofBlock(validation)}
    ${limitsBlock()}
    <p class="note how-ai-note reveal">${escapeHtml(t("how.ai_note"))}</p>
    <div class="how-cta reveal">
      <a class="action" href="#/">${escapeHtml(t("how.cta.tanks"))}</a>
      <a class="action" href="#/calendar">${escapeHtml(t("site.nav.calendar"))}</a>
    </div>`;
  animate(view);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) view.querySelectorAll("video").forEach((v) => { v.removeAttribute("autoplay"); v.pause(); });
  // "#/how-it-works/sources" and "#/how-it-works/credits" (footer and menu links) jump to their section
  const jump = location.hash.endsWith("/sources") ? "#sources" : null;
  if (jump) view.querySelector(jump)?.scrollIntoView();
}
