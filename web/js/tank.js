// Screen 2: one tank — water now vs normal, water history, rainfall onset trend,
// and this season vs normal. Also draws the tank header and the two tabs.
import { t } from "./i18n.js";
import { renderPlan } from "./plan.js";
import { renderCard } from "./card.js";
import { renderWeather } from "./weather.js";
import { renderCrops } from "./crops.js";
import { renderWeek } from "./week.js";
import { startRainAlert } from "./nowcast.js";
import { outlookBlocks, drawOutlook, addSoil, addImerg, addSmap } from "./outlook.js";
import { forecastMarkup, fillForecast } from "./forecast.js";
import { badges, sourceBadge, num, date, monthName, escapeHtml, tankName, area, seasonName } from "./ui.js";

const ONSET_SEASONS_SHOWN = 30;          // ~30 years: readable on a phone

const charts = [];                       // Chart.js objects, destroyed before each redraw

function destroyCharts() {
  while (charts.length) charts.pop().destroy();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------------------
// Header. Three pages per tank, no tab bar:
//   plan  = the advice (opens first)   tank = water and rain charts   card = print / share
// ---------------------------------------------------------------------------
export function renderTank(tank, tab, container, mode = "simple") {
  destroyCharts();
  const doc = tank.doc;
  const backTo = tab === "plan" ? "#/" : `#/tank/${encodeURIComponent(tank.id)}/plan`;
  container.innerHTML = `
    <div class="tank-head">
      <button type="button" class="back" data-back="${backTo}">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
        ${escapeHtml(t(tab === "plan" ? "tank.back" : "tank.back_to_plan"))}
      </button>
      <h1>${escapeHtml(tankName(tank))}</h1>
      <p class="meta">${tank.command_area_ha == null ? "" : escapeHtml(t("tank.fields", { value: area(tank.command_area_ha) })) + " "}${sourceBadge(tank.source)}</p>
      <p class="meta">${doc ? escapeHtml(t("label.updated", { date: date(doc.generated) })) : ""}</p>
      ${tank.demo || doc?.demo ? `<p class="demo-banner">${escapeHtml(t("demo.banner"))}</p>` : ""}
    </div>
    <div id="rain-alert" class="rain-alert" role="alert" hidden></div>
    <div id="tank-panel" class="panel-body"></div>`;

  const panel = container.querySelector("#tank-panel");
  startRainAlert(container.querySelector("#rain-alert"), tank);                // a banner while heavy rain is expected soon (live)
  if (!doc) {
    panel.innerHTML = `<p>${escapeHtml(t("state.no_data"))}</p>`;
    return;
  }
  if (tab === "plan") renderPlan(doc, panel, mode, tank);
  else if (tab === "card") renderCard(tank, panel);
  else if (tab === "weather") renderWeather(tank, doc, panel, mode);
  else if (tab === "crops") renderCrops(tank, doc, panel, mode);
  else if (tab === "week") renderWeek(tank, doc, panel);
  else {
    // Charts page: the 16-day forecast first, then water, rain, heat and dry spells.
    panel.innerHTML = `<section class="block forecast-block"><h2>${escapeHtml(t("forecast.title"))}</h2>`
      + `${forecastMarkup({ withChart: true })}</section>` + waterBlock(doc.water) + rainBlock(doc.rain);
    fillForecast(panel.querySelector(".forecast-block"), tank, doc, { withChart: true });
    drawWaterChart(doc.water, panel);
    drawOnsetChart(doc.rain, panel, "Maha");
    if (doc.rain?.extremes) {
      panel.insertAdjacentHTML("beforeend", extremesBlock(doc.rain));
      drawExtremes(doc.rain, panel, "Yala");
    }
    // Rain by month, greenness from NASA MODIS, and the rain outlook for the coming months.
    panel.insertAdjacentHTML("beforeend", outlookBlocks(doc));
    drawOutlook(panel, doc, (chart) => charts.push(chart));
    addSoil(panel, tank);                                  // NASA GLDAS soil moisture (added when the file loads)
    addImerg(panel, tank, doc);                            // NASA GPM IMERG satellite rain next to POWER
    addSmap(panel, tank);                                  // NASA SMAP satellite soil moisture
  }
}

// ---------------------------------------------------------------------------
// Water: the wewa gauge, the numbers, and the history chart
// ---------------------------------------------------------------------------
// Also used by Learn Mode. `id` keeps the clip path unique if a page shows two gauges.
export function gauge(T, id = "basin-clip") {
  // A cross-section of a tank: the basin between two sloping bunds.
  // The water is drawn up to T (1.0 = normal), capped at 125 % so it stays inside.
  const top = 18, bottom = 104, depth = bottom - top;
  const level = (x) => bottom - depth * Math.min(x, 1.25) / 1.25;
  const waterY = level(T), normalY = level(1);
  const basin = "16,18 304,18 246,104 74,104";
  return `
  <svg class="gauge" viewBox="0 0 320 128" role="img"
       aria-label="${escapeHtml(t("water.percent_of_normal", { value: Math.round(T * 100) }))}">
    <defs><clipPath id="${id}"><polygon points="${basin}"/></clipPath></defs>
    <polygon class="basin" points="${basin}"/>
    <rect class="water" x="0" y="${waterY}" width="320" height="${bottom - waterY}" clip-path="url(#${id})"/>
    <line class="normal" x1="10" x2="310" y1="${normalY}" y2="${normalY}"/>
    <text x="40" y="${normalY - 5}">${escapeHtml(t("water.gauge.normal"))}</text>
    <polyline class="bund" points="${basin.split(" ").concat(basin.split(" ")[0]).join(" ")}"/>
    <text class="pct" x="160" y="${Math.max(waterY + 30, 60)}" text-anchor="middle"
          style="fill:${waterY + 30 > 96 ? "var(--ink)" : "#fff"}">${Math.round(T * 100)}%</text>
  </svg>`;
}

function waterBlock(water) {
  if (!water) {
    return `<section class="block"><h2>${escapeHtml(t("water.title"))}</h2><p>${escapeHtml(t("state.no_data"))}</p></section>`;
  }
  const hasT = water.T !== null && water.T !== undefined;
  const summary = water.normal_extent_ha === null
    ? `<p class="note">${escapeHtml(t("water.no_normal"))}</p>`
    : `<p class="figure">${escapeHtml(t("water.now_vs_normal", {
        now: area(water.current_extent_ha), normal: area(water.normal_extent_ha), month: monthName(water.current_date) }))}</p>`;
  return `
  <section class="block" aria-labelledby="water-title">
    <h2 id="water-title">${escapeHtml(t("water.title"))}</h2>
    ${hasT ? gauge(water.T) : ""}
    ${summary}
    <p class="note">${escapeHtml(t("water.as_of", { date: date(water.current_date) }))}</p>
    ${badges(water.source, water.demo)}
    <h3>${escapeHtml(t("water.history.title"))}</h3>
    <p class="chart-help">${escapeHtml(t("water.history.help"))}</p>
    <div class="chart-box"><canvas id="water-chart" aria-label="${escapeHtml(t("water.history.title"))}" role="img"></canvas></div>
  </section>`;
}

function drawWaterChart(water, panel) {
  const canvas = panel.querySelector("#water-chart");
  if (!water || !canvas) return;
  const series = water.series || [];
  const labels = series.map((s) => date(s.date, { month: "short", year: "numeric" }));
  // The normal is shown as one point at the current month, as given in the data.
  const lastIndex = series.findLastIndex((s) => s.extent_ha !== null && s.extent_ha !== undefined);
  const normalPoints = series.map((_, i) => (i === lastIndex ? water.normal_extent_ha : null));

  charts.push(new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: t("water.history.axis"), data: series.map((s) => s.extent_ha), spanGaps: false,
          borderColor: cssVar("--water"), backgroundColor: cssVar("--water"), pointRadius: 0, borderWidth: 2 },
        { label: t("water.normal"), data: normalPoints, showLine: false,
          pointStyle: "line", pointRadius: 14, pointBorderWidth: 3, borderColor: cssVar("--ink") },
      ],
    },
    options: chartOptions(t("water.history.axis")),
  }));
}

