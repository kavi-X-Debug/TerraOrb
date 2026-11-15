// Trip planner: Dashboard (#/plan).
// Welcome, destination + dates search, smart suggestions (top 3), current weather and rain summary for the visitor's saved or last
// destination, a small comparison, upcoming trips, weather alerts and a link to the Copilot.
// All weather numbers come from the Open-Meteo forecast (not NASA) through forecast.js; nothing is invented: if a forecast cannot be
// loaded the card says so. Alerts use only the real hourly forecast of the next 3 days.
import { loadForecast, loadForecasts, hoursOf } from "../forecast.js";
import { classifyHour, INTENSITY } from "../intensity.js";
import { runSuggestions, periodText, kindBadges } from "./suggest.js";
import { todayStr, nowHour, addDays, isDate, hh, loadPrefs, lastDest, setLastDest, tripsList, staleNote } from "./explore.js";

// ctx.ui has the element helpers; the text function t comes from ctx.t, so both are handed out together.
const U = (ctx) => ({ ...ctx.ui, t: ctx.t });

const ALERT_DAYS = 3;

// Which destination ids a saved trip uses (the trips screen owns the exact shape, so read it defensively)
function tripDestIds(trip) {
  const ids = new Set();
  for (const it of trip.items || []) if (it && it.destId) ids.add(it.destId);
  if (trip.destId) ids.add(trip.destId);
  for (const d of trip.destIds || []) ids.add(d);
  return [...ids];
}
const tripEnd = (trip) => trip.end || (trip.items || []).map((i) => i.day).filter(Boolean).sort().at(-1) || null;
const tripStart = (trip) => trip.start || (trip.items || []).map((i) => i.day).filter(Boolean).sort()[0] || null;

// Scan the next days of a forecast for heavy rain, strong wind and heat. Returns [{type, time, value}] (first hour of each kind and the peak).
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

const whenText = (ctx, stamp) => `${ctx.ui.fmtDate(stamp.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })} ${stamp.slice(11, 16)}`;

