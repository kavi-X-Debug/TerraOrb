// Farm planner, screen "Land and soil": terrain zones on a map, the threat map, soil layers (modelled vs measured by the
// farmer) and a simple way to correct the zones. Spec: docs/farm-spec.md sections 3, 6 and 7.
//
// Honesty rules kept here: zones, soil and erosion are MODELLED from open terrain and soil data (not measured on the
// ground); farmer-measured soil is shown separately and never mixed in; the thresholds behind the zone classes are
// drafts; if the server cannot build zones it says so and nothing is invented.
//
// This file also exports the small helpers (fpCall, fpEl, fpEnsureCss, fpNote) that plan.js and mockups.js reuse.
import { t as tGlobal } from "../i18n.js";
import { addNasaLayers } from "../nasa-layers.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const CSS_HREF = "css/farm-plan.css";

// Add the stylesheet of these screens once (the farm.css of the other agent is linked by its own module).
export function fpEnsureCss() {
  if (document.querySelector(`link[data-fp-css]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = CSS_HREF; link.dataset.fpCss = "1";
  document.head.append(link);
}

// The API base: window.MC_API, then localStorage "mc-api", then the local development server.
function apiBase() {
  let b = window.MC_API;
  try { b = b || localStorage.getItem("mc-api"); } catch { /* ignore */ }
  return String(b || "http://localhost:8000").replace(/\/+$/, "");
}

// One JSON call to the farm API. Returns { ok, status, data, error }; it never throws, so a screen can show a plain message.
export async function fpCall(method, path, body) {
  const headers = { Accept: "application/json" };
  let token = null;
  try { token = localStorage.getItem("mc-farm-token"); } catch { /* ignore */ }
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const r = await fetch(`${apiBase()}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch { /* no body */ }
    const detail = data && typeof data.detail === "string" ? data.detail : (data && data.detail ? JSON.stringify(data.detail) : "");
    return { ok: r.ok, status: r.status, data, error: r.ok ? "" : detail || `HTTP ${r.status}` };
  } catch {
    return { ok: false, status: 0, data: null, error: "", offline: true };
  }
}

// Tiny element builder: fpEl("div", { class: "x", onclick }, child, "text", ...). Text is always set as text (never HTML).
export function fpEl(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

// A small coloured note box: kind = info | warn | proto.
export function fpNote(kind, text) { return fpEl("p", { class: `fp-note fp-${kind}`, role: kind === "warn" ? "alert" : null }, text); }

// The message for a failed call: "cannot reach the server" or the server's own reason.
export function fpFail(t, res) {
  return fpNote("warn", res.offline ? t("farmplan.err.offline") : res.error || t("farmplan.err.generic"));
}

const parseGeo = (g) => { if (typeof g === "string") { try { return JSON.parse(g); } catch { return null; } } return g || null; };

// ---------------------------------------------------------------------------
// Colours (not text): one per zone kind and per threat level
// ---------------------------------------------------------------------------
const KIND_COLOUR = { flat: "#8DBB6B", gentle: "#E2C94F", steep: "#DA8A36", very_steep: "#B03A2E", wet_low: "#3B7DB8" };
const LEVEL_COLOUR = { low: "#2F8F4A", medium: "#D9A21B", high: "#B42318", none: "#9AA7A4" };
const KINDS = ["flat", "gentle", "steep", "very_steep", "wet_low"];
const SOIL_PROPS = ["texture", "ph", "organic_carbon", "drainage", "colour"];
const FARMER_THREATS = ["wild_animals", "theft", "pests", "flooding_history"];
const COMPUTED_THREATS = ["erosion", "waterlogging", "drought", "heat"];

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------
export async function renderZones(ctx, farmId, view) {
  fpEnsureCss();
  const root = view || ctx.view;
  const t = ctx.t || tGlobal;
  const id = farmId ?? ctx.farm?.id;
  root.innerHTML = "";
  const page = fpEl("div", { class: "fp-page" });
  root.append(page);
  page.append(
    fpEl("h2", {}, t("farmplan.zones.title")),
    fpEl("p", { class: "fp-lead" }, t("farmplan.zones.lead")),
    fpNote("info", t("farmplan.zones.source")),
  );
  const body = fpEl("div", { class: "fp-stack" }, fpEl("p", {}, t("farmplan.loading")));
  page.append(body);

  const state = { zones: [], soil: [], threats: [], dirty: false, layer: "zones", threatKind: "erosion", map: null, geo: null, selected: null };

  async function load() {
    const [z, s, th] = await Promise.all([fpCall("GET", `/farms/${id}/zones`), fpCall("GET", `/farms/${id}/soil`), fpCall("GET", `/farms/${id}/threats`)]);
    state.err = null;
    if (z.offline) { body.replaceChildren(fpFail(t, z)); return false; }
    // zones: { computed: [...], edited: [...], current: "edited" | "computed" | null }, each zone has a GeoJSON "feature"
    const zd = z.ok && z.data && !Array.isArray(z.data) ? z.data : {};
    state.zones = (zd.current ? zd[zd.current] : []) || [];
    state.zoneErr = z.ok ? null : z;
    // soil: { modelled: [...], measured_by_farmer: [...], note }
    state.soil = s.ok && s.data ? [...(s.data.modelled || []), ...(s.data.measured_by_farmer || [])] : [];
    state.soilNote = s.ok && s.data ? s.data.note || "" : "";
    state.soilErr = s.ok ? null : s;
    // threats: { computed: [...], farmer: [...], note }
    state.threats = th.ok && th.data ? [...(th.data.computed || []).map((x) => ({ ...x, source: "computed" })), ...(th.data.farmer || []).map((x) => ({ ...x, source: "farmer" }))] : [];
    state.threatNote = th.ok && th.data ? th.data.note || "" : "";
    state.threatErr = th.ok ? null : th;
    return true;
  }

  function draw() {
    body.replaceChildren();
    body.append(computeBar(), mapBlock(), legendBlock(), soilBlock(), threatListBlock());
    mountMap();
  }

  // --- compute button -------------------------------------------------------
  function computeBar() {
    const msg = fpEl("div", { "aria-live": "polite" });
    const btn = fpEl("button", { class: "fp-btn", type: "button" }, state.zones.length ? t("farmplan.zones.recompute") : t("farmplan.zones.compute"));
    btn.addEventListener("click", async () => {
      btn.disabled = true; msg.replaceChildren(fpEl("p", {}, t("farmplan.zones.computing")));
      const r = await fpCall("POST", `/farms/${id}/zones/compute`, {});
      btn.disabled = false;
      if (!r.ok) { msg.replaceChildren(fpFail(t, r), r.status === 502 || r.status === 503 ? fpNote("info", t("farmplan.zones.nodem")) : ""); return; }
      if (await load()) draw();
    });
    const bar = fpEl("div", { class: "fp-card" }, fpEl("div", { class: "fp-row" }, btn), fpEl("p", { class: "fp-small" }, t("farmplan.zones.compute_help")), msg);
    if (state.zoneErr) bar.append(fpFail(t, state.zoneErr));
    return bar;
  }

  // --- map ------------------------------------------------------------------
  function mapBlock() {
    const card = fpEl("div", { class: "fp-card" });
    const modes = fpEl("div", { class: "fp-seg", role: "group", "aria-label": t("farmplan.map.layer") });
    for (const m of ["zones", "threats"]) {
      const b = fpEl("button", { type: "button", class: "fp-seg-btn", "aria-pressed": String(state.layer === m) }, t(`farmplan.map.${m}`));
      b.addEventListener("click", () => { state.layer = m; draw(); });
      modes.append(b);
    }
    card.append(fpEl("div", { class: "fp-row" }, modes));
    if (state.layer === "threats") {
      const sel = fpEl("select", { "aria-label": t("farmplan.threat.pick") });
      for (const k of COMPUTED_THREATS) sel.append(fpEl("option", { value: k, selected: k === state.threatKind }, t(`farmplan.threat.${k}`)));
      sel.addEventListener("change", () => { state.threatKind = sel.value; refreshStyles(); legendRefresh(); });
      card.append(fpEl("label", { class: "fp-field" }, t("farmplan.threat.pick"), sel));
    }
    card.append(fpEl("div", { id: "fp-map", class: "fp-map", role: "img", "aria-label": t("farmplan.map.aria") }));
    card.append(fpEl("div", { id: "fp-edit", class: "fp-edit" }, fpEl("p", { class: "fp-small" }, t("farmplan.zones.edit_hint"))));
    if (state.dirty) card.append(saveBar());
    if (!state.zones.length && !state.zoneErr) card.append(fpNote("info", t("farmplan.zones.none")));
    return card;
  }

  // Colour for the threat map: erosion is worked out per zone; the others come as one row per farm or per zone.
  function threatLevelOf(zone) {
    if (state.threatKind === "erosion") { const lv = zone.feature?.properties?.erosion_level; if (lv) return lv; }
    const rows = state.threats.filter((x) => x.kind === state.threatKind && x.source !== "farmer");
    const exact = rows.find((x) => x.zone_id === zone.id);
    const farmWide = rows.find((x) => x.zone_id === null || x.zone_id === undefined);
    return (exact || farmWide)?.level || "none";
  }
  function styleOf(zone) {
    const colour = state.layer === "zones" ? KIND_COLOUR[zone.kind] || "#888" : LEVEL_COLOUR[threatLevelOf(zone)];
    return { color: "#16302E", weight: state.selected === zone.id ? 3 : 1, fillColor: colour, fillOpacity: 0.55 };
  }
  function refreshStyles() { state.geo?.eachLayer((l) => l.setStyle(styleOf(l.feature.properties.zone))); }

  function mountMap() {
    const el = document.getElementById("fp-map");
    if (!el) return;
    if (typeof L === "undefined") { el.replaceChildren(fpNote("warn", t("farmplan.map.noleaflet"))); return; }
    if (state.map) { state.map.remove(); state.map = null; }
    const farm = ctx.farm || {};
    const lat = Number(farm.lat) || 8.3, lon = Number(farm.lon) || 80.4;
    const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lon], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: t("farmplan.map.credit") }).addTo(map);
    addNasaLayers(L, map, t);                       // optional NASA pictures (true colour, greenness, heat, rain)
    state.map = map;
    const feats = state.zones.map((z) => ({ type: "Feature", properties: { zone: z }, geometry: z.feature?.geometry })).filter((f) => f.geometry && f.geometry.type);
    if (feats.length) {
      state.geo = L.geoJSON({ type: "FeatureCollection", features: feats }, {
        style: (f) => styleOf(f.properties.zone),
        onEachFeature: (f, layer) => {
          const z = f.properties.zone;
          layer.on("click", () => { state.selected = z.id; refreshStyles(); showEditor(z); });
          layer.bindTooltip(`${t(`farmplan.kind.${z.kind}`)}${z.mean_slope_pct != null ? `, ${Number(z.mean_slope_pct).toFixed(0)}%` : ""}`);
        },
      }).addTo(map);
      map.fitBounds(state.geo.getBounds(), { padding: [12, 12] });
    } else {
      const poly = parseGeo(farm.polygon || farm.plot_polygon || farm.geojson);
      if (poly && poly.type) { const g = L.geoJSON(poly, { style: { color: "#16302E", weight: 2, fillOpacity: 0.1 } }).addTo(map); map.fitBounds(g.getBounds(), { padding: [12, 12] }); }
      else L.marker([lat, lon]).addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 150);
  }

  // --- simple zone editing: change a zone's kind, then save -----------------
  function showEditor(zone) {
    const box = document.getElementById("fp-edit");
    if (!box) return;
    const sel = fpEl("select", { "aria-label": t("farmplan.zones.kind") });
    for (const k of KINDS) sel.append(fpEl("option", { value: k, selected: k === zone.kind }, t(`farmplan.kind.${k}`)));
    sel.addEventListener("change", () => { zone.kind = sel.value; state.dirty = true; refreshStyles(); legendRefresh(); box.querySelector(".fp-savehint")?.remove(); box.append(saveBar()); });
    box.replaceChildren(
      fpEl("p", {}, t("farmplan.zones.selected", { area: zone.area_ha != null ? Number(zone.area_ha).toFixed(2) : "?", slope: zone.mean_slope_pct != null ? Number(zone.mean_slope_pct).toFixed(0) : "?" })),
      fpEl("label", { class: "fp-field" }, t("farmplan.zones.kind"), sel),
      fpEl("p", { class: "fp-small" }, t("farmplan.zones.edit_warn")),
    );
  }
  function saveBar() {
    const out = fpEl("span", { "aria-live": "polite" });
    const b = fpEl("button", { class: "fp-btn", type: "button" }, t("farmplan.zones.save"));
    b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await fpCall("PUT", `/farms/${id}/zones`, { zones: state.zones.map((z) => ({ kind: z.kind, geometry: z.feature.geometry, mean_slope_pct: z.mean_slope_pct ?? null })) });
      b.disabled = false;
      if (!r.ok) { out.replaceChildren(fpFail(t, r)); return; }
      state.dirty = false; out.textContent = t("farmplan.saved");
      if (await load()) draw();
    });
    return fpEl("div", { class: "fp-row fp-savehint" }, b, out);
  }

  // --- legend ---------------------------------------------------------------
  let legendEl = null;
  function legendRefresh() { if (legendEl) legendEl.replaceChildren(...legendItems()); }
  function legendItems() {
    if (state.layer === "zones") return KINDS.map((k) => chip(KIND_COLOUR[k], t(`farmplan.kind.${k}`)));
    return ["low", "medium", "high", "none"].map((k) => chip(LEVEL_COLOUR[k], t(`farmplan.level.${k}`)));
  }
  const chip = (colour, label) => fpEl("span", { class: "fp-chip" }, fpEl("i", { style: `background:${colour}` }), label);
  function legendBlock() {
    legendEl = fpEl("div", { class: "fp-legend" }, ...legendItems());
    return fpEl("div", {}, legendEl, fpEl("p", { class: "fp-small" }, state.layer === "zones" ? t("farmplan.zones.draft") : t("farmplan.threat.note")));
  }

  // --- soil: modelled and measured side by side, never merged ---------------
  function soilBlock() {
    const card = fpEl("div", { class: "fp-card" }, fpEl("h3", {}, t("farmplan.soil.title")), fpNote("info", t("farmplan.soil.source")));
    if (state.soilErr) card.append(fpFail(t, state.soilErr));
    if (state.soilNote) card.append(fpNote("info", state.soilNote));
    const by = (prop, src) => state.soil.filter((x) => x.property === prop && x.source === src);
    const table = fpEl("table", { class: "fp-table" }, fpEl("thead", {}, fpEl("tr", {}, fpEl("th", {}, t("farmplan.soil.property")), fpEl("th", {}, t("farmplan.soil.modelled")), fpEl("th", {}, t("farmplan.soil.measured")))));
    const tb = fpEl("tbody");
    const inputs = {};
    for (const p of SOIL_PROPS) {
      const m = by(p, "modelled").map((x) => x.value).join(", ");
      const f = by(p, "measured_by_farmer").map((x) => x.value).join(", ");
      const inp = fpEl("input", { type: "text", "aria-label": t(`farmplan.soil.p_${p}`), placeholder: t("farmplan.soil.type_here"), value: "" });
      inputs[p] = inp;
      tb.append(fpEl("tr", {},
        fpEl("th", { scope: "row" }, t(`farmplan.soil.p_${p}`)),
        fpEl("td", {}, m ? fpEl("span", {}, m, " ", fpEl("em", { class: "fp-tag fp-tag-model" }, t("farmplan.tag.modelled"))) : t("farmplan.soil.none")),
        fpEl("td", {}, f ? fpEl("span", {}, f, " ", fpEl("em", { class: "fp-tag fp-tag-farmer" }, t("farmplan.tag.farmer"))) : "", inp)));
    }
    table.append(tb);
    const out = fpEl("span", { "aria-live": "polite" });
    const save = fpEl("button", { class: "fp-btn fp-btn-2", type: "button" }, t("farmplan.soil.save"));
    save.addEventListener("click", async () => {
      const typed = SOIL_PROPS.filter((p) => inputs[p].value.trim()).map((p) => ({ property: p, value: inputs[p].value.trim(), zone_id: null, source: "measured_by_farmer" }));
      if (!typed.length) { out.textContent = t("farmplan.soil.nothing"); return; }
      // The server replaces ALL values measured by the farmer, so keep the earlier ones that were not retyped.
      const kept = state.soil.filter((x) => x.source === "measured_by_farmer" && !typed.some((n) => n.property === x.property && (n.zone_id ?? null) === (x.zone_id ?? null)))
        .map((x) => ({ property: x.property, value: x.value, zone_id: x.zone_id ?? null, source: "measured_by_farmer" }));
      const layers = [...kept, ...typed];
      save.disabled = true;
      const r = await fpCall("PUT", `/farms/${id}/soil`, { layers });
      save.disabled = false;
      if (!r.ok) { out.replaceChildren(fpFail(t, r)); return; }
      if (await load()) draw();
    });
    card.append(fpEl("div", { class: "fp-scroll" }, table), fpEl("p", { class: "fp-small" }, t("farmplan.soil.prefer")), fpEl("div", { class: "fp-row" }, save, out));
    return card;
  }

  // --- threat list and the farmer's own checklist ---------------------------
  function threatListBlock() {
    const card = fpEl("div", { class: "fp-card" }, fpEl("h3", {}, t("farmplan.threat.title")));
    if (state.threatErr) card.append(fpFail(t, state.threatErr));
    const computed = state.threats.filter((x) => x.source !== "farmer");
    const farmer = state.threats.filter((x) => x.source === "farmer");
    if (!computed.length && !state.threatErr) card.append(fpNote("info", t("farmplan.threat.none")));
    const ul = fpEl("ul", { class: "fp-list" });
    for (const x of computed) ul.append(fpEl("li", {}, fpEl("strong", {}, t(`farmplan.threat.${x.kind}`)), ": ", t(`farmplan.level.${x.level || "none"}`), " ", fpEl("em", { class: "fp-tag fp-tag-model" }, t("farmplan.tag.modelled"))));
    card.append(ul, fpNote("info", t("farmplan.threat.erosion_note")));
    card.append(fpEl("h4", {}, t("farmplan.threat.mine")));
    const fl = fpEl("ul", { class: "fp-list" });
    for (const x of farmer) fl.append(fpEl("li", {}, t(`farmplan.threat.${x.kind}`), x.note ? ` (${x.note})` : "", " ", fpEl("em", { class: "fp-tag fp-tag-farmer" }, t("farmplan.tag.farmer"))));
    card.append(fl);
    const sel = fpEl("select", { "aria-label": t("farmplan.threat.add") });
    for (const k of FARMER_THREATS) sel.append(fpEl("option", { value: k }, t(`farmplan.threat.${k}`)));
    const note = fpEl("input", { type: "text", "aria-label": t("farmplan.threat.note_label"), placeholder: t("farmplan.threat.note_label") });
    const out = fpEl("span", { "aria-live": "polite" });
    const add = fpEl("button", { class: "fp-btn fp-btn-2", type: "button" }, t("farmplan.threat.add"));
    add.addEventListener("click", async () => {
      add.disabled = true;
      const r = await fpCall("POST", `/farms/${id}/threats`, { kind: sel.value, note: note.value.trim() || null });
      add.disabled = false;
      if (!r.ok) { out.replaceChildren(fpFail(t, r)); return; }
      if (await load()) draw();
    });
    card.append(fpEl("div", { class: "fp-row" }, sel, note, add, out));
    return card;
  }

  if (await load()) draw();
}
