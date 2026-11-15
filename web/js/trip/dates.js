// Best travel dates finder (pure, no DOM).
// For every possible trip window of `durationDays` inside [rangeStart, rangeEnd] each day is evaluated like this:
//   * a day inside the forecast horizon (today .. today + cfg.forecast_horizon_days - 1) with forecast data uses the REAL Open-Meteo
//     forecast (hourly rows, else the daily values) -> dataKind "forecast";
//   * every other day (beyond the horizon, or no forecast loaded) uses ONLY the NASA POWER historical tendency of that calendar day
//     (chance of a wet day, mean rain) -> dataKind "tendency". A tendency is never presented as a forecast and carries no hourly values;
//   * a window with both kinds is "mixed".
// Window score = mean of the daily destination scores (scoring.js: weather, activities, preferences, environment, weights from cfg).
// Windows with a day that has no data at all are skipped. The returned list holds the best non-overlapping windows (best first).
import { getConfig } from "./config.js";
import { addDays, daysBetween, parseDate, tendencyFor } from "./history.js";
import { dailyOf, dayKind, hasRain, hoursOf, todayColombo } from "./forecast.js";
import { summariseDay } from "./intensity.js";
import { destinationScore } from "./scoring.js";

const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const R = (key, params = {}) => ({ key, params });
const MAX_RANGE_DAYS = 366;

// Evaluate one calendar day -> { date, kind, summary, S, rainMm, chance, heavyHours, reasons } or null (no data).
function evalDay(date, ctx) {
  const { dest, forecast, history, prefs, env, cfg, today } = ctx;
  if (dayKind(date, today, cfg) === "forecast" && forecast?.ok) {
    const rows = hoursOf(forecast, date);
    if (hasRain(rows)) {
      const summary = summariseDay(rows, cfg);
      const sc = destinationScore({ dest, summary, prefs, env, cfg });
      const heavy = rows.filter((r) => r.mm !== null && r.mm >= cfg.intensity.heavy_min).length;
      return { date, kind: "forecast", summary, S: sc.S, rainMm: summary.totalMm, chance: summary.maxChance, heavyHours: heavy, reasons: sc.reasons };
    }
    const d = dailyOf(forecast, date);
    if (d && d.precipMm !== null) {
      const summary = { totalMm: d.precipMm, maxChance: d.chanceMax, maxHourMm: null, maxClass: null, wetHours: null, avgTemp: d.tmax !== null && d.tmin !== null ? (d.tmax + d.tmin) / 2 : null, maxTemp: d.tmax, minTemp: d.tmin, avgWind: d.windMax, maxGust: null };
      const sc = destinationScore({ dest, summary, prefs, env, cfg });
      return { date, kind: "forecast", summary, S: sc.S, rainMm: d.precipMm, chance: d.chanceMax, heavyHours: null, reasons: sc.reasons };
    }
  }
  const t = tendencyFor(history, dest?.cell, date);
  if (!t) return null;
  const summary = { totalMm: t.meanMm, maxChance: t.pWet * 100, maxHourMm: null, maxClass: null, wetHours: null, avgTemp: null, maxTemp: null, minTemp: null, avgWind: null, maxGust: null };
  const sc = destinationScore({ dest, summary, prefs, env, cfg });
  return { date, kind: "tendency", summary, S: sc.S, rainMm: t.meanMm, chance: t.pWet * 100, heavyHours: null, reasons: [R("trip.reason.tendency_only"), ...sc.reasons] };
}

// Combine the days of one window.
function evalWindow(start, n, days) {
  const list = [];
  for (let i = 0; i < n; i++) { const d = days(addDays(start, i)); if (!d) return null; list.push(d); }
  const kinds = new Set(list.map((d) => d.kind));
  const dataKind = kinds.size > 1 ? "mixed" : list[0].kind;
  const scored = list.filter((d) => d.S !== null);
  const rain = list.filter((d) => d.rainMm !== null);
  const chances = list.filter((d) => d.chance !== null);
  const dry = list.filter((d) => d.rainMm !== null && d.rainMm < 1).length;
  const reasons = [];
  const seen = new Set();
  for (const d of list) for (const r of d.reasons) if (!seen.has(r.key) && reasons.length < 4) { seen.add(r.key); reasons.push(r); }
  if (rain.length) reasons.unshift(R("trip.reason.window_rain", { mm: r1(rain.reduce((a, d) => a + d.rainMm, 0)), dry, days: n }));
  const fc = list.filter((d) => d.heavyHours !== null);
  return {
    start, end: addDays(start, n - 1), dataKind,
    score: scored.length ? r1(scored.reduce((a, d) => a + d.S, 0) / scored.length) : null,
    rainMm: rain.length ? r1(rain.reduce((a, d) => a + d.rainMm, 0)) : null,
    pRain: chances.length ? r1(chances.reduce((a, d) => a + d.chance, 0) / chances.length) : null,
    heavyHours: fc.length ? fc.reduce((a, d) => a + d.heavyHours, 0) : null,
    reasons,
  };
}

