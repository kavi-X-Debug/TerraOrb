"""
NASA SMAP soil moisture (L3, daily, 9 km): the real satellite measurement of the top 5 cm of soil.

    .venv\\Scripts\\python pipeline\\smap.py          (needs EARTHDATA_TOKEN in the environment; resumable)

Product SPL3SMP_E v006 (NSIDC DAAC): morning (6 am, descending) pass only, which NASA recommends. Only pixels whose retrieval flag
says "recommended quality" are kept; days with cloud-free but frozen, flooded or heavily vegetated pixels simply have gaps and gaps stay
gaps. A global file is huge, so we ask NASA's OPeNDAP service for only the box around Sri Lanka (about 25 KB a day). The 9 km EASE-Grid 2.0
row/column of a place is computed from its latitude and longitude (formulas of the grid), and checked against the file's own coordinates.

Output data/farm/smap.json, for each farm grid cell centre (data/farm/index.json) and each tank (data/tanks.json):
  usual   - mean of each calendar month over the years before the newest, with the number of values behind it (months with < 10 values: null)
  latest  - mean of the valid values in the last 30 days, how many there were, and its difference from the usual month in standard deviations
A place takes the median of the valid pixels within RADIUS_DEG of it. Values are volume of water per volume of soil (m3/m3), about 0.05 (dry)
to 0.5 (saturated). It is area-level (9 km pixels), not the field.
"""
import io
import json
import math
import os
import statistics
import sys
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache" / "smap"
OUT = ROOT / "data" / "farm" / "smap.json"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
COLLECTION = "C2938664763-NSIDC_CPRD"                       # SPL3SMP_E v006
OPENDAP = f"https://opendap.earthdata.nasa.gov/collections/{COLLECTION}/granules/"
GROUP = "Soil_Moisture_Retrieval_Data_AM"
START = date(2021, 1, 1)                                    # five full years of "usual" (about 20 valid days a month, enough); earlier days are not needed
RADIUS_DEG = 0.15
PHASE_TANKS = set(tomllib.loads((ROOT / "pipeline" / "config.toml").read_text(encoding="utf-8"))["farm"]["phase_tanks"])   # this phase: five tanks only
# EASE-Grid 2.0 global, 9 km (EPSG:6933): cell size, upper-left corner and sphere radius
R, DX, X0, Y0 = 6378137.0, 9008.05, -17367530.45, 7314540.83
BOX = (10.2, 5.4, 79.1, 82.4)                               # lat max, lat min, lon min, lon max


def rowcol(lat, lon):
    x = R * math.radians(lon) * math.cos(math.radians(30))
    y = R * math.sin(math.radians(lat)) / math.cos(math.radians(30))
    return int((Y0 - y) // DX), int((x - X0) // DX)


R0, C0 = rowcol(BOX[0], BOX[2])
R1, C1 = rowcol(BOX[1], BOX[3])


def list_granules():
    out, page = {}, 1
    while True:
        r = requests.get(CMR, params={"collection_concept_id": COLLECTION, "temporal": f"{START.isoformat()}T00:00:00Z,",
                                      "page_size": 2000, "page_num": page}, timeout=120)
        r.raise_for_status()
        ents = r.json()["feed"]["entry"]
        if not ents:
            return dict(sorted(out.items()))
        for e in ents:
            out[e["time_start"][:10]] = e["title"]
        page += 1


def fetch_day(day, title, token):
    path = CACHE / f"{day.replace('-', '')}.npz"
    if path.exists():
        return True
    ce = ";".join(f"/{GROUP}/{v}[{R0}:{R1}][{C0}:{C1}]" for v in ("soil_moisture", "latitude", "longitude", "retrieval_qual_flag"))
    url = OPENDAP + quote(title, safe="") + ".dap.nc4?dap4.ce=" + ce
    import xarray as xr
    for attempt in range(4):
        try:
            r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=120)
            if r.status_code in (401, 403):
                raise SystemExit(f"NASA refused the token (HTTP {r.status_code}).")
            if r.status_code == 200 and r.content[:4] == b"\x89HDF":
                ds = xr.open_dataset(io.BytesIO(r.content), engine="h5netcdf", group=GROUP)
                sm, flag = ds["soil_moisture"].values.astype("float32"), ds["retrieval_qual_flag"].values
                la, lo = ds["latitude"].values.astype("float32"), ds["longitude"].values.astype("float32")
                ds.close()
                good = np.isfinite(sm) & (sm > 0) & ((flag.astype("int64") & 1) == 0) & (la > -999)
                np.savez_compressed(path, sm=np.where(good, sm, np.nan).astype("float32"), la=la, lo=lo)
                return True
        except SystemExit:
            raise
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
    return False


