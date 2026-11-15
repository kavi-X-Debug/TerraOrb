// Copilot step 1: turn a typed question (English or Sinhala, spelling slips allowed) into an INTENT plus ENTITIES.
//
//   parseQuestion(text, { destinations, today, getList }) -> {
//     intent, confidence ("high" | "medium" | "none"), candidates:[intent ids, best first],
//     dests:[destination ids in the order they were written], dates:{start,end,label,explicit}|null, days:number|null,
//     interests:[activity ids], lowRain:boolean, topic: explain sub-topic | null }
//
// This is NOT an AI: it only scores keyword lists (strings tripd.kw.<intent>, words for dates in tripd.lex.*) with the fuzzy matcher
// of the existing helper (assistant-kb.js: spelling slips, word endings, Sinhala). It is pure (no page needed), so it is tested in
// tools/test_trip_copilot.mjs. `getList(key)` returns the words of a string key as an array, from both languages.
import { norm, tokens, wordScore, phraseScore, rank } from "../../assistant-kb.js";

export const INTENTS = ["will_it_rain", "compare_destinations", "best_dates", "where_to_travel", "plan_trip", "modify_itinerary",
  "activities_tomorrow", "photography_best", "packing", "explain_rain", "help"];
export const ACTIVITY_IDS = ["hiking", "camping", "beach", "waterfalls", "photography", "wildlife", "sightseeing", "cycling", "museums",
  "restaurants", "culture", "entertainment", "shopping", "workshops"];
export const EXPLAIN_TOPICS = ["intensity", "sources", "tendency", "score", "ml", "why"];

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function addDays(date, n) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10); }
export const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();       // 0 = Sunday
export function daysBetween(a, b) { return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY); }
const validDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

// ---- small word helpers ------------------------------------------------------------------------------------------------------------
// index of the first typed token that matches a word of `list` (fuzzy for long words), -1 if none. A phrase (several words) needs all of them.
function find(tk, list) {
  let best = -1;
  for (const entry of list) {
    const words = tokens(entry);
    if (!words.length) continue;
    let first = -1, ok = true;
    for (const w of words) {
      const i = tk.findIndex((x) => wordScore(x, w) >= 0.8);
      if (i < 0) { ok = false; break; }
      if (first < 0 || i < first) first = i;
    }
    if (ok && (best < 0 || first < best)) best = first;
  }
  return best;
}
// exact (or Sinhala ending) match only, for short words such as month names where a spelling guess would be wrong
function findExact(tk, list) {
  for (const entry of list) for (const w of tokens(entry)) { const i = tk.findIndex((x) => x === w || (/[඀-෿]/.test(w) && w.length >= 3 && x.startsWith(w))); if (i >= 0) return i; }
  return -1;
}

function numberAt(tk, i, lex) {
  if (i < 0 || i >= tk.length) return null;
  if (/^\d{1,3}$/.test(tk[i])) return Number(tk[i]);
  for (let n = 1; n <= 14; n++) if (lex.num[n].some((w) => tk[i] === w || (/[඀-෿]/.test(w) && tk[i].startsWith(w)))) return n;
  return null;
}

export function makeLex(getList) {
  const lex = { num: {}, weekday: [], monthnames: [], act: {} };
  for (const k of ["today", "tomorrow", "dayafter", "weekend", "next", "this", "week", "day", "monthword", "in", "for", "lowrain"]) lex[k] = getList(`tripd.lex.${k}`);
  for (let n = 1; n <= 14; n++) lex.num[n] = getList(`tripd.lex.num.${n}`);
  for (let i = 0; i < 7; i++) lex.weekday[i] = getList(`tripd.lex.weekday.${i}`);
  for (let i = 1; i <= 12; i++) lex.monthnames[i] = getList(`tripd.lex.month.${i}`);
  for (const id of ACTIVITY_IDS) lex.act[id] = getList(`tripd.lex.act.${id}`);
  return lex;
}

// ---- dates -------------------------------------------------------------------------------------------------------------------------
// "this weekend" = the coming Saturday and Sunday (if today is Saturday or Sunday: from today to Sunday).
// "next weekend" = the first Saturday AFTER today (so on a Sunday it is the weekend 6 days away). "next week" = the coming Monday to Sunday.
function weekendFrom(today, next) {
  const wd = weekday(today);
  if (!next) {
    if (wd === 6) return [today, addDays(today, 1)];
    if (wd === 0) return [today, today];
    const sat = addDays(today, 6 - wd); return [sat, addDays(sat, 1)];
  }
  const sat = addDays(today, wd === 6 ? 7 : (6 - wd + 7) % 7 || 7); return [sat, addDays(sat, 1)];
}
function nextWeekday(today, target) {
  let n = (target - weekday(today) + 7) % 7;
  if (n === 0) n = 7;
  return addDays(today, n);
}
const R = (start, end, label) => ({ start, end, label, explicit: true });
const monthRange = (y, m, today) => {
  const first = iso(y, m, 1), last = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return R(first < today ? today : first, last, "month");
};