// ---------------------------------------------------------------------------
// Rain: onset trend per season type, and this season vs normal
// ---------------------------------------------------------------------------
function rainBlock(rain) {
  if (!rain) {
    return `<section class="block"><h2>${escapeHtml(t("rain.title"))}</h2><p>${escapeHtml(t("state.no_data"))}</p></section>`;
  }
  return `
  <section class="block" aria-labelledby="rain-title">
    <h2 id="rain-title">${escapeHtml(t("rain.title"))}</h2>
    <h3>${escapeHtml(t("rain.onset.title"))}</h3>
    <p class="chart-help">${escapeHtml(t("rain.onset.help"))}</p>
    <div class="toggle" role="group">
      <button type="button" data-season="Maha" aria-pressed="true">${escapeHtml(t("season.maha"))}</button>
      <button type="button" data-season="Yala" aria-pressed="false">${escapeHtml(t("season.yala"))}</button>
    </div>
    <div class="chart-box"><canvas id="onset-chart" role="img" aria-label="${escapeHtml(t("rain.onset.title"))}"></canvas></div>
    <p class="note" id="onset-note"></p>
    <p class="note">${escapeHtml(t("rain.normal_period", { period: rain.normal_period }))}</p>
    ${currentSeason(rain.current)}
    ${badges(rain.source, rain.demo)}
  </section>`;
}

