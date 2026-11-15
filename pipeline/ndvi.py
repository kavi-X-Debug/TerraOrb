"""
Greenness (NDVI) around every tank
==================================

    .venv\\Scripts\\python pipeline\\ndvi.py [--tank <id>] [--limit N]    (run from the repo root; no login needed)

NDVI is a number that satellites measure from the colour of the land: about 0.1-0.3 for bare or dry
ground, 0.6-0.9 for thick green crops. We use NASA MODIS (Terra, MOD13Q1): one value every 16 days
at 250 m, from NASA's free ORNL DAAC MODIS web service.

For every tank this writes the "ndvi" section of data/tank/<id>.json:
  series  - the last two years of values (one per 16 days)
  normal  - the usual value for each of the 23 slots in a year (mean, lowest and highest of the earlier years)
  current - the newest value, the usual value for that time of year, and above / about / below usual

How one value is made: we take the block of 250 m pixels within `km_radius` of the tank centre, drop pixels
that are water, bare ground or cloud (NDVI below `land_min_ndvi`), and use the MEDIAN of the rest.
If fewer than `min_land_pixels` remain the value is null (never a guess).

It is slow (hundreds of requests for 100 tanks), so every downloaded value is kept in data/ndvi_cache/
and a re-run only asks for the new dates. If a download keeps failing the script stops and writes nothing.
"""

import argparse
import json
import statistics
import sys
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
CACHE = REPO / "data" / "ndvi_cache"      # committed to the repo, so the daily refresh only downloads the new dates
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def stop(message):
    sys.exit(f"STOPPED: {message}\nNothing was written to data/.")


# ---------------------------------------------------------------------------
# Pure functions (tested without internet)
# ---------------------------------------------------------------------------
def median_land_ndvi(pixels, cfg):
    """One value for one date: median of the land pixels, or None if too few (never a guess)."""
    land = []
    for raw in pixels:
        if raw is None or raw == cfg["fill_value"]:
            continue
        value = raw * cfg["scale"]
        if value >= cfg["land_min_ndvi"]:
            land.append(value)
    if len(land) < cfg["min_land_pixels"]:
        return None
    return round(statistics.median(land), 3)


def slot_of(day):
    """MODIS 16-day composites start on the same day-of-year every year (1, 17, 33 ... 353)."""
    return datetime.strptime(day, "%Y-%m-%d").timetuple().tm_yday


def usual_by_slot(obs, current_year, cfg):
    """Mean / lowest / highest value for each slot, from the years BEFORE the current one."""
    by_slot = {}
    for day, value in obs.items():
        if value is None or int(day[:4]) >= current_year:
            continue
        by_slot.setdefault(slot_of(day), []).append(value)
    usual = []
    for slot in sorted(by_slot):
        values = by_slot[slot]
        if len(values) < cfg["min_normal_years"]:
            continue                                  # too few years for a "usual"
        usual.append({"doy": slot, "mean": round(statistics.mean(values), 3),
                      "min": round(min(values), 3), "max": round(max(values), 3), "years": len(values)})
    return usual


def current_state(obs, usual, cfg):
    """The newest value that exists, the usual value for its slot, and above / about / below usual."""
    known = sorted(day for day, value in obs.items() if value is not None)
    if not known:
        return None
    day = known[-1]
    value = obs[day]
    match = next((u for u in usual if u["doy"] == slot_of(day)), None)
    if match is None:
        return {"date": day, "ndvi": value, "usual": None, "diff": None, "state": None}
    diff = round(value - match["mean"], 3)
    state = "about" if abs(diff) <= cfg["near_usual"] else ("above" if diff > 0 else "below")
    return {"date": day, "ndvi": value, "usual": match["mean"], "diff": diff, "state": state}


