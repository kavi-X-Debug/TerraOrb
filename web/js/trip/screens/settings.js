// Trip planner: Settings (#/plan/settings).
// Edit the rain-intensity thresholds, the score weights, the comfort limits and the forecast cache time. Changes are saved in this
// browser only (config.saveSettings -> localStorage "mc-trip-settings") and can be reset. The screen also shows honestly which models
// and data files are in use and when each was made, and can clear the saved trips and packing lists after a confirmation.
// All values are DRAFT rules of thumb for planning, not an official standard.
import { DEFAULTS, getConfig, saveSettings, resetSettings, getSettingsOverrides } from "../config.js";
import { listTrips, deleteTrip, removeKey, storageAvailable, getLastForecastStamp } from "../store.js";
import { lastDest } from "./explore.js";

// ctx.ui has the element helpers; the text function t comes from ctx.t, so both are handed out together.
const U = (ctx) => ({ ...ctx.ui, t: ctx.t });

const WEIGHT_KEYS = ["weather", "activity", "preference", "environment"];
const SECTIONS = [
  { id: "intensity", fields: [["light_min", 0.1], ["moderate_min", 0.1], ["heavy_min", 0.5], ["very_heavy_min", 1]], unit: "mm/h", step: "0.1" },
  { id: "comfort", fields: [["temp_ideal_min", 1], ["temp_ideal_max", 1], ["cold_c", 1], ["hot_c", 1], ["windy_kmh", 1], ["strong_kmh", 1]], unit: null, step: "1" },
];
const UNITS = { light_min: "mm/h", moderate_min: "mm/h", heavy_min: "mm/h", very_heavy_min: "mm/h", temp_ideal_min: "°C", temp_ideal_max: "°C", cold_c: "°C", hot_c: "°C", windy_kmh: "km/h", strong_kmh: "km/h" };

// Defaults as the visitor would get them without their own changes: built-in values, then the data file
function baseConfig(data) {
  const merged = { ...DEFAULTS };
  for (const [k, v] of Object.entries(data.config || {})) merged[k] = v && typeof v === "object" && !Array.isArray(v) && typeof DEFAULTS[k] === "object" ? { ...DEFAULTS[k], ...v } : v;
  return merged;
}

