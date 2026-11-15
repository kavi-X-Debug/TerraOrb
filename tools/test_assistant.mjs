// Tests for the assistant's topic matcher (web/js/assistant-kb.js) with the real keyword lists in web/strings/assistant.*.json.
// Run: node tools/test_assistant.mjs
// Each case is [end, question, expected topic id, or null when the bot must NOT be sure (it should ask "Did you mean...?")].
import fs from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const web = (p) => fileURLToPath(new URL(`../web/${p}`, import.meta.url));
const kb = await import("data:text/javascript;base64," + Buffer.from(fs.readFileSync(web("js/assistant-kb.js"), "utf8")).toString("base64"));
const en = JSON.parse(fs.readFileSync(web("strings/assistant.en.json"), "utf8"));
const si = JSON.parse(fs.readFileSync(web("strings/assistant.si.json"), "utf8"));
const kwOf = (id) => [en[`ak.${id}.kw`], si[`ak.${id}.kw`]].filter(Boolean).flatMap((s) => s.split("|")).map((w) => w.trim().toLowerCase()).filter(Boolean);

// 1. Every topic of every end has keywords, a question and an answer in BOTH languages, and the same placeholders in both.
for (const [end, ids] of Object.entries(kb.TOPICS)) {
  for (const id of ids) {
    for (const part of ["kw", "q", "a"]) {
      assert.ok(en[`ak.${id}.${part}`], `${end}: missing English ak.${id}.${part}`);
      assert.ok(si[`ak.${id}.${part}`], `${end}: missing Sinhala ak.${id}.${part}`);
    }
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(en[`ak.${id}.a`]), ph(si[`ak.${id}.a`]), `placeholders differ in ak.${id}.a`);
  }
}
assert.deepEqual(Object.keys(en).sort(), Object.keys(si).sort(), "English and Sinhala must have the same keys");

// 2. Questions per end
const CASES = [
  ["farmer", "what does amber mean", "signal_meaning"],
  ["farmer", "What do green, amber and red mean?", "signal_meaning"],
  ["farmer", "what is bethma", "bethma"],
  ["farmer", "wat is bethmaa", "bethma"],                       // spelling slip
  ["farmer", "can i trust the forcast", "forecast_trust"],       // spelling slip
  ["farmer", "why does it say water not checked yet", "bad_water_data"],
  ["farmer", "what is maha and yala", "maha_yala"],
  ["farmer", "Where does the data come from?", "data_sources"],
  ["farmer", "how do i plan my own farm", "farm_planner"],
  ["farmer", "are you chatgpt", "not_ai"],
  ["farmer", "බෙත්මා යනු මොකක්ද", "bethma"],
  ["farmer", "මහ සහ යල යනු මොනවාද", "maha_yala"],
  ["farmer", "ඔබ ඒඅයිද", "not_ai"],
  ["farmer", "Will it rain soon?", null],                       // a tank question, not a written topic
  ["farmer", "What should I sow now?", null],
  ["farmer", "How is my tank water?", null],
  ["farmer", "when should i sow mung bean", null],
  ["learn", "how do i earn drops", "rewards_how"],
  ["learn", "what lessons are there", "lessons"],
  ["learn", "is it safe for children", "parents"],
  ["learn", "how does my farm work", "my_farm_game"],
  ["learn", "is there a certificate", "certificate"],
  ["officer", "how many tanks are red", "officer_count"],
  ["officer", "which tanks are red", "officer_list_red"],
  ["officer", "can i download the table", "csv_download"],
  ["officer", "why do i have to sign in", "officer_signin"],
  ["officer", "what is greenness", "greenness"],
  ["officer", "are the limits official", "thresholds_draft"],
  ["research", "how accurate are the tests", "tests_summary"],
  ["research", "did the el nino outlook work", "el_nino_result"],
  ["research", "what are the known problems", "known_issues"],
  ["research", "can i reproduce the results", "reproduce"],
  ["research", "how does it work", "method"],
  ["plan", "how do you decide dry maybe or wet", "how_verdict"],
  ["plan", "what is the best day", "best_time"],
  ["plan", "how do you judge wind sun and heat", "wind_uv_heat"],
  ["plan", "can i compare two places", "compare_places"],
  ["plan", "can i add it to my calendar", "calendar_file"],
  ["plan", "how reliable is the forecast", "forecast_uncertainty"],
  // things the bot must not pretend to know
  ["farmer", "who won the cricket match", "NONE"],
  ["learn", "what is the capital of france", "NONE"],
  ["plan", "book me a hotel in kandy", "NONE"],
];

let wrong = 0;
for (const [end, q, expected] of CASES) {
  const r = kb.rank(q, kb.TOPICS[end], kwOf);
  const top = r.list[0]?.id;
  let ok;
  if (expected === "NONE") ok = !r.sure;                         // must not be sure of anything
  else if (expected === null) ok = true;                         // either is fine: the tank flow decides; report only
  else ok = r.sure && top === expected;
  if (!ok) { wrong++; console.log(`MISS [${end}] "${q}" -> expected ${expected}, got ${top} (score ${r.list[0]?.score?.toFixed(2)}, sure ${r.sure})`); }
}
// The tank questions must not be hijacked by a topic in the farmer end
for (const q of ["Will it rain soon?", "What should I sow now?", "How is my tank water?", "when should i sow mung bean", "Can I plant paddy?"]) {
  const r = kb.rank(q, kb.TOPICS.farmer, kwOf);
  if (r.sure) { wrong++; console.log(`HIJACK farmer "${q}" -> ${r.list[0].id}`); }
}
console.log(wrong ? `${wrong} problem(s)` : `all ${CASES.length} assistant questions matched as expected`);
process.exit(wrong ? 1 : 0);
