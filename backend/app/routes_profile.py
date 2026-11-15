"""
Location card and climate profile of a farm (docs/farm-spec.md sections 3 and 4).

  GET /api/farms/{id}/location   climatic zone, elevation (null: no DEM yet), the two seasons Maha / Yala, the NASA grid cell used
  GET /api/farms/{id}/profile    monthly water balance, rain onset, dry spells, NDVI strip, SMAP (not available), all from data/farm/

The tables are made ahead of time by pipeline/farm_profile.py; this file only reads them (nothing is computed or invented here).
The farm is matched to the NASA POWER grid cell that contains it (0.5 deg tall x 0.625 deg wide, same rule as pipeline/rain.py).
If no table exists for that cell the answer says "covered": false and gives no numbers. Every block carries its source, period,
resolution and demo flag, and says plainly that the values are area-level (about 50 km), not measured on the farm.
"""
import json
import tomllib
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends

from . import auth
from .db import get_db

router = APIRouter(prefix="/api")

REPO = Path(__file__).resolve().parents[2]
TABLES = REPO / "data" / "farm"
CONFIG = REPO / "pipeline" / "config.toml"

AREA_NOTE = "Area-level data: one NASA grid cell is about 50 km wide, so these numbers describe the area, not this field."
EXPERT_NOTE = "This supports, and does not replace, advice from your local agricultural officer."
SEASONS = [
    {"name": "Maha", "months": "October to January", "onset_window_start": "09-15", "note": "main rainy season (north-east monsoon)"},
    {"name": "Yala", "months": "April to August", "onset_window_start": "03-15", "note": "dry-season crop, often needs tank or well water"},
]


@lru_cache(maxsize=1)
def _config():
    with open(CONFIG, "rb") as f:
        return tomllib.load(f)


def _cell(lat, lon):
    """(key, centre lat, centre lon) of the POWER grid cell containing the point; key is '<lat>_<lon>' like the data/cells files."""
    p = _config()["power"]
    clat = round(round(lat / p["grid_lat_deg"]) * p["grid_lat_deg"], 4)
    clon = round(round(lon / p["grid_lon_deg"]) * p["grid_lon_deg"], 4)
    return f"{clat}_{clon}", clat, clon


def _table(name):
    """A data/farm table, or None when the pipeline has not made it. Re-read when the file changes."""
    path = TABLES / f"{name}.json"
    if not path.exists():
        return None
    return _load(str(path), path.stat().st_mtime)


@lru_cache(maxsize=16)
def _load(path, _mtime):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _in_pilot(lat, lon):
    bbox = _config()["farm"]["pilot_bbox"]               # lat_min, lon_min, lat_max, lon_max
    return bbox[0] <= lat <= bbox[2] and bbox[1] <= lon <= bbox[3]


def _labelled(table, content):
    """Wrap one cell's content with the table's source label."""
    return {"source": table["source"], "period": table["period"], "resolution": table["resolution"],
            "demo": table.get("demo", False), "thresholds_are_placeholders": table.get("thresholds_are_placeholders", False),
            "data": content}


def _farm(db, farm_id, farmer):
    return auth.own_farm(db, farm_id, farmer)


@router.get("/farms/{farm_id}/location")
def farm_location(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    farm = _farm(db, farm_id, farmer)
    key, clat, clon = _cell(farm["lat"], farm["lon"])
    index = _table("index")
    covered_keys = {c["key"] for c in (index or {}).get("cells", [])}
    covered = key in covered_keys
    inside = _in_pilot(farm["lat"], farm["lon"])
    if inside:
        zone = {"name": "Dry Zone", "value": "Dry Zone", "source": "Pilot district rule: Anuradhapura bounding box (pipeline/config.toml [farm] pilot_bbox)",
                "confidence": "draft", "note": "Anuradhapura district lies in the Dry Zone. A proper agro-ecological map has not been loaded yet."}
    else:
        zone = {"name": None, "value": None, "source": None, "confidence": None,
                "note": "This farm is outside the Anuradhapura pilot area, so the climatic zone is not known."}
    return {
        "farm_id": farm["id"],
        "climatic_zone": zone,
        "elevation_m": None,
        "elevation_note": "Elevation is not stored yet (it comes from open terrain tiles when zones are computed).",
        "seasons": SEASONS,
        "grid_cell": {"key": key, "centre_lat": clat, "centre_lon": clon, "size": "0.5 deg tall x 0.625 deg wide (about 50 km)"},
        "covered": covered,
        "in_pilot_area": inside,
        "coverage_note": None if covered else "No pre-computed climate tables exist for this farm's area yet, so no climate numbers are shown.",
        "source": "NASA POWER grid cell; zone from the pilot-district rule",
        "demo": False,
        "area_note": AREA_NOTE,
        "expert_note": EXPERT_NOTE,
    }


@router.get("/farms/{farm_id}/profile")
def farm_profile(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    farm = _farm(db, farm_id, farmer)
    key, clat, clon = _cell(farm["lat"], farm["lon"])
    out = {"farm_id": farm["id"], "grid_cell": {"key": key, "centre_lat": clat, "centre_lon": clon},
           "area_note": AREA_NOTE, "expert_note": EXPERT_NOTE, "gaps": []}
    index = _table("index")
    if index is None:
        out.update(covered=False, coverage_note="The pre-computed tables have not been made yet (run pipeline/farm_profile.py).")
        return out
    if key not in {c["key"] for c in index["cells"]}:
        out.update(covered=False, coverage_note="This farm lies outside the grid cells that have pre-computed tables; no climate numbers are shown.")
        return out
    out["covered"] = True

    for name, label in (("climate_monthly", "climate_monthly"), ("onset_by_year", "onset"), ("dry_spell_by_year", "dry_spells")):
        table = _table(name)
        content = table["cells"].get(key) if table else None
        if content is None:
            out[label] = None
            out["gaps"].append(f"{label}: no table for this cell")
        else:
            out[label] = _labelled(table, content)
    out["climate_monthly_note"] = "Water balance is rain minus ET0 (ET0 estimated with Hargreaves-Samani, not Penman-Monteith)."

    series, bare = _table("ndvi_series"), _table("bare_calendar")
    if series and key in series["cells"]:
        out["ndvi"] = _labelled(series, series["cells"][key])
        out["bare_calendar"] = _labelled(bare, bare["cells"][key]) if bare and key in bare["cells"] else None
        out["ndvi_note"] = "Greenness measured around real tanks in this area, not on this farm. Cloud gaps mean some dates are missing."
    else:
        out["ndvi"] = {"available": False, "reason": "No NDVI table for this cell."}
        out["bare_calendar"] = None
        out["gaps"].append("ndvi: not available for this cell")
    out["sm_anomaly"] = index.get("sm_anomaly", {"available": False, "reason": "not fetched"})
    out["gaps"] += index.get("gaps", [])
    out["thresholds_are_placeholders"] = True
    out["demo"] = False
    return out