// ---------------------------------------------------------------------------
// Heat and dry spells (NASA POWER rain and T2M_MAX), per season type
// ---------------------------------------------------------------------------
function extremesBlock(rain) {
  return `
  <section class="block" aria-labelledby="extremes-title">
    <h2 id="extremes-title">${escapeHtml(t("extremes.title"))}</h2>
    <div class="toggle" role="group">
      <button type="button" data-xseason="Yala" aria-pressed="true">${escapeHtml(t("season.yala"))}</button>
      <button type="button" data-xseason="Maha" aria-pressed="false">${escapeHtml(t("season.maha"))}</button>
    </div>
    <h3>${escapeHtml(t("extremes.dry.title"))}</h3>
    <p class="chart-help">${escapeHtml(t("extremes.dry.help"))}</p>
    <p class="figure-line" id="dry-last"></p>
    <div class="chart-box"><canvas id="dry-chart" role="img" aria-label="${escapeHtml(t("extremes.dry.title"))}"></canvas></div>
    ${sourceBadge(rain.source)}
    <h3>${escapeHtml(t("extremes.hot.title"))}</h3>
    <p class="chart-help">${escapeHtml(t("extremes.hot.help"))}</p>
    <p class="figure-line" id="hot-last"></p>
    <div class="chart-box"><canvas id="hot-chart" role="img" aria-label="${escapeHtml(t("extremes.hot.title"))}"></canvas></div>
    ${badges(rain.extremes.temp_source, rain.demo)}
    <p class="note">${escapeHtml(t("rain.normal_period", { period: rain.normal_period }))}</p>
  </section>`;
}

