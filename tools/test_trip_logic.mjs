// Run: node tools/test_trip_logic.mjs
// Tests for the pure trip planner modules in web/js/trip/. Every forecast, history and destination below is a small SYNTHETIC TEST FIXTURE
// (not real data). The modules import cleanly in Node: no DOM, localStorage guarded.
import assert from "node:assert/strict";
const T = (n) => import(new URL(`../web/js/trip/${n}.js`, import.meta.url).href);
const [intensity, forecast, history, scoring, dates, activities, packing, itinerary, store, config] =
  await Promise.all(["intensity", "forecast", "history", "scoring", "dates", "activities", "packing", "itinerary", "store", "config"].map(T));
const cfg = config.DEFAULTS;
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error("FAILED:", name); throw e; } };
const testA = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error("FAILED:", name); throw e; } };

// ---- fixtures ---------------------------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
// forecast fixture: days = ["YYYY-MM-DD", ...], rain(date, clockHour) -> mm in that clock hour (hour h = entry stamped h+1)
function fixtureForecast(days, rain = () => 0, extra = {}) {
  const time = [], precipitation = [], precipitation_probability = [], temperature_2m = [], relative_humidity_2m = [], wind_speed_10m = [], wind_gusts_10m = [], weather_code = [];
  const lastNext = history.addDays(days[days.length - 1], 1);
  const stamps = [];
  for (const d of days) for (let h = 0; h < 24; h++) stamps.push([d, h]);
  stamps.push([lastNext, 0]);
  for (const [d, h] of stamps) {
    time.push(`${d}T${pad(h)}:00`);
    const mm = h === 0 ? rain(history.addDays(d, -1), 23) : rain(d, h - 1);   // the entry stamped h:00 is the hour h-1..h
    precipitation.push(mm === null ? 0 : mm);
    precipitation_probability.push(extra.chance ? extra.chance(d, h) : (precipitation.at(-1) > 0 ? 80 : 5));
    temperature_2m.push(extra.temp ? extra.temp(d, h) : 28); relative_humidity_2m.push(75);
    wind_speed_10m.push(extra.wind ? extra.wind(d, h) : 10); wind_gusts_10m.push(extra.gust ? extra.gust(d, h) : 18); weather_code.push(0);
  }
  const daily = { time: days, precipitation_sum: days.map((d) => { let s = 0; for (let h = 0; h < 24; h++) s += rain(d, h); return s; }),
    precipitation_probability_max: days.map(() => 50), temperature_2m_max: days.map(() => 31), temperature_2m_min: days.map(() => 23),
    wind_speed_10m_max: days.map(() => 15), sunrise: days.map((d) => `${d}T06:00`), sunset: days.map((d) => `${d}T18:00`) };
  return { ok: true, source: "Open-Meteo", not_nasa: true, fetchedAt: "2026-11-15T08:00:00+05:30", stale: false, error: null, hourly: { time, precipitation, precipitation_probability, temperature_2m, relative_humidity_2m, wind_speed_10m, wind_gusts_10m, weather_code }, daily };
}
const TODAY = "2026-11-15";
const d = (n) => history.addDays(TODAY, n);
const dest = (o = {}) => ({ id: "x", name_en: "Test place", lat: 7.29, lon: 80.63, region: "Central", kinds: ["hill", "waterfall"], cost_level: 2, cell: "c1",
  activities: ["hiking", "waterfalls", "photography", "sightseeing", "museums", "restaurants"], elevation_m: 500, ...o });
// history fixture: cell c1 wet 60% everywhere with 4 mm mean, cell c2 dry; cell absent = unknown
const flat = (v) => Array(366).fill(v);
const hist = { schema: "trip-history-1", years: 45, cells: { c1: { p_wet: flat(0.6), mean_mm: flat(4), p90_mm: flat(12) }, c2: { p_wet: flat(0.1), mean_mm: flat(0.5), p90_mm: flat(3) } } };
hist.cells.c1.p_wet[100] = 0.9;                                  // index 100 = 11 Apr in a non-leap year