def places():
    idx = json.loads((ROOT / "data" / "farm" / "index.json").read_text(encoding="utf-8"))["cells"]
    tanks = json.loads((ROOT / "data" / "tanks.json").read_text(encoding="utf-8"))
    tanks = tanks["tanks"] if isinstance(tanks, dict) else tanks
    tanks = [x for x in tanks if x["id"] in PHASE_TANKS]
    return ([("cell", c["key"], c["centre_lat"], c["centre_lon"]) for c in idx], [("tank", t["id"], t["lat"], t["lon"]) for t in tanks])


def build():
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        sys.exit("EARTHDATA_TOKEN is not set (see AGENTS.md > Secrets).")
    CACHE.mkdir(parents=True, exist_ok=True)
    granules = list_granules()
    print(f"{len(granules)} daily files from {next(iter(granules))} to {next(reversed(granules))}", flush=True)
    todo = [(d, t) for d, t in granules.items() if not (CACHE / f"{d.replace('-', '')}.npz").exists()]
    done = 0
    with ThreadPoolExecutor(14) as pool:
        for ok in pool.map(lambda x: fetch_day(x[0], x[1], token), todo):
            done += 1
            if done % 250 == 0:
                print(f"  {done}/{len(todo)} fetched", flush=True)
    days = [d for d in granules if (CACHE / f"{d.replace('-', '')}.npz").exists()]
    first = np.load(CACHE / f"{days[0].replace('-', '')}.npz")
    la, lo = first["la"], first["lo"]
    stack = np.stack([np.load(CACHE / f"{d.replace('-', '')}.npz")["sm"] for d in days])        # [days, rows, cols]
    # the grid is fixed, so lat/lon are the same every day; a pixel with no coordinates on the first day is filled from any other day
    for d in days[1:40]:
        z = np.load(CACHE / f"{d.replace('-', '')}.npz")
        miss = la <= -999
        la, lo = np.where(miss, z["la"], la), np.where(miss, z["lo"], lo)
    years = np.array([int(d[:4]) for d in days]); months = np.array([int(d[5:7]) for d in days])
    newest_day = date.fromisoformat(days[-1]); newest_year = int(years[-1])
    recent = np.array([(newest_day - date.fromisoformat(d)).days < 30 for d in days])

    def one(kind, key, plat, plon):
        near = (np.abs(la - plat) <= RADIUS_DEG) & (np.abs(lo - plon) <= RADIUS_DEG) & (la > -999)
        if not near.any():
            return None
        series = np.array([np.nanmedian(s[near]) if np.isfinite(s[near]).any() else np.nan for s in stack])
        usual = {}
        for m in range(1, 13):
            v = series[(months == m) & (years < newest_year) & np.isfinite(series)]
            usual[str(m)] = {"mean": round(float(v.mean()), 3), "sd": round(float(v.std(ddof=1)), 3), "n": int(len(v))} if len(v) >= 10 else None
        rec = series[recent & np.isfinite(series)]
        out = {"usual_by_month": usual, "latest": {"to": days[-1], "n_values": int(len(rec))}}
        if len(rec) >= 3:
            mean = float(rec.mean())
            u = usual[str(newest_day.month)]
            out["latest"].update(mean_m3m3=round(mean, 3), z=round((mean - u["mean"]) / u["sd"], 2) if u and u["sd"] else None,
                                 pct_of_usual=round(100 * mean / u["mean"]) if u and u["mean"] else None)
        return out

    cells_, tanks_ = places()
    doc = {"schema": "farm-smap-1", "generated": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"), "demo": False,
           "source": "NASA SMAP L3 SPL3SMP_E v006 daily soil moisture, 9 km, morning pass, recommended-quality pixels only (NSIDC DAAC)",
           "unit": "m3/m3 (volume of water per volume of soil, top 5 cm)", "resolution": "area-level: median of pixels within 0.15 degree (about 16 km)",
           "usual_years": f"{START.year} to {newest_year - 1}", "days_used": len(days), "newest_day": days[-1],
           "note": "SMAP cannot see through dense forest, over water or frozen ground, and misses days; gaps are left as gaps. The 'drier / wetter' cut-offs are drafts.",
           "cells": {k: v for kind, k, a, b in cells_ if (v := one(kind, k, a, b))},
           "tanks": {k: v for kind, k, a, b in tanks_ if (v := one(kind, k, a, b))}}
    OUT.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(doc['cells'])} cells, {len(doc['tanks'])} tanks, {len(days)} days")


if __name__ == "__main__":
    build()
