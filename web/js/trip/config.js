// Trip planner settings. Three layers, later ones win:
//   1. DEFAULTS below (the same numbers as [trip] in pipeline/config.toml and data/trip/trip_config.json),
//   2. data/trip/trip_config.json (written by the data pipeline from config.toml), loaded by data.js,
//   3. the visitor's own changes on the Settings screen (localStorage "mc-trip-settings").
// All thresholds and weights used by the trip logic come from here, so they can be changed without touching the code.
// The values are DRAFT rules of thumb for planning, not an official standard (the weights are NOT a scientific safety index).

export const DEFAULTS = {
  intensity: { unit: "mm/hour", light_min: 0.1, moderate_min: 2.5, heavy_min: 10, very_heavy_min: 50 },
  no_rain_day_mm: 0.1,
  wet_day_mm: 1.0,
  forecast_horizon_days: 16,
  cache_minutes: 30,
  verdict: { wet_mm: 3, wet_chance: 70, maybe_mm: 0.5, maybe_chance: 35 },
  comfort: { temp_ideal_min: 22, temp_ideal_max: 32, hot_c: 34, cold_c: 16, windy_kmh: 40, strong_kmh: 60 },
  weights: { weather: 0.40, activity: 0.25, preference: 0.20, environment: 0.15 },
  day_periods: { night: [0, 5], morning: [6, 11], afternoon: [12, 17], evening: [18, 23] },
};

const KEY = "mc-trip-settings";
let fromFile = null;                                   // set by data.js once data/trip/trip_config.json is loaded

export function setFileConfig(obj) { fromFile = obj && typeof obj === "object" ? obj : null; }

// Merge two plain config objects one level deep (so a partial override of "weights" keeps the other weights).
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object" ? { ...base[k], ...v } : v;
  }
  return out;
}

function readSettings() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function getConfig() {
  return merge(merge(DEFAULTS, fromFile), readSettings());
}

export function saveSettings(overrides) {
  try { localStorage.setItem(KEY, JSON.stringify(overrides || {})); return true; } catch { return false; }
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked: nothing to reset */ }
}

export function getSettingsOverrides() { return readSettings(); }
