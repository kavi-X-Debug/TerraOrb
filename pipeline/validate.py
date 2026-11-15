"""
Validation of Monsoon Compass outlooks (backtesting)
====================================================

    .venv\\Scripts\\python pipeline\\validate.py        (run from the repo root, after rain.py / water.py)

Reads only data/tank/<id>.json (rain, elnino, water) and writes:
    data/validation.json     every number, per tank and overall (format: docs/schema.md §5)
    docs/validation.md       a short report for people

1. El Niño analogue outlook — leave one out
   For each analogue season (Yala 1983, 1998, 2016) in turn:
     * rebuild the Yala normal from the normal period WITHOUT that year;
     * count how many of the OTHER analogue seasons were below that normal;
     * call "below" if most were, "not below" if most weren't, no call on a tie;
     * compare the call with what actually happened in the left-out year.
   Report: hits out of calls (and how many were no call).

2. Tank level model
   Monthly tank extent, as % of the largest monthly extent seen in the training years,
   ~ intercept + rain 1 month before + rain 2 months before + rain 3 months before.
   Linear regression fitted on 2017–2022, tested on 2023–2025.

3. Baseline: climatology = mean % for that calendar month in 2017–2022.
   Report the model's mean absolute error (MAE, in percentage points) next to the
   baseline's, on exactly the same test months. If the model isn't better, say so.

Nothing is tuned on the test years: the capacity, the model and the baseline all use
the training years only, and the settings in [validate] (config.toml) are fixed in advance.
"""

import json
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def year_of(label):
    """'Yala 2016' → 2016, 'Maha 2015/16' → 2015."""
    return int(label.split()[1][:4])


# ===========================================================================
# 1. El Niño analogue outlook, leave one out
# ===========================================================================
def elnino_leave_one_out(seasons, analog_seasons, normal_first, normal_last):
    """Leave each analogue out, call its outcome from the others, and score the call.

    seasons: rain.seasons from a tank file. Returns a dict with one row per analogue.
    """
    yala = {s["season"]: s["total_mm"] for s in seasons if s["season"].startswith("Yala")}
    with_data = [a for a in analog_seasons if yala.get(a) is not None]
    rows = []
    for held in with_data:
        # Normal without the left-out year, so its own rain can't help the call.
        normal_years = [t for label, t in yala.items()
                        if normal_first <= year_of(label) <= normal_last
                        and label != held and t is not None]
        if not normal_years:
            continue
        normal = sum(normal_years) / len(normal_years)
        rest = [a for a in with_data if a != held]
        below = sum(1 for a in rest if yala[a] < normal)
        if 2 * below > len(rest):
            call = "below"
        elif 2 * below < len(rest):
            call = "not_below"
        else:
            call = None                                    # tie: no call
        actual = "below" if yala[held] < normal else "not_below"
        rows.append({
            "season": held,
            "normal_mm_without_this_year": round(normal, 1),
            "others_below": below,
            "others_total": len(rest),
            "call": call,
            "actual": actual,
            "total_mm": yala[held],
            "hit": None if call is None else call == actual,
        })
    calls = [r for r in rows if r["call"] is not None]
    return {
        "rows": rows,
        "hits": sum(1 for r in calls if r["hit"]),
        "calls": len(calls),
        "no_calls": len(rows) - len(calls),
    }


# ===========================================================================
# 2 + 3. Tank level model vs climatology
# ===========================================================================
def monthly_extent(series):
    """{"YYYY-MM": extent_ha} from water.series (median if a month has several entries)."""
    by_month = {}
    for s in series or []:
        if s.get("extent_ha") is not None:
            by_month.setdefault(s["date"][:7], []).append(s["extent_ha"])
    return {m: float(np.median(v)) for m, v in by_month.items()}


def month_minus(month, n):
    year, mon = int(month[:4]), int(month[5:7]) - n
    while mon < 1:
        year, mon = year - 1, mon + 12
    return f"{year}-{mon:02d}"


def build_rows(extent, rain_monthly, lags):
    """One row per month that has an extent AND rain for every lag month."""
    rain = {m["month"]: m["total_mm"] for m in rain_monthly or []}
    rows = []
    for month, ha in sorted(extent.items()):
        x = [rain.get(month_minus(month, lag)) for lag in lags]
        if any(v is None for v in x):
            continue
        rows.append({"month": month, "year": int(month[:4]), "extent_ha": ha, "rain": x})
    return rows


