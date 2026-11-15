import fs from "node:fs";
import assert from "node:assert/strict";
// Run: node tools/test_planner_extras.mjs
import { fileURLToPath } from "node:url";
const src = fs.readFileSync(fileURLToPath(new URL("../web/js/planner-extras.js", import.meta.url)), "utf8");
const m = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

// a one-day synthetic forecast (test fixture, not real data)
const index = new Map(); const gust = [], uv = [], feels = [];
for (let h = 0; h < 24; h++) { index.set(`2026-11-20T${String(h).padStart(2, "0")}:00`, h); gust.push(h === 15 ? 62 : 20); uv.push(h === 13 ? 9 : 2); feels.push(h === 14 ? 39 : 30); }
const f = { index, gust, uv, feels, days: [{ date: "2026-11-20", sunrise: "2026-11-20T06:05", sunset: "2026-11-20T17:40" }] };

let e = m.extrasFor(f, "2026-11-20", 9, 17);
assert.equal(e.wind, "strong"); assert.equal(e.sun, "very_high"); assert.equal(e.heat, "hot");
assert.equal(e.dark, false); assert.equal(e.early, false);
e = m.extrasFor(f, "2026-11-20", 9, 19);   assert.equal(e.dark, true);
e = m.extrasFor(f, "2026-11-20", 5, 9);    assert.equal(e.early, true);
e = m.extrasFor(f, "2026-11-20", 9, 12);   assert.equal(e.wind, "calm"); assert.equal(e.sun, "ok"); assert.equal(e.heat, "ok");
assert.equal(m.clock(17.6667), "17:40");
assert.equal(m.kindOf("nonsense"), "general"); assert.equal(m.kindOf("hike"), "hike");
// the bring list
const wet = { cls: "wet", hottest: 30 };
const list = m.bringList(wet, { sun: "high", heat: "ok", wind: "windy", dark: true }, "hike");
for (const k of ["raincoat", "backup", "sunscreen", "hat", "secure", "torch", "shoes"]) assert.ok(list.includes(k), k);
assert.deepEqual(m.bringList({ cls: "dry", hottest: 28 }, { sun: "ok", heat: "ok", wind: "calm", dark: false }), []);
// comparison
assert.equal(m.betterOf({ cls: "dry", mm: 0, chance: 10 }, { cls: "wet", mm: 8, chance: 80 }), "a");
assert.equal(m.betterOf({ cls: "maybe", mm: 1, chance: 40 }, { cls: "maybe", mm: 0.6, chance: 40 }), "b");
assert.equal(m.betterOf({ cls: "dry", mm: 0, chance: 5 }, { cls: "dry", mm: 0, chance: 5 }), "same");
// calendar file
const ics = m.icsFile({ name: "Kandy, Sri Lanka", day: "2026-11-20", from: 9, to: 17, summary: "Hike; Kandy", description: "Dry.\nGood", url: "http://x/#a" });
assert.match(ics, /DTSTART:20261120T090000/); assert.match(ics, /DTEND:20261120T170000/);
assert.match(ics, /SUMMARY:Hike\\; Kandy/); assert.match(ics, /LOCATION:Kandy\\, Sri Lanka/); assert.ok(ics.endsWith("\r\n"));
console.log("all planner-extras tests passed");
