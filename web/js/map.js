// Screen 1: Leaflet map with a NASA GIBS satellite base layer and one marker per tank.
import { t } from "./i18n.js";
import { signalOf } from "./data.js";
import { signalIcon, signalKey, tankName, escapeHtml, levelWord } from "./ui.js";
import { icon as weatherIcon, skyFromCode } from "./weather.js";

// NASA GIBS true-colour image of a clear dry-season day over Sri Lanka.
// GIBS serves this product up to zoom 9 (250 m pixels); Leaflet enlarges it beyond that.
const GIBS_PRODUCT = "MODIS_Terra_CorrectedReflectance_TrueColor";
const GIBS_DATE = "2024-08-15";

let map = null;
let markerLayer = null;
let layerControl = null;

export function initMap() {
  map = L.map("map", { zoomControl: true, maxZoom: 16 }).setView([8.3, 80.45], 10);
  markerLayer = L.layerGroup().addTo(map);
  // Tank names and outlines come from OpenStreetMap (ODbL licence: credit must be visible).
  map.attributionControl.addAttribution("Tanks &copy; OpenStreetMap contributors");
}

function baseLayers() {
  const satellite = L.tileLayer(
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_PRODUCT}/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    { maxNativeZoom: 9, maxZoom: 16, attribution: `NASA GIBS, MODIS Terra, ${GIBS_DATE}` });
  const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
  return { satellite, streets };
}

// Draw (or redraw, e.g. after a language change) the markers, layer switch and legend.
export function renderMap(state, onSelect) {
  // Base layers: rebuilt so their names follow the current language.
  if (layerControl) map.removeControl(layerControl);
  map.eachLayer((layer) => { if (layer instanceof L.TileLayer) map.removeLayer(layer); });
  const { satellite, streets } = baseLayers();
  satellite.addTo(map);
  layerControl = L.control.layers({ [t("map.layer.satellite")]: satellite, [t("map.layer.streets")]: streets })
    .addTo(map);

  markerLayer.clearLayers();
  const points = [];
  for (const tank of state.tanks) {
    const signal = signalOf(tank);
    const name = tankName(tank);
    const marker = L.marker([tank.lat, tank.lon], {
      icon: L.divIcon({ className: "tank-marker", html: signalIcon(signal), iconSize: [34, 34], iconAnchor: [17, 17] }),
      title: name,
      alt: `${name}: ${t(`signal.short.${signalKey(signal)}`)}`,
      keyboard: true,
    });
    // With many tanks, always-on labels would cover each other: show the name on touch instead.
    const fewTanks = state.tanks.length <= 15;
    marker.bindTooltip(escapeHtml(name), { permanent: fewTanks, direction: "right", offset: [16, 0], className: "tank-label" });
    marker.on("click keypress", () => onSelect(tank.id));
    marker.addTo(markerLayer);
    points.push([tank.lat, tank.lon]);
  }
  if (points.length && !state.mapFitted) {
    // Zoom 11 at most: GIBS imagery is 250 m per pixel, so closer views just look blurred.
    map.fitBounds(points, { padding: [50, 50], maxZoom: 11 });
    state.mapFitted = true;
  }

  renderTankList(state);

  // Legend: colour + icon + word for every signal.
  document.getElementById("map-legend").innerHTML =
    `<span class="legend-title">${escapeHtml(t("map.legend"))}</span>` +
    ["green", "amber", "red", "none"].map((s) =>
      `<span class="legend-item">${signalIcon(s === "none" ? null : s)}${escapeHtml(t(`signal.short.${s}`))}</span>`).join("");
}

// ---------------------------------------------------------------------------
// The tank cards ("Find my tank"): filtered by state.query, nearest first if
// state.userPos is known.
// ---------------------------------------------------------------------------
function distanceKm(a, b) {
  // Great-circle distance (haversine), good enough for "how far is my tank".
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// A small live-weather chip on each tank card: weather icon and temperature right now.
function liveChip(live) {
  if (!live) return "";
  const kind = skyFromCode(live.code, live.day);
  const label = t("live.chip", { sky: t(`weather.sky.${kind}`), temp: Math.round(live.temp) });
  return `<span class="wx-chip" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">`
    + `${weatherIcon(kind, 30)}<strong>${Math.round(live.temp)}°</strong></span>`;
}

export function renderTankList(state) {
  const q = (state.query || "").trim().toLowerCase();
  let tanks = state.tanks.filter((tank) => !q || [tank.name_si, tank.name_en, tank.id]
    .some((name) => (name || "").toLowerCase().includes(q)));
  if (state.userPos) {
    tanks = tanks.map((tank) => ({ tank, km: distanceKm(state.userPos, tank) }))
      .sort((a, b) => a.km - b.km).map(({ tank, km }) => Object.assign(tank, { km }));
  }

  const list = document.getElementById("tank-list");
  if (!tanks.length) {
    list.innerHTML = `<li class="empty">${escapeHtml(t("map.search.none"))}</li>`;
    return;
  }
  list.innerHTML = tanks.map((tank) => {
    const signal = signalOf(tank);
    const T = tank.doc?.water?.T;
    // Simple view: words ("less than usual"); Advanced view: the exact percentage.
    const water = T === null || T === undefined ? t("tanklist.no_data")
      : state.mode === "advanced" ? t("tanklist.water_pct", { value: Math.round(T * 100) })
      : t("tanklist.water", { level: levelWord(T).toLowerCase() });
    const away = state.userPos ? ` · ${t("tanklist.distance", { value: tank.km.toFixed(1) })}` : "";
    return `
      <li>
        <a class="tank-row ${signalKey(signal)}" href="#/tank/${encodeURIComponent(tank.id)}/plan">
          ${signalIcon(signal)}
          <span class="tank-row-text">
            <strong>${escapeHtml(tankName(tank))}</strong>
            <span>${escapeHtml(signal ? `${t(`signal.short.${signalKey(signal)}`)} · ${water}` : t("tanklist.none_row"))}${escapeHtml(away)}</span>
          </span>
          <span class="tank-row-end">${liveChip(state.live?.get(tank.id))}
            <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></span>
        </a>
      </li>`;
  }).join("");
}

// A small "you are here" dot on the map.
let userMarker = null;
export function showUser(pos) {
  if (!map) return;
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.circleMarker([pos.lat, pos.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#2F5D9E", fillOpacity: 1 })
    .addTo(map);
}

// Leaflet needs to re-measure the map after the layout changes (e.g. side panel opens).
export function refreshMapSize() {
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

export function focusTank(tank) {
  if (map) map.panTo([tank.lat, tank.lon]);
}
