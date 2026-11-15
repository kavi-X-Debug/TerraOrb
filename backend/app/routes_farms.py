"""
Farms: register, read, update, delete and export (spec section 3 and 3.1).

  POST   /api/farms                 create a farm (location, water, labour, priorities, crop history)
  GET    /api/farms                 the logged-in farmer's farms
  GET    /api/farms/{id}            one farm
  PATCH  /api/farms/{id}            change any of the fields (priorities and crop_history are replaced when sent)
  DELETE /api/farms/{id}            delete the farm and every row that belongs to it
  GET    /api/farms/{id}/export     everything stored for the farm, as JSON
  POST   /api/farms/{id}/groundtruth  the farmer's yes/no answer to "does the satellite value match your field?" (F6a)

A farmer only ever sees their own farms: another farmer's farm answers 404 (see auth.own_farm).
Values are checked for Sri Lanka (lat 5.5 to 10.0, lon 79.0 to 82.2) so a typing mistake is caught with a clear message.
"""
import json
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from . import auth
from .db import get_db, now_iso, row_to_dict

router = APIRouter(prefix="/api")

LAT_RANGE = (5.5, 10.0)
LON_RANGE = (79.0, 82.2)
AREA_RANGE = (0.05, 200.0)
PRIORITY_KEYS = ("save_water", "income", "soil", "low_work", "family_food")
PRIORITY_TOLERANCE = 0.01


def check_lat(v):
    if not LAT_RANGE[0] <= v <= LAT_RANGE[1]:
        raise ValueError(f"lat must be between {LAT_RANGE[0]} and {LAT_RANGE[1]} (Sri Lanka); got {v}")
    return v


def check_lon(v):
    if not LON_RANGE[0] <= v <= LON_RANGE[1]:
        raise ValueError(f"lon must be between {LON_RANGE[0]} and {LON_RANGE[1]} (Sri Lanka); got {v}")
    return v


def check_area(v):
    if not AREA_RANGE[0] <= v <= AREA_RANGE[1]:
        raise ValueError(f"area_ha must be between {AREA_RANGE[0]} and {AREA_RANGE[1]} hectares; got {v}")
    return v


class Priorities(BaseModel):
    save_water: float
    income: float
    soil: float
    low_work: float
    family_food: float

    @field_validator("*")
    @classmethod
    def each_zero_to_one(cls, v):
        if not 0 <= v <= 1:
            raise ValueError("each priority must be between 0 and 1")
        return v


class CropHistoryItem(BaseModel):
    season: str
    crop_id: str

    @field_validator("season", "crop_id")
    @classmethod
    def not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("season and crop_id must not be empty")
        return v.strip()


Level = Literal["low", "medium", "high"]


class FarmIn(BaseModel):
    name: str | None = None
    lat: float
    lon: float
    area_ha: float
    polygon: dict | None = None
    water_source: Literal["rain-fed", "tank", "well", "canal"]
    yala_water: Literal["yes", "limited", "no"]
    labour: Level
    equipment: Level
    priorities: Priorities
    crop_history: list[CropHistoryItem] = []

    @field_validator("lat")
    @classmethod
    def _lat(cls, v):
        return check_lat(v)

    @field_validator("lon")
    @classmethod
    def _lon(cls, v):
        return check_lon(v)

    @field_validator("area_ha")
    @classmethod
    def _area(cls, v):
        return check_area(v)


class FarmPatch(BaseModel):
    """Every field optional: only what is sent is changed."""
    name: str | None = None
    lat: float | None = None
    lon: float | None = None
    area_ha: float | None = None
    polygon: dict | None = None
    water_source: Literal["rain-fed", "tank", "well", "canal"] | None = None
    yala_water: Literal["yes", "limited", "no"] | None = None
    labour: Level | None = None
    equipment: Level | None = None
    priorities: Priorities | None = None
    crop_history: list[CropHistoryItem] | None = None

    @field_validator("lat")
    @classmethod
    def _lat(cls, v):
        return v if v is None else check_lat(v)

    @field_validator("lon")
    @classmethod
    def _lon(cls, v):
        return v if v is None else check_lon(v)

    @field_validator("area_ha")
    @classmethod
    def _area(cls, v):
        return v if v is None else check_area(v)


class GroundtruthIn(BaseModel):
    question_key: str
    satellite_value: str | None = None
    answer: Literal["yes", "no"]

    @field_validator("question_key")
    @classmethod
    def key_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("question_key must not be empty")
        return v.strip()


# ---- helpers ---------------------------------------------------------------------------------------------------------

