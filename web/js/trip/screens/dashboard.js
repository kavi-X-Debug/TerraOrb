// Trip planner: Home (#/plan). Made to be easy for anyone:
//   1. one clear question: "Where are you going, and when?" (a place box, quick date buttons, one big button)
//   2. an answer in plain words: will it rain, which day is best, a strip of days to tap, and warnings only when there are any
//   3. a few big, labelled things to do next (hour by hour, best dates, compare, ideas, packing, copilot)
//   4. my saved trips, and "ideas" that are looked up only when the visitor asks (so the page is never slow or empty)
// All weather comes from the Open-Meteo forecast (not NASA) through forecast.js. Nothing is invented: if the forecast cannot be loaded
// the card says so. Days more than 16 days away are never shown as a forecast.
import { loadForecast, hoursOf, dayKind } from "../forecast.js";
import { summariseDay } from "../intensity.js";
import { saveTrip } from "../store.js";
import { mountGuide } from "../../guide.js";
import { runSuggestions, periodText, kindBadges } from "./suggest.js";
import { todayStr, nowHour, addDays, dateRange, isDate, loadPrefs, lastDest, setLastDest, tripsList, staleNote } from "./explore.js";

const U = (ctx) => ({ ...ctx.ui, t: ctx.t });
const ALERT_DAYS = 3;
const SHOW_DAYS = 16;

// ---- small helpers ----------------------------------------------------------------------------------------------------------------
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();                // 0 = Sunday
function quickRange(kind, today) {
  if (kind === "tomorrow") return [addDays(today, 1), addDays(today, 1)];
  if (kind === "week") return [today, addDays(today, 6)];
  if (kind === "weekend") {
    const d = dow(today);
    if (d === 6) return [today, addDays(today, 1)];                            // Saturday: today and tomorrow
    if (d === 0) return [today, today];                                        // Sunday: today only
    return [addDays(today, 6 - d), addDays(today, 7 - d)];                     // the coming Saturday and Sunday
  }
  return [today, today];
}

// Which destination ids a saved trip uses (the trips screen owns the exact shape, so read it defensively)
function tripDestIds(trip) {
  const ids = new Set();
  for (const it of trip.items || []) if (it && it.destId) ids.add(it.destId);
  if (trip.destId) ids.add(trip.destId);
  for (const d of trip.destIds || []) ids.add(d);
  return [...ids];
}
const tripEnd = (trip) => trip.end || trip.endDate || (trip.items || []).map((i) => i.day).filter(Boolean).sort().at(-1) || null;
const tripStart = (trip) => trip.start || trip.startDate || (trip.items || []).map((i) => i.day).filter(Boolean).sort()[0] || null;

// Scan the next days of a forecast for heavy rain, strong wind and heat. Returns [{type, time, value, peakTime}] (first hour of each kind and the peak).
export function scanAlerts(forecast, cfg, date, hour) {
  const hr = forecast?.hourly; if (!hr || !Array.isArray(hr.time)) return [];
  const from = `${date}T${String(hour).padStart(2, "0")}:00`, to = `${addDays(date, ALERT_DAYS)}T${String(hour).padStart(2, "0")}:00`;
  const found = {};
  const note = (type, time, value) => { const f = found[type]; if (!f) found[type] = { type, time, value, peakTime: time }; else if (value > f.value) { f.value = value; f.peakTime = time; } };
  hr.time.forEach((time, i) => {
    if (time < from || time >= to) return;
    const mm = hr.precipitation?.[i], gust = hr.wind_gusts_10m?.[i], wind = hr.wind_speed_10m?.[i], temp = hr.temperature_2m?.[i];
    if (typeof mm === "number" && mm >= cfg.intensity.heavy_min) note("heavy_rain", time, mm);
    if ((typeof gust === "number" && gust >= cfg.comfort.strong_kmh) || (typeof wind === "number" && wind >= cfg.comfort.windy_kmh)) note("wind", time, Math.max(gust ?? 0, wind ?? 0));
    if (typeof temp === "number" && temp >= cfg.comfort.hot_c) note("heat", time, temp);
  });
  return Object.values(found);
}

