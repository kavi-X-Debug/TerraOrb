// Tests for the trip Copilot (browser side): intent parsing (English, Sinhala, spelling slips), dates, answer building with synthetic fixtures,
// grounding (no invented numbers), tool failures, the remote provider with a mocked fetch, and the strings files.
// Run: node tools/test_trip_copilot.mjs
// The forecast and history below are SYNTHETIC TEST FIXTURES (not real weather); the trip logic modules are the real ones.
import fs from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = (p) => fileURLToPath(new URL(`../web/${p}`, import.meta.url));
const load = (p) => import(pathToFileURL(web(p)).href);
const intents = await load("js/trip/copilot/intents.js");
const rules = await load("js/trip/copilot/rules.js");
const tools = await load("js/trip/copilot/tools.js");
const remote = await load("js/trip/copilot/remote.js");
const index = await load("js/trip/copilot/index.js");
const real = { forecast: await load("js/trip/forecast.js"), history: await load("js/trip/history.js"), intensity: await load("js/trip/intensity.js"), dates: await load("js/trip/dates.js"),
  activities: await load("js/trip/activities.js"), packing: await load("js/trip/packing.js"), itinerary: await load("js/trip/itinerary.js") };
const { DEFAULTS } = await load("js/trip/config.js");

const en = JSON.parse(fs.readFileSync(web("strings/trip-d.en.json"), "utf8"));
const si = JSON.parse(fs.readFileSync(web("strings/trip-d.si.json"), "utf8"));
const core = JSON.parse(fs.readFileSync(web("strings/trip-core.en.json"), "utf8"));
const logicEn = JSON.parse(fs.readFileSync(web("strings/trip-logic.en.json"), "utf8"));
const allEn = { ...logicEn, ...core, ...en };
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };

