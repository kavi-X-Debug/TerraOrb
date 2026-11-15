// "Ask Monsoon Compass": a question-and-answer helper for farmers, on every page.
//
// It is NOT an AI that guesses. It works like this:
//   1. it looks for keywords in the question (Sinhala or English; the word lists are in si.json / en.json,
//      keys "assistant.kw.*", so they can be edited without touching this file),
//   2. it works out which tank you mean (the tank page you are on, or a name you type),
//   3. it answers ONLY from that tank's data files, always with the source and a link to the full page.
// If it does not understand, it says so and offers questions it can answer. It never makes up a number.
//
// Every end (farmer, learn, officer, research, plan) has its own list of topics with written answers (assistant-kb.js and
// web/strings/assistant.*.json). The words are matched with a spelling-tolerant ranking; when it is not sure, it offers the
// closest questions ("Did you mean...?"). Some answers fill in live numbers from the data files (tank counts, test results).
import { t, tBoth } from "./i18n.js";
import { escapeHtml, tankName, levelWord, date, num, capNames } from "./ui.js";
import { bestWindow, addDays } from "./calendar.js";
import { adviceSentence } from "./plan.js";
import { TOPICS, LINKS, rank } from "./assistant-kb.js";
import { loadValidation } from "./data.js";

const END = document.body?.dataset?.end || "farmer";          // which end this page belongs to
const TANK_FLOW = END === "farmer" || END === "officer";        // these ends also answer questions about a named tank

const CROPS = ["mung_bean", "cowpea", "black_gram", "maize", "groundnut", "soybean", "finger_millet", "sesame", "sweet_potato", "big_onion", "brinjal", "chilli", "pumpkin"];
const CHIPS = ["sow_now", "when", "rain", "water", "paddy", "sources"];

// ---- keyword helpers -------------------------------------------------------
// All words for a key, in both languages, lower-cased: "a|b|c" strings become one list.
const words = (key) => tBoth(key).flatMap((s) => s.split("|")).map((w) => w.trim().toLowerCase()).filter(Boolean);
const has = (q, key) => words(key).some((w) => q.includes(w));
const shortDate = (iso) => date(iso, { day: "numeric", month: "short" });

// Which crop does the question mention? (id or null)
function cropIn(q) {
  return CROPS.find((id) => [...words(`assistant.kw.crop.${id}`), ...tBoth(`crop.${id}`).map((s) => s.toLowerCase())]
    .some((w) => q.includes(w))) || null;
}

// Which intent is the question about? Order matters: more specific first.
function intentOf(q) {
  if (has(q, "assistant.kw.change")) return "change";
  if (has(q, "assistant.kw.thanks")) return "thanks";
  if (cropIn(q) && has(q, "assistant.kw.when")) return "when";
  if (has(q, "assistant.kw.paddy")) return "paddy";
  if (has(q, "assistant.kw.when")) return "when";
  if (cropIn(q)) return "when";                    // a crop was named: answer for that crop
  if (has(q, "assistant.kw.sow_now")) return "sow_now";
  if (has(q, "assistant.kw.rain")) return "rain";
  if (has(q, "assistant.kw.signal")) return "signal";
  if (has(q, "assistant.kw.sources")) return "sources";
  if ((has(q, "assistant.kw.greet") && q.length <= 30) || /^hi\b/.test(q)) return "greet";
  return null;
}

// ---- which tank? -----------------------------------------------------------
const GENERIC = new Set(["tank", "wewa", "weva", "lake", "kulam"]);
const KEY_SETS = ["when", "sow_now", "rain", "signal", "paddy", "sources", "greet", "change", "thanks", ...CROPS.map((c) => `crop.${c}`)];
const isKeyword = (tok) => KEY_SETS.some((k) => words(`assistant.kw.${k}`).some((w) => w.length >= 4 && (tok === w || w.startsWith(tok) || tok.startsWith(w))));

