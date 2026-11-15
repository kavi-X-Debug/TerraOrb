"""
Features for the rain models (pure functions).

Prediction task: standing at the end of day t, predict rain on day t+1.
EVERY feature may use rain up to and including day t, and the calendar / position of the square. Nothing from
day t+1 or later may leak in: `tests/test_features.py` checks that by changing the future and comparing.

Features (names are saved in model_metadata.json):
  rain_lag0 .. rain_lag{k-1}   rain on day t, t-1, ...   ([trip.ml] lags = [1, 2, 3] means 3 lag days)
  rain_sum_3 / 7 / 14 / 30      total rain over the last N days up to and including day t
  wet_days_7 / 30               number of wet days (>= wet_day_mm) in the last 7 / 30 days
  days_since_wet                days since the last wet day (0 = today was wet), capped at 60
  doy_sin, doy_cos              season of the TARGET day t+1 (day of year on a circle)
  lat, lon, elevation_m         position of the NASA POWER square centre (elevation may be absent)
"""

import numpy as np
import pandas as pd

DAYS_SINCE_CAP = 60


def feature_names(ml_cfg, with_elevation=True):
    names = [f"rain_lag{k}" for k in range(ml_cfg["lags"][-1])]
    names += [f"rain_sum_{w}" for w in ml_cfg["rolling_days"]]
    names += ["wet_days_7", "wet_days_30", "days_since_wet", "doy_sin", "doy_cos", "lat", "lon"]
    if with_elevation:
        names.append("elevation_m")
    return names


def days_since(wet_flags):
    """For each day, the number of days since the last wet day up to and including that day (NaN-safe: a missing
    day breaks the count and gives NaN). Capped at DAYS_SINCE_CAP."""
    out = np.full(len(wet_flags), np.nan)
    count = np.nan
    for i, w in enumerate(wet_flags):
        if np.isnan(w):
            count = np.nan
        elif w == 1:
            count = 0
        elif not np.isnan(count):
            count = min(count + 1, DAYS_SINCE_CAP)
        elif i == 0:
            count = DAYS_SINCE_CAP                          # unknown start: treated as 'long ago' only at the first day
        out[i] = count
    return out


def build_features(rain, lat, lon, elevation_m, wet_mm, ml_cfg, require_target=True):
    """DataFrame indexed by day t with the features above plus target columns
    target_date, y_mm (rain on t+1) and y_wet (1 if y_mm >= occurrence_mm).

    rain: pd.Series of daily mm with a complete daily DatetimeIndex (NaN = missing). Rows with any missing value
    in features or target are dropped (a missing day is never filled in).
    """
    rain = rain.astype(float)
    f = pd.DataFrame(index=rain.index)
    for k in range(ml_cfg["lags"][-1]):
        f[f"rain_lag{k}"] = rain.shift(k)
    for w in ml_cfg["rolling_days"]:
        f[f"rain_sum_{w}"] = rain.rolling(w, min_periods=w).sum()
    wet = (rain >= wet_mm).astype(float).where(rain.notna())
    f["wet_days_7"] = wet.rolling(7, min_periods=7).sum()
    f["wet_days_30"] = wet.rolling(30, min_periods=30).sum()
    f["days_since_wet"] = days_since(wet.to_numpy())
    target_date = rain.index + pd.Timedelta(1, "D")
    doy = target_date.dayofyear.to_numpy()
    f["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    f["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    f["lat"] = lat
    f["lon"] = lon
    if elevation_m is not None:
        f["elevation_m"] = float(elevation_m)
    f["target_date"] = target_date
    f["y_mm"] = rain.shift(-1)                       # rain on day t+1 (the target; never a feature)
    f["y_wet"] = (f["y_mm"] >= ml_cfg["occurrence_mm"]).astype(float).where(f["y_mm"].notna())
    if require_target:
        return f.dropna()
    # for a prediction the newest day has no target yet: keep it, drop only rows whose FEATURES are incomplete
    return f.dropna(subset=[c for c in f.columns if c not in ("y_mm", "y_wet")])


def split_masks(target_dates, ml_cfg):
    """Boolean masks (train, valid, test) by the TARGET date, using the chronological ranges in config.toml."""
    td = pd.DatetimeIndex(target_dates)

    def mask(a, b):
        return (td >= pd.Timestamp(ml_cfg[a])) & (td <= pd.Timestamp(ml_cfg[b]))

    return mask("train_first", "train_last"), mask("valid_first", "valid_last"), mask("test_first", "test_last")


def season_of(target_dates):
    """Sri Lankan monsoon season of each target date: NE monsoon (Dec-Feb), 1st inter-monsoon (Mar-Apr),
    SW monsoon (May-Sep), 2nd inter-monsoon (Oct-Nov)."""
    m = pd.DatetimeIndex(target_dates).month.to_numpy()
    return np.where(np.isin(m, [12, 1, 2]), "ne_monsoon",
                    np.where(np.isin(m, [3, 4]), "inter_1",
                             np.where(np.isin(m, [5, 6, 7, 8, 9]), "sw_monsoon", "inter_2")))
