// Trip planner screen: best travel dates for one destination  (#/plan/dates[/<destId>]).
//
// The visitor chooses a place, how many days the trip lasts, a range of dates to search and a few wishes. findBestDates()
// (web/js/trip/dates.js) ranks the possible ranges. Days inside the 16-day forecast use the Open-Meteo forecast (NOT NASA data);
// days further ahead use the NASA POWER historical tendency and are never shown as a forecast. Every result carries a badge that
// says which kind of data it is built on. The score is a planning rule of thumb, not a scientific index.
import { t } from "../../i18n.js";
import { h as H } from "../ui.js";
import { loadForecast } from "../forecast.js";
import { findBestDates } from "../dates.js";
import { ACTIVITIES } from "../activities.js";
import { getPrefs } from "../store.js";
import { todayISO, addDays, daysBetween, validDate, destPicker, forecastSource } from "./rain.js";

const MAX_RANGE_DAYS = 365, MAX_DURATION = 14;

export async function renderDates(ctx, parts, view) {
  const { ui, data, cfg } = ctx; const h = ui.h;
  ui.ensureCss("trip-a");
  const today = todayISO();
  const dest = parts[0] ? data.byId.get(parts[0]) : null;
  let saved = {};
  try { saved = getPrefs() || {}; } catch { saved = {}; }

  view.replaceChildren(h("header", { class: "ta-head" }, h("h1", { text: t("tripa.dates.title") }), h("p", { class: "ta-sub", text: t("tripa.dates.sub") })));
  if (!data.destinations.length) { view.append(h("p", { class: "tp-state error", role: "alert", text: t("tripa.err.no_dests") })); return; }

  const picker = destPicker(ctx, { id: "ta-dates", selected: dest?.id || "", onChange: (id) => ctx.go(`#/plan/dates/${id}`) });
  const msg = h("p", { class: "ta-formmsg", role: "alert" });
  const results = h("div", { class: "ta-results", "aria-live": "polite" });

  const num = (id, label, value, min, max, step = 1) => h("label", { class: "tp-field", for: id }, h("span", { text: label }), h("input", { type: "number", id, value, min, max, step, inputmode: "decimal" }));
  const dateField = (id, label, value) => h("label", { class: "tp-field", for: id }, h("span", { text: label }), h("input", { type: "date", id, value: value || "", min: today }));
  const select = (id, label, opts, current) => h("label", { class: "tp-field", for: id }, h("span", { text: label }),
    h("select", { id }, opts.map((o) => h("option", { value: o, text: t(`tripa.pref.${id.replace("ta-dates-", "")}.${o}`), selected: o === current }))));

  const interests = h("fieldset", { class: "ta-interests" }, h("legend", { text: t("tripa.dates.interests") }),
    h("div", { class: "ta-checks" }, Object.entries(ACTIVITIES).map(([id, a]) => h("label", { class: "ta-check" },
      h("input", { type: "checkbox", value: id, checked: (saved.interests || []).includes(id) }), h("span", { text: t(a.key) })))));

  const form = h("section", { class: "tp-card ta-controls" }, picker.el,
    h("div", { class: "ta-daterow" },
      num("ta-dates-days", t("tripa.dates.duration"), 3, 1, MAX_DURATION),
      num("ta-dates-maxrain", t("tripa.dates.maxrain"), saved.maxRainMm ?? "", 0, 500, 0.5)),
    h("div", { class: "ta-daterow" }, dateField("ta-dates-from", t("tripa.dates.from"), today), dateField("ta-dates-to", t("tripa.dates.to"), addDays(today, 60))),
    interests,
    h("div", { class: "ta-daterow" },
      select("ta-dates-temp", t("tripa.dates.temp"), ["any", "cool", "mild", "warm"], saved.preferredTemp || "any"),
      select("ta-dates-style", t("tripa.dates.style"), ["relaxed", "balanced", "adventurous"], saved.style || "balanced")),
    h("details", { class: "ta-orig" }, h("summary", { text: t("tripa.dates.original") }),
      h("div", { class: "ta-daterow" }, dateField("ta-dates-ostart", t("tripa.dates.ostart"), ""), dateField("ta-dates-oend", t("tripa.dates.oend"), "")),
      h("p", { class: "ta-fine", text: t("tripa.dates.original_hint") })),
    h("div", { class: "ta-btnrow" }, h("button", { type: "button", class: "tp-btn primary", id: "ta-dates-go", text: t("tripa.dates.find"), onclick: () => find(false) })),
    msg);
  view.append(form, results);

  if (parts[0] && !dest) { results.append(h("p", { class: "tp-state error", role: "alert", text: t("tripa.err.unknown_dest") })); return; }
  if (!dest) { results.append(h("p", { class: "tp-state", text: t("tripa.dates.pick") })); return; }
  results.append(h("p", { class: "tp-state", text: t("tripa.dates.ready") }));

  const val = (id) => view.querySelector(`#${id}`)?.value;

  async function find(force) {
    msg.textContent = "";
    const days = Math.round(Number(val("ta-dates-days")));
    const from = val("ta-dates-from"), to = val("ta-dates-to");
    if (!Number.isFinite(days) || days < 1 || days > MAX_DURATION) { msg.textContent = t("tripa.dates.err_duration", { max: MAX_DURATION }); return; }
    if (!validDate(from) || !validDate(to)) { msg.textContent = t("tripa.err.bad_date"); return; }
    if (from < today) { msg.textContent = t("tripa.err.past_date"); return; }
    if (to < from) { msg.textContent = t("tripa.cmp.end_before"); return; }
    if (daysBetween(from, to) + 1 < days) { msg.textContent = t("tripa.dates.err_short"); return; }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) { msg.textContent = t("tripa.dates.err_long", { max: MAX_RANGE_DAYS }); return; }
    let original = null;
    const os = val("ta-dates-ostart"), oe = val("ta-dates-oend");
    if (os || oe) {
      if (!validDate(os) || !validDate(oe) || oe < os) { msg.textContent = t("tripa.dates.err_original"); return; }
      original = { start: os, end: oe };
    }
    const maxRaw = val("ta-dates-maxrain");
    const prefs = {
      interests: [...view.querySelectorAll(".ta-checks input:checked")].map((i) => i.value),
      maxRainMm: maxRaw === "" || maxRaw === undefined ? null : Number(maxRaw),
      preferredTemp: val("ta-dates-temp") || "any", style: val("ta-dates-style") || "balanced", budget: saved.budget ?? null, region: saved.region ?? null,
    };
    ui.loading(results, "tripa.dates.working");
    let fc;
    try { fc = await loadForecast(dest, { force }); } catch (e) { fc = { ok: false, error: String(e) }; }
    if (!results.isConnected) return;
    if (!data.history && !fc?.ok) { ui.errorBox(results, "tripa.err.forecast", () => find(true)); return; }
    let out;
    try {
      out = findBestDates({ dest, forecast: fc?.ok ? fc : null, history: data.history, durationDays: days, rangeStart: from, rangeEnd: to, prefs, original, today, cfg, limit: 5 });
    } catch (e) { console.error(e); ui.errorBox(results, "tripa.err.compute", () => find(true)); return; }
    show(out, fc, days, original);
  }

  function badgesOf(kind) {
    if (kind === "forecast") return [ui.badge("forecast")];
    if (kind === "tendency") return [ui.badge("tendency")];
    return [ui.badge("forecast"), ui.badge("tendency")];
  }

  function rangeCard(r, rank, opts = {}) {
    const dur = daysBetween(r.start, r.end) + 1;
    return H("article", { class: `tp-card ta-range${rank === 1 ? " best" : ""}` },
      H("h3", null, rank ? H("span", { class: "ta-rank", text: `#${rank}` }) : null,
        `${ui.fmtDate(r.start, { weekday: "short", day: "numeric", month: "short" })} - ${ui.fmtDate(r.end, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`),
      H("div", { class: "ta-source" }, badgesOf(r.dataKind), H("span", { class: "ta-fine", text: t("tripa.days", { n: dur }) })),
      H("div", { class: "ta-cards" },
        stat2(t("tripa.dates.score"), r.score === null || r.score === undefined ? "–" : `${Math.round(r.score)} / 100`),
        stat2(t("tripa.dates.rain"), r.rainMm === null || r.rainMm === undefined ? "–" : ui.fmtMm(r.rainMm)),
        stat2(t("tripa.dates.prain"), r.pRain === null || r.pRain === undefined ? "–" : ui.fmtPct(r.pRain <= 1 ? r.pRain * 100 : r.pRain)),
        r.heavyHours === null || r.heavyHours === undefined ? null : stat2(t("tripa.dates.heavy"), t("tripa.hours", { n: r.heavyHours }))),
      r.dataKind !== "forecast" ? H("p", { class: "ta-note", text: r.dataKind === "tendency" ? t("tripa.dates.tend_note") : t("tripa.dates.mixed_note") }) : null,
      (r.reasons || []).length ? H("ul", { class: "ta-say" }, r.reasons.map((x) => H("li", { text: t(x.key, x.params) }))) : null,
      opts.extra || null);
  }
  const stat2 = (k, v) => H("div", { class: "ta-stat" }, H("span", { class: "ta-stat-k", text: k }), H("strong", { text: v }));

  function show(out, fc, days, original) {
    const list = out?.results || [];
    const frag = [];
    const src = H("div", { class: "ta-source" });
    if (fc?.ok) src.append(forecastSource(ctx, fc)); else src.append(H("p", { class: "ta-note", role: "status", text: t("tripa.dates.no_forecast") }));
    if (data.history) src.append(ui.badge("tendency")); else src.append(H("p", { class: "ta-note", text: t("tripa.err.no_history") }));
    frag.push(src);
    for (const n of out?.notes || []) frag.push(H("p", { class: "ta-note", text: t(n.key, n.params) }));
    if (!list.length) frag.push(H("p", { class: "tp-state", text: t("tripa.dates.none") }));
    else {
      frag.push(H("h2", { class: "ta-h2", text: t("tripa.dates.results", { name: ui.destName(dest), n: days }) }));
      list.forEach((r, i) => frag.push(rangeCard(r, i + 1)));
    }
    if (original) {
      const o = out?.original || null;
      if (!o) frag.push(H("section", { class: "tp-card" }, H("h2", { text: t("tripa.dates.orig_title") }), H("p", { class: "tp-state", text: t("tripa.dates.orig_none") })));
      else {
        const best = list[0];
        let verdict = null;
        if (best && Number.isFinite(best.score) && Number.isFinite(o.score)) {
          const diff = Math.round(best.score - o.score);
          verdict = diff > 0 ? t("tripa.dates.orig_worse", { points: diff, start: ui.fmtDate(best.start), end: ui.fmtDate(best.end) }) : t("tripa.dates.orig_ok");
        }
        frag.push(H("section", { class: "ta-orig-box" }, H("h2", { class: "ta-h2", text: t("tripa.dates.orig_title") }),
          rangeCard({ ...o, start: o.start || original.start, end: o.end || original.end }, 0, { extra: verdict ? H("p", { class: "ta-effect", text: verdict }) : null })));
      }
    }
    frag.push(H("p", { class: "ta-fine", text: t("tripa.dates.score_note") }));
    results.replaceChildren(...frag);
  }
}
