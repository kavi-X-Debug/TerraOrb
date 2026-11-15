// Copilot step 2: the TOOLS. Each tool fetches or calculates something from REAL data only (live Open-Meteo forecast, NASA POWER history,
// the visitor's saved trips) by calling the trip modules, and returns plain data. A tool that cannot get its data returns
// { ok:false, error } and never a made-up number; the answer builder then says what is missing.
//
//   const tools = createTools(env)   env = { data:{destinations,byId,history,...}, cfg, today?, deps? }
//   deps (optional, for tests) replaces the trip modules: { forecast, history, intensity, dates, activities, packing, itinerary, store }.
import { addDays, daysBetween } from "./intents.js";

const MAX_DAYS = 31;
const CLASSES = ["none", "light", "moderate", "heavy", "very_heavy"];
const r1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
export const dayList = (start, end) => { const n = Math.min(MAX_DAYS, Math.max(1, daysBetween(start, end) + 1)); return Array.from({ length: n }, (_, i) => addDays(start, i)); };

const FILES = { forecast: "../forecast.js", history: "../history.js", intensity: "../intensity.js", dates: "../dates.js", activities: "../activities.js",
  packing: "../packing.js", itinerary: "../itinerary.js", store: "../store.js", scoring: "../scoring.js" };

export function createTools(env) {
  const cfg = env.cfg;
  const loaded = {};
  // one trip module (a test double from env.deps, else the real file); null when it cannot be loaded
  async function mod(name) {
    if (env.deps?.[name]) return env.deps[name];
    if (!(name in loaded)) loaded[name] = import(FILES[name]).catch(() => null);
    return loaded[name];
  }
  async function need(...names) {
    const out = {};
    for (const n of names) { out[n] = await mod(n); if (!out[n]) throw Object.assign(new Error(`module ${n} is not available`), { tool: n }); }
    return out;
  }
  const fail = (error, detail) => ({ ok: false, error, detail: detail || null });
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return fail(e.tool ? "tool_missing" : "tool_failed", e.message); } };

  async function todayIso() {
    if (env.today) return env.today;
    const { forecast } = await need("forecast");
    return forecast.todayColombo();
  }
  async function historyData() {
    if (env.data?.history) return env.data.history;
    try { const { history } = await need("history"); return await history.loadHistory(); } catch { return null; }
  }
  async function prefs() {
    const base = { interests: [], maxRainMm: null, preferredTemp: "any", style: "balanced", budget: null, region: null };
    try { const { store } = await need("store"); return { ...base, ...(store.getPrefs() || {}) }; } catch { return base; }
  }

  // ---- outlook of one destination over a date range -----------------------------------------------------------------------------
  // For each day: "forecast" (inside the 16-day horizon and the forecast has data), else "tendency" (NASA POWER, never shown as a forecast),
  // else "none". `forecast` may be a failed load: its days then fall back to the tendency, and the answer says the forecast was not available.
  function outlookFor(dest, forecast, history, start, end, today, m) {
    const days = [];
    let usedForecast = false, usedTendency = false, forecastFailed = false;
    for (const date of dayList(start, end)) {
      const kind = m.forecast.dayKind(date, today, cfg);
      if (kind === "forecast") {
        if (forecast?.ok) {
          const summary = m.intensity.summariseDay(m.forecast.hoursOf(forecast, date), cfg);
          if (summary?.hasData) { days.push({ date, kind: "forecast", summary, daily: m.forecast.dailyOf(forecast, date) }); usedForecast = true; continue; }
          const daily = m.forecast.dailyOf(forecast, date);
          if (daily && daily.precipMm !== null) { days.push({ date, kind: "forecast", summary: null, daily }); usedForecast = true; continue; }
        } else forecastFailed = true;
      }
      const t = m.history.tendencyFor(history, dest.cell, date);
      if (t) { days.push({ date, kind: "tendency", tendency: t, beyond: kind !== "forecast" }); usedTendency = true; } else days.push({ date, kind: "none" });
    }
    return { dest, days, usedForecast, usedTendency, forecastFailed,
      forecastInfo: usedForecast ? { fetchedAt: forecast.fetchedAt, stale: Boolean(forecast.stale) } : null,
      period: days.find((d) => d.tendency)?.tendency.period || null };
  }

  // daily rain of one outlook day, in mm (the forecast total, or the usual (mean) rain of past years)
  const dayMm = (d) => (d.kind === "forecast" ? (d.summary ? d.summary.totalMm : d.daily?.precipMm ?? null) : d.kind === "tendency" ? d.tendency.meanMm : null);
  const dayChance = (d) => (d.kind === "forecast" ? (d.summary ? d.summary.maxChance : d.daily?.chanceMax ?? null) : d.kind === "tendency" ? (d.tendency.pWet === null ? null : d.tendency.pWet * 100) : null);

  const tools = {
    today: guard(async () => ({ ok: true, today: await todayIso() })),
    prefs: guard(async () => ({ ok: true, prefs: await prefs() })),

    // Rain for one place and a range of days.
    rainOutlook: guard(async (dest, start, end) => {
      const m = await need("forecast", "history", "intensity");
      const today = await todayIso();
      const forecast = await m.forecast.loadForecast(dest);
      const history = await historyData();
      const o = outlookFor(dest, forecast, history, start, end, today, m);
      if (!o.days.some((d) => d.kind !== "none")) return fail(forecast?.ok ? "no_data" : "forecast_failed", forecast?.error || null);
      return { ok: true, today, ...o, mm: dayMm, chance: dayChance };
    }),

    // Several places, same range: rain totals so they can be compared or ranked (driest first). Places with no data at all are listed apart.
    rankByRain: guard(async (dests, start, end) => {
      const m = await need("forecast", "history", "intensity");
      const today = await todayIso();
      const forecasts = await m.forecast.loadForecasts(dests);
      const history = await historyData();
      const rows = [], missing = [];
      let fetchedAt = null, stale = false, period = null, failedAll = true;
      for (const dest of dests) {
        const f = forecasts.get(dest.id);
        if (f?.ok) failedAll = false;
        const o = outlookFor(dest, f, history, start, end, today, m);
        const withData = o.days.filter((d) => d.kind !== "none");
        if (!withData.length) { missing.push(dest.id); continue; }
        const fc = o.days.filter((d) => d.kind === "forecast"), tn = o.days.filter((d) => d.kind === "tendency");
        const sum = (list) => list.reduce((a, d) => a + (dayMm(d) ?? 0), 0);
        const chances = o.days.map(dayChance).filter((x) => x !== null);
        rows.push({ dest, forecastMm: fc.length ? r1(sum(fc)) : null, usualMm: tn.length ? r1(sum(tn)) : null, totalMm: r1(sum(fc) + sum(tn)),
          nForecast: fc.length, nTendency: tn.length, nNone: o.days.length - withData.length, maxChance: chances.length ? Math.round(Math.max(...chances)) : null,
          maxClass: fc.map((d) => d.summary?.maxClass).filter(Boolean).sort((a, b) => CLASSES.indexOf(b) - CLASSES.indexOf(a))[0] || null, stale: Boolean(f?.stale) });
        if (o.forecastInfo) { fetchedAt = !fetchedAt || (o.forecastInfo.fetchedAt && o.forecastInfo.fetchedAt < fetchedAt) ? o.forecastInfo.fetchedAt : fetchedAt; stale = stale || o.forecastInfo.stale; }
        period = period || o.period;
      }
      if (!rows.length) return fail(failedAll ? "forecast_failed" : "no_data");
      rows.sort((a, b) => a.totalMm - b.totalMm || (a.maxChance ?? 100) - (b.maxChance ?? 100));
      return { ok: true, today, start, end, rows, missing, forecastInfo: rows.some((r) => r.nForecast) ? { fetchedAt, stale } : null, period, usedTendency: rows.some((r) => r.nTendency) };
    }),

    // Best dates for one place (forecast days use the forecast, later days the NASA POWER tendency; dates.js decides and labels).
    bestDates: guard(async (dest, durationDays, rangeStart, rangeEnd, limit = 3) => {
      const m = await need("forecast", "dates");
      const today = await todayIso();
      const forecast = await m.forecast.loadForecast(dest);
      const history = await historyData();
      const result = m.dates.findBestDates({ dest, forecast, history, durationDays, rangeStart, rangeEnd, prefs: await prefs(), today, cfg, limit });
      if (!result.results.length) return { ok: false, error: "no_windows", notes: result.notes };
      return { ok: true, today, ...result, forecastInfo: forecast?.ok ? { fetchedAt: forecast.fetchedAt, stale: Boolean(forecast.stale) } : null };
    }),

    // Activities for one place on one day (needs the hourly forecast: it exists for the next 16 days only).
    activities: guard(async (dest, date, interests = []) => {
      const m = await need("forecast", "intensity", "activities");
      const today = await todayIso();
      if (m.forecast.dayKind(date, today, cfg) !== "forecast") return fail("beyond_horizon");
      const forecast = await m.forecast.loadForecast(dest);
      if (!forecast?.ok) return fail("forecast_failed", forecast?.error);
      const hours = m.forecast.hoursOf(forecast, date);
      const summary = m.intensity.summariseDay(hours, cfg);
      if (!summary?.hasData) return fail("no_data");
      const list = m.activities.recommendActivities({ dest, hours, summary, interests, durationDays: 1, cfg });
      return { ok: true, today, date, summary, list, forecastInfo: { fetchedAt: forecast.fetchedAt, stale: Boolean(forecast.stale) } };
    }),

    // Photography: dry windows, sunrise and sunset and whether rain is expected around them. There is NO cloud or light data.
    photography: guard(async (dest, date) => {
      const m = await need("forecast", "intensity");
      const today = await todayIso();
      if (m.forecast.dayKind(date, today, cfg) !== "forecast") return fail("beyond_horizon");
      const forecast = await m.forecast.loadForecast(dest);
      if (!forecast?.ok) return fail("forecast_failed", forecast?.error);
      const hours = m.forecast.hoursOf(forecast, date);
      const summary = m.intensity.summariseDay(hours, cfg);
      if (!summary?.hasData) return fail("no_data");
      const daily = m.forecast.dailyOf(forecast, date);
      const hourOf = (stamp) => (stamp ? Number(String(stamp).slice(11, 13)) : null);
      const rainAt = (h) => (h === null || h < 0 || h > 23 || hours[h].mm === null ? null : hours[h].mm);
      const sr = hourOf(daily?.sunrise), ss = hourOf(daily?.sunset);
      return { ok: true, today, date, summary, windows: summary.goodWindows || [], sunrise: daily?.sunrise ? String(daily.sunrise).slice(11, 16) : null,
        sunset: daily?.sunset ? String(daily.sunset).slice(11, 16) : null, sunriseRainMm: rainAt(sr), sunsetRainMm: rainAt(ss === null ? null : ss - 1),
        forecastInfo: { fetchedAt: forecast.fetchedAt, stale: Boolean(forecast.stale) } };
    }),

    // Packing for a place and range: built from the rainiest forecast day of the range (a list for the worst day is the safe list).
    packing: guard(async (dest, start, end, interests = []) => {
      const m = await need("forecast", "intensity", "packing", "activities");
      const today = await todayIso();
      const forecast = await m.forecast.loadForecast(dest);
      if (!forecast?.ok) return fail("forecast_failed", forecast?.error);
      let worst = null;
      for (const date of dayList(start, end)) {
        if (m.forecast.dayKind(date, today, cfg) !== "forecast") continue;
        const s = m.intensity.summariseDay(m.forecast.hoursOf(forecast, date), cfg);
        if (s?.hasData && (!worst || (s.totalMm ?? 0) > (worst.summary.totalMm ?? 0))) worst = { date, summary: s };
      }
      if (!worst) return fail("beyond_horizon");
      const durationDays = dayList(start, end).length;
      const acts = m.activities.recommendActivities({ dest, summary: worst.summary, interests, durationDays, cfg }).filter((a) => a.suitable).slice(0, 4).map((a) => a.id);
      const result = m.packing.buildPacking({ dest, summary: worst.summary, activities: acts, durationDays, prefs: await prefs(), cfg });
      return { ok: true, today, worstDate: worst.date, summary: worst.summary, categories: result.categories || [], forecastInfo: { fetchedAt: forecast.fetchedAt, stale: Boolean(forecast.stale) } };
    }),

    // The saved trips of this visitor.
    trips: guard(async () => { const { store } = await need("store"); return { ok: true, trips: store.listTrips() || [] }; }),

    // PROPOSES changes for a saved trip. It never saves anything: the visitor must approve each change on the Trips screen.
    proposeChanges: guard(async (trip) => {
      const m = await need("forecast", "itinerary");
      const today = await todayIso();
      const ids = [...new Set((trip.items || []).map((i) => i.destId).filter(Boolean))];
      const dests = ids.map((id) => env.data.byId.get(id)).filter(Boolean);
      const forecasts = await m.forecast.loadForecasts(dests);
      const ok = [...forecasts.values()].some((f) => f?.ok);
      if (!ok) return fail("forecast_failed");
      const result = m.itinerary.proposeReschedule({ itinerary: trip, forecasts, cfg, destinations: env.data.destinations, today });
      const first = [...forecasts.values()].find((f) => f?.ok);
      return { ok: true, today, ...result, forecastInfo: { fetchedAt: first.fetchedAt, stale: [...forecasts.values()].some((f) => f?.stale) } };
    }),
  };
  return tools;
}
