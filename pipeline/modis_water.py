"""
NASA MODIS evapotranspiration (ET) and land surface temperature (LST) for the farm planner's grid cells.

    .venv\\Scripts\\python pipeline\\modis_water.py        (no login needed; uses NASA's ORNL DAAC MODIS web service, like ndvi.py)

Products (both from NASA MODIS on the Terra satellite):
  MOD16A2GF  ET_500m, PET_500m  - water the land and plants lose, and the water they could lose, kg/m2 (= mm) per 8 days, 500 m.
                                  The gap-filled version lags about a year, so its newest value is from late last year.
  MOD11A2    LST_Day_1km        - ground surface temperature in the daytime, kelvin, 1 km, one value per 8 days (newest is a few weeks old).
                                  Only clear-sky, good-quality pixels count (QC_Day: bits 0-1 = 00 and error <= 2 K); a date with fewer than 3 such pixels is a gap.

For each cell centre listed in data/farm/index.json we take the block of pixels within `km_radius` of the centre, drop fill values and
use the MEDIAN. Gaps stay gaps. Output data/farm/modis_et_lst.json holds, per cell and calendar month, the usual value (2019 to the
year before the newest data) and the newest value with its difference from usual. A cell is area-level (about 50 km), not a field.
Downloads are cached in pipeline/cache/modis_water/ so a re-run only fetches new dates.
"""
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache" / "modis_water"
INDEX = ROOT / "data" / "farm" / "index.json"
OUT = ROOT / "data" / "farm" / "modis_et_lst.json"
URL = "https://modis.ornl.gov/rst/api/v1"
FIRST_YEAR = 2019
CHUNK = 10                      # the service allows at most 10 dates per request
KM = {"MOD16A2GF": 1, "MOD11A2": 1}
# product -> {band: (scale, lowest valid, highest valid)}  (fill values: ET 32761-32767, LST 0)
BANDS = {"MOD16A2GF": {"ET_500m": (0.1, -32767, 32760), "PET_500m": (0.1, -32767, 32760)},
         "MOD11A2": {"LST_Day_1km": (0.02, 1, 65534)}}
MIN_PIXELS = 4


def get_json(path, params):
    last = ""
    for attempt in range(4):
        try:
            r = requests.get(f"{URL}/{path}", params=params, timeout=90)
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = str(e)
        time.sleep(3 * (attempt + 1))
    sys.exit(f"the MODIS service failed ({path}: {last})")


def block_median(values, lo, hi, scale):
    ok = [v for v in values if lo <= v <= hi]
    return round(statistics.median(ok) * scale, 3) if len(ok) >= MIN_PIXELS else None


def fetch(product, band, lat, lon, cell_key):
    """{calendar_date: value or None} for one band at one point; cached per cell, product and band."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{product}_{band}_{cell_key}.json"
    obs = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    dates = [(d["calendar_date"], d["modis_date"]) for d in get_json(f"{product}/dates", {"latitude": lat, "longitude": lon})["dates"]
             if int(d["calendar_date"][:4]) >= FIRST_YEAR]
    missing = [d for d in dates if d[0] not in obs]
    scale, lo, hi = BANDS[product][band]
    for i in range(0, len(missing), CHUNK):
        part = missing[i:i + CHUNK]
        data = get_json(f"{product}/subset", {"latitude": lat, "longitude": lon, "band": band, "startDate": part[0][1], "endDate": part[-1][1],
                                              "kmAboveBelow": KM[product], "kmLeftRight": KM[product]})
        for row in data["subset"]:
            obs[row["calendar_date"]] = block_median(row["data"], lo, hi, scale)
        path.write_text(json.dumps(obs), encoding="utf-8")            # saved after every chunk: resumable
    return obs


def clear_pixel(qc):
    """True when a MOD11A2 QC_Day value says: LST produced with good quality (bits 0-1 = 00, not cloud, not no-data) and error of at most 2 K (bits 6-7 = 00 or 01)."""
    return (int(qc) & 0b11) == 0 and ((int(qc) >> 6) & 0b11) <= 1


def fetch_lst_clear(lat, lon, cell_key):
    """{calendar_date: day temperature in kelvin or None} using only clear-sky good-quality pixels (LST_Day_1km paired with QC_Day, pixel by pixel)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"MOD11A2_LSTclear_{cell_key}.json"
    obs = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    dates = [(d["calendar_date"], d["modis_date"]) for d in get_json("MOD11A2/dates", {"latitude": lat, "longitude": lon})["dates"]
             if int(d["calendar_date"][:4]) >= FIRST_YEAR]
    missing = [d for d in dates if d[0] not in obs]
    for i in range(0, len(missing), CHUNK):
        part = missing[i:i + CHUNK]
        rows = {}
        for band in ("LST_Day_1km", "QC_Day"):
            data = get_json("MOD11A2/subset", {"latitude": lat, "longitude": lon, "band": band, "startDate": part[0][1], "endDate": part[-1][1],
                                               "kmAboveBelow": KM["MOD11A2"], "kmLeftRight": KM["MOD11A2"]})
            rows[band] = {r["calendar_date"]: r["data"] for r in data["subset"]}
        for day, lst in rows["LST_Day_1km"].items():
            qc = rows["QC_Day"].get(day, [])
            good = [v for v, q in zip(lst, qc) if v > 0 and clear_pixel(q)]
            obs[day] = round(statistics.median(good) * 0.02, 3) if len(good) >= 3 else None
        path.write_text(json.dumps(obs), encoding="utf-8")            # saved after every chunk: resumable
    return obs


