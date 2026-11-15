// Copilot step 3: the rule-based ANSWER BUILDER (the default provider, runs in the browser, needs no key or server).
//
//   answerFor(parsed, env, memory) -> answer          (async; calls the tools in tools.js)
//   plain(answer, t)               -> string[]        (the answer as plain sentences: used as the "facts" for the optional AI wording)
//   resolve(params, t)             -> params with every nested text reference turned into text
//
// An answer is only TEXT KEYS + PARAMS (strings in web/strings/trip-d.*.json), never free-form text, so every sentence was written by
// a person and can be checked, and the page can show it in either language. Numbers come only from tool results. Every answer states
// the kind of data (forecast / historical tendency), its source and when it was fetched, the uncertainty, and (for weather) the
// disclaimer that low forecast rain does not make a place safe. If a tool fails the answer says so and gives no number.
//
// answer = { intent, ok, interp:{key,params}, headline:{key,params}, blocks:[{type:"p",key,params,tone?} | {type:"rows",title?,items:[{key,params,badge?,href?,sub?}]}],
//            sources:[{kind:"forecast",fetchedAt,stale} | {kind:"tendency",period}], uncertain:{key,params}|null, disclaimer:boolean,
//            links:[{href,key}], followups:[{key,params}], meta:{dests,pending} }
import { addDays, daysBetween, ACTIVITY_IDS } from "./intents.js";

export const K = (k, p) => ({ k, p });                         // a reference to another text, filled in when the answer is shown
const P = (key, params = {}, tone) => ({ type: "p", key, params, tone });
const ROWS = (items, title) => ({ type: "rows", title, items });
const pad = (n) => String(n).padStart(2, "0");

export function resolve(params, t) {
  const one = (v) => (Array.isArray(v) ? v.map(one).join(", ") : v && typeof v === "object" && "k" in v ? t(v.k, resolve(v.p || {}, t)) : v);
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = one(v);
  return out;
}
const say = (item, t) => t(item.key, resolve(item.params || {}, t));

