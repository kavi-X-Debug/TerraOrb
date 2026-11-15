// Planning scores for destinations (pure, no DOM). All numbers are DRAFT rules of thumb, NOT a scientific or safety index.
// Every score is 0..100 or null when there is not enough data (nothing is invented; null parts are left out and the rest re-weighted).
//
//   S = wW*W + wA*A + wP*P + wE*E        weights from cfg.weights (default 0.40 / 0.25 / 0.20 / 0.15)
//   If the visitor's weights do not sum to 1 they are re-normalised (negative -> 0; all zero -> equal weights).
//   If a component is null (e.g. no interests chosen -> P null) the weights of the remaining components are re-normalised.
//
// W weather score = weighted mean of the available parts (each 0..100), weights rain .35, chance .25, heavy .20, temp .10, wind .10:
//   rain   = 100 * (1 - totalMm / limit), limit = prefs.maxRainMm (min 0.5) or 3 * cfg.verdict.wet_mm when not set
//   chance = 100 - maxChance (%)
//   heavy  = by worst hourly class: none 100, light 90, moderate 60, heavy 20, very_heavy 0; minus 2 per wet hour (max 20)
//   temp   = 100 - 10 per degree outside the preferred range (cool 16-26, mild 20-30, warm 25-35, any = comfort ideal range 22-32),
//            minus 10 if max > hot_c, minus 10 if min < cold_c
//   wind   = 100 up to windy_kmh, falling linearly to 0 at strong_kmh; effective wind = max(avg, 0.7*gust)
// A = mean suitability (activities.js) of the activities the destination offers that the visitor likes
//     (when no interests are chosen: the mean of the 3 best offered activities).
// P preference = mean of: interest match (share of chosen interests offered), budget (100, minus 40 per level above the budget),
//     region (100 same region, 40 otherwise), style (adventurous: share of outdoor activities; relaxed: 100 minus half that share;
//     balanced: not used). Parts without data are left out.
// E environment = mean of: slope (100 up to 15 %, falling to 20 at 45 %) and greenness NDVI (only for forest/hill/waterfall/wildlife
//     places, 100 * min(1, ndvi / 0.8)). Both come from the data files; null when absent. Steep ground (>= 30 %) in heavy rain lowers E by 20.
import { getConfig } from "./config.js";
import { classifyHour } from "./intensity.js";
import { ACTIVITIES, activitySuitability } from "./activities.js";

