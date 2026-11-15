"""
NASA POWER daily rain and maximum temperature for the squares that cover the trip destinations.

    .venv\\Scripts\\python -m pipeline.trip.main --only power        (run from the repo root; slow, resumable)

For every square (0.5 deg x 0.625 deg, same rule as pipeline/rain.py) this module gives a DataFrame of daily
PRECTOTCORR (mm) and T2M_MAX (C) for 1981-01-01 .. 2025-12-31, from the first source that has it:

  1. pipeline/cache/trip/power_<square>.json            (our own cache of a finished download)
  2. data/cells/<square>.json + pipeline/cache/power_daily_*  (the squares pipeline/rain.py already downloaded)
  3. the NASA POWER daily point API (one request for the whole period; if that fails, one per year)

POWER resets connections that come too fast: we pause between requests, retry with longer waits, and keep every
finished square in the cache. A square that does not answer is SKIPPED and reported (missing list); run again to
fill it in. Days from the near-real-time source GEOSIT are never used (see [power] skip_sources in config.toml);
rain data therefore ends 30 Sep 2026, and this module only asks for 1981..2025 anyway.
"""

import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402
from pipeline.trip.processing import cleaning  # noqa: E402


class PowerError(RuntimeError):
    pass


def cache_path(key):
    return common.CACHE / f"power_{key}.json"


def split_key(key):
    lat, lon = key.split("_")
    return float(lat), float(lon)


# ---------------------------------------------------------------------------
# Sources 1 and 2: files we already have
# ---------------------------------------------------------------------------
def load_own_cache(key):
    path = cache_path(key)
    if not path.exists():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        idx = pd.date_range(doc["start"], doc["end"], freq="D")
        df = pd.DataFrame({"PRECTOTCORR": doc["rain"], "T2M_MAX": doc["tmax"]}, index=idx).astype(float)
    except (ValueError, KeyError, json.JSONDecodeError):
        return None                                   # half-written or damaged file: download again
    return df


def save_own_cache(key, df, sources):
    common.CACHE.mkdir(parents=True, exist_ok=True)

    def tolist(s):
        return [None if pd.isna(v) else round(float(v), 2) for v in s]

    doc = {"cell": key, "start": df.index[0].date().isoformat(), "end": df.index[-1].date().isoformat(),
           "sources": sorted(sources), "rain": tolist(df["PRECTOTCORR"]), "tmax": tolist(df["T2M_MAX"]),
           "downloaded": common.now_iso()}
    cache_path(key).write_text(json.dumps(doc), encoding="utf-8")


def reuse_file(key, cfg):
    return common.REPO / cfg["trip"]["download"]["reuse_cells_dir"] / f"{key}.json"


def load_from_rain_pipeline(key, cfg):
    """Rain from data/cells/<key>.json (tenths of mm) and T2M_MAX from the yearly POWER files pipeline/rain.py cached.
    Returns a DataFrame or None if the square was not downloaded by pipeline/rain.py."""
    t = cfg["trip"]
    path = reuse_file(key, cfg)
    if not path.exists():
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    idx = pd.date_range(doc["start"], doc["last"], freq="D")
    rain = pd.Series([np.nan if v is None else v / 10 for v in doc["rain_tenths"]], index=idx)
    lat, lon = split_key(key)
    tmax_parts = []
    for year in range(t["first_year"], t["last_year"] + 1):
        f = common.PIPELINE / "cache" / f"power_daily_{lat:.4f}_{lon:.4f}_{year}.json"
        if not f.exists():
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if not cleaning.is_clean(data["header"], cfg["power"]["skip_sources"]):
                continue
            tmax_parts.append(cleaning.parse_power(data, ("PRECTOTCORR", "T2M_MAX"))["T2M_MAX"])
        except (ValueError, KeyError, json.JSONDecodeError):
            continue
    tmax = pd.concat(tmax_parts).sort_index() if tmax_parts else pd.Series(dtype=float)
    df = pd.DataFrame({"PRECTOTCORR": rain})
    df["T2M_MAX"] = tmax.reindex(df.index)
    return df


