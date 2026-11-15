// Live rain for one tank: is it raining now, when will rain start or stop, how much fell in the last 24 hours and how much
// is expected in the next 12 hours, with a warning when heavy rain is expected soon.
//
// Where it comes from: global weather models through the free Open-Meteo API (hourly rain, plus the rain of the last few minutes).
// It is NOT NASA data and it is NOT radar: for Sri Lanka the short-range numbers are a model forecast, so a shower can arrive
// an hour earlier or later than shown. The page says so. Nothing here is saved or guessed: with no internet there is simply no live rain.
//
// The numbers are fetched when a page opens and again every 5 minutes while it stays open (also when the phone comes back online
// or the tab becomes visible again). One request per tank is shared by the rain card and the alert banner.
import { t } from "./i18n.js";
import { escapeHtml, num } from "./ui.js";

const API = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8000;
const FRESH_MS = 5 * 60 * 1000;                 // a loaded answer is reused for 5 minutes
const AHEAD = 12;                               // hours shown ahead

// Rain rates in mm per hour. The classes follow the usual weather-service ones (light below 2.5, heavy from 7.6).
const IS_RAIN = 0.5, MODERATE = 2.5, HEAVY = 7.6;
// Warning thresholds (DRAFT, to be checked with an Agricultural Instructor): one hour with heavy rain, or a lot over 6 hours.
const ALERT_HOUR_MM = 7.6, ALERT_6H_MM = 30;

const cache = new Map();                        // tank id -> { at, data }

export const rainClass = (rate) => (rate < 0.1 ? "dry" : rate < MODERATE ? "light" : rate < HEAVY ? "moderate" : "heavy");
const hourLabel = (time) => `${String((Number(time.slice(11, 13)) + 23) % 24).padStart(2, "0")}:00`;   // hourly rain at 15:00 = the hour 14:00-15:00
const clock = (time) => time.slice(11, 16);

// ---------------------------------------------------------------------------
// Loading and working out the numbers
// ---------------------------------------------------------------------------
// Turn an Open-Meteo answer into what the page needs (pure function; times are local to the tank, "YYYY-MM-DDTHH:MM").
export function parseRain(d) {
  const now = d.current.time;
  const rateNow = Math.round((d.current.precipitation ?? 0) * (3600 / (d.current.interval || 900)) * 10) / 10;
  const hours = d.hourly.time.map((time, i) => ({ time, mm: d.hourly.precipitation[i], chance: d.hourly.precipitation_probability?.[i] ?? null }));
  const past = hours.filter((h) => h.time <= now && h.mm !== null).slice(-24);
  const next = hours.filter((h) => h.time > now).slice(0, AHEAD);
  if (!next.length) return null;
  const sum = (list) => Math.round(list.reduce((a, h) => a + (h.mm || 0), 0) * 10) / 10;
  const known = next.filter((h) => h.mm !== null);
  const peak = known.reduce((a, b) => (b.mm > (a?.mm ?? -1) ? b : a), null);
  const rainingNow = rateNow >= IS_RAIN || (next[0].mm ?? 0) >= IS_RAIN;
  const firstRain = next.find((h) => (h.mm ?? 0) >= IS_RAIN);
  const firstDry = next.find((h) => h.mm !== null && h.mm < IS_RAIN);
  return {
    time: now, rateNow, rainingNow, past24: sum(past), pastHours: past.length, next, next6: sum(next.slice(0, 6)), next12: sum(next), peak,
    startAt: !rainingNow && firstRain ? hourLabel(firstRain.time) : null,
    stopAt: rainingNow && firstDry ? hourLabel(firstDry.time) : null,
    heavySoon: !!peak && next.slice(0, 6).some((h) => (h.mm ?? 0) >= ALERT_HOUR_MM),
    lotSoon: sum(next.slice(0, 6)) >= ALERT_6H_MM,
  };
}

