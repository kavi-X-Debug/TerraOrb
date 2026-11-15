// The Weather page of one tank — like a weather app, in the same plain language as the rest:
//   1. a big card for the chosen day (starts on today): icon, high temperature, rain
//   2. a strip of the next 16 days with weather icons (tap a day to see it above)
//   3. (Advanced) a day-by-day rain and chance-of-rain chart
//   4. a satellite map of rain and clouds from NASA (what has already happened)
//
// Where the data comes from — shown on the page itself:
//   forecast  = global weather models (ECMWF, GFS, …) via Open-Meteo. NOT NASA data.
//   rain map  = NASA GPM IMERG satellite rain estimate, through NASA GIBS (no login).
//   cloud map = NASA VIIRS satellite picture of yesterday, through NASA GIBS.
import { t } from "./i18n.js";
import { loadForecast, drawChart } from "./forecast.js";
import { loadLive, clock } from "./live.js";
import { rainBlockMarkup, fillRain } from "./nowcast.js";
import { date, weekdayName, localToday, escapeHtml, num } from "./ui.js";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
// Colours of NASA's own rain-rate legend (GPM_Precipitation_Rate_H.svg), light → heavy.
const RAIN_SCALE = ["#00764e", "#009424", "#1eb200", "#7bd100", "#efed00", "#ff980f",
                    "#ff4d2d", "#fa0000", "#b50000", "#710000", "#330000"];

let wxMap = null;                     // the Leaflet map on this page (removed when we leave)
let nowTimer = null;                  // refreshes the "right now" card every 10 minutes
let mapTimer = null;                  // asks for the newest satellite rain picture every 10 minutes

