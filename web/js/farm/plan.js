// Farm planner, screen "My crop plan": three rotation cards (baseline, soil-building, water-saving) with a crop list
// per zone and season, plain-words reasons, a confidence badge, a "what if the rain changes" slider and the rule trace.
// Spec: docs/farm-spec.md sections 5.1 and 7.
//
// Honesty rules kept here: this is a suggestion to discuss with an Agriculture Instructor, never a certainty;
// the scenario slider is a stress test built from past variability, NOT a forecast; the confidence weights and
// cut-offs are drafts; crops removed by the rules can be seen with the reason; nothing is filled in when the server has no plan.
import { t as tGlobal, getLang } from "../i18n.js";
import { fpEl, fpCall, fpNote, fpFail, fpEnsureCss } from "./zones.js";

let t0 = tGlobal;   // the translator of the screen being drawn (for small helpers outside it)
const OPT_KEYS = { 1: "baseline", 2: "soil", 3: "water" };
const CONF_CLASSES = ["high", "medium", "low"];

// The plan answer may come as { options: [...] }, { cards: [...] } or a bare list; one stored plan may wrap it in { plan, options }.
function optionsOf(d) {
  if (!d) return [];
  const list = Array.isArray(d) ? d : d.options || d.cards || (d.plan && (d.plan.options || d.plan.cards)) || [];
  return list.map((o, i) => ({ ...o, option_no: o.option_no || i + 1 }));
}

// Display name of a crop cell or an excluded crop, in the chosen language (falls back to English, then the id).
const nameOf = (x) => (getLang() === "si" && x.name_si) || x.name_en || (x.crop_id ? String(x.crop_id).replaceAll("_", " ") : "");

// Crop rows { season, zone, crop } from the engine card: card.seasons = [{season, zones: [cell]}], card.permanent = [cell] (hedges).
// A cell with no crop_id means no crop passed the rules for that part and season: it is shown as "bare", never filled in.
export function cropRows(opt) {
  const rows = [];
  for (const s of opt.seasons || []) for (const c of s.zones || []) rows.push({ season: s.season, zone: c.zone_kind, crop: c.crop_id ? nameOf(c) : null, role: c.role, evidence: c.evidence });
  for (const c of opt.permanent || []) rows.push({ season: "perennial", zone: c.zone_kind, crop: nameOf(c), role: c.role, evidence: c.evidence });
  return rows;
}

