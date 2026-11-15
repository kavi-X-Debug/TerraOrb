// Trip planner screen: compare the weather of 2 to 6 destinations over a date range  (#/plan/compare[/<id,id,id>/<start>/<end>]).
//
// The address holds the whole choice, so a comparison can be shared as a link. Choosing places and dates only builds the address;
// the results are drawn from the address. For every day:
//   * inside the 16-day forecast the numbers come from the Open-Meteo hourly forecast (NOT NASA data),
//   * beyond it only the NASA POWER historical tendency (1981-2025) is used and it is labelled as a tendency, never as a forecast.
// The suitability score is a planning rule of thumb (weights in Settings), not a scientific index; it is only computed from forecast days.
import { t } from "../../i18n.js";
import { h as H } from "../ui.js";
import { loadForecasts, hoursOf, dayKind } from "../forecast.js";
import { tendencyFor } from "../history.js";
import { summariseDay } from "../intensity.js";
import { destinationScore } from "../scoring.js";
import { getPrefs } from "../store.js";
import { todayISO, addDays, daysBetween, validDate, destPicker, intLabel } from "./rain.js";

const MAX_DEST = 6, MIN_DEST = 2, MAX_DAYS = 30;
const COUNTRIES = [{ id: "LK", key: "tripa.country.LK" }];                 // add more countries here when data exists
const COLORS = ["#1677C8", "#F59E0B", "#16A34A", "#C0392B", "#6B3FA0", "#0E7490"];
const RANK = { none: 0, light: 1, moderate: 2, heavy: 3, very_heavy: 4 };
const SORTS = ["lowest_rain", "lowest_chance", "best_score", "best_activity"];
let leafletMap = null;

const mean = (a) => { const v = a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const sum = (a) => { const v = a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) : null; };

// ---------------------------------------------------------------------------
// Pure: one destination over a list of dates
// ---------------------------------------------------------------------------
export function analyse({ dest, fc, history, dates, today, cfg, prefs, env }) {
  const days = [];
  for (const date of dates) {
    const kind = dayKind(date, today, cfg);
    if (kind === "forecast") {
      const rows = fc?.ok ? hoursOf(fc, date) || [] : [];
      if (!rows.some((r) => r.mm !== null && r.mm !== undefined)) { days.push({ date, kind: "missing" }); continue; }
      const s = summariseDay(rows, cfg);
      let sc = null;
      try { sc = destinationScore({ dest, summary: s, prefs, env, cfg }); } catch { sc = null; }
      days.push({ date, kind: "forecast", rows, sum: s, mm: s.totalMm, chance: s.maxChance, tmax: s.maxTemp, tmin: s.minTemp, tavg: s.avgTemp, rh: s.avgHumidity, wind: s.avgWind, cls: s.maxClass || "none", score: sc });
    } else {
      const tend = history ? tendencyFor(history, dest.cell, date) : null;
      days.push(tend ? { date, kind: "tendency", mm: tend.meanMm, chance: tend.pWet * 100, tend } : { date, kind: "missing" });
    }
  }
  const fcDays = days.filter((d) => d.kind === "forecast"), known = days.filter((d) => d.mm !== null && d.mm !== undefined);
  const scored = fcDays.filter((d) => d.score && Number.isFinite(d.score.S));
  const count = {};
  for (const d of scored) for (const r of d.score.reasons || []) { const k = r.key; count[k] = count[k] || { n: 0, r }; count[k].n++; }
  const reasons = Object.values(count).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.r);
  return {
    dest, days, nForecast: fcDays.length, nTendency: days.filter((d) => d.kind === "tendency").length, nMissing: days.filter((d) => d.kind === "missing").length,
    totalMm: sum(known.map((d) => d.mm)), avgMm: mean(known.map((d) => d.mm)), avgChance: mean(known.map((d) => d.chance)),
    tavg: mean(fcDays.map((d) => d.tavg)), tmax: fcDays.length ? Math.max(...fcDays.map((d) => d.tmax ?? -99)) : null, tmin: fcDays.length ? Math.min(...fcDays.map((d) => d.tmin ?? 99)) : null,
    rh: mean(fcDays.map((d) => d.rh)), wind: mean(fcDays.map((d) => d.wind)),
    maxClass: fcDays.length ? fcDays.reduce((a, d) => (RANK[d.cls] > RANK[a] ? d.cls : a), "none") : null,
    S: scored.length ? mean(scored.map((d) => d.score.S)) : null, A: scored.length ? mean(scored.map((d) => d.score.A)) : null, W: scored.length ? mean(scored.map((d) => d.score.W)) : null,
    reasons, fetchedAt: fc?.fetchedAt || null, stale: Boolean(fc?.stale), fcOk: Boolean(fc?.ok),
  };
}

