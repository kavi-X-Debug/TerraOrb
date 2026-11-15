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
