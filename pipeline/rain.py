"""
Rainfall step of the TerraOrb pipeline
=============================================

    .venv\\Scripts\\python pipeline\\rain.py              (run from the repo root)
    .venv\\Scripts\\python pipeline\\rain.py --today 2026-11-14   (pretend it's another day)

For every tank in data/tanks.json this script:

  1. downloads daily rainfall (PRECTOTCORR) and max temperature (T2M_MAX) from the
     NASA POWER daily point API, one calendar year per request, and caches each year
     in pipeline/cache/ so finished years are never downloaded again;
  2. finds the onset (start of the rains) of every Yala and Maha season, using the
     thresholds in pipeline/config.toml;
  3. computes each season's total rain, the 1991–2020 normals and onset delays;
  4. compares the season in progress with normal (rain_so_far_mm, R);
  5. counts how many El Niño analogue seasons had below-normal rain;
  6. writes the "rain" and "elnino" sections of data/tank/<id>.json
     (all other sections are left exactly as they were);
  7. prints a summary table so you can check the numbers by eye.

If any download fails, the script stops before writing anything.
Format of the output: docs/schema.md, sections 3.2 and 3.4.
"""

import argparse
import json
import sys
import tomllib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
CACHE_DIR = PIPELINE / "cache"
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
SEASON_KINDS = ("Yala", "Maha")


# ===========================================================================
# 1. Settings
# ===========================================================================
def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


# ===========================================================================
# 2. Download (with cache)
# ===========================================================================
#
# How the cache works
#   * A finished year is downloaded in one request and saved as ..._YYYY.json.
#   * The current year (and any year whose one-shot download contained a skipped
#     source, see config.toml) is downloaded month by month, saved as ..._YYYY-MM.json.
#   * Only COMPLETE and CLEAN chunks are saved. A cached file can therefore never
#     change, and is never downloaded again. Incomplete chunks are re-downloaded each run.

def power_cell(lat, lon, cfg):
    """Centre of the NASA POWER (MERRA-2) grid cell containing a point: (lat, lon)."""
    dlat, dlon = cfg["power"]["grid_lat_deg"], cfg["power"]["grid_lon_deg"]
    return round(round(lat / dlat) * dlat, 4), round(round(lon / dlon) * dlon, 4)


def cache_file(lat, lon, label):
    return CACHE_DIR / f"power_daily_{lat:.4f}_{lon:.4f}_{label}.json"


def request_power(lat, lon, first, last, cfg):
    """One POWER daily request; stops the program if it fails."""
    params = {
        "parameters": ",".join(cfg["power"]["parameters"]),
        "community": cfg["power"]["community"],
        "latitude": lat,
        "longitude": lon,
        "start": first.strftime("%Y%m%d"),
        "end": last.strftime("%Y%m%d"),
        "format": "JSON",
    }
    where = f"({lat}, {lon}, {first} to {last})"
    try:
        response = requests.get(cfg["power"]["url"], params=params,
                                timeout=cfg["power"]["timeout_seconds"])
    except requests.RequestException as err:
        sys.exit(f"STOPPED: could not reach NASA POWER {where}: {err}\nNothing was written.")
    if response.status_code != 200:
        sys.exit(f"STOPPED: NASA POWER returned HTTP {response.status_code} for {where}:\n"
                 f"{response.text[:500]}\nNothing was written.")
    return response.json()


def is_clean(data, cfg):
    """True if the response lists none of the sources in power.skip_sources."""
    return not set(data["header"].get("sources", [])) & set(cfg["power"]["skip_sources"])


def covers(data, last):
    return data["header"]["end"] == last.strftime("%Y%m%d")


