// Loads the static trip data files (data/trip/*.json, written by pipeline/trip). Any file may be missing: its part is then null
// and its name is added to `errors`, so a screen can say what is not available instead of failing. Loaded once and kept.
import { setFileConfig } from "./config.js";

const DATA = "../data/trip";
let cached = null;

async function getJson(name) {
  const r = await fetch(`${DATA}/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

export function loadTripData(force = false) {
  if (cached && !force) return cached;
  cached = (async () => {
    const files = { destinations: "destinations.json", history: "rainfall_history.json", config: "trip_config.json", snapshot: "forecast_snapshot.json",
      modelMeta: "model_metadata.json", env: "environmental_data.json", mlEstimates: "ml_estimates.json",
      climateExtras: "climate_extras.json", landCover: "land_cover.json" };
    const out = { errors: [] };
    await Promise.all(Object.entries(files).map(async ([key, name]) => {
      try { out[key] = await getJson(name); } catch (e) { out[key] = null; if (!["mlEstimates", "climateExtras", "landCover"].includes(key)) out.errors.push(name); }
    }));
    setFileConfig(out.config);
    out.destinations = out.destinations?.destinations || [];
    out.byId = new Map(out.destinations.map((d) => [d.id, d]));
    return out;
  })();
  return cached;
}
