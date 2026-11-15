// Screen 2 (opens first): the advice for one tank, in plain words.
//   1. the signal and ONE sentence saying what to grow
//   2. four fact tiles (tank water, rain this season, last season's start, El Niño years),
//      each with its source; the ones that decided the signal are marked "Main reason"
//   3. the other two options, folded away
//   4. buttons to the water/rain charts and to the print/share card
// Everything here was decided by pipeline/rules.py; the app only displays it.
import { t } from "./i18n.js";
import { signalIcon, signalKey, sourceBadge, num, escapeHtml, levelWord, seasonName, capNames } from "./ui.js";
import { gauge } from "./tank.js";
import { forecastMarkup, fillForecast } from "./forecast.js";
import { rainBlockMarkup, fillRain } from "./nowcast.js";

// Which fact tile each rule reason belongs to (see pipeline/rules.py).
const REASON_TILE = {
  "reason.tank_far_below_normal": "tank", "reason.tank_below_normal": "tank", "reason.tank_normal": "tank",
  "reason.rain_below_normal": "rain", "reason.rain_normal": "rain", "reason.rain_unknown": "rain",
  "reason.onset_late": "onset",
};

export function renderPlan(doc, panel, mode = "advanced", tank = null) {
  const result = doc.result;
  if (!result) {
    panel.innerHTML = `<p class="figure">${escapeHtml(t("advice.none"))}</p>`;
    return;
  }
  if (mode === "simple") return renderSimple(doc, panel, tank);
  const key = signalKey(result.signal);
  const others = result.scenarios.filter((s) => !s.recommended);
  // Amber with water for every field (e.g. only the rains came late): no bethma needed.
  const advice = adviceSentence(result);

  panel.innerHTML = `
    <section class="answer" aria-labelledby="signal-title">
      <p class="for-season" id="signal-title">${escapeHtml(t("signal.title"))}</p>
      <div class="signal ${key}">
        ${signalIcon(result.signal)}
        <span class="sig-word">${escapeHtml(t(`signal.short.${key}`))}</span>
        <p class="advice">${escapeHtml(advice)}</p>
      </div>
    </section>

    ${tank ? rainBlockMarkup() : ""}

    <section class="block forecast-block" aria-labelledby="fc-title">
      <h2 id="fc-title">${escapeHtml(t("forecast.title"))}</h2>
      ${forecastMarkup()}
    </section>

    <section class="block" aria-labelledby="facts-title">
      <h2 id="facts-title">${escapeHtml(t("facts.title"))}</h2>
      <div class="facts">${factTiles(doc, result).join("")}</div>
    </section>

    <div class="plan-actions">
      <button type="button" class="action" data-tab="week">${escapeHtml(t("week.open"))}</button>
      <button type="button" class="action" data-tab="crops">${escapeHtml(t("crops.open"))}</button>
      <button type="button" class="action" data-tab="weather">${escapeHtml(t("weather.open"))}</button>
      <button type="button" class="action" data-tab="tank">${escapeHtml(t("plan.see_details"))}</button>
      <button type="button" class="action" data-tab="card">${escapeHtml(t("plan.print_share"))}</button>
    </div>

    ${others.length ? `
    <details class="other-options">
      <summary>${escapeHtml(t("plan.other_options"))}</summary>
      <ul>${others.map((s) => `
        <li>
          <strong>${escapeHtml(t(s.title_key))}</strong>
          <span>${escapeHtml(t(s.title_key.replace(/\.title$/, ".text")))}</span>
          <span class="note">${escapeHtml(t("plan.crops"))}: ${escapeHtml(s.crops.map((c) => t(`crop.${c}`)).join(", "))}</span>
        </li>`).join("")}
      </ul>
    </details>` : ""}

    ${glossary()}`;
  if (tank) { fillRain(panel.querySelector(".rain-block"), tank, { advanced: true }); fillForecast(panel.querySelector(".forecast-block"), tank, doc); }
}

// ---------------------------------------------------------------------------
// Simple view (for farmers): the advice, then three picture cards in one plain
// sentence each — tank water, when the rains came, heat. No numbers to decode,
// no charts. "See more details" opens the Advanced view of this page.
// ---------------------------------------------------------------------------
export function adviceSentence(result) {
  const key = signalKey(result.signal);
  const share = result.scenarios.find((s) => s.recommended)?.share_of_command_area;
  const adviceKey = key === "amber" && share >= 1 ? "advice.amber_full" : `advice.${key}`;
  return t(adviceKey, { value: share == null ? "" : Math.round(share * 100) });
}

