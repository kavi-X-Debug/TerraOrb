"""
GPM IMERG versus NASA POWER daily rain (the check that must pass before IMERG is used for anything).

IMERG is on a 0.1 degree grid, POWER on 0.5 x 0.625 degree squares. To compare fairly, IMERG is AVERAGED over the 0.1 degree cells whose
centres lie inside each POWER square, and then compared with that square's POWER value, day by day, for the days both have.

Numbers reported per square and overall: daily correlation, correlation of monthly totals, total rain ratio (IMERG / POWER),
wet-day agreement (a wet day is >= wet_mm): how often a POWER wet day is also an IMERG wet day (hit rate) and how often an IMERG wet day is a
POWER dry day (false alarm share). These are plain descriptive numbers; the verdict thresholds below are DRAFT rules of thumb, not a standard.
"""
import numpy as np
import pandas as pd

from pipeline.trip.download import gpm_imerg

# draft thresholds for the plain-words verdict
MIN_DAYS = 365          # fewer overlapping days: no verdict
R_DAILY_OK = 0.5        # daily correlation at or above this: "agree in timing"
RATIO_OK = (0.7, 1.3)   # total rain ratio inside this range: "similar totals"


def square_box(lat_c, lon_c, lat_step=0.5, lon_step=0.625):
    return lat_c - lat_step / 2, lat_c + lat_step / 2, lon_c - lon_step / 2, lon_c + lon_step / 2


def square_series(lat_c, lon_c, cache=None):
    """pandas Series (index = date, mm/day): IMERG averaged over the cells inside the POWER square. Days with no value are absent."""
    cache = cache or gpm_imerg.CACHE
    lons, lats = gpm_imerg.grid()
    la0, la1, lo0, lo1 = square_box(lat_c, lon_c)
    ii = np.where((lons >= lo0) & (lons < lo1))[0]
    jj = np.where((lats >= la0) & (lats < la1))[0]
    if len(ii) == 0 or len(jj) == 0:
        return pd.Series(dtype=float)
    dates, vals = [], []
    for p in sorted(cache.glob("2*.npy")):
        block = np.load(p)[np.ix_(ii, jj)]
        if np.isfinite(block).mean() < 0.9:                       # mostly missing: skip the day, never fill
            continue
        dates.append(pd.Timestamp(p.stem))
        vals.append(float(np.nanmean(block)))
    return pd.Series(vals, index=pd.DatetimeIndex(dates), dtype=float)


def compare(power, imerg, wet_mm=1.0):
    """Descriptive agreement between two daily series (Series with date index). None where there is not enough overlap."""
    both = pd.concat({"p": power, "i": imerg}, axis=1).dropna()
    n = len(both)
    if n < MIN_DAYS:
        return {"days": int(n), "enough": False}
    p, i = both["p"], both["i"]
    monthly = both.resample("MS").sum()
    pw, iw = p >= wet_mm, i >= wet_mm
    return {
        "days": int(n), "enough": True, "period": f"{both.index[0].date()} to {both.index[-1].date()}",
        "r_daily": round(float(np.corrcoef(p, i)[0, 1]), 3),
        "r_monthly": round(float(np.corrcoef(monthly["p"], monthly["i"])[0, 1]), 3),
        "total_ratio_imerg_over_power": round(float(i.sum() / p.sum()), 3) if p.sum() > 0 else None,
        "wet_day_hit_rate": round(float((pw & iw).sum() / pw.sum()), 3) if pw.sum() else None,
        "imerg_wet_days_that_power_calls_dry": round(float((iw & ~pw).sum() / iw.sum()), 3) if iw.sum() else None,
        "mean_mm_power": round(float(p.mean()), 3), "mean_mm_imerg": round(float(i.mean()), 3),
    }


def verdict(per_square):
    """Plain-words summary over all squares that have enough days. (text, usable) - usable means 'reasonable to use as an independent rain source'."""
    ok = [v for v in per_square.values() if v.get("enough")]
    if not ok:
        return "Not enough overlapping days to compare IMERG with NASA POWER yet.", False
    r = float(np.median([v["r_daily"] for v in ok]))
    ratio = float(np.median([v["total_ratio_imerg_over_power"] for v in ok if v["total_ratio_imerg_over_power"] is not None]))
    timing = r >= R_DAILY_OK
    totals = RATIO_OK[0] <= ratio <= RATIO_OK[1]
    text = (f"Across {len(ok)} squares the median daily correlation is {r:.2f} and IMERG's total rain is {ratio * 100:.0f}% of POWER's. "
            + ("They agree on the timing of rain. " if timing else "They only partly agree on which days it rains. ")
            + ("Totals are similar." if totals else "Totals differ noticeably."))
    return text, bool(timing and totals)
