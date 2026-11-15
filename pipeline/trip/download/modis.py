"""
NASA MODIS NDVI (how green the land is) around each destination, through the ORNL DAAC MODIS web service (no login).

    .venv\\Scripts\\python -m pipeline.trip.main --only env

Product MOD13Q1 (Terra, 250 m, one composite per 16 days). For each destination we list the available composite dates,
take the newest few, and use the median NDVI of the land pixels in a 3 x 3 km block (same rule as pipeline/ndvi.py:
water, bare ground and cloud pixels below land_min_ndvi are ignored; too few land pixels -> no value).

NDVI is real or it is null. A destination that the service does not answer for gets ndvi = null (never a guess),
and a note in the output says so. Settings: [ndvi] and [trip.environment] in pipeline/config.toml.
"""

import statistics
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402


def median_land_ndvi(pixels, nd):
    """One value for one date: median of the land pixels, or None if too few. Pure function (tested offline)."""
    land = []
    for raw in pixels:
        if raw is None or raw == nd["fill_value"]:
            continue
        v = raw * nd["scale"]
        if v >= nd["land_min_ndvi"]:
            land.append(v)
    if len(land) < nd["min_land_pixels"]:
        return None
    return round(statistics.median(land), 3)


def get_json(url, params, nd):
    last = "no answer"
    for attempt in range(nd["retries"]):
        try:
            r = requests.get(url, params=params, timeout=nd["timeout_seconds"], headers={"User-Agent": common.USER_AGENT})
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as err:
            last = str(err)[:150]
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"MODIS service: {last}")


def latest_ndvi(lat, lon, cfg):
    """(ndvi, composite date) from the newest composites that have a value, or (None, None)."""
    nd = cfg["ndvi"]
    n_dates = cfg["trip"]["environment"]["ndvi_recent_dates"]
    base = f"{nd['url']}/{nd['product']}"
    dates = get_json(f"{base}/dates", {"latitude": lat, "longitude": lon}, nd)["dates"]
    recent = dates[-n_dates:]
    if not recent:
        return None, None
    data = get_json(f"{base}/subset", {
        "latitude": lat, "longitude": lon, "band": nd["band"],
        "startDate": recent[0]["modis_date"], "endDate": recent[-1]["modis_date"],
        "kmAboveBelow": nd["km_radius"], "kmLeftRight": nd["km_radius"]}, nd)
    rows = sorted(data["subset"], key=lambda r: r["calendar_date"], reverse=True)
    for row in rows:                                         # newest composite that has a usable value
        v = median_land_ndvi(row["data"], nd)
        if v is not None:
            return v, row["calendar_date"]
    return None, None


def fetch_ndvi(destinations, cfg, log=print):
    """{id: (ndvi or None, date or None)} and a list of ids the service did not answer for."""
    out, failed = {}, []
    for n, d in enumerate(destinations, 1):
        try:
            out[d["id"]] = latest_ndvi(d["lat"], d["lon"], cfg)
        except (RuntimeError, KeyError) as err:
            out[d["id"]] = (None, None)
            failed.append(d["id"])
            log(f"  NDVI {d['id']}: no answer ({err})")
        if n % 10 == 0:
            log(f"  NDVI: {n} of {len(destinations)}")
        time.sleep(0.5)
    return out, failed
