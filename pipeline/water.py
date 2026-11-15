"""
Tank water step of the TerraOrb pipeline
===============================================

    .venv\\Scripts\\python pipeline\\water.py --search-only   (no login needed: just count scenes)
    .venv\\Scripts\\python pipeline\\water.py                 (needs Earthdata login, see below)

For every tank in data/tanks.json this script:

  1. makes a polygon for the tank: data/polygons/<id>.geojson if it exists,
     otherwise a circle of water.buffer_m metres around the tank point;
  2. searches NASA's catalogue (CMR) for satellite scenes over the polygon since
     water.start_date (skipping only tiles reported as completely cloudy);
  3. measures the water area (hectares) inside the polygon in every scene, skipping
     scenes where max_polygon_cloud_fraction (30 %) or more of the polygon is cloud,
     cloud shadow or missing;
       preferred: NASA OPERA DSWx-HLS (ready-made water map),
       fallback:  NASA HLS surface reflectance, NDWI = (Green - NIR) / (Green + NIR) > 0;
  4. takes the median area per month, the normal for each calendar month, and T;
  5. writes the "water" section of data/tank/<id>.json (nothing else is touched);
  6. saves a PNG chart per tank in pipeline/output/ for checking by eye.

Earthdata login (free account at https://urs.earthdata.nasa.gov) is read from
environment variables, never from a file in the repo:
    EARTHDATA_TOKEN                          (a token from your Earthdata profile), or
    EARTHDATA_USERNAME and EARTHDATA_PASSWORD

If login or reading a file fails, the script stops before writing anything.
Settings: [water] in pipeline/config.toml.  Output format: docs/schema.md §3.1.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tomllib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

import numpy as np
import requests

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
CACHE_DIR = PIPELINE / "cache" / "water"
OUTPUT_DIR = PIPELINE / "output"
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
TOKEN_URL = "https://urs.earthdata.nasa.gov/api/users/find_or_create_token"


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def stop(message):
    sys.exit(f"STOPPED: {message}\nNothing was written.")


# ===========================================================================
# 1. Earthdata login (environment variables only)
# ===========================================================================
def earthdata_token():
    token = os.environ.get("EARTHDATA_TOKEN")
    if token:
        return token
    user, password = os.environ.get("EARTHDATA_USERNAME"), os.environ.get("EARTHDATA_PASSWORD")
    if not (user and password):
        stop("no Earthdata login found. Set EARTHDATA_TOKEN, or EARTHDATA_USERNAME and "
             "EARTHDATA_PASSWORD, as environment variables (see the top of water.py).")
    try:
        response = requests.post(TOKEN_URL, auth=(user, password), timeout=60)
    except requests.RequestException as err:
        stop(f"could not reach Earthdata login: {err}")
    if response.status_code != 200 or "access_token" not in response.text:
        stop(f"Earthdata login failed (HTTP {response.status_code}). Check the username and password.")
    return response.json()["access_token"]


# ===========================================================================
# 2. Tank polygon (lon/lat)
# ===========================================================================
def tank_polygon(tank, cfg):
    """Return (shapely polygon in lon/lat, short description of where it came from)."""
    import shapely
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    from shapely.ops import unary_union

    path = REPO / cfg["water"]["polygons_dir"] / f"{tank['id']}.geojson"
    if path.exists():
        gj = json.loads(path.read_text(encoding="utf-8"))
        features = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
        geoms = [shape(f["geometry"] if "geometry" in f else f) for f in features]
        return unary_union(geoms), f"{cfg['water']['polygons_dir']}/{path.name}"

    # A circle drawn in metres: project to a flat map centred on the tank, buffer, project back.
    local = f"+proj=aeqd +lat_0={tank['lat']} +lon_0={tank['lon']} +datum=WGS84 +units=m"
    to_local = Transformer.from_crs("EPSG:4326", local, always_xy=True).transform
    to_lonlat = Transformer.from_crs(local, "EPSG:4326", always_xy=True).transform
    centre = shapely.transform(Point(tank["lon"], tank["lat"]), to_local, interleaved=False)
    circle = centre.buffer(cfg["water"]["buffer_m"])
    return shapely.transform(circle, to_lonlat, interleaved=False), f"circle, radius {cfg['water']['buffer_m']} m around the tank point"


def polygon_key(polygon):
    """Short fingerprint of the polygon, so cached results are redone if the polygon changes."""
    return hashlib.sha1(polygon.wkt.encode()).hexdigest()[:10]


# ===========================================================================
# 3. Scene search (NASA CMR; no login needed)
# ===========================================================================
def cmr_search(short_name, polygon, start, end):
    """All granules of a collection over the polygon's bounding box between start and end."""
    west, south, east, north = polygon.bounds
    params = {
        "short_name": short_name,
        "bounding_box": f"{west},{south},{east},{north}",
        "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z",
        "page_size": 2000,
        "sort_key": "start_date",
    }
    items, headers = [], {}
    while True:
        try:
            response = requests.get(CMR_URL, params=params, headers=headers, timeout=120)
        except requests.RequestException as err:
            stop(f"could not search NASA CMR for {short_name}: {err}")
        if response.status_code != 200:
            stop(f"NASA CMR search for {short_name} returned HTTP {response.status_code}: {response.text[:300]}")
        page = response.json()["items"]
        items.extend(page)
        after = response.headers.get("CMR-Search-After")
        if not page or not after or len(page) < params["page_size"]:
            return items
        headers = {"CMR-Search-After": after}


