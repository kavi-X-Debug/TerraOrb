"""
Extra NASA data for the trip planner (data/trip/climate_extras.json and land_cover.json).

    .venv\\Scripts\\python -m pipeline.trip.extras            (no login needed; resumable cache in pipeline/cache/trip/extras/)

  climate_extras.json  NASA POWER (the same service as the rain history): the usual relative humidity, wind speed and sunlight energy of each
                       calendar month, 2001-2025, for every 0.5 x 0.625 degree square that holds a place. It tells a traveller how muggy,
                       windy and sunny a month usually is; it is NOT a forecast. (POWER's own UV index is not used: it is a daily
                       figure that does not show the midday peak, so sunburn advice keeps using the live UV from Open-Meteo.)
  land_cover.json      NASA MODIS MCD12Q1 land cover (IGBP classes, 500 m, newest year), from NASA's ORNL DAAC MODIS web service: what the
                       land within about 1 km of each place is (forest, cropland, urban, water...). It is the majority class of the pixels plus
                       the share, so a small town inside paddy may show as cropland; it says "around" the place, not "at" it.
"""
import json
import statistics
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "pipeline" / "cache" / "trip" / "extras"
DEST = ROOT / "data" / "trip" / "destinations.json"
OUT = ROOT / "data" / "trip"
POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
ORNL = "https://modis.ornl.gov/rst/api/v1"
PARAMS = {"RH2M": "relative_humidity_pct", "WS10M": "wind_speed_ms", "ALLSKY_SFC_SW_DWN": "sunlight_kwh_m2_day"}
YEARS = (2001, 2025)
IGBP = {1: "evergreen needleleaf forest", 2: "evergreen broadleaf forest", 3: "deciduous needleleaf forest", 4: "deciduous broadleaf forest", 5: "mixed forest",
        6: "closed shrubland", 7: "open shrubland", 8: "woody savanna", 9: "savanna", 10: "grassland", 11: "permanent wetland", 12: "cropland",
        13: "urban and built-up", 14: "cropland and natural vegetation mosaic", 15: "snow and ice", 16: "barren", 17: "water"}
# plain groups used by the web page text (keys lc.<group>)
GROUP = {1: "forest", 2: "forest", 3: "forest", 4: "forest", 5: "forest", 6: "shrub", 7: "shrub", 8: "savanna", 9: "savanna", 10: "grass", 11: "wetland",
         12: "crop", 13: "urban", 14: "mosaic", 15: "other", 16: "other", 17: "water"}


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def get(url, params, timeout=120):
    last = ""
    for attempt in range(7):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = str(e)[:80]
        time.sleep(4 * (attempt + 1))
    raise RuntimeError(f"{url} failed ({last})")


def square_centre(key):
    lat, lon = key.split("_")
    return float(lat), float(lon)


