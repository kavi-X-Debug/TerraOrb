// Activity catalogue and weather-based activity recommendations (pure, no DOM).
//
// Suitability of ONE activity in ONE weather summary, 0..100 (DRAFT rules of thumb, not a safety rating):
//   base by the worst hourly rain class of the period (summary.maxClass):
//     indoor activities:  none 70, light 85, moderate 90, heavy 95, very_heavy 95   (indoor is better when it rains)
//     outdoor activities: see BASE below; heavy or very heavy rain -> 5..15 (waterfalls 5: slippery and flash floods)
//   then penalties: wind (avg/gust) >= cfg.comfort.windy_kmh: -30 for exposed activities; >= strong_kmh: -60;
//                   max temperature >= cfg.comfort.hot_c: -25 for hiking and cycling, -10 camping.
// A missing summary gives score null and reason trip.reason.no_data (nothing is invented).
// Opening hours are NOT available in our data, so nothing here ever says a place is open or closed.
import { getConfig } from "./config.js";
import { summariseDay } from "./intensity.js";

export const ACTIVITIES = {
  hiking:       { kind: "outdoor", key: "trip.act.hiking",       icon: "⛰️" },
  camping:      { kind: "outdoor", key: "trip.act.camping",      icon: "⛺" },
  beach:        { kind: "outdoor", key: "trip.act.beach",        icon: "🏖️" },
  waterfalls:   { kind: "outdoor", key: "trip.act.waterfalls",   icon: "💧" },
  photography:  { kind: "outdoor", key: "trip.act.photography",  icon: "📷" },
  wildlife:     { kind: "outdoor", key: "trip.act.wildlife",     icon: "🦌" },
  sightseeing:  { kind: "outdoor", key: "trip.act.sightseeing",  icon: "🏞️" },
  cycling:      { kind: "outdoor", key: "trip.act.cycling",      icon: "🚴" },
  museums:      { kind: "indoor",  key: "trip.act.museums",      icon: "🏛️" },
  restaurants:  { kind: "indoor",  key: "trip.act.restaurants",  icon: "🍽️" },
  culture:      { kind: "indoor",  key: "trip.act.culture",      icon: "🎭" },
  entertainment:{ kind: "indoor",  key: "trip.act.entertainment",icon: "🎟️" },
  shopping:     { kind: "indoor",  key: "trip.act.shopping",     icon: "🛍️" },
  workshops:    { kind: "indoor",  key: "trip.act.workshops",    icon: "🧵" },
};

// outdoor base score by rain class: [none, light, moderate, heavy, very_heavy]
const BASE = {
  hiking: [92, 55, 30, 10, 5], camping: [92, 50, 25, 10, 5], beach: [95, 45, 35, 10, 5], waterfalls: [90, 60, 35, 5, 0],
  photography: [90, 70, 45, 15, 5], wildlife: [92, 55, 35, 10, 5], sightseeing: [92, 72, 50, 15, 5], cycling: [92, 45, 30, 10, 5],
};
const INDOOR = [70, 85, 90, 95, 95];
const CLASSES = ["none", "light", "moderate", "heavy", "very_heavy"];
const EXPOSED = new Set(["hiking", "camping", "beach", "cycling", "photography", "wildlife", "waterfalls"]);

export const isOutdoor = (id) => ACTIVITIES[id]?.kind === "outdoor";
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

// -> { score: 0..100 | null, reason: {key, params} }
export function activitySuitability(id, summary, cfg) {
  const a = ACTIVITIES[id], c = cfg || getConfig();
  if (!a) return { score: null, reason: { key: "trip.reason.no_data", params: {} } };
  if (!summary || !summary.maxClass) return { score: null, reason: { key: "trip.reason.no_data", params: {} } };
  const ci = CLASSES.indexOf(summary.maxClass);
  const indoor = a.kind === "indoor";
  let score = indoor ? INDOOR[ci] : BASE[id][ci];
  const mm = summary.maxHourMm ?? 0;
  let reason;
  if (ci >= 3) reason = indoor ? { key: "trip.reason.indoor_instead", params: { mm } } : { key: "trip.reason.reschedule_heavy", params: { mm, hours: summary.wetHours ?? 0 } };
  else if (ci === 2) reason = indoor ? { key: "trip.reason.indoor_instead", params: { mm } } : { key: "trip.reason.moderate_rain_outdoor", params: { mm } };
  else if (ci === 1) reason = indoor || id === "sightseeing" || id === "photography" ? { key: "trip.reason.light_rain_ok", params: { mm } } : { key: "trip.reason.light_rain_outdoor", params: { mm } };
  else reason = indoor ? { key: "trip.reason.dry_indoor_fine", params: {} } : { key: "trip.reason.dry_good", params: {} };

  const wind = Math.max(summary.avgWind ?? 0, (summary.maxGust ?? 0) * 0.7);
  if (!indoor && EXPOSED.has(id)) {
    if (wind >= c.comfort.strong_kmh) { score -= 60; reason = { key: "trip.reason.strong_wind", params: { kmh: Math.round(wind) } }; }
    else if (wind >= c.comfort.windy_kmh) { score -= 30; if (ci <= 1) reason = { key: "trip.reason.windy", params: { kmh: Math.round(wind) } }; }
  }
  if (summary.maxTemp != null && summary.maxTemp >= c.comfort.hot_c && ["hiking", "cycling", "camping"].includes(id)) {
    score -= id === "camping" ? 10 : 25;
    if (ci <= 1) reason = { key: "trip.reason.hot", params: { c: Math.round(summary.maxTemp) } };
  }
  return { score: clamp(score), reason };
}

// The longest good outdoor window of a summary, or null.
function bestWindowOf(summary) {
  const w = summary?.goodWindows || [];
  return w.length ? w.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a)) : null;
}

// dest: destination object (its `activities` list decides what may be recommended). Give either `summary` or `hours` (24 rows).
// interests: activity ids the visitor likes (they get +8 and `interest:true`, never hide the others: indoor options matter when it rains).
// durationDays is accepted for callers that pass it, it does not change the day rules.
// -> [{id, kind, suitable, score, interest, bestWindow:{from,to}|null, reason:{key,params}}] best first.
export function recommendActivities({ dest, hours, summary, interests = [], durationDays, cfg } = {}) {
  const c = cfg || getConfig();
  const s = summary || (hours ? summariseDay(hours, c) : null);
  const offered = Array.isArray(dest?.activities) ? dest.activities.filter((id) => ACTIVITIES[id]) : [];
  const liked = new Set(interests || []);
  const out = offered.map((id) => {
    const { score, reason } = activitySuitability(id, s, c);
    const interest = liked.has(id);
    const adj = score === null ? null : clamp(score + (interest ? 8 : 0));
    const kind = ACTIVITIES[id].kind;
    return { id, kind, suitable: adj !== null && score >= 50, score: adj, interest, bestWindow: kind === "outdoor" && score !== null && score >= 50 ? bestWindowOf(s) : null, reason };
  });
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
}