export async function renderSettings(ctx, parts, view) {
  ctx.ui.ensureCss("trip-b");
  const { h, t, toast, modal } = U(ctx);
  const cfg = getConfig();
  const base = baseConfig(ctx.data);
  const inputs = {};                                   // "section.key" -> input element
  const num = (id, label, value, def, unit, step, min, max) => {
    const el = h("input", { type: "number", id, value: String(value), step, min, max, inputmode: "decimal", required: true, "aria-describedby": `${id}-d` });
    inputs[id] = el;
    return h("div", { class: "tp-field tb-num" }, h("label", { for: id, text: label }), h("div", { class: "tb-numrow" }, el, h("span", { class: "tb-unit", text: unit })),
      h("small", { class: "tb-hint", id: `${id}-d`, text: t("tripb.set.default", { v: def }) }));
  };

  const form = h("form", { class: "tb-settings", novalidate: true });
  const errors = h("p", { class: "tb-error", role: "alert", hidden: true });

  // 1 + 3: intensity thresholds and comfort limits
  for (const sec of SECTIONS) {
    const box = h("fieldset", { class: "tp-card tb-fieldset" }, h("legend", { text: t(`tripb.set.${sec.id}`) }), h("p", { class: "tb-sub", text: t(`tripb.set.${sec.id}.lead`) }));
    const grid = h("div", { class: "tb-formgrid" });
    for (const [key] of sec.fields) grid.append(num(`${sec.id}.${key}`, t(`tripb.set.f.${key}`), cfg[sec.id][key], base[sec.id][key], UNITS[key], sec.step, "0", "200"));
    box.append(grid); form.append(box);
  }

  // 2: weights (percent) with a live total
  const wbox = h("fieldset", { class: "tp-card tb-fieldset" }, h("legend", { text: t("tripb.set.weights") }), h("p", { class: "tb-sub", text: t("tripb.set.weights.lead") }));
  const wgrid = h("div", { class: "tb-formgrid" });
  const wsum = Object.values(cfg.weights).reduce((s, x) => s + x, 0) || 1;
  for (const k of WEIGHT_KEYS) wgrid.append(num(`weights.${k}`, t(`tripb.s.part.${k}`), Math.round(((cfg.weights[k] || 0) / wsum) * 1000) / 10, Math.round((base.weights[k] || 0) * 100), "%", "1", "0", "100"));
  const total = h("p", { class: "tb-total", role: "status", "aria-live": "polite" });
  wbox.append(wgrid, total, h("p", { class: "tb-note", text: t("tripb.set.weights.note") }));
  form.append(wbox);
  const showTotal = () => {
    const sum = WEIGHT_KEYS.reduce((s, k) => s + (Number(inputs[`weights.${k}`].value) || 0), 0);
    total.textContent = t(Math.abs(sum - 100) < 0.05 ? "tripb.set.total_ok" : "tripb.set.total_scaled", { n: Math.round(sum * 10) / 10 });
    total.className = `tb-total${Math.abs(sum - 100) < 0.05 ? "" : " warn"}`;
  };
  for (const k of WEIGHT_KEYS) inputs[`weights.${k}`].addEventListener("input", showTotal);
  showTotal();

  // 4: forecast cache + language
  const cbox = h("fieldset", { class: "tp-card tb-fieldset" }, h("legend", { text: t("tripb.set.cache") }), h("p", { class: "tb-sub", text: t("tripb.set.cache.lead") }),
    num("cache_minutes", t("tripb.set.f.cache_minutes"), cfg.cache_minutes, base.cache_minutes, t("tripb.set.minutes"), "5", "5", "240"),
    h("p", { class: "tb-note", text: t("tripb.set.language") }));
  form.append(cbox);

  const readNum = (id) => Number(inputs[id].value);
  function validate() {
    const bad = [];
    for (const [id, el] of Object.entries(inputs)) { const v = Number(el.value); const ok = el.value.trim() !== "" && Number.isFinite(v) && v >= Number(el.min || 0) && v <= Number(el.max || 1e9); el.setAttribute("aria-invalid", ok ? "false" : "true"); if (!ok) bad.push(t("tripb.set.err.range", { name: el.closest(".tb-num").querySelector("label").textContent, min: el.min, max: el.max })); }
    const g = (k) => readNum(`intensity.${k}`);
    if (!(g("light_min") < g("moderate_min") && g("moderate_min") < g("heavy_min") && g("heavy_min") < g("very_heavy_min"))) bad.push(t("tripb.set.err.order_rain"));
    if (!(readNum("comfort.temp_ideal_min") < readNum("comfort.temp_ideal_max"))) bad.push(t("tripb.set.err.order_temp"));
    if (!(readNum("comfort.windy_kmh") < readNum("comfort.strong_kmh"))) bad.push(t("tripb.set.err.order_wind"));
    if (WEIGHT_KEYS.reduce((s, k) => s + (Number(inputs[`weights.${k}`].value) || 0), 0) <= 0) bad.push(t("tripb.set.err.weights_zero"));
    return [...new Set(bad)];
  }

  form.append(errors, h("div", { class: "tb-actions" },
    h("button", { type: "submit", class: "tp-btn primary", text: t("tripb.set.save") }),
    h("button", { type: "button", class: "tp-btn", text: t("tripb.set.reset"), onclick: () => { resetSettings(); toast("tripb.set.reset_done", "ok"); renderSettings({ ...ctx, cfg: getConfig() }, parts, view); } })));

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const bad = validate();
    errors.hidden = !bad.length;
    errors.replaceChildren(...bad.map((b) => h("span", { class: "tb-errline", text: b })));
    if (bad.length) { form.querySelector("[aria-invalid=true]")?.focus(); return; }
    const sum = WEIGHT_KEYS.reduce((s, k) => s + Number(inputs[`weights.${k}`].value), 0);
    const weights = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Math.round((Number(inputs[`weights.${k}`].value) / sum) * 1000) / 1000]));
    const next = { ...getSettingsOverrides(), weights, cache_minutes: readNum("cache_minutes"),
      intensity: { ...cfg.intensity, ...Object.fromEntries(SECTIONS[0].fields.map(([k]) => [k, readNum(`intensity.${k}`)])) },
      comfort: { ...cfg.comfort, ...Object.fromEntries(SECTIONS[1].fields.map(([k]) => [k, readNum(`comfort.${k}`)])) } };
    if (saveSettings(next)) { toast("tripb.set.saved", "ok"); renderSettings({ ...ctx, cfg: getConfig() }, parts, view); }
    else toast("tripb.set.save_failed", "error");
  });

  view.replaceChildren(...[h("h1", { text: t("tripb.set.title") }), h("p", { class: "tb-lead", text: t("tripb.set.lead") }),
    storageAvailable() ? null : h("p", { class: "tp-state error", role: "alert", text: t("tripb.set.no_storage") }),
    form, modelsCard(ctx), dataCard(ctx), clearCard(ctx, modal, toast, h), h("p", { class: "tb-fine", text: t("trip.disclaimer") })].filter(Boolean));
}

