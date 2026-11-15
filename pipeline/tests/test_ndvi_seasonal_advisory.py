"""Tests for pipeline/ndvi.py, seasonal.py and advisory.py with hand-made inputs (no internet)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import ndvi" works
import advisory  # noqa: E402
import ndvi  # noqa: E402
import seasonal  # noqa: E402

NDVI = ndvi.load_config()["ndvi"]
SEASONAL = seasonal.load_config()["seasonal"]
ADVISORY = advisory.load_config()["advisory"]


# ---------------------------------------------------------------------------
# NDVI
# ---------------------------------------------------------------------------
def test_median_leaves_out_water_and_fill_pixels():
    pixels = [-3000, 500, 8000, 7000, 6000] + [7000] * 20       # fill, water (0.05), then 23 land pixels
    assert ndvi.median_land_ndvi(pixels, NDVI) == 0.7


def test_too_few_land_pixels_gives_null_not_a_guess():
    assert ndvi.median_land_ndvi([8000] * (NDVI["min_land_pixels"] - 1) + [-3000] * 50, NDVI) is None


def test_usual_uses_only_earlier_years_and_needs_enough_years():
    # MODIS dates are fixed days of the year (257 = 14 Sep, or 13 Sep in a leap year such as 2024)
    obs = {"2022-09-14": 0.30, "2023-09-14": 0.40, "2024-09-13": 0.50, "2026-09-14": 0.80,
           "2023-01-01": 0.60}                                  # slot 1 has one year only
    usual = ndvi.usual_by_slot(obs, 2026, NDVI)
    assert [u["doy"] for u in usual] == [ndvi.slot_of("2022-09-14")]
    assert usual[0]["mean"] == 0.4 and usual[0]["min"] == 0.3 and usual[0]["max"] == 0.5


def test_current_state_above_about_below():
    usual = [{"doy": ndvi.slot_of("2026-09-14"), "mean": 0.40, "min": 0.3, "max": 0.5, "years": 7}]
    assert ndvi.current_state({"2026-09-14": 0.55}, usual, NDVI)["state"] == "above"
    assert ndvi.current_state({"2026-09-14": 0.42}, usual, NDVI)["state"] == "about"
    assert ndvi.current_state({"2026-09-14": 0.20}, usual, NDVI)["state"] == "below"


def test_no_real_values_means_no_section():
    assert ndvi.ndvi_section({"2026-09-14": None}, False, NDVI, "now") is None


# ---------------------------------------------------------------------------
# Seasonal
# ---------------------------------------------------------------------------
def _daily(days, members=12, mm=1.0):
    times = [f"2026-12-{d:02d}" for d in range(1, days + 1)]
    out = {"time": times}
    for m in range(members):
        out["precipitation_sum" if m == 0 else f"precipitation_sum_member{m:02d}"] = [mm * (m + 1)] * days
    return out


def test_whole_month_gets_totals_and_a_partial_month_is_skipped():
    assert seasonal.member_totals(_daily(31), "2026-12")[0] == 31.0
    assert seasonal.member_totals(_daily(20), "2026-12") is None


def test_percentile_interpolates():
    assert seasonal.percentile([0, 10], 50) == 5
    assert seasonal.percentile([1, 2, 3, 4, 5], 100) == 5


def test_usual_month_rain_needs_20_years():
    monthly = [{"month": f"{y}-12", "total_mm": 200.0} for y in range(1991, 2021)]
    assert seasonal.usual_month_rain(monthly, 1991, 2020) == {"12": 200.0}
    assert seasonal.usual_month_rain(monthly[:10], 1991, 2020) == {}


def test_section_has_a_range_and_the_usual_rain():
    doc = {"rain": {"monthly": [{"month": f"{y}-12", "total_mm": 200.0} for y in range(1991, 2021)]}}
    section = seasonal.seasonal_section({"daily": _daily(31)}, doc, False, SEASONAL, "now")
    month = section["months"][0]
    assert month["month"] == "2026-12" and month["usual_mm"] == 200.0
    assert month["low_mm"] < month["middle_mm"] < month["high_mm"]


# ---------------------------------------------------------------------------
# Advisory
# ---------------------------------------------------------------------------
def _doc(rain, tmax=30.0, chance=80, n=10, signal="green"):
    days = [{"date": f"2026-11-{6 + i:02d}", "rain_mm": rain, "rain_chance": chance, "tmax_c": tmax} for i in range(n)]
    return {"result": {"signal": signal}, "forecast": {"days": days, "rain_day_mm": 1.0}}


def _ids(items):
    return {i["key"] for i in items}


def test_heavy_rain_week_warns_and_names_the_day():
    doc = _doc(5.0)
    doc["forecast"]["days"][2]["rain_mm"] = 80.0
    items = advisory.build_items(doc, "2026-11-06", ADVISORY)
    heavy = next(i for i in items if i["key"] == "advisory.rain.heavy")
    assert heavy["values"]["date"] == "2026-11-08" and heavy["values"]["mm"] == 80


def test_dry_hot_week_gets_dry_and_heat_items_and_spray_days():
    items = advisory.build_items(_doc(0.0, tmax=36.0, chance=10), "2026-11-06", ADVISORY)
    keys = _ids(items)
    assert {"advisory.rain.dry", "advisory.heat", "advisory.spray.days"} <= keys
    assert len(next(i for i in items if i["id"] == "spray")["dates"]) == 7


def test_old_forecast_gives_no_weather_advice():
    items = advisory.build_items(_doc(5.0, n=2), "2026-11-06", ADVISORY)
    assert "advisory.forecast_old" in _ids(items)
    assert not any(k.startswith(("advisory.rain.", "advisory.heat", "advisory.spray")) for k in _ids(items))


def test_missing_sections_are_skipped_not_invented():
    items = advisory.build_items({"forecast": None}, "2026-11-06", ADVISORY)
    assert _ids(items) == {"advisory.water.none", "advisory.forecast_old"}


def test_green_item_only_when_there_is_a_usual_to_compare_with():
    doc = _doc(5.0)
    doc["ndvi"] = {"current": {"date": "2026-09-14", "ndvi": 0.5, "usual": None, "diff": None, "state": None}}
    assert not any(k.startswith("advisory.green") for k in _ids(advisory.build_items(doc, "2026-11-06", ADVISORY)))
    doc["ndvi"]["current"]["state"] = "above"
    assert "advisory.green.above" in _ids(advisory.build_items(doc, "2026-11-06", ADVISORY))