// Dry / maybe / wet for one whole day, with the same limits the single-place planner uses (cfg.verdict)
function dayVerdict(sum, cfg) {
  if (!sum || sum.totalMm === null || sum.totalMm === undefined) return "none";
  const v = cfg.verdict, chance = sum.maxChance ?? 0;
  if (sum.totalMm >= v.wet_mm || chance >= v.wet_chance) return "wet";
  if (sum.totalMm >= v.maybe_mm || chance >= v.maybe_chance) return "maybe";
  return "dry";
}
// Icons are pictures made in Google Flow (web/img/trip/icons/*.png). A picture AND a word are always shown (never colour alone).
// If a picture is missing it is simply left out; "no forecast" uses a plain dash.
const ICON_DIR = "img/trip/icons/";
const WEATHER_ICON = { dry: "dry", maybe: "maybe", wet: "wet" };
function icon(h, name, cls) {
  if (!name) return h("span", { class: cls, "aria-hidden": "true", text: "–" });
  const img = h("img", { class: cls, src: `${ICON_DIR}${name}.png`, alt: "", width: "56", height: "56", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.remove(), { once: true });
  return img;
}

// ---- the screen -------------------------------------------------------------------------------------------------------------------
export async function renderDashboard(ctx, parts, view) {
  ctx.ui.ensureCss("trip-b");
  const { h, t, destName } = U(ctx);
  const dests = ctx.data.destinations;
  const today = todayStr();
  if (!dests.length) {
    view.replaceChildren(h("h1", { text: t("tripb.home.title") }), h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t("tripb.no_destinations") })));
    return;
  }
  const trips = tripsList();
  const upcoming = trips.filter((tr) => { const e = tripEnd(tr); return !e || e >= today; }).sort((a, b) => String(tripStart(a) || "9").localeCompare(String(tripStart(b) || "9")));
  const firstTripDest = upcoming.flatMap(tripDestIds).find((id) => ctx.data.byId.has(id));
  const focusId = [lastDest(), firstTripDest, "colombo", "kandy", dests[0].id].find((id) => id && ctx.data.byId.has(id));
  const state = { dest: ctx.data.byId.get(focusId), quick: "week", from: today, to: addDays(today, 6) };

  // ----- 1. the question -----
  const list = h("datalist", { id: "th-places" }, dests.flatMap((d) => [h("option", { value: d.name_en }), d.name_si ? h("option", { value: d.name_si }) : null]));
  const place = h("input", { type: "search", id: "th-place", class: "th-place", list: "th-places", value: destName(state.dest), autocomplete: "off", placeholder: t("tripb.home.where_ph") });
  const from = h("input", { type: "date", id: "th-from", value: state.from, min: today });
  const to = h("input", { type: "date", id: "th-to", value: state.to, min: today });
  const custom = h("div", { class: "th-custom", hidden: true },
    h("label", { class: "tp-field", for: "th-from" }, h("span", { text: t("tripb.home.from") }), from),
    h("label", { class: "tp-field", for: "th-to" }, h("span", { text: t("tripb.home.to") }), to));
  const chips = h("div", { class: "th-chips", role: "group", "aria-label": t("tripb.home.when") });
  for (const k of ["today", "tomorrow", "weekend", "week", "pick"]) {
    chips.append(h("button", { type: "button", class: "th-chip", "data-q": k, "aria-pressed": String(k === state.quick), text: t(`tripb.home.q.${k}`), onclick: () => choose(k) }));
  }
  function choose(k) {
    state.quick = k;
    chips.querySelectorAll(".th-chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.q === k)));
    custom.hidden = k !== "pick";
    if (k !== "pick") { [state.from, state.to] = quickRange(k, today); from.value = state.from; to.value = state.to; }
  }
  const findPlace = () => {
    const v = place.value.trim().toLowerCase();
    if (!v) return null;
    return dests.find((d) => d.name_en.toLowerCase() === v || (d.name_si || "").toLowerCase() === v) || dests.find((d) => `${d.name_en} ${d.name_si || ""}`.toLowerCase().includes(v)) || null;
  };
  const answerBox = h("section", { class: "th-answer", "aria-live": "polite" });
  const go = (ev) => {
    ev?.preventDefault();
    const d = findPlace();
    if (!d) { ctx.ui.toast("tripb.home.not_found", "warn"); place.focus(); return; }
    if (state.quick === "pick") { state.from = from.value; state.to = to.value; }
    if (!isDate(state.from) || !isDate(state.to) || state.to < state.from) { ctx.ui.toast("tripb.home.bad_dates", "warn"); return; }
    state.dest = d; setLastDest(d.id);
    paintAnswer(ctx, answerBox, state, today);
    answerBox.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  };
  const form = h("form", { class: "th-card th-ask", novalidate: true },
    h("label", { class: "th-q", for: "th-place", text: t("tripb.home.where") }), place, list,
    h("p", { class: "th-q", text: t("tripb.home.when") }), chips, custom,
    h("button", { type: "submit", class: "th-go", text: t("tripb.home.go") }));
  form.addEventListener("submit", go);

  // ----- 3. what to do next (big, labelled tiles) -----
  const tile = (n, name, href) => h("a", { class: "th-tile", href }, h("span", { class: "th-ico", "aria-hidden": "true" }, icon(h, name, "th-img")),
    h("span", { class: "th-tt", text: t(`tripb.home.t${n}.t`) }), h("span", { class: "th-td", text: t(`tripb.home.t${n}.d`) }));
  const tiles = h("div", { class: "th-tiles" },
    tile(1, "hourly", `#/plan/rain/${state.dest.id}`), tile(2, "dates", `#/plan/dates/${state.dest.id}`), tile(3, "compare", "#/plan/compare"),
    tile(4, "where", "#/plan/suggest"), tile(5, "packing", "#/plan/packing"), tile(6, "copilot", "#/plan/copilot"));

  // ----- 4. ideas (looked up only when asked) and my trips -----
  const ideasBody = h("div", { class: "th-ideas-body" });
  const ideasBtn = h("button", { type: "button", class: "tp-btn primary", text: t("tripb.home.ideas_btn"), onclick: () => paintIdeas(ctx, ideasBody, ideasBtn, state, today) });
  const ideas = h("section", { class: "th-card" }, h("h2", { text: t("tripb.home.ideas") }), h("p", { class: "th-sub", text: t("tripb.home.ideas_text") }), ideasBtn, ideasBody);
  const tripsBox = h("section", { class: "th-card" }, h("h2", { text: t("tripb.home.trips") }));
  paintTrips(ctx, tripsBox, upcoming);

  view.replaceChildren(
    h("header", { class: "th-hero" }, h("h1", { text: t("tripb.home.title") }), h("p", { class: "th-lead", text: t("tripb.home.lead") })),
    form, answerBox,
    h("h2", { class: "th-next", text: t("tripb.home.next") }), tiles,
    h("div", { class: "th-two" }, ideas, tripsBox),
    h("p", { class: "th-fine", text: t("tripb.home.disc") }), h("div", { id: "th-guide" }));
  mountGuide(view.querySelector("#th-guide"), "plan");                          // detailed how-to guide
  choose("week");
  paintAnswer(ctx, answerBox, state, today);                                   // an answer is ready as soon as the page opens
}

