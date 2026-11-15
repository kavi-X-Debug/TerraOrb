// Three extra graphs on a tank's charts page:
//   1. rain each month for the last 12 months next to the usual rain       (NASA POWER, in the tank file)
//   2. how green the land around the tank is, now and in earlier years      (NASA MODIS NDVI, "ndvi" section)
//   3. the rain outlook for the coming months                               (ECMWF via Open-Meteo, "seasonal" section; NOT NASA data)
// All numbers come from the tank's JSON file; nothing is calculated here except the usual rain per month
// (an average of rain.monthly over the normal years) and the day of year used to match NDVI dates.
import { t } from "./i18n.js";
import { badges, sourceBadge, date, escapeHtml } from "./ui.js";

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function options(yTitle) {
  return {
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { boxWidth: 14, font: { size: 14 } } } },
    scales: {
      x: { ticks: { maxRotation: 0, autoSkipPadding: 16, font: { size: 13 } }, grid: { display: false } },
      y: { title: { display: true, text: yTitle, font: { size: 13 } }, ticks: { font: { size: 13 } } },
    },
  };
}

const monthLabel = (ym) => date(`${ym}-01`, { month: "short", year: "numeric" });

// ---------------------------------------------------------------------------
// The blocks (HTML)
// ---------------------------------------------------------------------------
export function outlookBlocks(doc) {
  return monthlyRainBlock(doc.rain) + ndviBlock(doc.ndvi) + seasonalBlock(doc.seasonal);
}

function monthlyRainBlock(rain) {
  if (!rain?.monthly?.length) return "";
  return `
  <section class="block" aria-labelledby="mrain-title">
    <h2 id="mrain-title">${escapeHtml(t("outlook.rain.title"))}</h2>
    <p class="chart-help">${escapeHtml(t("outlook.rain.help", { period: rain.normal_period }))}</p>
    <div class="chart-box"><canvas id="mrain-chart" role="img" aria-label="${escapeHtml(t("outlook.rain.title"))}"></canvas></div>
    <p class="note">${escapeHtml(t("outlook.rain.ends", { month: monthLabel(rain.monthly.at(-1).month) }))}</p>
    ${badges(rain.source, rain.demo)}
  </section>`;
}

function ndviBlock(ndvi) {
  if (!ndvi) {
    return `<section class="block" aria-labelledby="ndvi-title"><h2 id="ndvi-title">${escapeHtml(t("ndvi.title"))}</h2>
      <p>${escapeHtml(t("ndvi.none"))}</p></section>`;
  }
  const cur = ndvi.current;
  const summary = cur?.state
    ? `<p class="figure-line">${escapeHtml(t(`advisory.green.${cur.state}`, { date: date(cur.date, { day: "numeric", month: "long" }) }))}</p>` : "";
  return `
  <section class="block" aria-labelledby="ndvi-title">
    <h2 id="ndvi-title">${escapeHtml(t("ndvi.title"))}</h2>
    <p class="chart-help">${escapeHtml(t("ndvi.help"))}</p>
    ${summary}
    <div class="chart-box"><canvas id="ndvi-chart" role="img" aria-label="${escapeHtml(t("ndvi.title"))}"></canvas></div>
    <p class="note">${escapeHtml(t("ndvi.usual_years", { years: ndvi.normal_years }))}</p>
    <p class="note">${escapeHtml(t("ndvi.late"))}</p>
    ${badges(ndvi.source, ndvi.demo)}
  </section>`;
}