// ---------------------------------------------------------------------------
// Icons: shape AND colour AND a word, so they never rely on colour alone
// ---------------------------------------------------------------------------
const SUN = `<circle cx="24" cy="24" r="9" fill="#E0A100"/><g class="rays" stroke="#E0A100" stroke-width="3.5" stroke-linecap="round"><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.5 10.5l4.2 4.2M33.3 33.3l4.2 4.2M10.5 37.5l4.2-4.2M33.3 14.7l4.2-4.2"/></g>`;
const CLOUD = (fill) => `<path d="M14 32a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1-1 14z" fill="${fill}"/>`;
const ICONS = {
  sunny: SUN,
  partly: `<circle cx="17" cy="16" r="7" fill="#E0A100"/>${CLOUD("#7F93A8").replace('M14 32', 'M14 36')}`,
  light: `${CLOUD("#5B7FB5")}<path class="drops" d="M17 37l-2 6M25 37l-2 6M33 37l-2 6" stroke="#2F5D9E" stroke-width="3" stroke-linecap="round"/>`,
  moderate: `${CLOUD("#3F5F93")}<path class="drops" d="M15 36l-3 8M22 36l-3 8M29 36l-3 8M36 36l-3 8" stroke="#1F4A8A" stroke-width="3.2" stroke-linecap="round"/>`,
  heavy: `${CLOUD("#2B3F66")}<path class="drops fast" d="M13 36l-3 9M19 36l-3 9M25 36l-3 9M31 36l-3 9M37 36l-3 9" stroke="#13306B" stroke-width="3.6" stroke-linecap="round"/>`,
  cloudy: CLOUD("#8795A6").replace('M14 32', 'M14 36'),
  clear: `<path d="M31 8a16 16 0 1 0 9 28 13 13 0 0 1-9-28z" fill="#E7C75A"/>`,
  storm: `${CLOUD("#2B3F66")}<path class="bolt" d="M26 28l-6 9h6l-4 8" fill="none" stroke="#F2C200" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  none: `<circle cx="24" cy="24" r="14" fill="#5F6B6A"/><path d="M19 19a5 5 0 1 1 7 4.5c-1.3.7-2 1.6-2 3v1" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="33" r="2" fill="#fff"/>`,
};

// Which icon a forecast day gets, from the forecast's own rain amount and chance.
export function sky(day) {
  if (!day || day.rain_mm === null || day.rain_mm === undefined) return "none";
  // Daily rain classes of the India Meteorological Department (widely used in South Asia):
  // light 1–15.5 mm, moderate 15.6–64.4 mm, heavy 64.5 mm and more. Not an official Sri Lanka definition.
  if (day.rain_mm >= 64.5) return "heavy";
  if (day.rain_mm >= 15.6) return "moderate";
  if (day.rain_mm >= 1) return "light";
  return (day.rain_chance ?? 0) >= 50 ? "partly" : "sunny";
}

export const icon = (kind, size = 48) =>
  `<svg class="wx-icon" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${ICONS[kind]}</svg>`;

// The same icons for LIVE conditions, from the standard WMO weather code Open-Meteo reports.
export function skyFromCode(code, isDay = true) {
  if (code === 0 || code === 1) return isDay ? "sunny" : "clear";
  if (code === 2) return isDay ? "partly" : "cloudy";
  if ([95, 96, 99].includes(code)) return "storm";
  if ([65, 67, 82].includes(code)) return "heavy";
  if ([63, 66, 81].includes(code)) return "moderate";
  if ([51, 53, 55, 56, 57, 61, 80].includes(code)) return "light";
  if (code === null || code === undefined) return "none";
  return "cloudy";                                   // overcast, fog and anything else
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function renderWeather(tank, doc, panel, mode) {
  if (wxMap) { wxMap.remove(); wxMap = null; }
  clearInterval(mapTimer);
  const advanced = mode === "advanced";
  panel.innerHTML = `
    <section class="wx-now" id="wx-now" aria-live="polite"></section>
    <section class="wx-today" id="wx-today" aria-live="polite"></section>

    ${rainBlockMarkup()}

    <section class="block" aria-labelledby="wx-next-title">
      <h2 id="wx-next-title">${escapeHtml(t("weather.next"))}</h2>
      <p class="fact-small">${escapeHtml(t("weather.tap"))}</p>
      <div class="wx-strip" id="wx-strip" role="list"></div>
      <p class="fact-small fc-status" id="wx-status"></p>
      <p class="fact-small">${escapeHtml(t("forecast.note"))}</p>
      <p class="badge source">${escapeHtml(t("label.source"))} ${escapeHtml(t("forecast.source"))}</p>
      ${advanced ? `<p class="chart-help">${escapeHtml(t("forecast.help"))}</p>
      <div class="chart-box"><canvas id="wx-chart" role="img" aria-label="${escapeHtml(t("forecast.title"))}"></canvas></div>` : ""}
    </section>

    <section class="block" aria-labelledby="wx-map-title">
      <h2 id="wx-map-title">${escapeHtml(t("weather.map.title"))}</h2>
      <div class="toggle" role="group">
        <button type="button" data-layer="rain" aria-pressed="true">${escapeHtml(t("weather.map.rain"))}</button>
        <button type="button" data-layer="clouds" aria-pressed="false">${escapeHtml(t("weather.map.clouds"))}</button>
      </div>
      <div id="wx-map" class="wx-map" role="img" aria-label="${escapeHtml(t("weather.map.title"))}"></div>
      <div id="wx-legend"></div>
      <p class="fact-small" id="wx-map-note"></p>
      <p class="fact-small" id="wx-map-offline" hidden>${escapeHtml(t("weather.map.offline"))}</p>
      <p class="badge source">${escapeHtml(t("label.source"))} NASA GPM IMERG, NASA VIIRS (NASA GIBS)</p>
      <p class="fact-small">${escapeHtml(t("weather.note.nasa"))}</p>
    </section>`;

  startMap(panel, tank, advanced);
  fillRain(panel.querySelector(".rain-block"), tank, { advanced });
  loadDays(tank, doc, panel, advanced);
  startNow(panel.querySelector("#wx-now"), tank, advanced);
}

// ---------------------------------------------------------------------------
// "Right now": live conditions at the tank, refreshed every 10 minutes while the page is open
// ---------------------------------------------------------------------------
async function startNow(el, tank, advanced) {
  clearInterval(nowTimer);
  const draw = async (force) => {
    if (!el.isConnected) { clearInterval(nowTimer); return; }       // the user left this page
    const live = (await loadLive([tank], { force })).get(tank.id);
    if (!el.isConnected) return;
    el.innerHTML = live ? nowCard(live, advanced) : `<p class="fact-small">${escapeHtml(t("live.offline"))}</p>`;
  };
  el.innerHTML = `<p class="fact-small">${escapeHtml(t("forecast.status.loading"))}</p>`;
  await draw(false);
  nowTimer = setInterval(() => draw(true), 10 * 60 * 1000);
}

function nowCard(live, advanced) {
  const kind = skyFromCode(live.code, live.day);
  const rain = live.rain_mm > 0 ? t("live.rain_hour", { value: num(live.rain_mm, 1) }) : t("live.dry");
  const extra = advanced ? `<p class="fact-small">${escapeHtml([
    t("live.humidity", { value: Math.round(live.humidity) }),
    t("live.wind", { value: Math.round(live.wind_kmh) }),
    t("live.cloud", { value: Math.round(live.cloud) }),
  ].join(" · "))}</p>` : "";
  return `
    <p class="wx-now-title">${escapeHtml(t("live.now"))}</p>
    <div class="wx-big">
      ${icon(kind, 64)}
      <div class="wx-big-text">
        <p class="wx-temp wx-temp-now">${Math.round(live.temp)}°C</p>
        <p class="wx-sky">${escapeHtml(t(`weather.sky.${kind}`))}</p>
      </div>
    </div>
    <p class="wx-line">${escapeHtml(rain)}</p>
    ${extra}
    <p class="fact-small">${escapeHtml(t("live.updated", { time: clock(live.time) }))}</p>
    <p class="fact-small">${escapeHtml(t("live.source"))}</p>`;
}

async function loadDays(tank, doc, panel, advanced) {
  const today = panel.querySelector("#wx-today");
  today.innerHTML = `<p class="fc-sentence">${escapeHtml(t("forecast.status.loading"))}</p>`;
  const fc = await loadForecast(tank, doc.forecast);
  if (!today.isConnected) return;                              // the user already left this page

  // A saved copy may start on an earlier date: keep only today and later.
  const days = (fc?.days || []).filter((d) => d.date >= localToday());
  if (!fc || !days.length) {
    today.innerHTML = `<p class="fc-sentence">${escapeHtml(fc ? t("weather.stale") : t("forecast.status.none"))}</p>`;
    return;
  }
  panel.querySelector("#wx-status").textContent = fc.live
    ? t("forecast.status.live") : t("forecast.status.saved", { date: date(fc.issued) });

  const strip = panel.querySelector("#wx-strip");
  strip.innerHTML = days.map((d, i) => `
    <button type="button" class="wx-day" role="listitem" data-i="${i}" aria-pressed="${i === 0}"
            aria-label="${escapeHtml(dayLabel(d, i))}">
      <span class="wx-wd">${escapeHtml(i === 0 ? t("weather.today") : weekdayName(d.date, true))}</span>
      <span class="wx-dn">${+d.date.slice(8, 10)}</span>
      ${icon(sky(d), 40)}
      <strong>${d.tmax_c == null ? "–" : Math.round(d.tmax_c) + "°"}</strong>
      <span class="wx-mm">${d.rain_mm != null && d.rain_mm >= 1 ? num(d.rain_mm, 0) + " " + t("unit.mm") : "–"}</span>
    </button>`).join("");

  const show = (i) => {
    strip.querySelectorAll(".wx-day").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
    today.innerHTML = bigCard(days[i], i);
  };
  strip.addEventListener("click", (e) => {
    const b = e.target.closest(".wx-day");
    if (b) show(+b.dataset.i);
  });
  show(0);

  const canvas = panel.querySelector("#wx-chart");
  if (advanced && canvas && window.Chart) drawChart(canvas, { ...fc, days });
}

function dayLabel(d, i) {
  const rain = d.rain_mm != null && d.rain_mm >= 1 ? ` ${t("weather.mm", { value: num(d.rain_mm, 0) })}` : "";
  return `${i === 0 ? t("weather.today") : weekdayName(d.date)} ${date(d.date, { day: "numeric", month: "long" })}: `
    + `${t(`weather.sky.${sky(d)}`)}${rain}`;
}

function bigCard(d, i) {
  const kind = sky(d);
  const rainLine = d.rain_mm != null && d.rain_mm >= 1
    ? t("weather.mm", { value: num(d.rain_mm, 0) }) : t("weather.no_rain");
  return `
    <div class="wx-big">
      ${icon(kind, 88)}
      <div class="wx-big-text">
        <p class="wx-when">${escapeHtml(i === 0 ? t("weather.today") : weekdayName(d.date))}
          · ${escapeHtml(date(d.date, { day: "numeric", month: "long" }))}</p>
        <p class="wx-temp">${d.tmax_c == null ? "–" : Math.round(d.tmax_c) + "°C"}</p>
        <p class="wx-sky">${escapeHtml(t(`weather.sky.${kind}`))}</p>
      </div>
    </div>
    <p class="wx-line">${escapeHtml(rainLine)}${d.rain_chance != null ? " · " + escapeHtml(t("weather.chance", { value: d.rain_chance })) : ""}</p>
    ${d.tmax_c == null ? "" : `<p class="fact-small">${escapeHtml(t("weather.high", { value: Math.round(d.tmax_c) }))}</p>`}`;
}

// ---------------------------------------------------------------------------
// NASA satellite map (Leaflet + NASA GIBS tiles)
// ---------------------------------------------------------------------------
function yesterdayUtc() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);       // yesterday's picture is complete; today's isn't yet
  return d.toISOString().slice(0, 10);
}

function startMap(panel, tank, advanced) {
  const el = panel.querySelector("#wx-map");
  if (!window.L) { panel.querySelector("#wx-map-offline").hidden = false; return; }

  wxMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, maxZoom: 9, minZoom: 4 })
    .setView([tank.lat, tank.lon], 7);
  L.circleMarker([tank.lat, tank.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#16302E", fillOpacity: 1 })
    .bindTooltip(escapeHtml(t("weather.map.you")), { permanent: false }).addTo(wxMap);

  const base = L.tileLayer(`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    { maxNativeZoom: 8, attribution: "NASA GIBS" });
  const rain = L.tileLayer(`${GIBS}/IMERG_Precipitation_Rate/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    { maxNativeZoom: 6, opacity: 0.8, attribution: "NASA GPM IMERG" });
  const clouds = L.tileLayer(`${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterdayUtc()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    { maxNativeZoom: 9, attribution: "NASA VIIRS" });

  // Tell the person if the satellite pictures can't load (no internet).
  let loaded = false;
  const offline = panel.querySelector("#wx-map-offline");
  [base, rain, clouds].forEach((layer) => {
    layer.on("tileload", () => { loaded = true; offline.hidden = true; });
    layer.on("tileerror", () => { if (!loaded) offline.hidden = false; });
  });

  // NASA adds a new rain picture about every 30 minutes (a few hours after the rain fell): ask again every 10 minutes
  mapTimer = setInterval(() => {
    if (!wxMap || !el.isConnected) { clearInterval(mapTimer); return; }
    rain.setUrl(`${GIBS}/IMERG_Precipitation_Rate/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png?t=${Date.now()}`);
  }, 10 * 60 * 1000);

  const note = panel.querySelector("#wx-map-note");
  const legend = panel.querySelector("#wx-legend");
  const choose = (which) => {
    [base, rain, clouds].forEach((l) => wxMap.removeLayer(l));
    if (which === "rain") {
      base.addTo(wxMap); rain.addTo(wxMap);
      note.textContent = t("weather.map.rain_note");
      legend.innerHTML = rainLegend(advanced);
    } else {
      clouds.addTo(wxMap);
      note.textContent = t("weather.map.clouds_note");
      legend.innerHTML = "";
    }
    panel.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === which)));
  };
  panel.querySelectorAll("[data-layer]").forEach((b) => { b.onclick = () => choose(b.dataset.layer); });
  choose("rain");
  setTimeout(() => wxMap && wxMap.invalidateSize(), 150);
}

// NASA's legend, redrawn small: a colour bar from light to heavy rain (mm per hour).
function rainLegend(advanced) {
  const bar = `linear-gradient(90deg, ${RAIN_SCALE.join(", ")})`;
  const ticks = advanced
    ? `<span class="wx-ticks"><span style="left:0">0.1</span><span style="left:36.7%">1</span><span style="left:73.4%">10</span><span style="left:100%">50+</span></span>`
    : "";
  return `
    <div class="wx-legend">
      <div class="wx-bar" style="background:${bar}" role="img" aria-label="${escapeHtml(t("weather.map.unit"))}"></div>
      ${ticks}
      <div class="wx-legend-labels"><span>${escapeHtml(t("weather.map.light"))}</span>
        <span>${advanced ? escapeHtml(t("weather.map.unit")) : ""}</span>
        <span>${escapeHtml(t("weather.map.heavy"))}</span></div>
    </div>`;
}