export async function renderDashboard(ctx, parts, view) {
  ctx.ui.ensureCss("trip-b");
  const { h, t, destName } = U(ctx);
  const dests = ctx.data.destinations;
  const today = todayStr();
  if (!dests.length) {
    view.replaceChildren(h("h1", { text: t("tripb.dash.title") }), h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t("tripb.no_destinations") })));
    return;
  }
  const trips = tripsList();
  const upcoming = trips.filter((tr) => { const e = tripEnd(tr); return !e || e >= today; }).sort((a, b) => String(tripStart(a) || "9").localeCompare(String(tripStart(b) || "9")));
  const tripDestSet = [...new Set(upcoming.flatMap(tripDestIds))].filter((id) => ctx.data.byId.has(id));
  const focusId = [lastDest(), tripDestSet[0], "colombo", "kandy", dests[0].id].find((id) => id && ctx.data.byId.has(id));
  let focus = ctx.data.byId.get(focusId);

  // ----- search + dates -----
  const list = h("datalist", { id: "tb-dest-list" }, dests.flatMap((d) => [h("option", { value: d.name_en }), d.name_si ? h("option", { value: d.name_si }) : null]));
  const q = h("input", { type: "search", id: "tb-d-q", list: "tb-dest-list", value: destName(focus), autocomplete: "off", "aria-describedby": "tb-d-hint" });
  const from = h("input", { type: "date", id: "tb-d-from", value: today, min: today });
  const to = h("input", { type: "date", id: "tb-d-to", value: addDays(today, 2), min: today });
  const hint = h("p", { class: "tb-fine", id: "tb-d-hint", text: t("tripb.dash.search_hint") });
  const find = () => {
    const v = q.value.trim().toLowerCase();
    return dests.find((d) => d.name_en.toLowerCase() === v || (d.name_si || "").toLowerCase() === v) || dests.find((d) => `${d.name_en} ${d.name_si || ""}`.toLowerCase().includes(v));
  };
  const withDest = (fn) => (ev) => {
    ev?.preventDefault();
    const d = v_ok() ? find() : null;
    if (!d) { ctx.ui.toast("tripb.dash.not_found", "warn"); q.focus(); return; }
    if (!isDate(from.value) || !isDate(to.value) || to.value < from.value) { ctx.ui.toast("tripb.dash.bad_dates", "warn"); return; }
    setLastDest(d.id); fn(d);
  };
  const v_ok = () => q.value.trim().length > 0;
  const form = h("form", { class: "tb-search tp-card", novalidate: true },
    h("div", { class: "tb-formgrid" },
      h("label", { class: "tp-field", for: "tb-d-q" }, h("span", { text: t("tripb.dash.where") }), q),
      h("label", { class: "tp-field", for: "tb-d-from" }, h("span", { text: t("tripb.dash.from") }), from),
      h("label", { class: "tp-field", for: "tb-d-to" }, h("span", { text: t("tripb.dash.to") }), to)),
    h("div", { class: "tb-actions" },
      h("button", { type: "submit", class: "tp-btn primary", text: t("tripb.dash.check") }),
      h("button", { type: "button", class: "tp-btn", text: t("tripb.dash.best_dates"), onclick: withDest((d) => ctx.go(`#/plan/dates/${d.id}`)) }),
      h("button", { type: "button", class: "tp-btn", text: t("tripb.dash.explore"), onclick: withDest((d) => ctx.go(`#/plan/explore/${d.id}/${from.value}`)) })), hint, list);
  form.addEventListener("submit", withDest((d) => ctx.go(`#/plan/rain/${d.id}/${from.value}`)));

  // ----- cards (each loads on its own so a slow forecast never blocks the page) -----
  const alertsBox = h("section", { class: "tb-card tp-card", "aria-labelledby": "tb-h-alerts" }, h("h2", { id: "tb-h-alerts", text: t("tripb.dash.alerts") }));
  const nowBox = h("section", { class: "tb-card tp-card", "aria-labelledby": "tb-h-now" }, h("h2", { id: "tb-h-now", text: t("tripb.dash.now") }));
  const sugBox = h("section", { class: "tb-card tp-card tb-wide", "aria-labelledby": "tb-h-sug" }, h("h2", { id: "tb-h-sug", text: t("tripb.dash.suggestions") }));
  const cmpBox = h("section", { class: "tb-card tp-card tb-wide", "aria-labelledby": "tb-h-cmp" }, h("h2", { id: "tb-h-cmp", text: t("tripb.dash.compare") }));
  const tripBox = h("section", { class: "tb-card tp-card", "aria-labelledby": "tb-h-trips" }, h("h2", { id: "tb-h-trips", text: t("tripb.dash.trips") }));
  const copilot = h("section", { class: "tb-card tp-card tb-copilot", "aria-labelledby": "tb-h-cop" },
    h("h2", { id: "tb-h-cop", text: t("tripb.dash.copilot") }), h("p", { text: t("tripb.dash.copilot_text") }),
    h("a", { class: "tp-btn primary tb-btnlink", href: "#/plan/copilot", text: t("tripb.dash.copilot_btn") }));

  view.replaceChildren(
    h("header", { class: "tb-hero" }, h("h1", { text: t("tripb.dash.title") }), h("p", { class: "tb-lead", text: t("tripb.dash.welcome") })),
    form,
    h("div", { class: "tb-dash" }, alertsBox, nowBox, sugBox, cmpBox, tripBox, copilot),
    h("p", { class: "tb-fine", text: t("trip.disclaimer") }));

  paintTrips(ctx, tripBox, upcoming);
  paintNow(ctx, nowBox, focus, today, (id) => { setLastDest(id); renderDashboard(ctx, parts, view); });
  paintAlerts(ctx, alertsBox, [...new Set([focus.id, ...tripDestSet])].map((id) => ctx.data.byId.get(id)), today);
  paintSuggestions(ctx, sugBox, cmpBox, today);
}

// ----- upcoming trips -----
function paintTrips(ctx, box, upcoming) {
  const { h, t, fmtDate } = U(ctx);
  if (!upcoming.length) { box.append(h("p", { class: "tb-sub", text: t("tripb.dash.no_trips") }), h("a", { class: "tp-btn tb-btnlink", href: "#/plan/explore", text: t("tripb.dash.plan_first") })); return; }
  const ul = h("ul", { class: "tb-triplist" });
  for (const tr of upcoming.slice(0, 4)) {
    const a = tripStart(tr), b = tripEnd(tr);
    const names = tripDestIds(tr).map((id) => ctx.data.byId.get(id)).filter(Boolean).map((d) => ctx.ui.destName(d));
    ul.append(h("li", {}, h("a", { href: `#/plan/trips/${tr.id}`, text: tr.name || tr.id }),
      h("span", { class: "tb-sub", text: [a ? (b && b !== a ? `${fmtDate(a)} – ${fmtDate(b)}` : fmtDate(a)) : t("tripb.dash.no_dates"), names.slice(0, 3).join(", ")].filter(Boolean).join(" · ") })));
  }
  box.append(ul, h("a", { class: "tb-link", href: "#/plan/trips", text: t("tripb.dash.all_trips") }));
}