function seasonalBlock(seasonal) {
  if (!seasonal?.months?.length) return "";
  return `
  <section class="block" aria-labelledby="seasonal-title">
    <h2 id="seasonal-title">${escapeHtml(t("seasonal.title"))}</h2>
    <p class="chart-help">${escapeHtml(t("seasonal.help", { low: seasonal.range_percent[0], high: 100 - seasonal.range_percent[1], period: seasonal.normal_period }))}</p>
    <div class="chart-box"><canvas id="seasonal-chart" role="img" aria-label="${escapeHtml(t("seasonal.title"))}"></canvas></div>
    <p class="demo-banner">${escapeHtml(t("seasonal.warn"))}</p>
    <p class="note">${escapeHtml(t("seasonal.issued", { date: date(seasonal.issued) }))}</p>
    ${sourceBadge(seasonal.source)}
    ${sourceBadge(seasonal.usual_source)}
    <p class="note">${escapeHtml(t("seasonal.not_nasa"))}</p>
    ${seasonal.demo ? badges(null, true) : ""}
  </section>`;
}

// ---------------------------------------------------------------------------
// The graphs. `keep` is called with each Chart.js object so the page can destroy it later.
// ---------------------------------------------------------------------------
export function drawOutlook(panel, doc, keep) {
  drawMonthlyRain(panel, doc.rain, keep);
  drawNdvi(panel, doc.ndvi, keep);
  drawSeasonal(panel, doc.seasonal, keep);
}

