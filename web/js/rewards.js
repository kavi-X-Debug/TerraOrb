// Rewards for the Learn Mode games: water drops (points), farmer levels, badges and lesson cards.
//
// One shared score for every game. A game calls reward("lesson", "water", 3) when a level or lesson is passed, with the
// stars the child won (1 to 3). Nothing is sent anywhere: everything is kept in this browser (localStorage "mc-rewards"),
// there are no accounts, no leaderboards and no real prizes. Playing a level again only pays for stars won BEYOND the best
// result so far, so repeating the same easy level cannot pile up points.
//
//   drops   5 for every star, +5 the first time a level is passed, +5 the first time it is passed with 3 stars,
//           +2 for the first reward of a new day, +10 for every new badge.
//   levels  Seedling, Sprout, Young farmer, Tank keeper, Wewa guardian (thresholds in LEVELS below).
//   badges  BADGES below; each one is a small rule over the saved progress.
//   cards   one picture card per Little Lesson, collected when that lesson is passed.
//
// All words are in si.json / en.json under "rw.*"; this file holds only the rules.
import { t } from "./i18n.js";
import { escapeHtml, localToday } from "./ui.js";

const KEY = "mc-rewards";
const DROPS_PER_STAR = 5, FIRST_BONUS = 5, PERFECT_BONUS = 5, DAILY_BONUS = 2, BADGE_BONUS = 10;

// The Little Lessons, in the same order as LESSONS in lessons.js (keep the two lists in step).
export const LESSON_IDS = ["water", "seasons", "cascade", "sat", "bethma", "crops", "forecast", "sowing",
  "fire", "slide", "elnino", "lanina", "carbon", "warming", "cycle", "ice"];

export const LEVELS = [
  { id: "seedling", at: 0 },
  { id: "sprout", at: 40 },
  { id: "farmer", at: 120 },
  { id: "keeper", at: 250 },
  { id: "guardian", at: 500 },
];

export function levelIndex(drops) {
  let i = 0;
  LEVELS.forEach((l, k) => { if (drops >= l.at) i = k; });
  return i;
}

// ---------------------------------------------------------------------------
// Saved state
// ---------------------------------------------------------------------------
const fresh = () => ({ v: 1, drops: 0, best: {}, perfect: {}, badges: {}, cards: {}, last: "", streak: 0, name: "" });

export function getRewards() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === "object") return { ...fresh(), ...s };
  } catch { /* nothing saved yet, or storage blocked */ }
  return fresh();
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not saved: fine */ } }

export function setName(name) { const s = getRewards(); s.name = String(name || "").slice(0, 30); save(s); }
export function resetRewards() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const dayBefore = (iso) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------
// Badges: id, icon, colour group and the rule. `m` holds numbers worked out from the saved progress.
// ---------------------------------------------------------------------------
export const BADGES = [
  { id: "first", icon: "drop", tone: "teal", test: (m) => m.drops > 0 },
  { id: "lesson1", icon: "book", tone: "blue", test: (m) => m.lessons >= 1 },
  { id: "lessons5", icon: "flask", tone: "blue", test: (m) => m.lessons >= 5 },
  { id: "lessonsAll", icon: "crown", tone: "gold", test: (m) => m.lessons >= LESSON_IDS.length },
  { id: "star5", icon: "star", tone: "gold", test: (m) => m.lessons3 >= 5 },
  { id: "hazard", icon: "shield", tone: "red", test: (m) => m.hazard },
  { id: "climate", icon: "globe", tone: "blue", test: (m) => m.climate },
  { id: "match5", icon: "cards", tone: "orange", test: (m) => m.match >= 5 },
  { id: "match10", icon: "brain", tone: "orange", test: (m) => m.match >= 10 },
  { id: "cloud", icon: "cloud", tone: "blue", test: (m) => m.cloud >= 1 },
  { id: "cloud8", icon: "cloud", tone: "teal", test: (m) => m.cloud >= 8 },
  { id: "thirst", icon: "drop", tone: "green", test: (m) => m.thirst },
  { id: "master", icon: "sprout", tone: "gold", test: (m) => m.master },
  { id: "kids3", icon: "sprout", tone: "green", test: (m) => m.kids },
  { id: "ace", icon: "bulb", tone: "orange", test: (m) => m.ace },
  { id: "streak3", icon: "flame", tone: "red", test: (m) => m.streak >= 3 },
  { id: "streak7", icon: "flame", tone: "gold", test: (m) => m.streak >= 7 },
  { id: "drops100", icon: "waves", tone: "teal", test: (m) => m.drops >= 100 },
  { id: "drops300", icon: "trophy", tone: "gold", test: (m) => m.drops >= 300 },
];

