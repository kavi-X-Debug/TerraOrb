"""
Tests for pipeline/rain.py using small, hand-made rainfall series.
No internet needed. Run from the repo root:

    .venv\\Scripts\\python -m pytest pipeline\\tests -v

Every expected number below can be checked with pen and paper; the working
is in the comments.
"""

import copy
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import rain" works
import rain  # noqa: E402

CFG = rain.load_config()          # the real thresholds: 3 days ≥ 25 mm, no 7 days < 10 mm in 30
ONSET = CFG["rain"]["onset"]


def dry_series(start, end):
    """A rainfall series with 0 mm every day from start to end."""
    return pd.Series(0.0, index=pd.date_range(start, end, freq="D"))


def put(series, first, last, mm):
    """Set every day from first to last (inclusive) to mm."""
    series.loc[pd.Timestamp(first):pd.Timestamp(last)] = mm


# ---------------------------------------------------------------------------
# Onset
# ---------------------------------------------------------------------------
def test_onset_is_first_day_of_wet_spell():
    s = dry_series("2015-08-01", "2015-12-31")
    put(s, "2015-09-10", "2015-09-12", 10.0)   # 30 mm, but BEFORE the 15 Sep window: ignored
    put(s, "2015-09-20", "2015-09-22", 10.0)   # 30 mm in 3 days ≥ 25 → wet spell
    put(s, "2015-09-23", "2015-11-30", 5.0)    # 5 mm/day: every 7 days = 35 mm ≥ 10 → no dry spell
    assert rain.find_onset(s, date(2015, 9, 15), ONSET) == date(2015, 9, 20)


def test_false_start_followed_by_dry_spell_is_rejected():
    s = dry_series("2015-08-01", "2015-12-31")
    put(s, "2015-09-16", "2015-09-18", 10.0)   # wet spell, but then 0 mm until 9 Oct → false start
    put(s, "2015-10-10", "2015-10-12", 10.0)   # real wet spell
    put(s, "2015-10-13", "2015-12-31", 5.0)    # and the rain keeps going
    assert rain.find_onset(s, date(2015, 9, 15), ONSET) == date(2015, 10, 10)


def test_no_rain_means_no_onset():
    s = dry_series("2015-08-01", "2016-02-28")
    assert rain.find_onset(s, date(2015, 9, 15), ONSET) is None


def test_wet_spell_just_below_threshold_is_not_onset():
    s = dry_series("2015-08-01", "2015-12-31")
    put(s, "2015-09-20", "2015-11-30", 8.0)    # 3 days = 24 mm, just under 25 → never an onset
    assert rain.find_onset(s, date(2015, 9, 15), ONSET) is None


def test_missing_day_means_onset_cannot_be_confirmed():
    s = dry_series("2015-08-01", "2015-12-31")
    put(s, "2015-09-20", "2015-09-22", 10.0)
    put(s, "2015-09-23", "2015-11-30", 5.0)
    s.loc[pd.Timestamp("2015-09-30")] = float("nan")   # one missing day inside the 30-day check
    # 20 Sep and 21 Sep (10+10+5 = 25 mm) both need 30 Sep, so neither can be confirmed.
    # Later days only reach 20 or 15 mm, so there is no onset at all.
    assert rain.find_onset(s, date(2015, 9, 15), ONSET) is None


# ---------------------------------------------------------------------------
# Season calendar and totals
# ---------------------------------------------------------------------------
def test_maha_total_period_crosses_new_year():
    assert rain.season_dates("Maha", 2015, CFG) == (date(2015, 9, 15), date(2015, 10, 1), date(2016, 1, 31))
    assert rain.season_label("Maha", 2015) == "Maha 2015/16"
    assert rain.season_label("Yala", 2016) == "Yala 2016"


def test_window_sum_counts_both_end_days():
    s = dry_series("2015-09-01", "2016-02-29")
    put(s, "2015-09-01", "2016-02-29", 1.0)
    # 1 Oct – 31 Jan = 31 + 30 + 31 + 31 = 123 days × 1 mm
    assert rain.window_sum(s, date(2015, 10, 1), date(2016, 1, 31)) == 123.0