function drawMonthlyRain(panel, rain, keep) {
  const canvas = panel.querySelector("#mrain-chart");
  if (!canvas || !rain?.monthly?.length) return;
  const [first, last] = (rain.normal_period.match(/\d{4}/g) || []).map(Number);
  // Usual rain of each calendar month = the average over the normal years (needs 20 years).
  const sums = {};
  for (const row of rain.monthly) {
    const year = +row.month.slice(0, 4);
    if (year >= first && year <= last && row.total_mm !== null) (sums[row.month.slice(5)] ||= []).push(row.total_mm);
  }
  const usual = (mm) => (sums[mm]?.length >= 20 ? sums[mm].reduce((a, b) => a + b, 0) / sums[mm].length : null);
  const rows = rain.monthly.slice(-12);
  keep(new Chart(canvas, {
    data: {
      labels: rows.map((r) => monthLabel(r.month)),
      datasets: [
        { type: "bar", label: t("outlook.rain.fell"), data: rows.map((r) => r.total_mm),
          backgroundColor: cssVar("--monsoon"), borderRadius: 4 },
        { type: "line", label: t("outlook.rain.usual"), data: rows.map((r) => usual(r.month.slice(5))),
          borderColor: cssVar("--ink"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: options(t("unit.mm")),
  }));
}

// MODIS composites start on the same day of the year every year, so a date's day of year finds its slot.
const dayOfYear = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
};

function drawNdvi(panel, ndvi, keep) {
  const canvas = panel.querySelector("#ndvi-chart");
  if (!canvas || !ndvi) return;
  const usual = new Map(ndvi.normal.map((n) => [n.doy, n]));
  const at = (day, field) => usual.get(dayOfYear(day))?.[field] ?? null;
  const days = ndvi.series.map((s) => s.date);
  const green = cssVar("--green") || "#1F7A3A";
  keep(new Chart(canvas, {
    type: "line",
    data: {
      labels: days.map((d) => date(d, { month: "short", year: "numeric" })),
      datasets: [
        { label: t("ndvi.now"), data: ndvi.series.map((s) => s.ndvi), borderColor: green, backgroundColor: green,
          pointRadius: 2, borderWidth: 3, spanGaps: false, order: 1 },
        { label: t("ndvi.usual"), data: days.map((d) => at(d, "mean")), borderColor: cssVar("--ink"), borderDash: [6, 4],
          pointRadius: 0, borderWidth: 2, order: 2 },
        { label: t("ndvi.lowest"), data: days.map((d) => at(d, "min")), borderWidth: 0, pointRadius: 0, order: 4 },
        { label: t("ndvi.range"), data: days.map((d) => at(d, "max")), borderWidth: 0, pointRadius: 0,
          fill: "-1", backgroundColor: "rgba(120,130,110,.22)", order: 3 },
      ],
    },
    options: {
      ...options(t("ndvi.axis")),
      plugins: { legend: { labels: { boxWidth: 14, font: { size: 14 }, filter: (item) => item.text !== t("ndvi.lowest") } } },
    },
  }));
}

function drawSeasonal(panel, seasonal, keep) {
  const canvas = panel.querySelector("#seasonal-chart");
  if (!canvas || !seasonal?.months?.length) return;
  const months = seasonal.months;
  keep(new Chart(canvas, {
    data: {
      labels: months.map((m) => monthLabel(m.month)),
      datasets: [
        { type: "bar", label: t("seasonal.range", { low: seasonal.range_percent[0], high: 100 - seasonal.range_percent[1] }),
          data: months.map((m) => [m.low_mm, m.high_mm]), backgroundColor: "rgba(47,106,143,.45)",
          borderColor: cssVar("--monsoon"), borderWidth: 2, borderRadius: 4, borderSkipped: false },
        { type: "line", label: t("seasonal.middle"), data: months.map((m) => m.middle_mm), showLine: false,
          pointStyle: "rectRot", pointRadius: 7, backgroundColor: cssVar("--monsoon"), borderColor: "#fff" },
        { type: "line", label: t("seasonal.usual"), data: months.map((m) => m.usual_mm), borderColor: cssVar("--ink"),
          borderDash: [6, 4], pointRadius: 3, borderWidth: 2 },
      ],
    },
    options: options(t("unit.mm")),
  }));
}

// ---------------------------------------------------------------------------
// 4. Soil moisture around the tank (NASA GLDAS Noah, monthly, 25 km). Read from data/farm/soil_moisture.json, made by pipeline/soil_moisture.py.
//    Added after the page is drawn; if the file or the cell is missing nothing is shown (never a guess).
// ---------------------------------------------------------------------------
let soilTable;
async function loadSoil() {
  if (soilTable === undefined) {
    try { const r = await fetch("../data/farm/soil_moisture.json"); soilTable = r.ok ? await r.json() : null; } catch { soilTable = null; }
  }
  return soilTable;
}

export async function addSoil(panel, tank) {
  const table = await loadSoil();
  if (!table || !Number.isFinite(tank?.lat) || !Number.isFinite(tank?.lon)) return;
  const snap = (v) => (Math.round((v - 0.125) / 0.25) * 0.25 + 0.125).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const cell = table.cells[`${snap(tank.lat)}_${snap(tank.lon)}`];
  const d = cell && cell.latest;
  if (!d || !Number.isFinite(d.l1) || !panel.isConnected) return;
  const z = Number.isFinite(d.l1_z) ? d.l1_z : 0;
  const level = z <= -1.5 ? "much_drier" : z <= -0.5 ? "drier" : z >= 1.5 ? "much_wetter" : z >= 0.5 ? "wetter" : "same";
  const month = date(`${d.month}-01`, { month: "long", year: "numeric" });
  panel.insertAdjacentHTML("beforeend", `
  <section class="block" aria-labelledby="soil-title">
    <h2 id="soil-title">${escapeHtml(t("soil.title"))}</h2>
    <p class="figure-line">${escapeHtml(t(`soil.${level}`, { month }))}</p>
    <p class="note">${escapeHtml(t("soil.values", { l1: d.l1.toFixed(1), l2: Number.isFinite(d.l2) ? d.l2.toFixed(1) : "?", p1: d.l1_pct_of_usual ?? "?" }))}</p>
    <p class="note">${escapeHtml(t("soil.help"))}</p>
    ${sourceBadge(table.source)}
  </section>`);
}

// ---------------------------------------------------------------------------
// 5. A second rain record: NASA GPM IMERG (satellite, 10 km), from data/farm/imerg_tanks.json (pipeline/imerg_tanks.py).
//    Shown next to NASA POWER for the last months, and it covers months POWER cannot (its newest days are skipped, see AGENTS.md).
// ---------------------------------------------------------------------------
let imergTable;
async function loadImerg() {
  if (imergTable === undefined) {
    try { const r = await fetch("../data/farm/imerg_tanks.json"); imergTable = r.ok ? await r.json() : null; } catch { imergTable = null; }
  }
  return imergTable;
}

export async function addImerg(panel, tank, doc) {
  const table = await loadImerg();
  const rec = table && table.tanks && table.tanks[tank.id];
  if (!rec || !rec.monthly.length || !panel.isConnected) return;
  const power = new Map((doc?.rain?.monthly || []).map((m) => [m.month, m.total_mm]));
  const rows = rec.monthly.slice(-6).map((m) => {
    const usual = rec.usual_by_month[String(Number(m.month.slice(5)))];
    const p = power.get(m.month);
    return `<tr><th scope="row">${escapeHtml(date(`${m.month}-01`, { month: "short", year: "numeric" }))}</th><td>${m.total_mm.toFixed(0)}</td>`
      + `<td>${usual == null ? "–" : usual.toFixed(0)}</td><td>${p == null ? "–" : p.toFixed(0)}</td></tr>`;
  }).join("");
  const last = rec.monthly.at(-1), u = rec.usual_by_month[String(Number(last.month.slice(5)))];
  const pct = u ? Math.round((100 * last.total_mm) / u) : null;
  const level = pct == null ? "none" : pct >= 130 ? "wetter" : pct <= 70 ? "drier" : "same";
  panel.insertAdjacentHTML("beforeend", `
  <section class="block" aria-labelledby="imerg-title">
    <h2 id="imerg-title">${escapeHtml(t("imerg.title"))}</h2>
    <p class="chart-help">${escapeHtml(t("imerg.help"))}</p>
    ${level === "none" ? "" : `<p class="figure-line">${escapeHtml(t(`imerg.${level}`, { month: date(`${last.month}-01`, { month: "long", year: "numeric" }), mm: last.total_mm.toFixed(0), pct }))}</p>`}
    <div class="of-scroll"><table class="crop-table"><thead><tr><th scope="col">${escapeHtml(t("imerg.col.month"))}</th><th scope="col">${escapeHtml(t("imerg.col.imerg"))}</th><th scope="col">${escapeHtml(t("imerg.col.usual"))}</th><th scope="col">${escapeHtml(t("imerg.col.power"))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">${escapeHtml(t("imerg.note"))}</p>
    ${sourceBadge(table.source)}
  </section>`);
}

// ---------------------------------------------------------------------------
// 6. NASA SMAP satellite soil moisture around the tank (data/farm/smap.json, made by pipeline/smap.py). A real satellite measurement
//    (9 km, top 5 cm); shown next to the GLDAS model above. Nothing is shown when the tank has too few clear readings.
// ---------------------------------------------------------------------------
let smapTable;
export async function addSmap(panel, tank) {
  if (smapTable === undefined) {
    try { const r = await fetch("../data/farm/smap.json"); smapTable = r.ok ? await r.json() : null; } catch { smapTable = null; }
  }
  const d = smapTable && smapTable.tanks && smapTable.tanks[tank.id] && smapTable.tanks[tank.id].latest;
  if (!d || !Number.isFinite(d.mean_m3m3) || !panel.isConnected) return;
  const z = Number.isFinite(d.z) ? d.z : 0;
  const level = z <= -1.5 ? "much_drier" : z <= -0.5 ? "drier" : z >= 1.5 ? "much_wetter" : z >= 0.5 ? "wetter" : "same";
  panel.insertAdjacentHTML("beforeend", `
  <section class="block" aria-labelledby="smap-title">
    <h2 id="smap-title">${escapeHtml(t("smap.title"))}</h2>
    <p class="figure-line">${escapeHtml(t(`smap.${level}`, { to: date(d.to, { day: "numeric", month: "long" }) }))}</p>
    <p class="note">${escapeHtml(t("smap.values", { v: Math.round(d.mean_m3m3 * 100), p: d.pct_of_usual ?? "?", n: d.n_values }))}</p>
    <p class="note">${escapeHtml(t("smap.help"))}</p>
    ${sourceBadge(smapTable.source)}
  </section>`);
}
