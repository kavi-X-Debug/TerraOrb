// The trip and event planner (planner end, #/plan): "Will it rain where I am going, and which day is best?"
//
//   1. pick a place: a list of well-known places and the village tanks, "near me", or tap anywhere on the map
//   2. pick a day (the next 16 days, each marked Dry / Maybe / Wet for your hours) and the hours of your trip or event
//   3. see the verdict in plain words, rain hour by hour, the best time and the three best days, and the usual
//      rain and heat of that month at that place (NASA POWER, 2001-2025)
//
// Where the numbers come from: the forecast is from global weather models through Open-Meteo (NOT NASA data, not radar,
// and less certain after the first week); the "usual" month is NASA POWER climatology (data/climatology.json).
// The address holds the choice (#/plan/<lat>,<lon>/<date>/<from>-<to>), so a plan can be shared as a link.
import { t, getLang } from "./i18n.js";
import { escapeHtml, num, date, weekdayName, localToday, monthName } from "./ui.js";
import { icon, sky } from "./weather.js";
import { loadPlaces, loadClimatology } from "./data.js";
import { KINDS, kindOf, extrasFor, clock, bringList, icsFile, betterOf } from "./planner-extras.js";

const API = "https://api.open-meteo.com/v1/forecast";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const DEFAULT_FROM = 9, DEFAULT_TO = 17;          // the default hours of a trip or event
const REFRESH_MS = 10 * 60 * 1000;

// Verdict thresholds for the chosen hours (DRAFT: simple rules of thumb, not an official standard).
const WET_MM = 3, WET_CHANCE = 70, MAYBE_MM = 0.5, MAYBE_CHANCE = 35;

let plMap = null, plMarker = null, refreshTimer = null;
let place_options = "";
const cache = new Map();                           // "lat,lon" -> { at, data }

// ---------------------------------------------------------------------------
// Pure functions (tested without the page)
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");

// Rain per hour inside the chosen hours. Open-Meteo's hourly rain at 15:00 is the hour 14:00-15:00, so the hours from
// `from` to `to` are the entries stamped from+1 to `to`.
export function windowHours(forecast, day, from, to) {
  const out = [];
  for (let h = from + 1; h <= to; h++) {
    const i = forecast.index.get(`${day}T${pad(h)}:00`);
    if (i !== undefined) out.push({ h, mm: forecast.mm[i], chance: forecast.chance[i], temp: forecast.temp[i] });
  }
  return out;
}

// Dry / maybe / wet for a list of hours. Missing numbers are skipped, never guessed; no numbers at all gives null.
export function verdictOf(hours) {
  const known = hours.filter((x) => x.mm !== null && x.mm !== undefined);
  if (!known.length) return null;
  const mm = Math.round(known.reduce((a, x) => a + x.mm, 0) * 10) / 10;
  const chance = Math.max(0, ...known.map((x) => x.chance ?? 0));
  const cls = mm >= WET_MM || chance >= WET_CHANCE ? "wet" : mm >= MAYBE_MM || chance >= MAYBE_CHANCE ? "maybe" : "dry";
  return { cls, mm, chance, hottest: Math.max(...known.map((x) => x.temp ?? -99)) };
}

// The driest stretch of `len` hours between 6:00 and 22:00 (least rain, then least chance), or null.
export function bestWindow(forecast, day, len = 3) {
  let best = null;
  for (let from = 6; from + len <= 22; from++) {
    const v = verdictOf(windowHours(forecast, day, from, from + len));
    if (!v) continue;
    const score = v.mm * 100 + v.chance;
    if (!best || score < best.score) best = { from, to: from + len, score, ...v };
  }
  return best;
}

// Parse an Open-Meteo answer into daily rows and an hourly lookup.
export function parseForecast(d) {
  const index = new Map(d.hourly.time.map((time, i) => [time, i]));
  const days = d.daily.time.map((day, i) => ({
    date: day, rain_mm: d.daily.precipitation_sum[i], rain_chance: d.daily.precipitation_probability_max[i], tmax_c: d.daily.temperature_2m_max[i],
    sunrise: d.daily.sunrise?.[i] ?? null, sunset: d.daily.sunset?.[i] ?? null }));
  return { days, index, mm: d.hourly.precipitation, chance: d.hourly.precipitation_probability, temp: d.hourly.temperature_2m,
    gust: d.hourly.wind_gusts_10m, uv: d.hourly.uv_index, feels: d.hourly.apparent_temperature };
}

