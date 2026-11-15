// Open-Meteo forecast client for the trip planner (source: Open-Meteo, NOT NASA data). Up to 16 days, hourly + daily.
//
// loadForecast order of preference:
//   1. a fresh copy (younger than cfg.cache_minutes) from memory or localStorage "mc-trip-fc-<id>",
//   2. a live request (10 s timeout), which is then cached with its `fetchedAt`,
//   3. if the request fails: the older cached copy, returned with stale:true,
//   4. then the static snapshot data/trip/forecast_snapshot.json (also stale:true, snapshot:true),
//   5. else { ok:false, error }.
// A stale or snapshot copy is NEVER presented as current: stale is true and fetchedAt says when it was fetched.
// Hourly rain is the Open-Meteo value for the hour ENDING at the time stamp, so clock hour h (h:00-h+1:00) is the entry stamped (h+1):00.
// Pure helpers (hoursOf, dailyOf, dayKind) work on the forecast object; no DOM, no work at import time.
import { getConfig } from "./config.js";
import { readKey, writeKey } from "./store.js";
import { addDays, daysBetween, parseDate } from "./history.js";

const API = "https://api.open-meteo.com/v1/forecast";
const HOURLY = ["precipitation", "precipitation_probability", "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m", "weather_code"];
const DAILY = ["precipitation_sum", "precipitation_probability_max", "temperature_2m_max", "temperature_2m_min", "wind_speed_10m_max", "sunrise", "sunset"];
const TIMEOUT_MS = 10000;
const SNAPSHOT_URL = "../data/trip/forecast_snapshot.json";
export const FORECAST_SOURCE = "Open-Meteo";

const memory = new Map();       // id -> { fetchedAt, hourly, daily }
let snapshot;                   // undefined = not tried, null = unavailable

export function forecastUrl(dest, days = 16) {
  const q = new URLSearchParams({ latitude: String(dest.lat), longitude: String(dest.lon), hourly: HOURLY.join(","), daily: DAILY.join(","), timezone: "Asia/Colombo", forecast_days: String(days) });
  return `${API}?${q}`;
}

const pick = (obj, keys) => { const o = {}; for (const k of keys.concat("time")) o[k] = Array.isArray(obj?.[k]) ? obj[k] : []; return o; };

function make(entry, stale, extra) {
  return { ok: true, source: FORECAST_SOURCE, not_nasa: true, fetchedAt: entry.fetchedAt || null, stale, error: null, hourly: entry.hourly, daily: entry.daily, ...extra };
}

function readCache(id) {
  try { const v = JSON.parse(readKey(`mc-trip-fc-${id}`)); return v && v.hourly?.time?.length ? v : null; } catch { return null; }
}

async function loadSnapshot(fetchImpl) {
  if (snapshot !== undefined) return snapshot;
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) { snapshot = null; return null; }
  try { const r = await f(SNAPSHOT_URL); snapshot = r.ok ? await r.json() : null; } catch { snapshot = null; }
  return snapshot;
}

async function fetchLive(dest, fetchImpl, timeoutMs) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) throw new Error("fetch unavailable");
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await f(forecastUrl(dest, getConfig().forecast_horizon_days || 16), ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j?.hourly?.time?.length) throw new Error("no hourly data");
    return { hourly: pick(j.hourly, HOURLY), daily: pick(j.daily, DAILY) };
  } finally { if (timer) clearTimeout(timer); }
}

// dest: { id, lat, lon }. Options: { force, fetchImpl, timeoutMs, now } (fetchImpl/now are for tests).
export async function loadForecast(dest, { force = false, fetchImpl, timeoutMs = TIMEOUT_MS, now = Date.now() } = {}) {
  if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) return { ok: false, error: "bad_destination", stale: false, source: FORECAST_SOURCE, not_nasa: true };
  const id = dest.id ?? `${dest.lat},${dest.lon}`;
  const maxAge = (getConfig().cache_minutes ?? 30) * 60000;
  const age = (e) => { const t = Date.parse(e?.fetchedAt); return Number.isFinite(t) ? now - t : Infinity; };
  const mem = memory.get(id);
  if (!force) {
    if (mem && age(mem) < maxAge) return make(mem, false);
    const c = readCache(id);
    if (c && age(c) < maxAge) { memory.set(id, c); return make(c, false); }
  }
  let error;
  try {
    const live = await fetchLive(dest, fetchImpl, timeoutMs);
    const entry = { fetchedAt: new Date(now).toISOString(), ...live };
    memory.set(id, entry);
    writeKey(`mc-trip-fc-${id}`, JSON.stringify(entry));
    return make(entry, false);
  } catch (e) { error = e?.name === "AbortError" ? "timeout" : String(e?.message || e); }
  const old = mem || readCache(id);
  if (old) return make(old, true, { error });
  const snap = await loadSnapshot(fetchImpl);
  const s = snap?.destinations?.[id];
  if (s?.hourly?.time?.length) return make({ fetchedAt: snap.fetched_at || null, hourly: s.hourly, daily: s.daily || { time: [] } }, true, { snapshot: true, error });
  return { ok: false, source: FORECAST_SOURCE, not_nasa: true, fetchedAt: null, stale: false, error, hourly: null, daily: null };
}

