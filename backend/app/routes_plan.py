"""/api/farms/{id}/plan (run the engine, store, return three cards), /plan/latest, and the public knowledge endpoints."""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import auth, engine
from .db import get_db, now_iso

router = APIRouter(prefix="/api")

FARM_DATA = Path(__file__).resolve().parents[2] / "data" / "farm"
MAHA_MONTHS, YALA_MONTHS = (10, 11, 12, 1), (5, 6, 7, 8)        # four wettest-season months used for one crop cycle (draft)
_knowledge = None


def knowledge():
    global _knowledge
    if _knowledge is None or not _knowledge.crops:      # reload until the knowledge files exist
        _knowledge = engine.load_knowledge()
    return _knowledge


class ScenarioIn(BaseModel):
    rain_factor: float = 1.0                 # 0.8 = 20% drier than the usual season (a stress test, not a forecast)
    onset_delay_days: int = 0


class PlanIn(BaseModel):
    scenario: ScenarioIn | None = None


# ---------- building the engine input from the database ----------

def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _seasonal_rain(lat, lon):
    """Mean rain (mm) for a Maha and a Yala crop cycle from data/farm/climate_monthly.json, if the profile agent's table exists and
    has a usable shape. Returns None otherwise (then the rain test is reported as 'not checked', never guessed)."""
    try:
        table = json.loads((FARM_DATA / "climate_monthly.json").read_text(encoding="utf-8"))
        cells = table.get("cells", table) if isinstance(table, dict) else {}
        # the NASA POWER square that contains the farm (0.5 deg tall, 0.625 deg wide), same rule as pipeline/rain.py
        key = f"{round(lat / 0.5) * 0.5}_{round(lon / 0.625) * 0.625}"
        best = cells.get(key)
        if not isinstance(best, dict):
            return None                                   # farm outside the covered squares: rain test not checked
        try:
            rain = [best[str(m)]["rain_mm"]["mean"] for m in range(1, 13)]   # layout of data/farm/climate_monthly.json
        except (KeyError, TypeError):
            return None
        if any(r is None for r in rain):
            return None
        return {"maha": round(sum(rain[m - 1] for m in MAHA_MONTHS), 1), "yala": round(sum(rain[m - 1] for m in YALA_MONTHS), 1),
                "source": "data/farm/climate_monthly.json"}
    except (OSError, ValueError, AttributeError):
        return None


def _load_ctx(db, farm):
    fid, missing = farm["id"], []
    rows = [dict(r) for r in db.execute("SELECT * FROM zone WHERE farm_id = ? ORDER BY id", (fid,))]
    edited = [z for z in rows if z["version"] == "edited"]
    zones_db = edited or rows
    soil = [dict(r) for r in db.execute("SELECT * FROM soil_layer WHERE farm_id = ?", (fid,))]
    threats = [dict(r) for r in db.execute("SELECT * FROM threat WHERE farm_id = ?", (fid,))]

    def soil_value(zone_id, prop):
        cands = [s for s in soil if s["property"] == prop and s["zone_id"] in (zone_id, None)]
        cands.sort(key=lambda s: (s["source"] != "measured_by_farmer", s["zone_id"] is None))   # farmer-measured, then zone-specific, first
        return cands[0]["value"] if cands else None

    def level(zone_id, kind):
        cands = [t["level"] for t in threats if t["kind"] == kind and t["source"] == "computed" and t["zone_id"] in (zone_id, None) and t["level"]]
        return cands[0] if cands else None

    rain = _seasonal_rain(farm["lat"], farm["lon"])
    if not zones_db:
        missing.append("zones")
        zones_db = [{"id": None, "kind": "flat", "mean_slope_pct": None, "area_ha": farm["area_ha"]}]
    if not soil:
        missing.append("soil")
    if rain is None:
        missing.append("rain")
    zones = []
    for z in zones_db:
        zid = z["id"]
        drainage = soil_value(zid, "drainage") or ("poor" if z["kind"] == "wet_low" else None)
        zones.append({"id": zid, "kind": z["kind"], "area_ha": z.get("area_ha"), "slope_pct": z.get("mean_slope_pct"),
                      "wet_low": z["kind"] == "wet_low", "tmean_c": None, "drainage": drainage,
                      "texture": soil_value(zid, "texture"), "ph": _num(soil_value(zid, "ph")), "water_source": farm.get("water_source"),
                      "erosion_level": level(zid, "erosion"), "bare_months": None, "cold_season": False,
                      "rain_mm_season": rain["maha"] if rain else None})
    pr = db.execute("SELECT * FROM farmer_priority WHERE farm_id = ?", (fid,)).fetchone()
    priorities = {k: pr[k] for k in ("save_water", "income", "soil", "low_work", "family_food")} if pr else None
    if not priorities:
        missing.append("priorities")
    history = [dict(r) for r in db.execute("SELECT season, crop_id FROM crop_history WHERE farm_id = ? ORDER BY id", (fid,))]
    if not history:
        missing.append("crop_history")
    ctx = {"zones": zones, "priorities": priorities, "history": history, "labour": farm.get("labour"),
           "water_source": farm.get("water_source"), "next_season": "maha",
           "rain_by_season": {"maha": rain["maha"], "yala": rain["yala"]} if rain else {},
           "data_quality": 0.6 if rain else 0.3, "local_verification": 0.2}
    return ctx, missing