def tank_model(series, rain_monthly, cfg):
    """Fit on the training years, score on the test years, compare with climatology."""
    v = cfg["validate"]
    train_years = range(v["train_first_year"], v["train_last_year"] + 1)
    test_years = range(v["test_first_year"], v["test_last_year"] + 1)
    lags = v["rain_lags_months"]
    periods = {"train_period": f"{train_years[0]}–{train_years[-1]}",
               "test_period": f"{test_years[0]}–{test_years[-1]}"}

    extent = monthly_extent(series)
    # Capacity = largest monthly extent in the TRAINING years only (no peeking at the test years).
    train_extents = [ha for m, ha in extent.items() if int(m[:4]) in train_years]
    if not train_extents or max(train_extents) <= 0:
        return {"status": "not_enough_data", "reason": "no water data in the training years", **periods}
    capacity = max(train_extents)

    rows = build_rows(extent, rain_monthly, lags)
    train = [r for r in rows if r["year"] in train_years]
    test = [r for r in rows if r["year"] in test_years]

    # Climatology baseline from ALL training months with an extent (rain not needed for it).
    by_cal = {}
    for m, ha in extent.items():
        if int(m[:4]) in train_years:
            by_cal.setdefault(m[5:7], []).append(100 * ha / capacity)
    climatology = {cal: sum(vals) / len(vals) for cal, vals in by_cal.items()}
    test = [r for r in test if r["month"][5:7] in climatology]      # same months for both

    if len(train) < v["min_train_months"] or len(test) < v["min_test_months"]:
        return {"status": "not_enough_data",
                "reason": f"{len(train)} training months (need {v['min_train_months']}), "
                          f"{len(test)} test months (need {v['min_test_months']})",
                **periods, "n_train": len(train), "n_test": len(test)}

    def design(rs):
        return np.array([[1.0, *r["rain"]] for r in rs])

    y_train = np.array([100 * r["extent_ha"] / capacity for r in train])
    coef, *_ = np.linalg.lstsq(design(train), y_train, rcond=None)

    y_test = np.array([100 * r["extent_ha"] / capacity for r in test])
    predicted = design(test) @ coef
    baseline = np.array([climatology[r["month"][5:7]] for r in test])
    mae_model = float(np.mean(np.abs(predicted - y_test)))
    mae_base = float(np.mean(np.abs(baseline - y_test)))
    beats = mae_model < mae_base

    return {
        "status": "ok",
        **periods,
        "n_train": len(train),
        "n_test": len(test),
        "capacity_ha": round(capacity, 1),
        "coefficients": {"intercept": round(float(coef[0]), 3),
                         **{f"rain_lag{lag}_per_mm": round(float(c), 4) for lag, c in zip(lags, coef[1:])}},
        "mae_model_pp": round(mae_model, 1),
        "mae_baseline_pp": round(mae_base, 1),
        "beats_baseline": beats,
        "verdict": ("The model beats the climatology baseline." if beats else
                    "The model does NOT beat the climatology baseline, so it should not be used."),
    }


# ===========================================================================
# 4. Per tank, summary, writing
# ===========================================================================
def validate_tank(tank, doc, cfg):
    rain, water, elnino = doc.get("rain") or {}, doc.get("water") or {}, doc.get("elnino") or {}
    return {
        "id": tank["id"],
        "demo": bool(tank.get("demo") or water.get("demo") or rain.get("demo")),
        "sources": {"rain": rain.get("source"), "water": water.get("source")},
        "elnino": elnino_leave_one_out(rain.get("seasons", []),
                                       elnino.get("analog_seasons") or cfg["elnino"]["analog_seasons"],
                                       cfg["rain"]["normal_first_year"], cfg["rain"]["normal_last_year"]),
        "tank_model": tank_model(water.get("series"), rain.get("monthly"), cfg),
    }


def summarise(results):
    ok = [r["tank_model"] for r in results if r["tank_model"]["status"] == "ok"]
    beats = sum(1 for m in ok if m["beats_baseline"])
    if not ok:
        model_verdict = "No tank had enough data to test the tank level model."
    elif beats == len(ok):
        model_verdict = f"The model beats the baseline for all {len(ok)} tested tank(s)."
    elif beats == 0:
        model_verdict = (f"The model does NOT beat the baseline for any of the {len(ok)} tested tank(s). "
                         "Do not use it; show climatology instead.")
    else:
        model_verdict = (f"The model beats the baseline for only {beats} of {len(ok)} tested tanks. "
                         "It is not reliable enough to use.")
    return {
        "elnino": {"hits": sum(r["elnino"]["hits"] for r in results),
                   "calls": sum(r["elnino"]["calls"] for r in results),
                   "no_calls": sum(r["elnino"]["no_calls"] for r in results)},
        "tank_model": {
            "tanks_tested": len(ok),
            "tanks_beating_baseline": beats,
            "mean_mae_model_pp": round(sum(m["mae_model_pp"] for m in ok) / len(ok), 1) if ok else None,
            "mean_mae_baseline_pp": round(sum(m["mae_baseline_pp"] for m in ok) / len(ok), 1) if ok else None,
            "verdict": model_verdict,
        },
    }