# ---------------------------------------------------------------------------
# Source 3: the POWER API
# ---------------------------------------------------------------------------
def request_power(lat, lon, first, last, cfg):
    """One POWER daily request with retries. Returns the JSON answer; raises PowerError if every try fails."""
    t = cfg["trip"]["download"]
    params = {"parameters": ",".join(t["parameters"]), "community": cfg["power"]["community"], "latitude": lat,
              "longitude": lon, "start": first.strftime("%Y%m%d"), "end": last.strftime("%Y%m%d"), "format": "JSON"}
    last_error = "no answer"
    for attempt in range(t["retries"]):
        try:
            r = requests.get(cfg["power"]["url"], params=params, timeout=t["timeout_seconds"],
                             headers={"User-Agent": common.USER_AGENT})
            if r.status_code == 200:
                return r.json()
            last_error = f"HTTP {r.status_code}: {r.text[:150]}"
        except (requests.RequestException, ValueError) as err:
            last_error = str(err)[:200]
        time.sleep(t["retry_wait_seconds"] * (attempt + 1))
    raise PowerError(f"NASA POWER did not answer for ({lat}, {lon}) {first}..{last}: {last_error}")


def download_cell(key, cfg):
    """Download the whole period for one square: one request, or one per year if that fails. Returns (DataFrame, sources)."""
    t = cfg["trip"]
    lat, lon = split_key(key)
    first, last = date(t["first_year"], 1, 1), date(t["last_year"], 12, 31)
    skip = cfg["power"]["skip_sources"]
    params = tuple(t["download"]["parameters"])
    sources = set()
    try:
        data = request_power(lat, lon, first, last, cfg)
        if not cleaning.is_clean(data["header"], skip):
            raise PowerError(f"answer for {key} lists an untrusted source {data['header'].get('sources')}")
        frames = [cleaning.parse_power(data, params)]
        sources |= set(data["header"].get("sources", []))
    except PowerError as first_error:
        print(f"    one request failed ({first_error}); trying year by year", flush=True)
        frames, sources = [], set()
        for year in range(first.year, last.year + 1):
            part = common.CACHE / f"power_{key}_{year}.json"
            if part.exists():
                data = json.loads(part.read_text(encoding="utf-8"))
            else:
                data = request_power(lat, lon, date(year, 1, 1), date(year, 12, 31), cfg)      # raises -> square skipped
                if cleaning.is_clean(data["header"], skip):
                    common.CACHE.mkdir(parents=True, exist_ok=True)
                    part.write_text(json.dumps(data), encoding="utf-8")
                time.sleep(t["download"]["pause_seconds"])
            if not cleaning.is_clean(data["header"], skip):
                raise PowerError(f"year {year} of {key} lists an untrusted source") from first_error
            frames.append(cleaning.parse_power(data, params))
            sources |= set(data["header"].get("sources", []))
    df = pd.concat(frames).sort_index()
    df = cleaning.restrict(df, first, last)
    cleaning.check_values(df, cfg["power"]["max_daily_rain_mm"], cfg["rain"]["extremes"]["max_daily_temp_c"],
                          f"in square {key}")
    return df, sources


# ---------------------------------------------------------------------------
# Entry points used by main.py and the history step
# ---------------------------------------------------------------------------
def get_cell(key, cfg, allow_download=True):
    """Daily DataFrame for one square, or None if it is not available (and could not or should not be downloaded)."""
    t = cfg["trip"]
    first, last = date(t["first_year"], 1, 1), date(t["last_year"], 12, 31)
    df = load_own_cache(key)
    if df is None:
        df = load_from_rain_pipeline(key, cfg)
        if df is not None:
            df = cleaning.check_values(df, cfg["power"]["max_daily_rain_mm"],
                                       cfg["rain"]["extremes"]["max_daily_temp_c"], key)
    if df is None and allow_download:
        df, sources = download_cell(key, cfg)
        save_own_cache(key, cleaning.restrict(df, first, last), sources)
    if df is None:
        return None
    return cleaning.restrict(df, first, last)


def ensure_cells(keys, cfg, allow_download=True, log=print):
    """Get every square; returns ({key: DataFrame}, [missing keys]). A square that fails is reported, never faked."""
    have, missing = {}, []
    pause = cfg["trip"]["download"]["pause_seconds"]
    for n, key in enumerate(keys, 1):
        will_download = allow_download and load_own_cache(key) is None and not reuse_file(key, cfg).exists()
        try:
            df = get_cell(key, cfg, allow_download)
        except (PowerError, cleaning.DataError) as err:
            log(f"  [{n}/{len(keys)}] {key}: SKIPPED ({err})")
            missing.append(key)
            time.sleep(pause)
            continue
        if df is None:
            log(f"  [{n}/{len(keys)}] {key}: not available (download skipped)")
            missing.append(key)
            continue
        have[key] = df
        log(f"  [{n}/{len(keys)}] {key}: ok, {int(df['PRECTOTCORR'].notna().sum())} rain days")
        if will_download:
            time.sleep(pause)                       # POWER resets connections that come too fast
    return have, missing
