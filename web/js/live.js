// Live weather "right now" for the tanks: temperature, rain, humidity, wind, cloud.
//
// From weather models and stations through the free Open-Meteo API. It is NOT NASA data
// and is labelled that way. Nothing here is saved or guessed: if the phone is offline or
// the service doesn't answer, there is simply no live weather to show.
//
// One request covers up to 50 tanks, so all 103 tanks need three requests. Results are
// kept for 10 minutes (Open-Meteo itself updates every 15 minutes).
const API = "https://api.open-meteo.com/v1/forecast";
const FIELDS = "temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,weather_code,is_day";
const BATCH = 50;
const FRESH_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10000;

const cache = new Map();                         // tank id → { at: ms, data: {...} }

function normalise(current) {
  return {
    time: current.time,                          // local time at the tank, "2026-10-25T18:30"
    temp: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    rain_mm: current.precipitation,              // mm in the last hour
    cloud: current.cloud_cover,
    wind_kmh: current.wind_speed_10m,
    code: current.weather_code,                  // WMO weather code
    day: current.is_day === 1,
  };
}

async function fetchBatch(tanks) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${API}?latitude=${tanks.map((t) => t.lat.toFixed(4)).join(",")}`
      + `&longitude=${tanks.map((t) => t.lon.toFixed(4)).join(",")}`
      + `&current=${FIELDS}&timezone=Asia%2FColombo`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return;
    const data = await response.json();
    const results = Array.isArray(data) ? data : [data];
    if (results.length !== tanks.length) return;           // never match answers to the wrong tank
    const now = Date.now();
    results.forEach((r, i) => { if (r.current) cache.set(tanks[i].id, { at: now, data: normalise(r.current) }); });
  } catch { /* offline, slow or blocked: those tanks just have no live weather */ }
  finally { clearTimeout(timer); }
}

// Returns a Map: tank id → current weather, for every tank that could be loaded.
export async function loadLive(tanks, { force = false } = {}) {
  const now = Date.now();
  const need = tanks.filter((t) => force || !cache.has(t.id) || now - cache.get(t.id).at > FRESH_MS);
  const batches = [];
  for (let i = 0; i < need.length; i += BATCH) batches.push(fetchBatch(need.slice(i, i + BATCH)));
  await Promise.all(batches);
  const out = new Map();
  for (const t of tanks) if (cache.has(t.id)) out.set(t.id, cache.get(t.id).data);
  return out;
}

// "2026-10-25T18:30" → "18:30"
export function clock(iso) {
  return iso ? String(iso).slice(11, 16) : "";
}
