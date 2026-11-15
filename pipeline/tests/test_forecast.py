"""Tests for pipeline/forecast.py with a hand-made forecast response (no internet)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import forecast" works
import forecast  # noqa: E402

CFG = forecast.load_config()["forecast"]

RESPONSE = {"daily": {
    "time": ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"],
    "precipitation_sum": [24.0, 75.2, 0.4, None],             # last day: no value
    "precipitation_probability_max": [99, 98, 40, None],
    "temperature_2m_max": [28.1, 25.8, 31.0, None],
}}


def test_days_keep_every_value_and_nulls():
    days = forecast.to_days(RESPONSE)
    assert days[1] == {"date": "2026-10-26", "rain_mm": 75.2, "rain_chance": 98, "tmax_c": 25.8}
    assert days[3]["rain_mm"] is None


def test_summary_counts_rain_days_and_skips_missing_days():
    s = forecast.summarise(forecast.to_days(RESPONSE), rain_day_mm=1.0)
    # 24.0 and 75.2 are rain days; 0.4 is below 1 mm; the null day is not counted or guessed.
    assert s == {"rain_days": 2, "total_mm": 99.6, "wettest_day": "2026-10-26", "wettest_mm": 75.2}


def test_dry_fortnight_has_no_wettest_day():
    dry = {"daily": {"time": ["2026-01-01", "2026-01-02"], "precipitation_sum": [0.0, 0.3],
                     "precipitation_probability_max": [5, 10], "temperature_2m_max": [31, 32]}}
    s = forecast.summarise(forecast.to_days(dry), 1.0)
    assert s["rain_days"] == 0 and s["wettest_day"] is None and s["total_mm"] == 0.3


def test_section_carries_source_credit_and_demo_flag():
    sec = forecast.forecast_section(RESPONSE, True, CFG, "2026-10-25T06:00:00+05:30")
    assert sec["issued"] == "2026-10-25T06:00:00+05:30"
    assert "Open-Meteo" in sec["source"] and "CC BY 4.0" in sec["credit"]
    assert sec["demo"] is True and sec["rain_day_mm"] == CFG["rain_day_mm"]
