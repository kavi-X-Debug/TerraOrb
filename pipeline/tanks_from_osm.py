"""
Real tank list from OpenStreetMap
=================================

    .venv\\Scripts\\python pipeline\\tanks_from_osm.py            (uses the cached download)
    .venv\\Scripts\\python pipeline\\tanks_from_osm.py --refresh  (download again from OSM)

Builds data/tanks.json and data/polygons/<id>.geojson from OpenStreetMap:
  1. downloads every named water body (natural=water) in the district set in
     config.toml [tanks], with its outline (Overpass API, no login);
  2. keeps the ones that are tanks (name like "... Wewa", "... Tank", "... Kulam", or tagged
     water=reservoir), drops ponds, temple pools and natural lakes (pokuna, villu);
  3. measures each outline's area, keeps tanks of at least min_area_ha, and takes the
     max_tanks largest (one per name);
  4. writes the list and each tank's outline (water.py measures water inside it).

Nothing is guessed: OpenStreetMap has no command areas and almost no Sinhala names, so
those are left null for the team to fill in (the app shows the English name meanwhile).
Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
If the download fails, the script stops and writes nothing.
"""

import argparse
import json
import re
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from pyproj import Geod
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
CACHE = PIPELINE / "cache" / "osm_water.json"
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
SOURCE = "OpenStreetMap (© OpenStreetMap contributors, ODbL)"
SINHALA = re.compile("[඀-෿]")


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


# ---------------------------------------------------------------------------
# 1. Download (cached)
# ---------------------------------------------------------------------------
def download(cfg, refresh):
    if CACHE.exists() and not refresh:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    query = f"""
    [out:json][timeout:180];
    area["boundary"="administrative"]["name:en"="{cfg['district']}"]->.d;
    ( way["natural"="water"]["name"](area.d); relation["natural"="water"]["name"](area.d); );
    out tags geom;
    """
    try:
        r = requests.post(cfg["overpass_url"], data={"data": query}, timeout=300,
                          headers={"User-Agent": "MonsoonCompass/0.1 (NASA Space Apps student project)"})
    except requests.RequestException as err:
        sys.exit(f"STOPPED: could not reach OpenStreetMap (Overpass): {err}\nNothing was written.")
    if r.status_code != 200:
        sys.exit(f"STOPPED: Overpass returned HTTP {r.status_code}: {r.text[:300]}\nNothing was written.")
    elements = r.json().get("elements", [])
    if not elements:
        sys.exit(f"STOPPED: OpenStreetMap returned no water bodies for {cfg['district']!r}. Nothing was written.")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(elements), encoding="utf-8")
    return elements


# ---------------------------------------------------------------------------
# 2–3. Outline, area, filters (pure functions)
# ---------------------------------------------------------------------------
GEOD = Geod(ellps="WGS84")


def outline(element):
    """Shapely polygon (lon/lat) of an OSM way or multipolygon relation, or None."""
    if element["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in element.get("geometry", [])]
        return Polygon(pts).buffer(0) if len(pts) >= 4 else None
    outers = [Polygon([(p["lon"], p["lat"]) for p in m["geometry"]]) for m in element.get("members", [])
              if m.get("role") == "outer" and len(m.get("geometry") or []) >= 4]
    return unary_union(outers).buffer(0) if outers else None


def area_ha(shape):
    return abs(GEOD.geometry_area_perimeter(shape)[0]) / 10_000


def is_tank(tags, cfg):
    name = tags.get("name", "")
    if re.search(cfg["not_tank_words"], name, re.I) or tags.get("water") == "pond":
        return False
    return bool(re.search(cfg["tank_words"], name, re.I)) or tags.get("water") == "reservoir"


def select_tanks(elements, cfg):
    """[(element, shape, area_ha)] for the tanks to list, largest first, one per name."""
    best = {}
    for e in elements:
        tags = e.get("tags", {})
        if not is_tank(tags, cfg):
            continue
        shape = outline(e)
        if shape is None or shape.is_empty:
            continue
        ha = area_ha(shape)
        if ha < cfg["min_area_ha"]:
            continue
        key = tags["name"].strip().lower()
        if key not in best or ha > best[key][2]:          # same tank mapped twice: keep the larger
            best[key] = (e, shape, ha)
    return sorted(best.values(), key=lambda x: -x[2])[: cfg["max_tanks"]]


def tank_entry(element, shape, ha):
    tags = element["tags"]
    name = tags["name"].strip()
    name_si = tags.get("name:si") or (name if SINHALA.search(name) else None)
    name_en = tags.get("name:en") or (name if not SINHALA.search(name) else None)
    centre = shape.representative_point()                 # always inside the outline
    return {
        "id": f"osm-{element['type']}-{element['id']}",
        "name_si": name_si,                                # null: Sinhala name still to be added
        "name_en": name_en or name,
        "lat": round(centre.y, 5),
        "lon": round(centre.x, 5),
        "cascade": None,                                   # not in OpenStreetMap
        "command_area_ha": None,                           # not in OpenStreetMap
        "outline_area_ha": round(ha, 1),                   # area of the mapped outline (full tank)
        "demo": False,
        "source": SOURCE,
    }


# ---------------------------------------------------------------------------
# 4. Write
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Build data/tanks.json from OpenStreetMap.")
    parser.add_argument("--refresh", action="store_true", help="download again instead of using the cache")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()["tanks"]

    elements = download(cfg, args.refresh)
    chosen = select_tanks(elements, cfg)
    if not chosen:
        sys.exit("STOPPED: no tanks passed the filters. Nothing was written.")
    tanks = [tank_entry(e, shape, ha) for e, shape, ha in chosen]

    tanks_path = REPO / "data" / "tanks.json"
    old = json.loads(tanks_path.read_text(encoding="utf-8")) if tanks_path.exists() else {"tanks": []}
    demo = [t for t in old["tanks"] if t.get("demo")] if cfg["keep_demo_tanks"] else []

    poly_dir = REPO / "data" / "polygons"
    poly_dir.mkdir(parents=True, exist_ok=True)
    for (e, shape, ha), tank in zip(chosen, tanks):
        feature = {"type": "Feature",
                   "properties": {"id": tank["id"], "name": e["tags"]["name"], "area_ha": round(ha, 1),
                                  "source": SOURCE, "osm": f"https://www.openstreetmap.org/{e['type']}/{e['id']}"},
                   "geometry": mapping(shape)}
        (poly_dir / f"{tank['id']}.geojson").write_text(json.dumps(feature), encoding="utf-8")

    doc = {
        "schema_version": "1.5",
        "generated": datetime.now(SRI_LANKA).replace(microsecond=0).isoformat(),
        "tanks_source": SOURCE,
        "tanks": demo + tanks,
    }
    tanks_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(tanks)} tanks from OpenStreetMap ({cfg['district']}), "
          f"{tanks[0]['outline_area_ha']}–{tanks[-1]['outline_area_ha']} ha; kept {len(demo)} demo tank(s).")
    print(f"Wrote data/tanks.json and {len(tanks)} outlines in data/polygons/.")


if __name__ == "__main__":
    main()