def normalise_priorities(p):
    """Priorities must add up to 1 within 0.01; they are then scaled to add up to exactly 1. Returns (dict, was_changed)."""
    values = {k: float(getattr(p, k)) for k in PRIORITY_KEYS}
    total = sum(values.values())
    if abs(total - 1.0) > PRIORITY_TOLERANCE:
        raise HTTPException(status_code=422, detail=f"priorities must add up to 1 (within 0.01); they add up to {round(total, 3)}")
    scaled = {k: round(v / total, 4) for k, v in values.items()}
    return scaled, abs(total - 1.0) > 1e-9


def circle_polygon(lat, lon, area_ha, points=32):
    """A circle of the given area around the pin (used when the farmer did not draw the field). GeoJSON, [lon, lat]."""
    radius_m = math.sqrt(area_ha * 10_000 / math.pi)
    dlat = radius_m / 111_320.0
    dlon = radius_m / (111_320.0 * math.cos(math.radians(lat)))
    ring = [[round(lon + dlon * math.cos(2 * math.pi * i / points), 6), round(lat + dlat * math.sin(2 * math.pi * i / points), 6)]
            for i in range(points)]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def check_polygon(poly):
    """A drawn polygon must be a GeoJSON Polygon with a closed ring of at least 4 positions inside Sri Lanka."""
    try:
        if poly.get("type") != "Polygon":
            raise ValueError("type must be Polygon")
        ring = poly["coordinates"][0]
        if len(ring) < 4:
            raise ValueError("the outer ring needs at least 4 positions (the first repeated at the end)")
        if list(ring[0]) != list(ring[-1]):
            raise ValueError("the ring must be closed (first and last position equal)")
        for lon, lat in ring:
            check_lon(float(lon))
            check_lat(float(lat))
    except HTTPException:
        raise
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise HTTPException(status_code=422, detail=f"polygon is not a valid GeoJSON Polygon: {err}")
    return poly


def load_farm(db, farm_row):
    """Farm row plus its polygon, priorities and crop history, as the API returns it."""
    farm = dict(farm_row)
    fid = farm["id"]
    poly = db.execute("SELECT geojson, source FROM plot_polygon WHERE farm_id = ?", (fid,)).fetchone()
    farm["polygon"] = json.loads(poly["geojson"]) if poly else None
    farm["plot_source"] = poly["source"] if poly else None
    pri = db.execute("SELECT * FROM farmer_priority WHERE farm_id = ?", (fid,)).fetchone()
    farm["priorities"] = {k: pri[k] for k in PRIORITY_KEYS} if pri else None
    farm["crop_history"] = [row_to_dict(r) for r in
                            db.execute("SELECT season, crop_id FROM crop_history WHERE farm_id = ? ORDER BY id", (fid,))]
    return farm


def save_priorities(db, fid, pri):
    db.execute("INSERT OR REPLACE INTO farmer_priority (farm_id, save_water, income, soil, low_work, family_food) VALUES (?, ?, ?, ?, ?, ?)",
               (fid, *(pri[k] for k in PRIORITY_KEYS)))


def save_history(db, fid, items):
    db.execute("DELETE FROM crop_history WHERE farm_id = ?", (fid,))
    for item in items:
        db.execute("INSERT INTO crop_history (farm_id, season, crop_id) VALUES (?, ?, ?)", (fid, item.season, item.crop_id))


def save_polygon(db, fid, geojson, source):
    db.execute("INSERT OR REPLACE INTO plot_polygon (farm_id, geojson, source) VALUES (?, ?, ?)", (fid, json.dumps(geojson), source))


# ---- routes ----------------------------------------------------------------------------------------------------------