def read_cache(path, cfg=None):
    """Cached POWER answer, or None. If cfg is given, a file that lacks any parameter we now ask for
    (for example T2M_MIN, added later) counts as missing and is downloaded again."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None                                  # a half-written file (interrupted run): download again
    if cfg is not None and not set(cfg["power"]["parameters"]) <= set(data["properties"]["parameter"]):
        return None
    return data


def save_cache(path, data):
    CACHE_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def fetch_months(lat, lon, year, today, cfg, notes):
    """Month-by-month download of one year, stopping at the first unusable month."""
    chunks = []
    for month in range(1, 13):
        first = date(year, month, 1)
        if first > today:
            break
        month_end = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        last = min(month_end, today)
        path = cache_file(lat, lon, f"{year}-{month:02d}")

        data = read_cache(path, cfg)
        if data is None:
            data = request_power(lat, lon, first, last, cfg)
            if not is_clean(data, cfg):
                notes.append(f"skipped {first} onwards: POWER source "
                             f"{data['header'].get('sources')} is in skip_sources (see config.toml)")
                return chunks, True                  # stop: later months would leave a gap
            if last == month_end and covers(data, month_end):
                save_cache(path, data)               # complete + clean → cache for good
        chunks.append(data)
    return chunks, False


def load_daily(lat, lon, today, cfg):
    """All years for one point → (DataFrame indexed by date, source label, notes).

    Columns are the POWER parameters. POWER's fill value (-999, "no data")
    becomes NaN. Data stops at the first skipped (untrusted) month.
    """
    chunks, notes = [], []
    for year in range(cfg["power"]["first_year"], today.year + 1):
        year_end = date(year, 12, 31)
        path = cache_file(lat, lon, str(year))
        data = read_cache(path, cfg)
        if data is not None and not (is_clean(data, cfg) and covers(data, year_end)):
            data = None                              # never trust an incomplete or skipped-source file
        if data is None and year < today.year:
            data = request_power(lat, lon, date(year, 1, 1), year_end, cfg)
            if is_clean(data, cfg) and covers(data, year_end):
                save_cache(path, data)
            else:
                data = None                          # fall back to month by month
        if data is not None:
            chunks.append(data)
            continue
        month_chunks, stopped = fetch_months(lat, lon, year, today, cfg, notes)
        chunks.extend(month_chunks)
        if stopped:
            break

    frames, sources = [], set()
    for data in chunks:
        df = pd.DataFrame(data["properties"]["parameter"])
        df.index = pd.to_datetime(df.index, format="%Y%m%d")
        frames.append(df.replace(data["header"]["fill_value"], float("nan")))
        sources.update(data["header"].get("sources", []))

    daily = pd.concat(frames).sort_index()
    daily = daily.loc[:pd.Timestamp(today)]          # ignore anything after "today"
    # Make sure every calendar day has a row, so missing days show up as NaN.
    daily = daily.asfreq("D")

    # Safety stop for impossible values (see max_daily_rain_mm in config.toml).
    limit = cfg["power"]["max_daily_rain_mm"]
    too_big = daily["PRECTOTCORR"][daily["PRECTOTCORR"] > limit]
    if not too_big.empty:
        sys.exit(f"STOPPED: NASA POWER rainfall above {limit} mm/day at ({lat}, {lon}) on "
                 f"{too_big.index[0].date()} ({too_big.iloc[0]} mm) and {len(too_big) - 1} other day(s). "
                 "This looks like a data error. Nothing was written.")
    temp_limit = cfg["rain"]["extremes"]["max_daily_temp_c"]
    too_hot = daily["T2M_MAX"][daily["T2M_MAX"] > temp_limit]
    if not too_hot.empty:
        sys.exit(f"STOPPED: NASA POWER maximum temperature above {temp_limit} °C at ({lat}, {lon}) on "
                 f"{too_hot.index[0].date()} ({too_hot.iloc[0]} °C). This looks like a data error. "
                 "Nothing was written.")

    # POWER should never give a minimum above the maximum; if it does, say so rather than use it.
    bad = daily[daily["T2M_MIN"] > daily["T2M_MAX"]]
    if not bad.empty:
        sys.exit(f"STOPPED: NASA POWER T2M_MIN is above T2M_MAX at ({lat}, {lon}) on {bad.index[0].date()}. "
                 "This looks like a data error. Nothing was written.")

    source = f"NASA POWER (PRECTOTCORR; {', '.join(sorted(sources))})"
    return daily, source, notes


# ===========================================================================
# 3. Season calendar
# ===========================================================================
def month_day(text, year):
    month, day = (int(x) for x in text.split("-"))
    return date(year, month, day)


def season_dates(kind, year, cfg):
    """Onset window start, and first/last day of the total period, for one season.

    `year` is the year the season starts: Maha 2015/16 → 2015, Yala 2016 → 2016.
    """
    s = cfg["rain"]["seasons"][kind]
    window_start = month_day(s["onset_window_start"], year)
    total_start = month_day(s["total_start"], year)
    total_end = month_day(s["total_end"], year)
    if total_end < total_start:                     # Maha: ends in the next year
        total_end = month_day(s["total_end"], year + 1)
    return window_start, total_start, total_end


def season_label(kind, year):
    return f"Yala {year}" if kind == "Yala" else f"Maha {year}/{(year + 1) % 100:02d}"


def all_seasons(first_year, last_day, cfg):
    """Every (kind, year) whose total period has fully ended by last_day, oldest first."""
    out = []
    for year in range(first_year, last_day.year + 1):
        for kind in SEASON_KINDS:                   # Yala (Apr) comes before Maha (Oct)
            if season_dates(kind, year, cfg)[2] <= last_day:
                out.append((kind, year))
    return out


# ===========================================================================
# 4. Calculations (pure functions: rainfall Series in, numbers out)
# ===========================================================================
def window_sum(rain, first, last):
    """Total rain from `first` to `last` (both included), or None if any day is missing."""
    part = rain.loc[pd.Timestamp(first):pd.Timestamp(last)]
    expected_days = (last - first).days + 1
    if len(part) != expected_days or part.isna().any():
        return None
    return float(part.sum())


def find_onset(rain, window_start, onset_cfg):
    """First day D on or after window_start that meets the onset rule (see config.toml).

    Returns a date, or None if no day in the search period qualifies.
    A day can't qualify if any rainfall value it needs is missing.
    """
    wet_days = onset_cfg["wet_spell_days"]
    dry_days = onset_cfg["dry_spell_days"]
    for offset in range(onset_cfg["search_days"]):
        day = window_start + timedelta(days=offset)

        # (1) Wet spell: D … D + wet_days - 1 must reach wet_spell_mm.
        wet = window_sum(rain, day, day + timedelta(days=wet_days - 1))
        if wet is None or wet < onset_cfg["wet_spell_mm"]:
            continue

        # (2) No dry spell in the days after the wet spell, up to D + check_days.
        check = rain.loc[pd.Timestamp(day + timedelta(days=wet_days)):
                         pd.Timestamp(day + timedelta(days=onset_cfg["check_days"]))]
        expected = onset_cfg["check_days"] - wet_days + 1
        if len(check) != expected or check.isna().any():
            continue                                # can't confirm: data missing
        dry_spell = check.rolling(dry_days).sum() < onset_cfg["dry_spell_mm"]
        if dry_spell.any():
            continue                                # false start: rain stopped again

        return day
    return None


def mean_or_none(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def ratio(a, b):
    """a ÷ b to 2 decimals, or None if it can't be computed (schema rule)."""
    if a is None or b in (None, 0):
        return None
    return round(a / b, 2)


