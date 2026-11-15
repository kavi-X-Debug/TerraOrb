"""
Usual rain and heat for every month, for the whole of Sri Lanka (used by the trip and event planner)
==================================================================================================

    .venv\\Scripts\\python pipeline\\climatology.py        (run from the repo root; no login needed; takes about a minute)

NASA POWER gives, for any place, the average rain (mm per day) and the average hottest-day temperature for each
month of the year, over 2001-2025 ("climatology"). POWER works in squares 0.5 degrees tall and 0.625 degrees wide
(the same squares rain.py uses), so this script asks once per square that covers Sri Lanka and writes
data/climatology.json. The web app finds the square of any place the visitor picks and shows its usual month.
It is static: run it once, and again only if you change the area or the period.

Nothing is invented: a square with no answer is left out and the app then says "no usual value for this place".
Answers are kept in pipeline/cache/climatology/, so a run that is cut short (POWER sometimes drops connections) continues
where it stopped when started again; squares that never answer are listed at the end.
"""

import json
import sys
import time
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
AREA = {"lat_min": 5.8, "lat_max": 9.9, "lon_min": 79.4, "lon_max": 82.0}      # a little wider than the island


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)["power"]


def stop(message):
    sys.exit(f"STOPPED: {message}\nNothing was written.")


def cell_centre(lat, lon, cfg):
    """The centre of the POWER square a point is in (same rule as rain.py: power_cell)."""
    dlat, dlon = cfg["grid_lat_deg"], cfg["grid_lon_deg"]
    return round(round(lat / dlat) * dlat, 4), round(round(lon / dlon) * dlon, 4)


def cells_over_area(cfg):
    """Centres of every POWER square that touches the area, from south-west to north-east."""
    dlat, dlon = cfg["grid_lat_deg"], cfg["grid_lon_deg"]
    lat0, lon0 = cell_centre(AREA["lat_min"], AREA["lon_min"], cfg)
    lat1, lon1 = cell_centre(AREA["lat_max"], AREA["lon_max"], cfg)
    cells, i = [], 0
    lat = lat0
    while lat <= lat1 + 1e-9:
        lon = lon0
        while lon <= lon1 + 1e-9:
            cells.append((round(lat, 4), round(lon, 4)))
            lon += dlon
        lat += dlat
    return cells


def parse_months(parameter):
    """[12 monthly numbers] from a POWER climatology parameter, or None if any month is missing (-999)."""
    values = [parameter.get(m) for m in MONTHS]
    return None if any(v is None or v <= -900 for v in values) else [round(v, 2) for v in values]


PAUSE_SECONDS = 12                                         # between squares


def fetch_cell(lat, lon, cfg, retries=3):
    params = {"parameters": "PRECTOTCORR,T2M_MAX", "community": "AG", "latitude": lat, "longitude": lon, "format": "JSON"}
    url = cfg["url"].replace("/temporal/daily/point", "/temporal/climatology/point")
    last = "no answer"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=cfg["timeout_seconds"])
            if r.status_code == 200:
                data = r.json()
                p = data["properties"]["parameter"]
                rain, tmax = parse_months(p["PRECTOTCORR"]), parse_months(p["T2M_MAX"])
                period = data.get("header", {}).get("title", "")
                return {"rain_mm_day": rain, "tmax_c": tmax}, period
            last = f"HTTP {r.status_code}: {r.text[:150]}"
        except (requests.RequestException, ValueError, KeyError) as err:
            last = str(err)
        time.sleep(6 * (attempt + 1))
    print(f"  no answer for the square at {lat}, {lon} ({last})", flush=True)
    return None, ""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()
    cells = cells_over_area(cfg)
    cache_dir = PIPELINE / "cache" / "climatology"
    cache_dir.mkdir(parents=True, exist_ok=True)
    print(f"Asking NASA POWER for {len(cells)} squares (answers already downloaded are reused) ...", flush=True)
    out, missing, period = {}, [], ""
    for lat, lon in cells:
        key = f"{lat}_{lon}"
        saved = cache_dir / f"{key}.json"
        if saved.exists():
            out[key] = json.loads(saved.read_text(encoding="utf-8"))
            continue
        values, period_ = fetch_cell(lat, lon, cfg)
        if values is None:                                 # this square did not answer: carry on, a later run fills it in
            missing.append(key)
            continue
        period = period_ or period
        if values["rain_mm_day"] and values["tmax_c"]:
            out[key] = values
            saved.write_text(json.dumps(values), encoding="utf-8")
            print(f"  {key} ok ({len(out)} of {len(cells)})", flush=True)
        time.sleep(PAUSE_SECONDS)                          # POWER resets connections that come too fast
    if not out:
        stop("no square gave a usable answer")
    doc = {
        "schema_version": "1.0",
        "generated": datetime.now(SRI_LANKA).replace(microsecond=0).isoformat(),
        "source": "NASA POWER climatology (PRECTOTCORR, T2M_MAX)",
        "period": "2001–2025",
        "note": period,
        "grid": {"lat_step": cfg["grid_lat_deg"], "lon_step": cfg["grid_lon_deg"]},
        "cells": out,
        "demo": False,
    }
    (REPO / "data" / "climatology.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote data/climatology.json with {len(out)} of {len(cells)} squares.")
    if missing:
        print(f"{len(missing)} squares did not answer ({', '.join(missing)}). Run the script again to fill them in.")


if __name__ == "__main__":
    main()
