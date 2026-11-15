// "My trips" screen (#/plan/trips[/<tripId>]): list, create, rename and delete trips, build an itinerary day by day,
// see the real forecast next to every item, and let the weather checker PROPOSE changes that the person accepts or rejects one by one.
//
// Rules this screen follows:
//  * The itinerary is saved after a manual edit (the person typed it), but changes proposed by the weather checker are saved ONLY
//    after the person has looked at every change in the review dialog and pressed "Save".
//  * A "confirmed booking" (locked) item is never changed: it only gets a warning.
//  * Days beyond the forecast horizon show "no forecast yet"; nothing is proposed from tendencies as if they were forecasts.
//  * Forecast data is Open-Meteo (NOT NASA) and always carries its badge and update time.
// Text is only read with t(); the weather logic returns text keys + params.
import { t } from "../../i18n.js";
import * as ui from "../ui.js";
import { loadForecasts, hoursOf, dayKind } from "../forecast.js";
import { classifyHour, INTENSITY } from "../intensity.js";
import { ACTIVITIES } from "../activities.js";
import { proposeReschedule, applyProposals } from "../itinerary.js";
import * as store from "../store.js";

const { h } = ui;
const SLOTS = ["morning", "afternoon", "evening"];
const MAX_DAYS = 21;                                            // a trip longer than this is not planned slot by slot
// Clock times used only for the calendar file (draft; the planner has no opening hours)
const SLOT_TIMES = { morning: [8, 12], afternoon: [13, 17], evening: [18, 21] };
const pad = (n) => String(n).padStart(2, "0");