def monthly_climate(key):
    """{month: {param: mean}} for one POWER square, cached on disk."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"power_{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    lat, lon = square_centre(key)
    par = {p: {} for p in PARAMS}
    for y0 in range(YEARS[0], YEARS[1] + 1, 5):                     # five years per request: one 25-year request is often cut off by the service
        data = get(POWER, {"parameters": ",".join(PARAMS), "community": "AG", "latitude": lat, "longitude": lon, "start": f"{y0}0101", "end": f"{min(y0 + 4, YEARS[1])}1231", "format": "JSON"})
        for p, series in data["properties"]["parameter"].items():
            par[p].update(series)
    out = {}
    for m in range(1, 13):
        row = {}
        for p, name in PARAMS.items():
            vals = [v for d, v in par[p].items() if int(d[4:6]) == m and v > -900]          # -999 is POWER's missing value
            row[name] = round(statistics.mean(vals), 2) if len(vals) >= 300 else None
        out[str(m)] = row
    path.write_text(json.dumps(out), encoding="utf-8")
    return out


def land_cover(d):
    """Majority IGBP class around the place and its share, from the newest MCD12Q1 year (cached)."""
    path = CACHE / f"lc_{d['id']}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    pt = {"latitude": d["lat"], "longitude": d["lon"]}
    dates = get(f"{ORNL}/MCD12Q1/dates", pt)["dates"]
    last = dates[-1]
    sub = get(f"{ORNL}/MCD12Q1/subset", {**pt, "band": "LC_Type1", "startDate": last["modis_date"], "endDate": last["modis_date"], "kmAboveBelow": 1, "kmLeftRight": 1})
    pix = [v for v in sub["subset"][0]["data"] if v in IGBP]                               # 255 and other fill values are not classes
    if len(pix) < 4:
        res = None
    else:
        top = Counter(pix).most_common(2)
        res = {"year": int(last["calendar_date"][:4]), "class": top[0][0], "class_name": IGBP[top[0][0]], "group": GROUP[top[0][0]],
               "share_pct": round(100 * top[0][1] / len(pix)), "second": ({"class_name": IGBP[top[1][0]], "group": GROUP[top[1][0]], "share_pct": round(100 * top[1][1] / len(pix))} if len(top) > 1 else None),
               "pixels": len(pix)}
    path.write_text(json.dumps(res), encoding="utf-8")
    return res


def safe(fn, arg):
    """Run one download; a failure leaves that square or place empty (never filled in) and a re-run tries again from the cache."""
    try:
        res = fn(arg)
        time.sleep(0.7)                                              # be gentle with the free services
        return res
    except RuntimeError as e:
        print("skipped", arg if isinstance(arg, str) else arg.get("id"), "-", str(e)[:70], flush=True)
        return None


def build():
    dests = json.loads(DEST.read_text(encoding="utf-8"))["destinations"]
    cells = sorted({d["cell"] for d in dests})
    clim = {k: v for k in cells if (v := safe(monthly_climate, k))}
    for sq in clim.values():                                         # POWER (AG community) gives sunlight in MJ/m2/day; show kWh/m2/day (1 kWh = 3.6 MJ)
        for row in sq.values():
            if row.get("sunlight_kwh_m2_day") is not None:
                row["sunlight_kwh_m2_day"] = round(row["sunlight_kwh_m2_day"] / 3.6, 2)          # one at a time: POWER cuts off busy clients
    with ThreadPoolExecutor(4) as pool:
        lc = dict(zip([d["id"] for d in dests], pool.map(lambda d: safe(land_cover, d), dests)))
    (OUT / "climate_extras.json").write_text(json.dumps({
        "schema": "trip-climate-extras-1", "generated": now(), "demo": False,
        "source": "NASA POWER (MERRA-2 based) daily relative humidity at 2 m, wind speed at 10 m and all-sky sunlight energy, averaged by calendar month",
        "period": f"{YEARS[0]}-{YEARS[1]}", "resolution": "0.5 x 0.625 degree squares (about 50 km)", "units": {"relative_humidity_pct": "%", "wind_speed_ms": "m/s", "sunlight_kwh_m2_day": "kWh/m2/day"},
        "note": "Usual conditions, not a forecast. Area-level: a place on a hill or the coast can differ from its square.", "squares": clim}, ensure_ascii=False), encoding="utf-8")
    (OUT / "land_cover.json").write_text(json.dumps({
        "schema": "trip-land-cover-1", "generated": now(), "demo": False,
        "source": "NASA MODIS MCD12Q1 land cover (IGBP, 500 m), via NASA ORNL DAAC", "resolution": "majority of the 500 m pixels within about 1 km of the place",
        "note": "Describes the land around the place, not the place itself; small towns inside farmland can show as cropland.", "places": lc}, ensure_ascii=False), encoding="utf-8")
    missing = [k for k, v in lc.items() if v is None]
    print(f"climate for {len(clim)} of {len(cells)} squares, land cover for {len(lc) - len(missing)} of {len(lc)} places" + (f" (no value: {missing[:6]})" if missing else ""))


if __name__ == "__main__":
    try:
        build()
    except RuntimeError as e:
        sys.exit(str(e))