def monthly_usual(obs, newest_year, convert=lambda v: v):
    """{month: {mean, n}} from the years before the newest one; months with fewer than 6 values give None."""
    by = {m: [] for m in range(1, 13)}
    for d, v in obs.items():
        if v is not None and int(d[:4]) < newest_year:
            by[int(d[5:7])].append(convert(v))
    return {str(m): ({"mean": round(statistics.mean(x), 2), "n": len(x)} if len(x) >= 6 else None) for m, x in by.items()}


def newest(obs):
    got = sorted((d, v) for d, v in obs.items() if v is not None)
    return got[-1] if got else (None, None)


def build():
    cells = json.loads(INDEX.read_text(encoding="utf-8"))["cells"]
    jobs = [(c, p, b) for c in cells for p, bands in BANDS.items() for b in bands if b != "LST_Day_1km"]
    with ThreadPoolExecutor(3) as pool:
        got = list(pool.map(lambda j: fetch(j[1], j[2], j[0]["centre_lat"], j[0]["centre_lon"], j[0]["key"]), jobs))
    series = {(j[0]["key"], j[2]): g for j, g in zip(jobs, got)}
    with ThreadPoolExecutor(3) as pool:                                   # temperature: clear-sky pixels only
        lst_got = list(pool.map(lambda c: fetch_lst_clear(c["centre_lat"], c["centre_lon"], c["key"]), cells))
    for c, g in zip(cells, lst_got):
        series[(c["key"], "LST_Day_1km")] = g
    out = {}
    for c in cells:
        k = c["key"]
        et, pet, lst = series[(k, "ET_500m")], series[(k, "PET_500m")], series[(k, "LST_Day_1km")]
        cell = {}
        d, v = newest(et)
        if d:
            usual = monthly_usual(et, int(d[:4]))
            u = usual[str(int(d[5:7]))]
            pv = pet.get(d)
            cell["et"] = {"usual_by_month": usual, "latest": {"date": d, "mm_per_8days": v,
                          "pct_of_usual": round(100 * v / u["mean"]) if u and u["mean"] else None,
                          "et_over_pet": round(v / pv, 2) if pv else None}}
        d, v = newest(lst)
        if d:
            usual = monthly_usual(lst, int(d[:4]), lambda x: x - 273.15)
            u = usual[str(int(d[5:7]))]
            cell["lst"] = {"usual_by_month_c": usual, "latest": {"date": d, "day_c": round(v - 273.15, 1),
                           "diff_from_usual_c": round(v - 273.15 - u["mean"], 1) if u else None}}
        out[k] = cell
    doc = {"schema": "farm-modis-et-lst-1", "generated": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"), "demo": False,
           "source": "NASA MODIS Terra MOD16A2GF (evapotranspiration, 500 m, 8 days, gap-filled so about a year behind) and MOD11A2 (daytime land surface temperature, 1 km, 8 days, clear-sky good-quality pixels only), via NASA ORNL DAAC",
           "resolution": "area-level: median of pixels within 1 km of the cell centre", "usual_years": f"{FIRST_YEAR} to the year before the newest value",
           "note": "ET/PET below about 0.4 means the land is losing much less water than it could (dry soil or little cover); the cut-offs are drafts for expert review.",
           "cells": out}
    OUT.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} for {len(out)} cells")


if __name__ == "__main__":
    build()