def markdown_report(report):
    s = report["summary"]
    lines = [
        "# Monsoon Compass — validation report",
        "",
        f"Generated {report['generated']} by `pipeline/validate.py`. All numbers: `data/validation.json`.",
        "",
    ]
    if report["demo"]:
        lines += [
            "> **⚠ Demo data.** At least one tank uses placeholder locations or demo water values,",
            "> so these results say nothing about real tanks. Re-run after `water.py` has real data.",
            "",
        ]
    e = s["elnino"]
    lines += [
        "## El Niño analogue outlook (leave one out)",
        "",
        "Each analogue season is left out in turn; the others decide the call "
        "(most below normal → \"below\"; a tie → no call).",
        "",
        "| Tank | Season left out | Others below normal | Call | What happened | Hit |",
        "|---|---|---|---|---|---|",
    ]
    for r in report["tanks"]:
        for row in r["elnino"]["rows"]:
            call = {"below": "below", "not_below": "not below", None: "no call (tie)"}[row["call"]]
            hit = "—" if row["hit"] is None else ("yes" if row["hit"] else "no")
            lines.append(f"| {r['id']} | {row['season']} | {row['others_below']} of {row['others_total']} | "
                         f"{call} | {row['actual'].replace('_', ' ')} ({row['total_mm']} mm vs "
                         f"{row['normal_mm_without_this_year']} mm) | {hit} |")
    lines += ["", f"**Overall: {e['hits']} hits out of {e['calls']} calls** "
                  f"({e['no_calls']} no call). Three analogue years are too few for a reliable score.", ""]

    m = s["tank_model"]
    lines += [
        "## Tank level model vs climatology",
        "",
        "Monthly extent (% of the largest 2017–2022 month) from rain 1, 2 and 3 months before; "
        "fitted on 2017–2022, tested on 2023–2025. Baseline: mean % for that month in 2017–2022. "
        "MAE = mean absolute error in percentage points (lower is better).",
        "",
        "| Tank | Train / test months | Model MAE | Baseline MAE | Beats baseline? |",
        "|---|---|---|---|---|",
    ]
    for r in report["tanks"]:
        t = r["tank_model"]
        if t["status"] != "ok":
            lines.append(f"| {r['id']} | — | — | — | not tested: {t['reason']} |")
        else:
            lines.append(f"| {r['id']} | {t['n_train']} / {t['n_test']} | {t['mae_model_pp']} pp | "
                         f"{t['mae_baseline_pp']} pp | {'yes' if t['beats_baseline'] else '**NO**'} |")
    lines += ["", f"**{m['verdict']}**", ""]
    if m["tanks_tested"]:
        lines += [f"Mean MAE: model {m['mean_mae_model_pp']} pp, baseline {m['mean_mae_baseline_pp']} pp.", ""]
    cs = report["crops"]["summary"]
    lines += ["## Crop advice (rain-fed crops): does \"the rain is usually enough\" hold up?", ""]
    if cs.get("n"):
        first = report["crops"]["cells"][0]
        lines += [
            "For each rain-fed crop (mung bean, cowpea, black gram) and each sowing date (1st and 15th of every month) "
            f"we used only the years {first['train_period']} to work out how often the rain was enough, "
            f"then checked that against {first['test_period']}, which the method never saw. "
            "Paddy isn't tested here: it follows the tank signal. The 16-day forecast can't be tested, because past forecasts weren't saved.",
            "",
            "| | Result |",
            "|---|---|",
            f"| Cases tested | {cs['n']} (neighbouring sowing dates overlap, so treat this as a guide) |",
            f"| Rain was actually enough | {round(100 * cs['base_rate'])} % of cases |",
            f"| Right when we said **good** | {'—' if cs['good_was_right'] is None else str(round(100 * cs['good_was_right'])) + ' %'} |",
            f"| Rain enough even when we said **not good** | {'—' if cs['not_good_but_enough'] is None else str(round(100 * cs['not_good_but_enough'])) + ' %'} |",
            f"| Overall right | {round(100 * cs['accuracy'])} % (guessing the common answer: {round(100 * cs['accuracy_guessing'])} %) |",
            "",
            f"**{cs['verdict']}**",
            "",
            "| Crop | Cases | Right when \"good\" | Overall right | Guessing |",
            "|---|---|---|---|---|",
        ]
        merged = {}
        for cell in report["crops"]["cells"]:
            for cid, sc in cell["per_crop"].items():
                m = merged.setdefault(cid, [0, 0, 0, 0])
                for i, k in enumerate(("tp", "fp", "fn", "tn")):
                    m[i] += sc[k]
        for cid, counts in merged.items():
            sc = score_counts(*counts)
            if sc["n"]:
                good = "—" if sc["good_was_right"] is None else f"{round(100 * sc['good_was_right'])} %"
                lines.append(f"| {cid} | {sc['n']} | {good} | {round(100 * sc['accuracy'])} % | {round(100 * sc['accuracy_guessing'])} % |")
        lines.append("")
    else:
        lines += [cs["verdict"], ""]
    if report.get("notes"):
        lines += ["## Notes", ""] + [f"- {n}" for n in report["notes"]] + [""]
    return "\n".join(lines)


