// Packing assistant (pure, no DOM). Builds a packing list from the weather of the trip, the planned activities and the destination,
// then merges what the visitor saved. Item texts are keys ("trip.pack.<id>"); the reason of every automatic item is a key + params.
//
// Rules (DRAFT, simple and readable):
//   rain:       umbrella and raincoat when any rain class, a chance >= cfg.verdict.maybe_chance or rain >= cfg.verdict.maybe_mm;
//               waterproof bag + quick-dry clothes from moderate rain; spare socks from heavy rain or when hiking/waterfalls.
//   clothing:   light clothes when max temp >= 30; warm layer when min temp < cfg.comfort.cold_c or the place is >= 1000 m;
//               hat + sunglasses + sunscreen on dry hot days; windbreaker when wind >= cfg.comfort.windy_kmh.
//   outdoor:    hiking shoes (hiking, waterfalls, camping), water shoes (beach, waterfalls), swimwear (beach), insect repellent (hiking,
//               camping, wildlife, forest, or wet weather), leech socks (hiking in rain at a forest place), binoculars (wildlife),
//               tent + torch (camping), camera rain cover (photography in rain).
//   essentials: documents, phone charger, power bank, water bottle (outdoor activities), first aid kit (outdoor), cash.
// With no weather data no weather item is invented, only an umbrella with the reason "weather unknown".
// `saved` (kept by the screens through store.js) = { added:[{id,category,name,qty,checked}], removed:[itemId], checked:{itemId:true}, nextId }.
import { getConfig } from "./config.js";
import { ACTIVITIES } from "./activities.js";
import { INTENSITY } from "./intensity.js";

export const PACKING_CATEGORIES = [
  { id: "rain", key: "trip.packcat.rain" },
  { id: "clothing", key: "trip.packcat.clothing" },
  { id: "outdoor", key: "trip.packcat.outdoor" },
  { id: "essentials", key: "trip.packcat.essentials" },
];
const R = (key, params = {}) => ({ key, params });
const rank = (c) => (c ? INTENSITY[c].rank : -1);

