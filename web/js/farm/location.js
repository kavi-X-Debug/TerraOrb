// Location card for one farm: zone, seasons, grid cell (from /location) and the climate profile (from /profile):
// monthly rain and water balance, when the rains start, dry spells, greenness (NDVI) and bare months.
// Every card shows its source; anything that is not NASA data says "Not NASA data"; area-level numbers say "area-level";
// placeholder thresholds say "draft". Empty or missing data says "not enough data", never a guess.
// At the end: yes/no questions that compare what the satellite says with what the farmer knows (ground truth).
import { h } from "./api.js";

const NASA_WORDS = /NASA|POWER|MODIS|SMAP|GPM|IMERG|SRTM|GIBS|Earthdata|VIIRS/i;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v, d = 0) => (isNum(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : "");
const lang = () => document.documentElement.lang || "en";

// ---- small formatting helpers (names of months and dates come from the browser, not from our text files) ----
const monthShort = (m) => new Date(2001, m - 1, 1).toLocaleDateString(lang(), { month: "short" });
const monthLong = (m) => new Date(2001, m - 1, 1).toLocaleDateString(lang(), { month: "long" });
function monthDay(md) {                                           // "10-08" -> "Oct 8"
  const [m, d] = String(md || "").split("-").map(Number);
  return m && d ? new Date(2001, m - 1, d).toLocaleDateString(lang(), { month: "short", day: "numeric" }) : String(md ?? "");
}
function longDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(lang(), { year: "numeric", month: "short", day: "numeric" });
}
const median = (a) => { const s = a.filter(isNum).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- small chart pieces (plain HTML and CSS, no library) ----
// A row of bars. points: [{label, value}] ; empty values (null) are drawn as hatched gaps.
function barChart(t, points, { title, colour, strip = false, min, max } = {}) {
  const nums = points.map((p) => p.value).filter(isNum);
  if (!nums.length) return h("p", { class: "fm-note", text: t("farm.loc.not_enough") });
  const lo = min ?? Math.min(0, ...nums), hi = max ?? Math.max(...nums), span = hi - lo || 1;
  const wrap = h("div", { class: strip ? "fm-strip" : "fm-bars", role: "img", "aria-label": `${title || ""} ${t("farm.loc.chart_label", { n: points.length })}`.trim() });
  for (const p of points) {
    const share = isNum(p.value) ? Math.min(1, Math.max(0, (p.value - lo) / span)) : 0;
    const cell = h("span", { class: "fm-bar", title: `${p.label}: ${isNum(p.value) ? round(p.value, 2) : t("farm.loc.no_value")}` });
    if (!isNum(p.value)) cell.classList.add("fm-gap");
    else if (strip) cell.style.background = `hsl(${Math.round(25 + 95 * share)} 55% ${Math.round(82 - 38 * share)}%)`;   // brown (bare) to green
    else { cell.style.height = `${Math.max(3, Math.round(share * 100))}%`; if (colour) cell.style.background = colour; }
    wrap.append(cell);
  }
  return h("div", {}, wrap,
    h("p", { class: "fm-fine" }, `${points[0].label} - ${points[points.length - 1].label}`, ` (${t("farm.loc.range", { lo: round(Math.min(...nums), 2), hi: round(Math.max(...nums), 2) })})`));
}

// Twelve months, two bars each (rain and ET0), so a farmer can see where the water runs short.
function monthPairs(t, rain, et0) {
  const top = Math.max(...rain, ...et0, 1);
  const wrap = h("div", { class: "fm-months", role: "img", "aria-label": t("farm.loc.rain_vs_et0") });
  for (let m = 1; m <= 12; m++) {
    const bar = (v, cls) => { const b = h("span", { class: `fm-mbar ${cls}`, title: `${monthLong(m)}: ${round(v)} mm` }); b.style.height = `${Math.max(2, Math.round((100 * v) / top))}%`; return b; };
    wrap.append(h("div", { class: "fm-month" }, h("div", { class: "fm-mpair" }, bar(rain[m - 1], "fm-rain"), bar(et0[m - 1], "fm-et0")), h("span", { class: "fm-mname", text: monthShort(m) })));
  }
  return h("div", {}, wrap, h("p", { class: "fm-legend" }, h("span", { class: "fm-key fm-rain" }), t("farm.loc.key_rain"), " ", h("span", { class: "fm-key fm-et0" }), t("farm.loc.key_et0")));
}

// ---- cards ----
function card(t, titleKey, source, ...body) {
  const c = h("section", { class: "fm-card" }, h("h2", { class: "fm-h2", text: t(titleKey) }), ...body);
  if (source) c.append(sourceLine(t, source));
  return c;
}
const note = (text, warn = false) => h("p", { class: warn ? "fm-note" : "fm-fine", text });
const notEnough = (t) => h("p", { class: "fm-note", text: t("farm.loc.not_enough") });

// Source, period, resolution, and the tags: Not NASA data, Demo data, Draft thresholds, Area-level.
function sourceLine(t, d) {
  const src = Array.isArray(d.source) ? d.source.join("; ") : d.source;
  const line = h("p", { class: "fm-source" }, h("span", { text: src ? t("farm.loc.source", { source: src }) : t("farm.loc.source_missing") }));
  if (d.period) line.append(h("span", { text: t("farm.loc.period", { period: d.period }) }));
  if (d.nasa === false || (src && !NASA_WORDS.test(src))) line.append(h("span", { class: "fm-tag fm-tag-warn", text: t("farm.loc.not_nasa") }));
  if (d.demo === true) line.append(h("span", { class: "fm-tag fm-tag-warn", text: t("farm.loc.demo") }));
  if (d.thresholds_are_placeholders) line.append(h("span", { class: "fm-tag fm-tag-warn", text: t("farm.loc.draft") }));
  if (d.resolution && /area/i.test(d.resolution)) line.append(h("span", { class: "fm-tag", text: t("farm.loc.area_level", { res: d.resolution }) }));
  return line;
}

function placeCard(t, farm) {
  return h("section", { class: "fm-card" }, h("h2", { class: "fm-h2", text: t("farm.sec.place") }),
    h("dl", { class: "fm-facts" },
      h("dt", { text: t("farm.loc.f_where") }), h("dd", { text: `${Number(farm.lat).toFixed(4)}, ${Number(farm.lon).toFixed(4)}` }),
      h("dt", { text: t("farm.loc.f_area") }), h("dd", { text: t("farm.loc.ha", { ha: farm.area_ha }) }),
      farm.plot_source ? [h("dt", { text: t("farm.loc.f_plot") }), h("dd", { text: t(`farm.loc.plot_${farm.plot_source}`) })] : null));
}

// /location: zone, elevation, seasons, grid cell.
function zoneCard(t, loc) {
  const z = loc.climatic_zone || {};
  const body = [];
  if (loc.covered === false || loc.in_pilot_area === false) body.push(note(loc.coverage_note || t("farm.loc.outside_pilot"), true));
  const facts = h("dl", { class: "fm-facts" });
  if (z.name || z.value) {
    facts.append(h("dt", { text: t("farm.loc.f_zone") }), h("dd", {}, z.name || z.value, " ",
      z.confidence ? h("span", { class: "fm-tag fm-tag-warn", text: t("farm.loc.confidence", { level: z.confidence }) }) : null, " ",
      z.source && !NASA_WORDS.test(z.source) ? h("span", { class: "fm-tag fm-tag-warn", text: t("farm.loc.not_nasa") }) : null));
  }
  facts.append(h("dt", { text: t("farm.loc.f_elev" ) }), h("dd", { text: isNum(loc.elevation_m) ? t("farm.loc.metres", { m: round(loc.elevation_m) }) : t("farm.loc.elev_none") }));
  if (loc.grid_cell && loc.grid_cell.size) facts.append(h("dt", { text: t("farm.loc.f_cell") }), h("dd", { text: loc.grid_cell.size }));
  body.push(facts);
  if (z.note) body.push(note(z.note));
  if (loc.elevation_note && !isNum(loc.elevation_m)) body.push(note(loc.elevation_note));
  if (Array.isArray(loc.seasons) && loc.seasons.length) {
    body.push(h("h3", { class: "fm-h3", text: t("farm.loc.seasons") }));
    const ul = h("ul", { class: "fm-list" });
    for (const s of loc.seasons) ul.append(h("li", {}, h("strong", { text: s.name }), s.months ? `: ${s.months}` : "", s.note ? ` (${s.note})` : ""));
    body.push(ul);
  }
  if (loc.area_note) body.push(note(loc.area_note));
  return card(t, "farm.sec.location", loc, ...body);
}

function climateCard(t, c) {
  const rows = c && c.data;
  const months = rows && Array.from({ length: 12 }, (_, i) => rows[String(i + 1)]);
  if (!months || months.some((m) => !m || !m.rain_mm || !m.et0_mm)) return card(t, "farm.sec.climate_monthly", c || {}, notEnough(t));
  const rain = months.map((m) => m.rain_mm.mean), et0 = months.map((m) => m.et0_mm.mean), bal = months.map((m) => m.water_balance_mm && m.water_balance_mm.mean);
  const wettest = rain.indexOf(Math.max(...rain)) + 1;
  const short = bal.map((b, i) => (isNum(b) && b < 0 ? i + 1 : null)).filter(Boolean);
  return card(t, "farm.sec.climate_monthly", c,
    h("p", { text: t("farm.loc.wettest", { month: monthLong(wettest), mm: round(rain[wettest - 1]) }) }),
    h("p", { text: short.length ? t("farm.loc.short_months", { months: short.map(monthShort).join(", ") }) : t("farm.loc.no_short_months") }),
    monthPairs(t, rain, et0),
    c.thresholds_note ? note(c.thresholds_note) : null);
}

function onsetCard(t, o) {
  const seasons = o && o.data ? Object.entries(o.data) : [];
  if (!seasons.length) return card(t, "farm.sec.onset", o || {}, notEnough(t));
  const body = [];
  for (const [name, s] of seasons) {
    const sum = s.summary || {};
    body.push(h("h3", { class: "fm-h3", text: name }));
    if (!sum.median_month_day) { body.push(notEnough(t)); continue; }
    body.push(h("p", { text: t("farm.loc.onset_text", { median: monthDay(sum.median_month_day), earliest: monthDay(sum.earliest_month_day), latest: monthDay(sum.latest_month_day) }) }));
    body.push(h("p", { class: "fm-fine", text: t("farm.loc.onset_years", { n: sum.years_with_onset, none: sum.years_without_onset ?? 0 }) }));
    const pts = (s.by_year || []).map((y) => ({ label: String(y.year), value: isNum(y.days_after_window_start) ? y.days_after_window_start : null }));
    body.push(barChart(t, pts, { title: name, colour: "var(--monsoon, #2D6A9F)" }), note(t("farm.loc.onset_chart_help", { start: monthDay(s.onset_window_start) })));
  }
  return card(t, "farm.sec.onset", o, ...body);
}

function drySpellCard(t, d) {
  const seasons = d && d.data ? Object.entries(d.data) : [];
  if (!seasons.length) return card(t, "farm.sec.dry_spell", d || {}, notEnough(t));
  const body = [];
  for (const [name, s] of seasons) {
    const years = (s.by_year || []).filter((y) => isNum(y.longest_dry_spell_days));
    body.push(h("h3", { class: "fm-h3", text: name }));
    if (!years.length) { body.push(notEnough(t)); continue; }
    const worst = years.reduce((a, y) => (y.longest_dry_spell_days > a.longest_dry_spell_days ? y : a));
    body.push(h("p", { text: t("farm.loc.dry_text", { median: round(median(years.map((y) => y.longest_dry_spell_days))), worst: worst.longest_dry_spell_days, year: worst.year }) }));
    body.push(barChart(t, years.map((y) => ({ label: String(y.year), value: y.longest_dry_spell_days })), { title: name, colour: "#C98A00" }));
  }
  return card(t, "farm.sec.dry_spell", d, ...body);
}

function ndviCard(t, n, extraNote) {
  const dates = n && n.data && n.data.dates, vals = n && n.data && n.data.ndvi;
  if (!Array.isArray(dates) || !Array.isArray(vals) || !vals.some(isNum)) return card(t, "farm.sec.ndvi", n || {}, notEnough(t));
  const last = vals.slice(-46).map((v, i, a) => ({ label: dates[dates.length - a.length + i], value: isNum(v) ? v : null }));      // about the last year (one picture every 16 days)
  return card(t, "farm.sec.ndvi", n,
    h("p", { text: t("farm.loc.ndvi_text") }),
    barChart(t, last, { title: t("farm.sec.ndvi"), strip: true, min: 0, max: 1 }),
    n.data.tanks_in_cell ? note(t("farm.loc.ndvi_tanks", { n: n.data.tanks_in_cell })) : null,
    extraNote ? note(extraNote) : null);
}

function bareCard(t, b) {
  const rows = b && b.data;
  const months = rows && Array.from({ length: 12 }, (_, i) => rows[String(i + 1)]);
  if (!months || months.some((m) => !m)) return card(t, "farm.sec.bare", b || {}, notEnough(t));
  const share = months.map((m) => (isNum(m.share_of_years_bare) ? m.share_of_years_bare : null));
  const often = share.map((v, i) => (isNum(v) && v > 0.5 ? i + 1 : null)).filter(Boolean);
  const years = Math.max(...months.map((m) => m.years || 0));
  return card(t, "farm.sec.bare", b,
    h("p", { text: often.length ? t("farm.loc.bare_often", { months: often.map(monthShort).join(", ") }) : t("farm.loc.bare_never", { years }) }),
    barChart(t, share.map((v, i) => ({ label: monthShort(i + 1), value: v === null ? null : v })), { title: t("farm.sec.bare"), strip: true, min: 0, max: 1 }),
    note(t("farm.loc.bare_help")));
}

function soilCard(t, s) {
  const gone = s && s.available === false;
  const d = !gone && s && s.data && s.data.latest;
  if (d && isNum(d.l1) && isNum(d.l2)) {
    // plain words first: wetter or drier than usual for this month, from the z-score (draft cut-offs +-0.5 / +-1.5)
    const z = isNum(d.l1_z) ? d.l1_z : null;
    const level = z === null ? "same" : z <= -1.5 ? "much_drier" : z <= -0.5 ? "drier" : z >= 1.5 ? "much_wetter" : z >= 0.5 ? "wetter" : "same";
    const month = d.month ? new Date(`${d.month}-01T00:00:00`).toLocaleDateString(lang(), { year: "numeric", month: "long" }) : "";
    return card(t, "farm.sec.sm_anomaly", s,
      h("p", { text: t(`farm.loc.sm_${level}`, { month }) }),
      h("p", { class: "fm-fine", text: t("farm.loc.sm_values", { l1: round(d.l1, 1), l2: round(d.l2, 1), p1: isNum(d.l1_pct_of_usual) ? d.l1_pct_of_usual : "?", p2: isNum(d.l2_pct_of_usual) ? d.l2_pct_of_usual : "?" }) }),
      note(t("farm.loc.sm_help")));
  }
  return card(t, "farm.sec.sm_anomaly", s || {}, h("p", { class: "fm-note", text: gone ? `${t("farm.loc.not_available")}${s.reason ? ` ${s.reason}` : ""}` : t("farm.loc.not_enough") }));
}


// ---- NASA SMAP (satellite soil moisture), MODIS evapotranspiration and MODIS land temperature (made by pipeline/smap.py and modis_water.py) ----
function gapCard(t, key, b) {
  return card(t, key, b || {}, h("p", { class: "fm-note", text: `${t("farm.loc.not_available")}${b && b.reason ? ` ${b.reason}` : ""}` }));
}
const zLevel = (z) => (z === null || z === undefined ? "same" : z <= -1.5 ? "much_drier" : z <= -0.5 ? "drier" : z >= 1.5 ? "much_wetter" : z >= 0.5 ? "wetter" : "same");

function smapCard(t, s) {
  const d = s && s.available && s.data && s.data.latest;
  if (!d || !isNum(d.mean_m3m3)) return gapCard(t, "farm.sec.smap", s && s.available ? { ...s, reason: t("farm.loc.smap_few") } : s);
  return card(t, "farm.sec.smap", s,
    h("p", { text: t(`farm.loc.smap_${zLevel(d.z)}`, { to: longDate(d.to) }) }),
    h("p", { class: "fm-fine", text: t("farm.loc.smap_values", { v: Math.round(d.mean_m3m3 * 100), p: isNum(d.pct_of_usual) ? d.pct_of_usual : "?", n: d.n_values }) }),
    note(t("farm.loc.smap_help")));
}

function etCard(t, s) {
  const d = s && s.available && s.data && s.data.latest;
  if (!d || !isNum(d.mm_per_8days)) return gapCard(t, "farm.sec.et", s);
  const stress = isNum(d.et_over_pet) ? (d.et_over_pet < 0.4 ? "low" : d.et_over_pet < 0.7 ? "mid" : "high") : null;
  return card(t, "farm.sec.et", s,
    h("p", { text: t("farm.loc.et_text", { mm: round(d.mm_per_8days, 1), date: longDate(d.date), p: isNum(d.pct_of_usual) ? d.pct_of_usual : "?" }) }),
    stress ? h("p", { text: t(`farm.loc.et_${stress}`, { r: Math.round(d.et_over_pet * 100) }) }) : null,
    note(t("farm.loc.et_help")));
}

function lstCard(t, s) {
  const d = s && s.available && s.data && s.data.latest;
  if (!d || !isNum(d.day_c)) return gapCard(t, "farm.sec.lst", s);
  const diff = d.diff_from_usual_c, word = !isNum(diff) ? "nocmp" : Math.abs(diff) < 0.8 ? "same" : diff > 0 ? "hotter" : "cooler";      // no comparison when too few clear readings make the usual value
  return card(t, "farm.sec.lst", s,
    h("p", { text: t(`farm.loc.lst_${word}`, { c: round(d.day_c, 1), date: longDate(d.date), d: isNum(diff) ? round(Math.abs(diff), 1) : "" }) }),
    note(t("farm.loc.lst_help")));
}

// ---- ground truth: yes / no questions ----
// The profile may list its own prompts as groundtruth_prompts [{key, satellite_value, params}]; otherwise two questions are built from the data shown above.
function prompts(p) {
  const own = p && p.groundtruth_prompts;
  if (Array.isArray(own) && own.length) return own.map((x) => ({ key: x.key, value: x.satellite_value ?? null, params: x.params || {} }));
  const out = [];
  const first = p && p.onset && p.onset.data && Object.entries(p.onset.data)[0];
  if (first && first[1].summary && first[1].summary.median_month_day) {
    const d = monthDay(first[1].summary.median_month_day);
    out.push({ key: "rain_onset", value: first[1].summary.median_month_day, params: { season: first[0], date: d } });
  }
  const n = p && p.ndvi && p.ndvi.data;
  if (n && Array.isArray(n.ndvi)) {
    let i = n.ndvi.length - 1;
    while (i >= 0 && !isNum(n.ndvi[i])) i--;
    if (i >= 0) out.push({ key: "ndvi_latest", value: `${n.dates[i]} ${n.ndvi[i]}`, params: { date: longDate(n.dates[i]), value: round(n.ndvi[i], 2) } });
  }
  return out;
}

function questions(ctx, farm, p) {
  const { api, t } = ctx;
  const list = prompts(p);
  if (!list.length) return null;
  const box = h("section", { class: "fm-card" }, h("h2", { class: "fm-h2", text: t("farm.gt.title") }), h("p", { text: t("farm.gt.lead") }));
  for (const q of list) {
    const msg = h("p", { class: "fm-fine", role: "status" });
    const row = h("div", { class: "fm-choices" });
    const ask = async (answer) => {
      row.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        await api.post(`/farms/${farm.id}/groundtruth`, { question_key: q.key, satellite_value: q.value === null ? null : String(q.value), answer });
        msg.textContent = t("farm.gt.thanks"); msg.classList.remove("fm-error");
      } catch (err) {
        row.querySelectorAll("button").forEach((b) => { b.disabled = false; });
        msg.textContent = err.network ? t("farm.err.offline") : `${t("farm.gt.failed")} (${err.message})`;
        msg.classList.add("fm-error");
      }
    };
    row.append(h("button", { class: "fm-choice", type: "button", text: t("farm.gt.yes"), onclick: () => ask("yes") }),
      h("button", { class: "fm-choice", type: "button", text: t("farm.gt.no"), onclick: () => ask("no") }));
    box.append(h("div", { class: "fm-q" }, h("p", { class: "fm-label", text: t(`farm.gt.q.${q.key}`, q.params) }), row, msg));
  }
  return box;
}