# ===========================================================================
# 4. Crop advice: would "the rain is usually enough" have held in years it never saw?
# ===========================================================================
def crops_backtest(cell, crops_data, cfg):
    """Backtest the rain-fed crop advice of pipeline/crops.py on one NASA POWER grid cell.

    For every rain-fed crop and every sowing date (1st and 15th of each month):
      * work out, from the TRAIN years only, in what share of years the useful rain was enough;
      * call the sowing "good" if that share is at least crops.good_reliability;
      * check the call against what really happened in each TEST year (rain enough or not).
    The forecast part of the live advice can't be tested: past forecasts weren't saved.
    This imports the model's own functions on purpose: it must test exactly what runs.
    """
    import crops
    v, c = cfg["validate"], cfg["crops"]
    train = range(v["crops_train_first_year"], v["crops_train_last_year"] + 1)
    test = range(v["crops_test_first_year"], v["crops_test_last_year"] + 1)
    extra = crops_data["rice_extra_water"]
    per_crop = {}
    for crop in crops_data["crops"]:
        if crop["kind"] != "ofc":
            continue                                   # paddy follows the tank signal, not rain alone
        curve = crops.kc_curve(crop["kc"], crop["stage_fractions"], crop["duration_days"])
        tp = fp = fn = tn = 0
        for month in range(1, 13):
            for day in v["crops_sow_days"]:
                def enough(year, month=month, day=day, crop=crop, curve=curve):
                    w = cell.window(crops.safe_start(year, month, day), len(curve))
                    if w is None:
                        return None
                    dates, rain, et0 = w
                    etc, _ = crops.crop_water(crop, curve, et0, extra)
                    return crops.effective_rain(dates, rain) >= c["adequate_ratio"] * etc
                past = [a for a in (enough(y) for y in train) if a is not None]
                if len(past) < c["min_years"]:
                    continue
                said_good = sum(past) / len(past) >= c["good_reliability"]
                for year in test:
                    actual = enough(year)
                    if actual is None:
                        continue
                    if said_good and actual:
                        tp += 1
                    elif said_good:
                        fp += 1
                    elif actual:
                        fn += 1
                    else:
                        tn += 1
        per_crop[crop["id"]] = score_counts(tp, fp, fn, tn)
    totals = [sum(x[k] for x in per_crop.values()) for k in ("tp", "fp", "fn", "tn")]
    return {"per_crop": per_crop, **score_counts(*totals),
            "train_period": f"{train[0]}–{train[-1]}", "test_period": f"{test[0]}–{test[-1]}"}


