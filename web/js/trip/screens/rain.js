// Trip planner screen: hourly rain for one destination and one day  (#/plan/rain[/<destId>[/<date>]]).
//
//   * Inside the 16-day forecast: a 24-hour chart (rain bars coloured by intensity, chance-of-rain line, temperature line),
//     the four parts of the day (night / morning / afternoon / evening), a table of hourly values and plain sentences.
//     Hourly values come ONLY from the Open-Meteo hourly forecast (NOT NASA data). They are never made up from averages.
//   * Beyond the forecast: only the NASA POWER historical tendency for that time of year is shown, with its badge and no hourly chart.
// This file also exports a few small helpers that the compare and dates screens reuse (date maths, destination picker, source line).
import { t } from "../../i18n.js";
import { loadForecast, hoursOf, dayKind, todayColombo } from "../forecast.js";
import { tendencyFor } from "../history.js";
import { h as H } from "../ui.js";
import { summariseDay, classifyHour, periodOf, INTENSITY } from "../intensity.js";

const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Shared helpers (also used by compare.js and dates.js)
// ---------------------------------------------------------------------------
export function todayISO() { return todayColombo(); }
export function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5); }
export function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Colour of an intensity class (falls back to fixed colours if intensity.js does not give one)
const FALLBACK_COLORS = { none: "#B8C4D6", light: "#7CC4F0", moderate: "#3182CE", heavy: "#1A4F8F", very_heavy: "#5B2A86" };
export const intColor = (id) => INTENSITY?.[id]?.color || FALLBACK_COLORS[id] || "#888";
export const intLabel = (id) => t(INTENSITY?.[id]?.key || `trip.int.${id}`);

// WMO weather code -> one of our text keys (tripa.wmo.<name>)
export function wmoName(code) {
  if (code === null || code === undefined) return null;
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "storm";
  return "other";
}

// A search box plus a list: type to filter the destinations, then choose one. onChange(destId) is called when one is chosen.
export function destPicker(ctx, { id, selected = "", onChange, exclude = [], label = "tripa.choose_dest" }) {
  const { ui, data } = ctx; const h = ui.h;
  const input = h("input", { type: "search", id: `${id}-q`, placeholder: t("tripa.search_ph"), autocomplete: "off", "aria-label": t("tripa.search_label") });
  const select = h("select", { id: `${id}-s`, "aria-label": t(label) });
  const fill = () => {
    const q = input.value.trim().toLowerCase(), keep = select.value || selected;
    select.replaceChildren(h("option", { value: "", text: t(label) }));
    const list = [...data.destinations].sort((a, b) => a.name_en.localeCompare(b.name_en));
    for (const d of list) {
      if (exclude.includes(d.id)) continue;
      if (q && !`${d.name_en} ${d.name_si || ""} ${d.region || ""}`.toLowerCase().includes(q)) continue;
      select.append(h("option", { value: d.id, text: d.region ? `${ui.destName(d)} (${d.region})` : ui.destName(d), selected: d.id === keep }));
    }
    if (!select.children.length || (q && select.children.length === 1)) select.firstChild.textContent = t("tripa.no_match");
  };
  input.addEventListener("input", fill);
  select.addEventListener("change", () => { if (select.value) onChange?.(select.value); });
  fill();
  const el = h("div", { class: "ta-picker" }, h("label", { class: "tp-field", for: `${id}-q` }, h("span", { text: t("tripa.search_label") }), input), h("label", { class: "tp-field", for: `${id}-s` }, h("span", { text: t(label) }), select));
  return { el, select, input, value: () => select.value, reset: () => { input.value = ""; fill(); } };
}

// Source line for a forecast: badge + "updated ..." and a clear note when the copy is old or offline
export function forecastSource(ctx, fc) {
  const { ui } = ctx; const h = ui.h;
  const box = h("div", { class: "ta-source" }, ui.badge("forecast"), h("span", { class: "ta-updated", text: ui.stamp(fc?.fetchedAt) }));
  if (fc?.stale) box.append(h("p", { class: "ta-stale", role: "status", text: t("tripa.stale_note", { time: ui.stamp(fc.fetchedAt, "trip.stale") }) }));
  return box;
}

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------
const hh = (h) => `${pad(((h % 24) + 24) % 24)}:00`;

