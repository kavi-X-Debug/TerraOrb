"""
Farm-profile tables (pre-computed, static JSON for the farm planner)
====================================================================

    .venv\\Scripts\\python pipeline\\farm_profile.py        (run from the repo root; reads data/cells/ and data/ndvi_cache/, needs no network)

Reads the daily NASA POWER files already in data/cells/ (rain and ET0 per 0.5 x 0.625 degree grid cell) and writes to data/farm/:

  climate_monthly.json   per cell and calendar month: rain, ET0 and water balance (rain - ET0), mean and standard deviation over the years
  onset_by_year.json     per cell and season (Maha / Yala): the rain-onset date of every year, plus earliest / median / latest
  dry_spell_by_year.json per cell and season: the longest run of days under dry_day_mm in every year
  ndvi_series.json       per cell: MODIS NDVI (median over the real tanks inside the cell), one value per 16 days
  bare_calendar.json     per cell and month: the share of years in which the month's NDVI stayed under the bare threshold
  index.json             what was made, the covered cells, and every gap

Honesty rules: nothing is invented. A statistic with fewer than [farm] min_years years is null. A cell with no NDVI data gets no entry.
ET0 is the Hargreaves-Samani estimate already stored in the cell files (FAO-56 Penman-Monteith needs humidity, wind and sunshine, which we do not have).
All thresholds are DRAFT placeholders in pipeline/config.toml, section [farm]. Format notes: docs/farm-spec.md section 4.
"""
import json
import statistics
import tomllib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
CELLS = REPO / "data" / "cells"
NDVI_CACHE = REPO / "data" / "ndvi_cache"
OUT = REPO / "data" / "farm"
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))

RAIN_SOURCE = "NASA POWER (PRECTOTCORR; MERRA2, POWER)"
ET0_SOURCE = "Hargreaves-Samani ET0 from NASA POWER T2M_MAX and T2M_MIN (estimate, not Penman-Monteith)"
NDVI_SOURCE = "NASA MODIS Terra MOD13Q1 NDVI, 250 m, via ORNL DAAC (median over land pixels around each tank)"
RESOLUTION = "area-level, about 50 km (one NASA POWER grid cell)"


def load_config():
    with open(PIPELINE / "config.toml", "rb") as f:
        return tomllib.load(f)


def cell_key(lat, lon):
    return f"{lat}_{lon}"


def power_cell(lat, lon, cfg):
    """Centre of the NASA POWER grid cell containing a point (same rule as pipeline/rain.py)."""
    dlat, dlon = cfg["power"]["grid_lat_deg"], cfg["power"]["grid_lon_deg"]
    return round(round(lat / dlat) * dlat, 4), round(round(lon / dlon) * dlon, 4)


def mean_sd(values, min_years):
    """(mean, sample standard deviation, n); None for mean and sd when fewer than min_years values."""
    vals = [v for v in values if v is not None]
    if len(vals) < min_years:
        return None, None, len(vals)
    return round(statistics.fmean(vals), 1), round(statistics.stdev(vals), 1), len(vals)


def load_cell_days(path):
    """(raw file, {date: (rain_mm, et0_mm)}) from a data/cells file; a missing value stays None."""
    d = json.loads(path.read_text(encoding="utf-8"))
    start = date.fromisoformat(d["start"])
    days = {}
    for i, (r, e) in enumerate(zip(d["rain_tenths"], d["et0_tenths"])):
        days[start + timedelta(days=i)] = (None if r is None else r / 10, None if e is None else e / 10)
    return d, days


def window_sum(days, first, last, idx):
    """Sum of column idx (0 rain, 1 ET0) from first to last (inclusive), or None if any day is missing."""
    total, day = 0.0, first
    while day <= last:
        v = days.get(day, (None, None))[idx]
        if v is None:
            return None
        total += v
        day += timedelta(days=1)
    return total


