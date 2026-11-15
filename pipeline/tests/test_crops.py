"""
Tests for pipeline/crops.py with small hand-made climates. No internet, no data files.

    .venv\\Scripts\\python -m pytest pipeline\\tests -v

Every expected number can be worked out with pen and paper; the working is in the comments.
"""

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import crops" works
import crops  # noqa: E402

CFG = crops.load_config()["crops"]
DATA = crops.load_crop_data()
EXTRA = DATA["rice_extra_water"]


def make_cell(rain_by_day, et0=4.0, start="2000-01-01", days=3653):
    """A Cell whose daily rain is rain_by_day(date) mm and whose ET0 is always `et0` mm."""
    idx = pd.date_range(start, periods=days)
    return crops.Cell({
        "start": start,
        "rain_tenths": [int(round(rain_by_day(d.date()) * 10)) for d in idx],
        "et0_tenths": [int(round(et0 * 10))] * days,
    })


# ---------------------------------------------------------------------------
# Growth-stage curve and FAO rules
# ---------------------------------------------------------------------------
def test_kc_curve_follows_the_four_stages():
    kc = {"ini": 0.4, "mid": 1.2, "end": 0.6}
    curve = crops.kc_curve(kc, {"ini": 0.2, "dev": 0.2, "mid": 0.4, "late": 0.2}, 100)
    assert len(curve) == 100
    assert np.allclose(curve[:20], 0.4)                    # initial: constant
    assert 0.4 < curve[20] < curve[39] < 1.2               # development: rising, never overshooting
    assert np.allclose(curve[40:80], 1.2)                  # mid-season: constant
    assert curve[80] < 1.2 and curve[-1] == pytest.approx(0.6)     # late: falling to Kc end
    assert all(np.diff(curve[:40]) >= 0) and all(np.diff(curve[80:]) <= 0)


@pytest.mark.parametrize("p, expected", [
    (100.0, 55.0),     # P > 75:  0.8 x 100 - 25
    (75.0, 35.0),      # P = 75:  0.6 x 75 - 10 = 0.8 x 75 - 25 = 35 (the two rules meet)
    (50.0, 20.0),      # P < 75:  0.6 x 50 - 10
    (10.0, 0.0),       # 0.6 x 10 - 10 is negative: no useful rain
    (0.0, 0.0),
])
def test_fao_effective_rain(p, expected):
    assert crops.fao_effective_rain(p) == pytest.approx(expected)


def test_effective_rain_scales_part_months():
    # A whole 30-day month with 5 mm a day = 150 mm: 0.8 x 150 - 25 = 95 mm useful.
    dates = pd.date_range("2001-06-01", periods=30)
    assert crops.effective_rain(dates, [5.0] * 30) == pytest.approx(95.0)
    # 15 January days with 100 mm in total, then 15 dry February days. January is judged as a
    # 30-day equivalent of 200 mm: 0.8 x 200 - 25 = 135, scaled back by 15/30 = 67.5. February: 0.
    dates = pd.date_range("2001-01-17", periods=30)        # 17-31 Jan (15 days), 1-15 Feb (15 days)
    rain = [100 / 15] * 15 + [0.0] * 15
    assert crops.effective_rain(dates, rain) == pytest.approx(67.5)


def test_paddy_extra_water():
    # 200 mm saturation + 100 mm water layer + 5 mm a day seepage x 100 days
    assert crops.paddy_extra_mm(EXTRA, 100) == 200 + 100 + 500


# ---------------------------------------------------------------------------
# The cell record
# ---------------------------------------------------------------------------
def test_window_returns_data_or_none():
    cell = make_cell(lambda d: 2.0, days=100)
    dates, rain, et0 = cell.window(date(2000, 1, 11), 10)
    assert len(dates) == 10 and np.allclose(rain, 2.0) and np.allclose(et0, 4.0)
    assert cell.window(date(1999, 12, 31), 10) is None            # starts before the record
    assert cell.window(date(2000, 4, 5), 10) is None              # runs past the end


def test_window_is_none_if_a_day_is_missing():
    cell = crops.Cell({"start": "2000-01-01", "rain_tenths": [10, None, 10, 10], "et0_tenths": [40] * 4})
    assert cell.window(date(2000, 1, 1), 4) is None
    assert cell.window(date(2000, 1, 3), 2) is not None