// Sort (nulls always last). Returns a new array.
export function sortResults(list, by) {
  const key = { lowest_rain: (r) => r.avgMm, lowest_chance: (r) => r.avgChance, best_score: (r) => (r.S === null ? null : -r.S), best_activity: (r) => (r.A === null ? null : -r.A) }[by] || ((r) => r.avgMm);
  return [...list].sort((a, b) => { const x = key(a), y = key(b); if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1; return x - y; });
}

function parseAddress(parts, data) {
  const ids = [...new Set((parts[0] || "").split(",").map((s) => s.trim()).filter(Boolean))];
  const known = ids.filter((id) => data.byId.has(id));
  return { ids: known.slice(0, MAX_DEST), unknown: ids.length > known.length, tooMany: known.length > MAX_DEST, start: parts[1], end: parts[2], has: parts.length > 0 };
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------
export async function renderCompare(ctx, parts, view) {
  const { ui, data, cfg } = ctx; const h = ui.h;
  ui.ensureCss("trip-a");
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  const today = todayISO();
  const addr = parseAddress(parts, data);
  let sel = [...addr.ids];
  let start = validDate(addr.start) ? addr.start : today, end = validDate(addr.end) ? addr.end : addDays(start, 2);

  const form = h("section", { class: "tp-card ta-controls" });
  const results = h("div", { class: "ta-results", "aria-live": "polite" });
  view.replaceChildren(
    h("header", { class: "ta-head" }, h("h1", { text: t("tripa.cmp.title") }), h("p", { class: "ta-sub", text: t("tripa.cmp.sub") })), form, results);

  const msg = h("p", { class: "ta-formmsg", role: "alert" });
  const chosen = h("ul", { class: "ta-selected", "aria-label": t("tripa.cmp.chosen") });
  const startIn = h("input", { type: "date", id: "ta-cmp-start", value: start, min: today }), endIn = h("input", { type: "date", id: "ta-cmp-end", value: end, min: today });
  const country = h("select", { id: "ta-cmp-country" }, COUNTRIES.map((c) => h("option", { value: c.id, text: t(c.key) })));
  const picker = destPicker(ctx, { id: "ta-cmp", label: "tripa.cmp.add_label", exclude: [] });
  const addBtn = h("button", { type: "button", class: "tp-btn", text: t("tripa.cmp.add"), onclick: add });
  const goBtn = h("button", { type: "button", class: "tp-btn primary", text: t("tripa.cmp.compare"), onclick: run });

  function paintChosen() {
    chosen.replaceChildren(...sel.map((id, i) => h("li", { class: "ta-sel" }, h("i", { class: "ta-dot", style: `background:${COLORS[i]}` }), ui.destName(data.byId.get(id)),
      h("button", { type: "button", class: "ta-x", "aria-label": t("tripa.cmp.remove", { name: ui.destName(data.byId.get(id)) }), text: "×", onclick: () => { sel = sel.filter((x) => x !== id); paintChosen(); } }))));
    if (!sel.length) chosen.replaceChildren(h("li", { class: "ta-hint", text: t("tripa.cmp.none_chosen") }));
    addBtn.disabled = sel.length >= MAX_DEST;
    goBtn.disabled = sel.length < MIN_DEST;
  }
  function add() {
    const id = picker.value();
    if (!id) { msg.textContent = t("tripa.cmp.pick_first"); return; }
    if (sel.includes(id)) { msg.textContent = t("tripa.cmp.already"); return; }
    if (sel.length >= MAX_DEST) { msg.textContent = t("tripa.cmp.max", { max: MAX_DEST }); return; }
    sel.push(id); msg.textContent = ""; picker.select.value = ""; paintChosen();
  }
  function run() {
    msg.textContent = "";
    const s = startIn.value, e = endIn.value;
    if (sel.length < MIN_DEST) { msg.textContent = t("tripa.cmp.min", { min: MIN_DEST }); return; }
    if (!validDate(s) || !validDate(e)) { msg.textContent = t("tripa.err.bad_date"); return; }
    if (s < today) { msg.textContent = t("tripa.err.past_date"); return; }
    if (e < s) { msg.textContent = t("tripa.cmp.end_before"); return; }
    if (daysBetween(s, e) + 1 > MAX_DAYS) { msg.textContent = t("tripa.cmp.too_long", { max: MAX_DAYS }); return; }
    ctx.go(`#/plan/compare/${sel.join(",")}/${s}/${e}`);
  }

  form.append(
    h("label", { class: "tp-field", for: "ta-cmp-country" }, h("span", { text: t("tripa.cmp.country") }), country),
    picker.el, h("div", { class: "ta-btnrow" }, addBtn), chosen,
    h("div", { class: "ta-daterow" },
      h("label", { class: "tp-field", for: "ta-cmp-start" }, h("span", { text: t("tripa.cmp.start") }), startIn),
      h("label", { class: "tp-field", for: "ta-cmp-end" }, h("span", { text: t("tripa.cmp.end") }), endIn)),
    h("div", { class: "ta-btnrow" }, goBtn), msg, h("p", { class: "ta-fine", text: t("tripa.cmp.limits", { min: MIN_DEST, max: MAX_DEST }) }));
  paintChosen();

  // ---- results from the address ----
  if (!addr.has) { results.append(h("p", { class: "tp-state", text: t("tripa.cmp.pick") })); return; }
  if (addr.unknown) { results.append(h("p", { class: "tp-state error", role: "alert", text: t("tripa.err.unknown_dest") })); return; }
  if (addr.ids.length < MIN_DEST) { results.append(h("p", { class: "tp-state", text: t("tripa.cmp.min", { min: MIN_DEST }) })); return; }
  if (!validDate(addr.start) || !validDate(addr.end) || addr.end < addr.start) { results.append(h("p", { class: "tp-state error", role: "alert", text: t("tripa.err.bad_date") })); return; }
  if (addr.start < today) { results.append(h("p", { class: "tp-state", text: t("tripa.err.past_date") })); return; }
  if (daysBetween(addr.start, addr.end) + 1 > MAX_DAYS) { results.append(h("p", { class: "tp-state error", text: t("tripa.cmp.too_long", { max: MAX_DAYS }) })); return; }
  start = addr.start; end = addr.end;
  const dates = []; for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  await compute(false);

  async function compute(force) {
    ui.loading(results);
    const dests = addr.ids.map((id) => data.byId.get(id));
    let map;
    try { map = await loadForecasts(dests, { force }); } catch { map = new Map(); }
    if (!results.isConnected) return;
    let prefs = {};
    try { prefs = getPrefs() || {}; } catch { prefs = {}; }
    const list = dests.map((dest, i) => ({ ...analyse({ dest, fc: map.get(dest.id), history: data.history, dates, today, cfg, prefs, env: data.env?.destinations?.[dest.id] }), color: COLORS[i] }));
    if (list.every((r) => r.nForecast === 0 && r.nTendency === 0)) { ui.errorBox(results, "tripa.cmp.err_all", () => compute(true)); return; }
    show(list, dates, () => compute(true));
  }

  function show(list, dates, refresh) {
    let sortBy = list.some((r) => r.S !== null) ? "best_score" : "lowest_rain";
    const sortSel = h("select", { id: "ta-cmp-sort", "aria-label": t("tripa.cmp.sort") }, SORTS.map((s) => h("option", { value: s, text: t(`tripa.sort.${s}`), selected: s === sortBy })));
    const cardsBox = h("div", { class: "tp-grid ta-cards-grid" });
    const best = [...list].filter((r) => r.S !== null).sort((a, b) => b.S - a.S)[0] || sortResults(list, "lowest_rain").find((r) => r.avgMm !== null) || null;
    const bestBox = h("section", { class: "tp-card ta-best" });
    if (best) {
      bestBox.append(h("h2", { text: t("tripa.cmp.best", { name: ui.destName(best.dest) }) }),
        h("p", { class: "ta-fine", text: best.S !== null ? t("tripa.cmp.best_basis_score") : t("tripa.cmp.best_basis_rain") }),
        best.reasons.length ? h("ul", { class: "ta-say" }, best.reasons.map((r) => h("li", { text: t(r.key, r.params) }))) : h("p", { class: "ta-fine", text: t("tripa.cmp.no_reason") }));
    }

    const paintCards = () => cardsBox.replaceChildren(...sortResults(list, sortBy).map((r) => card(r, r === best)));
    sortSel.addEventListener("change", () => { sortBy = sortSel.value; paintCards(); });
    paintCards();

    // source / freshness row (oldest copy counts)
    const withTime = list.filter((r) => r.fetchedAt).map((r) => r.fetchedAt).sort();
    const source = h("div", { class: "ta-source" },
      list.some((r) => r.nForecast) ? ui.badge("forecast") : null, list.some((r) => r.nTendency) ? ui.badge("tendency") : null,
      withTime.length ? h("span", { class: "ta-updated", text: ui.stamp(withTime[0]) }) : null);
    if (list.some((r) => r.stale)) source.append(h("p", { class: "ta-stale", role: "status", text: t("tripa.stale_note", { time: ui.stamp(withTime[0], "trip.stale") }) }));
    if (list.some((r) => r.nTendency)) source.append(h("p", { class: "ta-note", text: t("tripa.cmp.tend_note") }));
    if (list.some((r) => r.nMissing)) source.append(h("p", { class: "ta-note", text: t("tripa.cmp.missing_note") }));

    const share = h("button", { type: "button", class: "tp-btn", text: t("tripa.cmp.share"), onclick: async () => {
      try { await navigator.clipboard.writeText(location.href); ui.toast("tripa.cmp.copied", "ok"); } catch { ui.toast("tripa.cmp.copy_failed", "warn"); } } });
    const refreshBtn = h("button", { type: "button", class: "tp-btn", text: t("tripa.refresh"), onclick: refresh });

    const rainCanvas = canvasFor("tripa.chart.rain_alt");
    const chanceCanvas = canvasFor("tripa.chart.chance_alt");
    const tempCanvas = canvasFor("tripa.chart.temp_alt");
    const hourCanvas = canvasFor("tripa.chart.hour_alt");
    const hourDays = dates.filter((d) => list.every((r) => r.days.find((x) => x.date === d)?.kind === "forecast"));
    const hourSel = h("select", { id: "ta-cmp-hourday", "aria-label": t("tripa.cmp.hour_day") }, hourDays.map((d) => h("option", { value: d, text: ui.fmtDate(d, { weekday: "short", day: "numeric", month: "short" }) })));
    const hourBox = h("section", { class: "tp-card" }, h("h2", { text: t("tripa.cmp.hour_title") }),
      hourDays.length ? [h("label", { class: "tp-field", for: "ta-cmp-hourday" }, h("span", { text: t("tripa.cmp.hour_day") }), hourSel), h("div", { class: "tp-chart ta-chart" }, hourCanvas)]
        : h("p", { class: "tp-state", text: t("tripa.cmp.no_hourly") }));

    const mapBox = h("div", { class: "ta-map", id: "ta-cmp-map", role: "region", "aria-label": t("tripa.cmp.map") });

    results.replaceChildren(
      h("div", { class: "ta-btnrow" }, share, refreshBtn), source, bestBox,
      h("div", { class: "ta-sortrow" }, h("label", { for: "ta-cmp-sort", text: `${t("tripa.cmp.sort")}: ` }), sortSel), cardsBox,
      h("section", { class: "tp-card" }, h("h2", { text: t("tripa.cmp.rain_title") }), h("div", { class: "tp-chart ta-chart" }, rainCanvas), h("p", { class: "ta-fine", text: t("tripa.cmp.rain_note") })),
      hourBox,
      h("section", { class: "tp-card" }, h("h2", { text: t("tripa.cmp.chance_title") }), h("div", { class: "tp-chart ta-chart" }, chanceCanvas)),
      h("section", { class: "tp-card" }, h("h2", { text: t("tripa.cmp.temp_title") }), h("div", { class: "tp-chart ta-chart" }, tempCanvas), h("p", { class: "ta-fine", text: t("tripa.cmp.temp_note") })),
      table(list), dailyTable(list, dates),
      h("section", { class: "tp-card" }, h("h2", { text: t("tripa.cmp.map") }), mapBox),
      h("p", { class: "ta-fine", text: t("tripa.cmp.score_note") }));

    const labels = dates.map((d) => ui.fmtDate(d));
    const tendAlpha = (color, d) => (d.kind === "tendency" ? `${color}77` : color);
    ui.chart(rainCanvas, { type: "bar", data: { labels, datasets: list.map((r) => ({ label: ui.destName(r.dest), data: r.days.map((d) => d.mm ?? null), backgroundColor: r.days.map((d) => tendAlpha(r.color, d)), borderColor: r.color, borderWidth: r.days.map((d) => (d.kind === "tendency" ? 1 : 0)) })) },
      options: { scales: { y: { beginAtZero: true, title: { display: true, text: "mm" } } }, plugins: { legend: { position: "bottom" } } } });
    ui.chart(chanceCanvas, { type: "line", data: { labels, datasets: list.map((r) => ({ label: ui.destName(r.dest), data: r.days.map((d) => (d.chance === null || d.chance === undefined ? null : Math.round(d.chance))), borderColor: r.color, backgroundColor: r.color, tension: 0.25, spanGaps: false,
      segment: { borderDash: (c) => (r.days[c.p1DataIndex]?.kind === "tendency" ? [4, 4] : undefined) } })) },
      options: { scales: { y: { min: 0, max: 100, title: { display: true, text: "%" } } }, plugins: { legend: { position: "bottom" } } } });
    ui.chart(tempCanvas, { type: "line", data: { labels, datasets: list.map((r) => ({ label: ui.destName(r.dest), data: r.days.map((d) => (d.kind === "forecast" ? Math.round(d.tmax * 10) / 10 : null)), borderColor: r.color, backgroundColor: r.color, tension: 0.25 })) },
      options: { scales: { y: { title: { display: true, text: "°C" } } }, plugins: { legend: { position: "bottom" } } } });
    if (hourDays.length) {
      const drawHour = () => {
        const day = hourSel.value;
        ui.chart(hourCanvas, { type: "line", data: { labels: Array.from({ length: 24 }, (_, i) => pad(i)), datasets: list.map((r) => ({ label: ui.destName(r.dest), data: r.days.find((d) => d.date === day).rows.map((x) => x.mm ?? null), borderColor: r.color, backgroundColor: r.color, tension: 0.25, pointRadius: 2 })) },
          options: { scales: { x: { title: { display: true, text: t("tripa.chart.hour") } }, y: { beginAtZero: true, title: { display: true, text: "mm/h" } } }, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } } } });
      };
      hourSel.addEventListener("change", drawHour); drawHour();
    }
    drawMap(mapBox, list);
  }

  function canvasFor(altKey) { return h("canvas", { role: "img", "aria-label": t(altKey, { start: ui.fmtDate(start), end: ui.fmtDate(end), n: addr.ids.length }) }); }

  function card(r, isBest) {
    const sourceBadges = h("div", { class: "ta-source" }, r.nForecast ? ui.badge("forecast") : null, r.nTendency ? ui.badge("tendency") : null);
    const rows = [
      ["tripa.cmp.avg_rain", r.avgMm === null ? "–" : ui.fmtMm(r.avgMm)],
      ["tripa.cmp.total_rain", r.totalMm === null ? "–" : ui.fmtMm(r.totalMm)],
      ["tripa.cmp.avg_chance", ui.fmtPct(r.avgChance)],
      ["tripa.cmp.temp3", r.nForecast ? `${ui.fmtTemp(r.tavg)} / ${ui.fmtTemp(r.tmax)} / ${ui.fmtTemp(r.tmin)}` : "–"],
      ["tripa.col.humidity", ui.fmtPct(r.rh)],
      ["tripa.col.wind", r.wind === null ? "–" : `${Math.round(r.wind)} km/h`],
      ["tripa.cmp.intensity", r.maxClass ? intLabel(r.maxClass) : "–"],
      ["tripa.cmp.score", r.S === null ? "–" : `${Math.round(r.S)} / 100`],
    ];
    return H("article", { class: `tp-card ta-dest${isBest ? " best" : ""}`, style: `border-top:5px solid ${r.color}` },
      H("h3", null, ui.destName(r.dest), isBest ? H("span", { class: "ta-besttag", text: ` ${t("tripa.cmp.best_tag")}` }) : null),
      r.dest.region ? H("p", { class: "ta-fine", text: r.dest.region }) : null, sourceBadges,
      H("dl", { class: "ta-dl" }, rows.flatMap(([k, v]) => [H("dt", { text: t(k) }), H("dd", { text: v })])),
      r.nForecast === 0 && r.nTendency > 0 ? H("p", { class: "ta-fine", text: t("tripa.cmp.tend_only") }) : null);
  }

  function table(list) {
    const cols = ["tripa.cmp.avg_rain", "tripa.cmp.total_rain", "tripa.cmp.avg_chance", "tripa.cmp.temp3", "tripa.col.humidity", "tripa.col.wind", "tripa.cmp.intensity", "tripa.cmp.score"];
    return H("section", { class: "tp-card" }, H("h2", { text: t("tripa.cmp.table") }),
      H("div", { class: "ta-scroll", tabindex: "0", role: "region", "aria-label": t("tripa.cmp.table") }, H("table", { class: "ta-table" },
        H("thead", null, H("tr", null, H("th", { scope: "col", text: t("tripa.cmp.dest") }), cols.map((k) => H("th", { scope: "col", text: t(k) })))),
        H("tbody", null, list.map((r) => H("tr", null, H("th", { scope: "row" }, H("i", { class: "ta-dot", style: `background:${r.color}` }), ui.destName(r.dest)),
          H("td", { text: r.avgMm === null ? "–" : ui.fmtMm(r.avgMm) }), H("td", { text: r.totalMm === null ? "–" : ui.fmtMm(r.totalMm) }), H("td", { text: ui.fmtPct(r.avgChance) }),
          H("td", { text: r.nForecast ? `${ui.fmtTemp(r.tavg)} / ${ui.fmtTemp(r.tmax)} / ${ui.fmtTemp(r.tmin)}` : "–" }), H("td", { text: ui.fmtPct(r.rh) }),
          H("td", { text: r.wind === null ? "–" : `${Math.round(r.wind)} km/h` }), H("td", { text: r.maxClass ? intLabel(r.maxClass) : "–" }), H("td", { text: r.S === null ? "–" : Math.round(r.S) })))))));
  }

  // The chart's numbers as text (also the text alternative of the daily chart)
  function dailyTable(list, dates) {
    return H("details", { class: "tp-card ta-details" }, H("summary", { text: t("tripa.cmp.daily_table") }),
      H("div", { class: "ta-scroll", tabindex: "0" }, H("table", { class: "ta-table" },
        H("thead", null, H("tr", null, H("th", { scope: "col", text: t("tripa.date") }), list.map((r) => H("th", { scope: "col", text: ui.destName(r.dest) })))),
        H("tbody", null, dates.map((d) => H("tr", null, H("th", { scope: "row", text: ui.fmtDate(d) }), list.map((r) => {
          const x = r.days.find((y) => y.date === d);
          const txt = !x || x.mm === null || x.mm === undefined ? "–" : `${x.mm.toFixed(1)} mm${x.kind === "tendency" ? ` (${t("tripa.cmp.tend_short")})` : ""}`;
          return H("td", { text: txt });
        })))))));
  }

  function drawMap(box, list) {
    if (!window.L) { box.append(H("p", { class: "tp-state", text: t("tripa.cmp.no_map") })); return; }
    leafletMap = window.L.map(box, { scrollWheelZoom: false });
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(leafletMap);
    const pts = list.filter((r) => Number.isFinite(r.dest.lat) && Number.isFinite(r.dest.lon));
    for (const r of pts) {
      window.L.circleMarker([r.dest.lat, r.dest.lon], { radius: 10, color: "#fff", weight: 2, fillColor: r.color, fillOpacity: 1 }).addTo(leafletMap)
        .bindPopup(`${ui.destName(r.dest)}: ${r.avgMm === null ? "–" : ui.fmtMm(r.avgMm)} / ${t("tripa.cmp.avg_rain").toLowerCase()}`);
    }
    if (pts.length) leafletMap.fitBounds(pts.map((r) => [r.dest.lat, r.dest.lon]), { padding: [30, 30], maxZoom: 9 });
    setTimeout(() => leafletMap?.invalidateSize(), 200);
  }
}

const pad = (n) => String(n).padStart(2, "0");
