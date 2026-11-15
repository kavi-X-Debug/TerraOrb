// "This week" page of one tank: a short list of things to do and watch this week.
//
// The list is first built by pipeline/advisory.py from the tank's own data (water colour, forecast,
// NASA greenness, crop advice) and saved in the tank file. When the phone is online this page then
// REDOES the weather items (rain, heat, spray days) from the live 16-day forecast with the same
// thresholds (saved in advisory.settings), adds the rain of the last 7 days, and checks again every
// 10 minutes. Offline, or if Open-Meteo does not answer, the saved items stay and the page says so.
//
// The data file holds text keys and numbers; this file only turns them into sentences, so all words
// live in si.json / en.json. Each item says where it comes from (the weather is NOT NASA data).
import { t } from "./i18n.js";
import { loadForecast } from "./forecast.js";
import { date, weekdayName, localToday, escapeHtml, tankName } from "./ui.js";

const STALE_DAYS = 3;                    // saved advice older than this gets a warning line
const REFRESH_MS = 10 * 60 * 1000;
const API = "https://api.open-meteo.com/v1/forecast";

// Which source line each kind of item carries.
const SOURCE = { water: "week.src.rules", past: "week.src.recent", rain: "week.src.forecast", heat: "week.src.forecast",
                 spray: "week.src.forecast", green: "week.src.modis", crops: "week.src.crops" };
// Icon (a mask from style.css) per item.
const ICON = { water: "--i-drop", past: "--i-rain", rain: "--i-rain", heat: "--i-thermo", spray: "--i-cloud-sun",
               green: "--i-leaf", crops: "--i-sprout" };

let timer = null;                        // the 10-minute refresh of the page being shown

// One sentence for one item. Dates and crop names are filled in here, in the reader's language.
export function itemText(item) {
  const values = { ...(item.values || {}) };
  if (values.date) values.date = date(values.date, { day: "numeric", month: "long" });
  if (item.dates) values.dates = item.dates.map((d) => `${weekdayName(d, true)} ${+d.slice(8, 10)}`).join(", ");
  if (item.crops) values.crops = item.crops.map((id) => t(`crop.${id}`)).join(", ");
  return t(item.key, values);
}