// Returns the parsed rain for a tank, or null when offline / no answer. Pass { force: true } to skip the 5-minute reuse.
export async function loadRain(tank, { force = false } = {}) {
  const hit = cache.get(tank.id);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return hit.data;
  if (navigator.onLine === false) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${API}?latitude=${tank.lat}&longitude=${tank.lon}&current=precipitation,weather_code`
      + `&hourly=precipitation,precipitation_probability&past_hours=24&forecast_hours=${AHEAD + 2}&timezone=Asia%2FColombo`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = parseRain(await response.json());
    if (data) cache.set(tank.id, { at: Date.now(), data });
    return data;
  } catch {
    return null;                                 // offline, slow or blocked: no live rain
  } finally {
    clearTimeout(timer);
  }
}

// Run `draw` now and every 5 minutes while `el` is on screen; also when the phone comes back online or the tab becomes visible.
function keepFresh(el, draw) {
  let busy = false;
  const run = async (force) => {
    if (!el.isConnected) { stop(); return; }
    if (busy) return;
    busy = true;
    try { await draw(force); } finally { busy = false; }
  };
  const timer = setInterval(() => run(true), FRESH_MS);
  const onWake = () => { if (document.visibilityState !== "hidden") run(true); };
  const stop = () => { clearInterval(timer); window.removeEventListener("online", onWake); document.removeEventListener("visibilitychange", onWake); };
  window.addEventListener("online", onWake);
  document.addEventListener("visibilitychange", onWake);
  run(false);
}

// ---------------------------------------------------------------------------
// The rain card
// ---------------------------------------------------------------------------
export function rainBlockMarkup() {
  return `<section class="block rain-block" aria-labelledby="rain-live-title">
    <h2 id="rain-live-title">${escapeHtml(t("rn.title"))}</h2>
    <div class="rain-live" aria-live="polite"><p class="fact-small">${escapeHtml(t("forecast.status.loading"))}</p></div>
  </section>`;
}

function nowSentence(r) {
  const cls = r.rainingNow ? (rainClass(Math.max(r.rateNow, r.next[0].mm ?? 0)) === "dry" ? "light" : rainClass(Math.max(r.rateNow, r.next[0].mm ?? 0))) : "dry";
  return { cls, text: t(`rn.now.${cls}`) };
}

function nextSentence(r) {
  if (r.startAt) return t("rn.next.start", { time: r.startAt });
  if (r.stopAt) return t("rn.next.stop", { time: r.stopAt });
  return r.rainingNow ? t("rn.next.long", { n: AHEAD }) : t("rn.next.dry", { n: AHEAD });
}

function barsMarkup(r, advanced) {
  const top = Math.max(4, r.peak?.mm ?? 0);                                  // the tallest bar is the wettest hour (at least 4 mm, so a drizzle stays small)
  return `<div class="rain-bars" role="img" aria-label="${escapeHtml(t("rn.bars.label", { n: AHEAD, mm: num(r.next12, 0) }))}">${r.next.map((h, i) => {
    const mm = h.mm ?? 0, cls = rainClass(mm), height = mm <= 0 ? 4 : Math.max(8, Math.min(100, (mm / top) * 100));
    return `<div class="rain-bar ${cls}">
      <span class="rain-val">${advanced ? escapeHtml(num(mm, 1)) : ""}</span>
      <span class="rain-col" style="height:${height}%"></span>
      <span class="rain-hr">${i % 2 === 0 || advanced ? escapeHtml(hourLabel(h.time).slice(0, 2)) : ""}</span>
      ${advanced && h.chance !== null ? `<span class="rain-pc">${h.chance}%</span>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function cardMarkup(r, advanced) {
  const { cls, text } = nowSentence(r);
  return `
    <div class="rain-head ${cls}">
      <span class="rain-ic" aria-hidden="true"></span>
      <div><p class="rain-big">${escapeHtml(text)}</p><p class="rain-next">${escapeHtml(nextSentence(r))}</p></div>
    </div>
    ${barsMarkup(r, advanced)}
    <p class="fact-small">${escapeHtml(t("rn.bars.help"))}</p>
    <p class="rain-sums"><span>${escapeHtml(t("rn.last24", { mm: num(r.past24, 1) }))}</span><span>${escapeHtml(t("rn.next12", { n: AHEAD, mm: num(r.next12, 1) }))}</span></p>
    <p class="fact-small">${escapeHtml(t("rn.updated", { time: clock(r.time) }))}</p>
    <p class="badge source">${escapeHtml(t("label.source"))} ${escapeHtml(t("forecast.source"))}</p>
    <p class="fact-small">${escapeHtml(t("rn.note"))}</p>`;
}

// Fill (and keep filling) the card made by rainBlockMarkup().
export function fillRain(block, tank, { advanced = false } = {}) {
  const box = block.querySelector(".rain-live");
  keepFresh(box, async (force) => {
    const r = await loadRain(tank, { force });
    if (!box.isConnected) return;
    box.innerHTML = r ? cardMarkup(r, advanced) : `<p class="fact-small">${escapeHtml(t("rn.offline"))}</p>`;
  });
}

// ---------------------------------------------------------------------------
// The warning banner (shown on every page of a tank while heavy rain is expected within about 6 hours)
// ---------------------------------------------------------------------------
const dismissedKey = (tank, r) => `mc-rain-alert-${tank.id}-${r.peak?.time}`;
const wasDismissed = (key) => { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } };

export function startRainAlert(el, tank) {
  keepFresh(el, async (force) => {
    const r = await loadRain(tank, { force });
    if (!el.isConnected) return;
    const heavy = r?.heavySoon, lot = r?.lotSoon;
    if (!r || (!heavy && !lot) || wasDismissed(dismissedKey(tank, r))) { el.hidden = true; el.innerHTML = ""; return; }
    const first6 = r.next.slice(0, 6), peak = first6.reduce((a, b) => ((b.mm ?? 0) > (a.mm ?? 0) ? b : a), first6[0]);
    const text = heavy ? t("rn.alert.heavy", { mm: num(peak.mm, 0), time: hourLabel(peak.time) }) : t("rn.alert.lot", { mm: num(r.next6, 0) });
    el.hidden = false;
    el.innerHTML = `<span class="rain-alert-ic" aria-hidden="true"></span><p>${escapeHtml(text)}</p>
      <button type="button" class="rain-alert-x" aria-label="${escapeHtml(t("rn.alert.close"))}">×</button>`;
    el.querySelector("button").onclick = () => { try { sessionStorage.setItem(dismissedKey(tank, r), "1"); } catch { /* ignore */ } el.hidden = true; };
  });
}