// The engine returns explanation items as { text_key, params }; the app turns them into plain words.
// Parameters are made readable first (crop ids become names, zone kinds become words). If a key has no text yet,
// it is shown as plain readable text, never hidden.
function prepParams(t, params, names) {
  const p = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === "crop") p[k] = names.get(v) || String(v).replaceAll("_", " ");
    else if (k === "zone_kind" || k === "zone") { const s = t(`farmplan.kind.${v}`); p[k] = s === `farmplan.kind.${v}` ? v : s; }
    else if (k === "role") { const s = t(`farmplan.role.${v}`); p[k] = s === `farmplan.role.${v}` ? String(v).replaceAll("_", " ") : s; }
    else if (k === "tests") p[k] = (Array.isArray(v) ? v : []).map((x) => (typeof x === "object" ? x.test : x)).filter(Boolean).join(", ") || "-";
    else if (Array.isArray(v)) p[k] = v.map((x) => (typeof x === "object" ? "" : x)).filter(Boolean).join(", ");
    else if (v !== null && typeof v === "object") p[k] = "";
    else p[k] = String(v);
  }
  p.detail = Object.values(p).filter(Boolean).join(", ");
  return p;
}
function explainText(t, item, names = new Map()) {
  if (item === null || item === undefined) return "";
  if (typeof item === "string") return textForKey(t, item, {});
  const key = item.text_key || item.key || item.rule;
  if (!key) return typeof item.text === "string" ? item.text : "";
  return textForKey(t, key, prepParams(t, item.params, names));
}
function textForKey(t, key, params) {
  const s = t(`farmplan.x.${key}`, params);
  if (s !== `farmplan.x.${key}`) return s;
  const plain = Object.entries(params).filter(([k, v]) => k !== "detail" && v).map(([k, v]) => `${k} ${v}`).join(", ");
  return `${String(key).replace(/^.*\./, "").replaceAll("_", " ")}${plain ? ` (${plain})` : ""}`;
}
const seasonLabel = (s) => { if (!s) return t0("farmplan.plan.season"); const k = `farmplan.season.${String(s).toLowerCase()}`; const v = t0(k); return v === k ? s : v; };
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export async function renderPlan(ctx, farmId, view) {
  fpEnsureCss();
  const root = view || ctx.view;
  const t = ctx.t || tGlobal;
  t0 = t;
  const id = farmId ?? ctx.farm?.id;
  root.innerHTML = "";
  const page = fpEl("div", { class: "fp-page" });
  root.append(page);
  page.append(
    fpEl("h2", {}, t("farmplan.plan.title")),
    fpEl("p", { class: "fp-lead" }, t("farmplan.plan.lead")),
    fpNote("info", t("farmplan.plan.disclaimer")),
  );

  const st = { rainPct: 0, delay: 0, timer: null, seq: 0, plan: null, last: null };
  const controls = fpEl("div", { class: "fp-card" });
  const out = fpEl("div", { class: "fp-stack", "aria-live": "polite" });
  page.append(controls, out);

  // --- scenario controls ----------------------------------------------------
  const rainOut = fpEl("output", { class: "fp-bignum" });
  const delayOut = fpEl("output", { class: "fp-bignum" });
  const rain = fpEl("input", { type: "range", min: "-30", max: "30", step: "5", value: "0", "aria-label": t("farmplan.scn.rain") });
  const delay = fpEl("input", { type: "range", min: "0", max: "30", step: "5", value: "0", "aria-label": t("farmplan.scn.delay") });
  const fmtRain = () => (st.rainPct === 0 ? t("farmplan.scn.usual") : t(st.rainPct < 0 ? "farmplan.scn.drier" : "farmplan.scn.wetter", { n: Math.abs(st.rainPct) }));
  const fmtDelay = () => (st.delay === 0 ? t("farmplan.scn.ontime") : t("farmplan.scn.later", { n: st.delay }));
  const sync = () => { rainOut.textContent = fmtRain(); delayOut.textContent = fmtDelay(); };
  const rerun = () => { sync(); clearTimeout(st.timer); st.timer = setTimeout(() => run(true), 350); };   // live re-run, debounced
  rain.addEventListener("input", () => { st.rainPct = Number(rain.value); rerun(); });
  delay.addEventListener("input", () => { st.delay = Number(delay.value); rerun(); });
  const runBtn = fpEl("button", { class: "fp-btn", type: "button" }, t("farmplan.plan.make"));
  runBtn.addEventListener("click", () => run(false));
  const reset = fpEl("button", { class: "fp-btn fp-btn-2", type: "button" }, t("farmplan.scn.reset"));
  reset.addEventListener("click", () => { rain.value = "0"; delay.value = "0"; st.rainPct = 0; st.delay = 0; sync(); run(false); });
  controls.append(
    fpEl("h3", {}, t("farmplan.scn.title")),
    fpEl("label", { class: "fp-field" }, t("farmplan.scn.rain"), rain, rainOut),
    fpEl("label", { class: "fp-field" }, t("farmplan.scn.delay"), delay, delayOut),
    fpNote("warn", t("farmplan.scn.notforecast")),
    fpEl("p", { class: "fp-small" }, t("farmplan.scn.delay_note")),
    fpEl("div", { class: "fp-row" }, runBtn, reset),
  );
  sync();

  // --- run the engine (the newest answer wins if the slider is moved quickly) ---
  async function run(isScenario) {
    const my = ++st.seq;
    out.replaceChildren(fpEl("p", {}, t("farmplan.loading")));
    const scenario = { rain_factor: Math.round((1 + st.rainPct / 100) * 100) / 100, onset_delay_days: st.delay };
    const r = await fpCall("POST", `/farms/${id}/plan`, isScenario || st.rainPct || st.delay ? { scenario } : {});
    if (my !== st.seq) return;
    draw(r, st.rainPct !== 0 || st.delay !== 0);
  }

  let names = new Map();   // crop id -> display name, filled from each answer (used to make the explanation words readable)

  function draw(r, scenarioOn) {
    out.replaceChildren();
    if (!r.ok) {
      out.append(fpFail(t, r));
      if (r.status === 404 || r.status === 422) out.append(fpNote("info", t("farmplan.plan.needs_zones")));
      return;
    }
    const opts = optionsOf(r.data);
    if (!opts.length) { out.append(fpNote("info", t("farmplan.plan.empty"))); return; }
    const removed = (r.data && r.data.excluded) || [];
    names = new Map();
    for (const o of opts) for (const x of [...(o.seasons || []).flatMap((s) => s.zones || []), ...(o.permanent || [])]) if (x.crop_id) names.set(x.crop_id, nameOf(x));
    for (const x of removed) names.set(x.crop_id, nameOf(x));
    if (r.data && asList(r.data.inputs_missing).length) out.append(fpNote("warn", t("farmplan.plan.missing", { list: asList(r.data.inputs_missing).join(", ") })));
    if (scenarioOn) out.append(fpNote("warn", t("farmplan.scn.showing", { rain: fmtRain(), delay: fmtDelay() })));
    const grid = fpEl("div", { class: "fp-cards" });
    for (const o of opts) grid.append(card(o));
    out.append(grid);
    if (removed.length) out.append(whyNot(removed));
    out.append(fpEl("p", { class: "fp-small" }, t("farmplan.plan.sources")));
  }

  // --- one rotation card ----------------------------------------------------
  function card(o) {
    const key = OPT_KEYS[o.option_no];
    const c = fpEl("article", { class: "fp-card fp-plan" }, fpEl("h3", {}, key ? t(`farmplan.opt.${key}`) : o.key), fpEl("p", { class: "fp-small" }, key ? t(`farmplan.opt.${key}_hint`) : ""));
    c.append(confidence(o.confidence, o));
    // crop list per season, with the zone each crop is for
    const rows = cropRows(o);
    if (rows.length) {
      const bySeason = new Map();
      for (const x of rows) { if (!bySeason.has(x.season)) bySeason.set(x.season, []); bySeason.get(x.season).push(x); }
      for (const [season, list] of bySeason) {
        const ul = fpEl("ul", { class: "fp-list" });
        for (const x of list) {
          const zk = t(`farmplan.kind.${x.zone}`);
          ul.append(fpEl("li", {}, x.zone ? fpEl("span", { class: "fp-zone" }, zk === `farmplan.kind.${x.zone}` ? String(x.zone) : zk) : "", " ",
            x.crop ? fpEl("strong", {}, x.crop) : fpEl("em", {}, t("farmplan.plan.bare")), x.evidence ? fpEl("em", { class: "fp-tag fp-tag-model" }, x.evidence) : ""));
        }
        c.append(fpEl("h4", {}, seasonLabel(season)), ul);
      }
    } else c.append(fpNote("info", t("farmplan.plan.nocrops")));
    const block = (titleKey, items) => { if (items.length) c.append(fpEl("h4", {}, t(titleKey)), fpEl("ul", { class: "fp-list" }, ...items.map((w) => fpEl("li", {}, w)))); };
    block("farmplan.plan.why", asList(o.why).map((x) => explainText(t, x, names)).filter(Boolean));
    // benefits: average draft rating (0 to 3) of the chosen crops from the crop table, shown as a number, not a promise
    const ben = Object.entries(o.benefits || {}).filter(([, v]) => typeof v === "number");
    if (ben.length) c.append(fpEl("h4", {}, t("farmplan.plan.benefits")), fpEl("ul", { class: "fp-list" }, ...ben.map(([k, v]) => fpEl("li", {}, `${t(`farmplan.ben.${k}`)}: ${v} / 3`))), fpEl("p", { class: "fp-small" }, t("farmplan.plan.benefits_note")));
    block("farmplan.plan.gaps", asList(o.gaps).map((x) => explainText(t, x, names)).filter(Boolean));
    block("farmplan.plan.risks", asList(o.risks_for_review || o.risks).map((x) => explainText(t, x, names)).filter(Boolean));
    const levels = asList(o.evidence_levels);
    if (levels.length) c.append(fpEl("p", { class: "fp-small" }, t("farmplan.plan.evidence"), " ", levels.join(", ")));
    if (o.needs_officer) c.append(fpNote("warn", t("farmplan.plan.officer")));
    c.append(trace(o));
    return c;
  }

  // confidence: a badge with a plain reason; the number only inside the details
  function confidence(cf, o) {
    const score = typeof cf === "number" ? cf : cf?.score ?? o.confidence_score;
    let cls = typeof cf === "object" && cf ? cf.class || cf.level : o.confidence_class;
    if (!CONF_CLASSES.includes(cls)) cls = typeof score === "number" ? (score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low") : null;
    if (!cls) return fpNote("info", t("farmplan.conf.unknown"));
    const det = fpEl("details", { class: "fp-details" }, fpEl("summary", {}, t("farmplan.conf.how")),
      fpEl("p", { class: "fp-small" }, t("farmplan.conf.formula")),
      typeof score === "number" ? fpEl("p", { class: "fp-small" }, t("farmplan.conf.score", { score: score.toFixed(2) })) : "");
    return fpEl("div", { class: `fp-conf fp-conf-${cls}` }, fpEl("strong", {}, t(`farmplan.conf.${cls}`)), fpEl("span", {}, t(`farmplan.conf.${cls}_reason`)), det);
  }

  // "show the rules": every decision the engine recorded, so a person or an officer can check it
  function trace(o) {
    const list = asList(o.trace || o.rule_trace);
    const d = fpEl("details", { class: "fp-details" }, fpEl("summary", {}, t("farmplan.trace.show")));
    if (!list.length) { d.append(fpEl("p", { class: "fp-small" }, t("farmplan.trace.none"))); return d; }
    d.append(fpEl("p", { class: "fp-small" }, t("farmplan.trace.help")));
    const ol = fpEl("ol", { class: "fp-trace" });
    for (const x of list) {
      ol.append(fpEl("li", {}, fpEl("code", {}, x.text_key || x.rule || ""), ": ", explainText(t, x, names), " ",
        x.zone !== null && x.zone !== undefined ? fpEl("em", { class: "fp-tag" }, `${t("farmplan.trace.zone")} ${x.zone}`) : "",
        x.season ? fpEl("em", { class: "fp-tag" }, x.season) : "",
        x.evidence ? fpEl("em", { class: "fp-tag fp-tag-model" }, `${t("farmplan.trace.evidence")} ${x.evidence}`) : ""));
    }
    d.append(ol);
    return d;
  }

  // Crops the rules removed, once per crop, with the failed tests (for example no cold season for saffron).
  function whyNot(removed) {
    const d = fpEl("details", { class: "fp-details fp-card" }, fpEl("summary", {}, t("farmplan.plan.whynot")), fpEl("p", { class: "fp-small" }, t("farmplan.plan.whynot_help")));
    const byCrop = new Map();
    for (const x of removed) {
      const e = byCrop.get(x.crop_id) || { name: nameOf(x), reasons: new Set() };
      for (const f of x.failed || []) {
        const label = t(`farmplan.test.${f.test}`);
        e.reasons.add(f.reason_key ? textForKey(t, f.reason_key, {}) : `${label === `farmplan.test.${f.test}` ? f.test : label} (${typeof f.value === "boolean" ? t(f.value ? "farmplan.yes" : "farmplan.no") : f.value}; ${t("farmplan.plan.needs")} ${Array.isArray(f.range) ? f.range.join(" - ") : f.range})`);
      }
      byCrop.set(x.crop_id, e);
    }
    const ul = fpEl("ul", { class: "fp-list" });
    for (const e of byCrop.values()) ul.append(fpEl("li", {}, fpEl("strong", {}, e.name), ": ", [...e.reasons].join("; ")));
    d.append(ul);
    return d;
  }

  // First look: show the last stored plan if there is one, otherwise invite the person to make one.
  const first = await fpCall("GET", `/farms/${id}/plan/latest`);
  if (first.ok && optionsOf(first.data).length) draw(first, false);
  else if (first.offline) out.append(fpFail(t, first));
  else out.append(fpNote("info", t("farmplan.plan.nonestored")));
}