// ---------- small helpers ----------
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
function daysBetween(a, b) {
  const out = [];
  if (!isIso(a) || !isIso(b) || b < a) return out;
  for (let d = a; d <= b && out.length < MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}
const newItemId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const actKey = (id) => ACTIVITIES[id]?.key || `trip.act.${id}`;
const actName = (id) => (id ? t(actKey(id)) : "–");
const slotName = (s) => t(`trip.period.${s}`);
const dayLabel = (d) => ui.fmtDate(d, { weekday: "short", day: "numeric", month: "short" });
const say = (obj) => (obj && obj.key ? t(obj.key, obj.params || {}) : "");
async function call(x) { return x; }                            // store may be sync or async: await the result either way

// ---------- weather chip for one itinerary item ----------
// Reads the hours of the slot from the real forecast. Returns { kind: "ok"|"later"|"none", cls, mm, chance, gust }.
function chipData(item, forecasts, cfg) {
  const fc = forecasts?.get(item.destId);
  if (!fc || !fc.ok) return { kind: "none" };
  if (dayKind(item.day, undefined, cfg) !== "forecast") return { kind: "later" };
  const range = cfg.day_periods?.[item.slot] || [0, 23];
  const rows = (hoursOf(fc, item.day) || []).filter((r) => r && r.h >= range[0] && r.h <= range[1]);
  const mms = rows.map((r) => r.mm).filter((x) => typeof x === "number");
  if (!mms.length) return { kind: "later" };
  const max = (k) => { const v = rows.map((r) => r[k]).filter((x) => typeof x === "number"); return v.length ? Math.max(...v) : null; };
  return { kind: "ok", cls: classifyHour(Math.max(...mms), cfg), mm: mms.reduce((a, b) => a + b, 0), chance: max("chance"), gust: max("gust") };
}

function chipEl(c, cfg) {
  if (c.kind === "none") return h("span", { class: "tpc-chip none", text: t("tripc.chip.unavailable") });
  if (c.kind === "later") return h("span", { class: "tpc-chip none", text: t("tripc.chip.noforecast") });
  const parts = [t(INTENSITY[c.cls]?.key || `trip.int.${c.cls}`), ui.fmtMm(c.mm)];
  if (c.chance !== null) parts.push(t("tripc.chip.chance", { value: Math.round(c.chance) }));
  if (c.gust !== null) parts.push(t("tripc.chip.wind", { value: Math.round(c.gust) }));
  const windy = c.gust !== null && c.gust >= (cfg.comfort?.windy_kmh ?? 40);
  return h("span", { class: `tpc-chip c-${c.cls}${windy ? " windy" : ""}`, "data-cls": c.cls, text: parts.join(" · ") });
}

// ---------- calendar file (.ics) ----------
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function icsFor(trip, byId) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Monsoon Compass//Trip planner//EN", "CALSCALE:GREGORIAN"];
  const stampNow = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  for (const it of trip.items || []) {
    const [a, b] = SLOT_TIMES[it.slot] || SLOT_TIMES.morning;
    const dest = byId.get(it.destId);
    const day = it.day.replaceAll("-", "");
    lines.push("BEGIN:VEVENT", `UID:${it.id}@monsoon-compass`, `DTSTAMP:${stampNow}`,
      `DTSTART:${day}T${pad(a)}0000`, `DTEND:${day}T${pad(b)}0000`,
      `SUMMARY:${esc(`${actName(it.activity)}${it.locked ? ` (${t("tripc.locked_short")})` : ""}`)}`,
      `LOCATION:${esc(dest ? ui.destName(dest) : "")}`,
      `DESCRIPTION:${esc([trip.name, it.note].filter(Boolean).join(" - "))}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- entry ----------
export async function renderTrips(ctx, parts, view) {
  ui.ensureCss("trip-c");
  const id = parts[0] ? decodeURIComponent(parts[0]) : "";
  if (!id) return renderList(ctx, view);
  return renderDetail(ctx, id, view);
}

// ---------- list of trips ----------
async function renderList(ctx, view) {
  const trips = (await call(store.listTrips())) || [];
  const start = todayIso();
  const nameIn = h("input", { id: "tpc-new-name", type: "text", maxlength: "60", required: true, autocomplete: "off" });
  const fromIn = h("input", { id: "tpc-new-from", type: "date", value: start, required: true });
  const toIn = h("input", { id: "tpc-new-to", type: "date", value: addDays(start, 2), required: true });
  const err = h("p", { class: "tpc-error", role: "alert" });
  const form = h("form", { class: "tp-card tpc-form", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { err.textContent = t("tripc.err.name"); nameIn.focus(); return; }
    if (!isIso(fromIn.value) || !isIso(toIn.value) || toIn.value < fromIn.value) { err.textContent = t("tripc.err.dates"); toIn.focus(); return; }
    const trip = { id: await call(store.newTripId()), name, startDate: fromIn.value, endDate: toIn.value, items: [], createdAt: new Date().toISOString() };
    await call(store.saveTrip(trip));
    ctx.go(`#/plan/trips/${encodeURIComponent(trip.id)}`);
  } },
    h("h2", { text: t("tripc.new.title") }),
    h("div", { class: "tpc-row" },
      h("label", { class: "tp-field", for: "tpc-new-name" }, t("tripc.field.name"), nameIn),
      h("label", { class: "tp-field", for: "tpc-new-from" }, t("tripc.field.from"), fromIn),
      h("label", { class: "tp-field", for: "tpc-new-to" }, t("tripc.field.to"), toIn)),
    err,
    h("button", { type: "submit", class: "tp-btn primary", text: t("tripc.new.create") }));

  const list = h("div", { class: "tp-grid" });
  for (const trip of trips) {
    const n = (trip.items || []).length;
    list.append(h("article", { class: "tp-card tpc-trip" },
      h("h3", {}, h("a", { href: `#/plan/trips/${encodeURIComponent(trip.id)}`, text: trip.name })),
      h("p", { class: "tpc-muted", text: trip.startDate && trip.endDate ? `${ui.fmtDate(trip.startDate)} – ${ui.fmtDate(trip.endDate)}` : t("tripc.nodates") }),
      h("p", { class: "tpc-muted", text: t("tripc.items_count", { n }) }),
      h("div", { class: "tpc-actions" },
        h("a", { class: "tp-btn primary tpc-linkbtn", href: `#/plan/trips/${encodeURIComponent(trip.id)}`, text: t("tripc.open") }),
        h("a", { class: "tp-btn tpc-linkbtn", href: `#/plan/packing/${encodeURIComponent(trip.id)}`, text: t("tripc.packing") }),
        h("button", { type: "button", class: "tp-btn", text: t("tripc.rename"), onclick: () => renameDialog(trip, () => renderList(ctx, view)) }),
        h("button", { type: "button", class: "tp-btn tpc-danger", text: t("tripc.delete"), onclick: () => deleteDialog(trip, ctx, () => renderList(ctx, view)) }))));
  }
  view.replaceChildren(
    h("h1", { text: t("tripc.title") }),
    h("p", { class: "tpc-muted", text: t("tripc.intro") }),
    form,
    trips.length ? list : h("p", { class: "tp-state", text: t("tripc.empty") }),
    h("p", { class: "tpc-muted", text: t("trip.disclaimer") }));
}