// Key of the NASA POWER square a point is in (the squares are 0.5 deg tall and 0.625 deg wide, as in pipeline/rain.py).
const fmt = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
export function climateFor(clim, lat, lon, month) {
  if (!clim?.cells) return null;
  const la = Math.round(lat / clim.grid.lat_step) * clim.grid.lat_step, lo = Math.round(lon / clim.grid.lon_step) * clim.grid.lon_step;
  const cell = clim.cells[`${fmt(Math.round(la * 1e4) / 1e4)}_${fmt(Math.round(lo * 1e4) / 1e4)}`];
  if (!cell) return null;
  const year = new Date().getFullYear();
  const monthly = cell.rain_mm_day.map((v, i) => Math.round(v * new Date(year, i + 1, 0).getDate()));
  return { monthly, tmax: cell.tmax_c, rain: monthly[month - 1], hot: cell.tmax_c[month - 1] };
}

// ---------------------------------------------------------------------------
// The address: #/plan/<lat>,<lon>/<date>/<from>-<to>
// ---------------------------------------------------------------------------
export function parseParts(parts) {
  const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(parts[0] || "");
  const pick = m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "") ? parts[1] : null;
  const w = /^(\d{1,2})-(\d{1,2})$/.exec(parts[2] || "");
  let from = w ? Number(w[1]) : DEFAULT_FROM, to = w ? Number(w[2]) : DEFAULT_TO;
  if (!(from >= 0 && to <= 23 && to > from)) { from = DEFAULT_FROM; to = DEFAULT_TO; }
  return { pick, day, from, to, kind: kindOf(parts[3]), hoursGiven: Boolean(w) };
}
const addressOf = (c) => `#/plan/${c.lat.toFixed(3)},${c.lon.toFixed(3)}/${c.day}/${c.from}-${c.to}${c.kind && c.kind !== "general" ? "/" + c.kind : ""}`;

// ---------------------------------------------------------------------------
// Loading the forecast for any point
// ---------------------------------------------------------------------------
async function loadForecastAt(lat, lon, force = false) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < REFRESH_MS) return hit.data;
  if (navigator.onLine === false) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `${API}?latitude=${lat}&longitude=${lon}&timezone=Asia%2FColombo&forecast_days=16`
      + "&hourly=precipitation,precipitation_probability,temperature_2m,wind_gusts_10m,uv_index,apparent_temperature"
      + "&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,sunrise,sunset";
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = parseForecast(await response.json());
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
const tag = (cls) => t(`pl.tag.${cls}`);
const hr = (h) => `${pad(h)}:00`;
const placeName = (p) => (getLang() === "si" && p.name_si ? p.name_si : p.name_en);

