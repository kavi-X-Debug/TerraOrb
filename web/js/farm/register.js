// Farm registration: name, where it is (tap the map, "use my location", or type latitude and longitude),
// optional outline of the field, size, water, labour, equipment, five priorities, and what grew before.
// Everything typed is also kept on this phone (localStorage "mc-farm-draft") until the farm is saved.
import { h, saveLocal, loadLocal, clearLocal } from "./api.js";

const PILOT = { south: 7.8, north: 9.1, west: 79.9, east: 81.1 };       // the pre-computed pilot area (Anuradhapura district)
const SRI_LANKA = { south: 5.8, north: 9.95, west: 79.4, east: 82.0 };
const PRIORITIES = ["save_water", "income", "soil", "low_work", "family_food"];
const DEFAULT_PRIORITY = { save_water: 3, income: 3, soil: 2, low_work: 1, family_food: 1 };   // relative weights, 0 to 10
const CHOICES = {
  water_source: ["rain-fed", "tank", "well", "canal"],
  yala_water: ["yes", "limited", "no"],
  labour: ["low", "medium", "high"],
  equipment: ["low", "medium", "high"],
};

// The last four finished seasons (Maha = Oct-Mar, Yala = May-Sep), newest first, in the form the service stores.
export function recentSeasons(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const out = [];
  for (let yr = y; yr >= y - 3 && out.length < 4; yr--) {
    if (yr < y || m >= 10) out.push(`Yala ${yr}`);
    if (yr < y || m >= 4) out.push(`Maha ${yr - 1}/${String(yr).slice(2)}`);
  }
  return out.slice(0, 4);
}

// Area of a polygon in hectares (small-area flat approximation; fine for a field).
export function areaHa(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = [ring[i][0] * kx, ring[i][1] * ky];
    const [x2, y2] = [ring[(i + 1) % ring.length][0] * kx, ring[(i + 1) % ring.length][1] * ky];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2 / 10000;
}

const inside = (lat, lon, b) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