def attribute(umm, *names):
    for a in umm.get("AdditionalAttributes", []):
        if a["Name"] in names and a.get("Values"):
            return a["Values"][0]
    return None


def footprint(umm):
    """The granule's outline as a shapely polygon (lon/lat), or None if CMR doesn't give one."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    try:
        polys = umm["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"]
    except KeyError:
        return None
    shapes = [Polygon([(p["Longitude"], p["Latitude"]) for p in g["Boundary"]["Points"]]) for g in polys]
    return unary_union(shapes) if shapes else None


def https_urls(umm):
    return [u["URL"] for u in umm.get("RelatedUrls", []) if u["URL"].startswith("https://")]


def to_scene(item, product, cfg):
    """Turn one CMR item into a small dict, or None if it's unusable."""
    umm = item["umm"]
    when = umm["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
    cloud = umm.get("CloudCover")
    if cloud is None:
        cloud = attribute(umm, "CloudCoverage", "CLOUD_COVERAGE")
    scene = {
        "id": umm["GranuleUR"],
        "date": when,
        "cloud_percent": None if cloud is None else float(cloud),
        "footprint": footprint(umm),
        "product": product,
    }
    urls = https_urls(umm)
    if product == "DSWX":
        wtr = [u for u in urls if u.endswith("_WTR.tif")]
        if not wtr:
            return None
        scene["urls"] = {"wtr": wtr[0]}
        # GranuleUR: OPERA_L3_DSWx-HLS_<tile>_<acquired>_<produced>_<sensor>_30_<version>
        parts = umm["GranuleUR"].split("_")
        scene.update(tile=parts[3], acquired=parts[4], produced=parts[5], sensor=parts[6])
    else:
        bands = cfg["water"]["hls"]["products"][product]
        wanted = {"green": bands["green"], "nir": bands["nir"], "fmask": "Fmask"}
        found = {k: next((u for u in urls if u.endswith(f".{b}.tif")), None) for k, b in wanted.items()}
        if None in found.values():
            return None
        scene["urls"] = found
        # GranuleUR: HLS.L30.<tile>.<acquired>.v2.0
        parts = umm["GranuleUR"].split(".")
        scene.update(tile=parts[2], acquired=parts[3], produced="", sensor=parts[1])
    return scene


def select_scenes(scenes, polygon, max_cloud):
    """Keep clear scenes that cover the whole polygon; one scene per date and sensor.

    Also drops older reprocessed copies of the same DSWx scene (same tile and time,
    earlier production date).
    """
    latest = {}
    for s in scenes:
        if s is None or s["cloud_percent"] is None or s["cloud_percent"] >= max_cloud:
            continue
        if s["footprint"] is not None and not s["footprint"].contains(polygon):
            continue
        key = (s["tile"], s["acquired"], s["sensor"])
        if key not in latest or s["produced"] > latest[key]["produced"]:
            latest[key] = s
    # Neighbouring tiles overlap, so the same pass can appear twice: keep one per date + sensor.
    one_per_pass = {}
    for s in sorted(latest.values(), key=lambda s: (s["date"], s["tile"])):
        one_per_pass.setdefault((s["date"], s["sensor"]), s)
    return sorted(one_per_pass.values(), key=lambda s: s["date"])


def find_scenes(kind, polygon, today, cfg):
    start = cfg["water"]["start_date"]
    max_cloud = cfg["water"]["max_tile_cloud_percent"]
    if kind == "DSWX":
        items = cmr_search(cfg["water"]["dswx"]["short_name"], polygon, start, today.isoformat())
        raw = [to_scene(i, "DSWX", cfg) for i in items]
    else:
        raw = []
        for product in cfg["water"]["hls"]["products"]:
            items = cmr_search(product, polygon, start, today.isoformat())
            raw += [to_scene(i, product, cfg) for i in items]
    return len(raw), select_scenes(raw, polygon, max_cloud)


# ===========================================================================
# 4. Measuring one scene
# ===========================================================================
def dswx_area(wtr, inside, pixel_area_m2, water_values, bad_values):
    """Water area (ha) and bad-pixel share inside the polygon, from a DSWx WTR layer.

    wtr:    2-D array of DSWx classes;  inside: True for pixels inside the polygon.
    """
    n_inside = int(inside.sum())
    if n_inside == 0:
        return None, 1.0
    bad = np.isin(wtr, bad_values) & inside
    water = np.isin(wtr, water_values) & inside
    return float(water.sum()) * pixel_area_m2 / 10_000, float(bad.sum()) / n_inside


def ndwi_area(green, nir, fmask, inside, pixel_area_m2, threshold, fill_value, bad_bits):
    """Water area (ha) and bad-pixel share inside the polygon, from HLS bands.

    NDWI = (Green - NIR) / (Green + NIR); water where NDWI > threshold.
    Bad = missing (fill value) or flagged in Fmask (cloud, next to cloud, shadow).
    The 0.0001 reflectance scale cancels out in the ratio, so raw numbers are fine.
    """
    n_inside = int(inside.sum())
    if n_inside == 0:
        return None, 1.0
    g = green.astype("float64")
    n = nir.astype("float64")
    missing = (green == fill_value) | (nir == fill_value)
    flagged = np.zeros(fmask.shape, dtype=bool)
    for bit in bad_bits:
        flagged |= ((fmask.astype("uint8") >> bit) & 1).astype(bool)
    bad = (missing | flagged) & inside
    with np.errstate(divide="ignore", invalid="ignore"):
        ndwi = np.where(g + n == 0, np.nan, (g - n) / (g + n))
    water = (ndwi > threshold) & inside & ~bad
    return float(water.sum()) * pixel_area_m2 / 10_000, float(bad.sum()) / n_inside


_TOKEN = None        # set in main(); used only to ask NASA where a file really lives


def resolve_url(url):
    """Follow NASA's redirect with our login and return the final download link.

    NASA answers with a redirect to a storage server (CloudFront / S3). `requests` drops the login
    header on that hop, which is what the storage server wants. GDAL would send it along and be
    refused ("not recognized as being in a supported file format"), so we resolve the link first
    and give GDAL the final one, which needs no login.
    """
    if not url.startswith("http"):
        return url                                     # a local file (tests): nothing to resolve
    try:
        response = requests.get(url, headers={"Authorization": f"Bearer {_TOKEN}"}, stream=True, timeout=60)
    except requests.RequestException as err:
        stop(f"could not reach NASA Earthdata for {url}: {err}")
    final = response.url
    ok = response.status_code == 200
    response.close()                                   # we only wanted the address, not the file
    if not ok:
        stop(f"NASA Earthdata answered HTTP {response.status_code} for {url}. Check the login and that your account "
             "has authorized the PO.DAAC (Cumulus) and LP DAAC applications.")
    return final


def read_window(url, polygon, fill):
    """Read the pixels around the polygon from a cloud-hosted GeoTIFF.

    Returns (pixels, inside-mask, pixel area in m²). Needs an open rasterio.Env with login.
    """
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.warp import transform_geom
    from rasterio.windows import Window, from_bounds
    from shapely.geometry import mapping, shape

    with rasterio.open(resolve_url(url)) as ds:
        geom = transform_geom("EPSG:4326", ds.crs, mapping(polygon))
        w = from_bounds(*shape(geom).bounds, transform=ds.transform)
        window = Window(math.floor(w.col_off), math.floor(w.row_off),
                        math.ceil(w.width) + 1, math.ceil(w.height) + 1)
        pixels = ds.read(1, window=window, boundless=True, fill_value=fill)
        win_transform = ds.window_transform(window)
    inside = geometry_mask([geom], out_shape=pixels.shape, transform=win_transform, invert=True)
    return pixels, inside, abs(win_transform.a * win_transform.e)


def measure(scene, polygon, cfg):
    """Water area for one scene: {"area_ha", "bad_fraction"}. Results are cached."""
    path = CACHE_DIR / f"{scene['id']}__{polygon_key(polygon)}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    import rasterio
    try:
        if scene["product"] == "DSWX":
            d = cfg["water"]["dswx"]
            wtr, inside, px = read_window(scene["urls"]["wtr"], polygon, fill=255)
            area, bad = dswx_area(wtr, inside, px, d["water_values"], d["bad_values"])
        else:
            h = cfg["water"]["hls"]
            green, inside, px = read_window(scene["urls"]["green"], polygon, fill=h["fill_value"])
            nir, _, _ = read_window(scene["urls"]["nir"], polygon, fill=h["fill_value"])
            fmask, _, _ = read_window(scene["urls"]["fmask"], polygon, fill=255)
            area, bad = ndwi_area(green, nir, fmask, inside, px, h["ndwi_threshold"],
                                  h["fill_value"], h["fmask_bad_bits"])
    except rasterio.errors.RasterioIOError as err:
        stop(f"could not read {scene['id']} from NASA Earthdata: {err}\n"
             "Check the Earthdata login, and that your account has accepted the "
             "LP DAAC / PO.DAAC data use terms.")

    result = {"date": scene["date"], "area_ha": None if area is None else round(area, 2),
              "bad_fraction": round(bad, 3)}
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result), encoding="utf-8")
    return result


