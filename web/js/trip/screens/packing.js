// Packing assistant (#/plan/packing[/<tripId>] or #/plan/packing/quick/<destId>/<start>/<end>).
// Builds a checklist from the real forecast of the trip's place and the planned activities (rules in ../packing.js), grouped by
// category, with the reason for every automatic item. The visitor ticks items, adds or removes their own, and can rebuild the
// list from the latest weather: ticks, manual items and removed items are kept because they live in the saved object, not in the list.
// Weather = Open-Meteo forecast (NOT NASA). With no forecast for the dates, only weather-independent items are suggested and the page says so.
import { t } from "../../i18n.js";
import * as ui from "../ui.js";
import { loadForecast, hoursOf, dayKind, todayColombo } from "../forecast.js";
import { summariseDay } from "../intensity.js";
import { buildPacking, togglePackingItem, addPackingItem, removePackingItem, restorePackingItems, PACKING_CATEGORIES } from "../packing.js";
import * as store from "../store.js";

const { h } = ui;
const MAX_DAYS = 14;
const pad = (n) => String(n).padStart(2, "0");
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) {
  const out = [];
  if (!isIso(a) || !isIso(b) || b < a) return out;
  for (let d = a; d <= b && out.length < MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

// One summary for the whole trip: the wettest forecast day, with the extremes of temperature and wind over all forecast days.
// Returns { summary|null, forecastDays, totalDays }.
function tripSummary(forecast, days, cfg) {
  const sums = [];
  if (forecast?.ok) {
    for (const d of days) {
      if (dayKind(d, undefined, cfg) !== "forecast") continue;
      const s = summariseDay(hoursOf(forecast, d), cfg);
      if (s?.hasData) sums.push(s);
    }
  }
  if (!sums.length) return { summary: null, forecastDays: 0, totalDays: days.length };
  const wettest = sums.reduce((a, b) => ((b.totalMm ?? 0) > (a.totalMm ?? 0) ? b : a));
  const nums = (k) => sums.map((s) => s[k]).filter((x) => typeof x === "number");
  const maxOf = (k) => (nums(k).length ? Math.max(...nums(k)) : null);
  const minOf = (k) => (nums(k).length ? Math.min(...nums(k)) : null);
  return { summary: { ...wettest, maxTemp: maxOf("maxTemp"), minTemp: minOf("minTemp"), maxGust: maxOf("maxGust"), avgWind: maxOf("avgWind") }, forecastDays: sums.length, totalDays: days.length };
}

export async function renderPacking(ctx, parts, view) {
  ui.ensureCss("trip-c");
  const { byId, destinations } = ctx.data;
  const first = parts[0] ? decodeURIComponent(parts[0]) : "";
  let scope = null;                                              // { packId, name, dest, start, end, activities, tripId }

  if (first === "quick") {
    const [, destId, start, end] = parts.map((x) => (x ? decodeURIComponent(x) : ""));
    const dest = byId.get(destId);
    if (!dest || !isIso(start) || !isIso(end) || end < start) return renderChooser(ctx, view, "tripc.err.quick");
    scope = { packId: `quick-${destId}-${start}-${end}`, name: ui.destName(dest), dest, start, end, activities: dest.activities || [], tripId: null };
  } else if (first) {
    const trip = store.getTrip(first);
    if (!trip) return renderChooser(ctx, view, "tripc.notfound");
    const items = trip.items || [];
    const counts = new Map();
    items.forEach((i) => counts.set(i.destId, (counts.get(i.destId) || 0) + 1));
    const destId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const dest = byId.get(destId);
    const days = [...items.map((i) => i.day)].sort();
    scope = { packId: trip.id, name: trip.name, dest, start: trip.startDate || days[0], end: trip.endDate || days[days.length - 1],
      activities: [...new Set(items.map((i) => i.activity))], tripId: trip.id, multi: counts.size > 1 };
    if (!dest) return renderNeedsItems(ctx, view, trip);
    if (!isIso(scope.start) || !isIso(scope.end)) return renderNeedsItems(ctx, view, trip);
  } else {
    return renderChooser(ctx, view);
  }
  return renderList(ctx, view, scope);
}

// ---------- choose a trip or a quick destination ----------
function renderChooser(ctx, view, errKey) {
  const trips = store.listTrips();
  const dests = ctx.data.destinations;
  const today = todayColombo();
  const destOf = h("select", { id: "tpc-q-dest" }, dests.map((d) => h("option", { value: d.id, text: ui.destName(d) })));
  const from = h("input", { id: "tpc-q-from", type: "date", value: today });
  const to = h("input", { id: "tpc-q-to", type: "date", value: addDays(today, 2) });
  const err = h("p", { class: "tpc-error", role: "alert", text: errKey ? t(errKey) : "" });
  const quick = dests.length ? h("form", { class: "tp-card tpc-form", novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (!isIso(from.value) || !isIso(to.value) || to.value < from.value) { err.textContent = t("tripc.err.dates"); return; }
    ctx.go(`#/plan/packing/quick/${encodeURIComponent(destOf.value)}/${from.value}/${to.value}`);
  } },
    h("h2", { text: t("tripc.pack.quick") }),
    h("div", { class: "tpc-row" },
      h("label", { class: "tp-field", for: "tpc-q-dest" }, t("tripc.field.dest"), destOf),
      h("label", { class: "tp-field", for: "tpc-q-from" }, t("tripc.field.from"), from),
      h("label", { class: "tp-field", for: "tpc-q-to" }, t("tripc.field.to"), to)),
    err,
    h("button", { type: "submit", class: "tp-btn primary", text: t("tripc.pack.make") })) : h("p", { class: "tp-state", text: t("tripc.nodestinations") });
  const list = trips.length ? h("div", { class: "tp-grid" }, trips.map((trip) => h("article", { class: "tp-card tpc-trip" },
    h("h3", {}, h("a", { href: `#/plan/packing/${encodeURIComponent(trip.id)}`, text: trip.name })),
    h("p", { class: "tpc-muted", text: trip.startDate ? `${ui.fmtDate(trip.startDate)} – ${ui.fmtDate(trip.endDate)}` : t("tripc.nodates") }),
    h("a", { class: "tp-btn primary tpc-linkbtn", href: `#/plan/packing/${encodeURIComponent(trip.id)}`, text: t("tripc.pack.open") })))) : h("p", { class: "tp-state", text: t("tripc.pack.notrips") });
  view.replaceChildren(h("h1", { text: t("tripc.pack.title") }), h("p", { class: "tpc-muted", text: t("tripc.pack.intro") }),
    h("h2", { text: t("tripc.pack.fromtrip") }), list, quick);
}

function renderNeedsItems(ctx, view, trip) {
  view.replaceChildren(h("h1", { text: t("tripc.pack.title") }), h("p", { class: "tp-state", text: t("tripc.pack.needsitems", { name: trip.name }) }),
    h("a", { class: "tp-btn primary tpc-linkbtn", href: `#/plan/trips/${encodeURIComponent(trip.id)}`, text: t("tripc.open") }));
}

// ---------- the checklist ----------
async function renderList(ctx, view, scope) {
  const cfg = ctx.cfg;
  const days = daysBetween(scope.start, scope.end);
  const root = h("div", { class: "tpc-detail" });
  view.replaceChildren(root);
  let saved = store.getPacking(scope.packId) || {};
  let fc = null;
  let busy = true;
  let wx = { summary: null, forecastDays: 0, totalDays: days.length };

  const persist = (next, meta) => {
    saved = { ...next, ...(meta || { updatedAt: saved.updatedAt }) };
    store.savePacking(scope.packId, saved);
  };

  async function refresh(force) {
    busy = true; draw();
    fc = await loadForecast(scope.dest, { force });
    wx = tripSummary(fc, days, cfg);
    if (force) persist(saved, { updatedAt: new Date().toISOString() });
    busy = false; draw();
    if (force) ui.toast(fc?.ok && !fc.stale ? "tripc.pack.updated" : "tripc.pack.updated_old", fc?.ok && !fc.stale ? "ok" : "warn");
  }

  function build() {
    return buildPacking({ dest: scope.dest, summary: wx.summary, activities: scope.activities, durationDays: days.length || 1, saved, cfg });
  }

  function status() {
    if (busy) return h("p", { class: "tpc-status", role: "status", text: t("trip.state.loading") });
    const bits = [];
    if (!fc?.ok) bits.push(h("span", { class: "tpc-status warn", role: "alert", text: t("tripc.pack.noforecast_error") }));
    else {
      bits.push(ui.badge("forecast"), " ", fc.stale ? t("trip.stale", { time: ui.stamp(fc.fetchedAt, "tripc.time_only") }) : ui.stamp(fc.fetchedAt));
      if (!wx.forecastDays) bits.push(h("p", { class: "tpc-note", text: t("tripc.pack.noforecast_days", { days: cfg.forecast_horizon_days }) }));
      else if (wx.forecastDays < wx.totalDays) bits.push(h("p", { class: "tpc-note", text: t("tripc.pack.partial", { n: wx.forecastDays, total: wx.totalDays }) }));
    }
    return h("div", { class: "tpc-status" }, bits);
  }

  function draw() {
    const list = build();
    const all = list.categories.flatMap((c) => c.items);
    const done = all.filter((i) => i.checked).length;
    const pct = all.length ? Math.round((100 * done) / all.length) : 0;
    const removedCount = (saved.removed || []).length;

    root.replaceChildren(
      h("section", { class: "tp-card tpc-head" },
        h("a", { class: "tpc-back tpc-noprint", href: scope.tripId ? `#/plan/trips/${encodeURIComponent(scope.tripId)}` : "#/plan/packing", text: `‹ ${t(scope.tripId ? "tripc.pack.back_trip" : "tripc.back")}` }),
        h("h1", { text: t("tripc.pack.for", { name: scope.name }) }),
        h("p", { class: "tpc-muted", text: `${ui.destName(scope.dest)} · ${ui.fmtDate(scope.start)} – ${ui.fmtDate(scope.end)}` }),
        scope.multi ? h("p", { class: "tpc-note", text: t("tripc.pack.multi", { name: ui.destName(scope.dest) }) }) : null,
        status(),
        h("div", { class: "tpc-actions tpc-noprint" },
          h("button", { type: "button", class: "tp-btn primary", id: "tpc-update", disabled: busy, text: t("tripc.pack.update"), onclick: () => refresh(true) }),
          removedCount ? h("button", { type: "button", class: "tp-btn", text: t("tripc.pack.restore", { n: removedCount }), onclick: () => { persist(restorePackingItems(saved)); draw(); } }) : null,
          h("button", { type: "button", class: "tp-btn", text: t("tripc.print"), onclick: () => window.print() })),
        saved.updatedAt ? h("p", { class: "tpc-muted tpc-small tpc-noprint", text: t("tripc.pack.last_update", { time: ui.stamp(saved.updatedAt, "tripc.time_only") }) }) : null,
        h("p", { class: "tpc-muted tpc-small tpc-noprint", text: t("tripc.pack.saved_note", { where: scope.tripId ? t("tripc.pack.where_trip") : t("tripc.pack.where_quick") }) })),
      h("section", { class: "tp-card tpc-progress", "aria-live": "polite" },
        h("strong", { text: t("tripc.pack.progress", { done, total: all.length }) }),
        h("div", { class: "tpc-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": t("tripc.pack.progress", { done, total: all.length }) }, h("span", { style: `width:${pct}%` }))),
      ...list.categories.map(categoryView),
      h("p", { class: "tpc-muted tpc-small", text: t("trip.disclaimer") }));
  }

  function categoryView(cat) {
    const inputId = `tpc-add-${cat.id}`;
    const set = h("fieldset", { class: "tpc-cat" }, h("legend", { text: t(cat.key) }));
    if (!cat.items.length) set.append(h("p", { class: "tpc-muted tpc-small", text: t("tripc.pack.emptycat") }));
    for (const it of cat.items) {
      const id = `tpc-p-${it.id}`;
      const label = it.auto ? t(it.key) : it.name;
      set.append(h("div", { class: `tpc-pack-item${it.checked ? " done" : ""}` },
        h("label", { class: "tpc-check", for: id },
          h("input", { id, type: "checkbox", checked: it.checked ? true : null, onchange: () => { persist(togglePackingItem(saved, it.id)); draw(); document.getElementById(id)?.focus(); } }),
          h("span", {},
            h("span", { class: "tpc-label", text: it.qty > 1 ? `${label} × ${it.qty}` : label }),
            it.auto ? null : h("span", { class: "tpc-manual", text: t("tripc.pack.manual") }),
            it.auto && it.reason ? h("span", { class: "tpc-reason", text: `${t("tripc.pack.why")} ${t(it.reason.key, it.reason.params || {})}` }) : null)),
        h("button", { type: "button", class: "tp-btn tpc-small-btn tpc-noprint", text: t("tripc.remove"), "aria-label": t("tripc.remove_item", { name: label }), onclick: () => { persist(removePackingItem(saved, it.id)); draw(); } })));
    }
    const input = h("input", { id: inputId, type: "text", maxlength: "80", "aria-label": t("tripc.pack.add_label", { cat: t(cat.key) }), placeholder: t("tripc.pack.add_ph") });
    set.append(h("form", { class: "tpc-addrow tpc-noprint", onsubmit: (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      persist(addPackingItem(saved, { category: cat.id, name: input.value }));
      draw(); document.getElementById(inputId)?.focus();
    } }, input, h("button", { type: "submit", class: "tp-btn", text: t("tripc.pack.add") })));
    return set;
  }

  draw();
  await refresh(false);
}