def r1(x):
    return None if x is None else round(x, 1)


def compute_seasons(rain, cfg, first_year, last_day):
    """The rain.seasons list of the schema, plus the mean onset date per season type."""
    normal_years = range(cfg["rain"]["normal_first_year"], cfg["rain"]["normal_last_year"] + 1)

    raw = []
    for kind, year in all_seasons(first_year, last_day, cfg):
        window_start, total_start, total_end = season_dates(kind, year, cfg)
        onset = find_onset(rain, window_start, cfg["rain"]["onset"])
        raw.append({
            "kind": kind, "year": year,
            "onset": onset,
            "onset_offset": None if onset is None else (onset - window_start).days,
            "total": window_sum(rain, total_start, total_end),
        })

    normals, mean_offsets = {}, {}
    for kind in SEASON_KINDS:
        in_normal = [s for s in raw if s["kind"] == kind and s["year"] in normal_years]
        normals[kind] = mean_or_none(s["total"] for s in in_normal)
        mean_offsets[kind] = mean_or_none(s["onset_offset"] for s in in_normal)

    seasons = []
    for s in raw:
        mean_offset = mean_offsets[s["kind"]]
        delay = (None if s["onset_offset"] is None or mean_offset is None
                 else round(s["onset_offset"] - mean_offset))
        seasons.append({
            "season": season_label(s["kind"], s["year"]),
            "onset_date": None if s["onset"] is None else s["onset"].isoformat(),
            "onset_delay_days": delay,
            "total_mm": r1(s["total"]),
            "normal_mm": r1(normals[s["kind"]]),
        })
    return seasons, mean_offsets