// Options: { dest, forecast, history, durationDays, rangeStart, rangeEnd, prefs, original:{start,end}|null, today, cfg, limit, env }
// -> { results:[{start,end,dataKind,score,rainMm,pRain,heavyHours|null,reasons}], original:{same fields}|null, notes:[{key,params}] }
export function findBestDates(o = {}) {
  const cfg = o.cfg || getConfig();
  const today = o.today || todayColombo();
  const notes = [];
  const out = { results: [], original: null, notes };
  const n = Number.isInteger(o.durationDays) ? o.durationDays : Number(o.durationDays);
  let a = o.rangeStart, b = o.rangeEnd;
  if (!o.dest || !parseDate(a) || !parseDate(b) || !Number.isInteger(n) || n < 1 || daysBetween(a, b) < 0) { notes.push(R("trip.note.invalid_range")); return out; }
  if (daysBetween(today, a) < 0) { a = today; notes.push(R("trip.note.range_clamped", { from: today })); }
  if (daysBetween(a, b) < 0) { notes.push(R("trip.note.invalid_range")); return out; }
  if (daysBetween(a, b) + 1 > MAX_RANGE_DAYS) { b = addDays(a, MAX_RANGE_DAYS - 1); notes.push(R("trip.note.range_capped", { days: MAX_RANGE_DAYS })); }
  const span = daysBetween(a, b) + 1;
  if (n > span) { notes.push(R("trip.note.duration_too_long", { days: n, span })); return out; }

  const ctx = { dest: o.dest, forecast: o.forecast, history: o.history, prefs: o.prefs || {}, env: o.env, cfg, today };
  const cache = new Map();
  const day = (d) => { if (!cache.has(d)) cache.set(d, evalDay(d, ctx)); return cache.get(d); };

  const wins = [];
  let skipped = 0;
  for (let k = 0; k + n <= span; k++) {
    const w = evalWindow(addDays(a, k), n, day);
    if (w && w.score !== null) wins.push(w); else skipped++;
  }
  if (skipped) notes.push(R("trip.note.no_data_windows", { n: skipped }));
  if (!o.forecast?.ok && [...cache.values()].some((d) => d && dayKind(d.date, today, cfg) === "forecast")) notes.push(R("trip.note.no_forecast_using_tendency"));
  if (o.forecast?.stale) notes.push(R("trip.note.forecast_stale", { time: o.forecast.fetchedAt }));
  wins.sort((x, y) => y.score - x.score || (x.start < y.start ? -1 : 1));
  const limit = Math.max(1, o.limit || 5), picked = [];
  for (const w of wins) {
    if (picked.length >= limit) break;
    if (picked.every((p) => w.start > p.end || w.end < p.start)) picked.push(w);       // best windows that do not overlap
  }
  out.results = picked;
  if (picked.some((p) => p.dataKind !== "forecast")) notes.push(R("trip.note.tendency_not_forecast"));

  if (o.original && parseDate(o.original.start) && parseDate(o.original.end)) {
    const m = daysBetween(o.original.start, o.original.end) + 1;
    const ow = m >= 1 ? evalWindow(o.original.start, m, day) : null;
    if (ow) {
      out.original = ow;
      if (picked[0] && ow.score !== null) {
        const delta = r1(picked[0].score - ow.score);
        notes.push(delta > 5 ? R("trip.note.better_than_original", { delta, start: picked[0].start, end: picked[0].end }) : R("trip.note.original_ok"));
      }
    } else notes.push(R("trip.note.original_no_data"));
  }
  if (!picked.length && !notes.some((x) => x.key === "trip.note.invalid_range")) notes.push(R("trip.note.no_results"));
  return out;
}