# ---------------------------------------------------------------------------
def climate_monthly(days, cfg):
    f = cfg["farm"]
    out = {}
    for month in range(1, 13):
        rain, et0, bal = [], [], []
        for y in range(f["first_year"], f["last_year"] + 1):
            first = date(y, month, 1)
            last = date(y + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
            r, e = window_sum(days, first, last, 0), window_sum(days, first, last, 1)
            rain.append(r)
            et0.append(e)
            bal.append(None if r is None or e is None else r - e)
        rm, rs, rn = mean_sd(rain, f["min_years"])
        em, es, en = mean_sd(et0, f["min_years"])
        bm, bs, bn = mean_sd(bal, f["min_years"])
        dry_share = None
        if bm is not None and bs:
            z = [(b - bm) / bs for b in bal if b is not None]
            dry_share = {"moderate": round(sum(v < f["dry_z_moderate"] for v in z) / len(z), 2),
                         "severe": round(sum(v < f["dry_z_severe"] for v in z) / len(z), 2)}
        out[str(month)] = {"rain_mm": {"mean": rm, "sd": rs, "years": rn},
                           "et0_mm": {"mean": em, "sd": es, "years": en},
                           "water_balance_mm": {"mean": bm, "sd": bs, "years": bn},
                           "dry_month_share_of_years": dry_share}
    return out


def season_dates(kind, year, cfg):
    """(onset window start, total start, total end) for a season, from [rain.seasons] in config.toml."""
    s = cfg["rain"]["seasons"][kind]

    def md(text, y):
        return date(y, int(text[:2]), int(text[3:]))
    start, total_start, total_end = md(s["onset_window_start"], year), md(s["total_start"], year), md(s["total_end"], year)
    if total_end < total_start:
        total_end = md(s["total_end"], year + 1)
    return start, total_start, total_end


def season_label(kind, year):
    return f"Yala {year}" if kind == "Yala" else f"Maha {year}/{(year + 1) % 100:02d}"


def find_onset(days, window_start, f):
    """First day on/after window_start whose trailing onset_days days of rain add up to >= onset_mm (draft rule)."""
    for offset in range(f["onset_search_days"]):
        day = window_start + timedelta(days=offset)
        total = window_sum(days, day - timedelta(days=f["onset_days"] - 1), day, 0)
        if total is not None and total >= f["onset_mm"]:
            return day
    return None


def onset_and_dry(days, cfg):
    f = cfg["farm"]
    onset_out, dry_out = {}, {}
    for kind in ("Maha", "Yala"):
        years_on, years_dry = [], []
        for y in range(f["first_year"], f["last_year"] + 1):
            window_start, total_start, total_end = season_dates(kind, y, cfg)
            onset = find_onset(days, window_start, f)
            years_on.append({"season": season_label(kind, y), "year": y,
                             "onset_date": onset.isoformat() if onset else None,
                             "days_after_window_start": (onset - window_start).days if onset else None})
            longest, run, complete, day = 0, 0, True, total_start
            while day <= total_end:
                r = days.get(day, (None, None))[0]
                if r is None:
                    complete = False
                    break
                run = run + 1 if r < f["dry_day_mm"] else 0
                longest = max(longest, run)
                day += timedelta(days=1)
            years_dry.append({"season": season_label(kind, y), "year": y,
                              "longest_dry_spell_days": longest if complete else None})
        offs = sorted(v["days_after_window_start"] for v in years_on if v["days_after_window_start"] is not None)
        summary = None
        if len(offs) >= f["min_years"]:
            ref = season_dates(kind, 2001, cfg)[0]          # any year: only the month-day is shown
            pick = {"earliest": offs[0], "median": offs[len(offs) // 2], "latest": offs[-1]}
            summary = {"years_with_onset": len(offs), "years_without_onset": len(years_on) - len(offs)}
            for name, off in pick.items():
                summary[f"{name}_days_after_window_start"] = off
                summary[f"{name}_month_day"] = (ref + timedelta(days=off)).strftime("%m-%d")
        onset_out[kind] = {"onset_window_start": season_dates(kind, 2001, cfg)[0].strftime("%m-%d"),
                           "summary": summary, "by_year": years_on}
        dry_out[kind] = {"by_year": years_dry}
    return onset_out, dry_out


# ---------------------------------------------------------------------------
def ndvi_by_cell(cfg):
    """({cell key: {date: [NDVI of each tank in the cell]}}, {cell key: tank count}, [tanks with no cache file])."""
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    cells, counts, gaps = {}, {}, []
    for t in tanks:
        if t.get("demo"):
            continue                                         # demo tanks never feed a real table
        path = NDVI_CACHE / f"{t['id']}.json"
        if not path.exists():
            gaps.append(t["id"])
            continue
        key = cell_key(*power_cell(t["lat"], t["lon"], cfg))
        counts[key] = counts.get(key, 0) + 1
        for d, v in json.loads(path.read_text(encoding="utf-8")).items():
            if v is not None:
                cells.setdefault(key, {}).setdefault(d, []).append(v)
    return cells, counts, gaps


def ndvi_tables(cfg):
    """(ndvi_series cells, bare_calendar cells, gap note). The first two are None when there is no cache."""
    if not NDVI_CACHE.exists():
        return None, None, {"available": False, "reason": "data/ndvi_cache/ does not exist"}
    f = cfg["farm"]
    cells, counts, gaps = ndvi_by_cell(cfg)
    series, bare = {}, {}
    for key, by_date in cells.items():
        dates = sorted(by_date)
        series[key] = {"tanks_in_cell": counts[key], "dates": dates,
                       "ndvi": [round(statistics.median(by_date[d]), 3) for d in dates]}
        per_month = {m: {} for m in range(1, 13)}            # month -> year -> [values]
        for d in dates:
            per_month[int(d[5:7])].setdefault(int(d[:4]), []).append(statistics.median(by_date[d]))
        row = {}
        for m, by_year in per_month.items():
            flags = [statistics.fmean(v) < f["bare_ndvi"] for v in by_year.values()]
            row[str(m)] = {"share_of_years_bare": round(sum(flags) / len(flags), 2) if len(flags) >= 3 else None,
                           "years": len(flags)}
        bare[key] = row
    return series, bare, {"available": bool(series), "tanks_without_cache_file": len(gaps),
                          "cells_with_ndvi": sorted(series), "tanks_per_cell": counts}


# ---------------------------------------------------------------------------
def table(extra, cells_content, cfg, source, period):
    return {"schema": "farm-table-1", "generated": datetime.now(SRI_LANKA).isoformat(timespec="seconds"),
            "source": source, "period": period, "resolution": RESOLUTION, "demo": False,
            "thresholds_are_placeholders": True,
            "thresholds_note": "Draft thresholds from the product owner's 'Steps' document (pipeline/config.toml [farm]); "
                               "not reviewed by an Agricultural Instructor.",
            **extra, "cells": cells_content}


def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote data/farm/{name}")


def main():
    cfg = load_config()
    f = cfg["farm"]
    files = sorted(CELLS.glob("*.json"))
    if not files:
        raise SystemExit("STOPPED: no data/cells/*.json found; run pipeline/rain.py first. Nothing was written.")
    period = f"{f['first_year']}-{f['last_year']}"
    monthly, onset, dry, covered, last_day = {}, {}, {}, [], None
    for path in files:
        d, days = load_cell_days(path)
        key = path.stem
        covered.append({"key": key, "centre_lat": d["cell"][0], "centre_lon": d["cell"][1],
                        "data_from": d["start"], "data_to": d["last"]})
        last_day = d["last"]
        monthly[key] = climate_monthly(days, cfg)
        onset[key], dry[key] = onset_and_dry(days, cfg)

    write("climate_monthly.json", table(
        {"water_balance": "rain minus ET0 (mm per month)", "et0_method": ET0_SOURCE,
         "et0_note": "FAO-56 Penman-Monteith not used: humidity, wind and sunshine are not in the cell files."},
        monthly, cfg, f"{RAIN_SOURCE}; ET0: {ET0_SOURCE}", period))
    write("onset_by_year.json", table(
        {"onset_rule": f"first day on or after the window start whose rain over the trailing {f['onset_days']} days "
                       f"is at least {f['onset_mm']} mm (draft)",
         "note": "Simple 'Steps' rule; the tank pages use the stricter rule in [rain.onset]."},
        onset, cfg, RAIN_SOURCE, period))
    write("dry_spell_by_year.json", table(
        {"dry_day_mm": f["dry_day_mm"], "season_periods": "Maha Oct-Jan, Yala Apr-Aug (config [rain.seasons])"},
        dry, cfg, RAIN_SOURCE, period))

    series, bare, ndvi_note = ndvi_tables(cfg)
    tables = ["climate_monthly", "onset_by_year", "dry_spell_by_year"]
    if series:
        first = min(s["dates"][0] for s in series.values())
        last = max(s["dates"][-1] for s in series.values())
        write("ndvi_series.json", table(
            {"bare_ndvi_threshold": f["bare_ndvi"],
             "note": "Median of the tank-area NDVI of the real tanks inside each cell: greenness around tanks, not of any one farm."},
            series, cfg, NDVI_SOURCE, f"{first} to {last}"))
        write("bare_calendar.json", table(
            {"bare_ndvi_threshold": f["bare_ndvi"], "bare_ndvi_range_draft": f["bare_ndvi_range"],
             "note": "Share of years in which the month's mean NDVI stayed under the bare threshold; null when fewer than 3 years."},
            bare, cfg, NDVI_SOURCE, f"{first} to {last}"))
        tables += ["ndvi_series", "bare_calendar"]
    write("index.json", {
        "generated": datetime.now(SRI_LANKA).isoformat(timespec="seconds"), "pilot_bbox": f["pilot_bbox"],
        "cells": covered, "power_data_last_day": last_day, "years_used": period, "tables": tables, "ndvi": ndvi_note,
        "sm_anomaly": {"available": False, "reason": "SMAP data is not fetched by this pipeline yet."},
        "gaps": ["No SMAP soil-moisture anomaly table (not fetched).",
                 "ET0 is Hargreaves-Samani, not FAO-56 Penman-Monteith.",
                 "Only the cells listed in 'cells' have tables; a farm elsewhere gets a plain 'not covered' answer.",
                 "Elevation is not stored here (the terrain DEM tiles can supply it)."],
        "thresholds_are_placeholders": True, "demo": False})
    print("cells:", ", ".join(c["key"] for c in covered))


if __name__ == "__main__":
    main()