// ---- intensity --------------------------------------------------------------------------------------------------------
test("classifyHour boundaries", () => {
  const c = intensity.classifyHour;
  assert.equal(c(0, cfg), "none"); assert.equal(c(0.09, cfg), "none"); assert.equal(c(0.1, cfg), "light");
  assert.equal(c(2.49, cfg), "light"); assert.equal(c(2.5, cfg), "moderate");
  assert.equal(c(9.99, cfg), "moderate"); assert.equal(c(10, cfg), "heavy");
  assert.equal(c(50, cfg), "heavy"); assert.equal(c(50.01, cfg), "very_heavy");
  assert.equal(c(null, cfg), "none"); assert.equal(c(NaN, cfg), "none"); assert.equal(c(undefined), "none");
  assert.equal(intensity.INTENSITY.heavy.key, "trip.int.heavy");
  assert.ok(intensity.INTENSITY.very_heavy.rank > intensity.INTENSITY.heavy.rank);
});
test("classifyHour follows custom thresholds", () => {
  const custom = { ...cfg, intensity: { ...cfg.intensity, heavy_min: 20 } };
  assert.equal(intensity.classifyHour(15, custom), "moderate");
});
test("periodOf", () => {
  const p = intensity.periodOf;
  assert.equal(p(0, cfg), "night"); assert.equal(p(5, cfg), "night"); assert.equal(p(6, cfg), "morning"); assert.equal(p(11, cfg), "morning");
  assert.equal(p(12, cfg), "afternoon"); assert.equal(p(17, cfg), "afternoon"); assert.equal(p(18, cfg), "evening"); assert.equal(p(23, cfg), "evening");
});
const rowsFrom = (fn) => Array.from({ length: 24 }, (_, h) => ({ h, mm: 0, chance: 5, temp: 28, rh: 70, wind: 10, gust: 15, code: 0, ...fn(h) }));
test("summariseDay: periods, totals and good windows", () => {
  const rows = rowsFrom((h) => (h >= 13 && h <= 15 ? { mm: 12, chance: 90 } : h === 20 ? { mm: 0.5, chance: 40 } : {}));
  const s = intensity.summariseDay(rows, cfg);
  assert.equal(s.totalMm, 36.5); assert.equal(s.maxHourMm, 12); assert.equal(s.maxClass, "heavy"); assert.equal(s.wetHours, 4);
  assert.equal(s.firstWetHour, 13); assert.equal(s.lastWetHour, 20); assert.equal(s.durationHours, 8); assert.equal(s.maxChance, 90);
  assert.equal(s.byPeriod.afternoon.totalMm, 36); assert.equal(s.byPeriod.afternoon.maxClass, "heavy"); assert.equal(s.byPeriod.morning.maxClass, "none");
  assert.equal(s.byPeriod.evening.wetHours, 1); assert.equal(s.byPeriod.night.totalMm, 0);
  assert.deepEqual(s.goodWindows, [{ from: 6, to: 13 }, { from: 16, to: 19 }]);   // dry before the storm and again after it
});
test("summariseDay: a dry day has one big window; missing data is null, not zero", () => {
  const dry = intensity.summariseDay(rowsFrom(() => ({})), cfg);
  assert.equal(dry.totalMm, 0); assert.equal(dry.maxClass, "none"); assert.equal(dry.firstWetHour, null); assert.equal(dry.durationHours, 0);
  assert.deepEqual(dry.goodWindows, [{ from: 6, to: 19 }]);
  for (const bad of [null, undefined, [], rowsFrom(() => ({ mm: null, chance: null, temp: null, rh: null, wind: null, gust: null }))]) {
    const s = intensity.summariseDay(bad, cfg);
    assert.equal(s.hasData, false); assert.equal(s.totalMm, null); assert.equal(s.maxClass, null); assert.equal(s.avgTemp, null); assert.deepEqual(s.goodWindows, []);
  }
});
test("summariseDay: a daily total is never classed (only hours are)", () => {
  const rows = rowsFrom((h) => (h < 24 ? { mm: 3 } : {}));                // 24 x 3 mm = 72 mm in a day, but every HOUR is moderate
  const s = intensity.summariseDay(rows, cfg);
  assert.equal(s.totalMm, 72); assert.equal(s.maxClass, "moderate");
});

