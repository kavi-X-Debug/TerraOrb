// Extra helpers for the trip and event planner (planner end): kinds of trip, wind / sun / heat warnings, sun times,
// a "what to bring" list, a calendar file and a two-place comparison.
//
// Everything here is a pure function of the forecast numbers (Open-Meteo, NOT NASA data), so it can be tested without the page.
// The warning levels are DRAFT rules of thumb for planning, not an official standard. The UV bands are the World Health
// Organization's UV index scale; the wind and "feels like" levels are simple round numbers a reviewer should confirm.

// The kinds of trip or event. `from`/`to` are the usual hours, which the person can still change.
export const KINDS = {
  general: { from: 9, to: 17 },
  hike: { from: 6, to: 12 },
  beach: { from: 8, to: 16 },
  event: { from: 10, to: 18 },
  sport: { from: 9, to: 17 },
  farm: { from: 6, to: 11 },
};
export const kindOf = (id) => (Object.hasOwn(KINDS, id) ? id : "general");

// Draft levels
export const GUST_WINDY = 40, GUST_STRONG = 60;           // km/h
export const UV_HIGH = 6, UV_VERY_HIGH = 8, UV_EXTREME = 11;   // WHO UV index bands
export const FEELS_HOT = 38, FEELS_VERY_HOT = 41;         // degrees C ("feels like")

const pad = (n) => String(n).padStart(2, "0");
const finite = (x) => typeof x === "number" && Number.isFinite(x);

// Wind, sun and heat inside the chosen hours of one day. Open-Meteo hourly values at 15:00 are the hour 14:00-15:00,
// so the hours from `from` to `to` are the entries stamped from+1 to `to` (same rule as windowHours in planner.js).
export function extrasFor(forecast, day, from, to) {
  let gust = null, uv = null, feels = null;
  for (let h = from + 1; h <= to; h++) {
    const i = forecast.index.get(`${day}T${pad(h)}:00`);
    if (i === undefined) continue;
    if (finite(forecast.gust?.[i])) gust = Math.max(gust ?? 0, forecast.gust[i]);
    if (finite(forecast.uv?.[i])) uv = Math.max(uv ?? 0, forecast.uv[i]);
    if (finite(forecast.feels?.[i])) feels = Math.max(feels ?? -Infinity, forecast.feels[i]);
  }
  const d = forecast.days.find((x) => x.date === day);
  const sunrise = d?.sunrise ? hourOf(d.sunrise) : null, sunset = d?.sunset ? hourOf(d.sunset) : null;
  return {
    gust, uv, feels, sunrise, sunset,
    wind: gust === null ? null : gust >= GUST_STRONG ? "strong" : gust >= GUST_WINDY ? "windy" : "calm",
    sun: uv === null ? null : uv >= UV_EXTREME ? "extreme" : uv >= UV_VERY_HIGH ? "very_high" : uv >= UV_HIGH ? "high" : "ok",
    heat: feels === null ? null : feels >= FEELS_VERY_HOT ? "very_hot" : feels >= FEELS_HOT ? "hot" : "ok",
    dark: sunset !== null && to > Math.ceil(sunset),                 // the hours run past sunset
    early: sunrise !== null && from < Math.floor(sunrise),           // the hours start before sunrise
  };
}

// "2026-11-15T17:58" -> 17.97 (hours as a decimal)
export function hourOf(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}
export const clock = (x) => (x === null || x === undefined ? "–" : `${pad(Math.floor(x))}:${pad(Math.round((x % 1) * 60) % 60)}`);

// The "what to bring" list: a list of text keys (pl.bring.<key>) chosen from the verdict and the extras.
export function bringList(verdict, ex, kind = "general") {
  const items = [];
  if (verdict && verdict.cls !== "dry") items.push("raincoat");
  if (verdict && verdict.cls === "wet") items.push("backup");
  if (ex.sun === "high" || ex.sun === "very_high" || ex.sun === "extreme") items.push("sunscreen", "hat");
  if (ex.heat === "hot" || ex.heat === "very_hot" || (verdict && verdict.hottest >= 32)) items.push("water");
  if (ex.wind === "windy" || ex.wind === "strong") items.push("secure");
  if (ex.dark) items.push("torch");
  if (kind === "hike") items.push("shoes");
  if (kind === "beach" && ex.sun !== "ok") items.push("shade");
  if (kind === "farm") items.push("boots");
  return [...new Set(items)];
}

// A calendar file (.ics) for the chosen day and hours, in local (floating) time. Text is escaped as RFC 5545 asks.
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
export function icsFile({ name, day, from, to, summary, description, url }) {
  const stamp = (h) => `${day.replaceAll("-", "")}T${pad(h)}0000`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Monsoon Compass//Trip planner//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${day}-${from}-${to}-${esc(name).replace(/\W/g, "")}@monsoon-compass`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${stamp(from)}`, `DTEND:${stamp(to)}`,
    `SUMMARY:${esc(summary)}`, `LOCATION:${esc(name)}`, `DESCRIPTION:${esc(description)}`, url ? `URL:${url}` : null,
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n") + "\r\n";
}

// Which of two places looks better for the same day and hours (verdict first, then rain, then chance). Returns "a", "b" or "same".
const RANK = { dry: 0, maybe: 1, wet: 2 };
export function betterOf(a, b) {
  if (!a || !b) return null;
  const ka = [RANK[a.cls], a.mm, a.chance], kb = [RANK[b.cls], b.mm, b.chance];
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? "a" : "b";
  return "same";
}