function waterSentence(T) {
  if (T === null || T === undefined) return t("simple.water.none");
  const level = T < 0.6 ? "much_less" : T < 0.9 ? "less" : T <= 1.1 ? "usual" : T <= 1.4 ? "more" : "much_more";
  return t(`simple.water.${level}`);
}

function rainSentence(d) {
  if (d === null || d === undefined) return t("simple.rain.none");
  if (d > 0) return t("simple.rain.late", { value: d });
  if (d < 0) return t("simple.rain.early", { value: -d });
  return t("simple.rain.on_time");
}

function heatSentence(doc, seasonLabel) {
  const season = (doc.rain?.seasons || []).find((s) => s.season === seasonLabel);
  const kind = seasonLabel?.split(" ")[0];
  const usual = doc.rain?.extremes?.normals?.[kind]?.hot_days;
  if (!season || season.hot_days === null || season.hot_days === undefined || usual == null) {
    return t("simple.heat.none");
  }
  // More than a quarter above or below the usual number of hot days counts as different.
  if (season.hot_days > usual * 1.25) return t("simple.heat.hotter");
  if (season.hot_days < usual * 0.75) return t("simple.heat.cooler");
  return t("simple.heat.usual");
}

const RAIN_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 30a9 9 0 0 1 1-18 12 12 0 0 1 22 4 7 7 0 0 1-1 14z" fill="#2F5D9E"/><path d="M17 35l-2 6M25 35l-2 6M33 35l-2 6" stroke="#2F5D9E" stroke-width="3" stroke-linecap="round"/></svg>`;
const CLOUD_SUN_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="17" cy="16" r="7" fill="#E0A100"/><path d="M16 38a8 8 0 0 1 1-16 11 11 0 0 1 20 3 6.5 6.5 0 0 1-1 13z" fill="#2F5D9E"/></svg>`;
const SUN_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="#E0A100"/><g stroke="#E0A100" stroke-width="3.5" stroke-linecap="round"><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.5 10.5l4.2 4.2M33.3 33.3l4.2 4.2M10.5 37.5l4.2-4.2M33.3 14.7l4.2-4.2"/></g></svg>`;

// A big tappable card with the crop advice: it works even when the tank's water isn't known yet.
function cropTeaser(doc) {
  const c = doc.crops;
  if (!c) return "";
  const good = c.items.filter((i) => i.rating === "good").map((i) => t(`crop.${i.id}`));
  const headline = good.length ? t("crops.headline.some", { crops: capNames(good) }) : t("crops.headline.none");
  return `
    <button type="button" class="crop-teaser" data-tab="crops">
      <span class="crop-teaser-text">
        <strong>${escapeHtml(t("crops.title"))}</strong>
        <span class="crop-teaser-headline">${escapeHtml(headline)}</span>
        <span class="fact-small">${escapeHtml(t("crops.teaser"))}</span>
      </span>
      <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`;
}

function renderSimple(doc, panel, tank) {
  const result = doc.result;
  const key = signalKey(result.signal);
  const inputs = result.inputs || {};
  const T = inputs.T;
  panel.innerHTML = `
    <section class="answer" aria-labelledby="signal-title">
      <p class="for-season" id="signal-title">${escapeHtml(t("signal.title"))}</p>
      <div class="signal ${key}">
        ${signalIcon(result.signal)}
        <span class="sig-word">${escapeHtml(t(`signal.short.${key}`))}</span>
        <p class="advice">${escapeHtml(adviceSentence(result))}</p>
      </div>
    </section>

    ${cropTeaser(doc)}

    ${tank ? rainBlockMarkup() : ""}

    <section class="simple-cards">
      <div class="simple-card">
        <div class="simple-pic">${T === null || T === undefined ? "" : gauge(T, "simple-gauge")}</div>
        <h2>${escapeHtml(t("simple.water.title"))}</h2>
        <p>${escapeHtml(waterSentence(T))}</p>
      </div>
      <div class="simple-card">
        <div class="simple-pic icon">${RAIN_ICON}</div>
        <h2>${escapeHtml(t("simple.rain.title"))}</h2>
        <p>${escapeHtml(rainSentence(inputs.onset_delay_days))}</p>
      </div>
      <div class="simple-card">
        <div class="simple-pic icon">${SUN_ICON}</div>
        <h2>${escapeHtml(t("simple.heat.title"))}</h2>
        <p>${escapeHtml(heatSentence(doc, inputs.onset_season))}</p>
      </div>
      <div class="simple-card forecast-block">
        <div class="simple-pic icon">${CLOUD_SUN_ICON}</div>
        <h2>${escapeHtml(t("forecast.title"))}</h2>
        <div class="simple-fc">${forecastMarkup()}</div>
      </div>
      <p class="simple-source">${escapeHtml(t("simple.source"))}</p>
    </section>

    <div class="plan-actions">
      <button type="button" class="action" data-tab="week">${escapeHtml(t("week.open"))}</button>
      <button type="button" class="action" data-tab="crops">${escapeHtml(t("crops.open"))}</button>
      <button type="button" class="action" data-tab="weather">${escapeHtml(t("weather.open"))}</button>
      <button type="button" class="action" data-tab="card">${escapeHtml(t("plan.print_share"))}</button>
      <button type="button" class="action" data-more>${escapeHtml(t("simple.more"))}</button>
    </div>`;
  if (tank) { fillRain(panel.querySelector(".rain-block"), tank); fillForecast(panel.querySelector(".forecast-block"), tank, doc); }
}