// ---- history ----------------------------------------------------------------------------------------------------------
test("dayIndex: Feb 29 -> 59, same as Mar 1; non-leap indexing", () => {
  assert.equal(history.dayIndex("2026-01-01"), 0); assert.equal(history.dayIndex("2026-12-31"), 364);
  assert.equal(history.dayIndex("2024-02-29"), 59); assert.equal(history.dayIndex("2026-03-01"), 59); assert.equal(history.dayIndex("2024-03-01"), 59);
  assert.equal(history.dayIndex("2024-12-31"), 364); assert.equal(history.dayIndex("2026-04-11"), 100);
  assert.equal(history.dayIndex("2026-02-30"), null); assert.equal(history.dayIndex("nonsense"), null); assert.equal(history.dayIndex(null), null);
});
test("tendencyFor / rangeTendency", () => {
  const t = history.tendencyFor(hist, "c1", "2026-04-11");
  assert.equal(t.kind, "historical_tendency"); assert.equal(t.pWet, 0.9); assert.equal(t.meanMm, 4); assert.equal(t.source, "NASA POWER");
  assert.equal(history.tendencyFor(hist, "missing", "2026-04-11"), null); assert.equal(history.tendencyFor(null, "c1", "2026-04-11"), null);
  assert.equal(history.tendencyFor(hist, "c1", "bad"), null);
  const r = history.rangeTendency(hist, "c1", "2026-04-10", "2026-04-12");
  assert.equal(r.days, 3); assert.ok(Math.abs(r.pWetAvg - (0.6 + 0.9 + 0.6) / 3) < 1e-9); assert.equal(r.meanMmTotal, 12);
  assert.equal(history.rangeTendency(hist, "c1", "2026-04-12", "2026-04-10"), null); assert.equal(history.rangeTendency(hist, "none", "2026-04-10", "2026-04-12"), null);
});
await testA("loadHistory returns null on failure, object on success", async () => {
  history.resetHistoryCache();
  assert.equal(await history.loadHistory({ fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await history.loadHistory({ fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal((await history.loadHistory({ fetchImpl: async () => ({ ok: true, json: async () => hist }) })).years, 45);
  history.resetHistoryCache();
});

// ---- forecast helpers and client --------------------------------------------------------------------------------------
test("hoursOf: the hour ending at stamp T belongs to clock hour T-1; missing -> nulls", () => {
  const f = fixtureForecast([TODAY, d(1)], (day, h) => (day === TODAY && h === 14 ? 6 : day === TODAY && h === 23 ? 1.5 : 0));
  const rows = forecast.hoursOf(f, TODAY);
  assert.equal(rows.length, 24); assert.equal(rows[14].mm, 6); assert.equal(rows[13].mm, 0); assert.equal(rows[23].mm, 1.5);
  assert.equal(rows[14].temp, 28); assert.equal(rows[0].rh, 75); assert.equal(rows[3].wind, 10);
  const none = forecast.hoursOf(f, d(40)); assert.equal(none.length, 24); assert.ok(none.every((r) => r.mm === null && r.temp === null));
  assert.ok(forecast.hoursOf(null, TODAY).every((r) => r.mm === null));
  assert.equal(forecast.hasRain(none), false); assert.equal(forecast.hasRain(rows), true);
});
test("dailyOf and dayKind", () => {
  const f = fixtureForecast([TODAY]);
  assert.equal(forecast.dailyOf(f, TODAY).tmax, 31); assert.equal(forecast.dailyOf(f, d(3)), null); assert.equal(forecast.dailyOf({ ok: false }, TODAY), null);
  assert.equal(forecast.dayKind(TODAY, TODAY, cfg), "forecast"); assert.equal(forecast.dayKind(d(15), TODAY, cfg), "forecast");
  assert.equal(forecast.dayKind(d(16), TODAY, cfg), "tendency"); assert.equal(forecast.dayKind(d(-1), TODAY, cfg), "tendency"); assert.equal(forecast.dayKind("bad", TODAY, cfg), "tendency");
});
const fakeJson = (body) => async () => ({ ok: true, json: async () => body });
const liveBody = () => { const f = fixtureForecast([TODAY]); return { hourly: f.hourly, daily: f.daily }; };
await testA("loadForecast: live, cache, stale fallback, snapshot, failure", async () => {
  store.resetMemory(); forecast.clearForecastCache();
  const place = { id: "kandy", lat: 7.29, lon: 80.63 };
  let calls = 0, lastUrl = "";
  const ok = async (url) => { calls++; lastUrl = url; return fakeJson(liveBody())(); };
  const now = Date.parse("2026-11-15T10:00:00Z");
  const a = await forecast.loadForecast(place, { fetchImpl: ok, now });
  assert.equal(a.ok, true); assert.equal(a.stale, false); assert.equal(a.not_nasa, true); assert.equal(a.source, "Open-Meteo"); assert.equal(a.fetchedAt, new Date(now).toISOString());
  for (const p of ["relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m", "weather_code", "precipitation_probability", "timezone=Asia%2FColombo", "forecast_days=16", "sunrise"]) assert.ok(lastUrl.includes(p), p);
  await forecast.loadForecast(place, { fetchImpl: ok, now: now + 60000 });                       // within 30 minutes: cached, no new request
  assert.equal(calls, 1);
  await forecast.loadForecast(place, { fetchImpl: ok, now: now + 60000, force: true }); assert.equal(calls, 2);
  assert.equal(store.getLastForecastStamp("kandy"), new Date(now + 60000).toISOString());
  // network down later: the cached copy comes back marked stale, never as current
  const down = async () => { throw new Error("offline"); };
  const s = await forecast.loadForecast(place, { fetchImpl: down, now: now + 3 * 3600000 });
  assert.equal(s.ok, true); assert.equal(s.stale, true); assert.equal(s.fetchedAt, new Date(now + 60000).toISOString()); assert.match(s.error, /offline/);
  // nothing cached: the static snapshot, stale and flagged
  store.resetMemory(); forecast.clearForecastCache();
  const snap = { fetched_at: "2026-11-14T06:00:00+05:30", destinations: { kandy: { hourly: liveBody().hourly, daily: liveBody().daily } } };
  const f2 = async (url) => (String(url).includes("forecast_snapshot") ? { ok: true, json: async () => snap } : down());
  const sn = await forecast.loadForecast(place, { fetchImpl: f2, now });
  assert.equal(sn.ok, true); assert.equal(sn.stale, true); assert.equal(sn.snapshot, true); assert.equal(sn.fetchedAt, "2026-11-14T06:00:00+05:30");
  // nothing at all
  store.resetMemory(); forecast.clearForecastCache();
  const bad = await forecast.loadForecast({ id: "zzz", lat: 1, lon: 2 }, { fetchImpl: down, now });
  assert.equal(bad.ok, false); assert.ok(bad.error);
  // HTTP error and an empty body are failures too; invalid destination is rejected
  forecast.clearForecastCache(); store.resetMemory();
  assert.equal((await forecast.loadForecast({ id: "e1", lat: 1, lon: 2 }, { fetchImpl: async () => ({ ok: false, status: 500 }), now })).ok, false);
  assert.equal((await forecast.loadForecast({ id: "e2", lat: 1, lon: 2 }, { fetchImpl: fakeJson({ hourly: { time: [] } }), now })).ok, false);
  assert.equal((await forecast.loadForecast(null)).ok, false);
});
await testA("loadForecasts limits concurrency and tolerates one failure", async () => {
  store.resetMemory(); forecast.clearForecastCache();
  let running = 0, peak = 0;
  const impl = async (url) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    if (String(url).includes("latitude=3")) throw new Error("boom");
    return fakeJson(liveBody())();
  };
  const dests = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, lat: i, lon: 80 }));
  const m = await forecast.loadForecasts(dests, { fetchImpl: impl, limit: 3, force: true, now: Date.now() });
  assert.equal(m.size, 9); assert.ok(peak <= 3, `peak ${peak}`);
  assert.equal(m.get("p3").ok, false); assert.equal(m.get("p4").ok, true);
  forecast.clearForecastCache(); store.resetMemory();
});

// ---- scoring ----------------------------------------------------------------------------------------------------------
const drySummary = () => intensity.summariseDay(rowsFrom(() => ({ chance: 5 })), cfg);
const wetSummary = () => intensity.summariseDay(rowsFrom((h) => (h >= 10 && h <= 17 ? { mm: 14, chance: 95 } : {})), cfg);
test("weatherScore: dry day high, wet day low, reasons are keys", () => {
  const dry = scoring.weatherScore(drySummary(), {}, cfg), wet = scoring.weatherScore(wetSummary(), {}, cfg);
  assert.ok(dry.score > 90, String(dry.score)); assert.ok(wet.score < 25, String(wet.score));
  assert.ok(dry.reasons.some((r) => r.key === "trip.reason.dry_day")); assert.ok(wet.reasons.some((r) => r.key === "trip.reason.heavy_rain" && r.params.mm === 14));
  for (const r of [...dry.reasons, ...wet.reasons]) { assert.match(r.key, /^trip\.reason\./); assert.equal(typeof r.params, "object"); }
  for (const v of Object.values(wet.parts)) assert.ok(v === null || (v >= 0 && v <= 100));
});
test("weatherScore: maxRainMm preference and null data", () => {
  const s = intensity.summariseDay(rowsFrom((h) => (h === 12 ? { mm: 2 } : {})), cfg);
  assert.ok(scoring.weatherScore(s, { maxRainMm: 20 }, cfg).parts.rain > scoring.weatherScore(s, { maxRainMm: 2 }, cfg).parts.rain);
  const none = scoring.weatherScore(null, {}, cfg); assert.equal(none.score, null); assert.equal(none.reasons[0].key, "trip.reason.no_data");
  const tend = scoring.weatherScore({ totalMm: 4, maxChance: 60 }, {}, cfg);        // a tendency-like summary: only rain and chance parts
  assert.ok(tend.score > 0 && tend.score < 100); assert.equal(tend.parts.heavy, null); assert.equal(tend.parts.temp, null);
});
test("weights: formula, custom weights re-normalised", () => {
  const dst = dest(), sum = drySummary(), prefs = { interests: ["hiking"], budget: 2, region: "Central", style: "adventurous" };
  const r = scoring.destinationScore({ dest: dst, summary: sum, prefs, env: { slope_pct: 10, ndvi: 0.8 }, cfg });
  const w = cfg.weights;
  const expect = (w.weather * r.W + w.activity * r.A + w.preference * r.P + w.environment * r.E) / (w.weather + w.activity + w.preference + w.environment);
  assert.ok(Math.abs(r.S - expect) < 0.11, `${r.S} vs ${expect}`);
  assert.equal(r.notAScientificIndex, true);
  // weights that sum to 4 give the same answer as the normalised ones
  const big = { ...cfg, weights: { weather: 1.6, activity: 1.0, preference: 0.8, environment: 0.6 } };
  const r2 = scoring.destinationScore({ dest: dst, summary: sum, prefs, env: { slope_pct: 10, ndvi: 0.8 }, cfg: big });
  assert.ok(Math.abs(r2.S - r.S) < 0.11); assert.ok(Math.abs(Object.values(r2.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // only weather counts
  const only = scoring.destinationScore({ dest: dst, summary: sum, prefs, cfg: { ...cfg, weights: { weather: 1, activity: 0, preference: 0, environment: 0 } } });
  assert.equal(only.S, only.W);
  const nw = scoring.normaliseWeights({ weather: 0, activity: 0, preference: 0, environment: 0 }); assert.equal(nw.weather, 0.25);
  assert.equal(scoring.normaliseWeights({ weather: -1, activity: 2 }).activity, 1);
  // a null component is left out, not counted as zero
  const noP = scoring.destinationScore({ dest: dst, summary: sum, prefs: null, cfg }); assert.equal(noP.P, null); assert.ok(noP.S > 50);
  const nothing = scoring.destinationScore({ dest: null, summary: null, prefs: null, cfg }); assert.equal(nothing.S, null);
});
test("sub-scores: activities, preference, environment", () => {
  const a = scoring.activityScore(dest(), wetSummary(), { interests: ["hiking"] }, cfg), b = scoring.activityScore(dest(), wetSummary(), { interests: ["museums"] }, cfg);
  assert.ok(b.score > a.score);
  assert.equal(scoring.activityScore(dest({ activities: [] }), wetSummary(), {}, cfg).score, null);
  assert.equal(scoring.preferenceScore(dest(), null), null);
  assert.equal(scoring.preferenceScore(dest(), { interests: ["hiking", "beach"] }), 50);
  assert.ok(scoring.preferenceScore(dest({ cost_level: 3 }), { budget: 1 }) < scoring.preferenceScore(dest({ cost_level: 1 }), { budget: 1 }));
  assert.equal(scoring.environmentScore(dest(), {}), null);
  assert.ok(scoring.environmentScore(dest(), { slope_pct: 40 }) < scoring.environmentScore(dest(), { slope_pct: 5 }));
  const steep = scoring.destinationScore({ dest: dest(), summary: wetSummary(), prefs: {}, env: { slope_pct: 35 }, cfg });
  assert.ok(steep.reasons.some((r) => r.key === "trip.reason.steep_wet"));
});
test("rankDestinations: four sort modes, nulls last, input not mutated", () => {
  const list = [
    { id: "a", S: 60, A: 50, rainMm: 5, pRain: 40 }, { id: "b", S: 80, A: 40, rainMm: 12, pRain: 20 }, { id: "c", S: 70, A: 90, rainMm: 1, pRain: 60 },
    { id: "n", S: null, A: null, rainMm: null, pRain: null },
  ];
  const copy = JSON.stringify(list);
  const ids = (m) => scoring.rankDestinations(list, m).map((x) => x.id).join("");
  assert.equal(ids("best_score"), "bcan"); assert.equal(ids("best_activity"), "cabn"); assert.equal(ids("lowest_rain"), "cabn"); assert.equal(ids("lowest_chance"), "bacn");
  assert.equal(ids("unknown_mode"), "bcan");
  assert.equal(JSON.stringify(list), copy);
  assert.deepEqual(scoring.rankDestinations([{ id: "z", score: { S: 1 } }, { id: "y", score: { S: 9 } }], "best_score").map((x) => x.id), ["y", "z"]);
  assert.deepEqual(scoring.rankDestinations(null, "best_score"), []);
});

// ---- activities -------------------------------------------------------------------------------------------------------
test("activity catalogue", () => {
  const ids = ["hiking", "camping", "beach", "waterfalls", "photography", "wildlife", "sightseeing", "cycling", "museums", "restaurants", "culture", "entertainment", "shopping", "workshops"];
  assert.deepEqual(Object.keys(activities.ACTIVITIES).sort(), [...ids].sort());
  for (const id of ids) { const a = activities.ACTIVITIES[id]; assert.ok(["outdoor", "indoor"].includes(a.kind)); assert.equal(a.key, `trip.act.${id}`); assert.ok(a.icon); }
});
test("recommendActivities: heavy rain -> indoor first, outdoor to reschedule", () => {
  const r = activities.recommendActivities({ dest: dest(), summary: wetSummary(), interests: ["hiking"], cfg });
  assert.equal(r[0].kind, "indoor"); assert.equal(r[0].reason.key, "trip.reason.indoor_instead");
  const hike = r.find((x) => x.id === "hiking"); assert.equal(hike.suitable, false); assert.equal(hike.reason.key, "trip.reason.reschedule_heavy"); assert.equal(hike.bestWindow, null); assert.equal(hike.interest, true);
  assert.equal(r.find((x) => x.id === "waterfalls").suitable, false);
  assert.deepEqual(r.map((x) => x.id).sort(), [...dest().activities].sort());   // only what the destination offers
});
test("recommendActivities: light rain keeps sightseeing and museums good", () => {
  const s = intensity.summariseDay(rowsFrom((h) => (h >= 9 && h <= 11 ? { mm: 1, chance: 60 } : {})), cfg);
  const r = activities.recommendActivities({ dest: dest(), summary: s, cfg });
  assert.ok(r.find((x) => x.id === "sightseeing").suitable); assert.ok(r.find((x) => x.id === "museums").suitable);
  assert.ok(r.find((x) => x.id === "museums").score > r.find((x) => x.id === "hiking").score);
});
test("recommendActivities: high wind, dry day, hours input, missing data", () => {
  const windy = intensity.summariseDay(rowsFrom(() => ({ wind: 65, gust: 90 })), cfg);
  const w = activities.recommendActivities({ dest: dest({ activities: ["hiking", "museums"] }), summary: windy, cfg });
  assert.equal(w.find((x) => x.id === "hiking").reason.key, "trip.reason.strong_wind"); assert.equal(w.find((x) => x.id === "hiking").suitable, false);
  const dry = activities.recommendActivities({ dest: dest(), hours: rowsFrom(() => ({})), cfg });   // 24 rows instead of a summary
  assert.equal(dry.find((x) => x.id === "hiking").reason.key, "trip.reason.dry_good"); assert.ok(dry.find((x) => x.id === "photography").suitable);
  assert.deepEqual(dry.find((x) => x.id === "hiking").bestWindow, { from: 6, to: 19 }); assert.equal(dry.find((x) => x.id === "museums").bestWindow, null);
  const hot = intensity.summariseDay(rowsFrom(() => ({ temp: 37 })), cfg);
  assert.equal(activities.recommendActivities({ dest: dest({ activities: ["hiking"] }), summary: hot, cfg })[0].reason.key, "trip.reason.hot");
  const nodata = activities.recommendActivities({ dest: dest(), summary: null, cfg });
  assert.ok(nodata.every((x) => x.score === null && x.suitable === false && x.reason.key === "trip.reason.no_data"));
  assert.deepEqual(activities.recommendActivities({ dest: { id: "q" }, summary: drySummary(), cfg }), []);
  assert.deepEqual(activities.recommendActivities({}), []);
});

// ---- dates ------------------------------------------------------------------------------------------------------------
test("findBestDates: forecast days are scored from the forecast and picks the dry window", () => {
  // days 0-2 rain, days 3-5 dry
  const days = Array.from({ length: 8 }, (_, i) => d(i));
  const f = fixtureForecast(days, (day, h) => (history.daysBetween(TODAY, day) <= 2 && h >= 9 && h <= 16 ? 12 : 0));
  const r = dates.findBestDates({ dest: dest(), forecast: f, history: hist, durationDays: 2, rangeStart: TODAY, rangeEnd: d(7), prefs: { interests: ["hiking"] }, original: { start: TODAY, end: d(1) }, today: TODAY, cfg, limit: 3 });
  assert.ok(r.results.length >= 1);
  const best = r.results[0];
  assert.equal(best.dataKind, "forecast"); assert.ok(best.start >= d(3), best.start); assert.equal(best.heavyHours, 0); assert.ok(best.rainMm < 1);
  assert.ok(best.score > r.original.score); assert.equal(r.original.dataKind, "forecast"); assert.ok(r.original.heavyHours >= 16);
  assert.ok(r.notes.some((n) => n.key === "trip.note.better_than_original"));
  assert.equal(r.notes.some((n) => n.key === "trip.note.tendency_not_forecast"), false);
  for (let i = 1; i < r.results.length; i++) { assert.ok(r.results[i].score <= r.results[i - 1].score); assert.ok(r.results[i].start > r.results[i - 1].end || r.results[i].end < r.results[i - 1].start); }
  for (const w of r.results) for (const rs of w.reasons) assert.match(rs.key, /^trip\./);
});
test("findBestDates: beyond the 16-day horizon only tendencies are used, never forecast", () => {
  const f = fixtureForecast(Array.from({ length: 16 }, (_, i) => d(i)));
  const r = dates.findBestDates({ dest: dest(), forecast: f, history: hist, durationDays: 3, rangeStart: d(40), rangeEnd: d(60), prefs: {}, today: TODAY, cfg, limit: 2 });
  assert.ok(r.results.length > 0);
  for (const w of r.results) { assert.equal(w.dataKind, "tendency"); assert.equal(w.heavyHours, null); assert.ok(w.pRain > 0 && w.pRain <= 100); assert.ok(w.reasons.some((x) => x.key === "trip.reason.tendency_only")); }
  assert.ok(r.notes.some((n) => n.key === "trip.note.tendency_not_forecast"));
  // a window straddling the horizon is mixed
  const m = dates.findBestDates({ dest: dest(), forecast: f, history: hist, durationDays: 4, rangeStart: d(14), rangeEnd: d(17), prefs: {}, today: TODAY, cfg });
  assert.equal(m.results[0].dataKind, "mixed");
  // the dry square wins on tendencies
  const dryCell = dates.findBestDates({ dest: dest({ cell: "c2" }), forecast: f, history: hist, durationDays: 3, rangeStart: d(40), rangeEnd: d(45), prefs: {}, today: TODAY, cfg });
  assert.ok(dryCell.results[0].score > r.results[0].score);
});
test("findBestDates: no history and no forecast -> no results, with notes", () => {
  const r = dates.findBestDates({ dest: dest(), forecast: null, history: null, durationDays: 2, rangeStart: d(40), rangeEnd: d(50), prefs: {}, today: TODAY, cfg });
  assert.deepEqual(r.results, []); assert.ok(r.notes.some((n) => n.key === "trip.note.no_results"));
  const unknownCell = dates.findBestDates({ dest: dest({ cell: "nope" }), forecast: null, history: hist, durationDays: 2, rangeStart: d(40), rangeEnd: d(50), prefs: {}, today: TODAY, cfg });
  assert.deepEqual(unknownCell.results, []);
  // forecast failed inside the horizon: falls back to the tendency and says so
  const fb = dates.findBestDates({ dest: dest(), forecast: { ok: false }, history: hist, durationDays: 2, rangeStart: TODAY, rangeEnd: d(5), prefs: {}, today: TODAY, cfg });
  assert.equal(fb.results[0].dataKind, "tendency"); assert.ok(fb.notes.some((n) => n.key === "trip.note.no_forecast_using_tendency"));
  // a stale forecast is flagged
  const stale = fixtureForecast([TODAY, d(1), d(2)]); stale.stale = true;
  assert.ok(dates.findBestDates({ dest: dest(), forecast: stale, history: hist, durationDays: 1, rangeStart: TODAY, rangeEnd: d(2), prefs: {}, today: TODAY, cfg }).notes.some((n) => n.key === "trip.note.forecast_stale"));
});
test("findBestDates: invalid ranges", () => {
  const base = { dest: dest(), forecast: null, history: hist, prefs: {}, today: TODAY, cfg };
  const bad = [
    { durationDays: 2, rangeStart: d(10), rangeEnd: d(5) }, { durationDays: 0, rangeStart: d(5), rangeEnd: d(10) }, { durationDays: 2.5, rangeStart: d(5), rangeEnd: d(10) },
    { durationDays: 2, rangeStart: "garbage", rangeEnd: d(10) }, { durationDays: 2, rangeStart: d(5), rangeEnd: null }, { durationDays: 2, rangeStart: "2026-02-30", rangeEnd: "2026-03-05" },
    { durationDays: 2, rangeStart: d(-30), rangeEnd: d(-10) },
  ];
  for (const b of bad) { const r = dates.findBestDates({ ...base, ...b }); assert.deepEqual(r.results, []); assert.equal(r.original, null); assert.equal(r.notes[r.notes.length - 1].key === "trip.note.invalid_range" || r.notes.some((n) => n.key === "trip.note.invalid_range"), true, JSON.stringify(b)); }
  assert.ok(dates.findBestDates({ ...base, durationDays: 9, rangeStart: d(5), rangeEnd: d(8) }).notes.some((n) => n.key === "trip.note.duration_too_long"));
  assert.ok(dates.findBestDates({ ...base, durationDays: 2, rangeStart: d(-3), rangeEnd: d(20) }).notes.some((n) => n.key === "trip.note.range_clamped"));
  assert.ok(dates.findBestDates({ ...base, durationDays: 2, rangeStart: d(5), rangeEnd: d(900) }).notes.some((n) => n.key === "trip.note.range_capped"));
  assert.deepEqual(dates.findBestDates({}).results, []);
});

// ---- packing ----------------------------------------------------------------------------------------------------------
const ids = (p, cat) => p.categories.find((c) => c.id === cat).items.map((i) => i.id);
test("buildPacking: rules by weather and activity", () => {
  const p = packing.buildPacking({ dest: dest(), summary: wetSummary(), activities: ["hiking", "waterfalls"], durationDays: 3, prefs: {} });
  assert.deepEqual(p.categories.map((c) => c.id), ["rain", "clothing", "outdoor", "essentials"]);
  for (const id of ["umbrella", "raincoat", "waterproof_bag", "quick_dry", "spare_socks"]) assert.ok(ids(p, "rain").includes(id), id);
  assert.equal(p.categories[0].items.find((i) => i.id === "quick_dry").qty, 3);
  for (const id of ["hiking_shoes", "water_shoes", "insect_repellent", "leech_socks"]) assert.equal(ids(p, "outdoor").includes(id), id !== "leech_socks" ? true : false, id);
  assert.ok(ids(p, "essentials").includes("first_aid")); assert.ok(ids(p, "essentials").includes("documents"));
  const it = p.categories[0].items[0]; assert.equal(it.auto, true); assert.equal(it.checked, false); assert.match(it.key, /^trip\.pack\./); assert.match(it.reason.key, /^trip\.packwhy\./);
  const dry = packing.buildPacking({ dest: dest({ elevation_m: 100 }), summary: intensity.summariseDay(rowsFrom(() => ({ temp: 33 })), cfg), activities: ["beach"], durationDays: 2, prefs: {} });
  assert.deepEqual(ids(dry, "rain"), []); assert.ok(ids(dry, "clothing").includes("sunscreen")); assert.ok(ids(dry, "outdoor").includes("swimwear"));
  const cold = packing.buildPacking({ dest: dest({ elevation_m: 1900 }), summary: drySummary(), activities: ["sightseeing"], durationDays: 1 });
  assert.ok(ids(cold, "clothing").includes("warm_layer"));
  const unknown = packing.buildPacking({ dest: dest(), summary: null, activities: [], durationDays: 1 });
  assert.deepEqual(ids(unknown, "rain"), ["umbrella"]); assert.equal(unknown.categories[0].items[0].reason.key, "trip.packwhy.weather_unknown");
  const forest = packing.buildPacking({ dest: dest({ kinds: ["forest"] }), summary: wetSummary(), activities: ["hiking"], durationDays: 1 });
  assert.ok(ids(forest, "outdoor").includes("leech_socks"));
  assert.doesNotThrow(() => packing.buildPacking({}));
});
test("packing: merge saved additions, removals and ticks; helpers are pure", () => {
  const args = { dest: dest(), summary: wetSummary(), activities: ["hiking"], durationDays: 2, prefs: {} };
  let saved = null;
  const frozen = Object.freeze({ added: Object.freeze([]), removed: Object.freeze([]), checked: Object.freeze({}), nextId: 1 });
  saved = packing.addPackingItem(frozen, { category: "essentials", name: "  Book ", qty: 2 });
  assert.deepEqual(frozen.added, []);                                                         // input untouched
  assert.equal(saved.added[0].name, "Book"); assert.equal(saved.added[0].id, "m-1"); assert.equal(saved.nextId, 2);
  saved = packing.addPackingItem(saved, { category: "nonsense", name: "x" }); assert.equal(saved.added.length, 1);
  saved = packing.addPackingItem(saved, { category: "clothing", name: "   " }); assert.equal(saved.added.length, 1);
  saved = packing.removePackingItem(saved, "umbrella");
  saved = packing.togglePackingItem(saved, "raincoat");
  saved = packing.togglePackingItem(saved, "m-1");
  let p = packing.buildPacking({ ...args, saved });
  assert.equal(ids(p, "rain").includes("umbrella"), false); assert.equal(p.categories[0].items.find((i) => i.id === "raincoat").checked, true);
  const manual = p.categories[3].items.find((i) => i.id === "m-1"); assert.equal(manual.name, "Book"); assert.equal(manual.auto, false); assert.equal(manual.qty, 2); assert.equal(manual.checked, true);
  saved = packing.togglePackingItem(saved, "raincoat"); p = packing.buildPacking({ ...args, saved });
  assert.equal(p.categories[0].items.find((i) => i.id === "raincoat").checked, false);
  saved = packing.removePackingItem(saved, "m-1"); p = packing.buildPacking({ ...args, saved });
  assert.equal(p.categories[3].items.some((i) => i.id === "m-1"), false);
  saved = packing.restorePackingItems(saved); assert.ok(ids(packing.buildPacking({ ...args, saved }), "rain").includes("umbrella"));
  assert.doesNotThrow(() => packing.buildPacking({ ...args, saved: "garbage" }));
});

// ---- itinerary --------------------------------------------------------------------------------------------------------
// Spec example: heavy rain on Day 1 afternoon -> the waterfall visit is moved or replaced; a locked item is never touched.
const D1 = d(1), D2 = d(2);
const itinFc = fixtureForecast([TODAY, D1, D2], (day, h) => (day === D1 && h >= 13 && h <= 16 ? 18 : 0));
const dests = [dest({ id: "x", activities: ["waterfalls", "museums", "restaurants", "hiking"] }), dest({ id: "near", lat: 7.35, lon: 80.7, activities: ["museums", "shopping"] }), dest({ id: "far", lat: 6.0, lon: 80.0, activities: ["museums"] })];
const itin = () => ({ id: "t1", name: "Test trip", items: [
  { id: "i1", day: D1, slot: "afternoon", destId: "x", activity: "waterfalls", kind: "outdoor", locked: false, note: "" },
  { id: "i2", day: D1, slot: "morning", destId: "x", activity: "hiking", kind: "outdoor", locked: false, note: "" },
  { id: "i3", day: D1, slot: "evening", destId: "x", activity: "restaurants", kind: "indoor", locked: false, note: "" },
  { id: "i4", day: D2, slot: "morning", destId: "x", activity: "photography", kind: "outdoor", locked: false, note: "" },
] });
test("proposeReschedule: waterfall moved or replaced, unaffected items listed, no mutation", () => {
  const it = itin(), before = JSON.stringify(it);
  const r = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map([["x", itinFc]]), cfg, destinations: dests, today: TODAY });
  assert.equal(JSON.stringify(it), before);
  assert.equal(r.proposals.length, 1); assert.equal(r.proposals[0].itemId, "i1"); assert.equal(r.proposals[0].problem.key, "trip.problem.heavy_rain");
  assert.deepEqual(r.unaffected.sort(), ["i2", "i3", "i4"]);
  const o = r.proposals[0].options;
  assert.ok(o.length >= 2 && o.length <= 5); assert.ok(o.some((x) => x.type === "keep"));
  assert.ok(o.some((x) => x.type === "move") || o.some((x) => x.type === "replace"));
  const mv = o.find((x) => x.type === "move");
  assert.ok(mv && mv.toDay === D2 && mv.toSlot === "afternoon" && mv.toActivity === "waterfalls", JSON.stringify(mv));  // D2 morning is taken by i4; D1 slots are wet or taken
  const rep = o.filter((x) => x.type === "replace"); assert.ok(rep.length >= 1);
  assert.ok(rep.every((x) => x.toDay === D1 && x.toSlot === "afternoon" && x.toDest !== "far"));    // "far" is more than 100 km away
  assert.ok(rep.some((x) => x.toDest === "x" && x.toActivity === "museums"));
  const keep = o.find((x) => x.type === "keep"); assert.ok(keep.score < mv.score); assert.ok(keep.score < rep[0].score);
  for (let i = 1; i < o.length; i++) assert.ok(o[i].score <= o[i - 1].score);
  for (const x of o) { assert.match(x.reason.key, /^trip\.option\./); assert.ok(x.score >= 0 && x.score <= 100); }
  // when the place itself has no indoor activity, a nearby place is offered (and "far" never is)
  const outdoorOnly = [dest({ id: "x", activities: ["waterfalls", "hiking"] }), dests[1], dests[2]];
  const r2 = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map([["x", itinFc]]), cfg, destinations: outdoorOnly, today: TODAY });
  const rep2 = r2.proposals[0].options.filter((x) => x.type === "replace");
  assert.ok(rep2.length >= 1 && rep2.every((x) => x.toDest === "near")); assert.equal(rep2[0].reason.key, "trip.option.replace_nearby");
});
test("proposeReschedule: a locked booking only gets a warning; apply never touches it", () => {
  const it = itin(); it.items[0].locked = true;
  const r = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map([["x", itinFc]]), cfg, destinations: dests, today: TODAY });
  assert.equal(r.proposals.length, 1); assert.equal(r.proposals[0].locked, true); assert.deepEqual(r.proposals[0].options, []); assert.equal(r.proposals[0].problem.key, "trip.problem.locked_booking");
  const out = itinerary.applyProposals(it, [{ itemId: "i1", option: { type: "move", toDay: D2, toSlot: "afternoon", toActivity: "waterfalls", toDest: "x" } }, { itemId: "i1", option: { type: "replace", toActivity: "museums", toDest: "x" } }]);
  assert.deepEqual(out.items[0], it.items[0]);
});
test("applyProposals: move, replace, keep; pure; slot clash skipped", () => {
  const it = itin(), before = JSON.stringify(it);
  const r = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map([["x", itinFc]]), cfg, destinations: dests, today: TODAY });
  const mv = r.proposals[0].options.find((x) => x.type === "move"), rep = r.proposals[0].options.find((x) => x.type === "replace"), keep = r.proposals[0].options.find((x) => x.type === "keep");
  const moved = itinerary.applyProposals(it, [{ itemId: "i1", option: mv }]);
  assert.equal(JSON.stringify(it), before); assert.notEqual(moved, it);
  assert.equal(moved.items[0].day, mv.toDay); assert.equal(moved.items[0].slot, mv.toSlot); assert.equal(moved.items[1].day, it.items[1].day);
  const replaced = itinerary.applyProposals(it, [{ itemId: "i1", option: rep }]);
  assert.equal(replaced.items[0].activity, rep.toActivity); assert.equal(replaced.items[0].kind, "indoor"); assert.equal(replaced.items[0].destId, rep.toDest); assert.equal(replaced.items[0].day, D1);
  assert.deepEqual(itinerary.applyProposals(it, [{ itemId: "i1", option: keep }]), it);
  assert.deepEqual(itinerary.applyProposals(it, []), it); assert.deepEqual(itinerary.applyProposals(it, [{ itemId: "nope", option: mv }]), it);
  const clash = itinerary.applyProposals(it, [{ itemId: "i1", option: { type: "move", toDay: D1, toSlot: "morning", toActivity: "waterfalls", toDest: "x" } }]);
  assert.equal(clash.items[0].slot, "afternoon");                                           // morning is taken by i2
  assert.deepEqual(itinerary.applyProposals(null, null), { items: [] });
});
test("proposeReschedule: missing forecast, indoor items, empty input, custom distance", () => {
  const it = itin();
  let r = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map(), cfg, today: TODAY });
  assert.equal(r.proposals.length, 0); assert.equal(r.unaffected.length, 4);                // no data: nothing is claimed
  r = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map([["x", { ok: false }]]), cfg, today: TODAY }); assert.equal(r.proposals.length, 0);
  r = itinerary.proposeReschedule({ itinerary: { items: [] }, forecasts: new Map(), cfg }); assert.deepEqual(r, { proposals: [], unaffected: [] });
  assert.deepEqual(itinerary.proposeReschedule({}), { proposals: [], unaffected: [] });
  r = itinerary.proposeReschedule({ itinerary: it, forecasts: new Map([["x", itinFc]]), cfg, destinations: dests, today: TODAY, distanceKm: () => 500 });
  assert.ok(r.proposals[0].options.every((x) => x.type !== "replace" || x.toDest === "x"));  // everything else is "too far" with a 500 km function
  // a day far in the future has no forecast: unaffected
  const far = { id: "t", items: [{ id: "f1", day: d(40), slot: "morning", destId: "x", activity: "hiking", kind: "outdoor", locked: false }] };
  assert.deepEqual(itinerary.proposeReschedule({ itinerary: far, forecasts: new Map([["x", itinFc]]), cfg, today: TODAY }).unaffected, ["f1"]);
});
test("distanceKm (haversine)", () => {
  const km = itinerary.distanceKm({ lat: 6.9271, lon: 79.8612 }, { lat: 7.2906, lon: 80.6337 });       // Colombo - Kandy, about 94 km in a straight line
  assert.ok(km > 85 && km < 105, String(km));
  assert.equal(itinerary.distanceKm({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }), 0);
  assert.equal(itinerary.distanceKm(null, { lat: 1, lon: 1 }), null); assert.equal(itinerary.distanceKm({ lat: 1 }, { lat: 1, lon: 1 }), null);
});