// Which models are in use (honest): an ML estimate is shown only when a model beat the baseline on held-out data
function modelsCard(ctx) {
  const { h, t } = U(ctx); const m = ctx.data.modelMeta;
  const card = h("section", { class: "tp-card tb-card-plain", "aria-labelledby": "tb-h-models" }, h("h2", { id: "tb-h-models", text: t("tripb.model.title") }));
  if (!m) { card.append(h("p", { class: "tb-sub", text: t("tripb.model.missing") }), h("p", { text: t("tripb.model.imerg_unknown") })); return card; }
  const list = h("dl", { class: "tb-facts" });
  // Why no ML estimate: either no model beat both baselines, or one did but no estimate could be made (e.g. the newest rain data is too old).
  const beat = m.models_beat_baselines ?? m.any_model_beats_baseline;
  const why = m.ml_estimates && m.ml_estimates.reason;
  const mlText = m.ml_available ? t("tripb.model.ml_yes")
    : !beat ? t("tripb.model.ml_no_beat")
      : why ? t("tripb.model.ml_no_other", { reason: why }) : t("tripb.model.ml_no_other_unknown");
  list.append(h("div", {}, h("dt", { text: t("tripb.model.ml") }), h("dd", { text: mlText })),
    h("div", {}, h("dt", { text: t("tripb.model.imerg") }), h("dd", { text: m.imerg && m.imerg.used ? t("tripb.model.imerg_used") : t("tripb.model.imerg_not", { reason: m.imerg?.reason || t("tripb.na") }) })));
  card.append(list);
  const rows = (m.models || []).map((x) => h("tr", {}, h("th", { scope: "row", text: x.id }), h("td", { text: x.task || "–" }), h("td", { text: x.algo || "–" }),
    h("td", { text: x.metrics?.brier != null ? `${x.metrics.brier.toFixed?.(3) ?? x.metrics.brier}` : "–" }), h("td", { text: x.baseline?.brier != null ? `${x.baseline.brier.toFixed?.(3) ?? x.baseline.brier}` : "–" }),
    h("td", { text: t(x.beats_baseline ? "tripb.model.beats_yes" : "tripb.model.beats_no") })));
  if (rows.length) card.append(h("div", { class: "tb-tablewrap" }, h("table", { class: "tb-table" }, h("caption", { class: "tb-sub", text: t("tripb.model.caption") }),
    h("thead", {}, h("tr", {}, ["tripb.model.id", "tripb.model.task", "tripb.model.algo", "tripb.model.brier", "tripb.model.brier_base", "tripb.model.beats"].map((k) => h("th", { scope: "col", text: t(k) })))), h("tbody", {}, rows))));
  card.append(h("p", { class: "tb-note", text: t("tripb.model.rule") }));
  if ((m.limits || []).length) card.append(h("h3", { text: t("tripb.model.limits") }), h("ul", { class: "tb-reasons" }, m.limits.map((x) => h("li", { text: String(x) }))));
  return card;
}