function drawExtremes(rain, panel, kind) {
  const seasons = rain.seasons.filter((s) => s.season.startsWith(kind)).slice(-ONSET_SEASONS_SHOWN);
  const labels = seasons.map((s) => s.season.replace(/^(Yala|Maha) /, ""));
  const normals = rain.extremes.normals[kind] || {};
  const colour = cssVar(kind === "Maha" ? "--monsoon" : "--earth");
  const last = [...seasons].reverse().find((s) => s.longest_dry_spell_days !== null && s.hot_days !== null);

  const draw = (id, field, axis, normal) => {
    const canvas = panel.querySelector(`#${id}`);
    const old = charts.findIndex((c) => c.canvas === canvas);
    if (old >= 0) charts.splice(old, 1)[0].destroy();
    charts.push(new Chart(canvas, {
      data: {
        labels,
        datasets: [
          { type: "bar", label: t(`season.${kind.toLowerCase()}`), data: seasons.map((s) => s[field]),
            backgroundColor: colour, borderRadius: 4 },
          { type: "line", label: t("extremes.normal"), data: seasons.map(() => normal),
            borderColor: cssVar("--ink"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: chartOptions(axis),
    }));
  };
  draw("dry-chart", "longest_dry_spell_days", t("extremes.dry.axis"), normals.longest_dry_spell_days);
  draw("hot-chart", "hot_days", t("extremes.hot.axis", { c: rain.extremes.hot_day_c }), normals.hot_days);

  panel.querySelector("#dry-last").textContent = last ? t("extremes.dry.last",
    { season: seasonName(last.season), value: last.longest_dry_spell_days, normal: num(normals.longest_dry_spell_days, 0) }) : "";
  panel.querySelector("#hot-last").textContent = last ? t("extremes.hot.last",
    { season: seasonName(last.season), value: last.hot_days, normal: num(normals.hot_days, 0) }) : "";

  panel.querySelectorAll("[data-xseason]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.xseason === kind));
    button.onclick = () => drawExtremes(rain, panel, button.dataset.xseason);
  });
}

function currentSeason(current) {
  let body;
  if (!current) {
    body = `<p class="note">${escapeHtml(t("rain.current.none"))}</p>`;
  } else {
    const pct = current.R === null ? null : Math.round(current.R * 100);
    body = `
      <p class="figure"><strong>${pct === null ? escapeHtml(t("state.no_data")) : escapeHtml(t("rain.current.percent_of_normal", { value: pct }))}</strong></p>
      <p>${escapeHtml(t("rain.current.so_far"))}: ${num(current.rain_so_far_mm, 0)} ${escapeHtml(t("unit.mm"))}
         · ${escapeHtml(t("rain.current.normal_so_far"))}: ${num(current.normal_so_far_mm, 0)} ${escapeHtml(t("unit.mm"))}</p>
      <p class="note">${escapeHtml(seasonName(current.season))} · ${escapeHtml(t("rain.current.as_of", { date: date(current.as_of) }))}</p>`;
  }
  return `<h3>${escapeHtml(t("rain.current.title"))}</h3>${body}`;
}

// Straight-line trend (least squares) through the points that have a value.
function trendLine(values) {
  const pts = values.map((y, x) => [x, y]).filter(([, y]) => y !== null && y !== undefined);
  if (pts.length < 3) return values.map(() => null);
  const n = pts.length;
  const mx = pts.reduce((s, [x]) => s + x, 0) / n;
  const my = pts.reduce((s, [, y]) => s + y, 0) / n;
  const slope = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  return values.map((_, x) => my + slope * (x - mx));
}

function drawOnsetChart(rain, panel, kind) {
  if (!rain) return;
  const seasons = rain.seasons.filter((s) => s.season.startsWith(kind)).slice(-ONSET_SEASONS_SHOWN);
  const delays = seasons.map((s) => s.onset_delay_days);
  const colour = cssVar(kind === "Maha" ? "--monsoon" : "--earth");
  const canvas = panel.querySelector("#onset-chart");

  const existing = charts.findIndex((c) => c.canvas === canvas);
  if (existing >= 0) charts.splice(existing, 1)[0].destroy();
  charts.push(new Chart(canvas, {
    data: {
      labels: seasons.map((s) => s.season.replace(/^(Yala|Maha) /, "")),
      datasets: [
        { type: "bar", label: t(`season.${kind.toLowerCase()}`), data: delays, backgroundColor: colour },
        { type: "line", label: t("rain.onset.trend"), data: trendLine(delays),
          borderColor: cssVar("--ink"), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: chartOptions(t("rain.onset.axis")),
  }));

  const missing = delays.filter((d) => d === null).length;
  panel.querySelector("#onset-note").textContent = t("rain.onset.recent", { n: seasons.length }) +
    (missing ? ` ${t("rain.onset.no_onset_count", { count: missing, total: delays.length })}` : "");

  panel.querySelectorAll("[data-season]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.season === kind));
    button.onclick = () => drawOnsetChart(rain, panel, button.dataset.season);
  });
}

function chartOptions(yTitle) {
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
