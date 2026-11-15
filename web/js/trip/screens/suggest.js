// Trip planner: Smart destination suggestions (#/plan/suggest).
// The visitor says when, how long and what they like; every destination gets a planning score
//   S = 0.40 W + 0.25 A + 0.20 P + 0.15 E   (W weather, A activities, P preferences, E environment; weights come from the settings)
// from scoring.js, and the best are listed with the reasons. Days inside the 16-day forecast use the Open-Meteo forecast (not NASA);
// days beyond it use the NASA POWER historical tendency and are labelled as a tendency, never as a forecast.
// runSuggestions() is also used by the dashboard (top 3).
import { loadForecasts, hoursOf, dayKind } from "../forecast.js";
import { tendencyFor } from "../history.js";
import { summariseDay, INTENSITY } from "../intensity.js";
import { destinationScore } from "../scoring.js";
import { ACTIVITIES, recommendActivities } from "../activities.js";
import { todayStr, addDays, dateRange, isDate, loadPrefs, keepPrefs, reasonText, interestChips, addToTrip } from "./explore.js";

// ctx.ui has the element helpers; the text function t comes from ctx.t, so both are handed out together.
const U = (ctx) => ({ ...ctx.ui, t: ctx.t });

const nums = (a) => a.filter((x) => typeof x === "number" && Number.isFinite(x));
const mean = (a) => { const n = nums(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; };
const maxOf = (a) => { const n = nums(a); return n.length ? Math.max(...n) : null; };
const minOf = (a) => { const n = nums(a); return n.length ? Math.min(...n) : null; };
const envFor = (data, id) => data.env?.destinations?.[id] ?? data.env?.[id] ?? null;

// Ranks the destinations for a set of days. Returns { rows (best first), skipped (places with no weather data at all), days, kinds }.
// inputs = { region, start, durationDays, prefs }
export async function runSuggestions(ctx, inputs) {
  const { data, cfg } = ctx;
  const { region, start, durationDays, prefs } = inputs;
  const today = todayStr();
  const days = dateRange(start, durationDays);
  const kinds = days.map((d) => dayKind(d, today, cfg));
  const pool = data.destinations.filter((d) => !region || d.region === region);
  const fcMap = kinds.includes("forecast") && pool.length ? await loadForecasts(pool) : new Map();
  const rows = []; let skipped = 0;
  for (const dest of pool) {
    const per = [];
    days.forEach((date, i) => {
      if (kinds[i] === "forecast") {
        const fc = fcMap.get(dest.id);
        if (!fc || !fc.ok) return;
        const hours = hoursOf(fc, date);
        if (!hours.some((r) => r && r.mm !== null && r.mm !== undefined)) return;
        const s = summariseDay(hours, cfg);
        per.push({ date, kind: "forecast", hours, summary: s, mm: s.totalMm, chance: s.maxChance, hourMax: s.maxHourMm, maxClass: s.maxClass, wetHours: s.wetHours,
          duration: s.durationHours, temp: s.avgTemp, tmax: s.maxTemp, tmin: s.minTemp, wind: s.avgWind, gust: s.maxGust, stale: !!fc.stale });
      } else {
        const tn = data.history ? tendencyFor(data.history, dest.cell, date) : null;
        if (!tn) return;
        const month = Number(date.slice(5, 7)) - 1;
        const tmax = data.history?.cells?.[dest.cell]?.tmax_c_monthly?.[month] ?? null;
        per.push({ date, kind: "tendency", mm: tn.meanMm, chance: tn.pWet === null || tn.pWet === undefined ? null : tn.pWet * 100, hourMax: null, maxClass: null, wetHours: null,
          duration: null, temp: null, tmax, tmin: null, wind: null, gust: null });
      }
    });
    if (!per.length) { skipped++; continue; }
    const fcDays = per.filter((p) => p.kind === "forecast"), tnDays = per.filter((p) => p.kind === "tendency");
    // One "typical day" summary for the whole stay, in the same shape scoring.js expects for a forecast day.
    const worst = fcDays.map((p) => p.maxClass).filter(Boolean).sort((a, b) => (INTENSITY[b]?.rank ?? 0) - (INTENSITY[a]?.rank ?? 0))[0] || null;
    const summary = { totalMm: mean(per.map((p) => p.mm)), maxHourMm: maxOf(per.map((p) => p.hourMax)), maxClass: worst, wetHours: mean(per.map((p) => p.wetHours)),
      durationHours: mean(per.map((p) => p.duration)), firstWetHour: null, lastWetHour: null, maxChance: mean(per.map((p) => p.chance)),
      avgTemp: mean(per.map((p) => p.temp)) ?? mean(per.map((p) => p.tmax)), maxTemp: maxOf(per.map((p) => p.tmax)), minTemp: minOf(per.map((p) => p.tmin)),
      avgHumidity: null, avgWind: mean(per.map((p) => p.wind)), maxGust: maxOf(per.map((p) => p.gust)), byPeriod: {}, goodWindows: [] };
    let score;
    try { score = destinationScore({ dest, summary, prefs, env: envFor(data, dest.id), cfg }); } catch (e) { console.error(e); skipped++; continue; }
    rows.push({ dest, S: score.S, W: score.W, A: score.A, P: score.P, E: score.E, reasons: score.reasons || [],
      dataKind: fcDays.length && tnDays.length ? "mixed" : fcDays.length ? "forecast" : "tendency",
      period: { fa: fcDays[0]?.date, fb: fcDays.at(-1)?.date, ta: tnDays[0]?.date, tb: tnDays.at(-1)?.date },
      usedDays: per.length, totalDays: days.length, stale: fcDays.some((p) => p.stale),
      rainTotal: nums(per.map((p) => p.mm)).reduce((s, x) => s + x, 0), rainPerDay: summary.totalMm, chance: summary.maxChance, temp: summary.avgTemp ?? summary.maxTemp,
      first: fcDays[0] || null });
  }
  rows.sort((a, b) => (b.S ?? -1) - (a.S ?? -1));
  return { rows, skipped, days, kinds };
}

// Up to three activities that suit the first forecast day of a result (or, with no forecast, nothing: the caller says so).
export function suitableActivities(ctx, row, prefs) {
  if (!row.first) return null;
  try {
    return (recommendActivities({ dest: row.dest, hours: row.first.hours, summary: row.first.summary, interests: prefs.interests, durationDays: row.totalDays, cfg: ctx.cfg }) || [])
      .filter((r) => r.suitable).slice(0, 3);
  } catch (e) { console.error(e); return null; }
}

export function periodText(ctx, row) {
  const { t, fmtDate } = U(ctx); const p = row.period;
  if (row.dataKind === "forecast") return t("tripb.s.period_forecast", { from: fmtDate(p.fa), to: fmtDate(p.fb) });
  if (row.dataKind === "tendency") return t("tripb.s.period_tendency", { from: fmtDate(p.ta), to: fmtDate(p.tb) });
  return t("tripb.s.period_mixed", { fa: fmtDate(p.fa), fb: fmtDate(p.fb), ta: fmtDate(p.ta), tb: fmtDate(p.tb) });
}
export function kindBadges(ctx, row) {
  return [row.dataKind !== "tendency" ? ctx.ui.badge("forecast") : null, row.dataKind !== "forecast" ? ctx.ui.badge("tendency") : null];
}

const PARTS = [["weather", "W"], ["activity", "A"], ["preference", "P"], ["environment", "E"]];
const pct = (x) => Math.round(Math.max(0, Math.min(100, x ?? 0)));

function scoreBars(ctx, row) {
  const { h, t } = U(ctx);
  const w = ctx.cfg.weights; const total = PARTS.reduce((s, [k]) => s + (w[k] || 0), 0) || 1;
  const box = h("div", { class: "tb-bars" });
  for (const [k, L] of PARTS) {
    const v = row[L];
    box.append(h("div", { class: "tb-bar" },
      h("span", { class: "tb-bar-l", text: `${t(`tripb.s.part.${k}`)} (${Math.round(((w[k] || 0) / total) * 100)}%)` }),
      h("span", { class: "tb-bar-t", role: "img", "aria-label": `${t(`tripb.s.part.${k}`)}: ${v === null || v === undefined ? t("tripb.na") : pct(v)} / 100` }, h("i", { style: `width:${v === null || v === undefined ? 0 : pct(v)}%` })),
      h("span", { class: "tb-bar-v", text: v === null || v === undefined ? "–" : String(pct(v)) })));
  }
  return box;
}

export function resultCard(ctx, row, rank, prefs, startDate) {
  const { h, t, destName, fmtMm, fmtTemp, fmtPct } = U(ctx);
  const acts = row.dataKind === "tendency" ? null : suitableActivities(ctx, row, prefs);
  const overLimit = prefs.maxRainMm !== null && prefs.maxRainMm !== undefined && row.rainPerDay !== null && row.rainPerDay > prefs.maxRainMm;
  const own = (row.dest.activities || []).filter((a) => ACTIVITIES[a] && (!prefs.interests.length || prefs.interests.includes(a))).slice(0, 4);
  return h("article", { class: "tb-result tp-card" },
    h("header", { class: "tb-rhead" },
      h("div", {}, h("h3", {}, h("span", { class: "tb-rank", text: `${rank}. ` }), h("a", { href: `#/plan/explore/${row.dest.id}/${startDate}`, text: destName(row.dest) })),
        h("p", { class: "tb-sub", text: [row.dest.region, row.dest.cost_level ? t("tripb.s.cost", { level: t(`tripb.cost.${row.dest.cost_level}`) }) : null].filter(Boolean).join(" · ") })),
      h("div", { class: "tb-score", "aria-label": t("tripb.s.score_aria", { n: pct(row.S) }) }, h("strong", { text: String(pct(row.S)) }), h("span", { text: "/100" }))),
    h("p", { class: "tb-badges" }, ...kindBadges(ctx, row)),
    h("p", { class: "tb-sub", text: periodText(ctx, row) }),
    row.stale ? h("p", { class: "tb-stale", text: t("tripb.s.stale") }) : null,
    row.usedDays < row.totalDays ? h("p", { class: "tb-note", text: t("tripb.s.partial", { n: row.usedDays, total: row.totalDays }) }) : null,
    h("dl", { class: "tb-facts" },
      h("div", {}, h("dt", { text: t("tripb.s.rain_total") }), h("dd", { text: `${fmtMm(row.rainTotal)} (${fmtMm(row.rainPerDay)} ${t("tripb.s.per_day")})` })),
      h("div", {}, h("dt", { text: t("tripb.s.chance") }), h("dd", { text: fmtPct(row.chance) })),
      h("div", {}, h("dt", { text: t("tripb.s.temp") }), h("dd", { text: fmtTemp(row.temp) })),
      h("div", {}, h("dt", { text: t("tripb.s.weather_score") }), h("dd", { text: row.W === null || row.W === undefined ? "–" : `${pct(row.W)}/100` }))),
    overLimit ? h("p", { class: "tb-warnline", role: "status", text: t("tripb.s.over_limit", { limit: prefs.maxRainMm }) }) : null,
    scoreBars(ctx, row),
    h("div", { class: "tb-suit" }, h("strong", { text: t("tripb.s.activities") }),
      acts === null ? h("p", { class: "tb-sub", text: t("tripb.s.acts_need_forecast") }) : null,
      acts && acts.length ? h("ul", { class: "tb-taglist" }, acts.map((a) => h("li", { text: t(ACTIVITIES[a.id]?.key || `trip.act.${a.id}`) }))) : null,
      acts && !acts.length ? h("p", { class: "tb-sub", text: t("tripb.s.acts_none") }) : null,
      acts === null && own.length ? h("ul", { class: "tb-taglist" }, own.map((a) => h("li", { text: t(ACTIVITIES[a].key) }))) : null),
    row.reasons.length ? h("div", {}, h("strong", { text: t("tripb.s.why") }), h("ul", { class: "tb-reasons" }, row.reasons.map((r) => h("li", { text: reasonText(t, r) })))) : null,
    h("div", { class: "tb-actions" },
      h("button", { type: "button", class: "tp-btn primary", text: t("tripb.s.add"), onclick: () => addToTrip(ctx, row.dest, { date: startDate }) }),
      h("a", { class: "tp-btn tb-btnlink", href: `#/plan/dates/${row.dest.id}`, text: t("tripb.s.best_dates") })));
}

// ---------- the screen ----------
let run = 0;

export async function renderSuggest(ctx, parts, view) {
  ctx.ui.ensureCss("trip-b");
  const { h, t } = U(ctx);
  const dests = ctx.data.destinations;
  if (!dests.length) { view.replaceChildren(h("h1", { text: t("tripb.suggest.title") }), h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t("tripb.no_destinations") }))); return; }
  const prefs = loadPrefs();
  const regions = [...new Set(dests.map((d) => d.region).filter(Boolean))].sort();
  const opt = (v, label, cur) => h("option", { value: v, text: label, selected: String(cur ?? "") === String(v) ? true : null });

  const country = h("select", { id: "tb-s-country" }, h("option", { value: "LK", text: t("tripb.country.lk") }));
  const region = h("select", { id: "tb-s-region" }, opt("", t("tripb.explore.all_regions"), prefs.region), regions.map((r) => opt(r, r, prefs.region)));
  const startIn = h("input", { type: "date", id: "tb-s-start", value: isDate(parts[0]) ? parts[0] : todayStr(), min: todayStr(), max: addDays(todayStr(), 366), required: true });
  const dur = h("select", { id: "tb-s-dur" }, Array.from({ length: 14 }, (_, i) => opt(i + 1, t("tripb.s.days", { n: i + 1 }), 3)));
  const budget = h("select", { id: "tb-s-budget" }, opt("", t("tripb.s.budget.any"), prefs.budget), [1, 2, 3].map((n) => opt(n, t(`tripb.cost.${n}`), prefs.budget)));
  const temp = h("select", { id: "tb-s-temp" }, ["any", "cool", "mild", "warm"].map((k) => opt(k, t(`tripb.s.temp.${k}`), prefs.preferredTemp)));
  const style = h("select", { id: "tb-s-style" }, ["relaxed", "balanced", "adventurous"].map((k) => opt(k, t(`tripb.s.style.${k}`), prefs.style)));
  const rain = h("input", { type: "number", id: "tb-s-rain", min: "0", max: "200", step: "0.5", inputmode: "decimal", placeholder: t("tripb.s.rain_ph"), value: prefs.maxRainMm ?? "" });
  let interests = [...prefs.interests];
  const field = (id, label, el, hint) => h("label", { class: "tp-field", for: id }, h("span", { text: label }), el, hint ? h("small", { class: "tb-hint", text: hint }) : null);

  const out = h("div", { class: "tb-results", id: "tb-results", "aria-live": "polite" });
  const form = h("form", { class: "tb-sform tp-card", novalidate: true },
    h("div", { class: "tb-formgrid" },
      field("tb-s-country", t("tripb.s.country"), country, t("tripb.s.country_hint")), field("tb-s-region", t("tripb.s.region"), region),
      field("tb-s-start", t("tripb.s.start"), startIn), field("tb-s-dur", t("tripb.s.duration"), dur),
      field("tb-s-budget", t("tripb.s.budget"), budget, t("tripb.s.budget_hint")), field("tb-s-temp", t("tripb.s.pref_temp"), temp),
      field("tb-s-rain", t("tripb.s.max_rain"), rain, t("tripb.s.max_rain_hint")), field("tb-s-style", t("tripb.s.style"), style)),
    h("div", {}, h("p", { class: "tb-label", id: "tb-s-int", text: t("tripb.interests") }), interestChips(ctx, interests, (l) => { interests = l; })),
    h("button", { type: "submit", class: "tp-btn primary", text: t("tripb.s.go") }));

  const weights = ctx.cfg.weights;
  const wtotal = PARTS.reduce((s, [k]) => s + (weights[k] || 0), 0) || 1;
  const how = h("details", { class: "tb-how tp-card" }, h("summary", { text: t("tripb.s.how") }),
    h("p", { class: "tb-formula", text: t("tripb.s.formula", Object.fromEntries(PARTS.map(([k, L]) => [L.toLowerCase(), (Math.round(((weights[k] || 0) / wtotal) * 100) / 100).toFixed(2)]))) }),
    h("ul", {}, PARTS.map(([k, L]) => h("li", {}, h("strong", { text: `${L} · ${t(`tripb.s.part.${k}`)} (${Math.round(((weights[k] || 0) / wtotal) * 100)}%)` }), ` ${t(`tripb.s.part.${k}.what`)}`))),
    h("p", { class: "tb-note", text: t("trip.score_note") }));

  view.replaceChildren(h("h1", { text: t("tripb.suggest.title") }), h("p", { class: "tb-lead", text: t("tripb.suggest.lead") }), form, how, out,
    h("p", { class: "tb-fine", text: t("trip.disclaimer") }));

  async function go(ev) {
    if (ev) ev.preventDefault();
    if (!isDate(startIn.value)) { ctx.ui.toast("tripb.s.bad_start", "warn"); startIn.focus(); return; }
    const maxRainMm = rain.value === "" ? null : Math.max(0, Number(rain.value));
    const p = { ...prefs, interests, maxRainMm: Number.isFinite(maxRainMm) ? maxRainMm : null, preferredTemp: temp.value, style: style.value, budget: budget.value ? Number(budget.value) : null, region: region.value || null };
    keepPrefs(p);
    const me = ++run;
    ctx.ui.loading(out, "tripb.s.loading");
    let res;
    try { res = await runSuggestions(ctx, { region: p.region, start: startIn.value, durationDays: Number(dur.value), prefs: p }); } catch (e) { console.error(e); if (me === run) ctx.ui.errorBox(out, "tripb.s.error", go); return; }
    if (me !== run || !out.isConnected) return;
    paint(res, p);
  }

  function paint(res, p) {
    out.replaceChildren();
    if (!res.rows.length) { out.append(h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t("tripb.s.none") }))); return; }
    const kinds = new Set(res.kinds);
    out.append(...[h("h2", { text: t("tripb.s.results", { n: res.rows.length }) }),
      kinds.has("tendency") ? h("p", { class: "tb-note", role: "note", text: t(kinds.has("forecast") ? "tripb.s.mixed_note" : "tripb.s.tendency_note", { days: ctx.cfg.forecast_horizon_days }) }) : null,
      res.skipped ? h("p", { class: "tb-sub", text: t("tripb.s.skipped", { n: res.skipped }) }) : null,
      h("p", { class: "tb-sub", text: t("trip.score_note") })].filter(Boolean));
    const list = h("div", { class: "tb-resultlist" });
    let shown = 10;
    const draw = () => {
      list.replaceChildren(...res.rows.slice(0, shown).map((r, i) => resultCard(ctx, r, i + 1, p, startIn.value)));
      more.hidden = shown >= res.rows.length;
    };
    const more = h("button", { type: "button", class: "tp-btn", text: t("tripb.s.more", { n: res.rows.length - 10 }), onclick: () => { shown = res.rows.length; draw(); } });
    out.append(list, more); draw();
  }

  form.addEventListener("submit", go);
  go();                       // show a first answer straight away with the saved choices
}