// ---- store ------------------------------------------------------------------------------------------------------------
const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const setStorage = (v) => Object.defineProperty(globalThis, "localStorage", { configurable: true, get: v === "throw" ? () => { throw new Error("blocked"); } : () => v });
const fakeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
test("store: in-memory fallback when storage is blocked or missing", () => {
  for (const mode of ["throw", undefined, null]) {
    setStorage(mode); store.resetMemory();
    assert.deepEqual(store.listTrips(), []); assert.equal(store.getPrefs(), null); assert.equal(store.getLastForecastStamp("a"), null);
    const t = store.saveTrip({ name: "A" }); assert.ok(t.id); assert.equal(store.getTrip(t.id).name, "A");
    store.saveTrip({ ...t, name: "B" }); assert.equal(store.listTrips().length, 1); assert.equal(store.getTrip(t.id).name, "B");
    store.savePacking(t.id, { checked: { a: true } }); assert.deepEqual(store.getPacking(t.id), { checked: { a: true } });
    store.savePrefs({ interests: ["hiking"] }); assert.deepEqual(store.getPrefs(), { interests: ["hiking"] });
    store.deleteTrip(t.id); assert.equal(store.getTrip(t.id), null); assert.equal(store.getPacking(t.id), null);
    assert.equal(store.storageAvailable(), false);
  }
});
test("store: works with a real-like storage, survives bad JSON, quota errors fall back to memory", () => {
  const fs = fakeStorage(); setStorage(fs); store.resetMemory();
  const t = store.saveTrip({ name: "Kandy" }); assert.ok(fs._m.has("mc-trip-trips")); assert.equal(store.storageAvailable(), true);
  assert.notEqual(store.newTripId(), store.newTripId());
  fs._m.set("mc-trip-prefs", "{not json"); assert.equal(store.getPrefs(), null);
  fs._m.set("mc-trip-trips", "[1,null,{\"id\":\"z\"}]"); assert.deepEqual(store.listTrips().map((x) => x.id), ["z"]);
  fs._m.set("mc-trip-fc-kandy", JSON.stringify({ fetchedAt: "2026-11-15T01:00:00Z" })); assert.equal(store.getLastForecastStamp("kandy"), "2026-11-15T01:00:00Z");
  const quota = { ...fs, setItem: () => { throw new Error("QuotaExceededError"); } }; setStorage(quota);
  store.savePrefs({ style: "relaxed" }); assert.deepEqual(store.getPrefs(), { style: "relaxed" });   // kept in memory
  assert.equal(store.saveTrip(null), null); assert.equal(store.saveTrip("x"), null);
  assert.ok(t.id);
});
if (realDescriptor) Object.defineProperty(globalThis, "localStorage", realDescriptor); else delete globalThis.localStorage;

console.log(`all trip logic tests passed (${passed})`);
