"""
Places on the map: building destinations.json and reading terrain.

Everything here is a pure function except `fetch_tile` (which downloads and caches one AWS terrain tile).

* Coordinates come ONLY from data/places.json (30 well-known places) or from OpenStreetMap. Nothing is invented.
* kinds / activities / cost level follow the DRAFT tables in pipeline/config.toml ([trip.place_kinds],
  [trip.kind_activities], [trip.cost_level]); they are team assumptions, flagged as such in the output.
* Elevation and slope come from the AWS "terrarium" terrain tiles (a global DEM mosaic that includes SRTM).
"""

import io
import math
import re
import sys
import unicodedata
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402

LATIN = re.compile(r"[A-Za-z]")
NON_LATIN = re.compile(r"[^\x00-ɏ‐-‧]")          # anything outside Latin letters and common punctuation
SRI_LANKA_BOX = (5.8, 9.95, 79.4, 82.0)                            # lat_min, lat_max, lon_min, lon_max (a little wider than the island)
KINDS = ("beach", "hill", "waterfall", "wildlife", "culture", "city", "lake", "forest", "coast")


# ---------------------------------------------------------------------------
# Distances, names
# ---------------------------------------------------------------------------
def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def slugify(text):
    """ascii id: 'Diyaluma Falls' -> 'diyaluma-falls'."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def english_name(tags):
    """OSM name in Latin letters: name:en, else name if it is already Latin. None if there is none."""
    for key in ("name:en", "name"):
        v = (tags.get(key) or "").strip()
        if v and LATIN.search(v) and not NON_LATIN.search(v):
            return v
    return None


def sinhala_name(tags):
    v = (tags.get("name:si") or "").strip()
    if v:
        return v
    n = (tags.get("name") or "").strip()
    return n if re.search("[඀-෿]", n) else None


def element_point(el):
    """(lat, lon) of an Overpass element with 'out center': node position, or centre of a way/relation. None if absent."""
    if el.get("type") == "node":
        return el.get("lat"), el.get("lon")
    c = el.get("center") or {}
    return c.get("lat"), c.get("lon")


def inside_box(lat, lon, box=SRI_LANKA_BOX):
    return lat is not None and lon is not None and box[0] <= lat <= box[1] and box[2] <= lon <= box[3]


# ---------------------------------------------------------------------------
# kinds -> activities -> cost level (draft tables from config.toml)
# ---------------------------------------------------------------------------
def activities_for(kinds, kind_activities):
    """Union of the activities of each kind, in first-seen order (no duplicates)."""
    out = []
    for k in kinds:
        for a in kind_activities.get(k, []):
            if a not in out:
                out.append(a)
    return out


def cost_level_for(kinds, cost_table):
    """DRAFT assumption: the highest cost level among the kinds, or None if no kind has one."""
    levels = [cost_table[k] for k in kinds if k in cost_table]
    return max(levels) if levels else None


# ---------------------------------------------------------------------------
# Provinces (for 'region')
# ---------------------------------------------------------------------------
def province_polygons(elements):
    """[(name, shapely geometry)] from Overpass province relations fetched with 'out geom'."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    out = []
    for el in elements:
        tags = el.get("tags", {})
        name = (tags.get("name:en") or tags.get("name") or "").replace(" Province", "").strip()
        outers = []
        for m in el.get("members", []):
            geom = m.get("geometry") or []
            if m.get("role") == "outer" and len(geom) >= 4:
                outers.append(Polygon([(p["lon"], p["lat"]) for p in geom]).buffer(0))
        # Boundary members come as many separate ways: joining them needs line merging.
        if not outers:
            continue
        out.append((name, unary_union(outers)))
    return out


def province_polygons_merged(elements):
    """Like province_polygons, but first joins the boundary ways into rings (OSM stores an outline as several ways)."""
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    out = []
    for el in elements:
        tags = el.get("tags", {})
        name = (tags.get("name:en") or tags.get("name") or "").replace(" Province", "").strip()
        lines = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]]) for m in el.get("members", [])
                 if m.get("role") in ("outer", "") and len(m.get("geometry") or []) >= 2]
        polys = list(polygonize(unary_union(lines))) if lines else []
        if polys:
            out.append((name, unary_union(polys)))
    return out


def region_of(lat, lon, provinces):
    """Province name containing the point, or None (e.g. a point in the sea)."""
    from shapely.geometry import Point
    pt = Point(lon, lat)
    for name, geom in provinces:
        if geom.contains(pt):
            return name
    return None


# ---------------------------------------------------------------------------
# Building the destination list
# ---------------------------------------------------------------------------
def notability(tags):
    """Higher = better documented in OpenStreetMap (used only to pick which places to keep)."""
    return (2 if tags.get("wikipedia") else 0) + (2 if tags.get("wikidata") else 0) + (1 if tags.get("name:si") else 0) \
        + (1 if tags.get("name:en") else 0) + (1 if tags.get("website") or tags.get("wikimedia_commons") else 0)


