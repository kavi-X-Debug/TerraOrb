"""
NASA soil moisture for Sri Lanka: GLDAS-2.1 Noah, monthly, 0.25 degree (GES DISC), 2000 to the newest month.
This fills the "soil moisture" gap of the farm profile (data/farm/soil_moisture.json). It is a MODEL-based NASA product (land-surface
model driven by satellite and ground observations), NOT the SMAP satellite measurement, and it is area-level (about 25 km).

For every 0.25 degree land cell it keeps, for two layers (0-10 cm and 10-40 cm, in kg/m2 = mm of water):
  - the usual value of each calendar month (mean and standard deviation over 2001-2025),
  - the newest month, its difference from usual in standard deviations (z) and as a share of usual.

Needs the Earthdata token in the environment variable EARTHDATA_TOKEN (never written to a file). Downloads only a small box through NASA's
OPeNDAP service (about 26 KB a month); results are cached in pipeline/cache/soil_moisture/ so a re-run only fetches new months.
Run:  .venv\\Scripts\\python pipeline\\soil_moisture.py
"""
import io
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache" / "soil_moisture"
OUT = ROOT / "data" / "farm" / "soil_moisture.json"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
OPENDAP = "https://opendap.earthdata.nasa.gov/collections/C1342986036-GES_DISC/granules/"
LAYERS = {"l1": "SoilMoi0_10cm_inst", "l2": "SoilMoi10_40cm_inst"}
# GLDAS 0.25 degree grid: lat -59.875 + 0.25*row, lon -179.875 + 0.25*col. The box around Sri Lanka (checked against the file's own coordinates):
ROWS, COLS = (262, 279), (1037, 1048)             # lat 5.625..9.875, lon 79.375..82.125
LATS = [round(-59.875 + 0.25 * r, 3) for r in range(ROWS[0], ROWS[1] + 1)]
LONS = [round(-179.875 + 0.25 * c, 3) for c in range(COLS[0], COLS[1] + 1)]
NORMAL_YEARS = (2001, 2025)


def months_available():
    out, page = {}, 1
    while True:
        r = requests.get(CMR, params={"short_name": "GLDAS_NOAH025_M", "version": "2.1", "page_size": 500, "page_num": page}, timeout=90)
        r.raise_for_status()
        ents = r.json().get("feed", {}).get("entry", [])
        if not ents:
            break
        for e in ents:
            title = e["title"]                                       # GLDAS_NOAH025_M.2.1:GLDAS_NOAH025_M.A202607.021.nc4
            key = title.split(".A")[1][:6]                           # 202607
            out[key] = title
        page += 1
    return dict(sorted(out.items()))


def fetch_month(key, title, token):
    path = CACHE / f"{key}.npz"
    if path.exists():
        return key
    ce = ";".join(f"/{v}[0][{ROWS[0]}:{ROWS[1]}][{COLS[0]}:{COLS[1]}]" for v in LAYERS.values())
    url = OPENDAP + quote(title, safe="") + ".dap.nc4?dap4.ce=" + ce
    import xarray as xr
    for attempt in range(4):
        try:
            r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=90)
            if r.status_code in (401, 403):
                raise SystemExit(f"NASA refused the token (HTTP {r.status_code}).")
            if r.status_code == 200 and r.content[:4] == b"\x89HDF":
                ds = xr.open_dataset(io.BytesIO(r.content), engine="h5netcdf")
                arrs = {k: np.asarray(ds[v].values[0], dtype="float32") for k, v in LAYERS.items()}
                ds.close()
                for a in arrs.values():
                    a[a < 0] = np.nan
                np.savez_compressed(path, **arrs)
                return key
        except SystemExit:
            raise
        except Exception:
            pass
        import time
        time.sleep(2 * (attempt + 1))
    return None


def build():
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        sys.exit("EARTHDATA_TOKEN is not set (see AGENTS.md > Secrets).")
    CACHE.mkdir(parents=True, exist_ok=True)
    months = months_available()
    print(f"{len(months)} monthly files exist ({next(iter(months))} .. {next(reversed(months))})")
    with ThreadPoolExecutor(4) as pool:
        done = [k for k in pool.map(lambda kv: fetch_month(kv[0], kv[1], token), months.items())]
    failed = [k for k, v in zip(months, done) if v is None]
    if failed:
        print("could not fetch:", failed[:8], "...")
    # collect
    keys = [k for k in months if (CACHE / f"{k}.npz").exists()]
    data = {lk: np.stack([np.load(CACHE / f"{k}.npz")[lk] for k in keys]) for lk in LAYERS}        # [months, lat, lon]
    years = np.array([int(k[:4]) for k in keys]); mons = np.array([int(k[4:]) for k in keys])
    normal = (years >= NORMAL_YEARS[0]) & (years <= NORMAL_YEARS[1])
    newest = keys[-1]
    cells = {}
    for i, la in enumerate(LATS):
        for j, lo in enumerate(LONS):
            if not np.isfinite(data["l1"][:, i, j]).any():
                continue                                                  # ocean or lake cell: no value, never filled
            cell = {"clim_mean": {}, "clim_sd": {}, "latest": {"month": f"{newest[:4]}-{newest[4:]}"}}
            for lk in LAYERS:
                series = data[lk][:, i, j]
                mean, sd = [], []
                for m in range(1, 13):
                    sel = series[normal & (mons == m)]
                    sel = sel[np.isfinite(sel)]
                    mean.append(round(float(sel.mean()), 2) if len(sel) >= 10 else None)
                    sd.append(round(float(sel.std(ddof=1)), 2) if len(sel) >= 10 else None)
                cell["clim_mean"][lk], cell["clim_sd"][lk] = mean, sd
                v = float(series[-1]) if np.isfinite(series[-1]) else None
                m0 = int(newest[4:]) - 1
                cell["latest"][lk] = round(v, 2) if v is not None else None
                if v is not None and mean[m0] and sd[m0]:
                    cell["latest"][f"{lk}_z"] = round((v - mean[m0]) / sd[m0], 2)
                    cell["latest"][f"{lk}_pct_of_usual"] = round(100 * v / mean[m0])
            cells[f"{la}_{lo}"] = cell
    doc = {"schema": "farm-soil-moisture-1", "generated": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
           "source": "NASA GLDAS-2.1 Noah land-surface model, monthly, 0.25 degree (GES DISC). A NASA model product, not the SMAP satellite measurement.",
           "demo": False, "unit": "kg/m2 (mm of water)", "layers": {"l1": "0-10 cm", "l2": "10-40 cm"},
           "normal_period": f"{NORMAL_YEARS[0]}-{NORMAL_YEARS[1]}", "months_used": len(keys), "first_month": keys[0], "newest_month": newest,
           "resolution": "area-level, about 25 km", "grid": {"lat": LATS, "lon": LONS, "step": 0.25},
           "note": "A cell is the 0.25 degree square centred on the given lat_lon. Cells over the sea have no value and are left out. The newest month lags the calendar by a few weeks.",
           "cells": cells}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cells)} land cells, {len(keys)} months, newest {newest}")


if __name__ == "__main__":
    build()