// ---- 2. the answer ------------------------------------------------------------------------------------------------------------------
async function paintAnswer(ctx, box, state, today) {
  const { h, t, destName, fmtDate, fmtMm, fmtTemp, fmtPct, badge, stamp } = U(ctx);
  const { dest } = state;
  const cfg = ctx.cfg;
  box.replaceChildren(h("p", { class: "tp-state", role: "status", text: t("trip.state.loading") }));
  const fc = await loadForecast(dest);
  if (!box.isConnected) return;
  if (!fc || !fc.ok) {
    box.replaceChildren(h("div", { class: "th-card th-bad", role: "alert" }, h("p", { text: t("tripb.home.failed") }),
      h("button", { type: "button", class: "tp-btn", text: t("trip.state.retry"), onclick: () => paintAnswer(ctx, box, state, today) })));
    return;
  }
  const dates = dateRange(state.from, Math.min(SHOW_DAYS, Math.round((new Date(`${state.to}T00:00:00Z`) - new Date(`${state.from}T00:00:00Z`)) / 86400000) + 1));
  const days = dates.map((date) => {
    if (dayKind(date, today, cfg) !== "forecast") return { date, v: "none", beyond: true };
    const sum = summariseDay(hoursOf(fc, date), cfg);
    return { date, sum, v: dayVerdict(sum, cfg) };
  });
  const known = days.filter((d) => d.v !== "none");
  const worst = known.some((d) => d.v === "wet") ? "wet" : known.some((d) => d.v === "maybe") ? "maybe" : known.length ? "dry" : "none";
  const rank = { dry: 0, maybe: 1, wet: 2 };
  const best = known.length > 1 && worst !== "dry"
    ? [...known].sort((a, b) => rank[a.v] - rank[b.v] || (a.sum.totalMm ?? 0) - (b.sum.totalMm ?? 0))[0] : null;
  const dayLabel = (iso) => fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });
  const range = state.from === state.to ? fmtDate(state.from, { weekday: "long", day: "numeric", month: "long" }) : `${fmtDate(state.from)} – ${fmtDate(state.to)}`;

  const strip = h("ul", { class: "th-days" }, days.map((d) => h("li", {}, h("a", { class: `th-day ${d.v}`, href: d.beyond ? "#/plan/dates/" + dest.id : `#/plan/rain/${dest.id}/${d.date}` },
    h("span", { class: "th-dn", text: dayLabel(d.date) }),
    h("span", { class: "th-dm", "aria-hidden": "true" }, icon(h, WEATHER_ICON[d.v], "th-wimg")),
    h("strong", { text: t(`tripb.home.day.${d.v}`) }),
    d.sum ? h("span", { class: "th-dd", text: t("tripb.home.day_rain", { mm: (Math.round((d.sum.totalMm ?? 0) * 10) / 10).toString() }) }) : null,
    d.sum && d.sum.maxChance != null ? h("span", { class: "th-dd", text: t("tripb.home.day_chance", { p: Math.round(d.sum.maxChance) }) }) : null,
    d.sum && d.sum.maxTemp != null ? h("span", { class: "th-dd", text: fmtTemp(d.sum.maxTemp) }) : null))));

  const warnings = scanAlerts(fc, cfg, state.from > today ? state.from : today, state.from > today ? 0 : nowHour())
    .filter((a) => a.time.slice(0, 10) >= state.from && a.time.slice(0, 10) <= state.to);
  const when = (stampText) => `${fmtDate(stampText.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })} ${stampText.slice(11, 16)}`;
  const warn = warnings.length ? h("ul", { class: "th-warns", role: "list" }, warnings.map((a) => h("li", { class: "th-warn", text: t(`tripb.home.warn.${a.type}`, { when: when(a.peakTime) }) }))) : null;

  const save = () => {
    const tr = saveTrip({ name: `${destName(dest)}`, start: state.from, end: state.to, items: [] });
    if (tr) ctx.ui.toast("tripb.home.saved", "ok"); else ctx.ui.toast("trip.state.error", "error");
  };
  box.replaceChildren(h("div", { class: `th-card th-result ${worst}` },
    h("p", { class: "th-for", text: t("tripb.home.answer_for", { place: destName(dest), dates: range }) }),
    h("div", { class: "th-verdict" }, h("span", { class: "th-big", "aria-hidden": "true" }, icon(h, WEATHER_ICON[worst], "th-wimg big")), h("h2", { text: t(`tripb.home.v.${worst}`) })),
    best ? h("p", { class: "th-best", text: t("tripb.home.best_day", { day: dayLabel(best.date) }) }) : (worst === "dry" && known.length > 1 ? h("p", { class: "th-best", text: t("tripb.home.all_good") }) : null),
    warn, known.length ? h("p", { class: "th-sub", text: t("tripb.home.day_tap") }) : null, strip,
    days.some((d) => d.beyond) ? h("p", { class: "th-note", text: t("tripb.home.beyond") }) : null,
    h("div", { class: "th-actions" },
      h("a", { class: "tp-btn primary", href: `#/plan/rain/${dest.id}/${(best || known[0] || days[0]).date}`, text: t("tripb.home.hourly") }),
      h("a", { class: "tp-btn", href: `#/plan/dates/${dest.id}`, text: t("tripb.home.t2.t") }),
      h("button", { type: "button", class: "tp-btn", text: t("tripb.home.save"), onclick: save })),
    h("p", { class: "th-fine" }, badge("forecast"), " ", stamp(fc.fetchedAt)),
    fc.stale ? staleNote(ctx, fc) : null));
}

