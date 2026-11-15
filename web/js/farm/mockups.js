// Farm planner, screen "Notes and monitoring": MOCK-UPS. Everything here is stored on the server but NOT analysed yet
// (spec section 0, item 6). Every block carries the label "Prototype: stored but not analysed yet".
//   - soil monitoring points and visits (with the simple trend the server returns, if any)
//   - traditional practice entry (with consent choices: who may see it, show my name)
//   - season review and the issue ticket
//   - a roadmap panel: alerts, learning loop, officer review and village view are described, not built
import { t as tGlobal } from "../i18n.js";
import { fpEl, fpCall, fpNote, fpFail, fpEnsureCss } from "./zones.js";

const list = (d, ...names) => { for (const n of names) if (d && Array.isArray(d[n])) return d[n]; return Array.isArray(d) ? d : []; };
const ROADMAP = ["alerts", "learning", "officer", "village"];

export async function renderMockups(ctx, farmId, view) {
  fpEnsureCss();
  const root = view || ctx.view;
  const t = ctx.t || tGlobal;
  const id = farmId ?? ctx.farm?.id;
  root.innerHTML = "";
  const page = fpEl("div", { class: "fp-page" });
  root.append(page);
  page.append(fpEl("h2", {}, t("farmplan.mock.title")), fpEl("p", { class: "fp-lead" }, t("farmplan.mock.lead")));

  // Field helpers --------------------------------------------------------------
  const proto = () => fpEl("p", { class: "fp-note fp-proto" }, t("farmplan.proto"));
  const field = (label, input) => fpEl("label", { class: "fp-field" }, label, input);
  const num = (key, extra = {}) => fpEl("input", { type: "number", inputmode: "decimal", "aria-label": t(key), ...extra });
  const txt = (key) => fpEl("input", { type: "text", "aria-label": t(key) });
  const numOrNull = (el) => (el.value === "" ? null : Number(el.value));
  const section = (key, ...kids) => fpEl("section", { class: "fp-card", "aria-labelledby": `fp-${key}` }, fpEl("h3", { id: `fp-${key}` }, t(`farmplan.mock.${key}`)), proto(), ...kids);
  // A submit button that posts `build()` and shows saved / the failure.
  const sender = (path, build, after) => {
    const msg = fpEl("span", { "aria-live": "polite" });
    const b = fpEl("button", { class: "fp-btn", type: "button" }, t("farmplan.save"));
    b.addEventListener("click", async () => {
      const body = build();
      if (!body) { msg.textContent = t("farmplan.fill_first"); return; }
      b.disabled = true;
      const r = await fpCall("POST", path, body);
      b.disabled = false;
      if (!r.ok) { msg.replaceChildren(fpFail(t, r)); return; }
      msg.textContent = t("farmplan.saved");
      if (after) after(r.data);
    });
    return fpEl("div", { class: "fp-row" }, b, msg);
  };

  // --- 1. monitoring points and visits ---------------------------------------
  const points = await fpCall("GET", `/farms/${id}/monitoring-points`);
  if (points.offline) { page.append(fpFail(t, points)); return; }
  const pts = points.ok ? list(points.data, "items", "points") : [];

  const secPoints = section("points");
  const ul = fpEl("ul", { class: "fp-list" });
  for (const p of pts) ul.append(fpEl("li", {}, p.label || `#${p.id}`, ` (${Number(p.lat).toFixed(5)}, ${Number(p.lon).toFixed(5)})`));
  if (!pts.length) ul.append(fpEl("li", {}, t("farmplan.mock.nopoints")));
  const pLabel = txt("farmplan.mock.p_label");
  const pLat = num("farmplan.mock.p_lat", { step: "any", value: ctx.farm?.lat ?? "" });
  const pLon = num("farmplan.mock.p_lon", { step: "any", value: ctx.farm?.lon ?? "" });
  const here = fpEl("button", { class: "fp-btn fp-btn-2", type: "button" }, t("farmplan.mock.use_gps"));
  here.addEventListener("click", () => navigator.geolocation?.getCurrentPosition((g) => { pLat.value = g.coords.latitude.toFixed(6); pLon.value = g.coords.longitude.toFixed(6); }));
  secPoints.append(ul, field(t("farmplan.mock.p_label"), pLabel), field(t("farmplan.mock.p_lat"), pLat), field(t("farmplan.mock.p_lon"), pLon), fpEl("div", { class: "fp-row" }, here),
    sender(`/farms/${id}/monitoring-points`, () => (pLat.value && pLon.value ? { lat: Number(pLat.value), lon: Number(pLon.value), label: pLabel.value.trim() || null } : null), () => renderMockups(ctx, farmId, view)));
  page.append(secPoints);

  const secVisit = section("visit");
  const pSel = fpEl("select", { "aria-label": t("farmplan.mock.pick_point") });
  for (const p of pts) pSel.append(fpEl("option", { value: p.id }, p.label || `#${p.id}`));
  const vDate = fpEl("input", { type: "date", value: new Date().toISOString().slice(0, 10), "aria-label": t("farmplan.mock.v_date") });
  const worms = num("farmplan.mock.v_worms", { min: "0", step: "1" });
  const infil = num("farmplan.mock.v_infil", { min: "0", step: "any" });
  const colour = fpEl("select", { "aria-label": t("farmplan.mock.v_colour") }, fpEl("option", { value: "" }, "-"), ...[1, 2, 3, 4, 5].map((n) => fpEl("option", { value: n }, n)));
  const crumb = fpEl("select", { "aria-label": t("farmplan.mock.v_crumb") }, fpEl("option", { value: "" }, "-"), ...[1, 2, 3, 4, 5].map((n) => fpEl("option", { value: n }, n)));
  const cover = num("farmplan.mock.v_cover", { min: "0", max: "100", step: "1" });
  const ph = num("farmplan.mock.v_ph", { min: "3", max: "10", step: "0.1" });
  const vNote = txt("farmplan.mock.v_note");
  if (!pts.length) secVisit.append(fpNote("info", t("farmplan.mock.add_point_first")));
  else {
    secVisit.append(field(t("farmplan.mock.pick_point"), pSel), field(t("farmplan.mock.v_date"), vDate),
      fpEl("p", { class: "fp-small" }, t("farmplan.mock.v_guide")),
      field(t("farmplan.mock.v_worms"), worms), field(t("farmplan.mock.v_infil"), infil), field(t("farmplan.mock.v_colour"), colour), field(t("farmplan.mock.v_crumb"), crumb),
      field(t("farmplan.mock.v_cover"), cover), field(t("farmplan.mock.v_ph"), ph), field(t("farmplan.mock.v_note"), vNote),
      sender(`/farms/${id}/soil-observations`, () => {
        const body = { point_id: Number(pSel.value), visited_on: vDate.value, earthworms: numOrNull(worms), infiltration_minutes: numOrNull(infil), colour_class: numOrNull(colour), crumb_class: numOrNull(crumb), cover_percent: numOrNull(cover), ph: numOrNull(ph), note: vNote.value.trim() || null };
        return body.visited_on && [body.earthworms, body.infiltration_minutes, body.colour_class, body.crumb_class, body.cover_percent, body.ph].some((v) => v !== null) ? body : null;
      }, () => renderMockups(ctx, farmId, view)));
  }
  // Earlier visits, listed as they were typed, then the plain first-to-latest change the server gives (it says "not enough data" itself).
  const obs = await fpCall("GET", `/farms/${id}/soil-observations`);
  const rows = obs.ok ? list(obs.data, "items") : [];
  if (rows.length) {
    const tb = fpEl("tbody");
    for (const r of rows) tb.append(fpEl("tr", {}, ...["visited_on", "earthworms", "infiltration_minutes", "colour_class", "crumb_class", "cover_percent", "ph"].map((k) => fpEl("td", {}, r[k] ?? "-"))));
    secVisit.append(fpEl("h4", {}, t("farmplan.mock.history")), fpEl("div", { class: "fp-scroll" }, fpEl("table", { class: "fp-table" },
      fpEl("thead", {}, fpEl("tr", {}, ...["v_date", "v_worms", "v_infil", "v_colour", "v_crumb", "v_cover", "v_ph"].map((k) => fpEl("th", {}, t(`farmplan.mock.${k}`))))), tb)));
  }
  const trend = await fpCall("GET", `/farms/${id}/soil-trend`);
  const tpts = trend.ok ? list(trend.data, "points") : [];
  const METRIC_KEY = { earthworms: "v_worms", infiltration_minutes: "v_infil", colour_class: "v_colour", crumb_class: "v_crumb", cover_percent: "v_cover", ph: "v_ph" };
  const lines = [];
  for (const pt of tpts) for (const [m, v] of Object.entries(pt.metrics || {})) {
    if (v.status === "ok") lines.push(fpEl("li", {}, `${pt.label || `#${pt.point_id}`}: ${t(`farmplan.mock.${METRIC_KEY[m] || m}`)}: ${v.first.value} -> ${v.latest.value}`));
  }
  if (rows.length) secVisit.append(fpEl("h4", {}, t("farmplan.mock.trend")), lines.length ? fpEl("ul", { class: "fp-list" }, ...lines) : fpEl("p", { class: "fp-small" }, t("farmplan.mock.trend_none")), fpEl("p", { class: "fp-small" }, t("farmplan.mock.notrend")));
  page.append(secVisit);

  // --- 2. traditional practice entry ------------------------------------------
  const secPrac = section("practice", fpEl("p", { class: "fp-small" }, t("farmplan.mock.pr_why")));
  const pr = { name: txt("farmplan.mock.pr_name"), plants: txt("farmplan.mock.pr_plants"), where: txt("farmplan.mock.pr_where"), season: txt("farmplan.mock.pr_season"), effect: txt("farmplan.mock.pr_effect"), holder: txt("farmplan.mock.pr_holder"), years: num("farmplan.mock.pr_years", { min: "0", step: "1" }) };
  const vis = fpEl("select", { "aria-label": t("farmplan.mock.pr_vis") }, ...["private", "village", "public"].map((v) => fpEl("option", { value: v }, t(`farmplan.mock.vis_${v}`))));
  const showName = fpEl("input", { type: "checkbox" });
  const consent = fpEl("input", { type: "checkbox" });
  secPrac.append(...Object.entries(pr).map(([k, el]) => field(t(`farmplan.mock.pr_${k}`), el)), field(t("farmplan.mock.pr_vis"), vis),
    fpEl("label", { class: "fp-check" }, showName, t("farmplan.mock.pr_name_show")),
    fpEl("label", { class: "fp-check" }, consent, t("farmplan.mock.pr_consent")),
    fpNote("info", t("farmplan.mock.pr_status")),
    sender("/practices", () => (pr.name.value.trim() && consent.checked ? { name: pr.name.value.trim(), plants: pr.plants.value.trim() || null, zone_or_soil: pr.where.value.trim() || null, season: pr.season.value.trim() || null, effect: pr.effect.value.trim() || null, holder: pr.holder.value.trim() || null, years_in_use: numOrNull(pr.years), visibility: vis.value, show_name: showName.checked } : null)));
  page.append(secPrac);

  // --- 3. season review --------------------------------------------------------
  const sr = { season: txt("farmplan.mock.sr_season"), planted: txt("farmplan.mock.sr_planted"), problems: txt("farmplan.mock.sr_problems"), change: txt("farmplan.mock.sr_change") };
  const band = fpEl("select", { "aria-label": t("farmplan.mock.sr_yield") }, fpEl("option", { value: "" }, "-"), ...["low", "usual", "high"].map((v) => fpEl("option", { value: v }, t(`farmplan.mock.band_${v}`))));
  const followed = fpEl("select", { "aria-label": t("farmplan.mock.sr_followed") }, fpEl("option", { value: "" }, "-"), ...["yes", "partly", "no"].map((v) => fpEl("option", { value: v }, t(`farmplan.mock.fol_${v}`))));
  page.append(section("review", field(t("farmplan.mock.sr_season"), sr.season), field(t("farmplan.mock.sr_planted"), sr.planted), field(t("farmplan.mock.sr_yield"), band),
    field(t("farmplan.mock.sr_problems"), sr.problems), field(t("farmplan.mock.sr_followed"), followed), field(t("farmplan.mock.sr_change"), sr.change),
    sender(`/farms/${id}/season-review`, () => (sr.season.value.trim() ? { season: sr.season.value.trim(), planted: sr.planted.value.trim() || null, yield_band: band.value || null, problems: sr.problems.value.trim() || null, plan_followed: followed.value || null, would_change: sr.change.value.trim() || null } : null))));

  // --- 4. issue ticket ----------------------------------------------------------
  const isKind = fpEl("select", { "aria-label": t("farmplan.mock.is_kind") }, ...["pest", "disease", "water", "plan_wrong", "other"].map((v) => fpEl("option", { value: v }, t(`farmplan.mock.isk_${v}`))));
  const isCrop = txt("farmplan.mock.is_crop");
  const isText = fpEl("textarea", { rows: "3", "aria-label": t("farmplan.mock.is_text") });
  page.append(section("issue", fpEl("p", { class: "fp-small" }, t("farmplan.mock.is_help")), field(t("farmplan.mock.is_kind"), isKind), field(t("farmplan.mock.is_crop"), isCrop), field(t("farmplan.mock.is_text"), isText),
    sender(`/farms/${id}/issues`, () => (isText.value.trim() ? { kind: isKind.value, crop_id: isCrop.value.trim() || null, text: isText.value.trim() } : null))));

  // --- 5. roadmap (described only) ----------------------------------------------
  const road = fpEl("section", { class: "fp-card", "aria-labelledby": "fp-road" }, fpEl("h3", { id: "fp-road" }, t("farmplan.road.title")), fpNote("proto", t("farmplan.road.note")));
  const rl = fpEl("ul", { class: "fp-list" });
  for (const k of ROADMAP) rl.append(fpEl("li", {}, fpEl("strong", {}, t(`farmplan.road.${k}`)), ": ", t(`farmplan.road.${k}_text`), " ", fpEl("em", { class: "fp-tag fp-tag-road" }, t("farmplan.road.tag"))));
  road.append(rl);
  page.append(road, fpEl("p", { class: "fp-small" }, t("farmplan.expertise")));
}
