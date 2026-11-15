// Rain intensity for the trip planner (pure functions, no DOM, safe to import in Node).
//
// Intensity is ONLY defined for an hourly amount in mm per hour. Daily totals are never classed as an intensity:
// a day is reported as a total plus a "wet day" flag elsewhere.
// Classes (thresholds come from cfg.intensity, DRAFT values from [trip] in pipeline/config.toml):
//   mm < light_min (0.1)            -> "none"
//   light_min  <= mm < moderate_min -> "light"
//   moderate_min <= mm < heavy_min  -> "moderate"
//   heavy_min <= mm <= very_heavy_min (10..50) -> "heavy"
//   mm > very_heavy_min (50)        -> "very_heavy"
// Hourly values are read from the Open-Meteo hourly forecast only (never derived from daily averages).
import { getConfig } from "./config.js";

export const INTENSITY = {
  none:       { key: "trip.int.none",       color: "#94A3B8", rank: 0 },
  light:      { key: "trip.int.light",      color: "#56B4E9", rank: 1 },
  moderate:   { key: "trip.int.moderate",   color: "#3182CE", rank: 2 },
  heavy:      { key: "trip.int.heavy",      color: "#F59E0B", rank: 3 },
  very_heavy: { key: "trip.int.very_heavy", color: "#DC2626", rank: 4 },
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cfgOf = (cfg) => cfg || getConfig();

// mm in one hour -> class id. A missing value (null/NaN) is treated as "none"; callers that must tell "no data" apart check for null first.
export function classifyHour(mm, cfg) {
  const v = num(mm);
  if (v === null) return "none";
  const t = cfgOf(cfg).intensity;
  if (v < t.light_min) return "none";
  if (v < t.moderate_min) return "light";
  if (v < t.heavy_min) return "moderate";
  if (v <= t.very_heavy_min) return "heavy";
  return "very_heavy";
}

// clock hour 0..23 -> "night" | "morning" | "afternoon" | "evening" (ranges from cfg.day_periods, inclusive)
export function periodOf(hour, cfg) {
  const p = cfgOf(cfg).day_periods;
  for (const id of ["night", "morning", "afternoon", "evening"]) {
    const [a, b] = p[id];
    if (hour >= a && hour <= b) return id;
  }
  return "night";
}

const PERIODS = ["night", "morning", "afternoon", "evening"];
const rank = (c) => INTENSITY[c].rank;
const maxOf = (a) => (a.length ? Math.max(...a) : null);
const minOf = (a) => (a.length ? Math.min(...a) : null);
const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const vals = (rows, k) => rows.map((r) => num(r[k])).filter((v) => v !== null);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

// Statistics for a group of hourly rows (used for the whole day and for each period).
function stats(rows, cfg) {
  const mm = vals(rows, "mm");
  const total = mm.length ? mm.reduce((x, y) => x + y, 0) : null;
  const light = cfg.intensity.light_min;
  let maxClass = null, wet = 0;
  for (const v of mm) { const c = classifyHour(v, cfg); if (maxClass === null || rank(c) > rank(maxClass)) maxClass = c; if (v >= light) wet++; }
  return { totalMm: r1(total), maxHourMm: r1(maxOf(mm)), maxClass, wetHours: mm.length ? wet : null, maxChance: maxOf(vals(rows, "chance")), hours: mm.length };
}

// Good outdoor windows: runs of >= 2 hours in daylight-ish time (06:00-19:00) with no rain, a low chance of rain and no strong gusts.
// A row with missing rain data never counts as good. {from, to} are clock hours, `to` exclusive (a window 9..12 is 09:00-12:00).
function goodWindows(rows, cfg) {
  const out = []; let from = null;
  const ok = (r) => {
    if (r.h < 6 || r.h > 18) return false;
    const mm = num(r.mm); if (mm === null || mm >= cfg.intensity.light_min) return false;
    const ch = num(r.chance); if (ch !== null && ch >= cfg.verdict.maybe_chance) return false;
    const g = num(r.gust); if (g !== null && g >= cfg.comfort.strong_kmh) return false;
    return true;
  };
  const byH = new Map(rows.map((r) => [r.h, r]));
  for (let h = 6; h <= 19; h++) {
    const r = byH.get(h);
    if (r && ok(r)) { if (from === null) from = h; }
    else if (from !== null) { if (h - from >= 2) out.push({ from, to: h }); from = null; }
  }
  return out;
}

// hourlyDay: [{h, mm, chance, temp, rh, wind, gust, code}] (24 rows, missing = null) -> day summary (see docs/trip-spec.md section 3).
// With no rows at all every field is null / empty and hasData is false.
export function summariseDay(hourlyDay, cfg) {
  const c = cfgOf(cfg);
  const rows = Array.isArray(hourlyDay) ? hourlyDay.filter((r) => r && Number.isInteger(r.h)) : [];
  const all = stats(rows, c);
  const wetRows = rows.filter((r) => num(r.mm) !== null && r.mm >= c.intensity.light_min).map((r) => r.h);
  const first = wetRows.length ? Math.min(...wetRows) : null, last = wetRows.length ? Math.max(...wetRows) : null;
  const temps = vals(rows, "temp");
  const byPeriod = {};
  for (const p of PERIODS) byPeriod[p] = stats(rows.filter((r) => periodOf(r.h, c) === p), c);
  return {
    hasData: all.hours > 0,
    totalMm: all.totalMm, maxHourMm: all.maxHourMm, maxClass: all.maxClass,
    wetHours: all.wetHours,
    durationHours: first === null ? (all.hours ? 0 : null) : last - first + 1,
    firstWetHour: first, lastWetHour: last,
    maxChance: all.maxChance,
    avgTemp: r1(avgOf(temps)), maxTemp: maxOf(temps), minTemp: minOf(temps),
    avgHumidity: r1(avgOf(vals(rows, "rh"))), avgWind: r1(avgOf(vals(rows, "wind"))), maxGust: maxOf(vals(rows, "gust")),
    byPeriod,
    goodWindows: goodWindows(rows, c),
  };
}