def longest_dry_spell(values, dry_mm):
    """Longest run of consecutive days with less than dry_mm of rain."""
    best = run = 0
    for v in values:
        run = run + 1 if v < dry_mm else 0
        best = max(best, run)
    return best


def compute_extremes(rain, tmax, cfg, first_year, last_day):
    """Per finished season: longest dry spell, hot days and hottest day; plus normals.

    Returns ({season label: {...}}, {kind: {...normals}}). A value is None if any day
    in the season's total period is missing, never a partial count.
    """
    ex = cfg["rain"]["extremes"]
    normal_years = range(cfg["rain"]["normal_first_year"], cfg["rain"]["normal_last_year"] + 1)
    per_season, raw = {}, []
    for kind, year in all_seasons(first_year, last_day, cfg):
        _, start, end = season_dates(kind, year, cfg)
        days = (end - start).days + 1
        r = rain.loc[pd.Timestamp(start):pd.Timestamp(end)]
        t = tmax.loc[pd.Timestamp(start):pd.Timestamp(end)]
        rain_ok = len(r) == days and not r.isna().any()
        temp_ok = len(t) == days and not t.isna().any()
        row = {
            "longest_dry_spell_days": longest_dry_spell(r.tolist(), ex["dry_day_mm"]) if rain_ok else None,
            "hot_days": int((t >= ex["hot_day_c"]).sum()) if temp_ok else None,
            "max_temp_c": r1(float(t.max())) if temp_ok else None,
        }
        per_season[season_label(kind, year)] = row
        raw.append((kind, year, row))

    normals = {}
    for kind in SEASON_KINDS:
        rows = [row for k, y, row in raw if k == kind and y in normal_years]
        normals[kind] = {
            "longest_dry_spell_days": r1(mean_or_none(x["longest_dry_spell_days"] for x in rows)),
            "hot_days": r1(mean_or_none(x["hot_days"] for x in rows)),
        }
    return per_season, normals


# ---------------------------------------------------------------------------
# Reference evapotranspiration (ET0) and the cell climate files the crop model reads
# ---------------------------------------------------------------------------
def extraterrestrial_radiation(lat_deg, day_of_year):
    """Ra in mm/day of evaporation equivalent, FAO-56 Eq. 21 (needs only latitude and date)."""
    import numpy as np
    phi = np.radians(lat_deg)
    j = np.asarray(day_of_year, dtype=float)
    dr = 1 + 0.033 * np.cos(2 * np.pi * j / 365)                     # distance Earth–Sun
    delta = 0.409 * np.sin(2 * np.pi * j / 365 - 1.39)               # solar declination
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(delta), -1, 1))     # sunset hour angle
    ra = (24 * 60 / np.pi) * 0.0820 * dr * (ws * np.sin(phi) * np.sin(delta)
                                            + np.cos(phi) * np.cos(delta) * np.sin(ws))
    return 0.408 * ra                                                # MJ m-2 day-1 → mm day-1


