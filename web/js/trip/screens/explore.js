// Trip planner: Explore destinations (#/plan/explore[/<destId>[/<date>]]).
// A map and cards of every destination with filters, and a detail panel: elevation, kinds, the weather for a chosen day and
// weather-based activity recommendations (rules in ../activities.js). This file also exports a few helpers the dashboard and
// the suggestion screen reuse (dates, prefs, "add to my trip", hourly bars).
// Forecast = Open-Meteo (not NASA, 16 days at most). Beyond that only a historical tendency (NASA POWER) is shown, never an hourly "forecast".
import { loadForecast, hoursOf, dayKind } from "../forecast.js";
import { loadHistory, tendencyFor } from "../history.js";
import { summariseDay, classifyHour, INTENSITY } from "../intensity.js";
import { ACTIVITIES, recommendActivities } from "../activities.js";
import { listTrips, saveTrip, newTripId, getPrefs, savePrefs } from "../store.js";

// ctx.ui has the element helpers; the text function t comes from ctx.t, so both are handed out together.
const U = (ctx) => ({ ...ctx.ui, t: ctx.t });

// ---------- helpers shared with dashboard.js and suggest.js ----------
const TZ = "Asia/Colombo";
export const PREF_DEFAULTS = { interests: [], maxRainMm: null, preferredTemp: "any", style: "balanced", budget: null, region: null };

export function todayStr() { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); }
export function nowHour() {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).find((p) => p.type === "hour");
  return Number(part?.value ?? 0);
}
export function addDays(iso, n) { return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10); }
export function dateRange(start, n) { return Array.from({ length: n }, (_, i) => addDays(start, i)); }
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
export const hh = (n) => (typeof n === "number" ? `${String(n).padStart(2, "0")}:00` : String(n ?? ""));

export function loadPrefs() {
  try { return { ...PREF_DEFAULTS, ...(getPrefs() || {}) }; } catch { return { ...PREF_DEFAULTS }; }
}
export function keepPrefs(p) { try { savePrefs(p); } catch { /* storage blocked: the choice is only kept for this visit */ } }

const LAST = "mc-trip-last-dest";
export function lastDest() { try { return localStorage.getItem(LAST); } catch { return null; } }
export function setLastDest(id) { try { localStorage.setItem(LAST, id); } catch { /* storage blocked */ } }

export const reasonText = (t, r) => (r && r.key ? t(r.key, r.params || {}) : "");
export const tripsList = () => { try { const l = listTrips(); return Array.isArray(l) ? l : []; } catch { return []; } };

// Short text for a forecast problem or its age: "Saved copy from ..." when the data is not current
export function staleNote(ctx, fc) {
  return fc && fc.stale ? ctx.ui.h("p", { class: "tb-stale", role: "status", text: ctx.ui.stamp(fc.fetchedAt, "trip.stale") }) : document.createTextNode("");
}

// One day for one destination: forecast (hourly rows + summary) when it is within the forecast horizon, otherwise a historical tendency.
export async function loadDay(ctx, dest, date) {
  const kind = dayKind(date, todayStr(), ctx.cfg);
  if (kind === "forecast") {
    const forecast = await loadForecast(dest);
    if (!forecast || !forecast.ok) return { kind, forecast, hours: [], summary: null, error: forecast?.error || "forecast" };
    const hours = hoursOf(forecast, date);
    const hasData = hours.some((r) => r && r.mm !== null && r.mm !== undefined);
    return { kind, forecast, hours, summary: hasData ? summariseDay(hours, ctx.cfg) : null, error: hasData ? null : "no_day" };
  }
  const history = ctx.data.history || await loadHistory().catch(() => null);
  const tendency = history ? tendencyFor(history, dest.cell, date) : null;
  return { kind, forecast: null, hours: [], summary: null, tendency, error: tendency ? null : "no_tendency" };
}

// 24 small bars, one per hour, coloured by the rain class (colour comes from intensity.js). Hours with no value stay grey.
export function hourBars(ctx, hours) {
  const { h, t } = U(ctx);
  const max = Math.max(5, ...hours.map((r) => r.mm || 0));
  const wrap = h("div", { class: "tb-hours", role: "img", "aria-label": t("tripb.hours.aria") });
  hours.forEach((r, i) => {
    const has = r.mm !== null && r.mm !== undefined;
    const cls = has ? classifyHour(r.mm, ctx.cfg) : null;
    const height = has ? Math.max(r.mm > 0 ? 6 : 2, Math.round((r.mm / max) * 100)) : 2;
    const color = cls ? INTENSITY[cls]?.color || "#3182CE" : "#C9D4E3";
    const label = has ? `${hh(i)}: ${ctx.ui.fmtMm(r.mm)} (${t(INTENSITY[cls]?.key || "trip.int.none")})` : `${hh(i)}: ${t("tripb.na")}`;
    wrap.append(h("span", { class: "tb-hour", title: label, style: `height:${height}%;background:${color}` }));
  });
  return h("div", { class: "tb-hours-wrap" }, wrap,
    h("div", { class: "tb-hours-axis", "aria-hidden": "true" }, [0, 6, 12, 18, 23].map((n) => h("span", { text: hh(n) }))));
}