// Totals for one part of the day from the 24 rows
export function periodTotals(rows, cfg) {
  const out = {};
  for (const p of ["night", "morning", "afternoon", "evening"]) out[p] = { mm: 0, chance: null, maxMm: 0, known: 0 };
  for (const r of rows) {
    const o = out[periodOf(r.h, cfg)];
    if (!o) continue;
    if (r.mm !== null && r.mm !== undefined) { o.mm += r.mm; o.known++; o.maxMm = Math.max(o.maxMm, r.mm); }
    if (r.chance !== null && r.chance !== undefined) o.chance = Math.max(o.chance ?? 0, r.chance);
  }
  return out;
}

// Plain sentences as [textKey, params] pairs (the screen turns them into text with t()).
export function sentencesFor(rows, sum, cfg) {
  const out = [];
  const known = rows.filter((r) => r.mm !== null && r.mm !== undefined);
  if (!known.length) return out;
  const wet = known.filter((r) => classifyHour(r.mm, cfg) !== "none");
  if (!wet.length) out.push(["tripa.say.dry", {}]);
  else {
    const first = wet[0].h, last = wet[wet.length - 1].h;
    out.push(["tripa.say.window", { from: hh(first), to: hh(last + 1), amount: `${(Math.round(sum.totalMm * 10) / 10).toFixed(1)} mm` }]);
    const peak = known.reduce((a, r) => (r.mm > a.mm ? r : a), known[0]);
    out.push(["tripa.say.peak", { time: hh(peak.h), level: intLabel(classifyHour(peak.mm, cfg)).toLowerCase(), mm: `${peak.mm.toFixed(1)} mm` }]);
    const per = periodTotals(rows, cfg), cand = ["morning", "afternoon", "evening"].filter((p) => per[p].known);
    if (cand.length > 1) {
      const sorted = [...cand].sort((a, b) => per[a].mm - per[b].mm);
      if (per[sorted[0]].mm <= 0.3 * per[sorted[sorted.length - 1]].mm) out.push(["tripa.say.better", { period: t(`trip.period.${sorted[0]}`).toLowerCase() }]);
    }
  }
  const chance = Math.max(0, ...known.map((r) => r.chance ?? 0));
  if (chance >= (cfg?.verdict?.wet_chance ?? 70) && wet.length) out.push(["tripa.say.chance_high", { chance: `${Math.round(chance)}%` }]);
  else if (chance < (cfg?.verdict?.maybe_chance ?? 35) && !wet.length) out.push(["tripa.say.chance_low", { chance: `${Math.round(chance)}%` }]);
  const gw = sum.goodWindows?.[0];
  if (gw && wet.length) out.push(["tripa.say.good_window", { from: hh(gw.from), to: hh(gw.to) }]);
  return out;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------
export async function renderRain(ctx, parts, view) {
  const { ui, data, cfg } = ctx; const h = ui.h;
  ui.ensureCss("trip-a");
  const today = todayISO();
  const dest = parts[0] ? data.byId.get(parts[0]) : null;
  const dateGiven = parts[1] !== undefined;
  const dateOk = dateGiven ? validDate(parts[1]) : true;
  const date = dateGiven && dateOk ? parts[1] : today;
  const horizon = cfg.forecast_horizon_days || 16;

  const toHash = (id, d) => ctx.go(`#/plan/rain/${id}${d ? `/${d}` : ""}`);

  // --- controls ---
  const picker = destPicker(ctx, { id: "ta-rain", selected: dest?.id || "", onChange: (id) => toHash(id, dateOk ? date : today) });
  const dateInput = h("input", { type: "date", id: "ta-rain-date", value: date, min: today, "aria-label": t("tripa.date") });
  dateInput.addEventListener("change", () => { if (dest && validDate(dateInput.value)) toHash(dest.id, dateInput.value); });
  const chips = h("div", { class: "ta-chips", role: "group", "aria-label": t("tripa.next_days") });
  for (let i = 0; i < horizon; i++) {
    const d = addDays(today, i);
    chips.append(h("button", { type: "button", class: `ta-chip${d === date ? " on" : ""}`, "aria-pressed": d === date ? "true" : "false", disabled: !dest,
      onclick: () => toHash(dest.id, d) }, h("span", { text: ui.fmtDate(d, { weekday: "short" }) }), h("strong", { text: ui.fmtDate(d, { day: "numeric" }) })));
  }
  const results = h("div", { class: "ta-results", "aria-live": "polite" });
  view.replaceChildren(
    h("header", { class: "ta-head" }, h("h1", { text: t("tripa.rain.title") }), h("p", { class: "ta-sub", text: t("tripa.rain.sub") })),
    h("section", { class: "tp-card ta-controls" }, picker.el,
      h("label", { class: "tp-field", for: "ta-rain-date" }, h("span", { text: t("tripa.date") }), dateInput), chips),
    results);

  if (parts[0] && !dest) { results.append(h("p", { class: "tp-state error", role: "alert", text: t("tripa.err.unknown_dest") })); return; }
  if (dateGiven && !dateOk) { results.append(h("p", { class: "tp-state error", role: "alert", text: t("tripa.err.bad_date") })); return; }
  if (!dest) { results.append(h("p", { class: "tp-state", text: t("tripa.rain.pick") })); return; }
  if (date < today) { results.append(h("p", { class: "tp-state", text: t("tripa.err.past_date") })); return; }
  if (!data.destinations.length) { results.append(h("p", { class: "tp-state error", text: t("tripa.err.no_dests") })); return; }

  const kind = dayKind(date, today, cfg);
  if (kind !== "forecast") return showTendency();
  return showForecast(false);

  // --- beyond the forecast: tendency only ---
  function showTendency() {
    const tend = data.history ? tendencyFor(data.history, dest.cell, date) : null;
    const card = h("section", { class: "tp-card ta-tend" },
      h("h2", { text: `${ui.destName(dest)} - ${ui.fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}` }),
      h("div", { class: "ta-source" }, tend ? ui.badge("tendency") : null),
      h("p", { class: "ta-note", text: t("tripa.rain.beyond", { days: horizon }) }));
    if (!tend) card.append(h("p", { class: "tp-state", text: data.history ? t("tripa.err.no_tendency") : t("tripa.err.no_history") }));
    else card.append(h("div", { class: "ta-cards" },
      stat(t("tripa.tend.pwet"), ui.fmtPct(tend.pWet * 100)),
      stat(t("tripa.tend.mean"), ui.fmtMm(tend.meanMm)),
      stat(t("tripa.tend.p90"), ui.fmtMm(tend.p90Mm))),
      h("p", { class: "ta-fine", text: t("tripa.tend.explain", { period: tend.period || "1981-2025" }) }));
    results.replaceChildren(card);
  }

  // --- inside the forecast ---
  async function showForecast(force) {
    ui.loading(results);
    let fc;
    try { fc = await loadForecast(dest, { force }); } catch (e) { fc = { ok: false, error: String(e) }; }
    if (!results.isConnected) return;
    if (!fc?.ok) { ui.errorBox(results, "tripa.err.forecast", () => showForecast(true)); return; }
    const rows = hoursOf(fc, date) || [];
    if (!rows.length || rows.every((r) => r.mm === null || r.mm === undefined)) {
      results.replaceChildren(h("p", { class: "tp-state", text: t("tripa.err.no_hours") }), forecastSource(ctx, fc)); return;
    }
    const sum = summariseDay(rows, cfg);
    const cls = sum.maxClass || "none";

    const head = h("section", { class: "tp-card" },
      h("h2", { text: `${ui.destName(dest)} - ${ui.fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}` }),
      forecastSource(ctx, fc),
      h("div", { class: "ta-cards" },
        h("div", { class: "ta-stat ta-class" }, h("span", { class: "ta-stat-k", text: t("tripa.stat.category") }), h("strong", null, h("i", { class: "ta-dot", style: `background:${intColor(cls)}` }), intLabel(cls))),
        stat(t("tripa.stat.total"), ui.fmtMm(sum.totalMm)),
        stat(t("tripa.stat.duration"), sum.durationHours ? t("tripa.hours", { n: sum.durationHours }) : t("tripa.none")),
        stat(t("tripa.stat.chance"), ui.fmtPct(sum.maxChance)),
        stat(t("tripa.stat.temp"), `${ui.fmtTemp(sum.minTemp)} - ${ui.fmtTemp(sum.maxTemp)}`)),
      h("p", { class: "ta-effect" }, h("strong", { text: `${t("tripa.stat.effect")}: ` }), t(`tripa.effect.${cls}`)),
      h("ul", { class: "ta-say" }, sentencesFor(rows, sum, cfg).map(([k, p]) => h("li", { text: t(k, p) }))),
      h("div", { class: "ta-btnrow" }, h("button", { type: "button", class: "tp-btn", text: t("tripa.refresh"), onclick: () => showForecast(true) })));

    // chart + text alternative
    const canvas = h("canvas", { role: "img", "aria-label": t("tripa.chart.alt", { name: ui.destName(dest), date: ui.fmtDate(date), total: ui.fmtMm(sum.totalMm), max: ui.fmtPct(sum.maxChance) }) });
    const chartCard = h("section", { class: "tp-card" }, h("h2", { text: t("tripa.chart.title") }), h("div", { class: "tp-chart ta-chart" }, canvas), legend(cfg), h("p", { class: "ta-fine", text: t("tripa.chart.note") }));

    // parts of the day
    const per = periodTotals(rows, cfg);
    const periodRows = ["night", "morning", "afternoon", "evening"].map((p) => {
      const range = cfg.day_periods?.[p] || [0, 23];
      const c = per[p].known ? classifyHour(per[p].maxMm, cfg) : null;
      return h("tr", null, h("th", { scope: "row", text: `${t(`trip.period.${p}`)} (${pad(range[0])}-${pad(range[1])})` }),
        h("td", { text: per[p].known ? ui.fmtMm(per[p].mm) : "–" }), h("td", { text: ui.fmtPct(per[p].chance) }),
        h("td", null, c ? h("span", null, h("i", { class: "ta-dot", style: `background:${intColor(c)}` }), intLabel(c)) : "–"));
    });
    const periodsCard = h("section", { class: "tp-card" }, h("h2", { text: t("tripa.periods.title") }),
      h("div", { class: "ta-scroll" }, h("table", { class: "ta-table" },
        h("thead", null, h("tr", null, ["tripa.col.period", "tripa.col.mm", "tripa.col.chance", "tripa.col.level"].map((k) => h("th", { scope: "col", text: t(k) })))),
        h("tbody", null, periodRows))));

    // hourly table
    const body = rows.map((r) => {
      const c = r.mm === null || r.mm === undefined ? null : classifyHour(r.mm, cfg), w = wmoName(r.code);
      return h("tr", null, h("th", { scope: "row", text: hh(r.h) }),
        h("td", null, c ? h("i", { class: "ta-dot", style: `background:${intColor(c)}`, title: intLabel(c) }) : null, r.mm === null || r.mm === undefined ? "–" : r.mm.toFixed(1)),
        h("td", { text: ui.fmtPct(r.chance) }), h("td", { text: ui.fmtTemp(r.temp) }), h("td", { text: ui.fmtPct(r.rh) }),
        h("td", { text: r.wind === null || r.wind === undefined ? "–" : `${Math.round(r.wind)} km/h` }), h("td", { text: w ? t(`tripa.wmo.${w}`) : "–" }));
    });
    const tableCard = h("section", { class: "tp-card" }, h("h2", { text: t("tripa.table.title") }),
      h("div", { class: "ta-scroll", tabindex: "0", role: "region", "aria-label": t("tripa.table.title") }, h("table", { class: "ta-table" },
        h("thead", null, h("tr", null, ["tripa.col.time", "tripa.col.mm", "tripa.col.chance", "tripa.col.temp", "tripa.col.humidity", "tripa.col.wind", "tripa.col.cond"].map((k) => h("th", { scope: "col", text: t(k) })))),
        h("tbody", null, body))),
      h("p", { class: "ta-fine", text: t("tripa.table.note") }));

    results.replaceChildren(head, chartCard, periodsCard, tableCard);
    drawChart(ctx, canvas, rows, cfg);
  }
}

export function stat(label, value) {
  return H("div", { class: "ta-stat" }, H("span", { class: "ta-stat-k", text: label }), H("strong", { text: value }));
}

export function legend(cfg) {
  const i = cfg.intensity || {};
  const items = [["none", `< ${i.light_min ?? 0.1}`], ["light", `${i.light_min ?? 0.1} - ${i.moderate_min ?? 2.5}`], ["moderate", `${i.moderate_min ?? 2.5} - ${i.heavy_min ?? 10}`],
    ["heavy", `${i.heavy_min ?? 10} - ${i.very_heavy_min ?? 50}`], ["very_heavy", `> ${i.very_heavy_min ?? 50}`]];
  return H("ul", { class: "ta-legend", "aria-label": t("tripa.legend") }, items.map(([id, range]) =>
    H("li", null, H("i", { class: "ta-dot", style: `background:${intColor(id)}` }), `${intLabel(id)}: ${range} ${i.unit || "mm/hour"}`)));
}

// The 24-hour chart. Part-of-day bands are drawn behind the bars by a small plugin (no extra library needed).
function drawChart(ctx, canvas, rows, cfg) {
  const periods = ["night", "morning", "afternoon", "evening"].map((p) => ({ id: p, from: (cfg.day_periods?.[p] || [0, 5])[0], to: (cfg.day_periods?.[p] || [0, 5])[1] }));
  const bands = {
    id: "taBands",
    beforeDatasetsDraw(c) {
      const { ctx: g, chartArea: a, scales } = c;
      if (!a || !scales.x) return;
      const x = scales.x, half = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2;
      g.save();
      periods.forEach((p, i) => {
        const x0 = x.getPixelForValue(p.from) - half, x1 = x.getPixelForValue(p.to) + half;
        g.fillStyle = i % 2 ? "rgba(86,180,233,.10)" : "rgba(16,28,44,.05)";
        g.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        g.fillStyle = "#4A5B72"; g.font = "600 11px sans-serif"; g.textAlign = "center";
        g.fillText(`${t(`trip.period.${p.id}`)} ${pad(p.from)}-${pad(p.to)}`, (x0 + x1) / 2, a.top + 12, x1 - x0 - 4);
      });
      g.restore();
    },
  };
  const mm = rows.map((r) => r.mm ?? null);
  const maxMm = Math.max(2, ...mm.map((v) => v ?? 0)) * 1.25;
  ctx.ui.chart(canvas, {
    data: {
      labels: rows.map((r) => pad(r.h)),
      datasets: [
        { type: "bar", label: t("tripa.col.mm"), data: mm, backgroundColor: mm.map((v) => intColor(v === null ? "none" : classifyHour(v, cfg))), yAxisID: "y", order: 3 },
        { type: "line", label: t("tripa.col.chance"), data: rows.map((r) => r.chance ?? null), borderColor: "#1677C8", backgroundColor: "#1677C8", yAxisID: "y1", tension: 0.3, pointRadius: 2, borderWidth: 2, order: 1 },
        { type: "line", label: t("tripa.col.temp"), data: rows.map((r) => r.temp ?? null), borderColor: "#F59E0B", backgroundColor: "#F59E0B", yAxisID: "y2", tension: 0.3, pointRadius: 2, borderWidth: 2, borderDash: [5, 3], order: 2 },
      ],
    },
    plugins: [bands],
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: t("tripa.chart.hour") } },
        y: { beginAtZero: true, suggestedMax: maxMm, title: { display: true, text: "mm" } },
        y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: "%" } },
        y2: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "°C" } },
      },
      plugins: { legend: { position: "bottom" } },
    },
  });
}