export async function renderLocation(ctx) {
  const { api, view, farm, t } = ctx;
  view.innerHTML = "";
  const page = h("div", { class: "fm-page" });
  view.append(page);
  page.append(h("a", { class: "fm-back", href: "#/farm", text: t("farm.back_home") }),
    h("h1", { text: t("farm.loc.title", { name: farm.name || t("farm.home.unnamed") }) }),
    h("p", { class: "fm-lead", text: t("farm.loc.lead") }));
  const holder = h("div", { class: "fm-stack" }, h("p", { class: "fm-status", role: "status", text: t("farm.state.loading") }));
  page.append(holder);

  const [loc, prof] = await Promise.allSettled([api.get(`/farms/${farm.id}/location`), api.get(`/farms/${farm.id}/profile`)]);
  holder.innerHTML = "";
  if (loc.status === "rejected" && prof.status === "rejected") {
    const err = loc.reason;
    holder.append(h("p", { class: "fm-note fm-error", text: err.network ? t("farm.err.offline") : `${t("farm.loc.failed")} (${err.message})` }));
    return;
  }
  holder.append(placeCard(t, farm));
  holder.append(loc.status === "fulfilled" && loc.value ? zoneCard(t, loc.value) : note(t("farm.loc.no_location"), true));

  if (prof.status === "fulfilled" && prof.value && typeof prof.value === "object") {
    const p = prof.value;
    if (p.covered === false) {
      holder.append(note(p.coverage_note || t("farm.loc.outside_pilot"), true));
    } else {
      holder.append(climateCard(t, { ...p.climate_monthly, thresholds_note: p.climate_monthly_note }),
        onsetCard(t, p.onset), drySpellCard(t, p.dry_spells || p.dry_spell_by_year), ndviCard(t, p.ndvi, p.ndvi_note),
        bareCard(t, p.bare_calendar), soilCard(t, p.sm_anomaly), smapCard(t, p.smap), etCard(t, p.modis_et), lstCard(t, p.modis_lst));
      holder.append(note(t("farm.loc.cloud_note")));
      if (Array.isArray(p.gaps) && p.gaps.length) {
        holder.append(h("section", { class: "fm-card" }, h("h2", { class: "fm-h2", text: t("farm.loc.gaps_title") }),
          h("ul", { class: "fm-list" }, ...p.gaps.map((g) => h("li", { text: g })))));
      }
      const q = questions(ctx, farm, p);
      if (q) holder.append(q);
    }
    if (p.area_note) holder.append(note(p.area_note));
  } else {
    holder.append(note(prof.reason && prof.reason.network ? t("farm.err.offline") : t("farm.loc.no_profile"), true));
  }

  holder.append(note(t("farm.disclaimer")),
    h("div", { class: "fm-row" },
      h("a", { class: "fm-btn fm-primary", href: `#/farm/zones/${farm.id}`, text: t("farm.link.zones") }),
      h("a", { class: "fm-btn fm-secondary", href: `#/farm/plan/${farm.id}`, text: t("farm.link.plan") })));
}