// ----- current weather + 7-day rain for one destination -----
async function paintNow(ctx, box, dest, today, onChange) {
  const { h, t, destName, fmtMm, fmtTemp, fmtPct, badge, stamp } = U(ctx);
  const sel = h("select", { id: "tb-focus", "aria-label": t("tripb.dash.focus") }, ctx.data.destinations.map((d) => h("option", { value: d.id, text: destName(d), selected: d.id === dest.id ? true : null })));
  sel.addEventListener("change", () => onChange(sel.value));
  box.append(h("div", { class: "tp-field" }, h("label", { class: "tb-sub", for: "tb-focus", text: t("tripb.dash.focus") }), sel));
  const body = h("div", { "aria-busy": "true" }, h("p", { class: "tp-state", role: "status", text: t("trip.state.loading") }));
  box.append(body);
  let fc;
  try { fc = await loadForecast(dest); } catch (e) { console.error(e); fc = { ok: false }; }
  if (!body.isConnected) return;
  body.setAttribute("aria-busy", "false");
  if (!fc || !fc.ok) { body.replaceChildren(h("p", { class: "tp-state error", role: "alert", text: t("tripb.dash.no_forecast") })); return; }
  const rows = hoursOf(fc, today);
  const cur = rows[nowHour()] || rows.find((r) => r && r.mm !== null) || null;
  const cls = cur && cur.mm !== null && cur.mm !== undefined ? classifyHour(cur.mm, ctx.cfg) : null;
  const dl = h("dl", { class: "tb-facts" });
  const add = (k, v) => dl.append(h("div", {}, h("dt", { text: k }), h("dd", { text: v })));
  add(t("tripb.dash.temp_now"), fmtTemp(cur?.temp)); add(t("tripb.dash.rain_hour"), cls ? `${fmtMm(cur.mm)} · ${t(INTENSITY[cls]?.key || "trip.int.none")}` : "–");
  add(t("tripb.f.chance"), fmtPct(cur?.chance)); add(t("tripb.dash.wind_now"), cur?.wind != null ? `${Math.round(cur.wind)} km/h` : "–");
  body.replaceChildren(h("p", {}, badge("forecast"), " ", h("span", { class: "tb-sub", text: stamp(fc.fetchedAt) })), staleNote(ctx, fc), dl);

  // rainfall summary: the next 7 days, one bar each (daily total from the same forecast)
  const d = fc.daily || {}; const dates = d.time || [];
  const start = Math.max(0, dates.indexOf(today));
  const days = dates.slice(start, start + 7).map((date, i) => ({ date, mm: d.precipitation_sum?.[start + i], chance: d.precipitation_probability_max?.[start + i], tmax: d.temperature_2m_max?.[start + i] }));
  if (days.length) {
    const max = Math.max(5, ...days.map((x) => x.mm || 0));
    body.append(h("h3", { text: t("tripb.dash.week_rain") }),
      h("ul", { class: "tb-week" }, days.map((x) => h("li", {},
        h("span", { class: "tb-wk-d", text: ctx.ui.fmtDate(x.date, { weekday: "short", day: "numeric" }) }),
        h("span", { class: "tb-wk-bar", role: "img", "aria-label": `${fmtMm(x.mm)}` }, h("i", { style: `width:${x.mm == null ? 0 : Math.max(x.mm > 0 ? 3 : 0, Math.round((x.mm / max) * 100))}%` })),
        h("span", { class: "tb-wk-v", text: `${x.mm == null ? "–" : fmtMm(x.mm)}${x.chance != null ? ` · ${fmtPct(x.chance)}` : ""}` })))),
      h("a", { class: "tb-link", href: `#/plan/rain/${dest.id}`, text: t("tripb.dash.more_rain") }));
  }
}

