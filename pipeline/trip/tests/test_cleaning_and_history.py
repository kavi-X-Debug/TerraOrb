"""Tests for processing/cleaning.py (SYNTHETIC data, offline)."""

import numpy as np
import pandas as pd
import pytest

from pipeline.trip.processing import cleaning as c


def test_day_index_non_leap_rule_and_feb29():
    dates = pd.DatetimeIndex(["2023-01-01", "2023-02-28", "2023-03-01", "2023-12-31", "2024-02-29", "2024-03-01", "2024-12-31"])
    # Jan 1 = 0; Feb 28 = 58; Mar 1 = 59; Dec 31 = 364; Feb 29 folded into 59 (same as Mar 1); Dec 31 in a leap year = 364
    assert c.day_index(dates).tolist() == [0, 58, 59, 364, 59, 59, 364]


def test_parse_power_turns_fill_value_into_nan():
    data = {"header": {"fill_value": -999},
            "properties": {"parameter": {"PRECTOTCORR": {"20200101": 1.5, "20200102": -999}, "T2M_MAX": {"20200101": 30.0, "20200102": 31.0}}}}
    df = c.parse_power(data)
    assert df.loc["2020-01-01", "PRECTOTCORR"] == 1.5
    assert np.isnan(df.loc["2020-01-02", "PRECTOTCORR"])


def test_geosit_source_is_refused():
    assert c.is_clean({"sources": ["MERRA2"]}, ["GEOSIT"])
    assert not c.is_clean({"sources": ["MERRA2", "GEOSIT"]}, ["GEOSIT"])


def test_impossible_values_stop_the_run():
    idx = pd.date_range("2020-01-01", periods=3)
    with pytest.raises(c.DataError):
        c.check_values(pd.DataFrame({"PRECTOTCORR": [1, 500, 2], "T2M_MAX": [30, 30, 30]}, index=idx), 400, 50)
    with pytest.raises(c.DataError):
        c.check_values(pd.DataFrame({"PRECTOTCORR": [1, 1, 2], "T2M_MAX": [30, 60, 30]}, index=idx), 400, 50)


def test_window_stats_by_hand():
    # SYNTHETIC: 10 years where every day is exactly 2 mm -> p_wet 1, mean 2, p90 2 for every index.
    idx = pd.date_range("2001-01-01", "2010-12-31")
    rain = np.full(len(idx), 2.0)
    p, m, p90 = c.window_stats(rain, c.day_index(idx), wet_mm=1.0, half_window=3)
    assert np.allclose(p, 1.0) and np.allclose(m, 2.0) and np.allclose(p90, 2.0)
    # Only day-of-year 100 (non-leap index 99) wet in each year: the +/-3 window gives 1 wet day out of 7 -> p_wet 1/7
    rain = np.where(c.day_index(idx) == 99, 5.0, 0.0)
    p, m, _ = c.window_stats(rain, c.day_index(idx), 1.0, 3)
    assert p[99] == pytest.approx(1 / 7, abs=0.01)
    assert p[96] == pytest.approx(1 / 7, abs=0.01) and p[102] == pytest.approx(1 / 7, abs=0.01)   # edges of the +/-3 window
    assert p[95] == 0.0 and p[103] == 0.0 and p[200] == 0.0                                       # just outside it


def test_window_wraps_around_new_year():
    idx = pd.date_range("2001-01-01", "2005-12-31")
    rain = np.where(c.day_index(idx) == 364, 9.0, 0.0)         # only 31 Dec is wet
    p, _, _ = c.window_stats(rain, c.day_index(idx), 1.0, 3)
    assert p[0] > 0 and p[2] > 0 and p[362] > 0                  # 1-3 Jan and 28-30 Dec see it
    assert p[10] == 0.0


def test_history_for_cell_shape(synthetic_rain, cfg):
    df = pd.DataFrame({"PRECTOTCORR": synthetic_rain, "T2M_MAX": 30.0})
    h = c.history_for_cell(df, cfg["trip"])
    for k in ("p_wet", "mean_mm", "p90_mm"):
        assert len(h[k]) == 366 and h[k][365] is None and None not in h[k][:365]
    assert len(h["monthly_mm"]) == 12 and h["tmax_c_monthly"] == [30.0] * 12
    assert all(0 <= v <= 1 for v in h["p_wet"][:365])
    assert h["p_wet"][200] > h["p_wet"][20]                      # wet season (days 150-270) is wetter than the dry season


def test_monthly_means_skip_incomplete_months():
    idx = pd.date_range("2001-01-01", "2002-12-31")
    s = pd.Series(1.0, index=idx)
    s.loc["2001-03-10"] = np.nan                                 # March 2001 has a missing day: not counted at all
    m = c.monthly_means(s)
    assert m[2] == 31.0 and m[0] == 31.0                         # March uses 2002 only = 31 mm; January = 31 mm
    assert c.monthly_means(pd.Series(1.0, index=pd.date_range("2001-01-01", "2001-06-30"))) is None   # not all 12 months present


def test_restrict_makes_every_day_present():
    df = pd.DataFrame({"PRECTOTCORR": [1.0, 2.0]}, index=pd.DatetimeIndex(["2020-01-01", "2020-01-03"]))
    out = c.restrict(df, "2020-01-01", "2020-01-04")
    assert len(out) == 4 and out["PRECTOTCORR"].isna().sum() == 2
