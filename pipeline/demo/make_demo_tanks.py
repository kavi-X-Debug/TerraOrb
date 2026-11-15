"""
Make DEMO tank files so the frontend can be built before real data exists.
=========================================================================

    python pipeline/demo/make_demo_tanks.py        (run from the repo root)

Reads  data/tanks.json
Writes data/tank/<id>.json for every tank with "demo": true

EVERYTHING THIS SCRIPT WRITES IS MADE UP. Every section is marked "demo": true
and its source is "Demo data — not real", so the UI shows the Demo data badge.
Delete these files once the real pipeline produces data for the real tanks.

The numbers are random but *consistent* with docs/schema.md: T really is
current ÷ normal, normals really are the means over normal_period, and so on.
A fixed random seed means every run gives the same files.

The three demo tanks are tuned to show the three signals:
    demo-tank-1 → green,  demo-tank-2 → amber,  demo-tank-3 → red
plus some edge cases the UI must handle: cloudy scenes (null extent), a season
with no detected onset (null), and a tank with no soil data (soil: null).

Standard library only, no pandas or numpy needed.
"""

import json
import math
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
SOURCE = "Demo data — not real"

WATER_NORMAL_YEARS = range(2017, 2026)    # "2017–2025"
RAIN_NORMAL_YEARS = range(1991, 2021)     # "1991–2020"
CURRENT_SCENE = date(2026, 10, 20)        # the "now" satellite scene
RAIN_AS_OF = date(2026, 10, 24)           # last day of rain data for the current season
ELNINO_ANALOGS = [1983, 1998, 2016]       # Yala seasons after past strong El Niño years

# What each demo tank should look like. These targets are the only hand-picked values.
TARGETS = {
    "demo-tank-1": dict(T=1.02, R=1.05, last_onset_delay=3,  soil_pct=62,   elnino_below=1, seed=1),
    "demo-tank-2": dict(T=0.72, R=0.85, last_onset_delay=18, soil_pct=38,   elnino_below=2, seed=2),
    "demo-tank-3": dict(T=0.45, R=0.60, last_onset_delay=9,  soil_pct=None, elnino_below=3, seed=3),
}