# ===========================================================================
# 5. Monthly medians, normal and T  (pure functions)
# ===========================================================================
def ratio(a, b):
    if a is None or b in (None, 0):
        return None
    return round(a / b, 2)


def monthly_series(measurements):
    """Median area per calendar month, with every month from first to last listed.

    measurements: [{"date": "YYYY-MM-DD", "area_ha": float}, ...]  (usable scenes only)
    Returns [{"date": "YYYY-MM-01", "extent_ha": float|None, "scenes": int}, ...]
    """
    by_month = {}
    for m in measurements:
        by_month.setdefault(m["date"][:7], []).append(m["area_ha"])
    if not by_month:
        return []
    first, last = min(by_month), max(by_month)
    year, month = int(first[:4]), int(first[5:])
    series = []
    while f"{year}-{month:02d}" <= last:
        key = f"{year}-{month:02d}"
        values = by_month.get(key, [])
        series.append({"date": f"{key}-01",
                       "extent_ha": round(median(values), 1) if values else None,
                       "scenes": len(values)})
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return series


def current_and_normal(series, measurements):
    """Latest month with data = "current"; normal = mean of the same calendar month in OTHER years.

    The current year's value is left out of its own normal, so "now" isn't compared with itself.
    """
    with_data = [s for s in series if s["extent_ha"] is not None]
    if not with_data:
        return None
    cur = with_data[-1]
    month = cur["date"][5:7]
    others = [s for s in with_data if s["date"][5:7] == month and s["date"][:4] != cur["date"][:4]]
    normal = round(sum(s["extent_ha"] for s in others) / len(others), 1) if others else None
    years = sorted(s["date"][:4] for s in others)
    last_scene = max(m["date"] for m in measurements if m["date"][:7] == cur["date"][:7])
    return {
        "current_date": last_scene,
        "current_extent_ha": cur["extent_ha"],
        "normal_extent_ha": normal,
        "normal_period": f"{years[0]}–{years[-1]} ({len(years)} years with data)" if years else None,
        "T": ratio(cur["extent_ha"], normal),
    }