function metrics(s) {
  const best = s.best;
  const done = (k) => (best[k] || 0) >= 1;
  const keys = Object.keys(best);
  const farm = readJson("mc-farm");
  return {
    drops: s.drops,
    streak: s.streak,
    lessons: LESSON_IDS.filter((id) => done(`lesson:${id}`)).length,
    lessons3: LESSON_IDS.filter((id) => best[`lesson:${id}`] === 3).length,
    hazard: done("lesson:fire") && done("lesson:slide"),
    climate: done("lesson:elnino") && done("lesson:lanina") && done("lesson:warming"),
    match: keys.filter((k) => k.startsWith("match:") && best[k] >= 1).length,
    cloud: keys.filter((k) => k.startsWith("cloud:")).reduce((a, k) => a + best[k], 0),
    thirst: best["farmer:feed"] === 3,
    master: Object.values(farm?.levels || {}).some((n) => n >= 5),
    kids: done("kids:sort") && done("kids:grow") && done("kids:season"),
    ace: keys.some((k) => k.startsWith("chal:") && best[k] === 3),
  };
}

// Unlock every badge whose rule is now true. Each new badge pays a bonus, which can unlock a drops badge: so loop.
function unlockBadges(s, out) {
  let again = true;
  while (again) {
    again = false;
    const m = metrics(s);
    for (const b of BADGES) {
      if (!s.badges[b.id] && b.test(m)) {
        s.badges[b.id] = localToday();
        s.drops += BADGE_BONUS;
        out.gain += BADGE_BONUS;
        out.badges.push(b.id);
        again = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Awarding
// ---------------------------------------------------------------------------
// game: "lesson" | "match" | "cloud" | "kids" | "chal" | "farmer";  id: which lesson / level / game;  stars: 0..3
// Returns what was earned ({ gain, badges, cards, daily, levelUp }) or null when there was nothing new.
export function reward(game, id, stars, { celebrate = true } = {}) {
  try {
    stars = Math.max(0, Math.min(3, Math.floor(stars)));
    if (stars < 1) return null;
    const s = getRewards();
    const key = `${game}:${id}`;
    const before = s.drops, prev = s.best[key] || 0;
    const out = { gain: 0, badges: [], cards: [], daily: 0, levelUp: null };

    if (stars > prev) {
      out.gain += (stars - prev) * DROPS_PER_STAR;
      if (prev === 0) out.gain += FIRST_BONUS;
      if (stars === 3 && !s.perfect[key]) { out.gain += PERFECT_BONUS; s.perfect[key] = true; }
      s.best[key] = stars;
    }
    if (game === "lesson" && LESSON_IDS.includes(id) && !s.cards[id]) { s.cards[id] = localToday(); out.cards.push(id); }
    if (out.gain === 0 && out.cards.length === 0) return null;                 // nothing new: stay quiet

    // a new day: keep the streak going (a missed day just starts again from one, never a penalty) and pay a small bonus
    const today = localToday();
    if (s.last !== today) {
      s.streak = s.last && dayBefore(today) === s.last ? s.streak + 1 : 1;
      s.last = today;
      out.daily = DAILY_BONUS;
      out.gain += DAILY_BONUS;
    }
    s.drops += out.gain;
    unlockBadges(s, out);

    const from = levelIndex(before), to = levelIndex(s.drops);
    if (to > from) out.levelUp = to;
    save(s);
    if (celebrate) showReward(out);
    return out;
  } catch (err) {
    console.warn("Rewards could not be saved:", err.message);
    return null;
  }
}

// For things that change outside a level end (a farm crop reaching level 5): look for new badges only.
export function checkBadges() {
  try {
    const s = getRewards();
    const out = { gain: 0, badges: [], cards: [], daily: 0, levelUp: null };
    const before = levelIndex(s.drops);
    unlockBadges(s, out);
    if (!out.badges.length) return null;
    const to = levelIndex(s.drops);
    if (to > before) out.levelUp = to;
    save(s);
    showReward(out);
    return out;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Icons (drawn here, no pictures to load): a coloured round badge with a simple white symbol
// ---------------------------------------------------------------------------
const GLYPH = {
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.5 10a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7.5 15h9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  cards: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>',
  cloud: '<path d="M20 16.6A4.5 4.5 0 0 0 18 8h-1.3A7 7 0 1 0 4 14.9"/><path d="M8 19v2M12 18v3M16 19v2"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-4-7-13-7-13S5 11 5 15a7 7 0 0 0 7 7z"/>',
  sprout: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3 0-6 1-9z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4"/>',
  waves: '<path d="M3 9c3-2 6 2 9 0s6 2 9 0M3 14c3-2 6 2 9 0s6 2 9 0M3 19c3-2 6 2 9 0s6 2 9 0"/>',
};
const TONE = { teal: ["#3FB6A8", "#1F7F85"], blue: ["#5BB6E6", "#2477B0"], orange: ["#F7B15C", "#E0762B"], green: ["#7FD08A", "#2E9A55"],
  red: ["#F28B7A", "#CC4B3B"], gold: ["#FFD764", "#E0A010"], grey: ["#D6D3C8", "#AFAA98"] };
let uid = 0;

// A round badge icon. `locked` shows it greyed out with a lock-like dim look.
export function badgeIcon(icon, tone = "teal", size = 56, locked = false) {
  const [a, b] = TONE[locked ? "grey" : tone] || TONE.teal, id = `rwg${uid++}`;
  return `<svg class="rw-ico${locked ? " locked" : ""}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <circle cx="24" cy="24" r="22" fill="url(#${id})" stroke="#fff" stroke-width="3"/>
    <g transform="translate(10 10) scale(1.1667)" fill="none" stroke="${locked ? "#fff" : "#fff"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH[icon] || GLYPH.star}</g>
  </svg>`;
}

// The farmer-level emblem: a gold-edged round badge with a drop and the level number.
export function emblem(index, size = 84) {
  const tones = ["green", "green", "teal", "blue", "gold"], [a, b] = TONE[tones[index]], id = `rwe${uid++}`;
  return `<svg class="rw-emblem" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <circle cx="32" cy="32" r="29" fill="url(#${id})" stroke="#FFE27A" stroke-width="4"/>
    <path d="M32 12c7 9 12 15 12 22a12 12 0 0 1-24 0c0-7 5-13 12-22z" fill="#fff" opacity=".92"/>
    <text x="32" y="40" text-anchor="middle" font-size="17" font-weight="800" fill="${b}" font-family="Noto Sans, sans-serif">${index + 1}</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// The little celebration after a reward (a card at the bottom of the screen, gone after a few seconds or on a tap)
// ---------------------------------------------------------------------------
let toastTimer = 0;
export function showReward(out) {
  const old = document.getElementById("rw-toast");
  if (old) old.remove();
  clearTimeout(toastTimer);
  const lines = [];
  const levelName = (i) => t(`rw.level.${LEVELS[i].id}`);
  lines.push(`<p class="rw-gain"><span class="rw-dropmark" aria-hidden="true"></span>${escapeHtml(t("rw.toast.gain", { n: out.gain }))}</p>`);
  if (out.daily) lines.push(`<p class="rw-line">${escapeHtml(t("rw.toast.daily", { n: out.daily }))}</p>`);
  if (out.levelUp !== null) lines.push(`<p class="rw-line rw-up">${emblem(out.levelUp, 34)} ${escapeHtml(t("rw.toast.level", { level: levelName(out.levelUp) }))}</p>`);
  out.badges.forEach((id) => {
    const b = BADGES.find((x) => x.id === id);
    lines.push(`<p class="rw-line">${badgeIcon(b.icon, b.tone, 34)} ${escapeHtml(t("rw.toast.badge", { name: t(`rw.badge.${id}.name`) }))}</p>`);
  });
  out.cards.forEach((id) => {
    lines.push(`<p class="rw-line"><img class="rw-mini" src="img/lessons/${id}1.jpg" alt="" width="52" height="29"> ${escapeHtml(t("rw.toast.card", { name: t(`ls.${id}.title`) }))}</p>`);
  });
  const el = document.createElement("div");
  el.id = "rw-toast";
  el.className = "rw-toast";
  el.setAttribute("role", "status");
  el.innerHTML = `${lines.join("")}<a class="rw-see" href="#/learn/rewards">${escapeHtml(t("rw.toast.see"))}</a>`;
  el.onclick = (e) => { if (!e.target.closest("a")) el.remove(); };
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 7000);
}