def ndvi_section(obs, demo, cfg, now):
    """The "ndvi" section of a tank file, or None when there is nothing to show."""
    if not any(v is not None for v in obs.values()):
        return None
    current_year = int(max(obs)[:4])
    usual = usual_by_slot(obs, current_year, cfg)
    cutoff = f"{current_year - cfg['series_years'] + 1}-01-01"
    return {
        "issued": now,
        "series": [{"date": d, "ndvi": obs[d]} for d in sorted(obs) if d >= cutoff],
        "normal": usual,
        "normal_years": f"{cfg['first_year']}–{current_year - 1}",
        "current": current_state(obs, usual, cfg),
        "radius_km": cfg["km_radius"],
        "source": cfg["source"],
        "credit": cfg["credit"],
        "demo": demo,
    }


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
def get_json(url, params, cfg):
    last = "no answer"
    for attempt in range(cfg["retries"]):
        try:
            r = requests.get(url, params=params, timeout=cfg["timeout_seconds"])
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}: {r.text[:200]}"
        except (requests.RequestException, ValueError) as err:
            last = str(err)
        time.sleep(3 * (attempt + 1))
    stop(f"the MODIS service failed after {cfg['retries']} tries ({last})")


def list_dates(tank, cfg):
    """All composite dates available at the tank (calendar date + MODIS code), from first_year on."""
    data = get_json(f"{cfg['url']}/{cfg['product']}/dates",
                    {"latitude": tank["lat"], "longitude": tank["lon"]}, cfg)
    return [(d["calendar_date"], d["modis_date"]) for d in data["dates"]
            if int(d["calendar_date"][:4]) >= cfg["first_year"]]


def fetch_chunk(tank, chunk, cfg):
    """{calendar_date: value or None} for up to `chunk_dates` dates."""
    data = get_json(f"{cfg['url']}/{cfg['product']}/subset", {
        "latitude": tank["lat"], "longitude": tank["lon"], "band": cfg["band"],
        "startDate": chunk[0][1], "endDate": chunk[-1][1],
        "kmAboveBelow": cfg["km_radius"], "kmLeftRight": cfg["km_radius"],
    }, cfg)
    return {row["calendar_date"]: median_land_ndvi(row["data"], cfg) for row in data["subset"]}


def update_tank(tank, cfg):
    """Download the dates this tank does not have yet; returns {calendar_date: value or None}."""
    path = CACHE / f"{tank['id']}.json"
    obs = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    missing = [(c, m) for c, m in list_dates(tank, cfg) if c not in obs]
    size = cfg["chunk_dates"]
    for i in range(0, len(missing), size):
        obs.update(fetch_chunk(tank, missing[i:i + size], cfg))
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obs, indent=0) + "\n", encoding="utf-8")     # saved after every chunk: resumable
    return obs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Download NASA MODIS NDVI for every tank.")
    parser.add_argument("--tank", help="only this tank id")
    parser.add_argument("--limit", type=int, help="only the first N tanks")
    args = parser.parse_args()

    cfg = load_config()["ndvi"]
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    if args.tank:
        tanks = [t for t in tanks if t["id"] == args.tank]
        if not tanks:
            stop(f"no tank with id {args.tank!r}")
    if args.limit:
        tanks = tanks[:args.limit]
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()

    # Download first (results are cached), so a failure writes nothing to data/.
    results = {}

    def work(tank):
        results[tank["id"]] = update_tank(tank, cfg)
        print(f"  {tank['id']}: {len(results[tank['id']])} dates", flush=True)

    print(f"Downloading MODIS NDVI for {len(tanks)} tanks ...", flush=True)
    with ThreadPoolExecutor(max_workers=cfg["workers"]) as pool:
        list(pool.map(work, tanks))

    written = 0
    for tank in tanks:
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            print(f"  {tank['id']}: no data file yet (run rain.py first), skipped")
            continue
        section = ndvi_section(results[tank["id"]], bool(tank.get("demo")), cfg, now)
        doc = json.loads(path.read_text(encoding="utf-8"))
        if section is None:
            doc.pop("ndvi", None)                      # nothing real to show: no section, never a placeholder
        else:
            doc["ndvi"] = section                      # only the ndvi section changes
            written += 1
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote NDVI for {written} of {len(tanks)} tanks.")


if __name__ == "__main__":
    main()