// A small table of numbers for one day (forecast summary or tendency)
export function dayFacts(ctx, day) {
  const { h, t, fmtMm, fmtTemp, fmtPct } = U(ctx);
  const rows = [];
  if (day.summary) {
    const s = day.summary;
    rows.push([t("tripb.f.rain"), fmtMm(s.totalMm)], [t("tripb.f.peak"), s.maxClass ? t(INTENSITY[s.maxClass]?.key || "trip.int.none") : "–"],
      [t("tripb.f.chance"), fmtPct(s.maxChance)], [t("tripb.f.wet_hours"), s.wetHours ?? "–"],
      [t("tripb.f.temp"), s.minTemp != null && s.maxTemp != null ? `${fmtTemp(s.minTemp)} – ${fmtTemp(s.maxTemp)}` : fmtTemp(s.avgTemp)],
      [t("tripb.f.wind"), s.maxGust != null ? `${Math.round(s.avgWind ?? 0)} / ${Math.round(s.maxGust)} km/h` : "–"]);
  } else if (day.tendency) {
    const x = day.tendency;
    rows.push([t("tripb.f.pwet"), fmtPct((x.pWet ?? null) === null ? null : x.pWet * 100)], [t("tripb.f.mean"), fmtMm(x.meanMm)], [t("tripb.f.p90"), fmtMm(x.p90Mm)]);
  }
  const dl = h("dl", { class: "tb-facts" });
  for (const [k, v] of rows) dl.append(h("div", {}, h("dt", { text: k }), h("dd", { text: String(v) })));
  return dl;
}