@router.post("/farms", status_code=201)
def create_farm(body: FarmIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    pri, changed = normalise_priorities(body.priorities)
    poly = check_polygon(body.polygon) if body.polygon else None
    now = now_iso()
    cur = db.execute(
        "INSERT INTO farm (farmer_id, name, lat, lon, area_ha, water_source, yala_water, labour, equipment, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (farmer["id"], body.name, body.lat, body.lon, body.area_ha, body.water_source, body.yala_water, body.labour, body.equipment, now, now))
    fid = cur.lastrowid
    save_polygon(db, fid, poly or circle_polygon(body.lat, body.lon, body.area_ha), "drawn" if poly else "circle")
    save_priorities(db, fid, pri)
    save_history(db, fid, body.crop_history)
    db.commit()
    out = load_farm(db, auth.own_farm(db, fid, farmer))
    out["priorities_normalised"] = changed
    return out


@router.get("/farms")
def list_farms(farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM farm WHERE farmer_id = ? ORDER BY id", (farmer["id"],)).fetchall()
    return [load_farm(db, r) for r in rows]


@router.get("/farms/{farm_id}")
def get_farm(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    return load_farm(db, auth.own_farm(db, farm_id, farmer))


@router.patch("/farms/{farm_id}")
def update_farm(farm_id: int, body: FarmPatch, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    farm = auth.own_farm(db, farm_id, farmer)
    sent = body.model_dump(exclude_unset=True)
    changed = False
    # simple columns
    cols = {k: sent[k] for k in ("name", "lat", "lon", "area_ha", "water_source", "yala_water", "labour", "equipment") if k in sent}
    for k in ("lat", "lon", "area_ha", "water_source", "yala_water", "labour", "equipment"):
        if k in cols and cols[k] is None:
            raise HTTPException(status_code=422, detail=f"{k} cannot be empty")
    if cols:
        cols["updated_at"] = now_iso()
        db.execute(f"UPDATE farm SET {', '.join(k + ' = ?' for k in cols)} WHERE id = ?", (*cols.values(), farm_id))
    # polygon: a drawn one replaces the old one; if the pin or area changed and the old one was a circle, redraw the circle
    if sent.get("polygon"):
        save_polygon(db, farm_id, check_polygon(sent["polygon"]), "drawn")
    if not sent.get("polygon") and {"lat", "lon", "area_ha"} & set(cols):
        old = db.execute("SELECT source FROM plot_polygon WHERE farm_id = ?", (farm_id,)).fetchone()
        if not old or old["source"] == "circle":
            new = db.execute("SELECT lat, lon, area_ha FROM farm WHERE id = ?", (farm_id,)).fetchone()
            save_polygon(db, farm_id, circle_polygon(new["lat"], new["lon"], new["area_ha"]), "circle")
    if body.priorities is not None:
        pri, changed = normalise_priorities(body.priorities)
        save_priorities(db, farm_id, pri)
    if body.crop_history is not None:
        save_history(db, farm_id, body.crop_history)
    db.execute("UPDATE farm SET updated_at = ? WHERE id = ?", (now_iso(), farm_id))
    db.commit()
    out = load_farm(db, auth.own_farm(db, farm_id, farmer))
    out["priorities_normalised"] = changed
    return out


@router.delete("/farms/{farm_id}")
def delete_farm(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    db.execute("DELETE FROM farm WHERE id = ?", (farm_id,))      # foreign keys with ON DELETE CASCADE remove every dependent row
    db.commit()
    return {"ok": True, "deleted_farm_id": farm_id}


def _rows(db, sql, params):
    return [row_to_dict(r) for r in db.execute(sql, params).fetchall()]


@router.get("/farms/{farm_id}/export")
def export_farm(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    """Everything stored for this farm (the farmer's right to take their data with them)."""
    farm = load_farm(db, auth.own_farm(db, farm_id, farmer))
    plans = _rows(db, "SELECT * FROM plan WHERE farm_id = ? ORDER BY id", (farm_id,))
    for plan in plans:
        plan["options"] = _rows(db, "SELECT * FROM plan_option WHERE plan_id = ? ORDER BY option_no", (plan["id"],))
        for opt in plan["options"]:
            opt["rule_trace"] = _rows(db, "SELECT * FROM plan_rule_trace WHERE plan_option_id = ?", (opt["id"],))
    points = _rows(db, "SELECT * FROM monitoring_point WHERE farm_id = ? ORDER BY id", (farm_id,))
    return {
        "exported_at": now_iso(),
        "farm": farm,
        "zones": _rows(db, "SELECT * FROM zone WHERE farm_id = ? ORDER BY id", (farm_id,)),
        "soil_layers": _rows(db, "SELECT * FROM soil_layer WHERE farm_id = ? ORDER BY id", (farm_id,)),
        "threats": _rows(db, "SELECT * FROM threat WHERE farm_id = ? ORDER BY id", (farm_id,)),
        "plans": plans,
        "groundtruth_responses": _rows(db, "SELECT * FROM groundtruth_response WHERE farm_id = ? ORDER BY id", (farm_id,)),
        "monitoring_points": points,
        "soil_observations": _rows(
            db, "SELECT o.* FROM soil_observation o JOIN monitoring_point p ON p.id = o.point_id WHERE p.farm_id = ? ORDER BY o.id", (farm_id,)),
        "season_reviews": _rows(db, "SELECT * FROM season_review WHERE farm_id = ? ORDER BY id", (farm_id,)),
        "issue_tickets": _rows(db, "SELECT * FROM issue_ticket WHERE farm_id = ? ORDER BY id", (farm_id,)),
        "note": "Practice entries belong to the farmer, not to one farm, so they are not part of a farm export or farm deletion.",
    }


@router.post("/farms/{farm_id}/groundtruth", status_code=201)
def add_groundtruth(farm_id: int, body: GroundtruthIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    cur = db.execute("INSERT INTO groundtruth_response (farm_id, question_key, satellite_value, answer, created_at) VALUES (?, ?, ?, ?, ?)",
                     (farm_id, body.question_key, body.satellite_value, body.answer, now_iso()))
    db.commit()
    return row_to_dict(db.execute("SELECT * FROM groundtruth_response WHERE id = ?", (cur.lastrowid,)).fetchone())