def hargreaves_et0(lat_deg, index, tmax, tmin, cfg):
    """Daily ET0 (mm/day) by Hargreaves-Samani: 0.0023 (Tmean + 17.8) sqrt(Tmax - Tmin) Ra."""
    import numpy as np
    ra = extraterrestrial_radiation(lat_deg, index.dayofyear.to_numpy())
    tmean = (tmax.to_numpy() + tmin.to_numpy()) / 2
    spread = np.sqrt(np.clip(tmax.to_numpy() - tmin.to_numpy(), 0, None))
    et0 = cfg["rain"]["et0"]["hargreaves_coefficient"] * (tmean + 17.8) * spread * ra
    return pd.Series(np.clip(et0, cfg["rain"]["et0"]["min_et0"], None), index=index)


def write_cell_file(cell, daily, source, cfg, now):
    """data/cells/<lat>_<lon>.json: the cell's whole daily record (rain and ET0, tenths of a mm).

    Written for the crop model (pipeline/crops.py), which reads only JSON. Tanks in the same
    NASA POWER grid cell share one file. null = missing day.
    """
    et0 = hargreaves_et0(cell[0], daily.index, daily["T2M_MAX"], daily["T2M_MIN"], cfg)
    limit = cfg["rain"]["et0"]["max_et0"]
    if (et0 > limit).any():
        sys.exit(f"STOPPED: ET0 above {limit} mm/day for cell {cell}: this looks like a data error. "
                 "Nothing was written.")
    tenths = lambda s: [None if pd.isna(v) else int(round(v * 10)) for v in s]   # noqa: E731
    doc = {
        "schema_version": "1.7",
        "cell": list(cell),
        "start": daily.index[0].date().isoformat(),
        "last": daily.index[-1].date().isoformat(),
        "unit": "tenths of a millimetre per day",
        "rain_tenths": tenths(daily["PRECTOTCORR"]),
        "et0_tenths": tenths(et0.where(daily["T2M_MAX"].notna() & daily["T2M_MIN"].notna())),
        "source": source,
        "et0_method": "Hargreaves-Samani (1985) from NASA POWER T2M_MAX and T2M_MIN; Ra from FAO-56 Eq. 21",
        "generated": now,
    }
    path = REPO / "data" / "cells" / f"{cell[0]}_{cell[1]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def compute_current(rain, as_of, cfg):
    """The rain.current object for the season whose total period contains as_of, else None."""
    normal_years = range(cfg["rain"]["normal_first_year"], cfg["rain"]["normal_last_year"] + 1)
    for kind in SEASON_KINDS:
        for start_year in (as_of.year, as_of.year - 1):        # Maha may have started last year
            _, total_start, total_end = season_dates(kind, start_year, cfg)
            if not total_start <= as_of <= total_end:
                continue
            days_in = (as_of - total_start).days                # same length every year
            so_far = window_sum(rain, total_start, as_of)
            normal_so_far = mean_or_none(
                window_sum(rain, season_dates(kind, y, cfg)[1],
                           season_dates(kind, y, cfg)[1] + timedelta(days=days_in))
                for y in normal_years)
            return {
                "season": season_label(kind, start_year),
                "as_of": as_of.isoformat(),
                "rain_so_far_mm": r1(so_far),
                "normal_so_far_mm": r1(normal_so_far),
                "R": ratio(so_far, normal_so_far),
            }
    return None


def monthly_totals(rain, last_day):
    """Total rain per calendar month, oldest first: [{"month": "YYYY-MM", "total_mm": x}].

    Only months that have ended by last_day are listed. A month with any missing day
    gets total_mm = None (never a partial sum).
    """
    out = []
    first = rain.index.min().date().replace(day=1)
    month = first
    while True:
        next_month = (month + timedelta(days=32)).replace(day=1)
        month_end = next_month - timedelta(days=1)
        if month_end > last_day:
            return out
        out.append({"month": month.strftime("%Y-%m"), "total_mm": r1(window_sum(rain, month, month_end))})
        month = next_month


