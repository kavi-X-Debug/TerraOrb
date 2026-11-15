"""
Tests for pipeline/validate.py with small hand-made data. No files are read or written.

    .venv\\Scripts\\python -m pytest pipeline\\tests -v
"""

import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import validate" works
import validate  # noqa: E402

CFG = validate.load_config()
ANALOGS = ["Yala 1983", "Yala 1998", "Yala 2016"]


# ---------------------------------------------------------------------------
# El Niño, leave one out
# ---------------------------------------------------------------------------
def yala_seasons(totals):
    """totals: {year: mm}. Every other year 1991–2020 gets 300 mm."""
    base = {y: 300.0 for y in range(1991, 2021)}
    base.update(totals)
    return [{"season": f"Yala {y}", "total_mm": t} for y, t in sorted(base.items())]


def test_elnino_all_below_gives_three_hits():
    seasons = yala_seasons({1983: 200.0, 1998: 210.0, 2016: 220.0})
    out = validate.elnino_leave_one_out(seasons, ANALOGS, 1991, 2020)
    # Leaving any one out: the other two are both below → call "below"; it was below → hit.
    assert (out["hits"], out["calls"], out["no_calls"]) == (3, 3, 0)


def test_elnino_split_gives_ties_and_misses():
    seasons = yala_seasons({1983: 200.0, 1998: 400.0, 2016: 210.0})
    out = validate.elnino_leave_one_out(seasons, ANALOGS, 1991, 2020)
    rows = {r["season"]: r for r in out["rows"]}
    # Leave 1983 out: 1998 above, 2016 below → 1 of 2 → tie, no call.
    assert rows["Yala 1983"]["call"] is None and rows["Yala 1983"]["hit"] is None
    # Leave 1998 out: 1983 and 2016 below → call "below", but 1998 was above → miss.
    assert rows["Yala 1998"]["call"] == "below" and rows["Yala 1998"]["hit"] is False
    # Leave 2016 out: tie again.
    assert rows["Yala 2016"]["call"] is None
    assert (out["hits"], out["calls"], out["no_calls"]) == (0, 1, 2)


def test_elnino_normal_leaves_out_the_held_year():
    seasons = yala_seasons({1983: 200.0, 1998: 900.0, 2016: 210.0})
    rows = {r["season"]: r for r in validate.elnino_leave_one_out(seasons, ANALOGS, 1991, 2020)["rows"]}
    # Normal without 1998: 28 years at 300 + 2016 at 210 → (8400 + 210) / 29 = 296.9
    assert rows["Yala 1998"]["normal_mm_without_this_year"] == pytest.approx(296.9, abs=0.05)
    # Normal without 2016 includes 1998's 900: (8400 + 900) / 29 = 320.7
    assert rows["Yala 2016"]["normal_mm_without_this_year"] == pytest.approx(320.7, abs=0.05)


def test_elnino_skips_analogue_without_data():
    seasons = yala_seasons({1983: 200.0, 1998: 210.0, 2016: 220.0})
    seasons = [s for s in seasons if s["season"] != "Yala 1983"]      # 1983 before the record
    out = validate.elnino_leave_one_out(seasons, ANALOGS, 1991, 2020)
    assert [r["season"] for r in out["rows"]] == ["Yala 1998", "Yala 2016"]
    assert all(r["others_total"] == 1 for r in out["rows"])


# ---------------------------------------------------------------------------
# Tank model and climatology
# ---------------------------------------------------------------------------
def month_range(first_year, last_year):
    return [f"{y}-{m:02d}" for y in range(first_year, last_year + 1) for m in range(1, 13)]


def rain_series(rule):
    return [{"month": m, "total_mm": rule(m)} for m in month_range(2016, 2025)]


def rain_rule(month):
    """Made-up but varied monthly rain, the same every run."""
    y, m = int(month[:4]), int(month[5:7])
    return float((m * 37 + y * 11) % 200)


