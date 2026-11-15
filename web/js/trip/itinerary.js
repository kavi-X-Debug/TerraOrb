// Itinerary rescheduling (pure, no DOM). It only PROPOSES changes; nothing is changed until the visitor accepts (applyProposals).
// Itinerary = { id, name, items:[{ id, day:"YYYY-MM-DD", slot:"morning|afternoon|evening", destId, activity, kind:"outdoor|indoor", locked, note }] }.
// `locked: true` = a confirmed booking. A locked item is NEVER moved, replaced or edited; if the weather is bad for it, it only gets a
// warning entry (locked:true, options: []).
//
// Problem test for an outdoor item (the weather of its own slot, from the Open-Meteo hourly forecast): heavy or very heavy rain in the slot,
// or moderate rain with a chance >= cfg.verdict.wet_chance, or wind >= cfg.comfort.strong_kmh. Indoor items and items without forecast
// data (beyond the horizon or not loaded) are "unaffected": nothing is claimed about them.
// Option score (0..100) = 0.60 * activity suitability + 0.25 * (100 - chance of rain) + 0.15 * (100 - min(100, distance km)).
//   move: another free slot (morning/afternoon, never evening for outdoor items) on a day of the itinerary that has forecast data,
//         same activity and place; only offered when suitability >= 50.
//   replace: an indoor activity in the same slot, at the same place or at another place (needs `destinations`, within 100 km).
//   keep: always offered, scored with the current slot.
import { getConfig } from "./config.js";
import { ACTIVITIES, activitySuitability, isOutdoor } from "./activities.js";
import { periodOf, summariseDay } from "./intensity.js";
import { dayKind, hasRain, hoursOf, todayColombo } from "./forecast.js";
import { addDays, daysBetween } from "./history.js";

const R = (key, params = {}) => ({ key, params });
const SLOTS = ["morning", "afternoon", "evening"];
const MAX_OPTIONS = 5;
const REPLACE_KM = 100;