def osm_candidates(elements_by_category, trip_cfg):
    """Candidate OSM places per category, best documented first. Each: dict with name_en, name_si, lat, lon, kind, osm, score."""
    out = {}
    exclude = re.compile(trip_cfg["osm"]["exclude_name_regex"]) if trip_cfg["osm"].get("exclude_name_regex") else None
    for cat, cat_cfg in trip_cfg["osm"]["categories"].items():
        rows = []
        for el in elements_by_category.get(cat, []):
            tags = el.get("tags", {})
            name = english_name(tags)
            lat, lon = element_point(el)
            if not name or not inside_box(lat, lon) or (exclude and exclude.search(name)):
                continue
            rows.append({"name_en": name, "name_si": sinhala_name(tags), "lat": round(lat, 5), "lon": round(lon, 5),
                         "kind": cat_cfg["kind"], "category": cat, "osm": {"type": el["type"], "id": el["id"]},
                         "score": notability(tags)})
        rows.sort(key=lambda r: (-r["score"], r["name_en"], r["osm"]["id"]))
        out[cat] = rows
    return out


def build_destinations(places, osm_elements, provinces, cfg):
    """The list written to destinations.json (without elevation: that is added afterwards).

    places: the 'places' list of data/places.json. osm_elements: {category: [Overpass elements]}.
    """
    t = cfg["trip"]
    min_sep = t["osm"]["min_separation_km"]
    dests, used_ids = [], set()

    def add(item, kinds, osm):
        did = item["id"]
        dests.append({
            "id": did, "name_en": item["name_en"], "name_si": item.get("name_si"),
            "lat": item["lat"], "lon": item["lon"],
            "region": region_of(item["lat"], item["lon"], provinces),
            "kinds": kinds, "activities": activities_for(kinds, t["kind_activities"]),
            "cell": common.cell_key(item["lat"], item["lon"], cfg),
            "elevation_m": None,
            "cost_level": cost_level_for(kinds, t["cost_level"]),
            "cost_level_evidence": "assumption" if cost_level_for(kinds, t["cost_level"]) is not None else None,
            "osm": osm, "image": None, "note": None,
        })
        used_ids.add(did)

    for p in places:
        kinds = t["place_kinds"].get(p["id"])
        if kinds is None:
            raise ValueError(f"place {p['id']!r} has no entry in [trip.place_kinds] of config.toml")
        bad = [k for k in kinds if k not in KINDS]
        if bad:
            raise ValueError(f"place {p['id']!r} has unknown kinds {bad}")
        add(p, list(kinds), None)

    cands = osm_candidates(osm_elements, t)
    for cat, cat_cfg in t["osm"]["categories"].items():
        kept = 0
        for c in cands.get(cat, []):
            if kept >= cat_cfg["keep"]:
                break
            if any(haversine_km(c["lat"], c["lon"], d["lat"], d["lon"]) < min_sep for d in dests):
                continue                                   # duplicate of a place we already have
            did = slugify(c["name_en"]) or f"osm-{c['osm']['id']}"
            if did in used_ids:
                did = f"{did}-{c['osm']['id']}"
            add({"id": did, "name_en": c["name_en"], "name_si": c["name_si"], "lat": c["lat"], "lon": c["lon"]},
                [c["kind"]], c["osm"])
            kept += 1
    return dests


# ---------------------------------------------------------------------------
# Terrain: AWS "terrarium" tiles
# ---------------------------------------------------------------------------
def tile_xy(lat, lon, z):
    """Slippy-map tile (x, y) and the position inside it (px, py in 0..256, fractional) for a point."""
    n = 2 ** z
    fx = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    fy = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    x, y = int(fx), int(fy)
    return x, y, (fx - x) * 256, (fy - y) * 256


def decode_terrarium(r, g, b):
    """Metres above sea level from one terrarium pixel."""
    return r * 256.0 + g + b / 256.0 - 32768.0


def meters_per_pixel(lat, z):
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** z)


def fetch_tile(x, y, z, cfg, session=None):
    """The decoded tile as a Pillow RGB image (cached in pipeline/cache/trip/dem/). Raises requests exceptions on failure."""
    from PIL import Image
    path = common.CACHE / "dem" / f"{z}_{x}_{y}.png"
    if path.exists():
        return Image.open(path).convert("RGB")
    url = cfg["trip"]["environment"]["terrain_url"].format(z=z, x=x, y=y)
    r = (session or requests).get(url, timeout=60, headers={"User-Agent": common.USER_AGENT})
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return Image.open(io.BytesIO(r.content)).convert("RGB")


def elevation_and_slope(lat, lon, cfg, session=None):
    """(elevation_m, slope_pct) at a point, or (None, None) if the tile cannot be read.

    Slope is the steepest gradient over +/- 2 pixels (about 150 m at zoom 12), in percent. A point near a tile edge
    uses the pixels inside its own tile only, so slope there may be None.
    """
    z = cfg["trip"]["environment"]["zoom"]
    x, y, px, py = tile_xy(lat, lon, z)
    try:
        img = fetch_tile(x, y, z, cfg, session)
    except Exception:
        return None, None
    px_i, py_i = min(int(px), 255), min(int(py), 255)

    def h(ix, iy):
        return decode_terrarium(*img.getpixel((ix, iy)))

    elev = h(px_i, py_i)
    slope = None
    if 2 <= px_i <= 253 and 2 <= py_i <= 253:
        step = 2
        size = meters_per_pixel(lat, z) * step * 2
        dzdx = (h(px_i + step, py_i) - h(px_i - step, py_i)) / size
        dzdy = (h(px_i, py_i + step) - h(px_i, py_i - step)) / size
        slope = round(100.0 * math.hypot(dzdx, dzdy), 1)
    return int(round(elev)), slope