# ===========================================================================
# 6. Per tank
# ===========================================================================
def measure_all(scenes, polygon, cfg, label):
    usable, skipped_cloud = [], 0
    for i, scene in enumerate(scenes, 1):
        if i % 50 == 0 or i == len(scenes):
            print(f"    {label}: {i}/{len(scenes)} scenes", flush=True)
        r = measure(scene, polygon, cfg)
        # Keep only scenes with LESS than max_polygon_cloud_fraction cloud/missing over the tank.
        if r["area_ha"] is None or r["bad_fraction"] >= cfg["water"]["max_polygon_cloud_fraction"]:
            skipped_cloud += 1
            continue
        usable.append(r)
    return usable, skipped_cloud


def process_tank(tank, today, cfg):
    polygon, polygon_note = tank_polygon(tank, cfg)
    print(f"\n{tank['id']}: polygon = {polygon_note}")

    n_raw, dswx = find_scenes("DSWX", polygon, today, cfg)
    print(f"  DSWx: {n_raw} scenes found, {len(dswx)} not fully cloudy and covering the polygon")
    usable, skipped = measure_all(dswx, polygon, cfg, "DSWx") if dswx else ([], 0)
    series = monthly_series(usable)
    months = sum(1 for s in series if s["extent_ha"] is not None)
    method, label = "DSWx", cfg["water"]["dswx"]["label"]

    if months < cfg["water"]["min_months_for_dswx"]:
        print(f"  DSWx gave only {months} months with data (< {cfg['water']['min_months_for_dswx']}); "
              "using HLS NDWI instead")
        n_raw, hls = find_scenes("HLS", polygon, today, cfg)
        print(f"  HLS: {n_raw} scenes found, {len(hls)} not fully cloudy and covering the polygon")
        usable, skipped = measure_all(hls, polygon, cfg, "HLS")
        series = monthly_series(usable)
        method, label = "HLS NDWI", cfg["water"]["hls"]["label"]

    summary = current_and_normal(series, usable)
    if summary is None:
        stop(f"no usable satellite scene for {tank['id']} (all cloudy or outside coverage).")

    section = {
        "series": series,
        **summary,
        "polygon": polygon_note,
        "source": label,
        "demo": tank["demo"],          # a demo tank's location is a placeholder
    }
    stats = {"method": method, "usable": len(usable), "skipped_cloud": skipped}
    return section, usable, stats


