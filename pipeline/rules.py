"""
Rule engine of TerraOrb
==============================

    .venv\\Scripts\\python pipeline\\rules.py          (run from the repo root)

For every tank in data/tanks.json this script reads data/tank/<id>.json and writes
its "result" section: the water signal (green / amber / red), the three season
scenarios with the recommended one marked, and the reasons behind the signal.
It also writes the "learn" section: real past seasons replayed with the same rules,
for the web app's Learn Mode.

It reads ONLY the JSON file (water, rain, soil, elnino); it never imports the data
pipeline. All thresholds are in pipeline/rules_config.json.

Inputs
    T                 water.T             tank water now ÷ normal
    R                 rain.current.R      rain so far this season ÷ normal (may be null)
    onset_delay_days  rain.seasons[-1]    latest season's onset delay (may be null)
    S                 soil.S              optional; saved in "inputs", not used in the signal yet

Signal, checked in this order (first match wins):
    red    T < 0.6,  or  (T < 0.75 and R < 0.75)
    amber  T < 0.9,  or  onset_delay_days > 14
    green  T >= 0.9 and R >= 0.9
    amber  otherwise
A missing value (null) never makes a rule fire, so missing rain can't give "green".
If T itself is missing there is no signal (null): we don't guess.

Output format: docs/schema.md §3.5.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
SCHEMA_VERSION = "1.2"


def load_config(path=PIPELINE / "rules_config.json"):
    return json.loads(path.read_text(encoding="utf-8"))


# ===========================================================================
# 1. Reading the inputs from a tank file
# ===========================================================================
def section(doc, name):
    """A section of the tank file as a dict ({} if it's missing or null)."""
    value = doc.get(name)
    return value if isinstance(value, dict) else {}


def read_inputs(doc):
    """Pull T, R, onset delay and S (plus where each came from) out of a tank file."""
    water, rain, soil = section(doc, "water"), section(doc, "rain"), section(doc, "soil")
    current = rain.get("current") or {}
    seasons = rain.get("seasons") or []
    latest = seasons[-1] if seasons else {}
    return {
        "T": water.get("T"),
        "R": current.get("R"),
        "S": soil.get("S"),
        "onset_delay_days": latest.get("onset_delay_days"),
        "onset_season": latest.get("season"),
        "sources": {"T": water.get("source"), "R": rain.get("source"),
                    "onset": rain.get("source"), "S": soil.get("source")},
    }


# ===========================================================================
# 2. The signal  (pure function: numbers in, signal + fired rules out)
# ===========================================================================
def below(value, limit):
    """value < limit, but False when the value is missing (a missing value never fires a rule)."""
    return value is not None and value < limit


def decide(T, R, onset_delay_days, cfg):
    """Return (signal, fired) where fired is a list of (reason name, input name).

    reason name → text key "reason.<name>";  input name → which value to show ("T", "R", "onset").
    """
    if T is None:
        return None, [("no_tank_data", None)]

    # 1. red
    fired = []
    if below(T, cfg["red_T"]):
        fired.append(("tank_far_below_normal", "T"))
    if below(T, cfg["red_T_with_R"]) and below(R, cfg["red_R"]):
        if not fired:                                   # don't list the tank twice
            fired.append(("tank_below_normal", "T"))
        fired.append(("rain_below_normal", "R"))
    if fired:
        return "red", fired

    # 2. amber
    if below(T, cfg["amber_T"]):
        fired.append(("tank_below_normal", "T"))
    if onset_delay_days is not None and onset_delay_days > cfg["amber_onset_delay_days"]:
        fired.append(("onset_late", "onset"))
    if fired:
        return "amber", fired

    # 3. green
    if T >= cfg["green_T"] and R is not None and R >= cfg["green_R"]:
        return "green", [("tank_normal", "T"), ("rain_normal", "R")]

    # 4. otherwise amber: say which green condition was missing
    if T < cfg["green_T"]:
        fired.append(("tank_below_normal", "T"))
    if R is None:
        fired.append(("rain_unknown", None))
    elif R < cfg["green_R"]:
        fired.append(("rain_below_normal", "R"))
    return "amber", fired


# ===========================================================================
# 3. Building the result block
# ===========================================================================
def percent(ratio):
    return None if ratio is None else round(ratio * 100)


def reason(name, input_name, inputs):
    """One entry of result.reasons: {text_key, value, unit, source, kind}."""
    if input_name in ("T", "R"):
        value, unit = percent(inputs[input_name]), "percent"
    elif input_name == "onset":
        value, unit = inputs["onset_delay_days"], "days"
    else:
        value, unit = None, None
    return {
        "text_key": f"reason.{name}",
        "value": value,
        "unit": unit,
        "source": inputs["sources"].get(input_name) if input_name else None,
        "kind": "rule",
    }


def elnino_reason(elnino):
    """The El Niño outlook line. Always a count ("2 of 3"), never a percentage."""
    if not elnino or not elnino.get("total"):
        return None
    return {
        "text_key": "reason.elnino",
        "value": elnino["below_normal_count"],
        "total": elnino["total"],
        "unit": "count",
        "source": elnino.get("source"),
        "kind": "outlook",
    }


def scenarios(signal, T, cfg):
    """Always all three scenarios, in config order, with the recommended one marked."""
    out = []
    for s in cfg["scenarios"]:
        if s["id"] == "short_paddy_bethma":
            # Bethma on round(T × 100) % of the command area (never more than 100 %).
            share = None if T is None else min(round(T * 100), 100) / 100
        else:
            share = 1.0
        out.append({
            "id": s["id"],
            "title_key": s["title_key"],
            "crops": list(s["crops"]),
            "share_of_command_area": share,
            "recommended": s["for_signal"] == signal,
        })
    return out


def build_result(doc, cfg, now):
    inputs = read_inputs(doc)
    signal, fired = decide(inputs["T"], inputs["R"], inputs["onset_delay_days"], cfg)

    reasons = [reason(name, input_name, inputs) for name, input_name in fired]
    outlook = elnino_reason(section(doc, "elnino"))
    if outlook:
        reasons.append(outlook)

    scenario_list = scenarios(signal, inputs["T"], cfg)
    recommended = next((s["id"] for s in scenario_list if s["recommended"]), None)
    demo = any(section(doc, k).get("demo") for k in ("water", "rain", "soil", "elnino"))

    return {
        "signal": signal,
        "recommended_scenario": recommended,
        "scenarios": scenario_list,
        "reasons": reasons,
        "inputs": {k: inputs[k] for k in ("T", "R", "S", "onset_delay_days", "onset_season")},
        "rules_version": cfg["version"],
        "updated": now,
        "demo": demo,
    }


# ===========================================================================
# 4. Learn Mode: replaying real past seasons with the same rules
# ===========================================================================
RISK = {"full_paddy": 3, "short_paddy_bethma": 2, "ofc": 1}      # how much water each plan needs


def ratio(a, b):
    if a is None or b in (None, 0):
        return None
    return round(a / b, 2)


def water_by_month(series):
    """{"YYYY-MM": extent_ha} (median if a month has several values)."""
    by_month = {}
    for s in series or []:
        if s.get("extent_ha") is not None:
            by_month.setdefault(s["date"][:7], []).append(s["extent_ha"])
    return {m: median(v) for m, v in by_month.items()}


def month_normal(water, month):
    """Mean extent for that calendar month in all OTHER years (so a season isn't its own normal)."""
    others = [ha for m, ha in water.items() if m[5:] == month[5:] and m[:4] != month[:4]]
    return sum(others) / len(others) if others else None


def season_parts(label):
    kind, years = label.split()
    return kind, int(years[:4])


def previous_season(label):
    kind, year = season_parts(label)
    return f"Maha {year - 1}/{year % 100:02d}" if kind == "Yala" else f"Yala {year}"


def season_month_list(label, cfg):
    kind, year = season_parts(label)
    months = cfg["learn"]["season_months"][kind]
    first = int(months[0])
    # Months numbered lower than the first one belong to the next year (Maha's January).
    return [f"{year + (1 if int(m) < first else 0)}-{m}" for m in months]


def build_case(doc, label, cfg):
    """One Learn Mode case: what was known before the season, and what happened. None if data is missing."""
    water_sec, rain_sec = section(doc, "water"), section(doc, "rain")
    water = water_by_month(water_sec.get("series"))
    seasons = {s["season"]: s for s in rain_sec.get("seasons") or []}
    kind, year = season_parts(label)
    prev_label = previous_season(label)
    if label not in seasons or prev_label not in seasons:
        return None

    # Before: the tank in the month before the season, and the previous season's rain.
    pre_month = f"{year}-{cfg['learn']['pre_month'][kind]}"
    pre_ha, pre_normal = water.get(pre_month), month_normal(water, pre_month)
    prev = seasons[prev_label]
    before = {
        "month": pre_month,
        "extent_ha": None if pre_ha is None else round(pre_ha, 1),
        "normal_ha": None if pre_normal is None else round(pre_normal, 1),
        "T": ratio(pre_ha, pre_normal),
        "prev_season": prev_label,
        "rain_mm": prev["total_mm"],
        "normal_mm": prev["normal_mm"],
        "R": ratio(prev["total_mm"], prev["normal_mm"]),
        "onset_delay_days": prev["onset_delay_days"],
    }

    # After: the tank across the season's months, and the season's actual rain.
    months = [m for m in season_month_list(label, cfg) if m in water]
    normals = [month_normal(water, m) for m in months]
    if months and all(n is not None for n in normals):
        mean_ha = sum(water[m] for m in months) / len(months)
        mean_normal = sum(normals) / len(normals)
    else:
        mean_ha = mean_normal = None
    actual = seasons[label]
    after = {
        "months_with_data": len(months),
        "extent_ha": None if mean_ha is None else round(mean_ha, 1),
        "normal_ha": None if mean_normal is None else round(mean_normal, 1),
        "T": ratio(mean_ha, mean_normal),
        "rain_mm": actual["total_mm"],
        "normal_mm": actual["normal_mm"],
        "R": ratio(actual["total_mm"], actual["normal_mm"]),
        "onset_delay_days": actual["onset_delay_days"],
    }

    signal_before, _ = decide(before["T"], before["R"], before["onset_delay_days"], cfg)
    signal_after, _ = decide(after["T"], after["R"], after["onset_delay_days"], cfg)
    if signal_before is None or signal_after is None:
        return None
    by_signal = {s["for_signal"]: s["id"] for s in cfg["scenarios"]}
    best = by_signal[signal_after]
    outcomes = {sid: ("right" if RISK[sid] == RISK[best] else
                      "too_risky" if RISK[sid] > RISK[best] else "too_careful")
                for sid in RISK}
    return {
        "season": label,
        "before": before,
        "after": after,
        "signal_before": signal_before,
        "advice_before": by_signal[signal_before],
        "signal_after": signal_after,
        "best_scenario": best,
        "outcomes": outcomes,
        "sources": {"water": water_sec.get("source"), "rain": rain_sec.get("source")},
        "demo": bool(water_sec.get("demo") or rain_sec.get("demo")),
    }


def build_learn(doc, cfg, now):
    cases = [c for c in (build_case(doc, label, cfg) for label in cfg["learn"]["seasons"]) if c]
    return {"cases": cases, "rules_version": cfg["version"], "updated": now,
            "demo": any(c["demo"] for c in cases)}


# ===========================================================================
# 5. Main
# ===========================================================================
def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()

    print(f"Rules {cfg['version']}")
    print(f"{'tank':<14}{'T':>6}{'R':>6}{'onset d':>9}  {'signal':<7}{'recommended':<20}reasons")
    for tank in tanks:
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            print(f"{tank['id']:<14}  no data/tank file yet: skipped")
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        result = build_result(doc, cfg, now)

        doc["result"] = result                    # only the result and learn sections change
        doc["learn"] = build_learn(doc, cfg, now)
        doc["schema_version"] = SCHEMA_VERSION
        doc["demo"] = any(section(doc, k).get("demo") for k in ("water", "rain", "soil", "elnino", "result"))
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        i = result["inputs"]
        show = lambda x: "-" if x is None else x          # noqa: E731
        why = ", ".join(f"{r['text_key'][7:]}={show(r['value'])}"
                        + (f"/{r['total']}" if "total" in r else "") for r in result["reasons"])
        print(f"{tank['id']:<14}{show(i['T']):>6}{show(i['R']):>6}{show(i['onset_delay_days']):>9}  "
              f"{show(result['signal']):<7}{show(result['recommended_scenario']):<20}{why}")
        for c in doc["learn"]["cases"]:
            print(f"{'':<14}learn {c['season']}: before T={c['before']['T']} R={c['before']['R']} "
                  f"-> {c['signal_before']};  after T={c['after']['T']} R={c['after']['R']} "
                  f"-> {c['signal_after']} (best: {c['best_scenario']})")


if __name__ == "__main__":
    main()
