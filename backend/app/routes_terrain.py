"""
Terrain zones, soil layers and threats of a farm (spec section 6, functions F7 to F10). All under /api/farms/{id}/...

  POST /zones/compute      build zones from the open elevation tiles and store them as version "computed" (502 if the tiles cannot be fetched)
  GET  /zones              computed zones and the farmer's edited zones
  PUT  /zones              replace the farmer's edited zones (computed ones are kept)
  GET  /soil               soil layers: "modelled" (SoilGrids) and "measured_by_farmer" are kept apart, never mixed
  PUT  /soil               replace the farmer's own measured layers
  POST /soil/modelled      fetch modelled soil (SoilGrids, about 250 m) for the farm point; 502 if it cannot be reached
  GET  /threats            computed threats (erosion, waterlogging, drought, heat) and the farmer's own list
  POST /threats            add a farmer-listed threat (wild animals, theft, pests, flooding history)
  POST /threats/refresh    recompute the computed threats from the stored zones, soil and farm answers
  DELETE /threats/{id}     remove a farmer-listed threat

Elevation is never invented: if it cannot be fetched the answer is an error that says so.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import terrain
from .auth import current_farmer, own_farm
from .db import get_db, now_iso

router = APIRouter(prefix="/api")

SOIL_PROPERTIES = ("texture", "ph", "organic_carbon", "drainage", "colour")
SOURCES = ("modelled", "measured_by_farmer")
FARMER_THREATS = ("wild_animals", "theft", "pests", "flooding_history")
DRAINAGE = ("well", "moderate", "poor")


# ----------------------------------------------------------------- helpers

def farm_ring_and_source(db, farm):
    """The plot's outer ring: the stored polygon, else a circle of area_ha around the pin."""
    row = db.execute("SELECT geojson, source FROM plot_polygon WHERE farm_id = ?", (farm["id"],)).fetchone()
    if row:
        try:
            return terrain.outer_ring(json.loads(row["geojson"])), row["source"]
        except (ValueError, KeyError, TypeError):
            pass                                              # a broken stored polygon falls back to the circle
    return terrain.outer_ring(terrain.circle_polygon(farm["lat"], farm["lon"], farm["area_ha"])), "circle"


def effective_soil(db, farm_id):
    """{property: value} for the whole farm: what the farmer measured, else the modelled value."""
    out = {}
    for source in ("modelled", "measured_by_farmer"):         # the farmer's value is read last and so wins
        for r in db.execute("SELECT property, value FROM soil_layer WHERE farm_id = ? AND zone_id IS NULL AND source = ?", (farm_id, source)):
            out[r["property"]] = r["value"]
    return out


def zone_out(row):
    feature = json.loads(row["geojson"])
    return {"id": row["id"], "kind": row["kind"], "version": row["version"], "area_ha": row["area_ha"],
            "mean_slope_pct": row["mean_slope_pct"], "created_at": row["created_at"], "feature": feature}


def computed_zone_dicts(db, farm_id):
    out = []
    for r in db.execute("SELECT * FROM zone WHERE farm_id = ? AND version = 'computed'", (farm_id,)):
        props = json.loads(r["geojson"]).get("properties", {})
        out.append({"id": r["id"], "kind": r["kind"], "area_ha": r["area_ha"] or 0, "erosion_index": props.get("erosion_index")})
    return out


def refresh_threats(db, farm):
    """Replace the farm's computed threats. Erosion and waterlogging need computed zones; drought and heat do not."""
    zones = computed_zone_dicts(db, farm["id"])
    threats = terrain.computed_threats(zones, farm, effective_soil(db, farm["id"]))
    db.execute("DELETE FROM threat WHERE farm_id = ? AND source = 'computed'", (farm["id"],))
    now = now_iso()
    for t in threats:
        zid = None
        if t["kind"] == "erosion" and zones:
            zid = max(zones, key=lambda z: z.get("erosion_index") or 0)["id"]
        elif t["kind"] == "waterlogging":
            wet = [z for z in zones if z["kind"] == "wet_low"]
            zid = max(wet, key=lambda z: z["area_ha"])["id"] if wet else None
        db.execute("INSERT INTO threat (farm_id, zone_id, kind, level, source, note, created_at) VALUES (?, ?, ?, ?, 'computed', ?, ?)",
                   (farm["id"], zid, t["kind"], t["level"], t["note"], now))
    db.commit()