export async function renderPlanner(state, parts, view) {
  clearInterval(refreshTimer);
  if (plMap) { plMap.remove(); plMap = null; plMarker = null; }
  const [places, clim] = await Promise.all([loadPlaces(), loadClimatology()]);

  const want = parseParts(parts);
  const cur = { lat: want.pick?.lat ?? null, lon: want.pick?.lon ?? null, day: want.day || localToday(), from: want.from, to: want.to, kind: want.kind, name: "", other: null };
  const named = (lat, lon) => {
    const near = (places?.places || []).find((p) => Math.abs(p.lat - lat) < 0.02 && Math.abs(p.lon - lon) < 0.02);
    return near ? placeName(near) : (state.tanks.find((x) => Math.abs(x.lat - lat) < 0.002 && Math.abs(x.lon - lon) < 0.002)?.name_en) || t("pl.point");
  };
  if (cur.lat !== null) cur.name = named(cur.lat, cur.lon);

  const placeOptions = (places?.places || []).map((p) => `<option value="p:${escapeHtml(p.id)}">${escapeHtml(placeName(p))}</option>`).join("");
  const tankOptions = state.tanks.map((x) => `<option value="t:${escapeHtml(x.id)}">${escapeHtml(getLang() === "si" && x.name_si ? x.name_si : x.name_en)}</option>`).join("");

  place_options = `<optgroup label="${escapeHtml(t("pl.group.places"))}">${placeOptions}</optgroup><optgroup label="${escapeHtml(t("pl.group.tanks"))}">${tankOptions}</optgroup>`;

  view.innerHTML = `
    <div class="tank-head learn-head">
      <h1>${escapeHtml(t("pl.title"))}</h1>
      <p class="meta">${escapeHtml(t("pl.sub"))}</p>
    </div>
    <div class="panel-body pl-page">
      <section class="block pl-where" aria-labelledby="pl-where-title">
        <h2 id="pl-where-title">${escapeHtml(t("pl.where"))}</h2>
        <div class="pl-pick">
          <label class="pl-select">${escapeHtml(t("pl.choose"))}
            <select id="pl-place"><option value="">${escapeHtml(t("pl.choose_ph"))}</option>
              <optgroup label="${escapeHtml(t("pl.group.places"))}">${placeOptions}</optgroup>
              <optgroup label="${escapeHtml(t("pl.group.tanks"))}">${tankOptions}</optgroup>
            </select>
          </label>
          <button type="button" class="near-me" id="pl-near"><span>${escapeHtml(t("map.my_location"))}</span></button>
        </div>
        <p class="fact-small" id="pl-status" role="status">${escapeHtml(t("pl.map_hint"))}</p>
        <div id="pl-map" class="pl-map" role="application" aria-label="${escapeHtml(t("pl.map_label"))}"></div>
      </section>
      <div id="pl-results" aria-live="polite"></div>
    </div>`;

  const results = view.querySelector("#pl-results"), status = view.querySelector("#pl-status"), select = view.querySelector("#pl-place");
  startMap(view, cur, (lat, lon, name) => choose(lat, lon, name));

  function choose(lat, lon, name) {
    cur.lat = lat; cur.lon = lon; cur.name = name || named(lat, lon);
    if (plMap) { plMarker ? plMarker.setLatLng([lat, lon]) : (plMarker = L.marker([lat, lon]).addTo(plMap)); plMap.setView([lat, lon], Math.max(plMap.getZoom(), 8)); }
    status.textContent = t("pl.chosen", { name: cur.name, lat: lat.toFixed(2), lon: lon.toFixed(2) });
    show(false);
  }

  select.onchange = () => {
    const v = select.value;
    if (v.startsWith("p:")) { const p = places.places.find((x) => x.id === v.slice(2)); if (p) choose(p.lat, p.lon, placeName(p)); }
    if (v.startsWith("t:")) { const x = state.tanks.find((k) => k.id === v.slice(2)); if (x) choose(x.lat, x.lon, getLang() === "si" && x.name_si ? x.name_si : x.name_en); }
  };
  view.querySelector("#pl-near").onclick = () => {
    if (!("geolocation" in navigator)) { status.textContent = t("map.my_location.error"); return; }
    status.textContent = t("map.my_location.busy");
    // The position is used only in this page to ask for the weather there; it is not saved.
    navigator.geolocation.getCurrentPosition((pos) => choose(pos.coords.latitude, pos.coords.longitude, t("pl.here")),
      () => { status.textContent = t("map.my_location.error"); }, { timeout: 15000, maximumAge: 600000 });
  };

  async function show(force) {
    if (cur.lat === null) { results.innerHTML = ""; return; }
    results.innerHTML = `<p class="fact-small">${escapeHtml(t("forecast.status.loading"))}</p>`;
    const f = await loadForecastAt(cur.lat, cur.lon, force);
    if (!results.isConnected) return;
    if (!f) { results.innerHTML = `<section class="block"><p>${escapeHtml(t("pl.offline"))}</p></section>`; return; }
    if (!f.days.some((d) => d.date === cur.day)) cur.day = f.days[0].date;          // the shared day is in the past
    history.replaceState(null, "", addressOf(cur));                                  // the link now holds this plan
    results.innerHTML = resultsMarkup(f, clim, cur);
    wireResults(f);
  }

  function wireResults(f) {
    results.querySelectorAll("[data-day]").forEach((b) => { b.onclick = () => { cur.day = b.dataset.day; history.replaceState(null, "", addressOf(cur)); results.innerHTML = resultsMarkup(f, clim, cur); wireResults(f); }; });
    const from = results.querySelector("#pl-from"), to = results.querySelector("#pl-to");
    const change = () => { cur.from = Number(from.value); cur.to = Number(to.value); if (cur.to <= cur.from) cur.to = cur.from + 1; history.replaceState(null, "", addressOf(cur)); results.innerHTML = resultsMarkup(f, clim, cur); wireResults(f); };
    from.onchange = change; to.onchange = change;
    // A kind of trip sets its usual hours (the person can still change them)
    results.querySelector("#pl-kind").onchange = (e) => {
      cur.kind = kindOf(e.target.value); cur.from = KINDS[cur.kind].from; cur.to = KINDS[cur.kind].to;
      history.replaceState(null, "", addressOf(cur)); results.innerHTML = resultsMarkup(f, clim, cur); wireResults(f);
    };
    // Compare with a second place: the forecast for it is fetched, then shown next to this one
    results.querySelector("#pl-other")?.addEventListener("change", async (e) => {
      const v = e.target.value; let pt = null;
      if (v.startsWith("p:")) { const p = places.places.find((x) => x.id === v.slice(2)); if (p) pt = { lat: p.lat, lon: p.lon, name: placeName(p) }; }
      if (v.startsWith("t:")) { const x = state.tanks.find((k) => k.id === v.slice(2)); if (x) pt = { lat: x.lat, lon: x.lon, name: getLang() === "si" && x.name_si ? x.name_si : x.name_en }; }
      cur.other = null;
      if (pt) { const g = await loadForecastAt(pt.lat, pt.lon); cur.other = g ? { ...pt, f: g } : { ...pt, f: null }; }
      results.innerHTML = resultsMarkup(f, clim, cur); wireResults(f);
      results.querySelector("#pl-other").value = v;
    });
    results.querySelector("#pl-ics")?.addEventListener("click", () => {
      const hours = windowHours(f, cur.day, cur.from, cur.to), v = verdictOf(hours);
      const text = icsFile({ name: cur.name, day: cur.day, from: cur.from, to: cur.to, summary: `${t(`pl.kind.${cur.kind}`)}: ${cur.name}`,
        description: `${v ? t(`pl.v.${v.cls}`) : ""} ${t("pl.share.foot")}`, url: location.href });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
      a.download = `monsoon-compass-${cur.day}.ics`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    results.querySelector("#pl-print")?.addEventListener("click", () => window.print());
    results.querySelector("#pl-copy").onclick = async () => {
      const msg = results.querySelector("#pl-copied");
      try { await navigator.clipboard.writeText(location.href); msg.textContent = t("pl.copied"); } catch { msg.textContent = t("week.copy_failed"); }
    };
  }

  if (cur.lat !== null) { select.value = ""; choose(cur.lat, cur.lon, cur.name); }
  refreshTimer = setInterval(() => { if (!results.isConnected) { clearInterval(refreshTimer); return; } if (cur.lat !== null && document.visibilityState === "visible") show(true); }, REFRESH_MS);
}

// ---------------------------------------------------------------------------
// The results
// ---------------------------------------------------------------------------
function resultsMarkup(f, clim, cur) {
  const day = f.days.find((d) => d.date === cur.day);
  const hours = windowHours(f, cur.day, cur.from, cur.to), v = verdictOf(hours);
  const best = bestWindow(f, cur.day);
  const ranked = f.days.map((d) => ({ d, v: verdictOf(windowHours(f, d.date, cur.from, cur.to)) })).filter((x) => x.v);
  const order = { dry: 0, maybe: 1, wet: 2 };
  const top = [...ranked].sort((a, b) => order[a.v.cls] - order[b.v.cls] || a.v.mm - b.v.mm || a.v.chance - b.v.chance).slice(0, 3);
  const month = Number(cur.day.slice(5, 7)), ctx = climateFor(clim, cur.lat, cur.lon, month);
  const when = `${weekdayName(cur.day)} ${date(cur.day, { day: "numeric", month: "long" })}, ${hr(cur.from)}–${hr(cur.to)}`;
  const link = location.href.split("#")[0] + addressOf(cur);
  const shareText = `${cur.name}, ${when}: ${v ? t(`pl.v.${v.cls}`) : ""} ${t("pl.share.foot")}\n${link}`;

  const hourOptions = (selected, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}"${h === selected ? " selected" : ""}>${hr(h)}</option>`).join("");

  return `
    <section class="block" aria-labelledby="pl-days-title">
      <h2 id="pl-days-title">${escapeHtml(t("pl.when"))}</h2>
      <div class="pl-hours">
        <label>${escapeHtml(t("pl.kind"))} <select id="pl-kind">${Object.keys(KINDS).map((k) => `<option value="${k}"${k === cur.kind ? " selected" : ""}>${escapeHtml(t(`pl.kind.${k}`))}</option>`).join("")}</select></label>
        <label>${escapeHtml(t("pl.from"))} <select id="pl-from">${hourOptions(cur.from, 0, 22)}</select></label>
        <label>${escapeHtml(t("pl.to"))} <select id="pl-to">${hourOptions(cur.to, 1, 23)}</select></label>
      </div>
      <div class="wx-strip pl-strip" role="list">${f.days.map((d, i) => {
        const dv = verdictOf(windowHours(f, d.date, cur.from, cur.to));
        return `<button type="button" class="wx-day pl-day ${dv ? dv.cls : ""}" role="listitem" data-day="${d.date}" aria-pressed="${d.date === cur.day}"
          aria-label="${escapeHtml(`${weekdayName(d.date)} ${date(d.date, { day: "numeric", month: "long" })}: ${dv ? tag(dv.cls) : ""}`)}">
          <span class="wx-wd">${escapeHtml(i === 0 ? t("weather.today") : weekdayName(d.date, true))}</span>
          <span class="wx-dn">${+d.date.slice(8, 10)}</span>
          ${icon(sky(d), 36)}
          <strong>${d.tmax_c == null ? "–" : Math.round(d.tmax_c) + "°"}</strong>
          <span class="pl-tag ${dv ? dv.cls : ""}">${escapeHtml(dv ? tag(dv.cls) : "–")}</span>
        </button>`;
      }).join("")}</div>
      <p class="fact-small">${escapeHtml(t("pl.strip_help"))}</p>
    </section>

    <section class="block pl-verdict ${v ? v.cls : ""}" aria-labelledby="pl-verdict-title">
      <h2 id="pl-verdict-title">${escapeHtml(when)}</h2>
      <p class="pl-place">${escapeHtml(cur.name)}</p>
      ${v ? `
        <p class="pl-big">${escapeHtml(t(`pl.v.${v.cls}`))}</p>
        <p class="pl-nums"><span>${escapeHtml(t("pl.rain_in", { mm: num(v.mm, 1) }))}</span><span>${escapeHtml(t("pl.chance", { p: v.chance }))}</span><span>${escapeHtml(t("pl.hot", { t: Math.round(v.hottest) }))}</span></p>
        ${best ? `<p class="pl-best">${escapeHtml(t("pl.best_time", { from: hr(best.from), to: hr(best.to) }))}</p>` : ""}`
        : `<p>${escapeHtml(t("pl.no_numbers"))}</p>`}
      ${hourBars(f, cur)}
      <p class="fact-small">${escapeHtml(t("pl.bars_help"))}</p>
    </section>

    <section class="block" aria-labelledby="pl-best-title">
      <h2 id="pl-best-title">${escapeHtml(t("pl.best_days"))}</h2>
      <div class="pl-top">${top.map((x) => `<button type="button" class="pl-topday ${x.v.cls}" data-day="${x.d.date}">
        <strong>${escapeHtml(`${weekdayName(x.d.date)} ${date(x.d.date, { day: "numeric", month: "short" })}`)}</strong>
        <span>${escapeHtml(tag(x.v.cls))} · ${escapeHtml(t("pl.rain_short", { mm: num(x.v.mm, 1) }))}</span></button>`).join("")}</div>
      <p class="fact-small">${escapeHtml(t("pl.forecast_note"))}</p>
    </section>

    ${extrasMarkup(f, cur, v)}

    ${compareMarkup(f, cur, v, place_options)}

    <section class="block" aria-labelledby="pl-usual-title">
      <h2 id="pl-usual-title">${escapeHtml(t("pl.usual"))}</h2>
      ${ctx ? `
        <p>${escapeHtml(t("pl.usual_text", { month: monthName(`2026-${pad(month)}-01`), rain: ctx.rain, hot: Math.round(ctx.hot) }))}</p>
        <div class="pl-clim" role="img" aria-label="${escapeHtml(t("pl.usual"))}">${ctx.monthly.map((mm, i) => `<span class="pl-clim-bar${i + 1 === month ? " on" : ""}"><i style="height:${Math.max(4, Math.round((mm / Math.max(...ctx.monthly)) * 100))}%"></i><em>${monthName(`2026-${pad(i + 1)}-01`).slice(0, 1)}</em></span>`).join("")}</div>
        <p class="badge source">${escapeHtml(t("label.source"))} ${escapeHtml(t("pl.usual_source", { period: clim.period }))}</p>`
        : `<p>${escapeHtml(t("pl.no_usual"))}</p>`}
    </section>

    <section class="block pl-share" aria-labelledby="pl-share-title">
      <h2 id="pl-share-title">${escapeHtml(t("pl.share"))}</h2>
      <div class="week-actions">
        <a class="action" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">${escapeHtml(t("week.share"))}</a>
        <button type="button" class="action ghost" id="pl-copy">${escapeHtml(t("pl.copy_link"))}</button>
        <button type="button" class="action ghost" id="pl-ics">${escapeHtml(t("pl.ics"))}</button>
        <button type="button" class="action ghost" id="pl-print">${escapeHtml(t("pl.print"))}</button>
      </div>
      <p class="fact-small" id="pl-copied" role="status"></p>
      <p class="badge source">${escapeHtml(t("label.source"))} ${escapeHtml(t("forecast.source"))}</p>
    </section>`;
}

// Rain hour by hour for the chosen day (6:00 to 23:00), with the chosen hours marked
function hourBars(f, cur) {
  const rows = [];
  for (let h = 7; h <= 23; h++) {
    const i = f.index.get(`${cur.day}T${pad(h)}:00`);
    if (i !== undefined) rows.push({ h, mm: f.mm[i] ?? 0, chance: f.chance[i] });
  }
  if (!rows.length) return "";
  const top = Math.max(4, ...rows.map((r) => r.mm));
  return `<div class="pl-bars" style="--n:${rows.length}" role="img" aria-label="${escapeHtml(t("pl.bars_label"))}">${rows.map((r) => {
    const inside = r.h > cur.from && r.h <= cur.to;
    return `<span class="pl-bar${inside ? " in" : ""}" title="${hr(r.h - 1)}–${hr(r.h)}: ${num(r.mm, 1)} mm, ${r.chance ?? "?"}%">
      <i class="${r.mm >= 7.6 ? "heavy" : r.mm >= 2.5 ? "moderate" : r.mm >= 0.5 ? "light" : "dry"}" style="height:${r.mm <= 0 ? 4 : Math.max(8, Math.min(100, (r.mm / top) * 100))}%"></i>
      <em>${(r.h - 1) % 3 === 0 ? pad(r.h - 1) : ""}</em></span>`;
  }).join("")}</div>`;
}

// ---------------------------------------------------------------------------
// The map: tap anywhere to choose a point
// ---------------------------------------------------------------------------
function startMap(view, cur, onPick) {
  const el = view.querySelector("#pl-map");
  if (!window.L) { el.hidden = true; return; }
  plMap = L.map(el, { zoomControl: true, scrollWheelZoom: false, minZoom: 6, maxZoom: 11 }).setView([cur.lat ?? 7.8, cur.lon ?? 80.7], cur.lat === null ? 7 : 9);
  L.tileLayer(`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, { maxNativeZoom: 8, attribution: "NASA GIBS" }).addTo(plMap);
  plMap.on("click", (e) => onPick(e.latlng.lat, e.latlng.lng, ""));
  setTimeout(() => plMap && plMap.invalidateSize(), 150);
}

// ---------------------------------------------------------------------------
// Wind, sun and heat for the chosen hours, sun times and a "what to bring" list (all from the forecast; draft warning levels)
// ---------------------------------------------------------------------------
function extrasMarkup(f, cur, v) {
  const ex = extrasFor(f, cur.day, cur.from, cur.to);
  const bring = bringList(v, ex, cur.kind);
  const level = (cls, key, vars) => `<li class="pl-warn ${cls}">${escapeHtml(t(key, vars))}</li>`;
  const rows = [];
  if (ex.gust !== null) rows.push(level(ex.wind === "calm" ? "ok" : ex.wind, `pl.wind.${ex.wind}`, { v: Math.round(ex.gust) }));
  if (ex.uv !== null) rows.push(level(ex.sun === "ok" ? "ok" : ex.sun, `pl.uv.${ex.sun}`, { v: Math.round(ex.uv) }));
  if (ex.feels !== null) rows.push(level(ex.heat === "ok" ? "ok" : ex.heat, `pl.heat.${ex.heat}`, { v: Math.round(ex.feels) }));
  const sunLine = ex.sunrise !== null && ex.sunset !== null ? `<p class="pl-sun">${escapeHtml(t("pl.sun", { rise: clock(ex.sunrise), set: clock(ex.sunset) }))}</p>` : "";
  const dark = ex.dark ? `<p class="pl-warn wet">${escapeHtml(t("pl.dark", { set: clock(ex.sunset) }))}</p>` : (ex.early ? `<p class="pl-warn maybe">${escapeHtml(t("pl.early", { rise: clock(ex.sunrise) }))}</p>` : "");
  if (!rows.length && !sunLine) return "";
  return `<section class="block pl-extras" aria-labelledby="pl-extras-title">
      <h2 id="pl-extras-title">${escapeHtml(t("pl.extras"))}</h2>
      ${rows.length ? `<ul class="pl-warns">${rows.join("")}</ul>` : ""}
      ${sunLine}${dark}
      ${bring.length ? `<h3>${escapeHtml(t("pl.bring"))}</h3><ul class="pl-bring">${bring.map((k) => `<li>${escapeHtml(t(`pl.bring.${k}`))}</li>`).join("")}</ul>` : ""}
      <p class="fact-small">${escapeHtml(t("pl.extras_note"))}</p>
      <p class="badge source">${escapeHtml(t("label.source"))} ${escapeHtml(t("forecast.source"))}</p>
    </section>`;
}

// Two places side by side for the same day and hours
function compareMarkup(f, cur, v, options) {
  const col = (name, fc) => {
    const hrs = fc ? windowHours(fc, cur.day, cur.from, cur.to) : [];
    return { name, verdict: verdictOf(hrs), ex: fc ? extrasFor(fc, cur.day, cur.from, cur.to) : null };
  };
  const a = { name: cur.name, verdict: v, ex: extrasFor(f, cur.day, cur.from, cur.to) };
  const b = cur.other ? col(cur.other.name, cur.other.f) : null;
  const better = b ? betterOf(a.verdict, b.verdict) : null;
  const cell = (c) => `<div class="pl-cmp-col ${c.verdict ? c.verdict.cls : ""}">
      <strong>${escapeHtml(c.name)}</strong>
      <span class="pl-tag ${c.verdict ? c.verdict.cls : ""}">${escapeHtml(c.verdict ? tag(c.verdict.cls) : "–")}</span>
      ${c.verdict ? `<span>${escapeHtml(t("pl.rain_in", { mm: num(c.verdict.mm, 1) }))}</span><span>${escapeHtml(t("pl.chance", { p: c.verdict.chance }))}</span>` : ""}
      ${c.ex && c.ex.gust !== null ? `<span>${escapeHtml(t("pl.cmp_wind", { v: Math.round(c.ex.gust) }))}</span>` : ""}</div>`;
  return `<section class="block pl-compare" aria-labelledby="pl-cmp-title">
      <h2 id="pl-cmp-title">${escapeHtml(t("pl.compare"))}</h2>
      <label class="pl-select">${escapeHtml(t("pl.compare_with"))}
        <select id="pl-other"><option value="">${escapeHtml(t("pl.choose_ph"))}</option>${options}</select></label>
      ${b && cur.other.f === null ? `<p>${escapeHtml(t("pl.offline"))}</p>` : ""}
      ${b && cur.other.f ? `<div class="pl-cmp">${cell(a)}${cell(b)}</div>
        <p class="pl-big">${escapeHtml(better === "same" ? t("pl.cmp_same") : t("pl.cmp_a", { name: better === "a" ? a.name : b.name }))}</p>` : ""}
    </section>`;
}
