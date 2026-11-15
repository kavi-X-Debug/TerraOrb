// Saved trips, packing lists and preferences for the trip planner. Everything lives in the browser (localStorage, keys start with "mc-trip-").
// Every storage access is wrapped in try/catch. If storage is blocked (private window, quota, no window) the values are kept in an
// in-memory map for the rest of the visit, so the screens keep working (nothing is then saved after the page is closed).
// No access happens at import time.

const mem = new Map();          // fallback copy of every key written during this visit
const memOnly = new Set();      // keys whose last write could not reach localStorage: read these from `mem`

function storage() { try { return globalThis.localStorage || null; } catch { return null; } }

export function readKey(key) {
  if (memOnly.has(key)) return mem.has(key) ? mem.get(key) : null;
  try {
    const s = storage();
    if (s) { const v = s.getItem(key); if (v !== null && v !== undefined) return v; return mem.has(key) && !s ? mem.get(key) : null; }
  } catch { /* fall through to memory */ }
  return mem.has(key) ? mem.get(key) : null;
}

export function writeKey(key, value) {
  mem.set(key, value);
  try {
    const s = storage();
    if (!s) { memOnly.add(key); return false; }
    s.setItem(key, value); memOnly.delete(key); return true;
  } catch { memOnly.add(key); return false; }
}

export function removeKey(key) {
  mem.delete(key); memOnly.delete(key);
  try { storage()?.removeItem(key); } catch { /* nothing to remove */ }
}

export function storageAvailable() {
  try { const s = storage(); if (!s) return false; s.setItem("mc-trip-probe", "1"); s.removeItem("mc-trip-probe"); return true; } catch { return false; }
}

// Test helper: forget the in-memory fallback.
export function resetMemory() { mem.clear(); memOnly.clear(); }

function readJson(key, fallback) {
  const raw = readKey(key);
  if (raw === null) return fallback;
  try { const v = JSON.parse(raw); return v === null || v === undefined ? fallback : v; } catch { return fallback; }
}
const writeJson = (key, v) => writeKey(key, JSON.stringify(v));

const TRIPS = "mc-trip-trips", PREFS = "mc-trip-prefs";
const packKey = (id) => `mc-trip-pack-${id}`;

export function newTripId() { return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }

export function listTrips() {
  const v = readJson(TRIPS, []);
  return Array.isArray(v) ? v.filter((t) => t && t.id) : [];
}
export function getTrip(id) { return listTrips().find((t) => t.id === id) || null; }

// Insert or replace (by id). A trip without an id gets one. Returns the saved trip, or null if it was not an object.
export function saveTrip(trip) {
  if (!trip || typeof trip !== "object") return null;
  const saved = { ...trip, id: trip.id || newTripId(), updatedAt: new Date().toISOString() };
  const all = listTrips(); const i = all.findIndex((t) => t.id === saved.id);
  if (i >= 0) all[i] = saved; else all.push(saved);
  writeJson(TRIPS, all);
  return saved;
}
export function deleteTrip(id) {
  writeJson(TRIPS, listTrips().filter((t) => t.id !== id));
  removeKey(packKey(id));
}

export function getPacking(tripId) { return readJson(packKey(tripId), null); }
export function savePacking(tripId, obj) { return writeJson(packKey(tripId), obj); }

export function getPrefs() { const v = readJson(PREFS, null); return v && typeof v === "object" ? v : null; }
export function savePrefs(p) { return writeJson(PREFS, p || {}); }

// The time the forecast of a destination was last fetched (ISO string written by forecast.js), or null.
export function getLastForecastStamp(id) {
  const v = readJson(`mc-trip-fc-${id}`, null);
  return v && typeof v.fetchedAt === "string" ? v.fetchedAt : null;
}