export async function renderRegister(ctx) {
  const { api, view, t, go } = ctx;
  view.innerHTML = "";

  // ---- the form's state; starts from the saved draft if there is one ----
  const draft = loadLocal("draft") || {};
  const s = {
    name: draft.name || "", lat: draft.lat ?? null, lon: draft.lon ?? null, area: draft.area ?? "",
    ring: draft.ring || [],                                        // outline points [lon, lat], not closed
    water_source: draft.water_source || "", yala_water: draft.yala_water || "", labour: draft.labour || "", equipment: draft.equipment || "",
    prio: { ...DEFAULT_PRIORITY, ...(draft.prio || {}) },
    history: draft.history || {},                                  // season -> crop_id
  };
  const keep = () => saveLocal("draft", s);

  const status = h("p", { class: "fm-status", role: "alert", "aria-live": "assertive" });
  const say = (text, isError = true) => { status.textContent = text || ""; status.classList.toggle("fm-error", isError && !!text); };

  const page = h("div", { class: "fm-page" });
  view.append(page);
  page.append(h("a", { class: "fm-back", href: "#/farm", text: t("farm.back_home") }), h("h1", { text: t("farm.reg.title") }), h("p", { class: "fm-lead", text: t("farm.reg.lead") }));
  if (draft && Object.keys(draft).length) page.append(h("p", { class: "fm-note", text: t("farm.reg.draft_restored") }));

  // ---- 1. name ----
  const nameInput = h("input", { class: "fm-input fm-big", id: "fm-name", type: "text", maxlength: "80", value: s.name, placeholder: t("farm.reg.name_hint"),
    oninput: () => { s.name = nameInput.value; keep(); } });
  page.append(section("1", t("farm.reg.s_name"), h("label", { for: "fm-name", class: "fm-label", text: t("farm.reg.name") }), nameInput));

  // ---- 2. where ----
  const latIn = h("input", { class: "fm-input", id: "fm-lat", type: "number", step: "any", inputmode: "decimal", value: s.lat ?? "" });
  const lonIn = h("input", { class: "fm-input", id: "fm-lon", type: "number", step: "any", inputmode: "decimal", value: s.lon ?? "" });
  const placeNote = h("p", { class: "fm-fine", role: "status" });
  const mapBox = h("div", { class: "fm-map", id: "fm-map", role: "application", "aria-label": t("farm.reg.map_label") });
  const drawState = h("p", { class: "fm-fine", role: "status" });
  let map = null, marker = null, polyLayer = null, drawing = false;

  function showPlaceNote() {
    if (s.lat === null || s.lon === null) { placeNote.textContent = t("farm.reg.pick_hint"); return; }
    if (!inside(s.lat, s.lon, SRI_LANKA)) placeNote.textContent = t("farm.reg.outside_sl");
    else if (!inside(s.lat, s.lon, PILOT)) placeNote.textContent = t("farm.reg.outside_pilot");
    else placeNote.textContent = t("farm.reg.placed", { lat: s.lat.toFixed(4), lon: s.lon.toFixed(4) });
  }
  function setPoint(lat, lon, { pan = true, fromInput = false } = {}) {
    s.lat = Number(lat); s.lon = Number(lon);
    if (!fromInput) { latIn.value = s.lat.toFixed(5); lonIn.value = s.lon.toFixed(5); }
    if (map && window.L) {
      if (!marker) marker = L.marker([s.lat, s.lon]).addTo(map); else marker.setLatLng([s.lat, s.lon]);
      if (pan) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 14));
    }
    showPlaceNote(); keep();
  }
  const onManual = () => {
    const la = parseFloat(latIn.value), lo = parseFloat(lonIn.value);
    if (Number.isFinite(la) && Number.isFinite(lo)) setPoint(la, lo, { fromInput: true });
  };
  latIn.addEventListener("change", onManual); lonIn.addEventListener("change", onManual);

  const locBtn = h("button", { class: "fm-btn fm-secondary", type: "button", text: t("farm.reg.use_location"),
    onclick: () => {
      if (!("geolocation" in navigator)) { placeNote.textContent = t("farm.reg.loc_unavailable"); return; }
      placeNote.textContent = t("farm.state.locating");
      navigator.geolocation.getCurrentPosition(
        (pos) => setPoint(pos.coords.latitude, pos.coords.longitude),
        () => { placeNote.textContent = t("farm.reg.loc_unavailable"); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    } });

  // outline drawing: tap points around the field; "Finish" closes it
  function drawPoly() {
    if (!map || !window.L) return;
    if (polyLayer) { map.removeLayer(polyLayer); polyLayer = null; }
    const pts = s.ring.map((p) => [p[1], p[0]]);
    if (pts.length >= 3 && !drawing) polyLayer = L.polygon(pts, { color: "#2B5430", weight: 3 }).addTo(map);
    else if (pts.length >= 1) polyLayer = L.polyline(pts, { color: "#2B5430", weight: 3, dashArray: "6 6" }).addTo(map);
    const ha = areaHa(s.ring);
    drawState.textContent = s.ring.length >= 3 && !drawing ? t("farm.reg.outline_done", { n: s.ring.length, ha: ha.toFixed(2) })
      : drawing ? t("farm.reg.outline_drawing", { n: s.ring.length }) : t("farm.reg.outline_none");
  }
  const drawBtn = h("button", { class: "fm-btn fm-secondary", type: "button", text: t("farm.reg.draw_start"), onclick: () => {
    drawing = true; s.ring = []; drawPoly(); finishBtn.hidden = false; drawBtn.hidden = true; undoBtn.hidden = false;
  } });
  const finishBtn = h("button", { class: "fm-btn fm-primary", type: "button", hidden: true, text: t("farm.reg.draw_finish"), onclick: () => {
    if (s.ring.length < 3) { drawState.textContent = t("farm.reg.outline_few"); return; }
    drawing = false; finishBtn.hidden = true; undoBtn.hidden = true; drawBtn.hidden = false; clearBtn.hidden = false;
    const ha = areaHa(s.ring);
    if (!String(s.area).trim() && ha > 0) { s.area = ha.toFixed(2); areaIn.value = s.area; }       // fill the size only if the farmer left it empty
    if (s.lat === null) { const c = centre(s.ring); setPoint(c[1], c[0], { pan: false }); }
    drawPoly(); keep();
  } });
  const undoBtn = h("button", { class: "fm-btn fm-quiet", type: "button", hidden: true, text: t("farm.reg.draw_undo"), onclick: () => { s.ring.pop(); drawPoly(); keep(); } });
  const clearBtn = h("button", { class: "fm-btn fm-quiet", type: "button", hidden: !s.ring.length, text: t("farm.reg.draw_clear"), onclick: () => {
    s.ring = []; drawing = false; clearBtn.hidden = true; finishBtn.hidden = true; undoBtn.hidden = true; drawBtn.hidden = false; drawPoly(); keep();
  } });
  const centre = (ring) => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];

  page.append(section("2", t("farm.reg.s_where"),
    h("p", { text: t("farm.reg.where_help") }),
    h("div", { class: "fm-row" }, locBtn),
    mapBox, placeNote,
    h("div", { class: "fm-pair" },
      h("div", {}, h("label", { for: "fm-lat", class: "fm-label", text: t("farm.reg.lat") }), latIn),
      h("div", {}, h("label", { for: "fm-lon", class: "fm-label", text: t("farm.reg.lon") }), lonIn)),
    h("details", { class: "fm-details" }, h("summary", { text: t("farm.reg.outline_title") }),
      h("p", { class: "fm-fine", text: t("farm.reg.outline_help") }),
      h("div", { class: "fm-row" }, drawBtn, finishBtn, undoBtn, clearBtn), drawState)));

  // The map needs Leaflet from the CDN; without it the typed coordinates and "use my location" still work.
  if (window.L) {
    map = L.map(mapBox, { center: [s.lat ?? 8.45, s.lon ?? 80.45], zoom: s.lat === null ? 9 : 14 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: t("farm.reg.map_credit") }).addTo(map);
    map.on("click", (e) => { if (drawing) { s.ring.push([e.latlng.lng, e.latlng.lat]); drawPoly(); keep(); } else setPoint(e.latlng.lat, e.latlng.lng, { pan: false }); });
    if (s.lat !== null) setPoint(s.lat, s.lon, { pan: false });
    drawPoly();
    setTimeout(() => map && map.invalidateSize(), 200);
  } else {
    mapBox.replaceWith(h("p", { class: "fm-note", text: t("farm.reg.no_map") }));
    drawState.textContent = t("farm.reg.outline_none");
  }
  showPlaceNote();

  // ---- 3. size ----
  const areaIn = h("input", { class: "fm-input fm-big", id: "fm-area", type: "number", step: "0.01", min: "0.01", inputmode: "decimal", value: s.area,
    oninput: () => { s.area = areaIn.value; keep(); } });
  page.append(section("3", t("farm.reg.s_size"), h("label", { for: "fm-area", class: "fm-label", text: t("farm.reg.area") }), areaIn, h("p", { class: "fm-fine", text: t("farm.reg.area_help") })));

  // ---- 4. water, labour, equipment: big choice buttons ----
  const choiceBlock = (key) => {
    const group = h("div", { class: "fm-choices", role: "radiogroup", "aria-label": t(`farm.reg.${key}`) });
    const paint = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === s[key])));
    for (const v of CHOICES[key]) {
      group.append(h("button", { type: "button", role: "radio", class: "fm-choice", "data-v": v, text: t(`farm.opt.${key}.${v}`),
        onclick: () => { s[key] = v; paint(); keep(); } }));
    }
    paint();
    return h("div", { class: "fm-q" }, h("p", { class: "fm-label", text: t(`farm.reg.${key}`) }), group);
  };
  page.append(section("4", t("farm.reg.s_farm"), ...Object.keys(CHOICES).map(choiceBlock)));

  // ---- 5. priorities: five sliders, shown as shares that add up to 100% ----
  const shareEls = {};
  const paintShares = () => {
    const sum = PRIORITIES.reduce((a, k) => a + Number(s.prio[k]), 0);
    for (const k of PRIORITIES) shareEls[k].textContent = sum > 0 ? `${Math.round((100 * s.prio[k]) / sum)}%` : "0%";
  };
  const prioRows = PRIORITIES.map((k) => {
    const slider = h("input", { type: "range", min: "0", max: "10", step: "1", id: `fm-p-${k}`, value: s.prio[k], class: "fm-range",
      oninput: () => { s.prio[k] = Number(slider.value); paintShares(); keep(); } });
    shareEls[k] = h("output", { class: "fm-share", for: `fm-p-${k}` });
    return h("div", { class: "fm-prio" }, h("label", { for: `fm-p-${k}`, class: "fm-label", text: t(`farm.prio.${k}`) }), slider, shareEls[k]);
  });
  paintShares();
  page.append(section("5", t("farm.reg.s_prio"), h("p", { text: t("farm.reg.prio_help") }), ...prioRows));

  // ---- 6. what grew before (crop list comes from the service; the form works without it) ----
  const histBox = h("div", { class: "fm-hist" });
  page.append(section("6", t("farm.reg.s_hist"), h("p", { text: t("farm.reg.hist_help") }), histBox));
  (async () => {
    let crops = null;
    try { crops = await api.get("/knowledge/crops", { auth: false, timeout: 8000 }); } catch { /* shown below */ }
    const list = Array.isArray(crops) ? crops : crops && Array.isArray(crops.crops) ? crops.crops : null;
    if (!list || !list.length) { histBox.append(h("p", { class: "fm-note", text: t("farm.reg.hist_unavailable") })); return; }
    const lang = document.documentElement.lang;
    const label = (c) => (lang === "si" ? c.name_si : c.name_en) || c.name_en || c.id;
    for (const season of recentSeasons()) {
      const sel = h("select", { class: "fm-input", id: `fm-h-${season}`, "aria-label": season },
        h("option", { value: "", text: t("farm.reg.hist_none") }),
        ...list.map((c) => h("option", { value: c.id, text: label(c) })));
      sel.value = s.history[season] || "";
      sel.addEventListener("change", () => { if (sel.value) s.history[season] = sel.value; else delete s.history[season]; keep(); });
      histBox.append(h("div", { class: "fm-hist-row" }, h("label", { for: sel.id, class: "fm-label", text: season }), sel));
    }
  })();

  // ---- save ----
  const saveBtn = h("button", { class: "fm-btn fm-primary fm-big", type: "button", text: t("farm.reg.save"), onclick: save });
  page.append(h("div", { class: "fm-actions" }, saveBtn, status, h("p", { class: "fm-fine", text: t("farm.disclaimer") })));

  function problem() {
    if (s.lat === null || s.lon === null || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return "farm.reg.err_place";
    if (!inside(s.lat, s.lon, SRI_LANKA)) return "farm.reg.outside_sl";
    const ha = Number(s.area);
    if (!(ha > 0) || ha > 1000) return "farm.reg.err_area";
    for (const k of Object.keys(CHOICES)) if (!s[k]) return `farm.reg.err_${k}`;
    if (PRIORITIES.reduce((a, k) => a + Number(s.prio[k]), 0) <= 0) return "farm.reg.err_prio";
    return null;
  }

  async function save() {
    const bad = problem();
    if (bad) { say(t(bad)); return; }
    const sum = PRIORITIES.reduce((a, k) => a + Number(s.prio[k]), 0);
    const priorities = Object.fromEntries(PRIORITIES.map((k) => [k, Math.round((10000 * s.prio[k]) / sum) / 10000]));
    const body = {
      name: s.name.trim() || null, lat: s.lat, lon: s.lon, area_ha: Number(s.area),
      water_source: s.water_source, yala_water: s.yala_water, labour: s.labour, equipment: s.equipment, priorities,
      crop_history: Object.entries(s.history).map(([season, crop_id]) => ({ season, crop_id })),
    };
    if (s.ring.length >= 3) body.polygon = { type: "Polygon", coordinates: [[...s.ring, s.ring[0]]] };   // GeoJSON ring: closed, [lon, lat]
    saveBtn.disabled = true; say(t("farm.state.saving"), false);
    try {
      const farm = await api.post("/farms", body);
      clearLocal("draft");
      go(`#/farm/location/${farm.id}`);
    } catch (err) {
      saveBtn.disabled = false;
      if (err.network) say(t("farm.reg.saved_on_phone"));          // the draft is already kept on this phone
      else if (err.status === 401) say(t("farm.err.login_again"));
      else say(`${t("farm.reg.save_failed")} (${err.message})`);
    }
  }
}

function section(num, title, ...kids) {
  return h("section", { class: "fm-card" }, h("h2", { class: "fm-h2" }, h("span", { class: "fm-step", text: num }), title), ...kids);
}