# ---------- routes ----------

@router.post("/farms/{farm_id}/plan")
def make_plan(farm_id: int, body: PlanIn | None = None, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    farm = auth.own_farm(db, farm_id, farmer)
    sc = (body.scenario if body and body.scenario else ScenarioIn())
    if not 0.2 <= sc.rain_factor <= 2.0:
        raise HTTPException(status_code=422, detail="rain_factor must be between 0.2 and 2.0")
    k = knowledge()
    if not k.crops:
        raise HTTPException(status_code=503, detail="the crop knowledge base is not available yet")
    ctx, missing = _load_ctx(db, farm)
    result = engine.plan_cards(ctx, k, sc.rain_factor, sc.onset_delay_days)
    result.update({"inputs_missing": missing,
                   "notes": ["draft_rules_support_not_replace_local_expertise"] + (["inputs_not_available_flagged"] if missing else [])})
    now = now_iso()
    inputs = {"ctx": ctx, "scenario": sc.model_dump(), "inputs_missing": missing}
    cur = db.execute("INSERT INTO plan (farm_id, created_at, inputs_json, status) VALUES (?, ?, ?, ?)",
                     (farm_id, now, json.dumps(inputs), "flagged" if any(o["needs_officer"] for o in result["options"]) else "draft"))
    plan_id = cur.lastrowid
    for opt in result["options"]:
        c = db.execute("INSERT INTO plan_option (plan_id, option_no, name, result_json, confidence, confidence_class) VALUES (?, ?, ?, ?, ?, ?)",
                       (plan_id, opt["option_no"], opt["key"], json.dumps(opt), opt["confidence"]["score"], opt["confidence"]["class"]))
        for e in opt["trace"]:
            db.execute("INSERT INTO plan_rule_trace (plan_option_id, zone, season, crop_id, trace_json) VALUES (?, ?, ?, ?, ?)",
                       (c.lastrowid, None if e.get("zone") is None else str(e["zone"]), e.get("season"), e.get("crop_id"), json.dumps(e)))
    db.commit()
    result.update({"plan_id": plan_id, "created_at": now})
    return result


@router.get("/farms/{farm_id}/plan")
@router.get("/farms/{farm_id}/plan/latest")
def latest_plan(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    plan = db.execute("SELECT * FROM plan WHERE farm_id = ? ORDER BY id DESC LIMIT 1", (farm_id,)).fetchone()
    if not plan:
        raise HTTPException(status_code=404, detail="no plan yet; POST /api/farms/{id}/plan first")
    inputs = json.loads(plan["inputs_json"])
    options = [json.loads(r["result_json"]) for r in
               db.execute("SELECT result_json FROM plan_option WHERE plan_id = ? ORDER BY option_no", (plan["id"],))]
    return {"plan_id": plan["id"], "created_at": plan["created_at"], "status": plan["status"], "options": options,
            "scenario": inputs.get("scenario"), "inputs_missing": inputs.get("inputs_missing", [])}


@router.get("/knowledge/crops")
def knowledge_crops():
    k = knowledge()
    return {"crops": list(k.crops.values()), "missing": [m for m in k.missing if m == "crops.json"]}


@router.get("/knowledge/glossary")
def knowledge_glossary():
    k = knowledge()
    return {"glossary": k.glossary, "missing": [m for m in k.missing if m == "glossary.json"]}