def water_from(formula):
    """Monthly extent (ha) computed from the previous months' rain with `formula`."""
    rain = {r["month"]: r["total_mm"] for r in rain_series(rain_rule)}
    series = []
    for month in month_range(2017, 2025):
        lags = [rain[validate.month_minus(month, k)] for k in (1, 2, 3)]
        series.append({"date": f"{month}-01", "extent_ha": formula(month, lags)})
    return series


def test_model_recovers_an_exact_linear_relation_and_beats_climatology():
    # extent = 10 + 0.05·r1 + 0.03·r2 + 0.01·r3 ha. A straight line fits it exactly.
    series = water_from(lambda m, r: 10 + 0.05 * r[0] + 0.03 * r[1] + 0.01 * r[2])
    out = validate.tank_model(series, rain_series(rain_rule), CFG)
    assert out["status"] == "ok"
    assert out["n_train"] == 72 and out["n_test"] == 36          # 6 and 3 years of months
    assert out["mae_model_pp"] == pytest.approx(0.0, abs=0.05)
    assert out["mae_baseline_pp"] > 1
    assert out["beats_baseline"] is True


def test_model_that_cannot_beat_climatology_says_so():
    # Extent follows the calendar only (same every year); rain has nothing to do with it.
    series = water_from(lambda m, r: 20 + 10 * (int(m[5:7]) in (12, 1, 2)))
    out = validate.tank_model(series, rain_series(rain_rule), CFG)
    assert out["mae_baseline_pp"] == pytest.approx(0.0, abs=0.05)   # climatology is perfect here
    assert out["beats_baseline"] is False
    assert "NOT" in out["verdict"]


def test_test_years_never_change_the_fitted_model():
    series = water_from(lambda m, r: 10 + 0.05 * r[0])
    a = validate.tank_model(series, rain_series(rain_rule), CFG)
    changed = copy.deepcopy(series)
    for s in changed:
        if s["date"][:4] >= "2023":
            s["extent_ha"] = 999.0                       # wild test-year values
    b = validate.tank_model(changed, rain_series(rain_rule), CFG)
    assert a["coefficients"] == b["coefficients"]       # fitted on 2017–2022 only
    assert a["capacity_ha"] == b["capacity_ha"]         # capacity from training years only
    assert b["mae_model_pp"] > a["mae_model_pp"]        # but the test score does see them


def test_percent_uses_largest_training_month():
    series = [{"date": f"{m}-01", "extent_ha": 50.0} for m in month_range(2017, 2025)]
    series[0]["extent_ha"] = 100.0                      # Jan 2017 is the largest → capacity 100 ha
    out = validate.tank_model(series, rain_series(rain_rule), CFG)
    assert out["capacity_ha"] == 100.0


def test_not_enough_data():
    series = [{"date": "2017-01-01", "extent_ha": 10.0}, {"date": "2023-01-01", "extent_ha": 9.0}]
    out = validate.tank_model(series, rain_series(rain_rule), CFG)
    assert out["status"] == "not_enough_data"
    assert validate.tank_model([], rain_series(rain_rule), CFG)["status"] == "not_enough_data"


def test_month_minus_crosses_years():
    assert validate.month_minus("2023-02", 3) == "2022-11"
    assert validate.month_minus("2023-12", 1) == "2023-11"


def test_summary_states_clearly_when_model_does_not_beat_baseline():
    results = [{"elnino": {"hits": 1, "calls": 1, "no_calls": 2},
                "tank_model": {"status": "ok", "beats_baseline": False,
                               "mae_model_pp": 20.0, "mae_baseline_pp": 15.0}}] * 2
    s = validate.summarise(results)
    assert s["tank_model"]["tanks_beating_baseline"] == 0
    assert "does NOT beat the baseline" in s["tank_model"]["verdict"]
    assert s["elnino"] == {"hits": 2, "calls": 2, "no_calls": 4}
