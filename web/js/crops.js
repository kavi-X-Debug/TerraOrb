// "What to sow now" page of one tank: which crops the expected rain can support.
//
// Everything shown comes from the tank's "crops" section, written by pipeline/crops.py:
//   crop water need  = FAO-56 crop coefficients x evapotranspiration worked out from NASA POWER temperatures
//   rain expected    = the 16-day forecast (Open-Meteo, not NASA) first, then the usual rain (NASA POWER 1981+)
//   how often enough = share of past years (NASA POWER) in which the rain was enough for a sowing on this date
//   paddy            = follows the tank water signal, because it needs the tank as well as rain
// The page only shows these numbers; it works nothing out.
import { t } from "./i18n.js";
import { signalIcon, badges, num, date, escapeHtml, capNames, cropPhoto } from "./ui.js";

// Rating -> the shared signal icon (shape + colour + word, never colour alone)
const ICON_FOR = { good: "green", possible: "amber", not_now: "red", unknown: null };

function cropName(id) {
  return t(`crop.${id}`);
}

// One plain sentence saying why, built from the numbers in the data.
function reason(item, crops, mode) {
  if (mode !== "advanced") return simpleReason(item);
  return numbersReason(item, crops);
}

// Simple view: a plain sentence, no millimetres.
function simpleReason(item) {
  if (item.kind === "paddy") {
    if (item.rating === "unknown") return t("crops.reason.paddy_unknown");
    return t(item.rating === "good" ? "crops.simple.paddy_good" : "crops.simple.paddy_not_now");
  }
  let text = t(`crops.simple.${item.rating}`);
  if (item.past_years && item.rating === "good") text += " " + t("crops.simple.history", { ok: item.past_years_ok, years: item.past_years });
  return text;
}

// Advanced view: the numbers.
function numbersReason(item, crops) {
  if (item.kind === "paddy") {
    if (item.rating === "unknown") return t("crops.reason.paddy_unknown");
    return t("crops.reason.paddy", {
      need: num(item.need_mm, 0), rain: num(item.rain_mm, 0), tank: num(item.tank_mm, 0),
      signal: t(`signal.short.${crops.signal || "none"}`),
    });
  }
  let text = t("crops.reason.ofc", { need: num(item.need_mm, 0), days: item.duration_days, rain: num(item.rain_mm, 0) });
  if (item.past_years) text += " " + t("crops.reason.history", { ok: item.past_years_ok, years: item.past_years });
  return text;
}

function card(item, crops, mode) {
  return `
  <li class="crop-card rating-${item.rating}">
    <span class="crop-icon">${signalIcon(ICON_FOR[item.rating])}</span>
    <div class="crop-text">
      <h3>${cropPhoto(item.id, cropName(item.id), "crop-thumb")}${escapeHtml(cropName(item.id))} <span class="crop-rating">${escapeHtml(t(`crops.rating.${item.rating}`))}</span></h3>
      <p>${escapeHtml(reason(item, crops, mode))}</p>
    </div>
  </li>`;
}

// Advanced view: the numbers behind each rating
function table(crops) {
  const rows = crops.items.map((i) => `
    <tr>
      <th scope="row">${escapeHtml(cropName(i.id))}</th>
      <td>${i.duration_days}</td>
      <td>${num(i.need_mm, 0)}</td>
      <td>${num(i.rain_mm, 0)}</td>
      <td>${num(i.ratio, 2)}</td>
      <td>${i.past_years ? `${i.past_years_ok} / ${i.past_years}` : "—"}</td>
      <td>${i.tank_mm == null ? "—" : num(i.tank_mm, 0)}</td>
      <td>${escapeHtml(t(`crops.rating.${i.rating}`))}</td>
    </tr>`).join("");
  const head = ["crop", "days", "need", "rain", "ratio", "years", "tank", "rating"]
    .map((k) => `<th>${escapeHtml(t(`crops.col.${k}`))}</th>`).join("");
  return `
  <div class="table-scroll">
    <table class="crop-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="note">${escapeHtml(t("crops.adv.explain", {
    ratio: Math.round(crops.settings.good_ratio * 100), reliability: Math.round(crops.settings.good_reliability * 100) }))}</p>`;
}

// ---------------------------------------------------------------------------
// "When to sow": one row per crop, one cell per week for the next 12 weeks.
// Each cell has the rating's colour AND its own shape (tick / ! / cross), never colour alone.
// ---------------------------------------------------------------------------
const DAY_MS = 86400000;