function renameDialog(trip, done) {
  const input = h("input", { type: "text", maxlength: "60", value: trip.name, "aria-label": t("tripc.field.name") });
  ui.modal({ title: t("tripc.rename"), body: h("label", { class: "tp-field" }, t("tripc.field.name"), input), actions: [
    { label: t("tripc.cancel") },
    { label: t("tripc.save"), primary: true, onclick: async () => {
      const name = input.value.trim();
      if (!name) return;
      await call(store.saveTrip({ ...trip, name }));
      done();
    } }] });
  input.focus(); input.select();
}
function deleteDialog(trip, ctx, done) {
  ui.modal({ title: t("tripc.delete_title"), body: t("tripc.delete_body", { name: trip.name }), actions: [
    { label: t("tripc.cancel") },
    { label: t("tripc.delete"), primary: true, onclick: async () => { await call(store.deleteTrip(trip.id)); ui.toast("tripc.deleted", "ok"); done(); } }] });
}

// ---------- one trip ----------
async function renderDetail(ctx, tripId, view) {
  const cfg = ctx.cfg;
  const byId = ctx.data.byId;
  let trip = await call(store.getTrip(tripId));
  if (!trip) {
    view.replaceChildren(h("p", { class: "tp-state", text: t("tripc.notfound") }), h("a", { class: "tp-btn", href: "#/plan/trips", text: t("tripc.back") }));
    return;
  }
  trip = { items: [], ...trip };
  let forecasts = new Map();
  let fcState = { loading: true, ok: false, fetchedAt: null, stale: false, error: null };
  let proposals = null;                                          // null = the checker has not run; otherwise { list, locked, choices:Map, horizonNote }
  const root = h("div", { class: "tpc-detail" });
  view.replaceChildren(root);

  const destIds = () => [...new Set(trip.items.map((i) => i.destId))].filter((x) => byId.has(x));
  const save = async (next) => { trip = next; await call(store.saveTrip(trip)); };

  async function loadWeather(force) {
    fcState = { ...fcState, loading: true };
    draw();
    const dests = destIds().map((x) => byId.get(x));
    forecasts = dests.length ? await loadForecasts(dests, { force }) : new Map();
    const all = [...forecasts.values()];
    const okOnes = all.filter((f) => f && f.ok);
    const stamps = okOnes.map((f) => f.fetchedAt).filter(Boolean).sort();
    fcState = { loading: false, ok: okOnes.length > 0 || !dests.length, none: !dests.length, failed: dests.length > 0 && !okOnes.length,
      stale: okOnes.some((f) => f.stale), fetchedAt: stamps[0] || null, error: all.find((f) => f && !f.ok)?.error || null };
    draw();
  }

  // ----- header: name, dates, toolbar -----
  function header() {
    const from = h("input", { id: "tpc-from", type: "date", value: trip.startDate || "" });
    const to = h("input", { id: "tpc-to", type: "date", value: trip.endDate || "" });
    const err = h("p", { class: "tpc-error", role: "alert" });
    const apply = async () => {
      if (!isIso(from.value) || !isIso(to.value) || to.value < from.value) { err.textContent = t("tripc.err.dates"); return; }
      err.textContent = "";
      await save({ ...trip, startDate: from.value, endDate: to.value });
      draw();
    };
    from.addEventListener("change", apply); to.addEventListener("change", apply);
    return h("section", { class: "tp-card tpc-head" },
      h("a", { class: "tpc-back", href: "#/plan/trips", text: `‹ ${t("tripc.back")}` }),
      h("div", { class: "tpc-titlerow" },
        h("h1", { text: trip.name }),
        h("button", { type: "button", class: "tp-btn tpc-noprint", text: t("tripc.rename"), onclick: () => renameDialog(trip, async () => { trip = await call(store.getTrip(tripId)); draw(); }) })),
      h("div", { class: "tpc-row tpc-noprint" },
        h("label", { class: "tp-field", for: "tpc-from" }, t("tripc.field.from"), from),
        h("label", { class: "tp-field", for: "tpc-to" }, t("tripc.field.to"), to)),
      h("p", { class: "tpc-print-only", text: `${trip.startDate ? ui.fmtDate(trip.startDate) : ""} – ${trip.endDate ? ui.fmtDate(trip.endDate) : ""}` }),
      err,
      h("div", { class: "tpc-actions tpc-noprint" },
        h("button", { type: "button", class: "tp-btn primary", id: "tpc-check", text: t("tripc.check"), disabled: !trip.items.length || fcState.loading, onclick: () => runCheck() }),
        h("a", { class: "tp-btn tpc-linkbtn", href: `#/plan/packing/${encodeURIComponent(trip.id)}`, text: t("tripc.packing") }),
        h("button", { type: "button", class: "tp-btn", text: t("tripc.ics"), disabled: !trip.items.length, onclick: () => download(`${(trip.name || "trip").replace(/[^\w-]+/g, "_")}.ics`, icsFor(trip, byId), "text/calendar") }),
        h("button", { type: "button", class: "tp-btn", text: t("tripc.print"), onclick: () => window.print() }),
        h("button", { type: "button", class: "tp-btn tpc-danger", text: t("tripc.delete"), onclick: () => deleteDialog(trip, ctx, () => ctx.go("#/plan/trips")) })));
  }

  // ----- forecast status line -----
  function status() {
    if (fcState.loading) return h("p", { class: "tpc-status", role: "status", text: t("trip.state.loading") });
    if (fcState.none) return h("p", { class: "tpc-status", text: t("tripc.status.noitems") });
    if (fcState.failed) return h("div", { class: "tpc-status warn", role: "alert" }, h("p", { text: t("tripc.status.failed") }),
      h("button", { type: "button", class: "tp-btn", text: t("trip.state.retry"), onclick: () => loadWeather(true) }));
    return h("p", { class: `tpc-status${fcState.stale ? " warn" : ""}` }, ui.badge("forecast"), " ",
      fcState.stale ? t("trip.stale", { time: fcState.fetchedAt ? ui.stamp(fcState.fetchedAt, "tripc.time_only") : t("trip.updated_unknown") }) : ui.stamp(fcState.fetchedAt),
      " ", h("button", { type: "button", class: "tpc-link tpc-noprint", text: t("tripc.refresh"), onclick: () => loadWeather(true) }),
      h("span", { class: "tpc-muted", text: ` ${t("tripc.status.horizon", { days: cfg.forecast_horizon_days })}` }));
  }

  // ----- add an activity -----
  function addForm() {
    const days = daysBetween(trip.startDate, trip.endDate);
    const dayOf = h("select", { id: "tpc-add-day" }, days.map((d) => h("option", { value: d, text: dayLabel(d) })));
    const slotOf = h("select", { id: "tpc-add-slot" }, SLOTS.map((s) => h("option", { value: s, text: slotName(s) })));
    const destOf = h("select", { id: "tpc-add-dest" }, ctx.data.destinations.map((d) => h("option", { value: d.id, text: ui.destName(d) })));
    const actOf = h("select", { id: "tpc-add-act" });
    const fillActs = () => {
      const dest = byId.get(destOf.value);
      const ids = (dest?.activities || []).filter((a) => ACTIVITIES[a]);
      actOf.replaceChildren(...ids.map((a) => h("option", { value: a, text: `${actName(a)} (${t(`tripc.kind.${ACTIVITIES[a].kind}`)})` })));
    };
    destOf.addEventListener("change", fillActs); fillActs();
    const note = h("input", { id: "tpc-add-note", type: "text", maxlength: "80" });
    const locked = h("input", { id: "tpc-add-locked", type: "checkbox" });
    const err = h("p", { class: "tpc-error", role: "alert" });
    if (!ctx.data.destinations.length) return h("section", { class: "tp-card" }, h("p", { class: "tp-state", text: t("tripc.nodestinations") }));
    return h("form", { class: "tp-card tpc-form tpc-noprint", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!days.length) { err.textContent = t("tripc.err.dates"); return; }
      if (!actOf.value) { err.textContent = t("tripc.err.activity"); return; }
      const item = { id: newItemId(), day: dayOf.value, slot: slotOf.value, destId: destOf.value, activity: actOf.value,
        kind: ACTIVITIES[actOf.value]?.kind || "outdoor", locked: locked.checked, note: note.value.trim() };
      await save({ ...trip, items: [...trip.items, item] });
      proposals = null;
      ui.toast("tripc.added", "ok");
      loadWeather(false);
    } },
      h("h2", { text: t("tripc.add.title") }),
      h("div", { class: "tpc-row" },
        h("label", { class: "tp-field", for: "tpc-add-day" }, t("tripc.field.day"), dayOf),
        h("label", { class: "tp-field", for: "tpc-add-slot" }, t("tripc.field.slot"), slotOf),
        h("label", { class: "tp-field", for: "tpc-add-dest" }, t("tripc.field.dest"), destOf),
        h("label", { class: "tp-field", for: "tpc-add-act" }, t("tripc.field.activity"), actOf)),
      h("label", { class: "tp-field", for: "tpc-add-note" }, t("tripc.field.note"), note),
      h("label", { class: "tpc-check", for: "tpc-add-locked" }, locked, h("span", { text: t("tripc.confirmed") })),
      err,
      h("button", { type: "submit", class: "tp-btn primary", text: t("tripc.add.button") }));
  }

  // ----- the days -----
  function daysView() {
    const set = new Set(daysBetween(trip.startDate, trip.endDate));
    trip.items.forEach((i) => set.add(i.day));
    const days = [...set].sort();
    if (!days.length) return h("p", { class: "tp-state", text: t("tripc.err.dates") });
    const box = h("div", { class: "tpc-days" });
    for (const d of days) {
      const outside = trip.startDate && (d < trip.startDate || d > trip.endDate);
      const kind = dayKind(d, undefined, cfg);
      const card = h("section", { class: "tp-card tpc-day" },
        h("h3", {}, dayLabel(d), " ", h("span", { class: "tpc-muted tpc-small", text: outside ? t("tripc.outside") : kind === "forecast" ? t("tripc.day.forecast") : t("tripc.day.noforecast") })));
      for (const s of SLOTS) {
        const items = trip.items.filter((i) => i.day === d && i.slot === s);
        const slot = h("div", { class: "tpc-slot" }, h("h4", { text: slotName(s) }));
        if (!items.length) slot.append(h("p", { class: "tpc-muted tpc-small", text: t("tripc.slot.empty") }));
        for (const it of items) slot.append(itemRow(it));
        card.append(slot);
      }
      box.append(card);
    }
    return box;
  }

  function itemRow(it) {
    const dest = byId.get(it.destId);
    const lockId = `tpc-lock-${it.id}`;
    return h("div", { class: `tpc-item${it.locked ? " locked" : ""}` },
      h("div", { class: "tpc-item-main" },
        h("strong", { text: actName(it.activity) }),
        h("span", { class: "tpc-muted", text: ` · ${dest ? ui.destName(dest) : it.destId}` }),
        it.locked ? h("span", { class: "tpc-lock", text: ` ${t("tripc.locked_short")}` }) : null),
      it.note ? h("p", { class: "tpc-muted tpc-small", text: it.note }) : null,
      chipEl(chipData(it, forecasts, cfg), cfg),
      h("div", { class: "tpc-item-tools tpc-noprint" },
        h("label", { class: "tpc-check", for: lockId }, h("input", { id: lockId, type: "checkbox", checked: it.locked ? true : null, onchange: async (e) => {
          await save({ ...trip, items: trip.items.map((x) => (x.id === it.id ? { ...x, locked: e.target.checked } : x)) });
          proposals = null; draw();
        } }), h("span", { text: t("tripc.confirmed") })),
        h("button", { type: "button", class: "tp-btn tpc-small-btn", "aria-label": t("tripc.remove_item", { name: actName(it.activity) }), text: t("tripc.remove"), onclick: async () => {
          await save({ ...trip, items: trip.items.filter((x) => x.id !== it.id) });
          proposals = null; draw();
        } })));
  }

  // ----- weather check and proposals -----
  async function runCheck() {
    await loadWeather(true);
    if (fcState.failed) { ui.toast("tripc.status.failed", "error"); return; }
    const res = await call(proposeReschedule({ itinerary: trip, forecasts, cfg, destinations: ctx.data.destinations }));
    const itemOf = new Map(trip.items.map((i) => [i.id, i]));
    const list = [], locked = [];
    for (const p of res?.proposals || []) {
      const item = itemOf.get(p.itemId);
      if (!item) continue;
      if (dayKind(item.day, undefined, cfg) !== "forecast") continue;       // never propose from a tendency
      if (item.locked || p.locked) { locked.push(p); continue; }                        // confirmed bookings only get a warning
      list.push({ ...p, item, options: (p.options || []).filter((o) => o) });
    }
    const beyond = trip.items.filter((i) => dayKind(i.day, undefined, cfg) !== "forecast").length;
    proposals = { list, locked, itemOf, choices: new Map(), beyond, unaffected: (res?.unaffected || []).length };
    draw();
    document.getElementById("tpc-review")?.scrollIntoView({ block: "start" });
  }

  function optionLabel(o) {
    if (o.type === "move") {
      const dest = o.toDest && byId.get(o.toDest);
      return t("tripc.opt.move", { day: o.toDay ? dayLabel(o.toDay) : "", slot: o.toSlot ? slotName(o.toSlot) : "" }) + (dest ? ` (${ui.destName(dest)})` : "");
    }
    if (o.type === "replace") {
      const dest = o.toDest && byId.get(o.toDest);
      return t("tripc.opt.replace", { activity: actName(o.toActivity), dest: dest ? ui.destName(dest) : "" });
    }
    return t("tripc.opt.keep");
  }

  function reviewPanel() {
    if (!proposals) return null;
    const P = proposals;
    const panel = h("section", { class: "tp-card tpc-review tpc-noprint", id: "tpc-review", "aria-live": "polite" }, h("h2", { text: t("tripc.review.title") }));
    if (P.beyond) panel.append(h("p", { class: "tpc-note", text: t("tripc.review.beyond", { n: P.beyond }) }));
    if (!P.list.length && !P.locked.length) panel.append(h("p", { class: "tpc-ok", text: t("tripc.review.none") }));
    for (const p of P.locked) {
      panel.append(h("div", { class: "tpc-warnbox", role: "alert" },
        h("strong", { text: `${actName(p.item?.activity || P.itemOf.get(p.itemId)?.activity)} (${t("tripc.locked_short")})` }),
        h("p", { class: "tpc-small", text: t("tripc.review.locked_warn", { day: dayLabel(P.itemOf.get(p.itemId).day), slot: slotName(P.itemOf.get(p.itemId).slot) }) })));
    }
    P.list.forEach((p, n) => {
      const name = `tpc-prop-${n}`;
      const fieldset = h("fieldset", { class: "tpc-prop" },
        h("legend", { text: `${actName(p.item.activity)} · ${dayLabel(p.item.day)}, ${slotName(p.item.slot)}` }),
        h("p", { class: "tpc-problem", text: say(p.problem) }));
      const radio = (value, label, reason, checked) => {
        const id = `${name}-${value}`;
        return h("div", { class: "tpc-opt" }, h("label", { for: id, class: "tpc-check" },
          h("input", { id, type: "radio", name, value, checked: checked ? true : null, onchange: () => { P.choices.set(p.itemId, value === "reject" ? null : p.options[Number(value)]); refreshCount(); } }),
          h("span", {}, h("strong", { text: label }), reason ? h("span", { class: "tpc-muted tpc-small", text: ` — ${reason}` }) : null)));
      };
      p.options.filter((o) => o.type !== "keep").forEach((o, i) => {
        const idx = p.options.indexOf(o);
        fieldset.append(radio(String(idx), optionLabel(o), say(o.reason), false));
      });
      fieldset.append(radio("reject", t("tripc.opt.keep"), t("tripc.opt.keep_reason"), true));
      if (!p.options.some((o) => o.type !== "keep")) fieldset.append(h("p", { class: "tpc-muted tpc-small", text: t("tripc.opt.none") }));
      panel.append(fieldset);
    });
    const count = h("span", { id: "tpc-count" });
    const reviewBtn = h("button", { type: "button", class: "tp-btn primary", id: "tpc-reviewbtn", onclick: () => openReview() });
    function refreshCount() {
      const n = [...P.choices.values()].filter(Boolean).length;
      reviewBtn.textContent = t("tripc.review.button", { n });
      reviewBtn.disabled = n === 0;
    }
    refreshCount();
    if (P.list.length) {
      panel.append(h("div", { class: "tpc-actions" }, reviewBtn, count,
        h("button", { type: "button", class: "tp-btn", text: t("tripc.review.rejectall"), onclick: () => { proposals = null; draw(); ui.toast("tripc.review.rejected", "info"); } })));
    } else {
      panel.append(h("div", { class: "tpc-actions" }, h("button", { type: "button", class: "tp-btn", text: t("tripc.review.close"), onclick: () => { proposals = null; draw(); } })));
    }
    return panel;
  }

  function openReview() {
    const P = proposals;
    const accepted = [...P.choices.entries()].filter(([id, o]) => o && !P.itemOf.get(id)?.locked).map(([itemId, option]) => ({ itemId, option }));
    if (!accepted.length) return;
    const body = h("div", { class: "tpc-changes" }, h("p", { text: t("tripc.confirm.intro", { n: accepted.length }) }));
    const ul = h("ul");
    for (const a of accepted) {
      const it = P.itemOf.get(a.itemId);
      ul.append(h("li", {}, h("strong", { text: `${actName(it.activity)} · ${dayLabel(it.day)}, ${slotName(it.slot)}` }), h("br"),
        `→ ${optionLabel(a.option)}`, a.option.reason ? h("span", { class: "tpc-muted tpc-small", text: ` — ${say(a.option.reason)}` }) : null));
    }
    body.append(ul, h("p", { class: "tpc-small tpc-muted", text: t("tripc.confirm.note") }));
    ui.modal({ title: t("tripc.confirm.title"), body, actions: [
      { label: t("tripc.cancel") },
      { label: t("tripc.confirm.save"), primary: true, onclick: async () => {
        const next = await call(applyProposals(trip, accepted));
        // keep the trip's own fields (name, dates) and never touch locked items
        const lockedBefore = new Map(trip.items.filter((i) => i.locked).map((i) => [i.id, i]));
        const items = (next.items || []).map((i) => lockedBefore.get(i.id) || i);
        await save({ ...trip, items });
        proposals = null;
        ui.toast("tripc.confirm.saved", "ok");
        loadWeather(false);
      } }] });
  }

  function draw() {
    root.replaceChildren(
      header(),
      h("section", { class: "tp-card tpc-statuscard" }, status()),
      addForm(),
      reviewPanel(),
      daysView(),
      h("p", { class: "tpc-muted tpc-small", text: t("trip.disclaimer") }));
  }

  draw();
  if (trip.items.length) loadWeather(false); else { fcState = { loading: false, none: true, ok: true }; draw(); }
}