def test_window_sum_is_none_when_a_day_is_missing():
    s = dry_series("2015-09-01", "2016-02-29")
    s.loc[pd.Timestamp("2015-12-25")] = float("nan")
    assert rain.window_sum(s, date(2015, 10, 1), date(2016, 1, 31)) is None


# ---------------------------------------------------------------------------
# Normals and onset delays over several years
# ---------------------------------------------------------------------------
def small_cfg():
    """Same thresholds, but a 3-year normal period (2001–2003) so the maths stays small."""
    cfg = copy.deepcopy(CFG)
    cfg["rain"]["normal_first_year"] = 2001
    cfg["rain"]["normal_last_year"] = 2003
    return cfg


def yala_years():
    """Yala onset 20, 25, 30 Mar in 2001–2003 (normal years) and 9 Apr in 2004.

    Each year: 10 mm on the onset day and the 2 days after, then 5 mm/day for 40 days.
    """
    s = dry_series("2001-01-01", "2004-12-31")
    for onset in ["2001-03-20", "2002-03-25", "2003-03-30", "2004-04-09"]:
        day = date.fromisoformat(onset)
        put(s, day, day + timedelta(days=2), 10.0)
        put(s, day + timedelta(days=3), day + timedelta(days=42), 5.0)
    return s


def test_seasons_onsets_delays_totals_and_normals():
    seasons, mean_offsets = rain.compute_seasons(yala_years(), small_cfg(), 2001, date(2004, 12, 31))
    yala = {s["season"]: s for s in seasons if s["season"].startswith("Yala")}

    # Onsets are 5, 10, 15 days after 15 Mar in the normal years → mean 10 days (25 Mar).
    assert mean_offsets["Yala"] == 10
    assert [yala[f"Yala {y}"]["onset_date"] for y in (2001, 2002, 2003, 2004)] == \
           ["2001-03-20", "2002-03-25", "2003-03-30", "2004-04-09"]
    # Delay = days after 15 Mar − 10:  5−10, 10−10, 15−10, 25−10
    assert [yala[f"Yala {y}"]["onset_delay_days"] for y in (2001, 2002, 2003, 2004)] == [-5, 0, 5, 15]

    # Totals over 1 Apr – 31 Aug:
    #   2001: rain at 5 mm runs 23 Mar – 1 May → 1 Apr – 1 May = 31 days × 5 = 155
    #   2002: 5 mm runs 28 Mar – 6 May → 1 Apr – 6 May = 36 days × 5 = 180
    #   2003: 10 mm on 1 Apr, then 5 mm 2 Apr – 11 May (40 days) → 10 + 200 = 210
    #   2004: 30 mm on 9–11 Apr, then 40 days × 5 = 200 → 230
    assert [yala[f"Yala {y}"]["total_mm"] for y in (2001, 2002, 2003, 2004)] == [155.0, 180.0, 210.0, 230.0]
    # Normal = (155 + 180 + 210) / 3 = 181.67 → 181.7, the same on every Yala row
    assert {s["normal_mm"] for s in yala.values()} == {181.7}

    # No Maha rain at all in this series: no onset, totals of 0 mm.
    maha = [s for s in seasons if s["season"].startswith("Maha")]
    assert all(s["onset_date"] is None and s["onset_delay_days"] is None for s in maha)
    assert all(s["total_mm"] == 0.0 for s in maha)


def test_seasons_list_is_oldest_first_and_only_finished_seasons():
    seasons, _ = rain.compute_seasons(yala_years(), small_cfg(), 2001, date(2004, 12, 31))
    labels = [s["season"] for s in seasons]
    # Maha 2004/05 ends on 31 Jan 2005, after the data ends, so it isn't listed.
    assert labels == ["Yala 2001", "Maha 2001/02", "Yala 2002", "Maha 2002/03",
                      "Yala 2003", "Maha 2003/04", "Yala 2004"]


# ---------------------------------------------------------------------------
# Current season
# ---------------------------------------------------------------------------
def current_series():
    """2 mm/day in 2001–2003 (normal years), 1 mm/day from 2004 on."""
    s = dry_series("2001-01-01", "2005-03-31")
    put(s, "2001-01-01", "2003-12-31", 2.0)
    put(s, "2004-01-01", "2005-03-31", 1.0)
    return s