export function parseDates(text, tk, today, lex) {
  // 1. an ISO date or two
  const isoHits = [...String(text).matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].filter((m) => validDate(+m[1], +m[2], +m[3])).map((m) => m[0]);
  if (isoHits.length) return R(isoHits[0], isoHits[1] && isoHits[1] >= isoHits[0] ? isoHits[1] : isoHits[0], "date");
  const year = Number(today.slice(0, 4));
  // 2. day + month name ("20 November", "Nov 20", "20-23 Nov", "29 November to 1 December"), or a month alone ("in December" = the whole month)
  const dated = [];
  let monthOnly = null;
  const numAt = (k) => { const n = k >= 0 && k < tk.length ? tk[k].replace(/^(\d{1,2})(st|nd|rd|th)$/, "$1") : ""; return /^\d{1,2}$/.test(n) && +n >= 1 && +n <= 31 ? +n : null; };
  for (let m = 1; m <= 12; m++) {
    const mi = findExact(tk, lex.monthnames[m].filter((w) => w.length >= 3));
    if (mi < 0) continue;
    let k = mi - 1;
    if (tk[k] === "of") k -= 1;
    const nums = [];
    for (let c = 0; c < 2; c++, k--) { const n = numAt(k); if (n === null) break; nums.unshift(n); }
    if (!nums.length && numAt(mi + 1) !== null) nums.push(numAt(mi + 1));
    if (nums.length) dated.push({ m, mi, lo: Math.min(...nums), hi: Math.max(...nums) });
    else { const iIn0 = findExact(tk, lex.in); if (iIn0 >= 0 && iIn0 < mi && !monthOnly) monthOnly = m; }
  }
  if (dated.length) {
    dated.sort((x, y) => x.mi - y.mi);
    const first = dated[0], last = dated[dated.length - 1];
    let y = year; if (validDate(y, last.m, last.hi) && iso(y, last.m, last.hi) < today) y += 1;
    if (validDate(y, first.m, first.lo) && validDate(y, last.m, last.hi)) {
      const start = iso(y, first.m, first.lo), end = iso(y, last.m, last.hi);
      if (end >= start) return R(start, end, "date");
    }
  }
  if (monthOnly) { let y = year; if (iso(y, monthOnly, 28) < today) y += 1; return monthRange(y, monthOnly, today); }
  // 3. relative days
  if (find(tk, lex.dayafter) >= 0) return R(addDays(today, 2), addDays(today, 2), "dayafter");
  if (find(tk, lex.tomorrow) >= 0) return R(addDays(today, 1), addDays(today, 1), "tomorrow");
  if (find(tk, lex.today) >= 0) return R(today, today, "today");
  const iDay = find(tk, lex.day), iIn = findExact(tk, lex.in);
  if (iDay >= 0 && iIn >= 0 && iIn < iDay) {                                  // "in 3 days"
    const n = numberAt(tk, iDay - 1, lex);
    if (n && n <= 31) return R(addDays(today, n), addDays(today, n), "in_days");
  }
  // 4. weekends, weeks, months
  const iNext = findExact(tk, lex.next), iThis = findExact(tk, lex.this);
  if (find(tk.map((x) => (x === "week" ? "" : x)), lex.weekend) >= 0) { const [a, b] = weekendFrom(today, iNext >= 0); return R(a, b, iNext >= 0 ? "next_weekend" : "weekend"); }
  const iWeek = find(tk, lex.week), iMonthWord = find(tk, lex.monthword);
  if (iWeek >= 0 && iNext >= 0 && Math.abs(iNext - iWeek) <= 2) { const mon = addDays(today, ((8 - weekday(today)) % 7) || 7); return R(mon, addDays(mon, 6), "next_week"); }
  if (iWeek >= 0 && iThis >= 0 && Math.abs(iThis - iWeek) <= 2) return R(today, addDays(today, (7 - weekday(today)) % 7), "this_week");
  if (iMonthWord >= 0 && iNext >= 0 && Math.abs(iNext - iMonthWord) <= 2) { let y = year, m = Number(today.slice(5, 7)) + 1; if (m > 12) { m = 1; y += 1; } return monthRange(y, m, today); }
  if (iMonthWord >= 0 && iThis >= 0 && Math.abs(iThis - iMonthWord) <= 2) return monthRange(year, Number(today.slice(5, 7)), today);
  // 5. a weekday name ("on Friday")
  for (let w = 0; w < 7; w++) if (findExact(tk, lex.weekday[w]) >= 0) { const d = nextWeekday(today, w); return R(d, d, "weekday"); }
  return null;
}

