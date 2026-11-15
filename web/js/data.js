// Loading the static JSON written by the pipeline. Format: docs/schema.md.
// The web app only READS these files; it never computes a signal itself.

const DATA = "../data";

let fromCache = false;      // true if any file came from the offline copy (see sw.js)

async function getJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  if (response.headers.get("x-mc-offline")) fromCache = true;
  return response.json();
}

// Returns { generated, offline, tanks: [{ ...tank from tanks.json, doc: <tank file or null> }] }
export async function loadAll() {
  fromCache = false;
  const list = await getJson(`${DATA}/tanks.json`);
  const tanks = await Promise.all(list.tanks.map(async (tank) => {
    try {
      return { ...tank, doc: await getJson(`${DATA}/tank/${tank.id}.json`) };
    } catch {
      return { ...tank, doc: null };     // no data file yet: the tank still shows on the map
    }
  }));
  return { generated: list.generated, offline: fromCache, tanks };
}

// The signal of a tank, or null if there's no result yet.
export function signalOf(tank) {
  return tank.doc?.result?.signal ?? null;
}

// The backtest results written by pipeline/validate.py, or null if the file isn't there.
export async function loadValidation() {
  try { return await getJson(`${DATA}/validation.json`); } catch { return null; }
}

// Where each crop number comes from, written by pipeline/crops.py (data/crop_sources.json), or null.
export async function loadCropSources() {
  try { return await getJson(`${DATA}/crop_sources.json`); } catch { return null; }
}

// Well-known places for the trip and event planner (data/places.json), or null if the file isn't there.
export async function loadPlaces() {
  try { return await getJson(`${DATA}/places.json`); } catch { return null; }
}

// The usual rain and heat of every month on a NASA POWER grid over Sri Lanka (data/climatology.json, written by pipeline/climatology.py), or null.
export async function loadClimatology() {
  try { return await getJson(`${DATA}/climatology.json`); } catch { return null; }
}
