// Small shared pieces: signal icons, badges, number and date formatting.
import { t, getLang } from "./i18n.js";

// Each signal has its own colour AND shape AND symbol, so it never relies on colour alone:
//   green = circle with a tick, amber = triangle with "!", red = octagon with a cross, none = grey "?"
const ICONS = {
  green: `<circle cx="16" cy="16" r="14" fill="var(--green)" stroke="#fff" stroke-width="2"/>
          <path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  amber: `<path d="M16 2.5L30 28H2z" fill="var(--amber)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
          <path d="M16 11v8" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="16" cy="23.5" r="1.9" fill="#fff"/>`,
  red:   `<path d="M10.2 2h11.6L30 10.2v11.6L21.8 30H10.2L2 21.8V10.2z" fill="var(--red)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
          <path d="M11 11l10 10M21 11L11 21" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`,
  none:  `<circle cx="16" cy="16" r="14" fill="var(--none)" stroke="#fff" stroke-width="2"/>
          <path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/>
          <circle cx="16" cy="23" r="1.8" fill="#fff"/>`,
};

export function signalIcon(signal) {
  return `<svg class="sig-icon" viewBox="0 0 32 32" aria-hidden="true">${ICONS[signal || "none"]}</svg>`;
}

export function signalKey(signal) {
  return signal || "none";
}

const SATELLITE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <rect x="9" y="9" width="6" height="6" rx="1"/><path d="M3 5l4 4M17 15l4 4M5 3l4 4M15 17l4 4M4 20a6 6 0 0 1 0-8"/></svg>`;

// "Source: NASA POWER (…)" — shown next to every value.
export function sourceBadge(source) {
  if (!source) return "";
  return `<span class="badge source">${SATELLITE}${escapeHtml(t("label.source"))} ${escapeHtml(source)}</span>`;
}

// Hatched "Demo data" badge, shown wherever the data says demo: true.
export function demoBadge(isDemo) {
  if (!isDemo) return "";
  return `<span class="badge demo" title="${escapeHtml(t("badge.demo.explain"))}">${escapeHtml(t("badge.demo"))}</span>`;
}

export function badges(source, isDemo) {
  return `<div class="badges">${sourceBadge(source)}${demoBadge(isDemo)}</div>`;
}

const locale = () => (getLang() === "si" ? "si-LK" : "en-GB");

export function num(value, digits = 1) {
  if (value === null || value === undefined) return t("state.no_data");
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
}

// Dates use month names from si.json / en.json (month.1 … month.12), because many phone
// browsers have no Sinhala date formatting built in.
//   date(iso)                                   → "25 October 2026" / "2026 ඔක්තෝබර් 25"
//   date(iso, { month: "long" })                → "October" / "ඔක්තෝබර්"
//   date(iso, { month: "short", year: "numeric" }) → "Oct 2026" / "2026 ඔක්තෝබර්"
//   date(iso, { day: "numeric", month: "long" }) → "26 October" / "ඔක්තෝබර් 26"
export function date(iso, options = { day: "numeric", month: "long", year: "numeric" }) {
  if (!iso) return t("state.no_data");
  // Read the calendar date straight from the text ("2026-10-25…"), so time zones can't shift it.
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? { year: +m[1], month: +m[2], day: +m[3] } : (() => {
    const x = new Date(iso);
    return { year: x.getFullYear(), month: x.getMonth() + 1, day: x.getDate() };
  })();
  let month = t(`month.${d.month}`);
  if (options.month === "short" && getLang() === "en") month = month.slice(0, 3);
  if (options.day && !options.year) return t("date.day_month", { day: d.day, month });
  if (options.day) return t("date.full", { day: d.day, month, year: d.year });
  if (options.year) return t("date.month_year", { month, year: d.year });
  return month;
}

// Season labels in the data are English ("Yala 2026", "Maha 2025/26"); show them in the UI language.
export function seasonName(label) {
  if (!label) return "";
  return label.replace(/^Yala\b/, t("season.yala")).replace(/^Maha\b/, t("season.maha"));
}

// Day of the week from a calendar date ("2026-10-26" → "Monday" / "සඳුදා"); short = "Mon" / "සඳු".
export function weekdayName(iso, short = false) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const day = new Date(+m[1], +m[2] - 1, +m[3]).getDay();      // 0 = Sunday
  return t(short ? `weekday.short.${day}` : `weekday.${day}`);
}

// Today's date on this phone as "YYYY-MM-DD" (not UTC, so it's right just after midnight).
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A ratio (1.0 = usual) in words a farmer reads at a glance: "Less than usual".
export function levelWord(ratio) {
  if (ratio === null || ratio === undefined) return t("state.no_data");
  if (ratio < 0.6) return t("level.much_less");
  if (ratio < 0.9) return t("level.less");
  if (ratio <= 1.1) return t("level.usual");
  if (ratio <= 1.4) return t("level.more");
  return t("level.much_more");
}

// Hectares with acres alongside, since farmers usually think in acres (1 ha = 2.471 acres).
export function area(ha) {
  if (ha === null || ha === undefined) return t("state.no_data");
  return t("unit.area", { ha: num(ha), acres: num(ha * 2.471, 0) });
}

export function monthName(iso) {
  return date(iso, { month: "long" });
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Tank name in the current language (falls back to the other one).
export function tankName(tank) {
  return getLang() === "si" ? (tank.name_si || tank.name_en) : (tank.name_en || tank.name_si);
}

// "Mung bean, Cowpea, Maize, Groundnut +6": long lists of crop names are cut so lines stay short.
export function capNames(names, max = 4) {
  return names.slice(0, max).join(", ") + (names.length > max ? ` +${names.length - max}` : "");
}

// A real photo of a crop (web/img/crops/<id>.jpg, credits in credits.json). If the file is missing it just hides.
export function cropPhoto(id, name, cls) {
  return `<img class="${cls}" src="img/crops/${id}.jpg" alt="${escapeHtml(name)}" width="64" height="48" loading="lazy" onerror="this.style.visibility='hidden'">`;
}