def mean(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def ratio(a, b):
    """a ÷ b rounded to 2 decimals, or None if it can't be computed (schema rule)."""
    if a is None or b in (None, 0):
        return None
    return round(a / b, 2)


# ---------------------------------------------------------------------------
# water section
# ---------------------------------------------------------------------------
def make_water(tank, target, rng):
    full_ha = tank["command_area_ha"] * 0.9          # pretend full-tank water area
    series = []
    for year in range(2017, 2027):
        dry_year = 0.7 if year in (2017, 2024) else 1.0
        for month in range(1, 13):
            d = date(year, month, 15)
            if d >= CURRENT_SCENE.replace(day=1):
                break
            # Fullest around January (after Maha rains), emptiest around July–August.
            seasonal = 0.55 + 0.4 * math.cos(2 * math.pi * (month - 1.5) / 12)
            extent = full_ha * seasonal * dry_year * rng.uniform(0.92, 1.08)
            # Wet-season scenes are sometimes too cloudy to measure → null.
            if month in (11, 12) and rng.random() < 0.3:
                extent = None
            series.append({"date": d.isoformat(),
                           "extent_ha": None if extent is None else round(extent, 1)})

    # Normal = mean of the same calendar month over the normal years.
    normal = mean(s["extent_ha"] for s in series
                  if int(s["date"][:4]) in WATER_NORMAL_YEARS
                  and int(s["date"][5:7]) == CURRENT_SCENE.month)
    normal = round(normal, 1)
    current = round(normal * target["T"], 1)
    series.append({"date": CURRENT_SCENE.isoformat(), "extent_ha": current})

    return {
        "series": series,
        "current_date": CURRENT_SCENE.isoformat(),
        "current_extent_ha": current,
        "normal_extent_ha": normal,
        "normal_period": f"{WATER_NORMAL_YEARS[0]}–{WATER_NORMAL_YEARS[-1]}",
        "T": ratio(current, normal),
        "source": SOURCE,
        "demo": True,
    }


# ---------------------------------------------------------------------------
# rain section
# ---------------------------------------------------------------------------
def season_reference(kind, year):
    """Fixed day each season's onset is measured from: Yala 1 March, Maha 1 September."""
    return date(year, 3, 1) if kind == "Yala" else date(year, 9, 1)


def season_label(kind, year):
    return f"Yala {year}" if kind == "Yala" else f"Maha {year}/{(year + 1) % 100:02d}"


def make_rain(target, rng, tank_id):
    # 1. Random onsets (days after the reference date) and totals, Yala 1981 … Yala 2026.
    raw = []
    for year in range(1981, 2027):
        for kind in ("Yala", "Maha"):
            if kind == "Maha" and year == 2026:
                continue                               # Maha 2026/27 is still in progress
            onset_days = round(rng.gauss(28 if kind == "Yala" else 42, 10))
            total = rng.gauss(380 if kind == "Yala" else 850, 110 if kind == "Yala" else 180)
            raw.append(dict(kind=kind, year=year, onset_days=onset_days, total=max(total, 40)))

    # Edge case for the UI: one season where no onset was detected.
    if tank_id == "demo-tank-2":
        next(s for s in raw if s["kind"] == "Yala" and s["year"] == 2009)["onset_days"] = None

    def normal_total(kind):
        return mean(s["total"] for s in raw if s["kind"] == kind and s["year"] in RAIN_NORMAL_YEARS)

    def mean_onset(kind):
        return mean(s["onset_days"] for s in raw if s["kind"] == kind and s["year"] in RAIN_NORMAL_YEARS)

    # 2. Force the El Niño analogue Yala seasons below / above normal to hit the target count.
    yala_normal = normal_total("Yala")
    for i, year in enumerate(ELNINO_ANALOGS):
        season = next(s for s in raw if s["kind"] == "Yala" and s["year"] == year)
        season["total"] = yala_normal * (0.6 if i < target["elnino_below"] else 1.3)

    # 3. Force the latest season's onset delay to the target.
    last = raw[-1]
    last["onset_days"] = round(mean_onset(last["kind"])) + target["last_onset_delay"]

    # 4. Now compute normals and delays exactly as the schema defines them.
    normals = {k: normal_total(k) for k in ("Yala", "Maha")}
    onsets = {k: mean_onset(k) for k in ("Yala", "Maha")}
    seasons = []
    for s in raw:
        ref = season_reference(s["kind"], s["year"])
        onset = None if s["onset_days"] is None else ref + timedelta(days=s["onset_days"])
        seasons.append({
            "season": season_label(s["kind"], s["year"]),
            "onset_date": None if onset is None else onset.isoformat(),
            "onset_delay_days": None if onset is None else round(s["onset_days"] - onsets[s["kind"]]),
            "total_mm": round(s["total"], 1),
            "normal_mm": round(normals[s["kind"]], 1),
        })

    normal_so_far = round(rng.uniform(180, 240), 1)
    rain_so_far = round(normal_so_far * target["R"], 1)

    rain = {
        "seasons": seasons,
        "normal_period": f"{RAIN_NORMAL_YEARS[0]}–{RAIN_NORMAL_YEARS[-1]}",
        "current": {
            "season": "Maha 2026/27",
            "as_of": RAIN_AS_OF.isoformat(),
            "rain_so_far_mm": rain_so_far,
            "normal_so_far_mm": normal_so_far,
            "R": ratio(rain_so_far, normal_so_far),
        },
        "source": SOURCE,
        "demo": True,
    }

    # El Niño section, counted from the seasons above.
    analog = [s for s in seasons if s["season"] in [f"Yala {y}" for y in ELNINO_ANALOGS]]
    with_data = [s for s in analog if s["total_mm"] is not None and s["normal_mm"] is not None]
    elnino = {
        "analog_seasons": [f"Yala {y}" for y in ELNINO_ANALOGS],
        "below_normal_count": sum(1 for s in with_data if s["total_mm"] < s["normal_mm"]),
        "total": len(with_data),
        "source": SOURCE,
        "demo": True,
    }
    return rain, elnino


# ---------------------------------------------------------------------------
# result section
# ---------------------------------------------------------------------------
def demo_signal(T, R, delay):
    """DEMO ONLY: the draft thresholds from the proposal, checked red → amber → green.

    The real rule engine (pipeline/rules/) is the logic lead's job, including the
    final order and what happens when no rule matches (here: None).
    """
    if T is None or R is None:
        return None
    if T < 0.6 or (T < 0.75 and R < 0.75):
        return "red"
    if T < 0.9 or (delay is not None and delay > 14):
        return "amber"
    if T >= 0.9 and R >= 0.9:
        return "green"
    return None


def make_result(water, rain, soil, elnino, now):
    T, R = water["T"], rain["current"]["R"]
    delay = rain["seasons"][-1]["onset_delay_days"]
    S = soil["S"] if soil else None
    signal = demo_signal(T, R, delay)
    recommended = {"green": "full_paddy", "amber": "short_paddy_bethma", "red": "ofc"}.get(signal)

    reasons = [
        {"text_key": "reason.tank_index", "value": T, "unit": "ratio", "source": water["source"]},
        {"text_key": "reason.rain_index", "value": R, "unit": "ratio", "source": rain["source"]},
    ]
    if delay is not None:
        reasons.append({"text_key": "reason.onset_delay" if delay >= 0 else "reason.onset_early",
                        "value": abs(delay), "unit": "days", "source": rain["source"]})
    if soil:
        reasons.append({"text_key": "reason.soil_index", "value": soil["percentile"],
                        "unit": "percentile", "source": soil["source"]})
    reasons.append({"text_key": "reason.elnino", "value": elnino["below_normal_count"],
                    "unit": "count", "source": elnino["source"]})

    return {
        "signal": signal,
        "recommended_scenario": recommended,
        "scenarios": [
            {"id": "full_paddy", "title_key": "scenario.full_paddy.title",
             "crops": ["paddy"], "share_of_command_area": 1.0},
            {"id": "short_paddy_bethma", "title_key": "scenario.short_paddy_bethma.title",
             "crops": ["paddy_short"], "share_of_command_area": None if T is None else min(T, 1.0)},
            {"id": "ofc", "title_key": "scenario.ofc.title",
             "crops": ["mung_bean", "cowpea", "black_gram"], "share_of_command_area": 1.0},
        ],
        "reasons": reasons,
        "inputs": {"T": T, "R": R, "S": S, "onset_delay_days": delay},
        "rules_version": "demo",
        "updated": now,
        "demo": True,
    }


# ---------------------------------------------------------------------------
def main():
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()
    out_dir = REPO / "data" / "tank"
    out_dir.mkdir(exist_ok=True)

    for tank in tanks:
        if not tank["demo"]:
            continue                           # never overwrite a real tank
        target = TARGETS.get(tank["id"])
        if target is None:
            raise SystemExit(f"No demo targets for {tank['id']}; add it to TARGETS.")
        rng = random.Random(target["seed"])

        water = make_water(tank, target, rng)
        rain, elnino = make_rain(target, rng, tank["id"])
        soil = None if target["soil_pct"] is None else {
            "as_of": "2026-10-22", "percentile": target["soil_pct"],
            "S": round(target["soil_pct"] / 100, 2), "source": SOURCE, "demo": True,
        }
        doc = {
            "schema_version": "1.0",
            "id": tank["id"],
            "generated": now,
            "demo": True,
            "water": water,
            "rain": rain,
            "soil": soil,
            "elnino": elnino,
            "result": make_result(water, rain, soil, elnino, now),
        }
        path = out_dir / f"{tank['id']}.json"
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        r = doc["result"]
        print(f"{path.relative_to(REPO)}: signal={r['signal']}  T={water['T']}  "
              f"R={rain['current']['R']}  last onset delay={r['inputs']['onset_delay_days']} d")


if __name__ == "__main__":
    main()