// default formatters (the page passes its own, language aware ones)
export const DEFAULT_FMT = {
  date: (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  mm: (x) => (x === null || x === undefined ? "–" : `${(Math.round(x * 10) / 10).toFixed(1)} mm`),
  pct: (x) => (x === null || x === undefined ? "–" : `${Math.round(x)}%`),
  hour: (h) => `${pad(h)}:00`,
  time: (iso) => String(iso || "").slice(0, 16).replace("T", " "),
  name: (d) => d.name_en,
};

// ---- helpers ---------------------------------------------------------------------------------------------------------------------
export function verdictOf(s, cfg) {
  if (!s) return null;
  const v = cfg.verdict, mm = s.totalMm ?? null, ch = s.maxChance ?? null;
  if (mm === null && ch === null) return null;
  if ((mm !== null && mm >= v.wet_mm) || (ch !== null && ch >= v.wet_chance)) return "wet";
  if ((mm !== null && mm >= v.maybe_mm) || (ch !== null && ch >= v.maybe_chance)) return "maybe";
  return "dry";
}
const summaryOfDay = (d) => (d.kind !== "forecast" ? null : d.summary || (d.daily ? { totalMm: d.daily.precipMm, maxChance: d.daily.chanceMax, maxClass: null } : null));

export function answerFor(parsed, env, memory = {}) {
  const e = { ...env, fmt: { ...DEFAULT_FMT, ...(env.fmt || {}) } };
  parsed = { ...parsed, horizon: e.cfg.forecast_horizon_days };
  const handler = HANDLERS[parsed.intent] || unknown;
  return handler(parsed, e, memory).then((a) => finish(a, parsed, e));
}

// add the "what I understood" line and the memory the next question may use
function finish(a, parsed, e) {
  const names = (a.meta?.dests || parsed.dests || []).map((id) => e.data.byId.get(id)).filter(Boolean).map((d) => e.fmt.name(d));
  const range = a.meta?.range;
  a.interp = { key: "tripd.interp", params: { what: K(`tripd.intent.${a.intent}`), place: names.length ? names.join(", ") : K("tripd.interp.none"),
    dates: range ? rangeText(range, e) : K("tripd.interp.none") } };
  a.meta = { ...(a.meta || {}), lastDests: a.meta?.dests?.length ? a.meta.dests : parsed.dests };
  return a;
}
const rangeText = (r, e) => (r.start === r.end ? e.fmt.date(r.start) : `${e.fmt.date(r.start)} – ${e.fmt.date(r.end)}`);

function base(intent, extra = {}) {
  return { intent, ok: true, headline: null, blocks: [], sources: [], uncertain: null, disclaimer: false, links: [], followups: [], meta: {}, ...extra };
}
const link = (href, key) => ({ href, key });

// sources block of an answer from a tool result
function addSources(a, r) {
  if (r?.forecastInfo) a.sources.push({ kind: "forecast", fetchedAt: r.forecastInfo.fetchedAt, stale: r.forecastInfo.stale });
  const tendency = r?.usedTendency !== undefined ? r.usedTendency : Boolean(r?.days?.some((d) => d.kind === "tendency"));
  if (tendency) a.sources.push({ kind: "tendency", period: r.period || null });
}

// A tool failed: say it, never guess a number.
function failure(intent, r, parsed) {
  const key = { forecast_failed: "tripd.fail.forecast", beyond_horizon: "tripd.fail.beyond", no_data: "tripd.fail.no_data", no_windows: "tripd.fail.no_windows", tool_missing: "tripd.fail.tool", tool_failed: "tripd.fail.tool" }[r?.error] || "tripd.fail.tool";
  const a = base(intent, { ok: false, headline: { key: "tripd.fail.head", params: {} }, meta: { dests: parsed?.dests || [] } });
  a.blocks.push(P(key, { n: parsed?.horizon ?? "" }, "warn"), P("tripd.fail.no_guess"));
  for (const n of r?.notes || []) a.blocks.push(P(n.key, n.params || {}));
  return a;
}

// ---- the questions for the suggestion chips ------------------------------------------------------------------------------------
const POPULAR = ["kandy", "galle", "ella", "nuwara-eliya", "sigiriya", "mirissa", "yala", "colombo", "anuradhapura"];
export function samplePlaces(data, n = 3) {
  const out = [];
  for (const id of POPULAR) if (data.byId.has(id) && out.length < n) out.push(data.byId.get(id));
  for (const d of data.destinations) if (out.length < n && !out.includes(d)) out.push(d);
  return out;
}
export function exampleQuestion(intent, data, fmt = DEFAULT_FMT) {
  const [a, b, c] = samplePlaces(data, 3).map((d) => fmt.name(d));
  return { key: `tripd.example.${intent}`, params: { a: a || "", b: b || "", c: c || "" } };
}
const examplesFor = (intents, e) => intents.map((i) => exampleQuestion(i, e.data, e.fmt));

// ---- shared pieces ---------------------------------------------------------------------------------------------------------------
function placeOf(parsed, e, memory) {
  const id = parsed.dests[0] || memory?.lastDests?.[0];
  return id ? e.data.byId.get(id) || null : null;
}
function needPlace(intent, parsed, e, many = false) {
  const a = base(intent, { ok: false, headline: { key: many ? "tripd.need.head_many" : "tripd.need.head", params: {} }, meta: { pending: { intent, dates: parsed.dates, days: parsed.days, interests: parsed.interests } } });
  a.blocks.push(P(many ? "tripd.need.many" : "tripd.need.one", { a: samplePlaces(e.data, 3).map((d) => e.fmt.name(d)) }));
  a.followups = samplePlaces(e.data, 4).map((d) => ({ key: "tripd.fu.name", params: { a: e.fmt.name(d) } }));
  return a;
}
// the range the question is about: its dates, else `def` days from today; a single date with a duration ("for 3 days") spans that many days
function rangeOf(parsed, today, def) {
  let start, end;
  if (parsed.dates) { start = parsed.dates.start; end = parsed.dates.end; if (start === end && parsed.days && parsed.days > 1) end = addDays(start, parsed.days - 1); }
  else { start = today; end = addDays(today, (parsed.days || def) - 1); }
  let clamped = false;
  if (daysBetween(today, start) < 0) { start = today; clamped = true; if (daysBetween(start, end) < 0) end = start; }
  return { start, end, clamped };
}
const interestsOf = (parsed, prefsInterests) => (parsed.interests.length ? parsed.interests : prefsInterests || []);

async function todayOf(e) { const r = await e.tools.today(); return r.ok ? r.today : null; }

function disclaim(a) { a.disclaimer = true; return a; }

// ---- intents -----------------------------------------------------------------------------------------------------------------------
async function willItRain(parsed, e, memory) {
  const dest = placeOf(parsed, e, memory);
  if (!dest) return needPlace("will_it_rain", parsed, e);
  const today = await todayOf(e);
  if (!today) return failure("will_it_rain", { error: "tool_missing" }, parsed);
  const range = rangeOf(parsed, today, 2);
  const r = await e.tools.rainOutlook(dest, range.start, range.end);
  if (!r.ok) return failure("will_it_rain", r, parsed);
  const a = base("will_it_rain", { meta: { dests: [dest.id], range } });
  const name = e.fmt.name(dest);
  if (range.clamped) a.blocks.push(P("tripd.note.past_clamped"));
  const shown = r.days.slice(0, 10);
  const items = shown.map((d) => dayRow(d, r.dest, e));
  const forecastDays = r.days.filter((d) => d.kind === "forecast");
  if (r.days.length === 1 && forecastDays.length === 1) {
    const v = verdictOf(summaryOfDay(forecastDays[0]), e.cfg);
    a.headline = { key: v ? `tripd.rain.head.${v}` : "tripd.rain.head.unknown", params: { dest: name, date: e.fmt.date(range.start) } };
  } else a.headline = { key: "tripd.rain.head_range", params: { dest: name, range: rangeText(range, e) } };
  a.blocks.push(ROWS(items));
  if (r.days.length > shown.length) a.blocks.push(P("tripd.note.more_days", { shown: shown.length, total: r.days.length }));
  if (r.days.length === 1 && forecastDays[0]?.summary?.goodWindows?.length) {
    a.blocks.push(P("tripd.rain.windows", { list: forecastDays[0].summary.goodWindows.map((w) => `${e.fmt.hour(w.from)}–${e.fmt.hour(w.to)}`).join(", ") }));
  }
  if (r.forecastFailed) a.blocks.push(P("tripd.note.forecast_failed", {}, "warn"));
  if (forecastDays.some((d) => d.summary === null)) a.blocks.push(P("tripd.note.daily_only"));
  addSources(a, r);
  a.uncertain = { key: r.usedForecast ? "tripd.unc.forecast" : "tripd.unc.tendency", params: {} };
  a.links.push(link(`#/plan/rain/${dest.id}/${range.start}`, "tripd.link.rain"), link(`#/plan/dates/${dest.id}`, "tripd.link.dates"));
  a.followups = examplesFor(["activities_tomorrow", "packing"], e);
  return disclaim(a);
}

function dayRow(d, dest, e) {
  const date = e.fmt.date(d.date);
  if (d.kind === "forecast") {
    const s = summaryOfDay(d), v = verdictOf(s, e.cfg);
    const params = { date, verdict: K(v ? `tripd.verdict.${v}` : "tripd.verdict.unknown"), mm: e.fmt.mm(s?.totalMm ?? null), chance: e.fmt.pct(s?.maxChance ?? null),
      cls: s?.maxClass ? K(`trip.int.${s.maxClass}`) : "–" };
    return { key: d.summary ? "tripd.row.fc" : "tripd.row.fc_daily", params, badge: "forecast", href: `#/plan/rain/${dest.id}/${d.date}` };
  }
  if (d.kind === "tendency") return { key: d.beyond ? "tripd.row.tend" : "tripd.row.tend_fallback", params: { date, pwet: e.fmt.pct(d.tendency.pWet * 100), mm: e.fmt.mm(d.tendency.meanMm) }, badge: "tendency" };
  return { key: "tripd.row.none", params: { date } };
}

// one place's rain row for rankings
function rankRow(row, n, e) {
  const name = e.fmt.name(row.dest);
  const common = { n, dest: name, chance: e.fmt.pct(row.maxChance) };
  if (row.nForecast && row.nTendency) return { key: "tripd.row.cmp_mixed", params: { ...common, f: e.fmt.mm(row.forecastMm), nf: row.nForecast, u: e.fmt.mm(row.usualMm), nt: row.nTendency }, badge: "forecast", href: `#/plan/rain/${row.dest.id}` };
  if (row.nForecast) return { key: "tripd.row.cmp_fc", params: { ...common, mm: e.fmt.mm(row.forecastMm) }, badge: "forecast", href: `#/plan/rain/${row.dest.id}` };
  return { key: "tripd.row.cmp_tend", params: { ...common, mm: e.fmt.mm(row.usualMm) }, badge: "tendency", href: `#/plan/dates/${row.dest.id}` };
}
function rankSources(a, r) {
  if (r.forecastInfo) a.sources.push({ kind: "forecast", fetchedAt: r.forecastInfo.fetchedAt, stale: r.forecastInfo.stale });
  if (r.usedTendency) a.sources.push({ kind: "tendency", period: r.period || null });
  a.uncertain = { key: r.forecastInfo ? "tripd.unc.forecast" : "tripd.unc.tendency", params: {} };
}
function namesOf(ids, e) { return ids.map((id) => e.data.byId.get(id)).filter(Boolean).map((d) => e.fmt.name(d)).join(", "); }

async function compare(parsed, e, memory) {
  const dests = parsed.dests.map((id) => e.data.byId.get(id)).filter(Boolean).slice(0, 4);
  if (dests.length < 2) return needPlace("compare_destinations", parsed, e, true);
  const today = await todayOf(e);
  if (!today) return failure("compare_destinations", { error: "tool_missing" }, parsed);
  const range = rangeOf(parsed, today, 3);
  const r = await e.tools.rankByRain(dests, range.start, range.end);
  if (!r.ok) return failure("compare_destinations", r, parsed);
  const a = base("compare_destinations", { meta: { dests: dests.map((d) => d.id), range } });
  if (range.clamped) a.blocks.push(P("tripd.note.past_clamped"));
  const [first, second] = r.rows;
  if (second && (second.totalMm - first.totalMm) >= 1) a.headline = { key: "tripd.cmp.head_better", params: { best: e.fmt.name(first.dest), range: rangeText(range, e) } };
  else a.headline = { key: "tripd.cmp.head_similar", params: { range: rangeText(range, e) } };
  a.blocks.push(ROWS(r.rows.map((row, i) => rankRow(row, i + 1, e))));
  if (r.missing.length) a.blocks.push(P("tripd.cmp.missing", { list: namesOf(r.missing, e) }, "warn"));
  if (r.forecastInfo && r.usedTendency) a.blocks.push(P("tripd.cmp.mixed_note"));
  rankSources(a, r);
  a.links.push(link(`#/plan/compare/${dests.map((d) => d.id).join(",")}/${range.start}/${range.end}`, "tripd.link.compare"));
  a.followups = examplesFor(["best_dates"], e);
  return disclaim(a);
}

async function bestDates(parsed, e, memory) {
  const dest = placeOf(parsed, e, memory);
  if (!dest) return needPlace("best_dates", parsed, e);
  const today = await todayOf(e);
  if (!today) return failure("best_dates", { error: "tool_missing" }, parsed);
  const n = parsed.days || 3;
  const start = parsed.dates ? parsed.dates.start : today;
  const end = parsed.dates ? parsed.dates.end : addDays(today, 44);
  const range = { start: daysBetween(today, start) < 0 ? today : start, end };
  const r = await e.tools.bestDates(dest, n, range.start, range.end, 3);
  if (!r.ok) return failure("best_dates", r, parsed);
  const a = base("best_dates", { meta: { dests: [dest.id], range } });
  a.headline = { key: "tripd.best.head", params: { dest: e.fmt.name(dest), days: n, range: rangeText(range, e) } };
  a.blocks.push(ROWS(r.results.map((w, i) => {
    const key = { forecast: "tripd.row.best_fc", tendency: "tripd.row.best_tend", mixed: "tripd.row.best_mixed" }[w.dataKind] || "tripd.row.best_fc";
    const first = w.reasons?.[0];
    return { key, params: { n: i + 1, from: e.fmt.date(w.start), to: e.fmt.date(w.end), score: w.score === null ? "–" : Math.round(w.score), mm: e.fmt.mm(w.rainMm), chance: e.fmt.pct(w.pRain) },
      badge: w.dataKind === "tendency" ? "tendency" : "forecast", sub: first ? { key: first.key, params: first.params || {} } : null, href: `#/plan/dates/${dest.id}` };
  })));
  for (const note of r.notes || []) a.blocks.push(P(note.key, note.params || {}));
  a.blocks.push(P("trip.score_note"));
  if (r.results.some((w) => w.dataKind !== "forecast")) a.sources.push({ kind: "tendency", period: null });
  if (r.forecastInfo && r.results.some((w) => w.dataKind !== "tendency")) a.sources.unshift({ kind: "forecast", fetchedAt: r.forecastInfo.fetchedAt, stale: r.forecastInfo.stale });
  a.uncertain = { key: "tripd.unc.dates", params: {} };
  a.links.push(link(`#/plan/dates/${dest.id}`, "tripd.link.dates"));
  a.followups = examplesFor(["packing"], e);
  return disclaim(a);
}

// the places that offer an activity the visitor asked for
function candidatesFor(parsed, e) {
  let list = e.data.destinations.slice(0, 60);
  const want = parsed.interests;
  let relaxed = false;
  if (want.length) {
    const hit = list.filter((d) => want.some((id) => (d.activities || []).includes(id)));
    if (hit.length >= 2) list = hit; else relaxed = true;
  }
  return { list, relaxed };
}

async function wherePlaces(parsed, e) {
  const today = await todayOf(e);
  if (!today) return failure("where_to_travel", { error: "tool_missing" }, parsed);
  const range = rangeOf(parsed, today, 3);
  const { list, relaxed } = candidatesFor(parsed, e);
  const r = await e.tools.rankByRain(list, range.start, range.end);
  if (!r.ok) return failure("where_to_travel", r, parsed);
  const a = base("where_to_travel", { meta: { dests: [], range } });
  a.headline = { key: "tripd.where.head", params: { range: rangeText(range, e) } };
  if (parsed.interests.length) a.blocks.push(P(relaxed ? "tripd.where.interest_none" : "tripd.where.interest", { list: parsed.interests.map((id) => K(`trip.act.${id}`)) }));
  if (range.clamped) a.blocks.push(P("tripd.note.past_clamped"));
  a.blocks.push(ROWS(r.rows.slice(0, 5).map((row, i) => rankRow(row, i + 1, e))));
  a.blocks.push(P("tripd.where.note", { n: r.rows.length }));
  if (r.missing.length) a.blocks.push(P("tripd.where.missing", { n: r.missing.length }));
  rankSources(a, r);
  a.links.push(link("#/plan/suggest", "tripd.link.suggest"), link("#/plan/explore", "tripd.link.explore"));
  a.followups = examplesFor(["plan_trip"], e);
  return disclaim(a);
}

async function planTrip(parsed, e) {
  const today = await todayOf(e);
  if (!today) return failure("plan_trip", { error: "tool_missing" }, parsed);
  const n = parsed.days || 3;
  const { list, relaxed } = candidatesFor(parsed, e);
  const a = base("plan_trip", { meta: { dests: [] } });
  let picks = [];
  let range;
  if (parsed.dates) {
    range = rangeOf(parsed, today, n);
    const r = await e.tools.rankByRain(list, range.start, range.end);
    if (!r.ok) return failure("plan_trip", r, parsed);
    picks = r.rows.slice(0, 3).map((row) => ({ dest: row.dest, start: range.start, end: range.end, mm: row.totalMm, kind: row.nForecast ? (row.nTendency ? "mixed" : "forecast") : "tendency", forecastInfo: r.forecastInfo, period: r.period }));
  } else {
    range = { start: today, end: addDays(today, 13) };
    const week = await e.tools.rankByRain(list, today, addDays(today, 6));
    if (!week.ok) return failure("plan_trip", week, parsed);
    const found = [];
    for (const row of week.rows.slice(0, 6)) {
      const b = await e.tools.bestDates(row.dest, n, range.start, range.end, 1);
      if (b.ok && b.results[0] && b.results[0].score !== null) found.push({ dest: row.dest, start: b.results[0].start, end: b.results[0].end, mm: b.results[0].rainMm, score: b.results[0].score, kind: b.results[0].dataKind, reason: b.results[0].reasons?.[0] || null, forecastInfo: b.forecastInfo });
    }
    found.sort((x, y) => y.score - x.score);
    picks = found.slice(0, 3);
    if (week.forecastInfo) a.sources.push({ kind: "forecast", fetchedAt: week.forecastInfo.fetchedAt, stale: week.forecastInfo.stale });
  }
  if (!picks.length) return failure("plan_trip", { error: "no_windows" }, parsed);
  a.meta.range = range;
  a.meta.dests = [picks[0].dest.id];
  a.headline = { key: "tripd.plan.head", params: { days: n } };
  if (parsed.interests.length) a.blocks.push(P(relaxed ? "tripd.where.interest_none" : "tripd.where.interest", { list: parsed.interests.map((id) => K(`trip.act.${id}`)) }));
  a.blocks.push(ROWS(picks.map((p, i) => ({ key: p.score === undefined ? "tripd.row.plan_nosc" : "tripd.row.plan", href: `#/plan/dates/${p.dest.id}`, badge: p.kind === "tendency" ? "tendency" : "forecast",
    params: { n: i + 1, dest: e.fmt.name(p.dest), from: e.fmt.date(p.start), to: e.fmt.date(p.end), mm: e.fmt.mm(p.mm), score: p.score === undefined ? "–" : Math.round(p.score) },
    sub: p.reason ? { key: p.reason.key, params: p.reason.params || {} } : null }))));
  // activities on the first day of the best pick
  const first = picks[0];
  const acts = await e.tools.activities(first.dest, first.start, interestsOf(parsed, []));
  if (acts.ok) {
    const good = acts.list.filter((x) => x.suitable).slice(0, 4).map((x) => K(`trip.act.${x.id}`));
    if (good.length) a.blocks.push(P("tripd.plan.acts", { dest: e.fmt.name(first.dest), date: e.fmt.date(first.start), list: good }));
  }
  if (picks.some((p) => p.kind !== "forecast")) a.sources.push({ kind: "tendency", period: picks.find((p) => p.period)?.period || null });
  a.blocks.push(P("tripd.plan.save"), P("trip.score_note"));
  a.uncertain = { key: "tripd.unc.dates", params: {} };
  a.links.push(link(`#/plan/dates/${first.dest.id}`, "tripd.link.dates"), link("#/plan/trips", "tripd.link.trips"), link("#/plan/packing", "tripd.link.packing"));
  a.followups = examplesFor(["packing"], e);
  return disclaim(a);
}

async function modifyItinerary(parsed, e) {
  const t = await e.tools.trips();
  if (!t.ok) return failure("modify_itinerary", t, parsed);
  const a = base("modify_itinerary", { meta: { dests: [] } });
  if (!t.trips.length) {
    a.ok = false; a.headline = { key: "tripd.mod.head_none", params: {} };
    a.blocks.push(P("tripd.mod.no_trips"));
    a.links.push(link("#/plan/trips", "tripd.link.trips"));
    a.followups = examplesFor(["plan_trip"], e);
    return a;
  }
  const today = await todayOf(e);
  const text = String(parsed.text || "").toLowerCase();
  const byName = t.trips.find((x) => x.name && text.includes(String(x.name).toLowerCase()));
  const trip = byName || t.trips.find((x) => (x.items || []).some((i) => i.day >= (today || ""))) || t.trips[0];
  const r = await e.tools.proposeChanges(trip);
  if (!r.ok) return failure("modify_itinerary", r, parsed);
  a.headline = { key: "tripd.mod.head", params: { trip: trip.name || "" } };
  const itemOf = (id) => (trip.items || []).find((i) => i.id === id);
  if (!r.proposals.length) a.blocks.push(P("tripd.mod.none"));
  const rows = [];
  for (const pr of r.proposals.slice(0, 6)) {
    const it = itemOf(pr.itemId);
    const dest = it ? e.data.byId.get(it.destId) : null;
    const what = it ? { act: K(`trip.act.${it.activity}`), dest: dest ? e.fmt.name(dest) : "", day: e.fmt.date(it.day) } : { act: "", dest: "", day: "" };
    rows.push({ key: "tripd.row.mod_problem", params: { ...what, problem: K(pr.problem.key, pr.problem.params || {}) }, badge: "forecast" });
    const best = (pr.options || []).find((o) => o.type !== "keep") || null;
    if (best) {
      const key = best.type === "move" ? "tripd.row.mod_move" : "tripd.row.mod_replace";
      rows.push({ key, params: { day: best.toDay ? e.fmt.date(best.toDay) : "", slot: best.toSlot ? K(`tripd.slot.${best.toSlot}`) : "", act: best.toActivity ? K(`trip.act.${best.toActivity}`) : "",
        dest: best.toDest && e.data.byId.get(best.toDest) ? e.fmt.name(e.data.byId.get(best.toDest)) : "" }, sub: best.reason ? { key: best.reason.key, params: best.reason.params || {} } : null });
    }
  }
  if (rows.length) a.blocks.push(ROWS(rows));
  a.blocks.push(P("tripd.mod.approval", {}, "info"));
  a.sources.push({ kind: "forecast", fetchedAt: r.forecastInfo?.fetchedAt, stale: r.forecastInfo?.stale });
  a.uncertain = { key: "tripd.unc.forecast", params: {} };
  a.links.push(link(`#/plan/trips/${trip.id}`, "tripd.link.review"));
  return disclaim(a);
}

async function activities(parsed, e, memory) {
  const dest = placeOf(parsed, e, memory);
  if (!dest) return needPlace("activities_tomorrow", parsed, e);
  const today = await todayOf(e);
  if (!today) return failure("activities_tomorrow", { error: "tool_missing" }, parsed);
  const date = parsed.dates ? parsed.dates.start : addDays(today, 1);
  const prefs = await e.tools.prefs();
  const r = await e.tools.activities(dest, date, interestsOf(parsed, prefs.ok ? prefs.prefs.interests : []));
  if (!r.ok) return failure("activities_tomorrow", r, parsed);
  const a = base("activities_tomorrow", { meta: { dests: [dest.id], range: { start: date, end: date } } });
  a.headline = { key: "tripd.act.head", params: { dest: e.fmt.name(dest), date: e.fmt.date(date) } };
  const s = r.summary;
  const items = [{ key: "tripd.row.day_summary", params: { mm: e.fmt.mm(s.totalMm), chance: e.fmt.pct(s.maxChance), cls: s.maxClass ? K(`trip.int.${s.maxClass}`) : "–" }, badge: "forecast" }];
  for (const x of r.list.slice(0, 8)) {
    const w = x.bestWindow ? { from: e.fmt.hour(x.bestWindow.from), to: e.fmt.hour(x.bestWindow.to) } : null;
    items.push({ key: x.suitable ? (w ? "tripd.row.act_ok_window" : "tripd.row.act_ok") : "tripd.row.act_no",
      params: { act: K(`trip.act.${x.id}`), reason: x.reason ? K(x.reason.key, x.reason.params || {}) : "", ...(w || {}) } });
  }
  a.blocks.push(ROWS(items));
  if (!r.list.length) a.blocks.push(P("tripd.act.none"));
  a.blocks.push(P("tripd.act.hours_note"));
  addSources(a, { forecastInfo: r.forecastInfo });
  a.uncertain = { key: "tripd.unc.forecast", params: {} };
  a.links.push(link(`#/plan/rain/${dest.id}/${date}`, "tripd.link.rain"));
  a.followups = examplesFor(["photography_best", "packing"], e);
  return disclaim(a);
}

async function photography(parsed, e, memory) {
  const dest = placeOf(parsed, e, memory);
  if (!dest) return needPlace("photography_best", parsed, e);
  const today = await todayOf(e);
  if (!today) return failure("photography_best", { error: "tool_missing" }, parsed);
  const date = parsed.dates ? parsed.dates.start : addDays(today, 1);
  const r = await e.tools.photography(dest, date);
  if (!r.ok) return failure("photography_best", r, parsed);
  const a = base("photography_best", { meta: { dests: [dest.id], range: { start: date, end: date } } });
  a.headline = { key: "tripd.photo.head", params: { dest: e.fmt.name(dest), date: e.fmt.date(date) } };
  const light = e.cfg.intensity.light_min;
  const items = [];
  if (r.sunrise && r.sunset) items.push({ key: "tripd.photo.sun", params: { sr: r.sunrise, ss: r.sunset }, badge: "forecast" });
  if (r.sunriseRainMm !== null) items.push({ key: r.sunriseRainMm >= light ? "tripd.photo.sr_wet" : "tripd.photo.sr_dry", params: { time: r.sunrise || "", mm: e.fmt.mm(r.sunriseRainMm) }, badge: "forecast" });
  if (r.sunsetRainMm !== null) items.push({ key: r.sunsetRainMm >= light ? "tripd.photo.ss_wet" : "tripd.photo.ss_dry", params: { time: r.sunset || "", mm: e.fmt.mm(r.sunsetRainMm) }, badge: "forecast" });
  items.push(r.windows.length ? { key: "tripd.photo.windows", params: { list: r.windows.map((w) => `${e.fmt.hour(w.from)}–${e.fmt.hour(w.to)}`).join(", ") }, badge: "forecast" } : { key: "tripd.photo.no_window", params: {}, badge: "forecast" });
  a.blocks.push(ROWS(items), P("tripd.photo.light_note"));
  addSources(a, { forecastInfo: r.forecastInfo });
  a.uncertain = { key: "tripd.unc.forecast", params: {} };
  a.links.push(link(`#/plan/rain/${dest.id}/${date}`, "tripd.link.rain"));
  return disclaim(a);
}

async function packing(parsed, e, memory) {
  const dest = placeOf(parsed, e, memory);
  if (!dest) return needPlace("packing", parsed, e);
  const today = await todayOf(e);
  if (!today) return failure("packing", { error: "tool_missing" }, parsed);
  const range = rangeOf(parsed, today, 3);
  const prefs = await e.tools.prefs();
  const r = await e.tools.packing(dest, range.start, range.end, interestsOf(parsed, prefs.ok ? prefs.prefs.interests : []));
  if (!r.ok) return failure("packing", r, parsed);
  const a = base("packing", { meta: { dests: [dest.id], range } });
  a.headline = { key: "tripd.pack.head", params: { dest: e.fmt.name(dest), range: rangeText(range, e), worst: e.fmt.date(r.worstDate) } };
  const items = [];
  for (const c of r.categories) {
    if (!c.items?.length) continue;
    items.push({ key: "tripd.row.pack", params: { cat: K(c.key), items: c.items.slice(0, 8).map((i) => K(i.key)) } });
  }
  a.blocks.push(ROWS(items));
  if (!items.length) a.blocks.push(P("tripd.pack.empty"));
  a.blocks.push(P("tripd.pack.note"));
  addSources(a, { forecastInfo: r.forecastInfo });
  a.uncertain = { key: "tripd.unc.forecast", params: {} };
  a.links.push(link("#/plan/packing", "tripd.link.packing"));
  return disclaim(a);
}

async function explain(parsed, e, memory) {
  const a = base("explain_rain", { meta: { dests: parsed.dests } });
  const c = e.cfg, i = c.intensity;
  a.headline = { key: `tripd.ex.head.${parsed.topic || "why"}`, params: {} };
  switch (parsed.topic) {
    case "intensity": a.blocks.push(P("tripd.ex.intensity", { light: i.light_min, moderate: i.moderate_min, heavy: i.heavy_min, vheavy: i.very_heavy_min })); break;
    case "sources": a.blocks.push(P("tripd.ex.sources", { days: c.forecast_horizon_days }), P("tripd.ex.imerg")); break;
    case "tendency": a.blocks.push(P("tripd.ex.tendency", { days: c.forecast_horizon_days, wet: c.wet_day_mm })); break;
    case "score": a.blocks.push(P("tripd.ex.score", { w: Math.round(c.weights.weather * 100), a: Math.round(c.weights.activity * 100), p: Math.round(c.weights.preference * 100), e: Math.round(c.weights.environment * 100) }), P("trip.score_note")); break;
    case "ml": {
      const meta = e.data.modelMeta;
      a.blocks.push(P(!meta ? "tripd.ex.ml_unknown" : meta.ml_available ? "tripd.ex.ml_yes" : "tripd.ex.ml_no"));
      break;
    }
    default: a.blocks.push(P("tripd.ex.why", { days: c.forecast_horizon_days }), P("tripd.ex.sources_short"));
  }
  a.uncertain = { key: "tripd.unc.forecast", params: {} };
  a.links.push(link("#/data-sources", "tripd.link.sources"));
  if (parsed.dests.length) {                                   // "why will it rain in Kandy?" also shows the data the answer would use
    const inner = await willItRain({ ...parsed, dates: parsed.dates }, e, memory);
    if (inner.ok) { a.blocks.push(P("tripd.ex.data_for", { dest: inner.headline.params.dest || "" })); a.blocks.push(...inner.blocks); a.sources.push(...inner.sources); a.links.push(...inner.links); a.meta.range = inner.meta.range; }
  }
  return disclaim(a);
}

async function help(parsed, e) {
  const a = base("help", { headline: { key: "tripd.help.head", params: {} } });
  a.blocks.push(ROWS(["will_it_rain", "compare_destinations", "best_dates", "where_to_travel", "plan_trip", "modify_itinerary", "activities_tomorrow", "photography_best", "packing", "explain_rain"]
    .map((id) => ({ key: "tripd.help.item", params: { what: K(`tripd.intent.${id}`), q: K(`tripd.example.${id}`, exampleQuestion(id, e.data, e.fmt).params) } }))));
  a.blocks.push(P("tripd.help.limits"));
  a.followups = examplesFor(["will_it_rain", "where_to_travel", "plan_trip"], e);
  return a;
}

// Nothing matched: say so, offer "Did you mean...?", never guess.
async function unknown(parsed, e) {
  const a = base("unknown", { ok: false, headline: { key: "tripd.unknown.head", params: {} } });
  a.blocks.push(P("tripd.unknown.body"));
  const guesses = (parsed.candidates || []).filter((id) => id !== "help");
  const list = guesses.length ? guesses : ["will_it_rain", "where_to_travel", "best_dates"];
  a.blocks.push(P(guesses.length ? "tripd.unknown.did_you_mean" : "tripd.unknown.try"));
  a.followups = examplesFor(list, e);
  return a;
}

const HANDLERS = { will_it_rain: willItRain, compare_destinations: compare, best_dates: bestDates, where_to_travel: wherePlaces, plan_trip: planTrip,
  modify_itinerary: modifyItinerary, activities_tomorrow: activities, photography_best: photography, packing, explain_rain: explain, help };

// ---- the answer as plain sentences -------------------------------------------------------------------------------------------------
export function sourceLine(s, t, fmtTime) {
  if (s.kind === "forecast") return t(s.stale ? "tripd.src.forecast_stale" : "tripd.src.forecast", { time: s.fetchedAt ? fmtTime(s.fetchedAt) : t("tripd.src.unknown_time") });
  return t("tripd.src.tendency", { period: s.period || "1981–2025" });
}
export function plain(answer, t, fmtTime = DEFAULT_FMT.time) {
  const lines = [];
  if (answer.headline) lines.push(say(answer.headline, t));
  for (const b of answer.blocks) {
    if (b.type === "p") lines.push(say(b, t));
    else for (const it of b.items) { lines.push(say(it, t)); if (it.sub) lines.push(say(it.sub, t)); }
  }
  for (const s of dedupeSources(answer.sources)) lines.push(sourceLine(s, t, fmtTime));
  if (answer.uncertain) lines.push(say(answer.uncertain, t));
  if (answer.disclaimer) lines.push(t("trip.disclaimer"));
  return lines.filter(Boolean);
}
export function dedupeSources(list) {
  const seen = new Set(), out = [];
  for (const s of list || []) { const k = `${s.kind}|${s.fetchedAt || s.period || ""}|${s.stale || ""}`; if (!seen.has(k)) { seen.add(k); out.push(s); } }
  return out;
}
export { ACTIVITY_IDS };