# ----------------------------------------------------------------- zones

class ComputeIn(BaseModel):
    zoom: int = 15                  # 15 is about 5 m per cell at this latitude; lowered automatically for big plots
    c_factor: float = terrain.C_FACTOR_DEFAULT


@router.post("/farms/{farm_id}/zones/compute")
def compute_zones(farm_id: int, body: ComputeIn | None = None, farmer=Depends(current_farmer), db=Depends(get_db)):
    farm = own_farm(db, farm_id, farmer)
    body = body or ComputeIn()
    if not 12 <= body.zoom <= 15:
        raise HTTPException(status_code=422, detail="zoom must be between 12 and 15")
    if not 0 < body.c_factor <= 1:
        raise HTTPException(status_code=422, detail="c_factor must be above 0 and at most 1")
    ring, plot_source = farm_ring_and_source(db, farm)
    try:
        dem = terrain.build_dem(terrain.ring_bbox(ring), zoom=body.zoom)
    except terrain.DemUnavailable as err:
        raise HTTPException(status_code=502, detail=f"Elevation data could not be fetched ({err}). No zones were made; try again later.")
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    try:
        result = terrain.analyse(dem, ring, texture=effective_soil(db, farm_id).get("texture"), c_factor=body.c_factor)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    summary = result["summary"]
    summary["plot_source"] = plot_source
    now = now_iso()
    db.execute("DELETE FROM zone WHERE farm_id = ? AND version = 'computed'", (farm_id,))
    for z in result["zones"]:
        feature = {"type": "Feature", "geometry": z["geometry"], "properties": {
            "kind": z["kind"], "version": "computed", "area_ha": z["area_ha"], "mean_slope_pct": z["mean_slope_pct"],
            "erosion_index": z["erosion_index"], "erosion_level": z["erosion_level"],
            "erosion_index_with_contour_hedges": z["erosion_index_with_contour_hedges"],
            "erosion_note": "relative index, not tonnes per hectare", "source": "modelled from " + summary["dem_source"]}}
        db.execute("INSERT INTO zone (farm_id, kind, geojson, version, area_ha, mean_slope_pct, created_at) VALUES (?, ?, ?, 'computed', ?, ?, ?)",
                   (farm_id, z["kind"], json.dumps(feature), z["area_ha"], z["mean_slope_pct"], now))
    db.commit()
    refresh_threats(db, farm)
    return {"ok": True, "summary": summary, **zones_payload(db, farm_id)}


def zones_payload(db, farm_id):
    rows = db.execute("SELECT * FROM zone WHERE farm_id = ? ORDER BY area_ha DESC, id", (farm_id,)).fetchall()
    computed = [zone_out(r) for r in rows if r["version"] == "computed"]
    edited = [zone_out(r) for r in rows if r["version"] == "edited"]
    return {"computed": computed, "edited": edited, "current": "edited" if edited else ("computed" if computed else None)}