def score_counts(tp, fp, fn, tn):
    """Turn counts into rates, and compare with just guessing the more common outcome."""
    n = tp + fp + fn + tn
    if n == 0:
        return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "n": 0, "verdict": "Not enough data to test."}
    base = (tp + fn) / n                                # share of cases where the rain really was enough
    guess = max(base, 1 - base)                         # accuracy of always guessing the more common answer
    accuracy = (tp + tn) / n
    precision = tp / (tp + fp) if tp + fp else None     # when we said "good", how often was it right?
    miss = fn / (fn + tn) if fn + tn else None          # when we said "not good", how often was the rain enough anyway?
    beats = accuracy > guess and (precision is None or precision > base)
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn, "n": n,
        "base_rate": round(base, 2), "accuracy": round(accuracy, 2), "accuracy_guessing": round(guess, 2),
        "good_was_right": None if precision is None else round(precision, 2),
        "not_good_but_enough": None if miss is None else round(miss, 2),
        "beats_guessing": beats,
        "verdict": ("The advice beats simply guessing." if beats else
                    "The advice does NOT beat simply guessing, so it should not be shown as a prediction."),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]

    results, docs = [], {}
    for tank in tanks:
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            print(f"{tank['id']}: no data file, skipped")
            continue
        docs[tank["id"]] = json.loads(path.read_text(encoding="utf-8"))
        results.append(validate_tank(tank, docs[tank["id"]], cfg))

    # Tanks in the same rain grid cell repeat the same El Niño test; say so.
    notes = []
    seen = {}
    for r in results:
        key = json.dumps(docs[r["id"]].get("rain", {}).get("seasons"))
        seen.setdefault(key, []).append(r["id"])
    for ids in seen.values():
        if len(ids) > 1:
            notes.append(f"{', '.join(ids)} have identical rainfall (same NASA POWER grid cell), "
                         "so their El Niño results are the same test counted more than once.")

    # Crop advice backtest: once per NASA POWER grid cell (tanks in a cell share the same rain).
    import crops
    crops_data = crops.load_crop_data()
    crop_cells = {}
    for doc in docs.values():
        xy = tuple((doc.get("rain") or {}).get("power_cell") or ())
        if xy and xy not in crop_cells:
            path = REPO / "data" / "cells" / f"{xy[0]}_{xy[1]}.json"
            if path.exists():
                crop_cells[xy] = {"cell": list(xy),
                                  **crops_backtest(crops.Cell(json.loads(path.read_text(encoding="utf-8"))), crops_data, cfg)}
            else:
                notes.append(f"No data/cells file for grid cell {xy}: its crop advice was not tested (run rain.py).")
    totals = [sum(c[k] for c in crop_cells.values()) for k in ("tp", "fp", "fn", "tn")]
    crops_summary = score_counts(*totals) if crop_cells else {"verdict": "No crop climate files found; run rain.py."}

    report = {
        "generated": datetime.now(SRI_LANKA).replace(microsecond=0).isoformat(),
        "demo": any(r["demo"] for r in results),
        "settings": cfg["validate"],
        "tanks": results,
        "summary": summarise(results),
        "crops": {"cells": list(crop_cells.values()), "summary": crops_summary},
        "notes": notes,
    }
    (REPO / "data" / "validation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (REPO / "docs" / "validation.md").write_text(markdown_report(report), encoding="utf-8")

    # Console table
    print(f"{'tank':<14}{'El Niño hits':>14}{'model MAE':>11}{'baseline':>10}  beats?")
    for r in results:
        e, t = r["elnino"], r["tank_model"]
        mae = (f"{t['mae_model_pp']:>9} pp{t['mae_baseline_pp']:>7} pp  {'yes' if t['beats_baseline'] else 'NO'}"
               if t["status"] == "ok" else f"{'—':>11}{'—':>10}  not tested ({t['reason']})")
        print(f"{r['id']:<14}{e['hits']:>4} of {e['calls']} ({e['no_calls']} tie){'':>1}{mae}")
    s = report["summary"]
    print(f"\nEl Niño overall: {s['elnino']['hits']} hits of {s['elnino']['calls']} calls, "
          f"{s['elnino']['no_calls']} no call")
    print(s["tank_model"]["verdict"])
    cs = report["crops"]["summary"]
    if cs.get("n"):
        first = report["crops"]["cells"][0]
        print(f"\nCrop advice backtest ({first['train_period']} -> {first['test_period']}): {cs['n']} cases; "
              f"rain was enough in {round(100 * cs['base_rate'])}%; right when we said good: {cs['good_was_right']}; "
              f"overall right {cs['accuracy']} vs guessing {cs['accuracy_guessing']}")
    print(cs["verdict"])
    for n in notes:
        print(f"NOTE: {n}")
    if report["demo"]:
        print("WARNING: demo data involved; these results say nothing about real tanks.")
    print("Wrote data/validation.json and docs/validation.md")


if __name__ == "__main__":
    main()
