"""
Cleaning of NASA POWER answers (pure functions: no internet, no files).

POWER marks "no data" with -999; we turn it into NaN (later null). Impossible values stop the run instead of being
"fixed", exactly like pipeline/rain.py. Months from near-real-time sources listed in [power] skip_sources (GEOSIT)
are never used: on 25 Oct 2026 those rain values were about 24 times too large.
"""

import numpy as np
import pandas as pd


class DataError(RuntimeError):
    """The data look wrong (impossible value, wrong length, skipped source): the caller must stop and say so."""


def is_clean(header, skip_sources):
    """True if the answer lists none of the untrusted sources."""
    return not set(header.get("sources", [])) & set(skip_sources)


def parse_power(data, parameters=("PRECTOTCORR", "T2M_MAX")):
    """DataFrame (daily index, one column per parameter) from a POWER daily JSON answer. -999 becomes NaN."""
    df = pd.DataFrame({p: data["properties"]["parameter"][p] for p in parameters})
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    fill = data.get("header", {}).get("fill_value", -999)
    return df.replace(fill, np.nan).sort_index()


def check_values(df, max_rain_mm, max_temp_c, where=""):
    """Stop on impossible rain or temperature (same safety limits as pipeline/rain.py)."""
    if (df["PRECTOTCORR"] > max_rain_mm).any():
        day = df.index[df["PRECTOTCORR"] > max_rain_mm][0].date()
        raise DataError(f"rain above {max_rain_mm} mm/day {where} on {day}: looks like a data error")
    if "T2M_MAX" in df and (df["T2M_MAX"] > max_temp_c).any():
        day = df.index[df["T2M_MAX"] > max_temp_c][0].date()
        raise DataError(f"max temperature above {max_temp_c} C {where} on {day}: looks like a data error")
    if (df["PRECTOTCORR"] < 0).any():
        raise DataError(f"negative rain {where}")
    return df


def restrict(df, first, last):
    """Keep first..last (inclusive) and make every calendar day present (missing days = NaN)."""
    part = df.loc[pd.Timestamp(first):pd.Timestamp(last)]
    return part.reindex(pd.date_range(first, last, freq="D"))


# ---------------------------------------------------------------------------
# Day index (see docs/trip-spec.md section 2): days since 1 Jan of that date in a NON-leap year; Feb 29 -> 59.
# ---------------------------------------------------------------------------
_CUM = np.cumsum([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30])          # first-of-month index in a non-leap year


def day_index(dates):
    """Array of day indexes 0..364 for a DatetimeIndex. Feb 29 is folded into index 59 (the same as 1 March)."""
    idx = pd.DatetimeIndex(dates)
    month, day = idx.month.to_numpy(), idx.day.to_numpy()
    out = _CUM[month - 1] + day - 1
    out = np.where((month == 2) & (day == 29), 59, out)
    return out.astype(int)


def window_stats(rain, idx, wet_mm, half_window):
    """Per day index 0..364: share of wet days, mean rain and 90th percentile of rain over every year,
    using all days within +/- half_window days (circular over 365 days). rain: 1-D array (NaN = missing)."""
    ok = ~np.isnan(rain)
    rain, idx = rain[ok], idx[ok]
    p_wet = np.full(365, np.nan)
    mean_mm = np.full(365, np.nan)
    p90 = np.full(365, np.nan)
    for i in range(365):
        d = np.abs(idx - i)
        near = np.minimum(d, 365 - d) <= half_window
        vals = rain[near]
        if len(vals) == 0:
            continue
        p_wet[i] = (vals >= wet_mm).mean()
        mean_mm[i] = vals.mean()
        p90[i] = np.percentile(vals, 90)
    return p_wet, mean_mm, p90


def monthly_means(series):
    """12 values: mean over the years of the monthly total, for every calendar month. A month with a missing
    day is skipped, never partly counted. Returns None if some calendar month has no complete month at all."""
    grouped = series.groupby([series.index.year, series.index.month])
    total = grouped.sum()
    complete = total[(grouped.count() == grouped.size())]
    if complete.empty:
        return None
    by_month = complete.groupby(level=1).mean()
    if len(by_month) < 12:
        return None
    return [float(by_month[m]) for m in range(1, 13)]


def monthly_mean_of_daily(series):
    """12 values: mean of the daily values for each calendar month (used for the maximum temperature)."""
    s = series.dropna()
    if s.empty:
        return None
    by_month = s.groupby(s.index.month).mean()
    if len(by_month) < 12:
        return None
    return [float(by_month[m]) for m in range(1, 13)]


def r(x, digits=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), digits)


def history_for_cell(df, cfg_trip):
    """The rainfall_history.json block for one square: p_wet / mean_mm / p90_mm (366 each; index 365 is unused and null),
    monthly_mm (12) and tmax_c_monthly (12 or None). df: daily DataFrame with PRECTOTCORR and optionally T2M_MAX."""
    half = (cfg_trip["window_days"] - 1) // 2
    rain = df["PRECTOTCORR"]
    p_wet, mean_mm, p90 = window_stats(rain.to_numpy(float), day_index(df.index), cfg_trip["wet_day_mm"], half)

    def pad(a, nd):
        return [r(v, nd) for v in a] + [None]        # index 365 = null: dayIndex() never returns it

    monthly = monthly_means(rain)
    tmax = monthly_mean_of_daily(df["T2M_MAX"]) if "T2M_MAX" in df and df["T2M_MAX"].notna().any() else None
    return {
        "p_wet": pad(p_wet, 3),
        "mean_mm": pad(mean_mm, 2),
        "p90_mm": pad(p90, 1),
        "monthly_mm": None if monthly is None else [round(v, 1) for v in monthly],
        "tmax_c_monthly": None if tmax is None else [round(v, 1) for v in tmax],
    }
