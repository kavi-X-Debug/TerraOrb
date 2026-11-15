"""
Country-level NASA data for the officer and research ends (data/national/*.json).

    .venv\\Scripts\\python pipeline\\national_nasa.py [fires] [grace]       (no argument = both)

  fires      NASA FIRMS active fires (MODIS, last 7 days, public CSV, no login): points inside Sri Lanka.
             No fires listed is a real answer ("none detected in 7 days"), not an error. Re-run daily.
  grace      NASA GRACE / GRACE-FO groundwater: JPL mascon land water thickness (cm, relative to 2004-2009), needs EARTHDATA_TOKEN.
             The grid is 0.5 degree but the real resolution is about 300 km, so Sri Lanka is roughly ONE measurement: a country-level
             signal (all stored water: soil, ground water, surface water), never for a single well or farm.
"""
import json
import statistics
import sys
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "national"
SL_BOX = (5.8, 9.95, 79.4, 82.0)                 # lat min, lat max, lon min, lon max
NOW = lambda: datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")   # noqa: E731


def save(name, doc):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print("wrote", f"data/national/{name}.json")


def fires():
    url = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_Asia_7d.csv"
    r = requests.get(url, timeout=120)
    if r.status_code != 200 or not r.text.startswith("latitude"):
        sys.exit(f"FIRMS did not return the fire list (HTTP {r.status_code}); nothing written.")
    head, *rows = r.text.strip().splitlines()
    col = {k: i for i, k in enumerate(head.split(","))}
    items = []
    for line in rows:
        p = line.split(",")
        lat, lon = float(p[col["latitude"]]), float(p[col["longitude"]])
        if SL_BOX[0] <= lat <= SL_BOX[1] and SL_BOX[2] <= lon <= SL_BOX[3]:
            items.append({"lat": lat, "lon": lon, "date": p[col["acq_date"]], "time_utc": p[col["acq_time"]], "frp_mw": float(p[col["frp"]]),
                          "confidence": int(p[col["confidence"]]), "daynight": p[col["daynight"]]})
    days = sorted({x["date"] for x in [{"date": q.split(",")[col["acq_date"]]} for q in rows]})
    save("fires", {"schema": "national-fires-1", "generated": NOW(), "demo": False,
                   "source": "NASA FIRMS, MODIS Collection 6.1 active fires (Terra and Aqua), last 7 days", "resolution": "1 km pixels",
                   "window": {"from": days[0] if days else None, "to": days[-1] if days else None}, "count": len(items), "items": items,
                   "note": "A fire point is a hot pixel seen by the satellite, not always a wildfire (can be burning stubble, a kiln or a hot roof). Small or short fires and fires under cloud are missed. Zero points means none detected."})


def grace():
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        sys.exit("EARTHDATA_TOKEN is not set (see AGENTS.md > Secrets).")
    import numpy as np
    import xarray as xr
    cache = ROOT / "pipeline" / "cache" / "grace"
    cache.mkdir(parents=True, exist_ok=True)
    f = cache / "GRCTellus_JPL_mascon.nc"
    g = requests.get("https://cmr.earthdata.nasa.gov/search/granules.json", params={"collection_concept_id": "C3195527175-POCLOUD", "page_size": 1, "sort_key": "-start_date"}, timeout=60).json()["feed"]["entry"][0]
    href = next(l["href"] for l in g["links"] if l["href"].startswith("https://archive.podaac") and l["href"].endswith(".nc"))
    marker = f.with_suffix(".src")                                       # remembers which file version is cached
    if not f.exists() or f.stat().st_size < 10_000_000 or not marker.exists() or marker.read_text() != href:
        r = requests.get(href, headers={"Authorization": f"Bearer {token}"}, stream=True, timeout=300)
        if r.status_code != 200:
            sys.exit(f"NASA refused the GRACE download (HTTP {r.status_code}).")
        with open(f, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
        marker.write_text(href)
    ds = xr.open_dataset(f, decode_times=False)
    lat, lon = ds["lat"].values, ds["lon"].values
    lon180 = np.where(lon > 180, lon - 360, lon)
    mask_lat = (lat >= SL_BOX[0]) & (lat <= SL_BOX[1]); mask_lon = (lon180 >= SL_BOX[2]) & (lon180 <= SL_BOX[3])
    lwe = ds["lwe_thickness"].values[:, mask_lat][:, :, mask_lon]                      # [time, lat, lon] in cm
    days = ds["time"].values                                                            # days since 2002-01-01
    base = datetime(2002, 1, 1)
    series = []
    for d, grid in zip(days, lwe):
        v = np.nanmean(grid)
        if np.isfinite(v):
            m = base + timedelta(days=float(d))
            series.append((f"{m.year}-{m.month:02d}", round(float(v), 2)))
    recent = [s for s in series if s[0] >= "2018-06"]
    last_m, last_v = series[-1]
    same = [v for m, v in series if m[5:] == last_m[5:] and "2018" <= m[:4] <= str(int(last_m[:4]) - 1)]
    save("grace", {"schema": "national-grace-1", "generated": NOW(), "demo": False,
                   "source": "NASA GRACE and GRACE-FO, JPL mascon solution RL06.3 v04 CRI (PO.DAAC): land water thickness, cm, relative to 2004-2009",
                   "resolution": "country-level: real resolution about 300 km, so Sri Lanka is about one measurement",
                   "box": list(SL_BOX), "unit": "cm of water", "series": recent,
                   "latest": {"month": last_m, "lwe_cm": last_v, "same_month_mean_2018_on_cm": round(statistics.mean(same), 2) if len(same) >= 3 else None},
                   "note": "Counts ALL stored water (soil, groundwater, rivers, tanks), not wells alone, and cannot show one farm or tank. Some months are missing (satellite gaps). Needs expert reading."})


if __name__ == "__main__":
    todo = sys.argv[1:] or ["fires", "grace"]
    for name in todo:
        {"fires": fires, "grace": grace}[name]()
