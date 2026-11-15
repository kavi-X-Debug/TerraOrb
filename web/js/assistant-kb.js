// The knowledge side of "Ask TerraOrb": a list of topics for each end, and a fuzzy keyword matcher.
//
// It is still NOT an AI. Each topic has a list of keywords and phrases (Sinhala and English, in web/strings/assistant.*.json,
// key "ak.<topic>.kw") and one fixed answer ("ak.<topic>.a"), so every answer was written and can be checked by a person.
// What is new is the matching: spelling mistakes ("forcast", "bethmaa") and word endings are tolerated, phrases score higher
// than single words, several topics are ranked, and when nothing is sure enough the bot offers the closest questions
// ("Did you mean...?") instead of guessing. This file is pure (no page needed) so it can be tested: tools/test_assistant.mjs.

// Which topics each end can talk about, in the order they are offered as question chips. `link` is the page to open.
export const TOPICS = {
  farmer: ["signal_meaning", "bethma", "maha_yala", "onset", "bad_water_data", "forecast_trust", "live_rain", "weekly_advice", "share_card", "advanced_view", "el_nino", "farm_planner", "data_sources", "nasa_or_not", "offline", "privacy", "languages", "not_ai"],
  learn: ["lessons", "games", "rewards_how", "levels", "certificate", "my_farm_game", "kids_games", "challenges", "real_or_game", "parents", "data_sources", "offline", "privacy", "not_ai"],
  officer: ["officer_count", "officer_list_red", "dashboard_use", "filters", "csv_download", "print_report", "officer_signin", "red_means", "live6", "greenness", "demo_tanks", "data_age", "thresholds_draft", "data_sources", "not_ai"],
  research: ["method", "tests_summary", "el_nino_result", "tank_model_result", "crop_accuracy", "known_issues", "thresholds_draft", "reproduce", "data_sources", "nasa_or_not", "not_ai"],
  plan: ["how_verdict", "best_time", "trip_kinds", "wind_uv_heat", "usual_month", "compare_places", "calendar_file", "forecast_uncertainty", "plan_sources", "share_plan", "privacy", "not_ai"],
};

// Pages to open for a topic (hash addresses). Topics not listed here have no link.
export const LINKS = {
  signal_meaning: "#/how-it-works", bethma: "#/learn/lessons/bethma", maha_yala: "#/learn/lessons/seasons", onset: "#/how-it-works",
  forecast_trust: "#/how-it-works", farm_planner: "#/farm", el_nino: "#/learn/lessons/elnino", lessons: "#/learn/lessons", games: "#/learn/kids", rewards_how: "#/learn/rewards", levels: "#/learn/rewards",
  certificate: "#/learn/rewards", my_farm_game: "#/learn/play/farm", kids_games: "#/learn/kids", challenges: "#/learn/challenges",
  dashboard_use: "#/officer", officer_list_red: "#/officer", officer_count: "#/officer", method: "#/how-it-works", tests_summary: "#/research",
  how_verdict: "#/plan", best_time: "#/plan", trip_kinds: "#/plan",
  compare_places: "#/plan", crop_accuracy: "#/research", el_nino_result: "#/research", tank_model_result: "#/research",
};

// ---- text helpers ---------------------------------------------------------------
// Lower-case, remove accents, keep letters and digits of any script (Sinhala included), single spaces.
export function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}඀-෿‍]+/gu, " ").trim();
}
const SINHALA = /[඀-෿]/;
export const tokens = (s) => norm(s).split(" ").filter(Boolean);

// Edit distance (insert, delete, change one letter), small and fast enough for short words.
export function distance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return prev[b.length];
}

// How well does one typed word match one keyword word? 1 = same, 0.8 = same start or a small spelling slip, 0 = no.
export function wordScore(typed, key) {
  if (typed === key) return 1;
  if (SINHALA.test(key)) return key.length >= 3 && (typed.startsWith(key) || key.startsWith(typed) && typed.length >= 3) ? 0.9 : 0;   // word endings
  if (key.length >= 5 && typed.length >= 4 && (typed.startsWith(key) || key.startsWith(typed))) return 0.9;                          // "forecasts", "forec"
  const d = distance(typed, key), allowed = key.length >= 8 ? 2 : key.length >= 5 ? 1 : 0;
  return d <= allowed ? 0.8 : 0;
}

// Score one keyword (a word or a phrase) against the typed words. A phrase needs every one of its words; it scores its length.
export function phraseScore(typedWords, phrase) {
  const keyWords = tokens(phrase);
  if (!keyWords.length) return 0;
  let sum = 0;
  for (const kw of keyWords) {
    let best = 0;
    for (const tw of typedWords) best = Math.max(best, wordScore(tw, kw));
    if (!best) return 0;
    sum += best;
  }
  return keyWords.length === 1 && keyWords[0].length < 3 ? 0 : sum;
}

// Rank the topics for a question. `keywordsOf(id)` returns the keyword strings of a topic. Result: best first, with scores.
// `sure` is true when the best topic is clearly better than the next one.
export function rank(question, ids, keywordsOf) {
  const typed = tokens(question);
  if (!typed.length) return { list: [], sure: false };
  const list = ids.map((id) => {
    const scores = keywordsOf(id).map((k) => phraseScore(typed, k)).filter(Boolean).sort((a, b) => b - a);
    // the best keyword counts fully, further ones add a little (so a topic matched in several ways wins)
    const score = scores.length ? scores[0] + 0.3 * scores.slice(1, 4).reduce((a, b) => a + b, 0) : 0;
    return { id, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const [a, b] = list;
  return { list, sure: Boolean(a) && a.score >= 1 && (!b || a.score >= b.score * 1.25) };
}