function daysOld(iso) {
  const [y, m, d] = localToday().split("-").map(Number);
  const [y2, m2, d2] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

// The text sent with the share button: the same sentences, plain, ready for WhatsApp or SMS.
export function shareText(tank, items, weekStart) {
  return [t("week.share.intro", { tank: tankName(tank), from: date(weekStart, { day: "numeric", month: "long" }) }),
          ...items.map((item) => `• ${itemText(item)}`), t("week.share.footer")].join("\n");
}

// ---------------------------------------------------------------------------
// The weather items from a live forecast. Mirrors build_items() in pipeline/advisory.py: change both together.
// ---------------------------------------------------------------------------
export function weatherItems(days, s, rainDayMm) {
  const week = days.filter((d) => d.date >= localToday()).slice(0, s.days);
  if (week.length < s.min_forecast_days) return { items: [{ id: "rain", kind: "info", key: "advisory.forecast_old", values: {} }], week };

  const known = week.filter((d) => d.rain_mm !== null && d.rain_mm !== undefined);
  const total = known.reduce((sum, d) => sum + d.rain_mm, 0);
  const rainDays = known.filter((d) => d.rain_mm >= rainDayMm).length;
  const heaviest = known.reduce((a, b) => (b.rain_mm > (a?.rain_mm ?? -1) ? b : a), null);
  const hot = week.filter((d) => d.tmax_c !== null && d.tmax_c !== undefined && d.tmax_c >= s.hot_day_c).length;
  const items = [];

  if (heaviest && heaviest.rain_mm >= s.heavy_rain_mm) {
    items.push({ id: "rain", kind: "watch", key: "advisory.rain.heavy",
                 values: { mm: Math.round(heaviest.rain_mm), date: heaviest.date, total: Math.round(total) } });
  } else if (total < s.dry_week_mm) {
    items.push({ id: "rain", kind: "watch", key: "advisory.rain.dry", values: { mm: Math.round(total * 10) / 10 } });
  } else {
    items.push({ id: "rain", kind: "info", key: "advisory.rain.some", values: { mm: Math.round(total), days: rainDays } });
  }
  if (hot >= s.hot_days_alert) items.push({ id: "heat", kind: "watch", key: "advisory.heat", values: { days: hot, c: s.hot_day_c } });
  const spray = week.filter((d) => d.rain_mm !== null && d.rain_mm !== undefined && d.rain_mm < s.spray_max_mm
    && d.rain_chance !== null && d.rain_chance !== undefined && d.rain_chance < s.spray_max_chance).map((d) => d.date);
  items.push({ id: "spray", kind: "info", key: spray.length ? "advisory.spray.days" : "advisory.spray.none", values: {}, dates: spray });
  return { items, week };
}

// Rain of the 7 days before today (model analysis, Open-Meteo; NOT NASA). null when offline or no answer.
async function loadRecentRain(tank) {
  if (navigator.onLine === false) return null;
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `${API}?latitude=${tank.lat}&longitude=${tank.lon}&daily=precipitation_sum&past_days=7&forecast_days=1&timezone=Asia%2FColombo`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const d = (await response.json()).daily;
    const today = localToday();
    const past = d.time.map((day, i) => ({ day, mm: d.precipitation_sum[i] })).filter((x) => x.day < today);
    if (past.length < 7 || past.some((x) => x.mm === null)) return null;      // never total a week with a missing day
    return { kind: "info", id: "past", key: "advisory.rain.past", values: { mm: Math.round(past.reduce((s, x) => s + x.mm, 0)) } };
  } catch {
    return null;
  } finally {
    clearTimeout(stop);
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function renderWeek(tank, doc, panel) {
  clearInterval(timer);
  const advisory = doc.advisory;
  if (!advisory?.items?.length) {
    panel.innerHTML = `<section class="block"><h2 id="week-title">${escapeHtml(t("week.title"))}</h2>
      <p>${escapeHtml(t("week.none"))}</p></section>`;
    return;
  }
  let items = advisory.items;
  let range = { from: advisory.week_start, to: advisory.week_end };
  let live = null;                                   // { time } once the live forecast has been used

  const draw = () => {
    const old = !live && daysOld(advisory.issued) > STALE_DAYS;
    const text = shareText(tank, items, range.from);
    panel.innerHTML = `
      <section class="block week" aria-labelledby="week-title">
        <h2 id="week-title">${escapeHtml(t("week.title"))}</h2>
        <p class="week-range">${escapeHtml(t("week.range", {
          from: date(range.from, { day: "numeric", month: "long" }), to: date(range.to, { day: "numeric", month: "long" }) }))}</p>
        <p class="fact-small" id="week-live" role="status">${escapeHtml(live
          ? t("week.live", { time: live.time }) : t(navigator.onLine === false ? "week.live_offline" : "week.live_checking"))}</p>
        ${old ? `<p class="demo-banner">${escapeHtml(t("week.stale", { date: date(advisory.issued) }))}</p>` : ""}
        <ul class="week-list">
          ${items.map((item) => `
          <li class="week-item kind-${item.kind}">
            <span class="wk-ic" style="--ic: var(${ICON[item.id] || "--i-calendar"})" aria-hidden="true"></span>
            <div>
              <span class="week-kind">${escapeHtml(t(`week.kind.${item.kind}`))}</span>
              <p>${escapeHtml(itemText(item))}</p>
              <span class="week-src">${escapeHtml(t("label.source"))} ${escapeHtml(t(SOURCE[item.id] || "week.src.rules"))}</span>
            </div>
          </li>`).join("")}
        </ul>
        <div class="week-actions">
          <a class="action" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${escapeHtml(t("week.share"))}</a>
          <button type="button" class="action ghost" data-copy>${escapeHtml(t("week.copy"))}</button>
        </div>
        <p class="fact-small" id="week-copied" role="status"></p>
        <p class="fact-small">${escapeHtml(t("week.prepared", { date: date(advisory.issued) }))}</p>
        <p class="fact-small">${escapeHtml(t("week.note"))}</p>
      </section>`;

    // Copy the text. Browsers can refuse (older phones, not-secure pages): then say so, don't pretend.
    const status = panel.querySelector("#week-copied");
    panel.querySelector("[data-copy]").onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = t("week.copied");
      } catch {
        status.textContent = t("week.copy_failed");
      }
    };
  };

  // Redo the weather items from the live forecast, if the thresholds were saved with the advice.
  const refresh = async () => {
    if (!panel.isConnected) { clearInterval(timer); return; }          // the user left this page
    const s = advisory.settings;
    if (!s) return;
    const fc = await loadForecast(tank, doc.forecast);
    if (!panel.isConnected || !fc?.live) return;                       // saved copy: keep the saved items
    const { items: weather, week } = weatherItems(fc.days, s, fc.rain_day_mm);
    const past = await loadRecentRain(tank);
    if (!panel.isConnected) return;
    const rest = advisory.items.filter((i) => !["rain", "heat", "spray"].includes(i.id));
    // order: water colour, last week's rain, this week's weather, then greenness and crops
    items = [...rest.filter((i) => i.id === "water"), ...(past ? [past] : []), ...weather, ...rest.filter((i) => i.id !== "water")];
    if (week.length) range = { from: week[0].date, to: week.at(-1).date };
    live = { time: new Date().toTimeString().slice(0, 5) };
    const keepFocus = document.activeElement?.closest?.(".week-actions");
    if (!keepFocus) draw();                                            // do not redraw under a tapping finger
  };

  draw();
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
}
