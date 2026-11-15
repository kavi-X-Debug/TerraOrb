// Historical rain tendencies from NASA POWER (data/trip/rainfall_history.json, 1981-2025, written by pipeline/trip).
// A tendency says "in the past, around this calendar day, it rained on X% of days". It is NOT a forecast and is always
// labelled as a historical tendency. Pure functions plus one cached loader; safe to import in Node.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

// "YYYY-MM-DD" (or a Date, read in UTC) -> {y,m,d} or null when it is not a real calendar date.
export function parseDate(s) {
  let y, m, d;
  if (s instanceof Date && !Number.isNaN(s.getTime())) { y = s.getUTCFullYear(); m = s.getUTCMonth() + 1; d = s.getUTCDate(); }
  else if (typeof s === "string" && ISO.test(s)) { [, y, m, d] = ISO.exec(s).map(Number); }
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d };
}
const utc = (p) => Date.UTC(p.y, p.m - 1, p.d);

export function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
export function addDays(s, n) { const p = parseDate(s); return p ? isoDate(utc(p) + n * DAY_MS) : null; }
// whole days from a to b (b - a); null if either is invalid
export function daysBetween(a, b) { const pa = parseDate(a), pb = parseDate(b); return pa && pb ? Math.round((utc(pb) - utc(pa)) / DAY_MS) : null; }

// Day-of-year index 0..364 in a NON-leap year: Jan 1 = 0, Dec 31 = 364. Feb 29 -> 59 (the same as Mar 1). null for an invalid date.
export function dayIndex(date) {
  const p = parseDate(date);
  if (!p) return null;
  if (p.m === 2 && p.d === 29) return 59;
  return Math.round((Date.UTC(2001, p.m - 1, p.d) - Date.UTC(2001, 0, 1)) / DAY_MS);
}

let cached = null;
// Loads data/trip/rainfall_history.json once. Resolves to the object, or null when the file is missing or fetch is unavailable
// (a failure is not cached, so a later call retries).
export async function loadHistory({ fetchImpl, url } = {}) {
  if (cached) return cached;
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) return null;
  try {
    const r = await f(url || "../data/trip/rainfall_history.json");
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j !== "object" || !j.cells) return null;
    cached = j;
    return j;
  } catch { return null; }
}
export function resetHistoryCache() { cached = null; }

const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The tendency for one calendar day at one POWER square, or null if the square or value is missing.
export function tendencyFor(history, cellKey, date) {
  const cell = history?.cells?.[cellKey];
  const i = dayIndex(date);
  if (!cell || i === null) return null;
  const pWet = fin(cell.p_wet?.[i]);
  if (pWet === null) return null;
  const y = history.years;
  return { kind: "historical_tendency", pWet, meanMm: fin(cell.mean_mm?.[i]), p90Mm: fin(cell.p90_mm?.[i]), source: "NASA POWER", period: history.period || (y ? `${y} years, 1981-2025` : "1981-2025") };
}

// Average over a date range (inclusive): mean chance of a wet day, total of the mean daily rain, and how many days had data.
// null when the range is invalid or no day has data. Ranges are capped at 400 days.
export function rangeTendency(history, cellKey, startDate, endDate) {
  const n = daysBetween(startDate, endDate);
  if (n === null || n < 0 || n > 400) return null;
  let sumP = 0, sumMm = 0, days = 0;
  for (let k = 0; k <= n; k++) {
    const t = tendencyFor(history, cellKey, addDays(startDate, k));
    if (!t) continue;
    sumP += t.pWet; if (t.meanMm !== null) sumMm += t.meanMm; days++;
  }
  return days ? { pWetAvg: sumP / days, meanMmTotal: sumMm, days } : null;
}