// ----- alerts -----
async function paintAlerts(ctx, box, places, today) {
  const { h, t, destName, badge } = U(ctx);
  const body = h("div", { "aria-busy": "true" }, h("p", { class: "tp-state", role: "status", text: t("trip.state.loading") }));
  box.append(body);
  let map;
  try { map = await loadForecasts(places); } catch (e) { console.error(e); map = new Map(); }
  if (!body.isConnected) return;
  body.setAttribute("aria-busy", "false");
  const items = []; let failed = 0; let stale = null;
  for (const d of places) {
    const fc = map.get(d.id);
    if (!fc || !fc.ok) { failed++; continue; }
    if (fc.stale) stale = fc;
    for (const a of scanAlerts(fc, ctx.cfg, today, nowHour())) items.push({ ...a, dest: d, stale: !!fc.stale });
  }
  body.replaceChildren();
  if (items.length) {
    body.append(h("ul", { class: "tb-alerts", role: "list" }, items.map((a) => h("li", { class: `tb-alert ${a.type}` },
      h("strong", { text: t(`tripb.alert.${a.type}`, { place: destName(a.dest) }) }),
      h("span", { class: "tb-sub", text: t(`tripb.alert.${a.type}.detail`, { when: whenText(ctx, a.time), peak: whenText(ctx, a.peakTime), value: Math.round(a.value * 10) / 10 }) })))));
  } else if (failed < places.length) {
    body.append(h("p", { class: "tb-ok", text: t("tripb.alert.none", { days: ALERT_DAYS, places: places.map((d) => destName(d)).join(", ") }) }));
  }
  if (failed) body.append(h("p", { class: "tp-state error", role: "alert", text: t("tripb.alert.failed", { n: failed }) }));
  body.append(h("p", { class: "tb-fine" }, badge("forecast"), " ", t("tripb.alert.limits", { rain: ctx.cfg.intensity.heavy_min, wind: ctx.cfg.comfort.windy_kmh, gust: ctx.cfg.comfort.strong_kmh, heat: ctx.cfg.comfort.hot_c })));
  if (stale) body.append(staleNote(ctx, stale));
}

// ----- suggestions + mini comparison -----
async function paintSuggestions(ctx, sugBox, cmpBox, today) {
  const { h, t, destName, fmtMm, fmtTemp, fmtPct } = U(ctx);
  const load = (box) => { const p = h("p", { class: "tp-state", role: "status", text: t("tripb.s.loading") }); box.append(p); return p; };
  const l1 = load(sugBox), l2 = load(cmpBox);
  const prefs = loadPrefs(); const start = today;
  let res;
  try { res = await runSuggestions(ctx, { region: prefs.region, start, durationDays: 3, prefs }); } catch (e) { console.error(e); res = null; }
  if (!sugBox.isConnected) return;
  l1.remove(); l2.remove();
  if (!res || !res.rows.length) {
    for (const b of [sugBox, cmpBox]) b.append(h("p", { class: "tp-state error", role: "alert", text: t("tripb.dash.no_suggestions") }));
    return;
  }
  const top = res.rows.slice(0, 3);
  sugBox.append(h("p", { class: "tb-sub", text: t("tripb.dash.sug_lead", { from: ctx.ui.fmtDate(res.days[0]), to: ctx.ui.fmtDate(res.days.at(-1)) }) }),
    h("div", { class: "tb-top3" }, top.map((r, i) => h("article", { class: "tb-mini" },
      h("h3", {}, h("span", { class: "tb-rank", text: `${i + 1}. ` }), h("a", { href: `#/plan/explore/${r.dest.id}/${start}`, text: destName(r.dest) })),
      h("p", { class: "tb-score-line" }, h("strong", { text: r.S == null ? "–" : String(Math.round(r.S)) }), "/100"),
      h("p", { class: "tb-badges" }, ...kindBadges(ctx, r)),
      h("p", { class: "tb-sub", text: periodText(ctx, r) }),
      r.reasons.slice(0, 2).map((x) => h("p", { class: "tb-sub", text: ctx.t(x.key, x.params || {}) }))))),
    h("a", { class: "tb-link", href: "#/plan/suggest", text: t("tripb.dash.sug_more") }));

  const table = h("table", { class: "tb-table" }, h("caption", { class: "tb-sub", text: t("tripb.dash.cmp_caption") }),
    h("thead", {}, h("tr", {}, ["tripb.dash.cmp.place", "tripb.s.rain_total", "tripb.s.chance", "tripb.s.temp", "tripb.s.weather_score"].map((k) => h("th", { scope: "col", text: t(k) })))),
    h("tbody", {}, top.map((r) => h("tr", {}, h("th", { scope: "row", text: destName(r.dest) }), h("td", { text: fmtMm(r.rainTotal) }), h("td", { text: fmtPct(r.chance) }), h("td", { text: fmtTemp(r.temp) }), h("td", { text: r.W == null ? "–" : String(Math.round(r.W)) })))));
  cmpBox.append(h("div", { class: "tb-tablewrap" }, table), h("p", { class: "tb-fine" }, ...kindBadges(ctx, top[0])),
    h("a", { class: "tb-link", href: `#/plan/compare/${top.map((r) => r.dest.id).join(",")}/${res.days[0]}/${res.days.at(-1)}`, text: t("tripb.dash.cmp_full") }));
}
