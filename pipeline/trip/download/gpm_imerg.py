"""
NASA GPM IMERG (V07, daily "Late" run, 0.1 degree) rain for Sri Lanka, downloaded as a SMALL BOX per day.

Why a box: one global daily file is 32 MB; NASA's OPeNDAP service (Hyrax, DAP4) can cut out only the box around Sri Lanka
(lon 79.35-82.05, lat 5.75-9.95, 28 x 43 cells, about 28 KB per day). 25 years is about 250 MB.

Needs an Earthdata login: the token is read from the environment variable EARTHDATA_TOKEN (never written to a file, never printed).
Tokens expire after about 60 days. The variable `precipitation` is mm per day (IMERG "precipitationCal" gauge-calibrated, daily mean rate x 24 h).

Cache: pipeline/cache/trip/imerg/<YYYYMMDD>.npy (float32 array [lon, lat], NaN where NASA gives no value) + imerg_grid.json. Resumable:
days already in the cache are skipped. Days that fail are listed, never filled in. Run:
    python -m pipeline.trip.download.gpm_imerg --start 2001-01-01 [--end 2026-11-14] [--workers 4]
"""
import argparse
import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import numpy as np
import requests

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
OPENDAP = "https://opendap.earthdata.nasa.gov/collections/C2723754859-GES_DISC/granules/"
SHORT_NAME = "GPM_3IMERGDL"
FIRST_DAY = date(2000, 6, 1)                       # IMERG V07 starts here

# The box (grid index ranges, inclusive). IMERG grid: lon -179.95 + 0.1*i, lat -89.95 + 0.1*j.
LON0, LON1, LAT0, LAT1 = 2593, 2620, 957, 999      # lon 79.35..82.05, lat 5.75..9.95
CACHE = Path(__file__).resolve().parents[3] / "pipeline" / "cache" / "trip" / "imerg"


class ImergNotAvailable(RuntimeError):
    pass


def _token():
    tok = os.environ.get("EARTHDATA_TOKEN")
    if not tok:
        raise ImergNotAvailable("GPM IMERG needs an Earthdata token in the environment variable EARTHDATA_TOKEN. None found: skipped.")
    return tok


def status():
    """The `imerg` block of model_metadata.json (updated by the comparison step when IMERG is really used)."""
    n = len(list(CACHE.glob("2*.npy"))) if CACHE.exists() else 0
    if not os.environ.get("EARTHDATA_TOKEN") and n == 0:
        return {"used": False, "reason": "no Earthdata token"}
    return {"used": False, "days_cached": n, "reason": "downloaded but not yet compared with NASA POWER" if n else "no data downloaded yet"}


def grid():
    lons = np.round(-179.95 + 0.1 * np.arange(LON0, LON1 + 1), 2)
    lats = np.round(-89.95 + 0.1 * np.arange(LAT0, LAT1 + 1), 2)
    return lons, lats


def list_granules(start, end, session=None):
    """{date: granule title} for the days in [start, end], from NASA's public catalogue (no login needed)."""
    s = session or requests.Session()
    out, page = {}, 1
    while True:
        r = s.get(CMR, params={"short_name": SHORT_NAME, "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z", "page_size": 2000, "page_num": page}, timeout=90)
        r.raise_for_status()
        entries = r.json().get("feed", {}).get("entry", [])
        if not entries:
            break
        for e in entries:
            title = e.get("title", "")                      # GPM_3IMERGDL.07:3B-DAY-L.MS.MRG.3IMERG.20260929-S000000-E235959.V07C.nc4
            try:
                d = datetime.strptime(title.split("3IMERG.")[1][:8], "%Y%m%d").date()
            except (IndexError, ValueError):
                continue
            out[d] = title
        page += 1
    return out


def _subset_url(title):
    ce = f"/precipitation[0][{LON0}:{LON1}][{LAT0}:{LAT1}];/lon[{LON0}:{LON1}];/lat[{LAT0}:{LAT1}]"
    return OPENDAP + quote(title, safe="") + ".dap.nc4?dap4.ce=" + ce