function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// "Sow between 25 Oct and 28 Nov" for the first run of good weeks, or "no good week".
function bestWeeks(weeks, id) {
  const ratings = weeks.map((w) => w.items.find((i) => i.id === id).rating);
  const first = ratings.indexOf("good");
  if (first < 0) return t("crops.cal.none", { crop: cropName(id) });
  let last = first;
  while (last + 1 < ratings.length && ratings[last + 1] === "good") last++;
  const fmt = (iso) => date(iso, { day: "numeric", month: "short" });
  return t("crops.cal.best", { crop: cropName(id), from: fmt(weeks[first].start), to: fmt(addDays(weeks[last].start, 6)) });
}

export function calendarBlock(crops) {
  const weeks = crops.calendar;
  if (!weeks || !weeks.length) return "";
  const ids = weeks[0].items.map((i) => i.id);
  // A month label above the first week of each month
  const months = weeks.map((w, k) => {
    const m = w.start.slice(5, 7);
    return k === 0 || m !== weeks[k - 1].start.slice(5, 7)
      ? `<span class="cal-month">${escapeHtml(date(w.start, { month: "short" }))}</span>` : "<span></span>";
  }).join("");
  const rows = ids.map((id) => {
    const cells = weeks.map((w) => {
      const i = w.items.find((x) => x.id === id);
      const label = `${cropName(id)}, ${date(w.start, { day: "numeric", month: "long" })}: ${t(`crops.rating.${i.rating}`)}`;
      return `<li class="cal-cell rating-${i.rating}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${signalIcon(ICON_FOR[i.rating])}</li>`;
    }).join("");
    return `<div class="cal-row"><h4>${escapeHtml(cropName(id))}</h4><ol class="cal-strip">${cells}</ol></div>`;
  }).join("");
  const legend = ["good", "possible", "not_now"].map((r) =>
    `<span class="cal-key">${signalIcon(ICON_FOR[r])}${escapeHtml(t(`crops.rating.${r}`))}</span>`).join("");
  return `
  <section class="block calendar-block" aria-labelledby="cal-title">
    <h2 id="cal-title">${escapeHtml(t("crops.cal.title"))}</h2>
    <ul class="cal-best">${ids.map((id) => `<li>${escapeHtml(bestWeeks(weeks, id))}</li>`).join("")}</ul>
    <div class="cal-months" aria-hidden="true">${months}</div>
    ${rows}
    <div class="cal-legend">${legend}</div>
    <p class="note">${escapeHtml(t("crops.cal.help"))}</p>
    <p class="note">${escapeHtml(t("crops.cal.paddy"))}</p>
  </section>`;
}

export function renderCrops(tank, doc, panel, mode) {
  const crops = doc.crops;
  if (!crops) {
    panel.innerHTML = `<section class="block"><h2>${escapeHtml(t("crops.title"))}</h2><p>${escapeHtml(t("crops.missing"))}</p></section>`;
    return;
  }
  const good = crops.items.filter((i) => i.rating === "good");
  const headline = good.length
    ? t("crops.headline.some", { crops: capNames(good.map((i) => cropName(i.id))) })
    : t("crops.headline.none");
  panel.innerHTML = `
  <img class="page-art" src="img/crops.jpg" alt="" width="1400" height="423" loading="lazy">
  <section class="block crops-block" aria-labelledby="crops-title">
    <h2 id="crops-title">${escapeHtml(t("crops.title"))}</h2>
    <p class="crops-headline">${escapeHtml(headline)}</p>
    <p class="note">${escapeHtml(t("crops.intro", { date: date(crops.sow_date) }))}</p>
    ${mode === "advanced" ? `<p class="note">${escapeHtml(t("crops.rain_ahead", { forecast: num(crops.forecast_16_mm, 0), usual: num(crops.usual_16_mm, 0) }))}</p>` : ""}
    <ul class="crop-list">${crops.items.map((i) => card(i, crops, mode)).join("")}</ul>
    ${mode === "advanced" ? table(crops) : ""}
  </section>
  ${calendarBlock(crops)}
  <section class="block">
    <p class="note">${escapeHtml(t("crops.note"))}</p>
    <details class="other-options">
      <summary>${escapeHtml(t("crops.about"))}</summary>
      <p class="note">${escapeHtml(t("crops.rain_ahead", { forecast: num(crops.forecast_16_mm, 0), usual: num(crops.usual_16_mm, 0) }))}</p>
      <p class="note">${escapeHtml(t("crops.draft"))}</p>
      <p class="note">${escapeHtml(t("crops.sources", { list: crops.sources.join("; ") }))}</p>
      ${badges("NASA POWER, FAO, Open-Meteo", crops.demo)}
      <p class="note">${escapeHtml(t("label.updated", { date: date(crops.updated) }))}</p>
    </details>
  </section>`;
}