// ---- ideas, only when asked ---------------------------------------------------------------------------------------------------------
async function paintIdeas(ctx, body, btn, state, today) {
  const { h, t, destName } = U(ctx);
  btn.disabled = true;
  body.replaceChildren(h("p", { class: "tp-state", role: "status", text: t("tripb.home.ideas_wait") }));
  const prefs = loadPrefs();
  const start = state.from < today ? today : state.from;
  const days = Math.max(1, Math.min(5, Math.round((new Date(`${state.to}T00:00:00Z`) - new Date(`${state.from}T00:00:00Z`)) / 86400000) + 1));
  let res = null;
  try { res = await runSuggestions(ctx, { region: prefs.region, start, durationDays: days, prefs }); } catch (e) { console.error(e); }
  btn.disabled = false;
  if (!body.isConnected) return;
  if (!res || !res.rows.length) { body.replaceChildren(h("p", { class: "tp-state error", role: "alert", text: t("tripb.dash.no_suggestions") })); return; }
  body.replaceChildren(h("div", { class: "tb-top3" }, res.rows.slice(0, 3).map((r, i) => h("article", { class: "tb-mini" },
    h("h3", {}, h("span", { class: "tb-rank", text: `${i + 1}. ` }), h("a", { href: `#/plan/explore/${r.dest.id}/${start}`, text: destName(r.dest) })),
    h("p", { class: "tb-badges" }, ...kindBadges(ctx, r)), h("p", { class: "tb-sub", text: periodText(ctx, r) })))),
    h("a", { class: "tb-link", href: "#/plan/suggest", text: t("tripb.dash.sug_more") }));
}

// ---- my trips -----------------------------------------------------------------------------------------------------------------------
function paintTrips(ctx, box, upcoming) {
  const { h, t, fmtDate } = U(ctx);
  if (!upcoming.length) { box.append(h("p", { class: "th-sub", text: t("tripb.home.trips_none") })); return; }
  const ul = h("ul", { class: "tb-triplist" });
  for (const tr of upcoming.slice(0, 4)) {
    const a = tripStart(tr), b = tripEnd(tr);
    const names = tripDestIds(tr).map((id) => ctx.data.byId.get(id)).filter(Boolean).map((d) => ctx.ui.destName(d));
    ul.append(h("li", {}, h("a", { href: `#/plan/trips/${tr.id}`, text: tr.name || tr.id }),
      h("span", { class: "th-sub", text: [a ? (b && b !== a ? `${fmtDate(a)} – ${fmtDate(b)}` : fmtDate(a)) : t("tripb.dash.no_dates"), names.slice(0, 3).join(", ")].filter(Boolean).join(" · ") })));
  }
  box.append(ul, h("a", { class: "tb-link", href: "#/plan/trips", text: t("tripb.home.all_trips") }));
}