// When each data file was made and where it comes from (destinations.json is read again here: data.js keeps only its list)
function dataCard(ctx) {
  const { h, t, stamp } = U(ctx); const d = ctx.data;
  const files = [
    ["tripb.data.destinations", "destinations.json", null],
    ["tripb.data.history", "rainfall_history.json", d.history],
    ["tripb.data.snapshot", "forecast_snapshot.json", d.snapshot],
    ["tripb.data.models", "model_metadata.json", d.modelMeta],
    ["tripb.data.env", "environmental_data.json", d.env],
    ["tripb.data.config", "trip_config.json", d.config],
  ];
  const cells = (meta) => [meta ? (meta.source || t("tripb.na")) : t("tripb.data.missing"), meta ? (meta.generated ? stamp(meta.generated) : t("tripb.na")) : t("tripb.data.missing")];
  const destRow = h("tr", {}, h("th", { scope: "row", text: t("tripb.data.destinations") }), h("td", { text: t("trip.state.loading") }), h("td", { text: t("trip.state.loading") }));
  const table = h("table", { class: "tb-table" }, h("caption", { class: "tb-sub", text: t("tripb.data.caption") }),
    h("thead", {}, h("tr", {}, ["tripb.data.what", "tripb.data.source", "tripb.data.made"].map((k) => h("th", { scope: "col", text: t(k) })))),
    h("tbody", {}, destRow, files.slice(1).map(([key, , meta]) => { const [src, made] = cells(meta); return h("tr", {}, h("th", { scope: "row", text: t(key) }), h("td", { text: src }), h("td", { text: made })); })));
  fetch("../data/trip/destinations.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((m) => {
    const [src, made] = cells(m); destRow.replaceChildren(h("th", { scope: "row", text: t("tripb.data.destinations") }), h("td", { text: src }), h("td", { text: made }));
  });
  const last = lastDest(); const lastStamp = last ? getLastForecastStamp(last) : null;
  return h("section", { class: "tp-card tb-card-plain", "aria-labelledby": "tb-h-data" }, h("h2", { id: "tb-h-data", text: t("tripb.data.title") }),
    h("div", { class: "tb-tablewrap" }, table),
    h("p", { class: "tb-sub", text: lastStamp ? t("tripb.data.fc_cache", { time: stamp(lastStamp, "tripb.time_only") }) : t("tripb.data.no_fc_cache") }),
    d.snapshot?.fetched_at ? h("p", { class: "tb-sub", text: t("tripb.data.snapshot_at", { time: stamp(d.snapshot.fetched_at, "tripb.time_only") }) }) : null,
    d.errors && d.errors.length ? h("p", { class: "tb-warnline", role: "status", text: t("tripb.data.errors", { files: d.errors.join(", ") }) }) : null,
    h("p", { class: "tb-note", text: t("tripb.data.sources") }));
}

// Remove the saved trips and packing lists from this browser (after a confirmation)
function clearCard(ctx, modal, toast, h) {
  const { t } = ctx;
  const n = () => { try { return listTrips().length; } catch { return 0; } };
  const btn = h("button", { type: "button", class: "tp-btn tb-danger", text: t("tripb.clear.btn"), onclick: () => {
    const count = n();
    modal({ title: t("tripb.clear.title"), body: t(count ? "tripb.clear.body" : "tripb.clear.body_none", { n: count }),
      actions: [{ label: t("tripb.cancel") }, { label: t("tripb.clear.confirm"), primary: true, onclick: () => {
        try {
          for (const tr of listTrips()) deleteTrip(tr.id);
          const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("mc-trip-pack-")) keys.push(k); }
          keys.forEach((k) => removeKey(k));
          toast("tripb.clear.done", "ok");
        } catch { toast("tripb.clear.failed", "error"); }
      } }] });
  } });
  return h("section", { class: "tp-card tb-card-plain", "aria-labelledby": "tb-h-clear" }, h("h2", { id: "tb-h-clear", text: t("tripb.clear.title") }), h("p", { class: "tb-sub", text: t("tripb.clear.lead") }), btn);
}