// "Add to my trip": choose a trip (or start a new one), a day and an activity. Saved through store.js (localStorage).
export function addToTrip(ctx, dest, { date, activity } = {}) {
  const { h, t, modal, toast, destName } = U(ctx);
  const trips = tripsList();
  const pick = h("select", { id: "tb-add-trip", "aria-label": t("tripb.add.trip") },
    h("option", { value: "", text: t("tripb.add.new") }), trips.map((tr) => h("option", { value: tr.id, text: tr.name || tr.id })));
  const name = h("input", { type: "text", id: "tb-add-name", value: t("tripb.add.default_name", { place: destName(dest) }), maxlength: "60" });
  const day = h("input", { type: "date", id: "tb-add-day", value: isDate(date) ? date : todayStr(), min: todayStr() });
  const acts = (dest.activities || []).filter((a) => ACTIVITIES[a]);
  const chosen = activity || acts[0];
  const act = h("select", { id: "tb-add-act" }, h("option", { value: "", text: t("tripb.add.no_activity") }),
    acts.map((a) => h("option", { value: a, selected: a === chosen ? true : null, text: t(ACTIVITIES[a].key) })));
  const nameField = h("label", { class: "tp-field", for: "tb-add-name" }, h("span", { text: t("tripb.add.name") }), name);
  pick.addEventListener("change", () => { nameField.hidden = pick.value !== ""; });
  const body = h("div", { class: "tb-form" },
    h("label", { class: "tp-field", for: "tb-add-trip" }, h("span", { text: t("tripb.add.trip") }), pick), nameField,
    h("label", { class: "tp-field", for: "tb-add-day" }, h("span", { text: t("tripb.add.day") }), day),
    h("label", { class: "tp-field", for: "tb-add-act" }, h("span", { text: t("tripb.add.activity") }), act),
    h("p", { class: "tb-note", text: t("tripb.add.note") }));
  const dlg = modal({
    title: t("tripb.add.title", { place: destName(dest) }), body,
    actions: [{ label: t("tripb.cancel") }, {
      label: t("tripb.add.save"), primary: true, keepOpen: true, onclick: () => {
        if (!isDate(day.value)) { toast("tripb.add.bad_day", "warn"); return; }
        const existing = trips.find((tr) => tr.id === pick.value);
        const info = ACTIVITIES[act.value];
        const item = { id: `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, day: day.value, slot: "morning", destId: dest.id,
          activity: act.value || null, kind: info ? info.kind : null, locked: false, note: "" };
        const trip = existing ? { ...existing, items: [...(existing.items || []), item] }
          : { id: newTripId(), name: name.value.trim() || t("tripb.add.default_name", { place: destName(dest) }), start: day.value, end: day.value, created: new Date().toISOString(), items: [item] };
        let ok = true;
        try { saveTrip(trip); } catch { ok = false; }
        if (ok) { toast("tripb.add.done", "ok"); dlg.close(); } else toast("tripb.add.failed", "error");
      },
    }],
  });
}

// Chips to choose interests (activity ids). onChange(list) is called after every click. Used here and in the suggestion form.
export function interestChips(ctx, selected, onChange) {
  const { h, t } = U(ctx);
  const set = new Set(selected);
  const box = h("div", { class: "tb-chips", role: "group", "aria-label": t("tripb.interests") });
  for (const [id, info] of Object.entries(ACTIVITIES)) {
    const btn = h("button", { type: "button", class: "tb-chip", "aria-pressed": set.has(id) ? "true" : "false", text: t(info.key) });
    btn.addEventListener("click", () => {
      if (set.has(id)) set.delete(id); else set.add(id);
      btn.setAttribute("aria-pressed", set.has(id) ? "true" : "false");
      onChange([...set]);
    });
    box.append(btn);
  }
  return box;
}

// ---------- the screen ----------
let drawing = 0;

export async function renderExplore(ctx, parts, view) {
  ctx.ui.ensureCss("trip-b");
  const { h, t, destName } = U(ctx);
  const dests = ctx.data.destinations;
  if (!dests.length) {
    view.replaceChildren(h("h1", { text: t("tripb.explore.title") }), h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t("tripb.no_destinations") })));
    return;
  }
  const filters = { q: "", kind: "", region: "" };
  const kinds = [...new Set(dests.flatMap((d) => d.kinds || []))].sort();
  const regions = [...new Set(dests.map((d) => d.region).filter(Boolean))].sort();
  let selectedId = ctx.data.byId.has(parts[0]) ? parts[0] : null;
  let date = isDate(parts[1]) ? parts[1] : todayStr();
  let interests = loadPrefs().interests;

  const search = h("input", { type: "search", id: "tb-q", placeholder: t("tripb.explore.search_ph"), autocomplete: "off" });
  const kindSel = h("select", { id: "tb-kind" }, h("option", { value: "", text: t("tripb.explore.all_kinds") }), kinds.map((k) => h("option", { value: k, text: t(`trip.kind.${k}`) })));
  const regSel = h("select", { id: "tb-region" }, h("option", { value: "", text: t("tripb.explore.all_regions") }), regions.map((r) => h("option", { value: r, text: r })));
  const count = h("p", { class: "tb-count", role: "status", "aria-live": "polite" });
  const mapEl = h("div", { class: "tb-map", id: "tb-map", role: "region", "aria-label": t("tripb.map.aria") });
  const cards = h("div", { class: "tb-cards" });
  const detail = h("section", { class: "tb-detail tp-card", id: "tb-detail", "aria-live": "polite", hidden: true });

  view.replaceChildren(
    h("h1", { text: t("tripb.explore.title") }), h("p", { class: "tb-lead", text: t("tripb.explore.lead") }),
    h("div", { class: "tb-filters tp-card" },
      h("label", { class: "tp-field", for: "tb-q" }, h("span", { text: t("tripb.explore.search") }), search),
      h("label", { class: "tp-field", for: "tb-kind" }, h("span", { text: t("tripb.explore.kind") }), kindSel),
      h("label", { class: "tp-field", for: "tb-region" }, h("span", { text: t("tripb.explore.region") }), regSel)),
    count,
    h("div", { class: "tb-explore" }, h("div", { class: "tb-left" }, mapEl, cards), detail),
    h("p", { class: "tb-fine", text: t("trip.disclaimer") }));

  // Map: one coloured dot per destination (the cards below do the same job for keyboard and screen-reader users)
  let map = null, layer = null; const dots = new Map();
  if (window.L) {
    map = L.map(mapEl, { scrollWheelZoom: false, minZoom: 6, maxZoom: 14 }).setView([7.8, 80.7], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 14, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    layer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 80);
  } else mapEl.hidden = true;

  const dotStyle = (sel) => ({ radius: sel ? 11 : 7, color: "#fff", weight: 2, fillColor: sel ? "#F59E0B" : "#1677C8", fillOpacity: 0.95 });
  const visible = () => {
    const q = filters.q.trim().toLowerCase();
    return dests.filter((d) => (!filters.kind || (d.kinds || []).includes(filters.kind)) && (!filters.region || d.region === filters.region)
      && (!q || `${d.name_en} ${d.name_si || ""} ${d.region || ""}`.toLowerCase().includes(q)));
  };

  function paintList() {
    const list = visible();
    count.textContent = t("tripb.explore.count", { n: list.length, total: dests.length });
    cards.replaceChildren();
    if (!list.length) cards.append(h("p", { class: "tp-state", text: t("tripb.explore.none") }));
    for (const d of list) {
      const btn = h("button", { type: "button", class: `tb-dcard${d.id === selectedId ? " on" : ""}`, "aria-pressed": d.id === selectedId ? "true" : "false", "data-id": d.id },
        h("strong", { text: destName(d) }), h("span", { class: "tb-sub", text: [d.region, d.elevation_m != null ? t("tripb.elev", { m: d.elevation_m }) : null].filter(Boolean).join(" · ") }),
        h("span", { class: "tb-kinds" }, (d.kinds || []).map((k) => h("span", { class: "tb-kind", text: t(`trip.kind.${k}`) }))));
      btn.addEventListener("click", () => select(d.id));
      cards.append(btn);
    }
    if (layer) {
      layer.clearLayers(); dots.clear();
      for (const d of list) {
        if (typeof d.lat !== "number" || typeof d.lon !== "number") continue;
        const m = L.circleMarker([d.lat, d.lon], dotStyle(d.id === selectedId)).bindTooltip(destName(d));
        m.on("click", () => select(d.id));
        m.addTo(layer); dots.set(d.id, m);
      }
      if (list.length && !selectedId) { try { map.fitBounds(L.latLngBounds(list.filter((d) => typeof d.lat === "number").map((d) => [d.lat, d.lon])).pad(0.15), { maxZoom: 9 }); } catch { /* nothing to fit */ } }
    }
  }

  function select(id) {
    selectedId = id; setLastDest(id);
    try { history.replaceState(null, "", `#/plan/explore/${id}/${date}`); } catch { /* address bar unchanged */ }
    for (const [did, m] of dots) m.setStyle(dotStyle(did === id));
    for (const c of cards.querySelectorAll(".tb-dcard")) { const on = c.dataset.id === id; c.classList.toggle("on", on); c.setAttribute("aria-pressed", on ? "true" : "false"); }
    const d = ctx.data.byId.get(id);
    if (map && d) map.panTo([d.lat, d.lon]);
    paintDetail();
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function paintDetail() {
    const dest = ctx.data.byId.get(selectedId);
    if (!dest) { detail.hidden = true; return; }
    const run = ++drawing;
    detail.hidden = false;
    const head = h("div", { class: "tb-dhead" },
      h("div", {}, h("h2", { text: destName(dest) }), h("p", { class: "tb-sub", text: [dest.region, dest.elevation_m != null ? t("tripb.elev", { m: dest.elevation_m }) : t("tripb.elev_na")].join(" · ") })),
      h("button", { type: "button", class: "tp-btn", text: t("tripb.close"), "aria-label": t("tripb.close"), onclick: () => { selectedId = null; detail.hidden = true; paintList(); } }));
    const kindsRow = h("div", { class: "tb-kinds" }, (dest.kinds || []).map((k) => h("span", { class: "tb-kind", text: t(`trip.kind.${k}`) })));
    const own = (dest.activities || []).filter((a) => ACTIVITIES[a]);
    const possible = own.length ? h("p", { class: "tb-sub", text: t("tripb.d.possible", { list: own.map((a) => t(ACTIVITIES[a].key)).join(", ") }) }) : null;
    const dayInput = h("input", { type: "date", id: "tb-date", value: date, min: todayStr() });
    dayInput.addEventListener("change", () => { if (isDate(dayInput.value)) { date = dayInput.value; try { history.replaceState(null, "", `#/plan/explore/${selectedId}/${date}`); } catch { /* ignore */ } paintDetail(); } });
    const dateRow = h("div", { class: "tb-daterow" },
      h("label", { class: "tp-field", for: "tb-date" }, h("span", { text: t("tripb.d.date") }), dayInput),
      h("button", { type: "button", class: "tp-btn primary", text: t("tripb.d.add"), onclick: () => addToTrip(ctx, dest, { date }) }));
    const weather = h("div", { class: "tb-weather", "aria-busy": "true" }, h("p", { class: "tp-state", role: "status", text: t("trip.state.loading") }));
    const acts = h("div", { class: "tb-acts" });
    detail.replaceChildren(...[head, kindsRow, possible, dateRow, weather, acts].filter(Boolean));

    let day;
    try { day = await loadDay(ctx, dest, date); } catch (e) { console.error(e); day = { kind: "forecast", error: "forecast", hours: [], summary: null }; }
    if (run !== drawing || !detail.isConnected) return;
    weather.setAttribute("aria-busy", "false");
    weather.replaceChildren(h("h3", { text: t("tripb.d.weather", { date: ctx.ui.fmtDate(date, { weekday: "short", day: "numeric", month: "short" }) }) }));
    if (day.error && !day.summary && !day.tendency) {
      weather.append(h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t(day.error === "no_tendency" ? "tripb.d.no_tendency" : day.error === "no_day" ? "tripb.d.no_day" : "tripb.d.no_forecast") })));
    } else if (day.kind === "tendency") {
      weather.append(h("p", {}, ctx.ui.badge("tendency")), h("p", { class: "tb-note", text: t("tripb.d.tendency_note") }), dayFacts(ctx, day));
    } else {
      weather.append(h("p", {}, ctx.ui.badge("forecast"), " ", h("span", { class: "tb-sub", text: ctx.ui.stamp(day.forecast?.fetchedAt) })), staleNote(ctx, day.forecast), dayFacts(ctx, day), hourBars(ctx, day.hours));
      const wins = day.summary?.goodWindows || [];
      weather.append(h("p", { class: "tb-sub", text: wins.length ? t("tripb.d.dry_windows", { list: wins.map((w) => `${hh(w.from)}–${hh(w.to)}`).join(", ") }) : t("tripb.d.no_windows") }));
      paintActivities(acts, dest, day);
    }
    if (day.kind === "tendency") acts.replaceChildren(h("p", { class: "tb-note", text: t("tripb.act.need_forecast") }));
  }

  function paintActivities(box, dest, day) {
    box.replaceChildren(h("h3", { text: t("tripb.act.title") }), h("p", { class: "tb-sub", text: t("tripb.act.lead") }),
      h("p", { class: "tb-sub", id: "tb-int-label", text: t("tripb.interests") }),
      interestChips(ctx, interests, (list) => { interests = list; keepPrefs({ ...loadPrefs(), interests }); fill(); }));
    const out = h("div", { class: "tb-actlists" });
    box.append(out, h("p", { class: "tb-fine", text: t("tripb.act.no_hours") }), h("p", { class: "tb-fine" }, ctx.ui.badge("forecast")));
    function fill() {
      let rec = [];
      try { rec = recommendActivities({ dest, hours: day.hours, summary: day.summary, interests, durationDays: 1, cfg: ctx.cfg }) || []; } catch (e) { console.error(e); }
      out.replaceChildren();
      if (!rec.length) { out.append(h("p", { class: "tp-state", text: t("tripb.act.none") })); return; }
      for (const kind of ["outdoor", "indoor"]) {
        const items = rec.filter((r) => r.kind === kind);
        const ul = h("ul", { class: "tb-actlist" });
        for (const r of items) {
          ul.append(h("li", { class: r.suitable ? "ok" : "no" },
            h("div", { class: "tb-actline" }, h("strong", { text: t(ACTIVITIES[r.id]?.key || `trip.act.${r.id}`) }),
              h("span", { class: `tb-pill ${r.suitable ? "ok" : "no"}`, text: t(r.suitable ? "tripb.act.suitable" : "tripb.act.not_suitable") })),
            h("span", { class: "tb-sub", text: reasonText(t, r.reason) }),
            r.bestWindow ? h("span", { class: "tb-sub", text: t("tripb.act.best_window", { from: hh(r.bestWindow.from), to: hh(r.bestWindow.to) }) }) : null,
            r.suitable ? h("button", { type: "button", class: "tb-link", text: t("tripb.act.add"), onclick: () => addToTrip(ctx, dest, { date, activity: r.id }) }) : null));
        }
        out.append(h("div", { class: "tb-actcol" }, h("h4", { text: t(`tripb.act.${kind}`) }), items.length ? ul : h("p", { class: "tb-sub", text: t("tripb.act.none_kind") })));
      }
    }
    fill();
  }

  search.addEventListener("input", () => { filters.q = search.value; paintList(); });
  kindSel.addEventListener("change", () => { filters.kind = kindSel.value; paintList(); });
  regSel.addEventListener("change", () => { filters.region = regSel.value; paintList(); });
  paintList();
  if (selectedId) paintDetail();
}