def write_tank_file(tank, water_section, now):
    """Replace only the water section; keep everything else as it was."""
    path = REPO / "data" / "tank" / f"{tank['id']}.json"
    if path.exists():
        doc = json.loads(path.read_text(encoding="utf-8"))
    else:
        doc = {"schema_version": "1.2", "id": tank["id"], "generated": now, "demo": False,
               "water": None, "rain": None, "soil": None, "elnino": None, "result": None}
    doc["schema_version"] = "1.2"
    doc["water"] = water_section
    doc["generated"] = now
    doc["demo"] = any(isinstance(doc.get(k), dict) and doc[k].get("demo")
                      for k in ("water", "rain", "soil", "elnino", "result"))
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return doc


# ===========================================================================
# 7. Chart for checking by eye
# ===========================================================================
def save_chart(tank, section, usable, path):
    import matplotlib
    matplotlib.use("Agg")                      # draw to a file, no window
    import matplotlib.pyplot as plt

    series = section["series"]
    months = [datetime.fromisoformat(s["date"]) for s in series]
    medians = [np.nan if s["extent_ha"] is None else s["extent_ha"] for s in series]

    # Normal for each calendar month (mean of all years), drawn under the series.
    by_cal = {}
    for s in series:
        if s["extent_ha"] is not None:
            by_cal.setdefault(s["date"][5:7], []).append(s["extent_ha"])
    normal_line = [np.mean(by_cal[s["date"][5:7]]) if s["date"][5:7] in by_cal else np.nan for s in series]

    fig, ax = plt.subplots(figsize=(11, 4.5))
    ax.scatter([datetime.fromisoformat(u["date"]) for u in usable], [u["area_ha"] for u in usable],
               s=8, color="#9aa5b1", label="Each clear scene")
    ax.plot(months, normal_line, color="#e08a00", linestyle="--", linewidth=1,
            label="Mean for the calendar month (all years)")
    ax.plot(months, medians, color="#1f6fb2", linewidth=1.6, marker="o", markersize=2.5, label="Monthly median")
    if section["current_extent_ha"] is not None:
        ax.scatter([datetime.fromisoformat(section["current_date"])], [section["current_extent_ha"]],
                   s=60, color="#c0392b", zorder=5, label=f"Now: T = {section['T']}")
    ax.set_ylabel("Water area (ha)")
    demo = "  [DEMO TANK: placeholder location]" if tank["demo"] else ""
    ax.set_title(f"{tank['name_en']} ({tank['id']}){demo}\nSource: {section['source']} · {section['polygon']}",
                 fontsize=10)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8, loc="upper left")
    fig.tight_layout()
    path.parent.mkdir(exist_ok=True)
    fig.savefig(path, dpi=120)
    plt.close(fig)