function tankMatches(q, tanks, hadIntent) {
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 4 && !GENERIC.has(x) && !isKeyword(x));
  const scored = [];
  for (const tank of tanks) {
    const names = [tank.name_en, tank.name_si].filter(Boolean).map((n) => n.toLowerCase());
    let score = 0;
    for (const n of names) {
      if (n.length >= 4 && !GENERIC.has(n) && q.includes(n)) score = Math.max(score, 3);          // whole name typed
      const parts = n.split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 4 && !GENERIC.has(p));
      if (tokens.some((tok) => parts.some((p) => p.startsWith(tok)))) score = Math.max(score, 2);  // "nuwara" → "Nuwara Wewa"
    }
    if (!hadIntent && !score && q.length >= 4 && names.some((n) => n.includes(q))) score = 1;
    if (score) scored.push({ tank, score });
  }
  const best = Math.max(0, ...scored.map((s) => s.score));
  return scored.filter((s) => s.score === best).map((s) => s.tank);
}

// ---- answers: each returns { text, src, link:{href,label} } -----------------
function answer(intent, q, tank) {
  const doc = tank.doc;
  const name = tankName(tank);
  const c = doc?.crops;
  const base = `#/tank/${encodeURIComponent(tank.id)}`;
  if (!doc) return { text: t("assistant.no_tank_data") };

  if (intent === "sow_now") {
    if (!c) return { text: t("assistant.no_tank_data") };
    const good = c.items.filter((i) => i.rating === "good").map((i) => t(`crop.${i.id}`));
    return {
      text: good.length ? t("assistant.a.sow_now.some", { tank: name, crops: capNames(good, 5) }) : t("assistant.a.sow_now.none", { tank: name }),
      src: t("assistant.src.crops"), link: { href: `${base}/crops`, label: t("assistant.link.crops") },
    };
  }
  if (intent === "when") {
    const id = cropIn(q);
    if (!c?.calendar) return { text: t("assistant.no_tank_data") };
    if (!id) return { text: t("assistant.a.when.ask"), crops: true };
    const w = bestWindow(c.calendar, id);
    const days = c.items.find((i) => i.id === id)?.duration_days || 0;
    return {
      text: w ? t("assistant.a.when", { crop: t(`crop.${id}`), tank: name, from: shortDate(w.from), to: shortDate(w.to), harvest: shortDate(addDays(w.from, days)) })
        : t("assistant.a.when.none", { crop: t(`crop.${id}`), tank: name }),
      src: t("assistant.src.crops"), link: { href: `#/calendar/${encodeURIComponent(tank.id)}`, label: t("assistant.link.calendar") },
    };
  }
  if (intent === "paddy") {
    const full = c?.items.find((i) => i.id === "paddy"), short = c?.items.find((i) => i.id === "paddy_short");
    if (!full || full.rating === "unknown") return { text: t("assistant.a.paddy.unknown", { tank: name }), src: t("assistant.src.water"), link: { href: `${base}/plan`, label: t("assistant.link.plan") } };
    return {
      text: t("assistant.a.paddy", { tank: name, full: t(`crops.rating.${full.rating}`).toLowerCase(), short: t(`crops.rating.${short.rating}`).toLowerCase(),
        signal: t(`signal.short.${doc.result?.signal || "none"}`).toLowerCase() }),
      src: t("assistant.src.crops"), link: { href: `${base}/crops`, label: t("assistant.link.crops") },
    };
  }
  if (intent === "signal") {
    const r = doc.result;
    if (!r || !r.signal) return { text: t("assistant.a.signal.none", { tank: name }), link: { href: `${base}/plan`, label: t("assistant.link.plan") } };
    let text = t("assistant.a.signal", { tank: name, signal: t(`signal.short.${r.signal}`) }) + " " + adviceSentence(r);
    const T = r.inputs?.T;
    if (T != null) text += " " + t("assistant.a.water", { level: levelWord(T).toLowerCase() });
    return { text, src: t("assistant.src.water"), link: { href: `${base}/plan`, label: t("assistant.link.plan") } };
  }
  if (intent === "rain") {
    const f = doc.forecast;
    if (!f?.days?.length) return { text: t("assistant.a.rain.none", { tank: name }) };
    let text = t("assistant.a.rain", { tank: name, days: f.rain_days, n: f.days.length, mm: num(f.total_mm, 0) });
    if (f.wettest_day) text += " " + t("assistant.a.rain.wettest", { date: shortDate(f.wettest_day), mm: num(f.wettest_mm, 0) });
    return { text, src: t("assistant.src.forecast"), link: { href: `${base}/weather`, label: t("assistant.link.weather") } };
  }
  return null;
}

