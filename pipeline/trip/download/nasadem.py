"""
NASA NASADEM elevation (LP DAAC, 1 arc-second, about 30 m) for the trip planner's places.

Replaces the AWS terrain-tile height (not NASA) by NASA's own height model. The 1-degree tiles (about 13 MB each) are downloaded once with the
Earthdata token (environment variable EARTHDATA_TOKEN, never written to a file) into pipeline/cache/nasadem/ and reused.
Only the tiles that hold a place are fetched. Each place keeps its old AWS value as `elevation_aws_m`, so the two can be compared.

Run:  python -m pipeline.trip.download.nasadem        (updates data/trip/destinations.json)
"""
import json
import math
import os
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / "pipeline" / "cache" / "nasadem"
DEST = ROOT / "data" / "trip" / "destinations.json"
BASE = "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/NASADEM_HGT.001/{n}/{n}.zip"
SOURCE = "NASA NASADEM (LP DAAC), 1 arc-second (about 30 m)"
SIDE = 3601                                         # samples per tile edge (1 degree at 1 arc-second, edges shared with neighbours)


def tile_name(lat, lon):
    """Name of the 1-degree tile holding the point, e.g. (7.3, 80.6) -> 'NASADEM_HGT_n07e080'."""
    la, lo = math.floor(lat), math.floor(lon)
    return f"NASADEM_HGT_{'n' if la >= 0 else 's'}{abs(la):02d}{'e' if lo >= 0 else 'w'}{abs(lo):03d}"


def ensure_tile(name, token=None, session=None):
    """Path of the cached zip; downloads it first if needed. Raises RuntimeError with the reason if NASA refuses or the file is not a zip."""
    path = CACHE / f"{name}.zip"
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    token = token or os.environ.get("EARTHDATA_TOKEN")
    if not token:
        raise RuntimeError("EARTHDATA_TOKEN is not set (see AGENTS.md > Secrets)")
    CACHE.mkdir(parents=True, exist_ok=True)
    r = (session or requests).get(BASE.format(n=name), headers={"Authorization": f"Bearer {token}"}, stream=True, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"NASA returned HTTP {r.status_code} for {name}")
    tmp = path.with_suffix(".part")
    with open(tmp, "wb") as f:
        for chunk in r.iter_content(1 << 20):
            f.write(chunk)
    if not zipfile.is_zipfile(tmp):
        tmp.unlink()
        raise RuntimeError(f"{name} was not a zip file (token expired?)")
    tmp.replace(path)
    return path


_tiles = {}


def _load(name):
    """The tile as a 3601 x 3601 int16 array, north row first (SRTM .hgt layout, big-endian)."""
    if name not in _tiles:
        with zipfile.ZipFile(ensure_tile(name)) as z:
            hgt = next(n for n in z.namelist() if n.lower().endswith(".hgt"))
            _tiles[name] = np.frombuffer(z.read(hgt), dtype=">i2").reshape(SIDE, SIDE)
    return _tiles[name]


def elevation(lat, lon):
    """Height in metres at the point (nearest sample), or None for a void sample (-32768) or a sea point reported as void."""
    a = _load(tile_name(lat, lon))
    la, lo = math.floor(lat), math.floor(lon)
    row = int(round((la + 1 - lat) * (SIDE - 1)))
    col = int(round((lon - lo) * (SIDE - 1)))
    v = int(a[row, col])
    return None if v == -32768 else v


def update_destinations():
    doc = json.loads(DEST.read_text(encoding="utf-8"))
    items = doc["destinations"]
    for name in sorted({tile_name(d["lat"], d["lon"]) for d in items}):
        print("tile", name, ensure_tile(name).stat().st_size // 1_000_000, "MB")
    changed = 0
    for d in items:
        v = elevation(d["lat"], d["lon"])
        if v is None:
            continue                                   # keep the old value and its old source; never filled in
        if d.get("elevation_aws_m") is None and d.get("elevation_source") != SOURCE:
            d["elevation_aws_m"] = d.get("elevation_m")
        d["elevation_m"], d["elevation_source"] = v, SOURCE
        changed += 1
    doc["elevation_note"] = f"elevation: {SOURCE}; the earlier AWS terrain-tile value is kept as elevation_aws_m (not NASA). Places with a void sample keep the AWS value."
    doc["generated"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    DEST.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    diffs = [abs(d["elevation_m"] - d["elevation_aws_m"]) for d in items if d.get("elevation_aws_m") is not None and d["elevation_source"] == SOURCE]
    print(f"{changed} of {len(items)} places now use NASADEM; median |difference to AWS| = {np.median(diffs):.1f} m, max {max(diffs)} m" if diffs else "no comparison")


if __name__ == "__main__":
    try:
        update_destinations()
    except RuntimeError as e:
        sys.exit(str(e))