def compute_elnino(seasons, analog_seasons, source):
    """Count analogue seasons with total below normal (only seasons that have data)."""
    by_label = {s["season"]: s for s in seasons}
    with_data = [by_label[a] for a in analog_seasons
                 if a in by_label and by_label[a]["total_mm"] is not None
                 and by_label[a]["normal_mm"] is not None]
    return {
        "analog_seasons": list(analog_seasons),
        "below_normal_count": sum(1 for s in with_data if s["total_mm"] < s["normal_mm"]),
        "total": len(with_data),
        "source": source,
    }


# ===========================================================================
# 5. Writing data/tank/<id>.json
# ===========================================================================
def write_tank_file(tank, rain_section, elnino_section, now):
    """Replace only the rain and elnino sections; keep everything else as it was."""
    path = REPO / "data" / "tank" / f"{tank['id']}.json"
    if path.exists():
        doc = json.loads(path.read_text(encoding="utf-8"))
    else:
        doc = {"schema_version": "1.0", "id": tank["id"], "generated": now, "demo": False,
               "water": None, "rain": None, "soil": None, "elnino": None, "result": None}

    doc["rain"] = rain_section
    doc["elnino"] = elnino_section
    doc["generated"] = now
    doc["demo"] = any(isinstance(doc.get(k), dict) and doc[k].get("demo")
                      for k in ("water", "rain", "soil", "elnino", "result"))
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return doc


# ===========================================================================
# 6. Summary table
# ===========================================================================
def fmt(x, width, digits=1):
    if x is None:
        return "-".rjust(width)
    return f"{x:{width}.{digits}f}" if isinstance(x, float) else f"{x:>{width}}"


def print_summary(tank, rain_section, elnino_section, mean_offsets, cfg):
    seasons = rain_section["seasons"]
    print(f"\n=== {tank['id']} ({tank['name_en']})  {tank['lat']}, {tank['lon']}"
          f"{'   [DEMO TANK: placeholder location]' if tank['demo'] else ''}")
    print(f"Source: {rain_section['source']}   Normal period: {rain_section['normal_period']}")
    for kind in SEASON_KINDS:
        start = month_day(cfg["rain"]["seasons"][kind]["onset_window_start"], 2001)
        mean_off = mean_offsets[kind]
        mean_date = "-" if mean_off is None else (start + timedelta(days=round(mean_off))).strftime("%d %b")
        of_kind = [s for s in seasons if s["season"].startswith(kind)]
        normal = of_kind[0]["normal_mm"] if of_kind else None
        found = sum(1 for s in of_kind if s["onset_date"])
        print(f"  {kind}: mean onset {mean_date}, normal total {fmt(normal, 0)} mm, "
              f"onset found in {found} of {len(of_kind)} seasons")

    print(f"  {'season':<13}{'onset':>12}{'delay d':>9}{'total mm':>10}{'normal mm':>11}{'% normal':>10}")
    for s in seasons:
        pct = None if s["total_mm"] is None or not s["normal_mm"] else round(100 * s["total_mm"] / s["normal_mm"])
        flag = "  <- check: under 40% of normal" if pct is not None and pct < 40 else ""
        print(f"  {s['season']:<13}{(s['onset_date'] or '-'):>12}{fmt(s['onset_delay_days'], 9)}"
              f"{fmt(s['total_mm'], 10)}{fmt(s['normal_mm'], 11)}{fmt(pct, 10)}{flag}")

    c = rain_section["current"]
    if c:
        print(f"  Current {c['season']} up to {c['as_of']}: {c['rain_so_far_mm']} mm so far, "
              f"normal {c['normal_so_far_mm']} mm  ->  R = {c['R']}")
    else:
        print("  Current: no season in progress (between Maha and Yala total periods)")
    e = elnino_section
    print(f"  El Niño analogues {', '.join(e['analog_seasons'])}: "
          f"{e['below_normal_count']} of {e['total']} below normal")