// ---- topics (written answers per end) ---------------------------------------------
const kwOf = (id) => words(`ak.${id}.kw`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Live numbers that some answers need. Returns { vars, src } or { none: "key" } when the data is missing.
async function liveVars(id, state) {
  if (id === "officer_count") {
    const c = { red: 0, amber: 0, green: 0, none: 0 };
    let demo = 0;
    for (const tk of state.tanks) { c[tk.doc?.result?.signal || "none"] = (c[tk.doc?.result?.signal || "none"] || 0) + 1; if (tk.demo || tk.doc?.demo) demo++; }
    return { vars: { n: state.tanks.length, red: c.red, amber: c.amber, green: c.green, none: c.none, demo }, src: t("ak.src.data") };
  }
  if (id === "officer_list_red") {
    const red = state.tanks.filter((tk) => tk.doc?.result?.signal === "red").map((tk) => tankName(tk));
    if (!red.length) return { none: "ak.none_red", src: t("ak.src.data") };
    return { vars: { names: red.slice(0, 8).join(", ") + (red.length > 8 ? ` (+${red.length - 8})` : "") }, src: t("ak.src.data") };
  }
  if (["tests_summary", "crop_accuracy", "el_nino_result", "tank_model_result"].includes(id)) {
    let v = null;
    try { v = await loadValidation(); } catch { /* handled below */ }
    if (!v?.summary) return { none: "ak.no_validation" };
    const crops = (v.crops?.cells || []).flatMap((c) => Object.values(c.per_crop || {}));
    const acc = mean(crops.map((x) => x.accuracy).filter((x) => x != null)), guess = mean(crops.map((x) => x.accuracy_guessing).filter((x) => x != null));
    const tm = v.summary.tank_model || {}, en = v.summary.elnino || {};
    return {
      vars: { acc: acc == null ? "?" : Math.round(acc * 100), guess: guess == null ? "?" : Math.round(guess * 100), n: crops.length,
        hits: en.hits ?? "?", calls: en.calls ?? "?", verdict: tm.verdict || "", model: tm.mean_mae_model_pp ?? "?", base: tm.mean_mae_baseline_pp ?? "?", tested: tm.tanks_tested ?? "?" },
      src: t("ak.src.validation"),
    };
  }
  return { vars: {} };
}

// The answer message for one topic
async function topicAnswer(id, state) {
  const live = await liveVars(id, state);
  if (live.none) return { text: t(live.none), src: live.src };
  const msg = { text: t(`ak.${id}.a`, live.vars), src: live.src || t("ak.src.written") };
  if (LINKS[id]) msg.link = { href: LINKS[id], label: t("ak.open") };
  return msg;
}

// ---- the chat window ------------------------------------------------------------
export function initAssistant(state) {
  const el = document.createElement("div");
  el.className = "asst";
  el.innerHTML = `
    <button type="button" class="asst-fab" aria-haspopup="dialog" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="asst-fab-label"></span>
    </button>
    <section class="asst-panel" role="dialog" aria-modal="false" hidden>
      <header class="asst-head">
        <div><strong class="asst-title"></strong><span class="asst-ctx"></span></div>
        <button type="button" class="asst-close" aria-label=""><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="asst-log" aria-live="polite"></div>
      <div class="asst-chips"></div>
      <form class="asst-form" autocomplete="off">
        <input type="text" class="asst-input" maxlength="200">
        <button type="submit" class="asst-send"></button>
      </form>
    </section>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const fab = $(".asst-fab"), panel = $(".asst-panel"), log = $(".asst-log"), input = $(".asst-input");

  let ctx = null;            // the tank we are talking about
  let pending = null;        // a question waiting for the tank to be chosen
  let greeted = false;
  let lastRouteTank = null;

  const routeTank = () => {
    const m = location.hash.match(/^#\/(?:tank|calendar)\/([^/]+)/);
    return m ? state.tanks.find((x) => x.id === decodeURIComponent(m[1])) : null;
  };

  function labels() {
    $(".asst-fab-label").textContent = t("assistant.open");
    $(".asst-title").textContent = t("assistant.title");
    $(".asst-close").setAttribute("aria-label", t("assistant.close"));
    input.placeholder = t("assistant.placeholder");
    $(".asst-send").textContent = t("assistant.send");
    const chips = $(".asst-chips");
    chips.innerHTML = "";
    // the farmer end keeps its tank questions; every end also offers its own topics
    const chipTexts = [...(END === "farmer" ? CHIPS.map((k) => t(`assistant.chip.${k}`)) : []), ...TOPICS[END].slice(0, END === "farmer" ? 2 : 6).map((id) => t(`ak.${id}.q`))];
    chipTexts.forEach((text) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "asst-chip"; b.textContent = text;
      b.onclick = () => ask(text);
      chips.appendChild(b);
    });
    showCtx();
  }

  function showCtx() {
    const c = $(".asst-ctx");
    c.textContent = !TANK_FLOW ? "" : ctx ? t("assistant.tank_ctx", { name: tankName(ctx) }) : t("assistant.no_ctx");
  }

  function add(who, msg) {
    const row = document.createElement("div");
    row.className = `asst-msg ${who}`;
    const bubble = document.createElement("div");
    bubble.className = "asst-bubble";
    const p = document.createElement("p");
    p.textContent = typeof msg === "string" ? msg : msg.text;      // textContent: nothing typed by the user is ever run as HTML
    bubble.appendChild(p);
    if (typeof msg !== "string") {
      if (msg.src) { const s = document.createElement("p"); s.className = "asst-src"; s.textContent = t("assistant.source", { list: msg.src }); bubble.appendChild(s); }
      if (msg.link) { const a = document.createElement("a"); a.className = "asst-link"; a.href = msg.link.href; a.textContent = msg.link.label; a.onclick = () => { panel.hidden = true; fab.setAttribute("aria-expanded", "false"); }; bubble.appendChild(a); }
      (msg.options || []).forEach((o) => {                          // tank or crop choices
        const b = document.createElement("button");
        b.type = "button"; b.className = "asst-chip asst-option"; b.textContent = o.label; b.onclick = o.run;
        bubble.appendChild(b);
      });
    }
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function setTank(tank, announce = true) {
    ctx = tank;
    showCtx();
    if (announce) add("bot", t("assistant.tank_set", { name: tankName(tank) }));
  }

  // The main entry: one question in, one answer out.
  async function ask(text) {
    const q = text.trim().toLowerCase();
    if (!q) return;
    add("user", text.trim());
    const intent = intentOf(q);
    if (intent === "thanks") return add("bot", t("assistant.a.thanks"));
    if (intent === "change" && TANK_FLOW) { ctx = null; showCtx(); pending = null; return add("bot", t("assistant.pick_tank")); }

    // 1. A written topic for this end that clearly matches the question
    const ranked = rank(q, TOPICS[END], kwOf);
    const found = TANK_FLOW ? tankMatches(q, state.tanks, Boolean(intent)) : [];
    if (ranked.sure && !found.length) return add("bot", await topicAnswer(ranked.list[0].id, state));
    if (!TANK_FLOW) {
      if (intent === "greet") return add("bot", t(`ak.hello.${END}`));
      return suggest(ranked);
    }

    // 2. A tank named in the question? (farmer and officer ends)
    if (found.length > 6) return add("bot", t("assistant.tank_many"));
    if (found.length > 1) {
      return add("bot", { text: t("assistant.tank_which"), options: found.map((tk) => ({ label: tankName(tk), run: () => { setTank(tk, false); ask(`${tankName(tk)} ${pending || text}`); } })) });
    }
    if (found.length === 1) {
      setTank(found[0], !intent && !pending);
      if (!intent && pending) { const p = pending; pending = null; return ask2(p); }
      if (!intent) return;
    }
    if (intent === "greet") return add("bot", t("assistant.a.hello"));
    if (!intent) {
      if (ranked.list.length) return suggest(ranked);                                       // close to a written topic
      if (!found.length && q.length >= 4 && !/\s/.test(q)) return add("bot", t("assistant.tank_unknown", { q: text.trim() }));
      return suggest(ranked);
    }
    if (intent === "sources") return add("bot", { text: t("assistant.a.sources"), link: { href: "#/how-it-works", label: t("assistant.link.how") } });
    respond(intent, q);
  }

  // Re-run a saved question once a tank is known (no echo of the user's bubble)
  function ask2(saved) {
    const q = saved.toLowerCase();
    const intent = intentOf(q);
    if (intent && intent !== "sources") respond(intent, q);
  }

  // Not sure: offer the closest questions (or the first few of this end) instead of guessing
  function suggest(ranked) {
    const ids = ranked.list.length ? ranked.list.slice(0, 3).map((x) => x.id) : TOPICS[END].slice(0, 4);
    add("bot", {
      text: ranked.list.length ? t("ak.did_you_mean") : t("ak.fallback"),
      options: ids.map((id) => ({ label: t(`ak.${id}.q`), run: async () => { add("user", t(`ak.${id}.q`)); add("bot", await topicAnswer(id, state)); } })),
    });
  }

  function respond(intent, q) {
    if (!ctx) { pending = q; return add("bot", t("assistant.pick_tank")); }
    const res = answer(intent, q, ctx);
    if (!res) return add("bot", t("assistant.a.fallback"));
    if (res.crops) res.options = CROPS.map((id) => ({ label: t(`crop.${id}`), run: () => ask(t("assistant.q.when_crop", { crop: t(`crop.${id}`) })) }));
    add("bot", res);
  }

  function open() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    const rt = routeTank();
    if (rt && rt.id !== lastRouteTank) { lastRouteTank = rt.id; ctx = rt; showCtx(); }
    if (!greeted) {
      greeted = true;
      add("bot", { text: `${t(`ak.hello.${END}`)} ${t("assistant.about")}`, link: { href: "#/how-it-works", label: t("assistant.link.how") } });
      if (TANK_FLOW && END === "farmer" && !ctx) add("bot", t("assistant.pick_tank"));
    }
    input.focus();
  }

  fab.onclick = () => (panel.hidden ? open() : ((panel.hidden = true), fab.setAttribute("aria-expanded", "false")));
  $(".asst-close").onclick = () => { panel.hidden = true; fab.setAttribute("aria-expanded", "false"); fab.focus(); };
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) $(".asst-close").click(); });
  $(".asst-form").onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ""; ask(v); };
  window.addEventListener("hashchange", () => { const rt = routeTank(); if (rt && rt.id !== lastRouteTank) { lastRouteTank = rt.id; ctx = rt; showCtx(); } });
  document.addEventListener("mc-lang", labels);       // main.js fires this when the language changes
  labels();
  const rt = routeTank();
  if (rt) { lastRouteTank = rt.id; ctx = rt; showCtx(); }
}