def test_current_season_so_far_vs_normal():
    current = rain.compute_current(current_series(), date(2004, 10, 10), small_cfg())
    # 1–10 Oct = 10 days: 10 × 1 mm this year, 10 × 2 mm in a normal year → R = 0.5
    assert current == {"season": "Maha 2004/05", "as_of": "2004-10-10",
                       "rain_so_far_mm": 10.0, "normal_so_far_mm": 20.0, "R": 0.5}


def test_current_maha_continues_into_january():
    current = rain.compute_current(current_series(), date(2005, 1, 15), small_cfg())
    # 1 Oct 2004 – 15 Jan 2005 = 31 + 30 + 31 + 15 = 107 days.
    # Normal years: 1 Oct 2001–2003 + 107 days are all 2 mm days EXCEPT for 2003, whose
    # window runs into Jan 2004 (1 mm): 15 days × 1 + 92 × 2 = 199 mm. Mean = (214+214+199)/3
    assert current["season"] == "Maha 2004/05"
    assert current["rain_so_far_mm"] == 107.0
    assert current["normal_so_far_mm"] == 209.0
    assert current["R"] == 0.51


def test_no_current_season_between_seasons():
    # 15 Feb is after Maha (ends 31 Jan) and before Yala (starts 1 Apr).
    assert rain.compute_current(current_series(), date(2005, 2, 15), small_cfg()) is None


# ---------------------------------------------------------------------------
# Monthly totals
# ---------------------------------------------------------------------------
def test_monthly_totals_full_months_only_and_null_when_a_day_is_missing():
    s = dry_series("2016-01-01", "2016-03-20")
    put(s, "2016-01-01", "2016-03-20", 2.0)
    s.loc[pd.Timestamp("2016-02-10")] = float("nan")
    out = rain.monthly_totals(s, date(2016, 3, 20))
    # January: 31 × 2 = 62. February has a missing day → null. March hasn't ended → not listed.
    assert out == [{"month": "2016-01", "total_mm": 62.0}, {"month": "2016-02", "total_mm": None}]


# ---------------------------------------------------------------------------
# Reference evapotranspiration (ET0) and the cache check
# ---------------------------------------------------------------------------
def test_extraterrestrial_radiation_matches_the_fao_worked_example():
    # FAO Irrigation and Drainage Paper 56, Example 8: 20 degrees south, 3 September (day 246)
    # gives Ra = 32.2 MJ per square metre per day (published). Our function returns mm/day (x 0.408).
    ra_mj = rain.extraterrestrial_radiation(-20, 246) / 0.408
    assert ra_mj == pytest.approx(32.2, abs=0.1)


def test_hargreaves_et0_by_hand():
    idx = pd.date_range("2026-04-01", periods=1)
    tmax, tmin = pd.Series([32.0], index=idx), pd.Series([22.0], index=idx)
    ra = float(rain.extraterrestrial_radiation(8.0, idx.dayofyear[0]))
    expected = 0.0023 * (27.0 + 17.8) * (10.0 ** 0.5) * ra          # 0.0023 (Tmean+17.8) sqrt(Tmax-Tmin) Ra
    assert rain.hargreaves_et0(8.0, idx, tmax, tmin, CFG).iloc[0] == pytest.approx(expected)
    assert 3.0 < expected < 9.0                                      # a believable tropical value, mm/day


def test_et0_is_zero_without_a_temperature_range_and_grows_with_it():
    idx = pd.date_range("2026-04-01", periods=2)
    flat = rain.hargreaves_et0(8.0, idx, pd.Series([30.0, 30.0], index=idx), pd.Series([30.0, 30.0], index=idx), CFG)
    assert flat.tolist() == [0.0, 0.0]
    wide = rain.hargreaves_et0(8.0, idx, pd.Series([34.0, 34.0], index=idx), pd.Series([22.0, 28.0], index=idx), CFG)
    assert wide.iloc[0] > wide.iloc[1] > 0


