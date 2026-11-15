// 16-day rain forecast: live when the phone is online, otherwise the copy saved by
// pipeline/forecast.py in the tank's JSON ("forecast" section).
//
// The forecast comes from global weather models (ECMWF, GFS and others) via the free
// Open-Meteo API. It is the weather services' forecast — not NASA data and not a model
// we built — and every place it's shown says so.
import { t } from "./i18n.js";
import { date, num, escapeHtml } from "./ui.js";

const API = "https://api.open-meteo.com/v1/forecast";
const DAYS = 16;
const TIMEOUT_MS = 8000;

let chart = null;

// { days: [{date, rain_mm, rain_chance, tmax_c}], live: bool, issued, rain_day_mm } or null
export async function loadForecast(tank, saved) {
  if (navigator.onLine !== false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = `${API}?latitude=${tank.lat}&longitude=${tank.lon}`
        + "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max"
        + `&forecast_days=${DAYS}&timezone=Asia%2FColombo`;
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const d = (await response.json()).daily;
        const days = d.time.map((day, i) => ({
          date: day, rain_mm: d.precipitation_sum[i],
          rain_chance: d.precipitation_probability_max[i], tmax_c: d.temperature_2m_max[i],
        }));
        return { days, live: true, issued: new Date().toISOString(), rain_day_mm: saved?.rain_day_mm ?? 1.0 };
      }
    } catch { /* offline, slow or blocked: fall back to the saved copy */ }
    finally { clearTimeout(timer); }
  }
  return saved ? { ...saved, live: false } : null;
}

// Same summary as pipeline/forecast.py: rain days, total, wettest day (missing days skipped).
export function summarise(fc) {
  const known = fc.days.filter((d) => d.rain_mm !== null && d.rain_mm !== undefined);
  const rainDays = known.filter((d) => d.rain_mm >= fc.rain_day_mm);
  const wettest = rainDays.reduce((a, b) => (b.rain_mm > (a?.rain_mm ?? -1) ? b : a), null);
  return {
    n: fc.days.length,
    rainDays: rainDays.length,
    total: known.reduce((s, d) => s + d.rain_mm, 0),
    wettest,
  };
}

export function forecastSentence(fc) {
  const s = summarise(fc);
  if (!s.rainDays) return t("forecast.simple.none", { n: s.n });
  return t("forecast.simple.some", {
    n: s.n, days: s.rainDays, mm: num(s.total, 0),
    day: date(s.wettest.date, { day: "numeric", month: "long" }),
  });
}

function statusLine(fc) {
  return fc.live ? t("forecast.status.live") : t("forecast.status.saved", { date: date(fc.issued) });
}

// Fill an element (that already shows "loading") with the forecast.
// withChart: also draw the day-by-day chart (Advanced charts page).
export async function fillForecast(el, tank, doc, { withChart = false } = {}) {
  const fc = await loadForecast(tank, doc.forecast);
  if (!el.isConnected) return;                       // the user already moved to another page
  const sentence = el.querySelector(".fc-sentence");
  const status = el.querySelector(".fc-status");
  if (!fc) {
    sentence.textContent = t("forecast.status.none");
    status.textContent = "";
    return;
  }
  sentence.textContent = forecastSentence(fc);
  status.textContent = statusLine(fc);
  const canvas = el.querySelector(".fc-chart");
  if (withChart && canvas && window.Chart) drawChart(canvas, fc);
}

export function drawChart(canvas, fc) {
  if (chart) chart.destroy();
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  chart = new Chart(canvas, {
    data: {
      labels: fc.days.map((d) => date(d.date, { day: "numeric", month: "short" })),
      datasets: [
        { type: "bar", label: t("forecast.legend.rain"), data: fc.days.map((d) => d.rain_mm),
          backgroundColor: css("--monsoon"), borderRadius: 4, yAxisID: "mm" },
        { type: "line", label: t("forecast.legend.chance"), data: fc.days.map((d) => d.rain_chance),
          borderColor: css("--ink"), borderDash: [5, 4], pointRadius: 2, borderWidth: 2, yAxisID: "pct" },
      ],
    },
    options: {
      maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { boxWidth: 14 } } },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkipPadding: 10 }, grid: { display: false } },
        mm: { position: "left", beginAtZero: true, title: { display: true, text: t("forecast.axis.mm") } },
        pct: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false },
               title: { display: true, text: t("forecast.axis.chance") } },
      },
    },
  });
}

// The markup shared by the Simple card, the Advanced block and the charts page.
export function forecastMarkup({ withChart = false } = {}) {
  return `
    <p class="fc-sentence">${escapeHtml(t("forecast.status.loading"))}</p>
    <p class="fact-small fc-status"></p>
    ${withChart ? `<p class="chart-help">${escapeHtml(t("forecast.help"))}</p>
    <div class="chart-box"><canvas class="fc-chart" role="img" aria-label="${escapeHtml(t("forecast.title"))}"></canvas></div>` : ""}
    <p class="fact-small">${escapeHtml(t("forecast.note"))}</p>
    <p class="badge source">${escapeHtml(t("label.source"))} ${escapeHtml(t("forecast.source"))}</p>`;
}