export function buildPacking({ dest, summary, activities = [], durationDays = 1, prefs, saved, cfg } = {}) {
  const c = cfg || getConfig();
  const s = summary || null;
  const acts = new Set((activities || []).map((a) => (typeof a === "string" ? a : a?.id)).filter((id) => ACTIVITIES[id]));
  const has = (...ids) => ids.some((i) => acts.has(i));
  const days = Math.max(1, Math.min(14, Math.round(Number(durationDays) || 1)));
  const items = { rain: [], clothing: [], outdoor: [], essentials: [] };
  const add = (cat, id, reason, qty = 1) => items[cat].push({ id, key: `trip.pack.${id}`, qty, auto: true, reason, checked: false });

  const known = !!s && (s.maxClass || s.totalMm != null || s.maxChance != null);
  const cls = rank(s?.maxClass), mm = s?.totalMm ?? 0, ch = s?.maxChance ?? 0;
  const rainy = known && (cls >= 1 || ch >= c.verdict.maybe_chance || mm >= c.verdict.maybe_mm);
  const params = { mm: s?.totalMm ?? null, pct: s?.maxChance ?? null };
  if (!known) add("rain", "umbrella", R("trip.packwhy.weather_unknown"));
  if (rainy) {
    add("rain", "umbrella", R("trip.packwhy.rain_expected", params));
    add("rain", "raincoat", R("trip.packwhy.rain_expected", params));
  }
  if (known && cls >= 2) {
    add("rain", "waterproof_bag", R("trip.packwhy.moderate_rain", params));
    add("rain", "quick_dry", R("trip.packwhy.moderate_rain", params), days);
  }
  if (known && (cls >= 3 || (rainy && has("hiking", "waterfalls")))) add("rain", "spare_socks", R(cls >= 3 ? "trip.packwhy.heavy_rain" : "trip.packwhy.wet_trails", params), days);

  if (known && s.maxTemp != null && s.maxTemp >= 30) add("clothing", "light_clothes", R("trip.packwhy.hot", { c: Math.round(s.maxTemp) }), days);
  if ((known && s.minTemp != null && s.minTemp < c.comfort.cold_c) || (dest?.elevation_m ?? 0) >= 1000) add("clothing", "warm_layer", R("trip.packwhy.cool", { c: s?.minTemp != null ? Math.round(s.minTemp) : null, m: dest?.elevation_m ?? null }));
  if (known && !rainy && s.maxTemp != null && s.maxTemp >= 30) {
    add("clothing", "hat", R("trip.packwhy.sun")); add("clothing", "sunglasses", R("trip.packwhy.sun")); add("clothing", "sunscreen", R("trip.packwhy.sun"));
  }
  if (known && Math.max(s.avgWind ?? 0, 0.7 * (s.maxGust ?? 0)) >= c.comfort.windy_kmh) add("clothing", "windbreaker", R("trip.packwhy.windy"));

  if (has("hiking", "waterfalls", "camping")) add("outdoor", "hiking_shoes", R(`trip.packwhy.for_${has("hiking") ? "hiking" : has("waterfalls") ? "waterfalls" : "camping"}`));
  if (has("beach", "waterfalls")) add("outdoor", "water_shoes", R(`trip.packwhy.for_${has("beach") ? "beach" : "waterfalls"}`));
  if (has("beach")) add("outdoor", "swimwear", R("trip.packwhy.for_beach"));
  if (has("hiking", "camping", "wildlife") || (dest?.kinds || []).includes("forest") || rainy) add("outdoor", "insect_repellent", R("trip.packwhy.insects"));
  if (has("hiking") && rainy && (dest?.kinds || []).includes("forest")) add("outdoor", "leech_socks", R("trip.packwhy.leeches"));
  if (has("wildlife")) add("outdoor", "binoculars", R("trip.packwhy.for_wildlife"));
  if (has("camping")) { add("outdoor", "tent", R("trip.packwhy.for_camping")); add("outdoor", "torch", R("trip.packwhy.for_camping")); }
  if (has("photography") && rainy) add("outdoor", "camera_cover", R("trip.packwhy.rain_expected", params));

  const outdoor = [...acts].some((id) => ACTIVITIES[id].kind === "outdoor");
  add("essentials", "documents", R("trip.packwhy.always"));
  add("essentials", "phone_charger", R("trip.packwhy.always"));
  add("essentials", "power_bank", R("trip.packwhy.always"));
  add("essentials", "cash", R("trip.packwhy.always"));
  if (outdoor) { add("essentials", "water_bottle", R("trip.packwhy.outdoor")); add("essentials", "first_aid", R("trip.packwhy.outdoor")); }

  // merge the visitor's saved changes
  const sv = saved && typeof saved === "object" ? saved : {};
  const removed = new Set(sv.removed || []), checked = sv.checked || {};
  const categories = PACKING_CATEGORIES.map((cat) => {
    const auto = items[cat.id].filter((i) => !removed.has(i.id)).map((i) => ({ ...i, checked: !!checked[i.id] }));
    const manual = (sv.added || []).filter((m) => m && m.category === cat.id)
      .map((m) => ({ id: m.id, key: null, name: String(m.name ?? ""), qty: m.qty ?? 1, auto: false, reason: null, checked: !!(m.checked || checked[m.id]) }));
    return { id: cat.id, key: cat.key, items: [...auto, ...manual] };
  });
  return { categories };
}

const clone = (s) => ({ added: [...(s?.added || [])], removed: [...(s?.removed || [])], checked: { ...(s?.checked || {}) }, nextId: s?.nextId || 1 });

// Tick / untick an item (automatic or manual). Pure: returns a new `saved` object.
export function togglePackingItem(saved, itemId) {
  const s = clone(saved);
  if (s.checked[itemId]) delete s.checked[itemId]; else s.checked[itemId] = true;
  return s;
}

// Add a manual item { category, name, qty } (category must be one of the four ids). Returns a new `saved`; unknown category -> unchanged copy.
export function addPackingItem(saved, { category, name, qty = 1 } = {}) {
  const s = clone(saved);
  const text = String(name ?? "").trim();
  if (!text || !PACKING_CATEGORIES.some((c) => c.id === category)) return s;
  s.added.push({ id: `m-${s.nextId}`, category, name: text.slice(0, 80), qty: Math.max(1, Math.round(Number(qty) || 1)) });
  s.nextId += 1;
  return s;
}

// Remove an item: a manual item is deleted, an automatic item is remembered as removed (so it stays removed when the list is rebuilt).
export function removePackingItem(saved, itemId) {
  const s = clone(saved);
  delete s.checked[itemId];
  if (String(itemId).startsWith("m-")) s.added = s.added.filter((m) => m.id !== itemId);
  else if (!s.removed.includes(itemId)) s.removed.push(itemId);
  return s;
}

// Bring back every automatic item the visitor removed.
export function restorePackingItems(saved) { const s = clone(saved); s.removed = []; return s; }
