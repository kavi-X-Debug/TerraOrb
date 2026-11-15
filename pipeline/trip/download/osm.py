"""
Tourist places and province outlines from OpenStreetMap (Overpass API).
(c) OpenStreetMap contributors, ODbL: credit OpenStreetMap wherever these places are shown.

    .venv\Scripts\python -m pipeline.trip.download.osm          (run from the repo root; no login needed)

One Overpass query per category (waterfalls, viewpoints, national parks, beaches, historic sites, temples),
plus one query for the nine province outlines (used to fill the 'region' of each destination).
Every answer is cached in pipeline/cache/trip/osm_<name>.json, so a run that is cut short continues where it
stopped and finished queries are never repeated (pass refresh=True to ask again).
If a query fails the function raises OsmError: the caller reports it, nothing is invented.
"""

import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))      # so "python pipeline/trip/download/osm.py" works
from pipeline.trip import common  # noqa: E402


class OsmError(RuntimeError):
    pass


# The Overpass selector of each category. "nwr" = node, way or relation. Only named objects are kept.
QUERIES = {
    "waterfall": '["waterway"="waterfall"]["name"]',
    "viewpoint": '["tourism"="viewpoint"]["name"]',
    "national_park": '["boundary"="national_park"]["name"]',
    "beach": '["natural"="beach"]["name"]',
    "historic": '["historic"~"^(archaeological_site|ruins|monument|fort|castle)$"]["name"]',
    "temple": '["amenity"="place_of_worship"]["religion"="buddhist"]["wikidata"]["name"]',
}


def overpass(query, cfg, retries=3):
    """POST one Overpass query; tries the main server, then the fallback; returns the 'elements' list."""
    osm = cfg["osm"]
    urls = [osm["overpass_url"], osm.get("overpass_fallback_url")]
    last = "no answer"
    for attempt in range(retries):
        for url in [u for u in urls if u]:
            try:
                r = requests.post(url, data={"data": query}, timeout=300, headers={"User-Agent": common.USER_AGENT})
                if r.status_code == 200:
                    return r.json().get("elements", [])
                last = f"{url}: HTTP {r.status_code}"
            except (requests.RequestException, ValueError) as err:
                last = f"{url}: {err}"
        time.sleep(15 * (attempt + 1))
    raise OsmError(f"Overpass failed after {retries} tries ({last})")


def cached(name, query, cfg, refresh=False, offline=False):
    path = common.CACHE / f"osm_{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    if offline:
        raise FileNotFoundError(f"no cached OSM answer for {name!r} and downloads are switched off")
    elements = overpass(query, cfg)
    common.CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(elements), encoding="utf-8")
    return elements


def area_clause(cfg):
    return f'area["ISO3166-1"="{cfg["osm"]["country_iso"]}"]["admin_level"="2"]->.lk;'


def fetch_category(name, cfg, refresh=False, offline=False):
    """Named OSM objects of one category, each with tags and a point (node position or centre of a way/relation)."""
    query = f"[out:json][timeout:240];{area_clause(cfg)}nwr{QUERIES[name]}(area.lk);out center tags;"
    return cached(name, query, cfg, refresh, offline)


def fetch_provinces(cfg, refresh=False, offline=False):
    """The province boundary relations (admin_level 4) with their outlines."""
    query = (f'[out:json][timeout:240];{area_clause(cfg)}'
             'rel["boundary"="administrative"]["admin_level"="4"](area.lk);out geom tags;')
    return cached("provinces", query, cfg, refresh, offline)


def fetch_all(cfg, refresh=False, pause=5, offline=False):
    """{category: elements, 'provinces': elements}. Raises OsmError if a query cannot be answered."""
    out = {}
    for name in list(QUERIES) + ["provinces"]:
        fresh = refresh or not (common.CACHE / f"osm_{name}.json").exists()
        out[name] = (fetch_provinces(cfg, refresh, offline) if name == "provinces"
                     else fetch_category(name, cfg, refresh, offline))
        print(f"  OSM {name}: {len(out[name])} objects", flush=True)
        if fresh:
            time.sleep(pause)                       # be polite to the free service
    return out


if __name__ == "__main__":
    common.console_utf8()
    fetch_all(common.trip_cfg(), refresh="--refresh" in sys.argv)