// ---------------------------------------------------------------------------
// The four fact tiles (Advanced view)
// ---------------------------------------------------------------------------
function factTiles(doc, result) {
  const inputs = result.inputs || {};
  const main = new Set(result.reasons.filter((r) => r.kind === "rule").map((r) => REASON_TILE[r.text_key]));
  const pct = (x) => (x === null || x === undefined ? null : Math.round(x * 100));
  const waterSrc = doc.water?.source, rainSrc = doc.rain?.source;

  const T = pct(inputs.T);
  const R = pct(inputs.R);
  const d = inputs.onset_delay_days;
  const onset = d === null || d === undefined ? t("fact.onset.none")
    : d > 0 ? t("fact.onset.late", { value: d })
    : d < 0 ? t("fact.onset.early", { value: -d }) : t("fact.onset.on_time");
  const e = doc.elnino;

  // Big text in plain words ("Less than usual"); the exact percentage as small print.
  return [
    tile("tank", t("fact.tank.label"), T === null ? t("fact.no_data") : levelWord(inputs.T),
      T === null ? "" : t("fact.percent", { value: T }), waterSrc, main),
    tile("rain", t("fact.rain.label"), R === null ? t("fact.rain.none") : levelWord(inputs.R),
      R === null ? "" : t("fact.percent", { value: R }), rainSrc, main),
    tile("onset", t("fact.onset.label", { season: seasonName(inputs.onset_season) }), onset, "", rainSrc, main),
    e && e.total ? tile("elnino", t("fact.elnino.label"),
      t("fact.elnino.value", { value: e.below_normal_count, total: e.total }), t("fact.elnino.help"), e.source, main) : "",
  ];
}

function tile(id, label, value, small, source, main) {
  const isMain = main.has(id);
  return `
    <div class="fact ${isMain ? "main" : ""}">
      ${isMain ? `<span class="fact-main">${escapeHtml(t("facts.main"))}</span>` : ""}
      <span class="fact-label">${escapeHtml(label)}</span>
      <strong class="fact-value">${escapeHtml(value)}</strong>
      ${small ? `<span class="fact-small">${escapeHtml(small)}</span>` : ""}
      ${sourceBadge(shortSource(source))}
    </div>`;
}

// "What do these words mean?": every term a farmer meets on this page, in one place.
function glossary() {
  const terms = ["colours", "yala", "maha", "bethma", "short_paddy", "ofc", "elnino", "satellite"];
  return `
    <details class="other-options glossary">
      <summary>${escapeHtml(t("help.title"))}</summary>
      <ul>${terms.map((k) => `<li>${escapeHtml(t(`help.${k}`))}</li>`).join("")}</ul>
    </details>`;
}

// "NASA POWER (PRECTOTCORR; MERRA2, POWER)" → "NASA POWER": short enough for a small tile.
// The full name is on the charts page and in the data files.
function shortSource(source) {
  return source ? source.split(" (")[0] : source;
}

// Fill a reason's text from its value; the El Niño line stays a count ("1 of 3").
// Used by the summary card.
export function reasonText(r) {
  const digits = r.unit === "percent" || r.unit === "days" || r.unit === "count" ? 0 : 1;
  return t(r.text_key, {
    value: r.value === null ? t("state.no_data") : num(r.value, digits),
    total: r.total ?? "",
    source: r.source ?? "",
  });
}