def fetch_day(title, token, session, retries=4):
    """The box for one day as float32 [lon, lat] (mm/day, NaN = no value). Raises on failure; never invents numbers."""
    import xarray as xr
    last = None
    for attempt in range(retries):
        try:
            r = session.get(_subset_url(title), headers={"Authorization": f"Bearer {token}"}, timeout=90)
            if r.status_code == 200 and r.content[:4] == b"\x89HDF":
                ds = xr.open_dataset(io.BytesIO(r.content), engine="h5netcdf")
                arr = np.asarray(ds["precipitation"].values[0], dtype="float32")
                arr[arr < 0] = np.nan                       # fill values are negative
                ds.close()
                return arr
            if r.status_code in (401, 403):
                raise ImergNotAvailable(f"NASA refused the token (HTTP {r.status_code}): check it is valid and approved for GES DISC.")
            last = f"HTTP {r.status_code}"
        except ImergNotAvailable:
            raise
        except Exception as e:                              # connection resets, timeouts: wait and retry
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(last or "unknown error")


def download(start, end, workers=4, log=print):
    """Download every missing day in [start, end] into the cache. Returns {"done": n, "cached": n, "failed": [dates]}."""
    token = _token()
    CACHE.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    log(f"  IMERG: asking NASA which days exist between {start} and {end} ...")
    granules = list_granules(start, end, session)
    todo = {d: t for d, t in granules.items() if not (CACHE / f"{d:%Y%m%d}.npy").exists()}
    log(f"  IMERG: {len(granules)} days exist, {len(granules) - len(todo)} already cached, {len(todo)} to download")
    lons, lats = grid()
    (CACHE / "imerg_grid.json").write_text(json.dumps({"lon": lons.tolist(), "lat": lats.tolist(), "unit": "mm/day",
                                                       "source": "NASA GPM IMERG V07 daily Late run (GPM_3IMERGDL)"}), encoding="utf-8")
    failed, done = [], 0

    def one(item):
        d, title = item
        arr = fetch_day(title, token, requests.Session())
        np.save(CACHE / f"{d:%Y%m%d}.npy", arr)
        return d

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(one, it): it[0] for it in sorted(todo.items())}
        for f in as_completed(futures):
            d = futures[f]
            try:
                f.result()
                done += 1
                if done % 200 == 0:
                    log(f"  IMERG: {done} of {len(todo)} downloaded")
            except ImergNotAvailable:
                pool.shutdown(wait=False, cancel_futures=True)
                raise
            except Exception as e:
                failed.append(d)
                log(f"  IMERG: {d} failed ({e})")
    return {"done": done, "cached": len(granules) - len(todo), "failed": sorted(failed)}


def load_series(lon, lat):
    """Daily IMERG at the grid cell nearest to (lon, lat), as {date: mm}. Only days really in the cache; NaN days are skipped."""
    lons, lats = grid()
    i, j = int(np.abs(lons - lon).argmin()), int(np.abs(lats - lat).argmin())
    out = {}
    for p in sorted(CACHE.glob("2*.npy")):
        v = np.load(p)[i, j]
        if np.isfinite(v):
            out[datetime.strptime(p.stem, "%Y%m%d").date()] = float(v)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--start", default="2001-01-01")
    ap.add_argument("--end", default=(date.today() - timedelta(days=1)).isoformat())
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    try:
        res = download(max(date.fromisoformat(a.start), FIRST_DAY), date.fromisoformat(a.end), a.workers)
    except ImergNotAvailable as e:
        sys.exit(str(e))
    print(f"done: {res['done']} new days, {res['cached']} were cached, {len(res['failed'])} failed")
    if res["failed"]:
        print("failed days (run again to retry):", res["failed"][:10], "..." if len(res["failed"]) > 10 else "")