@router.get("/farms/{farm_id}/zones")
def get_zones(farm_id: int, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    return zones_payload(db, farm_id)


class EditedZone(BaseModel):
    kind: str
    geometry: dict
    mean_slope_pct: float | None = None


class ZonesIn(BaseModel):
    zones: list[EditedZone]


@router.put("/farms/{farm_id}/zones")
def put_zones(farm_id: int, body: ZonesIn, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    rows = []
    for z in body.zones:
        if z.kind not in terrain.KINDS:
            raise HTTPException(status_code=422, detail=f"zone kind must be one of {', '.join(terrain.KINDS)}")
        if z.geometry.get("type") not in ("Polygon", "MultiPolygon"):
            raise HTTPException(status_code=422, detail="a zone geometry must be a GeoJSON Polygon or MultiPolygon")
        try:
            area = round(terrain.polygon_area_ha(z.geometry), 4)
        except (ValueError, KeyError, IndexError, TypeError, ZeroDivisionError):
            raise HTTPException(status_code=422, detail="a zone geometry is not a valid polygon")
        feature = {"type": "Feature", "geometry": z.geometry, "properties": {"kind": z.kind, "version": "edited", "area_ha": area,
                                                                              "source": "edited by the farmer"}}
        rows.append((z.kind, json.dumps(feature), area, z.mean_slope_pct))
    db.execute("DELETE FROM zone WHERE farm_id = ? AND version = 'edited'", (farm_id,))
    now = now_iso()
    for kind, gj, area, slope in rows:
        db.execute("INSERT INTO zone (farm_id, kind, geojson, version, area_ha, mean_slope_pct, created_at) VALUES (?, ?, ?, 'edited', ?, ?, ?)",
                   (farm_id, kind, gj, area, slope, now))
    db.commit()
    return zones_payload(db, farm_id)


# ----------------------------------------------------------------- soil

def soil_payload(db, farm_id):
    rows = [dict(r) for r in db.execute("SELECT * FROM soil_layer WHERE farm_id = ? ORDER BY property, id", (farm_id,))]
    modelled = [r for r in rows if r["source"] == "modelled"]
    measured = [r for r in rows if r["source"] == "measured_by_farmer"]
    effective = {}
    for r in modelled + measured:                          # measured is read last and wins; each entry keeps its own label
        if r["zone_id"] is None:
            effective[r["property"]] = {"value": r["value"], "source": r["source"]}
    return {"modelled": modelled, "measured_by_farmer": measured, "effective": effective,
            "note": "Modelled values come from a global soil model (about 250 m); they are not measurements. A value you measured is always used first."}


@router.get("/farms/{farm_id}/soil")
def get_soil(farm_id: int, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    return soil_payload(db, farm_id)


class SoilLayerIn(BaseModel):
    property: str
    value: str
    zone_id: int | None = None
    source: str = "measured_by_farmer"


class SoilIn(BaseModel):
    layers: list[SoilLayerIn]


def check_soil_value(prop, value):
    value = str(value).strip()
    if not value or len(value) > 40:
        raise HTTPException(status_code=422, detail=f"{prop} needs a short value")
    if prop == "ph":
        try:
            ph = float(value)
        except ValueError:
            raise HTTPException(status_code=422, detail="pH must be a number")
        if not 3.0 <= ph <= 10.0:
            raise HTTPException(status_code=422, detail="pH must be between 3 and 10")
    elif prop == "drainage" and value.lower() not in DRAINAGE:
        raise HTTPException(status_code=422, detail=f"drainage must be one of {', '.join(DRAINAGE)}")
    elif prop == "texture" and value.lower() not in set(terrain.K_BY_TEXTURE) | {"sandy_clay"}:
        raise HTTPException(status_code=422, detail="texture must be a soil texture class such as sandy_loam or clay")
    elif prop == "organic_carbon":
        try:
            float(value)
        except ValueError:
            raise HTTPException(status_code=422, detail="organic carbon must be a number")
    return value.lower() if prop in ("texture", "drainage") else value


@router.put("/farms/{farm_id}/soil")
def put_soil(farm_id: int, body: SoilIn, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    clean = []
    for layer in body.layers:
        if layer.source != "measured_by_farmer":
            raise HTTPException(status_code=422, detail="only measured_by_farmer values can be saved here; modelled values are set by the server")
        if layer.property not in SOIL_PROPERTIES:
            raise HTTPException(status_code=422, detail=f"property must be one of {', '.join(SOIL_PROPERTIES)}")
        if layer.zone_id is not None and not db.execute("SELECT 1 FROM zone WHERE id = ? AND farm_id = ?", (layer.zone_id, farm_id)).fetchone():
            raise HTTPException(status_code=422, detail="zone_id does not belong to this farm")
        clean.append((layer.zone_id, layer.property, check_soil_value(layer.property, layer.value)))
    db.execute("DELETE FROM soil_layer WHERE farm_id = ? AND source = 'measured_by_farmer'", (farm_id,))
    now = now_iso()
    for zid, prop, value in clean:
        db.execute("INSERT INTO soil_layer (farm_id, zone_id, property, value, source, updated_at) VALUES (?, ?, ?, ?, 'measured_by_farmer', ?)",
                   (farm_id, zid, prop, value, now))
    db.commit()
    return soil_payload(db, farm_id)


@router.post("/farms/{farm_id}/soil/modelled")
def fetch_modelled_soil(farm_id: int, farmer=Depends(current_farmer), db=Depends(get_db)):
    farm = own_farm(db, farm_id, farmer)
    try:
        values = terrain.fetch_soilgrids(farm["lat"], farm["lon"])
    except (RuntimeError, ValueError, KeyError, IndexError) as err:
        raise HTTPException(status_code=502, detail=f"Modelled soil could not be fetched ({err}). Nothing was stored; you can enter your own measurements.")
    db.execute("DELETE FROM soil_layer WHERE farm_id = ? AND source = 'modelled'", (farm_id,))
    now = now_iso()
    for prop, value in values.items():
        db.execute("INSERT INTO soil_layer (farm_id, zone_id, property, value, source, updated_at) VALUES (?, NULL, ?, ?, 'modelled', ?)",
                   (farm_id, prop, str(value), now))
    db.commit()
    return soil_payload(db, farm_id)


# ----------------------------------------------------------------- threats

def threats_payload(db, farm_id):
    rows = [dict(r) for r in db.execute("SELECT * FROM threat WHERE farm_id = ? ORDER BY id", (farm_id,))]
    return {"computed": [r for r in rows if r["source"] == "computed"], "farmer": [r for r in rows if r["source"] == "farmer"],
            "note": "Computed threats are modelled from satellite elevation and your answers; erosion is a relative index, not tonnes. Heat is unknown until the climate table is added."}


@router.get("/farms/{farm_id}/threats")
def get_threats(farm_id: int, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    return threats_payload(db, farm_id)


class ThreatIn(BaseModel):
    kind: str
    note: str | None = None
    zone_id: int | None = None


@router.post("/farms/{farm_id}/threats")
def add_threat(farm_id: int, body: ThreatIn, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    if body.kind not in FARMER_THREATS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {', '.join(FARMER_THREATS)}")
    if body.zone_id is not None and not db.execute("SELECT 1 FROM zone WHERE id = ? AND farm_id = ?", (body.zone_id, farm_id)).fetchone():
        raise HTTPException(status_code=422, detail="zone_id does not belong to this farm")
    note = (body.note or "").strip()[:500] or None
    db.execute("INSERT INTO threat (farm_id, zone_id, kind, level, source, note, created_at) VALUES (?, ?, ?, NULL, 'farmer', ?, ?)",
               (farm_id, body.zone_id, body.kind, note, now_iso()))
    db.commit()
    return threats_payload(db, farm_id)


@router.post("/farms/{farm_id}/threats/refresh")
def refresh(farm_id: int, farmer=Depends(current_farmer), db=Depends(get_db)):
    farm = own_farm(db, farm_id, farmer)
    refresh_threats(db, farm)
    return threats_payload(db, farm_id)


@router.delete("/farms/{farm_id}/threats/{threat_id}")
def delete_threat(farm_id: int, threat_id: int, farmer=Depends(current_farmer), db=Depends(get_db)):
    own_farm(db, farm_id, farmer)
    row = db.execute("SELECT source FROM threat WHERE id = ? AND farm_id = ?", (threat_id, farm_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="threat not found")
    if row["source"] != "farmer":
        raise HTTPException(status_code=403, detail="computed threats are recalculated, not deleted")
    db.execute("DELETE FROM threat WHERE id = ?", (threat_id,))
    db.commit()
    return threats_payload(db, farm_id)