def test_cache_without_the_new_parameter_is_downloaded_again(tmp_path):
    old = {"properties": {"parameter": {"PRECTOTCORR": {}, "T2M_MAX": {}}}}          # saved before T2M_MIN existed
    new = {"properties": {"parameter": {"PRECTOTCORR": {}, "T2M_MAX": {}, "T2M_MIN": {}}}}
    (tmp_path / "old.json").write_text(json.dumps(old), encoding="utf-8")
    (tmp_path / "new.json").write_text(json.dumps(new), encoding="utf-8")
    assert rain.read_cache(tmp_path / "old.json", CFG) is None
    assert rain.read_cache(tmp_path / "new.json", CFG) == new
    assert rain.read_cache(tmp_path / "missing.json", CFG) is None


# ---------------------------------------------------------------------------
# Heat and dry spells
# ---------------------------------------------------------------------------
def test_longest_dry_spell_counts_consecutive_dry_days():
    # dry (<1 mm) runs: 2 days, then 3 days, then 1 day → longest is 3
    assert rain.longest_dry_spell([0, 0.5, 5, 0, 0, 0.9, 2, 0], 1.0) == 3
    assert rain.longest_dry_spell([3, 4, 5], 1.0) == 0


def test_extremes_per_season_and_normals():
    cfg = small_cfg()                                  # normal period 2001–2003
    r = dry_series("2001-01-01", "2004-12-31")
    put(r, "2001-01-01", "2004-12-31", 5.0)            # wet every day …
    put(r, "2002-05-01", "2002-05-10", 0.0)            # … except a 10-day dry spell in Yala 2002
    t = dry_series("2001-01-01", "2004-12-31")
    put(t, "2001-01-01", "2004-12-31", 30.0)           # 30 °C every day …
    put(t, "2003-06-01", "2003-06-04", 36.0)           # … except 4 hot days in Yala 2003
    per_season, normals = rain.compute_extremes(r, t, cfg, 2001, date(2004, 12, 31))
    assert per_season["Yala 2002"]["longest_dry_spell_days"] == 10
    assert per_season["Yala 2001"]["longest_dry_spell_days"] == 0
    assert per_season["Yala 2003"]["hot_days"] == 4
    assert per_season["Yala 2003"]["max_temp_c"] == 36.0
    # Normals over 2001–2003: dry spells 0, 10, 0 → 3.3; hot days 0, 0, 4 → 1.3
    assert normals["Yala"] == {"longest_dry_spell_days": 3.3, "hot_days": 1.3}


def test_extremes_are_null_when_a_day_is_missing():
    r = dry_series("2001-01-01", "2001-12-31")
    t = dry_series("2001-01-01", "2001-12-31")
    r.loc[pd.Timestamp("2001-06-15")] = float("nan")
    per_season, _ = rain.compute_extremes(r, t, small_cfg(), 2001, date(2001, 12, 31))
    assert per_season["Yala 2001"]["longest_dry_spell_days"] is None
    assert per_season["Yala 2001"]["hot_days"] == 0      # temperature is complete


# ---------------------------------------------------------------------------
# El Niño analogues
# ---------------------------------------------------------------------------
def test_elnino_counts_below_normal_and_skips_missing():
    seasons = [
        {"season": "Yala 1983", "total_mm": 200.0, "normal_mm": 300.0},   # below
        {"season": "Yala 1998", "total_mm": 350.0, "normal_mm": 300.0},   # above
        {"season": "Yala 2016", "total_mm": None, "normal_mm": 300.0},    # no data → not counted
        {"season": "Yala 2017", "total_mm": 100.0, "normal_mm": 300.0},   # not an analogue
    ]
    e = rain.compute_elnino(seasons, ["Yala 1983", "Yala 1998", "Yala 2016"], "test")
    assert (e["below_normal_count"], e["total"]) == (1, 2)


def test_power_cell_snaps_to_grid_centre():
    # Checked against NASA POWER on 25 Oct 2026: these points return the same data as the centre.
    assert rain.power_cell(8.01097, 80.56049, CFG) == (8.0, 80.625)    # Kalawewa
    assert rain.power_cell(8.33246, 80.42992, CFG) == (8.5, 80.625)    # Nuwara Wewa
    assert rain.power_cell(8.17771, 80.22977, CFG) == (8.0, 80.0)      # Angamuwa Tank


@pytest.mark.parametrize("a, b, expected", [(18.2, 27.0, 0.67), (5, 0, None), (None, 3, None)])
def test_ratio(a, b, expected):
    assert rain.ratio(a, b) == expected