// haversine distance in km between {lat, lon} points; null if a coordinate is missing
export function distanceKm(a, b) {
  const f = (v) => typeof v === "number" && Number.isFinite(v);
  if (!a || !b || !f(a.lat) || !f(a.lon) || !f(b.lat) || !f(b.lon)) return null;
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// summary of one slot (morning / afternoon / evening) of one day for one forecast; null when there is no rain data
function slotSummary(forecast, day, slot, cfg) {
  const rows = hoursOf(forecast, day);
  if (!hasRain(rows)) return null;
  return summariseDay(rows.filter((r) => periodOf(r.h, cfg) === slot), cfg);
}

function isProblem(sum, cfg) {
  if (!sum || !sum.maxClass) return null;
  if (sum.maxClass === "heavy" || sum.maxClass === "very_heavy") return R("trip.problem.heavy_rain", { mm: sum.maxHourMm, chance: sum.maxChance });
  if (sum.maxClass === "moderate" && (sum.maxChance ?? 0) >= cfg.verdict.wet_chance) return R("trip.problem.rain_likely", { mm: sum.totalMm, chance: sum.maxChance });
  const wind = Math.max(sum.avgWind ?? 0, 0.7 * (sum.maxGust ?? 0));
  if (wind >= cfg.comfort.strong_kmh) return R("trip.problem.strong_wind", { kmh: Math.round(wind) });
  return null;
}

const optScore = (suit, chance, km) => Math.round(0.6 * suit + 0.25 * (100 - (chance ?? 50)) + 0.15 * (100 - Math.min(100, km ?? 0)));

// itinerary, forecasts: Map(destId -> forecast). Optional: destinations (array or Map(id -> dest) with lat/lon/activities, for replacing by
// an activity elsewhere), distanceKm (function (destA, destB) -> km, default haversine), today.
// -> { proposals:[{ itemId, problem, locked?, options:[{type, toDay, toSlot, toActivity, toDest, score, reason}] }], unaffected:[itemId] }
export function proposeReschedule({ itinerary, forecasts, cfg, destinations, distanceKm: dist, today } = {}) {
  const c = cfg || getConfig();
  const km = typeof dist === "function" ? dist : distanceKm;
  const items = Array.isArray(itinerary?.items) ? itinerary.items : [];
  const fc = forecasts instanceof Map ? forecasts : new Map(Object.entries(forecasts || {}));
  const dmap = destinations instanceof Map ? destinations : new Map((destinations || []).map((d) => [d.id, d]));
  const now = today || todayColombo();
  const out = { proposals: [], unaffected: [] };
  const days = items.map((i) => i.day).filter(Boolean).sort();
  const first = days[0], last = days[days.length - 1];
  const itinDays = first ? Array.from({ length: Math.max(0, daysBetween(first, last)) + 1 }, (_, k) => addDays(first, k)) : [];
  const taken = new Map(items.map((i) => [`${i.day}|${i.slot}`, i.id]));

  for (const it of items) {
    const f = fc.get(it.destId);
    const kind = it.kind || ACTIVITIES[it.activity]?.kind || "outdoor";
    const sum = f?.ok && dayKind(it.day, now, c) === "forecast" ? slotSummary(f, it.day, it.slot, c) : null;
    const problem = kind === "outdoor" ? isProblem(sum, c) : null;
    if (!problem) { out.unaffected.push(it.id); continue; }
    if (it.locked) { out.proposals.push({ itemId: it.id, problem: R("trip.problem.locked_booking", { problem: problem.key }), locked: true, options: [] }); continue; }

    const here = dmap.get(it.destId) || { id: it.destId };
    const options = [];
    // keep
    const keepSuit = activitySuitability(it.activity, sum, c).score ?? 0;
    options.push({ type: "keep", toDay: it.day, toSlot: it.slot, toActivity: it.activity, toDest: it.destId, score: optScore(keepSuit, sum.maxChance, 0), reason: R("trip.option.keep_risk", { mm: sum.maxHourMm }) });
    // move to another free slot of the itinerary's days
    for (const day of itinDays) {
      if (dayKind(day, now, c) !== "forecast") continue;
      for (const slot of SLOTS) {
        if (slot === "evening" && isOutdoor(it.activity)) continue;
        if ((day === it.day && slot === it.slot) || taken.has(`${day}|${slot}`)) continue;
        const s2 = f?.ok ? slotSummary(f, day, slot, c) : null;
        if (!s2) continue;
        const suit = activitySuitability(it.activity, s2, c).score;
        if (suit === null || suit < 50 || isProblem(s2, c)) continue;
        options.push({ type: "move", toDay: day, toSlot: slot, toActivity: it.activity, toDest: it.destId, score: optScore(suit, s2.maxChance, 0), reason: R("trip.option.move_drier", { day, slot, mm: s2.totalMm, chance: s2.maxChance }) });
      }
    }
    // replace by an indoor activity in the same slot (same place, or another place nearby)
    const candidates = new Map([[it.destId, here], ...[...dmap].filter(([id]) => id !== it.destId)]);
    for (const [id, d] of candidates) {
      const d_km = id === it.destId ? 0 : km(here, d);
      if (d_km === null || d_km > REPLACE_KM) continue;
      for (const act of d.activities || []) {
        if (ACTIVITIES[act]?.kind !== "indoor") continue;
        const suit = activitySuitability(act, sum, c).score;
        if (suit === null || suit < 50) continue;
        options.push({ type: "replace", toDay: it.day, toSlot: it.slot, toActivity: act, toDest: id, score: optScore(suit, 0, d_km), reason: R(id === it.destId ? "trip.option.replace_indoor" : "trip.option.replace_nearby", { km: Math.round(d_km) }) });
      }
    }
    options.sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : 1));
    // at most MAX_OPTIONS: the 2 best moves, the 2 best replacements and "keep" (so both kinds of answer are always visible)
    const best = (type, n) => options.filter((o) => o.type === type).slice(0, n);
    const kept = [...best("move", 2), ...best("replace", 2), ...best("keep", 1)].sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : 1));
    out.proposals.push({ itemId: it.id, problem, options: kept });
  }
  return out;
}

// accepted: [{ itemId, option }] (option as returned in a proposal). Returns a NEW itinerary; the input is never changed.
// Locked items are skipped. A move into a slot that is no longer free is skipped.
export function applyProposals(itinerary, accepted) {
  const next = JSON.parse(JSON.stringify(itinerary || { items: [] }));
  const items = next.items || [];
  for (const a of accepted || []) {
    const it = items.find((x) => x.id === a?.itemId);
    const o = a?.option;
    if (!it || it.locked || !o || o.type === "keep") continue;
    if (o.type === "move") {
      if (items.some((x) => x !== it && x.day === o.toDay && x.slot === o.toSlot)) continue;
      it.day = o.toDay; it.slot = o.toSlot;
    } else if (o.type === "replace") {
      it.activity = o.toActivity; it.destId = o.toDest; it.kind = ACTIVITIES[o.toActivity]?.kind || it.kind;
    }
  }
  return next;
}