def test_usual_is_the_smoothed_average_by_day_of_year():
    cell = make_cell(lambda d: 3.0)
    usual = cell.usual(2001, 2008, smooth_days=7)
    assert usual["rain"].loc[100] == pytest.approx(3.0) and usual["et0"].loc[300] == pytest.approx(4.0)
    assert len(usual) == 366


# ---------------------------------------------------------------------------
# How often was the rain enough?
# ---------------------------------------------------------------------------
PULSE = {"id": "test", "kind": "ofc", "duration_days": 60,
         "kc": {"ini": 1.0, "mid": 1.0, "end": 1.0}, "stage_fractions": {"ini": 1, "dev": 1, "mid": 1, "late": 1}}


def test_reliability_counts_the_years_with_enough_rain():
    # Even years: 10 mm a day. Odd years: no rain. ET0 4 mm and Kc 1 → the crop needs 60 x 4 = 240 mm.
    # Even years: two months of 300 mm → 215 mm useful each → 430 mm useful, enough (needs 0.8 x 240 = 192).
    # Odd years: nothing.
    cell = make_cell(lambda d: 10.0 if d.year % 2 == 0 else 0.0, days=3653)      # 2000-2009
    curve = crops.kc_curve(PULSE["kc"], PULSE["stage_fractions"], 60)
    ok, years = crops.reliability(cell, PULSE, curve, EXTRA, date(2026, 6, 1), CFG)
    assert (ok, years) == (5, 10)                                                 # 2000, 02, 04, 06, 08


def test_reliability_skips_years_without_a_full_window():
    cell = make_cell(lambda d: 10.0, days=366 + 365 + 100)                        # 2000, 2001 and 100 days of 2002
    curve = crops.kc_curve(PULSE["kc"], PULSE["stage_fractions"], 60)
    _, years = crops.reliability(cell, PULSE, curve, EXTRA, date(2026, 6, 1), CFG)
    assert years == 2                                                             # 2002's June is past the record


# ---------------------------------------------------------------------------
# Expected rain: forecast first, usual after
# ---------------------------------------------------------------------------
def test_expected_series_uses_forecast_then_usual():
    cell = make_cell(lambda d: 3.0)
    usual = cell.usual(2001, 2008, 7)
    forecast = [{"date": "2026-10-25", "rain_mm": 24.0}, {"date": "2026-10-26", "rain_mm": 75.2},
                {"date": "2026-10-27", "rain_mm": None}]                          # a missing day is not guessed
    dates, rain, et0, used = crops.expected_series(cell, usual, date(2026, 10, 25), 5, forecast)
    assert rain[:2].tolist() == [24.0, 75.2]
    assert rain[2:] == pytest.approx([3.0, 3.0, 3.0])                             # no value → usual, not 0
    assert used == 2 and np.allclose(et0, 4.0)


# ---------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("ratio, ok, years, expected", [
    (0.90, 32, 40, "good"),         # enough rain expected AND usually enough in the past (80%)
    (0.90, 12, 40, "possible"),     # expected is fine but it often fails (30% of years): only possible
    (0.60, 36, 40, "possible"),     # between 0.5 and 0.8
    (0.30, 36, 40, "not_now"),      # far too little
    (0.90, 0, 10, "good"),          # fewer than min_years (20) past years: reliability is not used
])
def test_rate_ofc(ratio, ok, years, expected):
    assert crops.rate_ofc(ratio, ok, years, CFG) == expected


@pytest.mark.parametrize("crop, signal, expected", [
    ("paddy", "green", "good"), ("paddy", "amber", "not_now"), ("paddy", "red", "not_now"),
    ("paddy_short", "green", "good"), ("paddy_short", "amber", "good"), ("paddy_short", "red", "not_now"),
    ("paddy", None, "unknown"), ("paddy_short", None, "unknown"),
])
def test_rate_paddy_follows_the_tank_signal(crop, signal, expected):
    assert crops.rate_paddy(crop, signal) == expected