# ===========================================================================
# 8. Main
# ===========================================================================
def search_only(tanks, today, cfg):
    """Count scenes per tank without logging in or reading any pixels."""
    for tank in tanks:
        polygon, note = tank_polygon(tank, cfg)
        print(f"\n{tank['id']}: polygon = {note}")
        for kind in ("DSWX", "HLS"):
            n_raw, scenes = find_scenes(kind, polygon, today, cfg)
            per_year = {}
            for s in scenes:
                per_year[s["date"][:4]] = per_year.get(s["date"][:4], 0) + 1
            print(f"  {kind}: {n_raw} found, {len(scenes)} to read (one per pass, covering the polygon, "
                  f"tile not 100% cloudy); cloud over the tank is checked when reading")
            print(f"    per year: {dict(sorted(per_year.items()))}")


def main():
    parser = argparse.ArgumentParser(description="TerraOrb tank water step.")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today())
    parser.add_argument("--search-only", action="store_true",
                        help="only count scenes (no login, nothing written)")
    parser.add_argument("--only", default="",
                        help="comma-separated tank ids to measure (default: all real, non-demo tanks)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    # Demo tanks sit at placeholder points, so measuring "their" water would mean nothing.
    tanks = [t for t in tanks if not t.get("demo")]
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        unknown = wanted - {t["id"] for t in tanks}
        if unknown:
            stop(f"unknown tank id(s): {', '.join(sorted(unknown))}")
        tanks = [t for t in tanks if t["id"] in wanted]

    if args.search_only:
        search_only(tanks, args.today, cfg)
        return

    import rasterio
    global _TOKEN
    _TOKEN = earthdata_token()                # stops here if there's no login
    gdal_env = rasterio.Env(                  # no login header here: see resolve_url()
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",       # don't list S3 folders
        GDAL_HTTP_MAX_RETRY="3",
        GDAL_HTTP_RETRY_DELAY="2",
    )

    # Measure everything first, so a failure writes nothing.
    results = []
    with gdal_env:
        for tank in tanks:
            results.append((tank, *process_tank(tank, args.today, cfg)))

    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()
    for tank, section, usable, stats in results:
        write_tank_file(tank, section, now)
        chart = OUTPUT_DIR / f"water_{tank['id']}.png"
        save_chart(tank, section, usable, chart)
        print(f"\n=== {tank['id']}: {stats['method']}, {stats['usable']} usable scenes "
              f"({stats['skipped_cloud']} skipped: cloud over the tank)")
        print(f"  now ({section['current_date']}): {section['current_extent_ha']} ha   "
              f"normal: {section['normal_extent_ha']} ha [{section['normal_period']}]   T = {section['T']}")
        print(f"  chart: {chart.relative_to(REPO)}")
        months_old = (args.today - date.fromisoformat(section["current_date"])).days
        if months_old > 45:
            print(f"  NOTE: the latest clear scene is {months_old} days old.")
    print(f"\nWrote the water section for {len(results)} tank(s) in data/tank/.")


if __name__ == "__main__":
    main()