const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v) => Math.max(0, Math.min(100, v));
const r1 = (v) => Math.round(v * 10) / 10;
const mean = (a) => { const v = a.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const R = (key, params = {}) => ({ key, params });

const PARTS_W = { rain: 0.35, chance: 0.25, heavy: 0.20, temp: 0.10, wind: 0.10 };
const HEAVY = { none: 100, light: 90, moderate: 60, heavy: 20, very_heavy: 0 };
const TEMP_RANGE = { cool: [16, 26], mild: [20, 30], warm: [25, 35] };

// Normalise a weights object (missing keys -> 0) so the used keys sum to 1.
export function normaliseWeights(w, keys = ["weather", "activity", "preference", "environment"]) {
  const raw = keys.map((k) => Math.max(0, fin(w?.[k]) ?? 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out = {};
  keys.forEach((k, i) => { out[k] = sum > 0 ? raw[i] / sum : 1 / keys.length; });
  return out;
}

export function weatherScore(summary, prefs, cfg) {
  const c = cfg || getConfig(), p = prefs || {};
  if (!summary || (summary.totalMm == null && summary.maxChance == null && summary.maxClass == null && summary.avgTemp == null)) {
    return { score: null, parts: { rain: null, chance: null, heavy: null, temp: null, wind: null }, reasons: [R("trip.reason.no_data")] };
  }
  const parts = { rain: null, chance: null, heavy: null, temp: null, wind: null }, reasons = [];
  const limit = fin(p.maxRainMm) !== null ? Math.max(0.5, p.maxRainMm) : 3 * c.verdict.wet_mm;
  if (fin(summary.totalMm) !== null) {
    parts.rain = clamp(100 * (1 - summary.totalMm / limit));
    if (summary.totalMm < c.no_rain_day_mm) reasons.push(R("trip.reason.dry_day"));
    else if (summary.totalMm > limit) reasons.push(R("trip.reason.rain_over_limit", { mm: r1(summary.totalMm), limit: r1(limit) }));
  }
  if (fin(summary.maxChance) !== null) {
    parts.chance = clamp(100 - summary.maxChance);
    if (summary.maxChance >= c.verdict.wet_chance) reasons.push(R("trip.reason.high_chance", { pct: Math.round(summary.maxChance) }));
  }
  if (summary.maxClass) {
    parts.heavy = clamp(HEAVY[summary.maxClass] - Math.min(20, 2 * (summary.wetHours || 0)));
    if (summary.maxClass === "heavy" || summary.maxClass === "very_heavy") reasons.push(R("trip.reason.heavy_rain", { mm: summary.maxHourMm }));
  } else if (fin(summary.maxHourMm) !== null) {
    const cls = classifyHour(summary.maxHourMm, c); parts.heavy = HEAVY[cls];
    if (cls === "heavy" || cls === "very_heavy") reasons.push(R("trip.reason.heavy_rain", { mm: summary.maxHourMm }));
  }
  const t = fin(summary.avgTemp);
  if (t !== null) {
    const [lo, hi] = TEMP_RANGE[p.preferredTemp] || [c.comfort.temp_ideal_min, c.comfort.temp_ideal_max];
    let s = 100 - 10 * (t < lo ? lo - t : t > hi ? t - hi : 0);
    if (fin(summary.maxTemp) !== null && summary.maxTemp > c.comfort.hot_c) { s -= 10; reasons.push(R("trip.reason.hot", { c: Math.round(summary.maxTemp) })); }
    if (fin(summary.minTemp) !== null && summary.minTemp < c.comfort.cold_c) { s -= 10; reasons.push(R("trip.reason.cold", { c: Math.round(summary.minTemp) })); }
    parts.temp = clamp(s);
  }
  const wind = Math.max(fin(summary.avgWind) ?? 0, 0.7 * (fin(summary.maxGust) ?? 0));
  if (fin(summary.avgWind) !== null || fin(summary.maxGust) !== null) {
    const { windy_kmh: a, strong_kmh: b } = c.comfort;
    parts.wind = wind <= a ? 100 : wind >= b ? 0 : clamp(100 * (b - wind) / (b - a));
    if (wind >= a) reasons.push(R(wind >= b ? "trip.reason.strong_wind" : "trip.reason.windy", { kmh: Math.round(wind) }));
  }
  let sum = 0, wsum = 0;
  for (const k of Object.keys(PARTS_W)) if (parts[k] !== null) { sum += PARTS_W[k] * parts[k]; wsum += PARTS_W[k]; }
  return { score: wsum ? r1(sum / wsum) : null, parts, reasons };
}

export function activityScore(dest, summary, prefs, cfg) {
  const offered = Array.isArray(dest?.activities) ? dest.activities.filter((id) => ACTIVITIES[id]) : [];
  if (!offered.length || !summary) return { score: null, reasons: [R("trip.reason.no_data")] };
  const liked = (prefs?.interests || []).filter((id) => offered.includes(id));
  const scores = (liked.length ? liked : offered).map((id) => activitySuitability(id, summary, cfg).score).filter((v) => v !== null);
  if (!scores.length) return { score: null, reasons: [R("trip.reason.no_data")] };
  const use = liked.length ? scores : scores.sort((a, b) => b - a).slice(0, 3);
  const score = r1(mean(use));
  return { score, reasons: [R(score >= 60 ? "trip.reason.activities_suit" : "trip.reason.activities_poor", { n: use.length })] };
}

export function preferenceScore(dest, prefs) {
  if (!prefs || !dest) return null;
  const offered = Array.isArray(dest.activities) ? dest.activities : [];
  const parts = [];
  if (prefs.interests?.length) parts.push(100 * prefs.interests.filter((i) => offered.includes(i)).length / prefs.interests.length);
  if (fin(prefs.budget) !== null && fin(dest.cost_level) !== null) parts.push(clamp(100 - 40 * Math.max(0, dest.cost_level - prefs.budget)));
  if (prefs.region && dest.region) parts.push(prefs.region === dest.region ? 100 : 40);
  if ((prefs.style === "adventurous" || prefs.style === "relaxed") && offered.length) {
    const share = offered.filter((i) => ACTIVITIES[i]?.kind === "outdoor").length / offered.length;
    parts.push(prefs.style === "adventurous" ? 100 * share : 100 - 50 * share);
  }
  const m = mean(parts);
  return m === null ? null : r1(m);
}

export function environmentScore(dest, env) {
  const e = env || {};
  const parts = [];
  const slope = fin(e.slope_pct);
  if (slope !== null) parts.push(slope <= 15 ? 100 : slope >= 45 ? 20 : 100 - (slope - 15) * (80 / 30));
  const nature = (dest?.kinds || []).some((k) => ["forest", "hill", "waterfall", "wildlife"].includes(k));
  if (fin(e.ndvi) !== null && nature) parts.push(clamp(100 * Math.min(1, e.ndvi / 0.8)));
  const m = mean(parts);
  return m === null ? null : r1(m);
}

// -> { S, W, A, P, E, weights (used, normalised), reasons:[{key,params}], notAScientificIndex:true }; any value may be null.
export function destinationScore({ dest, summary, prefs, env, cfg } = {}) {
  const c = cfg || getConfig();
  const w = weatherScore(summary, prefs, c), a = activityScore(dest, summary, prefs, c);
  const P = preferenceScore(dest, prefs);
  let E = environmentScore(dest, env);
  const reasons = [...w.reasons];
  const steep = fin(env?.slope_pct) !== null && env.slope_pct >= 30;
  if (E !== null && steep && (summary?.maxClass === "heavy" || summary?.maxClass === "very_heavy")) { E = clamp(E - 20); reasons.push(R("trip.reason.steep_wet", { slope: Math.round(env.slope_pct) })); }
  if (a.score !== null) reasons.push(...a.reasons);
  const comps = { weather: w.score, activity: a.score, preference: P, environment: E };
  const base = normaliseWeights(c.weights);
  let sum = 0, wsum = 0;
  for (const k of Object.keys(comps)) if (comps[k] !== null) { sum += base[k] * comps[k]; wsum += base[k]; }
  const S = wsum > 0 ? r1(sum / wsum) : (Object.values(comps).some((v) => v !== null) ? r1(mean(Object.values(comps))) : null);
  return { S, W: w.score, A: a.score, P, E, weights: base, reasons, notAScientificIndex: true };
}

// Sort modes: lowest_rain (least rain mm), lowest_chance (lowest chance of rain), best_score (S), best_activity (A).
// Items may be { S, W, A, ... }, { score:{S,A}, summary, ... } or { dest, summary, score }; rain mm is item.rainMm ?? summary.totalMm,
// chance is item.pRain ?? summary.maxChance. Items with a missing sort value go last. Stable; returns a new array, never mutates.
export function rankDestinations(list, sortBy = "best_score") {
  const g = {
    lowest_rain:   (x) => fin(x.rainMm) ?? fin(x.summary?.totalMm),
    lowest_chance: (x) => fin(x.pRain) ?? fin(x.chance) ?? fin(x.summary?.maxChance),
    best_score:    (x) => fin(x.S) ?? fin(x.score?.S),
    best_activity: (x) => fin(x.A) ?? fin(x.score?.A),
  };
  const mode = g[sortBy] ? sortBy : "best_score";
  const dir = mode.startsWith("lowest") ? 1 : -1;
  return (list || []).map((x, i) => ({ x, i, v: g[mode](x) }))
    .sort((p, q) => (p.v === null) - (q.v === null) || (p.v === null ? 0 : dir * (p.v - q.v)) || p.i - q.i)
    .map((o) => o.x);
}
