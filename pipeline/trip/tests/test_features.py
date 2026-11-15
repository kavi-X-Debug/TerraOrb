"""Feature tests, including the no-leakage test (SYNTHETIC data)."""

import numpy as np
import pandas as pd

from pipeline.trip.processing import feature_engineering as fe


def feats(rain, cfg, **kw):
    return fe.build_features(rain, 7.5, 80.6, 100, cfg["trip"]["wet_day_mm"], cfg["trip"]["ml"], **kw)


def test_no_leakage_future_rain_never_changes_features(synthetic_rain, cfg):
    """Features at day t must be identical whatever happens after day t (the target day t+1 and later)."""
    cut = pd.Timestamp("2003-06-15")
    changed = synthetic_rain.copy()
    changed.loc[changed.index > cut] = changed.loc[changed.index > cut] * 7 + 3            # rewrite the whole future
    a, b = feats(synthetic_rain, cfg), feats(changed, cfg)
    cols = [c for c in fe.feature_names(cfg["trip"]["ml"])]
    rows = a.index[a.index <= cut]
    assert len(rows) > 100
    pd.testing.assert_frame_equal(a.loc[rows, cols], b.loc[rows, cols])


def test_target_is_next_day_and_not_a_feature(synthetic_rain, cfg):
    f = feats(synthetic_rain, cfg)
    t = f.index[100]
    assert f.loc[t, "y_mm"] == synthetic_rain.loc[t + pd.Timedelta(1, "D")]
    assert f.loc[t, "rain_lag0"] == synthetic_rain.loc[t]                     # lag0 = rain on day t itself, never t+1
    assert f.loc[t, "target_date"] == t + pd.Timedelta(1, "D")
    names = fe.feature_names(cfg["trip"]["ml"])
    assert not {"y_mm", "y_wet", "target_date"} & set(names)


def test_rolling_sum_and_days_since_wet_by_hand(cfg):
    idx = pd.date_range("2001-01-01", periods=60)
    rain = pd.Series(0.0, index=idx)
    rain.iloc[40] = 10.0                                   # one wet day, 2001-02-10
    rain.iloc[45] = 4.0
    f = feats(rain, cfg)
    day = idx[47]
    assert f.loc[day, "rain_sum_3"] == 4.0                 # positions 45, 46, 47 -> only the 4 mm day
    assert f.loc[day, "days_since_wet"] == 2               # last wet day (4 mm) was position 45, now position 47
    assert f.loc[idx[45], "days_since_wet"] == 0


def test_missing_days_are_never_filled(cfg):
    idx = pd.date_range("2001-01-01", periods=120)
    rain = pd.Series(1.0, index=idx)
    rain.iloc[60] = np.nan
    f = feats(rain, cfg)
    assert idx[59] not in f.index                          # its target (day 60) is missing
    assert idx[60] not in f.index                          # its own rain is missing
    assert idx[61] not in f.index and idx[62] not in f.index   # lags that need day 60 are dropped too (lag0..lag2)


def test_require_target_false_keeps_the_newest_day(synthetic_rain, cfg):
    f = feats(synthetic_rain, cfg, require_target=False)
    assert f.index[-1] == synthetic_rain.index[-1] and np.isnan(f["y_mm"].iloc[-1])


def test_splits_are_chronological_and_disjoint(synthetic_rain, cfg):
    td = pd.date_range("1981-01-01", "2025-12-31")
    tr, va, te = fe.split_masks(td, cfg["trip"]["ml"])
    assert not (tr & va).any() and not (tr & te).any() and not (va & te).any()
    assert td[tr].max() < td[va].min() and td[va].max() < td[te].min()
    assert td[tr].min().year == 1981 and td[te].max().year == 2025


def test_season_of():
    s = fe.season_of(pd.DatetimeIndex(["2020-01-15", "2020-04-01", "2020-07-01", "2020-10-20"]))
    assert s.tolist() == ["ne_monsoon", "inter_1", "sw_monsoon", "inter_2"]