def test_order_puts_good_first_then_by_ratio():
    items = [{"id": "a", "rating": "not_now", "ratio": 0.9}, {"id": "b", "rating": "good", "ratio": 0.9},
             {"id": "c", "rating": "good", "ratio": 1.4}, {"id": "d", "rating": "possible", "ratio": 0.7},
             {"id": "e", "rating": "unknown", "ratio": 0.2}]
    assert [i["id"] for i in crops.order(items)] == ["c", "b", "d", "e", "a"]


# ---------------------------------------------------------------------------
# The whole thing, and the crop table itself
# ---------------------------------------------------------------------------
def test_evaluate_a_wet_and_a_dry_climate():
    wet = make_cell(lambda d: 10.0)
    dry = make_cell(lambda d: 0.0)
    tank_mm = {}
    for cell, mung_expected, _ in ((wet, "good", None), (dry, "not_now", None)):
        usual = cell.usual(2001, 2008, 7)
        items = {i["id"]: i for i in crops.evaluate(cell, usual, DATA, CFG, date(2026, 6, 1), [], "amber")}
        assert items["mung_bean"]["rating"] == mung_expected
        tank_mm[mung_expected] = items["paddy"]["tank_mm"]
        assert items["paddy"]["rating"] == "not_now" and items["paddy_short"]["rating"] == "good"
    # With no rain at all the tank must supply everything paddy needs; rain takes some of that load.
    assert tank_mm["not_now"] == items["paddy"]["need_mm"] and tank_mm["good"] < tank_mm["not_now"]
    # Paddy always needs more than a pulse: it also has to fill and keep the field wet.
    assert items["paddy"]["need_mm"] > 2 * items["mung_bean"]["need_mm"]


def test_calendar_has_one_entry_per_week_and_only_rain_fed_crops():
    cell = make_cell(lambda d: 10.0)
    usual = cell.usual(2001, 2008, 7)
    weeks = crops.calendar(cell, usual, DATA, CFG, date(2026, 6, 1), [])
    assert len(weeks) == CFG["calendar_weeks"]
    assert [w["start"] for w in weeks[:3]] == ["2026-06-01", "2026-06-08", "2026-06-15"]
    everything = {c["id"] for c in DATA["crops"]}
    assert {i["id"] for i in weeks[0]["items"]} == everything
    paddy = [i for i in weeks[0]["items"] if i["kind"] == "paddy"]
    assert {i["id"] for i in paddy} == {"paddy", "paddy_short"} and all("tank_mm" in i for i in paddy)    # paddy: tank water, no weekly rating


def test_calendar_wet_climate_is_good_and_dry_climate_is_not_now_every_week():
    for rain, expected in ((10.0, "good"), (0.0, "not_now")):
        cell = make_cell(lambda d, r=rain: r)
        weeks = crops.calendar(cell, cell.usual(2001, 2008, 7), DATA, CFG, date(2026, 6, 1), [])
        assert {i["rating"] for w in weeks for i in w["items"] if i["kind"] == "ofc"} == {expected}


def test_calendar_uses_the_forecast_only_for_the_days_it_covers():
    # Dry climate, but a very wet forecast for the first 60 days: only early weeks improve.
    cell = make_cell(lambda d: 0.0)
    usual = cell.usual(2001, 2008, 7)
    wet = [{"date": d.date().isoformat(), "rain_mm": 30.0} for d in pd.date_range("2026-06-01", periods=60)]
    weeks = crops.calendar(cell, usual, DATA, CFG, date(2026, 6, 1), wet)
    ratios = [w["items"][0]["ratio"] for w in weeks]
    assert ratios[0] > ratios[-1] and ratios[-1] == 0.0


def test_every_crop_number_has_a_source_and_a_confidence():
    for crop in DATA["crops"]:
        for field in ("duration", "kc", "stage"):
            assert crop.get(f"{field}_source"), (crop["id"], field)
        assert crop["duration_confidence"] in ("high", "medium", "assumption")
        assert crop["kc_confidence"].split(":")[0] in ("high", "medium", "assumption")
        low, high = crop["duration_range"]
        assert low <= crop["duration_days"] <= high            # the value we use sits inside the sourced range
    assert DATA["effective_rain"]["source"].startswith("https://www.fao.org")