# ===========================================================================
# 7. Main
# ===========================================================================
def build_rain_for_point(daily, source, today, demo, cfg):
    """Everything rain.py computes for one location (used by main and handy in tests)."""
    rain = daily["PRECTOTCORR"]
    valid = rain.dropna()
    if valid.empty:
        sys.exit("STOPPED: NASA POWER returned no rainfall values. Nothing was written.")
    as_of = valid.index.max().date()                 # POWER lags today by a few days

    seasons, mean_offsets = compute_seasons(rain, cfg, cfg["power"]["first_year"], as_of)

    # Heat and dry spells, added to each season row (T2M_MAX is downloaded with the rain).
    per_season, extreme_normals = compute_extremes(rain, daily["T2M_MAX"], cfg,
                                                   cfg["power"]["first_year"], as_of)
    for s in seasons:
        s.update(per_season.get(s["season"], {}))

    rain_section = {
        "seasons": seasons,
        "normal_period": f"{cfg['rain']['normal_first_year']}–{cfg['rain']['normal_last_year']}",
        "current": compute_current(rain, as_of, cfg),
        "monthly": monthly_totals(rain, as_of),
        "extremes": {
            "dry_day_mm": cfg["rain"]["extremes"]["dry_day_mm"],
            "hot_day_c": cfg["rain"]["extremes"]["hot_day_c"],
            "normals": extreme_normals,
            "temp_source": "NASA POWER (T2M_MAX)",
        },
        "source": source,
        "demo": demo,
    }
    elnino_section = compute_elnino(seasons, cfg["elnino"]["analog_seasons"], source)
    elnino_section["demo"] = demo
    return rain_section, elnino_section, mean_offsets


def main():
    parser = argparse.ArgumentParser(description="TerraOrb rainfall step (NASA POWER).")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(),
                        help="treat this date as today (YYYY-MM-DD)")
    args = parser.parse_args()
    # Windows consoles default to an old code page; UTF-8 lets "1991–2020" and Sinhala print.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]

    # Download and compute everything first, so a failed download writes nothing.
    # One download per POWER grid cell, shared by every tank in that cell.
    by_cell = {}
    for tank in tanks:
        cell = power_cell(tank["lat"], tank["lon"], cfg)
        if cell not in by_cell:
            print(f"Loading NASA POWER data for grid cell {cell} ...", flush=True)
            daily, source, notes = load_daily(cell[0], cell[1], args.today, cfg)
            for note in notes:
                print(f"  NOTE: {note}")
            by_cell[cell] = (daily, source)

    results = []
    for tank in tanks:
        cell = power_cell(tank["lat"], tank["lon"], cfg)
        daily, source = by_cell[cell]
        # A demo tank's location is a placeholder, so its rain stays marked demo too.
        rain_section, elnino_section, mean_offsets = build_rain_for_point(
            daily, source, args.today, tank["demo"], cfg)
        rain_section["power_cell"] = list(cell)            # which grid cell the rain comes from
        results.append((tank, daily, rain_section, elnino_section, mean_offsets))

    # Write every file first, then print, so a printing problem can't leave half the tanks updated.
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()
    docs = [write_tank_file(tank, rain_section, elnino_section, now)
            for tank, _, rain_section, elnino_section, _ in results]
    for cell, (daily, source) in by_cell.items():
        write_cell_file(cell, daily, source, cfg, now)

    # One summary table per grid cell (all tanks in a cell have the same rain), then the tanks in it.
    printed = set()
    for tank, daily, rain_section, elnino_section, mean_offsets in results:
        cell = tuple(rain_section["power_cell"])
        if cell in printed:
            continue
        printed.add(cell)
        in_cell = [t["id"] for t, *_ in results if power_cell(t["lat"], t["lon"], cfg) == cell]
        print(f"\n##### NASA POWER grid cell {cell}: {len(in_cell)} tank(s) share this rainfall")
        print_summary(tank, rain_section, elnino_section, mean_offsets, cfg)
        print(f"  Tanks: {', '.join(in_cell)}")
    print(f"\nWrote rain and elnino sections for {len(results)} tank(s) in data/tank/ "
          f"({len(by_cell)} NASA POWER grid cell(s)). Re-run rules.py next.")


if __name__ == "__main__":
    main()