// "for 5 days", "5-day trip", "five days", "දින පහක්"; also "a weekend" = 2 days, "a week" = 7 days
export function parseDuration(tk, lex) {
  const iDay = find(tk, lex.day);
  if (iDay >= 0) {
    const n = numberAt(tk, iDay - 1, lex) ?? numberAt(tk, iDay + 1, lex);
    if (n && n >= 1 && n <= 30 && findExact(tk, lex.in) < 0) return n;
  }
  const iWeek = find(tk, lex.week);
  if (iWeek >= 0 && find(tk, lex.for) >= 0 && findExact(tk, lex.next) < 0 && findExact(tk, lex.this) < 0) return 7;
  return null;
}

// ---- destinations ------------------------------------------------------------------------------------------------------------------
// Every destination whose name (English or Sinhala) is written in the text, in the order written. A shorter name that is only part of a
// longer matched name is dropped ("Nuwara" vs "Nuwara Eliya").
export function findDestinations(tk, destinations) {
  const hits = [];
  for (const d of destinations || []) {
    let best = null;
    for (const name of [d.name_en, d.name_si, ...(d.aliases || [])].filter(Boolean)) {
      const words = tokens(name);
      if (!words.length) continue;
      const idx = [];
      let ok = true;
      for (const w of words) {
        let at = -1;
        for (let i = 0; i < tk.length; i++) if (!idx.includes(i) && wordScore(tk[i], w) >= 0.8) { at = i; break; }
        if (at < 0) { ok = false; break; }
        idx.push(at);
      }
      if (ok && (!best || idx.length > best.idx.length)) best = { idx };
    }
    if (best) hits.push({ id: d.id, idx: best.idx, pos: Math.min(...best.idx) });
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.idx.length > h.idx.length && h.idx.every((i) => o.idx.includes(i))));
  // two destinations cannot own the same word: keep the first
  const used = new Set(), out = [];
  for (const h of kept.sort((a, b) => b.idx.length - a.idx.length || a.pos - b.pos)) {
    if (h.idx.some((i) => used.has(i))) continue;
    h.idx.forEach((i) => used.add(i));
    out.push(h);
  }
  return out.sort((a, b) => a.pos - b.pos).map((h) => h.id);
}

// ---- the main function -------------------------------------------------------------------------------------------------------------
export function parseQuestion(text, { destinations = [], today, getList }) {
  const lex = makeLex(getList);
  const tk = tokens(text);
  const kwOf = (id) => getList(`tripd.kw.${id}`);
  const ranked = rank(text, INTENTS, kwOf);
  const dests = findDestinations(tk, destinations);
  const dates = parseDates(text, tk, today, lex);
  const days = parseDuration(tk, lex);
  const interests = ACTIVITY_IDS.filter((id) => find(tk, lex.act[id]) >= 0);
  const lowRain = find(tk, lex.lowrain) >= 0;

  let intent = null, confidence = "none";
  const top = ranked.list[0];
  if (top && top.score >= 1) { intent = top.id; confidence = ranked.sure ? "high" : "medium"; }
  // entity hints: two or more places with a rain-ish or empty intent mean "compare them"
  if (dests.length >= 2 && (!intent || intent === "will_it_rain" || intent === "where_to_travel")) { intent = "compare_destinations"; confidence = confidence === "none" ? "medium" : confidence; }
  // a place (and maybe a date) with no other clue: the common question, "what about the rain there?"
  let defaulted = false;
  if (!intent && dests.length) { intent = "will_it_rain"; confidence = "medium"; defaulted = true; }
  if (!intent && dates && /rain|weather/.test(norm(text))) { intent = "will_it_rain"; confidence = "medium"; }
  // "where ... low rain" beats a plain rain question when no place is named
  if (intent === "will_it_rain" && !dests.length && (find(tk, getList("tripd.lex.where")) >= 0)) { intent = "where_to_travel"; confidence = "medium"; }

  let topic = null;
  if (intent === "explain_rain") {
    const sub = rank(text, EXPLAIN_TOPICS, (id) => getList(`tripd.kw.ex_${id}`));
    topic = sub.list[0] && sub.list[0].score >= 1 ? sub.list[0].id : "why";
  }
  const candidates = ranked.list.slice(0, 3).map((x) => x.id);
  return { intent, confidence, candidates, dests, dates, days, interests, lowRain, topic, defaulted, text: String(text) };
}
