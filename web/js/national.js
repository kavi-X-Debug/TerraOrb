// Country-level NASA cards for the officer dashboard and the research page: fires (NASA FIRMS), groundwater (NASA GRACE-FO) and a map with
// NASA flood and cloud layers. Data files: data/national/fires.json and grace.json (made by pipeline/national_nasa.py).
// A missing file shows a plain "not available" line, never a guess. Fire points are real satellite detections; "none" is a real answer.
import { t } from "./i18n.js";
import { sourceBadge, date, escapeHtml } from "./ui.js";
import { addNasaLayers } from "./nasa-layers.js";

async function load(name) {
  try { const r = await fetch(`../data/national/${name}.json`, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}

const short = (iso) => date(iso, { day: "numeric", month: "short" });

function firesCard(f) {
  if (!f) return `<section class="block"><h2>${escapeHtml(t("nat.fires.title"))}</h2><p>${escapeHtml(t("nat.na"))}</p></section>`;
  const span = { from: short(f.window.from), to: short(f.window.to) };
  const rows = f.items.slice(0, 8).map((x) => `<tr><td>${escapeHtml(x.date)}</td><td>${x.lat.toFixed(2)}, ${x.lon.toFixed(2)}</td><td>${x.frp_mw}</td><td>${x.confidence}%</td></tr>`).join("");
  return `<section class="block" aria-labelledby="nat-fires"><h2 id="nat-fires">${escapeHtml(t("nat.fires.title"))}</h2>
    <p class="figure-line">${escapeHtml(f.count ? t("nat.fires.some", { n: f.count, ...span }) : t("nat.fires.none", span))}</p>
    ${f.count ? `<div class="of-scroll"><table class="crop-table"><thead><tr><th scope="col">${escapeHtml(t("nat.col.date"))}</th><th scope="col">${escapeHtml(t("nat.col.where"))}</th><th scope="col">${escapeHtml(t("nat.col.power"))}</th><th scope="col">${escapeHtml(t("nat.col.conf"))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
    <p class="note">${escapeHtml(t("nat.fires.note"))}</p>${sourceBadge(f.source)}</section>`;
}

function graceCard(g) {
  if (!g) return `<section class="block"><h2>${escapeHtml(t("nat.grace.title"))}</h2><p>${escapeHtml(t("nat.na"))}</p></section>`;
  const l = g.latest, diff = l.same_month_mean_2018_on_cm == null ? null : l.lwe_cm - l.same_month_mean_2018_on_cm;
  const level = diff == null ? "none" : diff >= 2 ? "more" : diff <= -2 ? "less" : "same";
  const month = date(`${l.month}-01`, { month: "long", year: "numeric" });
  const rows = g.series.slice(-8).map(([m, v]) => `<tr><th scope="row">${escapeHtml(date(`${m}-01`, { month: "short", year: "numeric" }))}</th><td>${v.toFixed(1)}</td></tr>`).join("");
  return `<section class="block" aria-labelledby="nat-grace"><h2 id="nat-grace">${escapeHtml(t("nat.grace.title"))}</h2>
    ${level === "none" ? "" : `<p class="figure-line">${escapeHtml(t(`nat.grace.${level}`, { month, d: Math.abs(diff).toFixed(1) }))}</p>`}
    <p class="note">${escapeHtml(t("nat.grace.help"))}</p>
    <div class="of-scroll"><table class="crop-table"><thead><tr><th scope="col">${escapeHtml(t("nat.col.month"))}</th><th scope="col">${escapeHtml(t("nat.grace.col"))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">${escapeHtml(t("nat.grace.limits"))}</p>${sourceBadge(g.source)}</section>`;
}

/** Append the country-level NASA cards (and the map) to `container`. */
export async function mountNational(container) {
  const [fires, grace] = await Promise.all([load("fires"), load("grace")]);
  if (!container.isConnected) return;
  const wrap = document.createElement("div");
  wrap.className = "nat-wrap";
  wrap.innerHTML = `<h2 class="nat-h">${escapeHtml(t("nat.heading"))}</h2>${firesCard(fires)}${graceCard(grace)}
    <section class="block" aria-labelledby="nat-map"><h2 id="nat-map">${escapeHtml(t("nat.map.title"))}</h2><p class="chart-help">${escapeHtml(t("nat.map.help"))}</p>
    <div id="nat-map-el" class="nat-map" role="region" aria-label="${escapeHtml(t("nat.map.title"))}"></div></section>`;
  container.append(wrap);
  const el = wrap.querySelector("#nat-map-el");
  if (!window.L) { el.hidden = true; return; }
  const map = L.map(el, { scrollWheelZoom: false, minZoom: 6, maxZoom: 12 }).setView([7.8, 80.7], 7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  addNasaLayers(L, map, t);
  for (const x of (fires && fires.items) || []) {
    L.circleMarker([x.lat, x.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#e5484d", fillOpacity: 0.95 }).bindTooltip(`${x.date} - ${x.frp_mw} MW`).addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 80);
}