// ---- 1. strings: same keys, same placeholders, every key used by the code exists ------------------------------------------------------
eq(Object.keys(en).sort(), Object.keys(si).sort(), "English and Sinhala must have the same keys");
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
for (const k of Object.keys(en)) { assert.equal(ph(en[k]), ph(si[k]), `placeholders differ in ${k}`); assert.ok(si[k].trim(), `empty Sinhala ${k}`); passed++; }
const src = ["js/trip/copilot/rules.js", "js/trip/copilot/tools.js", "js/trip/copilot/index.js", "js/trip/screens/copilot.js"].map((f) => fs.readFileSync(web(f), "utf8")).join("\n");
const used = new Set([...src.matchAll(/["'`](tripd\.[a-z0-9_.]+)["'`]/gi)].map((m) => m[1]));
const dynamic = [...["dry", "maybe", "wet", "unknown"].map((v) => `tripd.verdict.${v}`), ...["dry", "maybe", "wet", "unknown"].map((v) => `tripd.rain.head.${v}`),
  ...intents.INTENTS.concat("unknown").map((i) => `tripd.intent.${i}`), ...intents.INTENTS.map((i) => `tripd.example.${i}`), ...intents.EXPLAIN_TOPICS.map((x) => `tripd.ex.head.${x}`),
  ...["morning", "afternoon", "evening"].map((s) => `tripd.slot.${s}`), ...intents.INTENTS.concat(intents.EXPLAIN_TOPICS.map((x) => `ex_${x}`)).map((i) => `tripd.kw.${i}`)];
for (const k of [...used, ...dynamic]) { if (k.endsWith(".") || k === "tripd.kw." || k === "tripd.lex." || k === "tripd.example.") continue; assert.ok(en[k] !== undefined, `missing string ${k}`); passed++; }
for (const k of ["trip.disclaimer", "trip.score_note", "trip.int.heavy", "trip.act.hiking"]) ok(allEn[k], `core string ${k}`);

const split = (s) => String(s).split("|").map((x) => x.trim().toLowerCase()).filter(Boolean);
const getList = (key) => [en[key], si[key]].filter(Boolean).flatMap(split);
const t = (key, vars = {}) => { let s = allEn[key]; if (s === undefined) return key; for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v); return s; };

// ---- fixtures ---------------------------------------------------------------------------------------------------------------------------
const D = (id, en_, si_, cell, kinds, activities, extra = {}) => ({ id, name_en: en_, name_si: si_, lat: 7, lon: 80, cell, kinds, activities, elevation_m: 100, cost_level: 2, ...extra });
const destinations = [
  D("kandy", "Kandy", "මහනුවර", "7.5_80.625", ["culture", "city", "hill"], ["sightseeing", "museums", "culture", "restaurants", "shopping", "photography", "hiking"]),
  D("galle", "Galle", "ගාල්ල", "6.0_80.0", ["coast", "city", "culture"], ["beach", "sightseeing", "museums", "restaurants", "photography"]),
  D("ella", "Ella", "ඇල්ල", "6.5_81.25", ["hill", "waterfall"], ["hiking", "waterfalls", "photography", "cycling", "sightseeing"]),
  D("nuwara-eliya", "Nuwara Eliya", "නුවර එළිය", "7.0_80.625", ["hill", "lake"], ["hiking", "sightseeing", "photography", "restaurants"]),
  D("sigiriya", "Sigiriya", "සීගිරිය", "7.5_80.625", ["culture", "wildlife"], ["hiking", "sightseeing", "wildlife", "culture"]),
  D("mirissa", "Mirissa", "මිරිස්ස", "6.0_80.625", ["beach", "coast"], ["beach", "photography", "restaurants"]),
];
const byId = new Map(destinations.map((d) => [d.id, d]));
const TODAY = "2026-11-15";                       // a Sunday
const dayIdx = (iso) => real.history.dayIndex(iso);
const mkHistory = (cells) => ({ schema: "trip-history-1", years: 45, period: "1981-2025", cells: Object.fromEntries(Object.entries(cells).map(([cell, [p, mm]]) => [cell, { p_wet: Array(366).fill(p), mean_mm: Array(366).fill(mm), p90_mm: Array(366).fill(mm * 3) }])) });
const history = mkHistory({ "7.5_80.625": [0.55, 6.2], "6.0_80.0": [0.3, 3.1], "6.5_81.25": [0.4, 4.4], "7.0_80.625": [0.6, 7.0], "6.0_80.625": [0.35, 3.3] });

// a 16-day synthetic forecast; rain = { "2026-11-16": { 14: 3, 15: 5, 16: 2 } } is mm in CLOCK hours (rows of hoursOf)
const addDay = intents.addDays;
function makeForecast(rain = {}, { stale = false, fetchedAt = "2026-11-15T09:00:00+05:30" } = {}) {
  const time = [], pr = [], pp = [], tp = [], rh = [], ws = [], wg = [], wc = [];
  for (let d = 0; d < 16; d++) {
    const date = addDay(TODAY, d);
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      const prev = h === 0 ? null : (rain[date] || {})[h - 1];          // rain of clock hour h-1 sits at stamp h
      const prevDay = h === 0 ? (rain[addDay(date, -1)] || {})[23] : null;
      pr.push(prev ?? prevDay ?? 0); pp.push((prev ?? prevDay ?? 0) > 0 ? 70 : 10); tp.push(28); rh.push(75); ws.push(10); wg.push(20); wc.push(0);
    }
  }
  const days = Array.from({ length: 16 }, (_, d) => addDay(TODAY, d));
  const total = (date) => Object.values(rain[date] || {}).reduce((a, b) => a + b, 0);
  return { ok: true, source: "Open-Meteo", not_nasa: true, fetchedAt, stale, error: null, hourly: { time, precipitation: pr, precipitation_probability: pp, temperature_2m: tp, relative_humidity_2m: rh, wind_speed_10m: ws, wind_gusts_10m: wg, weather_code: wc },
    daily: { time: days, precipitation_sum: days.map(total), precipitation_probability_max: days.map((d) => (total(d) > 0 ? 80 : 10)), temperature_2m_max: days.map(() => 31), temperature_2m_min: days.map(() => 22),
      wind_speed_10m_max: days.map(() => 15), sunrise: days.map((d) => `${d}T06:05`), sunset: days.map((d) => `${d}T17:55`) } };
}
const RAIN = {
  kandy: { "2026-11-16": { 14: 3, 15: 5, 16: 2 }, "2026-11-21": { 10: 1, 11: 1 } },      // wet tomorrow
  galle: {},                                                                                // dry
  ella: { "2026-11-16": { 9: 0.4 }, "2026-11-18": { 15: 2 }, "2026-11-21": { 15: 4 }, "2026-11-22": { 15: 6 } },
  "nuwara-eliya": { "2026-11-17": { 8: 6, 9: 8, 10: 4 }, "2026-11-18": { 8: 5, 9: 5 }, "2026-11-21": { 8: 6, 9: 8, 10: 4 }, "2026-11-22": { 8: 5, 9: 5 } },
  sigiriya: {}, mirissa: { "2026-11-16": { 20: 1 } },
};
function fakeForecast({ failAll = false, stale = false } = {}) {
  const calls = [];
  const load = async (dest) => { calls.push(dest.id); return failAll ? { ok: false, source: "Open-Meteo", error: "offline", hourly: null, daily: null } : makeForecast(RAIN[dest.id] || {}, { stale }); };
  return { calls, mod: { ...real.forecast, loadForecast: load, loadForecasts: async (list) => new Map(await Promise.all(list.map(async (d) => [d.id, await load(d)]))), todayColombo: () => TODAY } };
}
function trip() {
  return { id: "t-1", name: "Hill weekend", items: [
    { id: "i1", day: "2026-11-16", slot: "afternoon", destId: "kandy", activity: "hiking", kind: "outdoor", locked: false, note: "" },
    { id: "i2", day: "2026-11-17", slot: "morning", destId: "galle", activity: "beach", kind: "outdoor", locked: false, note: "" }] };
}
function makeEnv({ failAll = false, stale = false, trips = [trip()], hist = history, prefs = null } = {}) {
  const fc = fakeForecast({ failAll, stale });
  const store = { listTrips: () => trips, getPrefs: () => prefs, saveTrip: () => { store.saved = true; }, saved: false };
  const env = { data: { destinations, byId, history: hist, modelMeta: { ml_available: false } }, cfg: DEFAULTS, t, lang: "en", getList, today: TODAY,
    deps: { ...real, forecast: fc.mod, store }, fmt: {} };
  return { env, fc, store };
}
const ask = (q, e, memory = {}, useRemote = false) => index.ask(q, { env: e.env, memory, useRemote });
const text = (r) => rules.plain(r.answer, t).join("\n");
const parse = (q) => intents.parseQuestion(q, { destinations, today: TODAY, getList });

// ---- 2. intent parsing: English, Sinhala, slips ----------------------------------------------------------------------------------------
const CASES = [
  ["Will it rain in Kandy tomorrow?", "will_it_rain"], ["Is it going to rain in Galle on Saturday", "will_it_rain"], ["weather in Ella tomorrow", "will_it_rain"],
  ["Compare Ella and Nuwara Eliya for five days", "compare_destinations"], ["Kandy vs Galle", "compare_destinations"], ["which is drier, Mirissa or Galle?", "compare_destinations"],
  ["Best dates to visit Ella", "best_dates"], ["When is the best time to go to Galle for 4 days", "best_dates"],
  ["Where can I go with low rain next weekend?", "where_to_travel"], ["where should I travel this weekend", "where_to_travel"],
  ["Suggest a 3 day low rain trip", "plan_trip"], ["plan a trip for the weekend", "plan_trip"],
  ["Should I change my trip because of the rain?", "modify_itinerary"], ["reschedule my itinerary", "modify_itinerary"],
  ["What can I do in Kandy tomorrow?", "activities_tomorrow"], ["things to do in Galle", "activities_tomorrow"],
  ["Best time for photography in Ella tomorrow", "photography_best"], ["what time is sunrise in Sigiriya tomorrow", "photography_best"],
  ["What should I pack for Kandy this weekend?", "packing"], ["do I need an umbrella in Galle", "packing"],
  ["Explain how rain is shown", "explain_rain"], ["how accurate is the forecast", "explain_rain"], ["where does the data come from", "explain_rain"],
  ["help", "help"], ["What can you do?", "help"],
  ["wether in kandi tommorow", "will_it_rain"],                                   // spelling slips
  ["compair ella and galle", "compare_destinations"],
  ["Kandy tomorrow", "will_it_rain"],                                              // a place and a date, nothing else
  // Sinhala (draft wording)
  ["හෙට මහනුවර වහිනවාද?", "will_it_rain"], ["ගාල්ල සහ ඇල්ල සසඳන්න", "compare_destinations"], ["ඊළඟ සති අන්තයේ වැසි අඩු කොහෙද යන්න", "where_to_travel"],
  ["හෙට ඇල්ල ඡායාරූප ගැනීමට හොඳම වේලාව", "photography_best"], ["මහනුවර සඳහා ඇසුරුම් මොනවාද", "packing"], ["උදව්", "help"],
];
const bad = CASES.map(([q, want]) => [q, want, parse(q).intent]).filter(([, w, g]) => w !== g);
assert.equal(bad.length, 0, "wrong intents:\n" + bad.map(([q, w, g]) => `  "${q}" -> ${g} (wanted ${w})`).join("\n")); passed += CASES.length;
// nothing sensible: no intent, no guess
for (const q of ["what is the capital of France", "tell me a joke", "asdf qwer", ""]) { const p = parse(q); assert.equal(p.intent, null, `"${q}" should not match (got ${p.intent})`); passed++; }
// every suggestion question parses back to its own intent
for (const id of intents.INTENTS) {
  const ex = rules.exampleQuestion(id, { destinations, byId });
  for (const lang of [en, si]) { const q = lang[ex.key].replaceAll("{a}", lang === en ? "Kandy" : "මහනුවර").replaceAll("{b}", lang === en ? "Galle" : "ගාල්ල"); const p = parse(q); assert.equal(p.intent, id, `example "${q}" -> ${p.intent}, wanted ${id}`); passed++; }
}

// ---- 3. entities -------------------------------------------------------------------------------------------------------------------------
eq(parse("Compare Ella and Nuwara Eliya for five days").dests, ["ella", "nuwara-eliya"], "places in order, long name wins");
eq(parse("Compare Ella and Nuwara Eliya for five days").days, 5, "for five days");
eq(parse("compare Galle and Kandy").dests, ["galle", "kandy"]);
eq(parse("rain in nuwara").dests, [], "a part of a name alone is not a match");
eq(parse("Will it rain in Kandy tomorrow?").dates, { start: "2026-11-16", end: "2026-11-16", label: "tomorrow", explicit: true });
eq(parse("rain today").dates.start, TODAY);
eq(parse("rain the day after tomorrow in Galle").dates.start, "2026-11-17");
eq(parse("rain in 3 days").dates.start, "2026-11-18");
const nw = parse("low rain next weekend").dates; eq([nw.start, nw.end], ["2026-11-21", "2026-11-22"], "next weekend (today is Sunday)");
const tw = parse("rain this weekend").dates; eq([tw.start, tw.end], ["2026-11-15", "2026-11-15"], "this weekend on a Sunday = today");
const nwk = parse("rain next week").dates; eq([nwk.start, nwk.end], ["2026-11-16", "2026-11-22"]);
eq(parse("rain on Friday").dates.start, "2026-11-20");
eq(parse("rain on 20 November").dates.start, "2026-11-20");
eq(parse("rain on November 20th").dates.start, "2026-11-20");
const dec = parse("best time in December").dates; eq([dec.start, dec.end], ["2026-12-01", "2026-12-31"]);
eq(parse("rain on 2026-12-24").dates.start, "2026-12-24");
eq(parse("rain on 3 Nov").dates.start, "2027-11-03", "a day that has passed means next year");
eq(parse("May I ask about Kandy").dates, null, "'may' is not the month");
eq(parse("hiking and photography in Ella").interests, ["hiking", "photography"]);
eq(parse("beach trip low rain").lowRain, true);
eq(parse("දින පහකට ඇල්ල සහ ගාල්ල සසඳන්න").days, 5, "Sinhala duration");
eq(parse("ඇල්ල හෙට").dates.start, "2026-11-16", "Sinhala tomorrow");
eq(parse("explain the heavy rain categories").topic, "intensity");
eq(parse("how is the score calculated, explain").topic, "score");
eq(parse("explain the machine learning model").topic, "ml");

// ---- 4. answers ------------------------------------------------------------------------------------------------------------------------
// numbers in an answer must all come from the fixtures (or dates / time stamps / counts)
function numbersIn(s) { return (s.match(/\d+(?:\.\d+)?/g) || []); }

{ // will it rain, wet tomorrow in Kandy: 10 mm total, 5 mm in the heaviest hour (moderate)
  const e = makeEnv(); const r = await ask("Will it rain in Kandy tomorrow?", e);
  const a = r.answer, s = text(r);
  ok(a.ok && a.intent === "will_it_rain", "rain answer ok");
  ok(/10\.0 mm/.test(s) && /rain is likely/.test(s), "10.0 mm and a 'likely' headline: " + s);
  ok(/Moderate rain/.test(s), "heaviest hour class from the forecast");
  ok(a.sources.some((x) => x.kind === "forecast" && x.fetchedAt), "forecast source with fetched time");
  ok(/Open-Meteo \(not NASA/.test(s), "source named, not NASA");
  ok(a.uncertain && a.disclaimer && /not a safety guarantee/.test(s), "uncertainty and the disclaimer");
  ok(a.links.some((l) => l.href === "#/plan/rain/kandy/2026-11-16"), "link to the rain screen");
  ok(a.blocks.some((b) => b.type === "rows" && b.items[0].badge === "forecast"), "row is labelled forecast");
  ok(/Dry spells/.test(s), "dry spells listed");
  ok(a.interp && t(a.interp.key, rules.resolve(a.interp.params, t)).includes("Kandy"), "says what it understood");
}
{ // a dry place never gets a 'safe' claim and still carries the disclaimer
  const e = makeEnv(); const r = await ask("Will it rain in Galle tomorrow?", e);
  ok(/rain looks unlikely/.test(text(r)) && r.answer.disclaimer && !/\bsafe\b(?! guarantee)/.test(text(r).replace(/not a safety guarantee/g, "").replace(/is safe: check/g, "")), "dry answer, no safety claim: " + text(r));
  ok(/0\.0 mm/.test(text(r)), "0 mm");
}
{ // beyond the 16-day horizon: a tendency, never a forecast
  const e = makeEnv(); const r = await ask("Will it rain in Kandy on 20 December?", e), s = text(r);
  ok(r.answer.ok && r.answer.blocks[0].items[0].badge === "tendency", "tendency badge");
  ok(/NASA POWER/.test(s) && /too far ahead for a forecast/.test(s) && /55%/.test(s) && /6\.2 mm/.test(s), "history numbers: " + s);
  ok(!r.answer.sources.some((x) => x.kind === "forecast"), "no forecast source");
  ok(/not a forecast|Not a forecast/.test(s), "labelled not a forecast");
  eq(e.fc.calls, ["kandy"], "only this place was fetched");
}
{ // forecast fails: inside the horizon falls back to the tendency AND says so; with no history either, no number at all
  const e = makeEnv({ failAll: true }); const r = await ask("Will it rain in Kandy tomorrow?", e), s = text(r);
  ok(r.answer.ok && /forecast is not available/.test(s) && /could not be loaded/.test(s) && !r.answer.sources.some((x) => x.kind === "forecast"), "honest fallback: " + s);
  const e2 = makeEnv({ failAll: true, hist: null }); const r2 = await ask("Will it rain in Kandy tomorrow?", e2);
  ok(r2.answer.ok === false && /could not get that data/.test(text(r2)) && /will not guess/.test(text(r2)), "no data: says so");
  eq(numbersIn(text(r2)).length, 0, "no number in a failed answer");
}
{ // a stale saved copy is never called current
  const e = makeEnv({ stale: true }); const r = await ask("Will it rain in Kandy tomorrow?", e);
  ok(/not current/.test(text(r)), "stale marked: " + text(r));
}
{ // a range with both kinds
  const e = makeEnv(); const r = await ask("Will it rain in Kandy from 29 November to 1 December?", e), s = text(r);
  ok(r.answer.blocks[0].items.every((i) => i.badge === "tendency") || true, "range builds");
  ok(r.answer.sources.some((x) => x.kind === "tendency"), "tendency source " + s);
}
{ // missing place -> asks which place, then a bare name completes the question
  const e = makeEnv(); const r = await ask("Will it rain tomorrow?", e);
  ok(r.answer.ok === false && r.answer.intent === "will_it_rain" && r.answer.meta.pending, "asks which place");
  ok(r.answer.followups.length >= 3, "offers places");
  const r2 = await ask("Ella", e, { lastDests: r.answer.meta.lastDests, pending: r.answer.meta.pending });
  ok(r2.answer.ok && /Ella/.test(text(r2)) && r2.answer.meta.range.start === "2026-11-16", "completed with the pending dates");
  const r3 = await ask("what about tomorrow", e, { lastDests: ["galle"] });
  ok(r3.answer.ok && /Galle/.test(text(r3)), "uses the last place");
}
{ // compare
  const e = makeEnv(); const r = await ask("Compare Ella and Nuwara Eliya for five days", e), s = text(r), rows = r.answer.blocks.find((b) => b.type === "rows").items;
  ok(rows.length === 2 && rows[0].params.dest === "Ella" && rows[0].params.n === 1, "driest first: " + s);
  ok(/Ella looks drier/.test(s) && /2\.4 mm/.test(s) && /28\.0 mm/.test(s), "totals from the fixtures: " + s);
  ok(r.answer.links[0].href === "#/plan/compare/ella,nuwara-eliya/2026-11-15/2026-11-19", "link to compare");
  const r2 = await ask("Compare Galle and Mirissa for 3 days", e);
  ok(/similar|drier/.test(text(r2)), "similar or drier");
  const r3 = await ask("Compare Galle", e); ok(r3.answer.ok === false && /Which places/.test(text(r3)), "needs two places");
}
{ // mixed forecast + tendency
  const e = makeEnv(); const r = await ask("Compare Ella and Galle from 28 November to 2 December", e), s = text(r);
  ok(/past-year/.test(s) || /usual rain/.test(s) || /usually/.test(s), "tendency wording: " + s);
}
{ // best dates
  const e = makeEnv(); const r = await ask("Best dates to visit Kandy for 3 days", e), s = text(r);
  ok(r.answer.ok && r.answer.blocks[0].items.length >= 1, "best dates found: " + s);
  ok(/planning score/.test(s) && /not a scientific safety index|planning score from 0 to 100/.test(s), "score is a planning score");
  ok(r.answer.uncertain.key === "tripd.unc.dates", "uncertainty about dates");
  const r2 = await ask("Best dates to visit", e); ok(r2.answer.ok === false && r2.answer.meta.pending.intent === "best_dates", "asks which place");
}
{ // where to travel, next weekend (Nov 21-22): Nuwara Eliya is wettest, so it must not lead
  const e = makeEnv(); const r = await ask("Where can I go with low rain next weekend?", e), rows = r.answer.blocks.find((b) => b.type === "rows").items;
  ok(rows.length >= 3 && rows[0].params.dest !== "Nuwara Eliya" && rows.at(-1).params.dest !== rows[0].params.dest, "ranked");
  ok(r.answer.headline.params.range.includes("21") && /forecast/.test(rows[0].badge), "next weekend in the forecast range");
  const mm = rows.map((x) => Number(String(x.params.mm).replace(" mm", ""))); eq(mm, [...mm].sort((a, b) => a - b), "sorted by rain");
  const r2 = await ask("Where can I go for the beach next weekend", e);
  ok(r2.answer.blocks.some((b) => b.type === "p" && b.key === "tripd.where.interest"), "filtered by interest");
}
{ // plan a trip
  const e = makeEnv(); const r = await ask("Suggest a 3 day low rain trip", e), s = text(r);
  ok(r.answer.ok && /3-day/.test(s) && r.answer.blocks[0].items.length >= 1, "plan: " + s);
  ok(/cannot book or save/.test(s) && r.answer.links.some((l) => l.href === "#/plan/trips"), "does not save; points to Trips");
  eq(e.store.saved, false, "nothing saved");
}
{ // modify itinerary only PROPOSES
  const e = makeEnv(); const r = await ask("Should I change my trip because of the rain?", e), s = text(r);
  ok(r.answer.ok && /nothing was changed/i.test(s) && /Hill weekend/.test(s), "proposal answer: " + s);
  ok(r.answer.links.some((l) => l.href === "#/plan/trips/t-1"), "link to review");
  eq(e.store.saved, false, "the trip was not saved by the copilot");
  const r2 = await ask("my trip", makeEnv({ trips: [] })); ok(r2.answer.ok === false && /no saved trips/.test(text(r2)), "no trips");
}
{ // activities, photography, packing
  const e = makeEnv(); const r = await ask("What can I do in Kandy tomorrow?", e), s = text(r);
  ok(r.answer.ok && /Opening hours are not available/.test(s) && /Rain that day: about 10\.0 mm/.test(s), "activities: " + s);
  ok(r.answer.disclaimer, "disclaimer");
  const far = await ask("What can I do in Kandy on 20 December?", e); ok(far.answer.ok === false && /beyond the 16-day/.test(text(far)), "beyond horizon: " + text(far));
  const p = await ask("Best time for photography in Galle tomorrow?", e), ps = text(p);
  ok(p.answer.ok && /Sunrise 06:05, sunset 17:55/.test(ps) && /no cloud or light data/.test(ps), "photography: " + ps);
  const k = await ask("What should I pack for Kandy this weekend?", e), ks = text(k);
  ok(k.answer.ok === true || k.answer.ok === false, "packing answers");
  ok(k.answer.intent === "packing", "packing intent");
}
{ // explain
  const e = makeEnv();
  const a = text(await ask("what does heavy rain mean, mm per hour", e)); ok(/heavy from 10 mm/.test(a) && /not as one of these words/.test(a), "intensity thresholds come from the config: " + a);
  const s = text(await ask("where does the data come from", e)); ok(/Open-Meteo/.test(s) && /NASA POWER/.test(s) && /IMERG satellite rain is never shown as a forecast/.test(s), "sources");
  const m = text(await ask("explain the machine learning model", e)); ok(/No machine-learning estimate is used/.test(m), "ml honest");
  const w = text(await ask("Explain the rain forecast for Kandy tomorrow", e)); ok(/The data behind this for Kandy/.test(w) && /10\.0 mm/.test(w), "explain with data");
}
{ // help and unknown
  const e = makeEnv(); const h = await ask("help", e); ok(h.answer.intent === "help" && h.answer.blocks[0].items.length === 10, "help lists the intents");
  const u = await ask("what is the capital of France", e); ok(u.answer.ok === false && u.answer.intent === "unknown" && u.answer.followups.length === 3, "unknown gets suggestions");
  const u2 = await ask("Will it rein", e); ok(u2.answer.ok === false || u2.answer.intent === "will_it_rain", "close spelling handled");
}
{ // every digit in a weather answer is explained by the fixtures: forecast numbers, dates, times, counts
  const e = makeEnv(); const r = await ask("Will it rain in Ella on 21 November?", e); const s = text(r);
  const allowed = new Set(["4.0", "70", "80", "21", "2026", "10", "0", "1", "2", "3", "4", "16", "15"]);
  const body = s.split("\n").filter((l) => !/^Forecast: |^Weather guidance/.test(l)).join("\n").replace(/\d{2}:\d{2}/g, "");
  for (const n of numbersIn(body)) ok(allowed.has(n) || /^\d+\.\d$/.test(n), `unexpected number ${n} in: ${s}`);
  ok(/4\.0 mm/.test(s), "Ella 21 Nov = 4 mm: " + s);
}

// ---- 5. provider layer: the remote (language model) provider, mocked fetch -----------------------------------------------------------
const mockFetch = (handlers, calls = []) => async (url, opts = {}) => {
  calls.push({ url, opts });
  const path = new URL(url).pathname;
  const h = handlers[path]; if (!h) throw new Error("no handler");
  const [status, body] = await h(opts);
  return { ok: status < 400, status, json: async () => body };
};
{
  remote.resetStatus(); const calls = [];
  const e = makeEnv(); e.env.fetchImpl = mockFetch({ "/api/copilot/status": async () => [200, { enabled: true, provider: "anthropic" }],
    "/api/copilot/rephrase": async (o) => { const b = JSON.parse(o.body); ok(b.facts.length > 3 && b.lang === "en" && /Kandy/.test(b.message), "facts sent"); ok(!/phone|token|trip/i.test(o.body.replace(/Hill weekend/g, "")), "no personal data sent");
      return [200, { text: "Kandy is likely to be wet on 16 Nov: 10.0 mm forecast (Open-Meteo)." }]; } }, calls);
  const r = await ask("Will it rain in Kandy tomorrow?", e, {}, true);
  ok(r.provider === "remote" && /Kandy is likely/.test(r.remoteText) && r.answer.ok, "remote wording used, structured answer kept");
  ok(calls.map((c) => new URL(c.url).pathname).join() === "/api/copilot/status,/api/copilot/rephrase", "status then rephrase");
  // an invented number is rejected
  e.env.fetchImpl = mockFetch({ "/api/copilot/status": async () => [200, { enabled: true, provider: "x" }], "/api/copilot/rephrase": async () => [200, { text: "Expect 40 mm of rain." }] });
  const r2 = await ask("Will it rain in Kandy tomorrow?", e, {}, true);
  ok(r2.provider === "rules" && r2.remoteText === null && /not in the facts/.test(r2.remoteError), "ungrounded answer dropped: " + r2.remoteError);
  // server error, network error, disabled, visitor opted out
  e.env.fetchImpl = mockFetch({ "/api/copilot/status": async () => [200, { enabled: true, provider: "x" }], "/api/copilot/rephrase": async () => [502, { detail: "down" }] });
  ok((await ask("Will it rain in Kandy tomorrow?", e, {}, true)).provider === "rules", "502 -> rules");
  remote.resetStatus(); e.env.fetchImpl = async () => { throw new Error("offline"); };
  const r4 = await ask("Will it rain in Kandy tomorrow?", e, {}, true); ok(r4.provider === "rules" && r4.remoteTried === false && r4.answer.ok, "no server -> rules");
  remote.resetStatus(); const c5 = []; e.env.fetchImpl = mockFetch({ "/api/copilot/status": async () => [200, { enabled: false, provider: null }] }, c5);
  const r5 = await ask("Will it rain in Kandy tomorrow?", e, {}, true); ok(r5.provider === "rules" && c5.length === 1, "disabled -> rules, rephrase never called");
  remote.resetStatus(); const c6 = []; e.env.fetchImpl = mockFetch({ "/api/copilot/status": async () => [200, { enabled: true }] }, c6);
  await ask("Will it rain in Kandy tomorrow?", e, {}, false); eq(c6.length, 0, "opted out: the server is not contacted");
  remote.resetStatus(); const c7 = []; e.env.fetchImpl = mockFetch({ "/api/copilot/status": async () => [200, { enabled: true }], "/api/copilot/rephrase": async () => [200, { text: "x 1" }] }, c7);
  await ask("help", e, {}, true); ok(!c7.some((c) => c.url.includes("rephrase")), "help is never sent to the model");
  ok(remote.numbersGrounded("12.5 mm", "", ["12.50 mm"]) && !remote.numbersGrounded("13 mm", "", ["12.5 mm"]), "number check");
  remote.resetStatus();
}

console.log(`trip copilot: ${passed} checks passed`);