// Several destinations with at most `limit` requests running at once. Returns Map(id -> forecast); one failure never stops the others.
export async function loadForecasts(dests, { force = false, limit = 4, fetchImpl, timeoutMs, now } = {}) {
  const list = (dests || []).filter(Boolean);
  const out = new Map();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const d = list[next++];
      out.set(d.id, await loadForecast(d, { force, fetchImpl, timeoutMs, now }));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return out;
}

export function clearForecastCache() { memory.clear(); snapshot = undefined; }

// ---- pure helpers on a forecast object ----------------------------------------------------------------------------

const indexCache = new WeakMap();
function hourIndex(forecast) {
  let m = indexCache.get(forecast.hourly);
  if (!m) { m = new Map(forecast.hourly.time.map((t, i) => [t, i])); indexCache.set(forecast.hourly, m); }
  return m;
}
const pad = (n) => String(n).padStart(2, "0");
const val = (arr, i) => (i === undefined || !Array.isArray(arr) || typeof arr[i] !== "number" || !Number.isFinite(arr[i]) ? null : arr[i]);

// 24 rows [{h, mm, chance, temp, rh, wind, gust, code}] for a date (missing = null).
// mm and chance of row h come from the entry stamped (h+1):00 (the hour ending then); the other fields from the stamp h:00.
export function hoursOf(forecast, date) {
  const rows = [];
  const ok = forecast?.ok && forecast.hourly?.time && parseDate(date);
  const idx = ok ? hourIndex(forecast) : null, H = forecast?.hourly;
  const next = ok ? addDays(date, 1) : null;
  for (let h = 0; h < 24; h++) {
    if (!idx) { rows.push({ h, mm: null, chance: null, temp: null, rh: null, wind: null, gust: null, code: null }); continue; }
    const at = idx.get(`${date}T${pad(h)}:00`);
    const end = h === 23 ? idx.get(`${next}T00:00`) : idx.get(`${date}T${pad(h + 1)}:00`);
    rows.push({ h, mm: val(H.precipitation, end), chance: val(H.precipitation_probability, end), temp: val(H.temperature_2m, at), rh: val(H.relative_humidity_2m, at),
      wind: val(H.wind_speed_10m, at), gust: val(H.wind_gusts_10m, at), code: val(H.weather_code, at) });
  }
  return rows;
}

// true when at least one row has a rain value
export const hasRain = (rows) => Array.isArray(rows) && rows.some((r) => r.mm !== null);

// The daily values for a date, or null when the date is not in the forecast.
export function dailyOf(forecast, date) {
  const D = forecast?.ok ? forecast.daily : null;
  const i = D?.time ? D.time.indexOf(date) : -1;
  if (i < 0) return null;
  return { date, precipMm: val(D.precipitation_sum, i), chanceMax: val(D.precipitation_probability_max, i), tmax: val(D.temperature_2m_max, i), tmin: val(D.temperature_2m_min, i),
    windMax: val(D.wind_speed_10m_max, i), sunrise: D.sunrise?.[i] ?? null, sunset: D.sunset?.[i] ?? null };
}

// today in Sri Lanka as "YYYY-MM-DD"
export function todayColombo(now = Date.now()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
  catch { return new Date(now + 5.5 * 3600000).toISOString().slice(0, 10); }
}

// "forecast" for days from today up to cfg.forecast_horizon_days - 1 days ahead, "tendency" for everything else
// (later days, past days, invalid dates): beyond the horizon only historical tendencies may be shown, never a forecast.
export function dayKind(date, today, cfg) {
  const c = cfg || getConfig();
  const diff = daysBetween(today || todayColombo(), date);
  return diff !== null && diff >= 0 && diff < c.forecast_horizon_days ? "forecast" : "tendency";
}
