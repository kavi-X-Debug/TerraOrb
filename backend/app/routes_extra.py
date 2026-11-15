"""
Mock-up stores (spec 3, F20 to F27): monitoring points, soil observations, a simple soil trend, season review, issue button and
traditional-practice entries. They only STORE what the farmer enters and show a simple trend; there is no analysis behind them.
Every response carries "mock": true so the screens can say "mock-up" plainly.

  POST/GET /api/farms/{id}/monitoring-points
  POST/GET /api/farms/{id}/soil-observations      GET /api/farms/{id}/soil-trend
  POST/GET /api/farms/{id}/season-review
  POST/GET /api/farms/{id}/issues
  POST/GET /api/practices                         visibility private | village | public

Lists come back as {"mock": true, "items": [...]}; a created row comes back with "mock": true added.
"""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from . import auth
from .db import get_db, now_iso, row_to_dict
from .routes_farms import check_lat, check_lon

router = APIRouter(prefix="/api")


def mock(row):
    return {**row, "mock": True}


def mock_list(rows):
    return {"mock": True, "items": rows}


def check_iso_date(v):
    try:
        date.fromisoformat(v)
    except (TypeError, ValueError):
        raise ValueError("date must look like 2026-03-15")
    return v


# ---- monitoring points -----------------------------------------------------------------------------------------------

class PointIn(BaseModel):
    lat: float
    lon: float
    label: str | None = None
    zone_id: int | None = None

    @field_validator("lat")
    @classmethod
    def _lat(cls, v):
        return check_lat(v)

    @field_validator("lon")
    @classmethod
    def _lon(cls, v):
        return check_lon(v)


@router.post("/farms/{farm_id}/monitoring-points", status_code=201)
def add_point(farm_id: int, body: PointIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    if body.zone_id is not None and not db.execute("SELECT 1 FROM zone WHERE id = ? AND farm_id = ?", (body.zone_id, farm_id)).fetchone():
        raise HTTPException(status_code=422, detail="zone_id does not belong to this farm")
    cur = db.execute("INSERT INTO monitoring_point (farm_id, zone_id, lat, lon, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (farm_id, body.zone_id, body.lat, body.lon, body.label, now_iso()))
    db.commit()
    return mock(row_to_dict(db.execute("SELECT * FROM monitoring_point WHERE id = ?", (cur.lastrowid,)).fetchone()))


@router.get("/farms/{farm_id}/monitoring-points")
def list_points(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    rows = db.execute("SELECT * FROM monitoring_point WHERE farm_id = ? ORDER BY id", (farm_id,)).fetchall()
    return mock_list([row_to_dict(r) for r in rows])


# ---- soil observations -----------------------------------------------------------------------------------------------

class ObservationIn(BaseModel):
    point_id: int
    visited_on: str
    earthworms: int | None = None
    infiltration_minutes: float | None = None
    colour_class: int | None = None
    crumb_class: int | None = None
    cover_percent: float | None = None
    ph: float | None = None
    note: str | None = None

    @field_validator("visited_on")
    @classmethod
    def _date(cls, v):
        return check_iso_date(v)

    @field_validator("earthworms")
    @classmethod
    def _worms(cls, v):
        if v is not None and not 0 <= v <= 1000:
            raise ValueError("earthworms must be a count between 0 and 1000")
        return v

    @field_validator("infiltration_minutes")
    @classmethod
    def _infil(cls, v):
        if v is not None and not 0 <= v <= 1440:
            raise ValueError("infiltration_minutes must be between 0 and 1440")
        return v

    @field_validator("colour_class", "crumb_class")
    @classmethod
    def _class(cls, v):
        if v is not None and not 1 <= v <= 5:
            raise ValueError("colour and crumb classes are 1 to 5")
        return v

    @field_validator("cover_percent")
    @classmethod
    def _cover(cls, v):
        if v is not None and not 0 <= v <= 100:
            raise ValueError("cover_percent must be between 0 and 100")
        return v

    @field_validator("ph")
    @classmethod
    def _ph(cls, v):
        if v is not None and not 3 <= v <= 10:
            raise ValueError("ph must be between 3 and 10")
        return v


@router.post("/farms/{farm_id}/soil-observations", status_code=201)
def add_observation(farm_id: int, body: ObservationIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    if not db.execute("SELECT 1 FROM monitoring_point WHERE id = ? AND farm_id = ?", (body.point_id, farm_id)).fetchone():
        raise HTTPException(status_code=422, detail="point_id is not a monitoring point of this farm")
    cur = db.execute(
        "INSERT INTO soil_observation (point_id, visited_on, earthworms, infiltration_minutes, colour_class, crumb_class, cover_percent, ph, note) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (body.point_id, body.visited_on, body.earthworms, body.infiltration_minutes, body.colour_class, body.crumb_class,
         body.cover_percent, body.ph, body.note))
    db.commit()
    return mock(row_to_dict(db.execute("SELECT * FROM soil_observation WHERE id = ?", (cur.lastrowid,)).fetchone()))


@router.get("/farms/{farm_id}/soil-observations")
def list_observations(farm_id: int, point_id: int | None = None, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    sql = "SELECT o.* FROM soil_observation o JOIN monitoring_point p ON p.id = o.point_id WHERE p.farm_id = ?"
    params = [farm_id]
    if point_id is not None:
        sql += " AND o.point_id = ?"
        params.append(point_id)
    rows = db.execute(sql + " ORDER BY o.visited_on, o.id", params).fetchall()
    return mock_list([row_to_dict(r) for r in rows])


TREND_METRICS = ("earthworms", "infiltration_minutes", "colour_class", "crumb_class", "cover_percent", "ph")


@router.get("/farms/{farm_id}/soil-trend")
def soil_trend(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    """Per monitoring point and measure: first value, latest value and the change. Needs two or more visits with a value, else
    it says "not enough data". This is a plain before/after, not a statistical analysis."""
    auth.own_farm(db, farm_id, farmer)
    points = db.execute("SELECT * FROM monitoring_point WHERE farm_id = ? ORDER BY id", (farm_id,)).fetchall()
    out = []
    for p in points:
        obs = db.execute("SELECT * FROM soil_observation WHERE point_id = ? ORDER BY visited_on, id", (p["id"],)).fetchall()
        metrics = {}
        for m in TREND_METRICS:
            series = [(o["visited_on"], o[m]) for o in obs if o[m] is not None]
            if len(series) < 2:
                metrics[m] = {"status": "not enough data", "visits": len(series)}
                continue
            first, last = series[0], series[-1]
            change = round(last[1] - first[1], 3)
            metrics[m] = {"status": "ok", "visits": len(series), "first": {"date": first[0], "value": first[1]},
                          "latest": {"date": last[0], "value": last[1]}, "change": change,
                          "direction": "up" if change > 0 else "down" if change < 0 else "same"}
        out.append({"point_id": p["id"], "label": p["label"], "visits": len(obs), "metrics": metrics})
    return {"mock": True, "note": "Simple before/after from the farmer's own measurements; not an analysis.", "points": out}


# ---- season review ---------------------------------------------------------------------------------------------------

class SeasonReviewIn(BaseModel):
    season: str | None = None
    planted: str | None = None
    yield_band: str | None = None
    problems: str | None = None
    plan_followed: str | None = None
    would_change: str | None = None


@router.post("/farms/{farm_id}/season-review", status_code=201)
def add_review(farm_id: int, body: SeasonReviewIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    cur = db.execute("INSERT INTO season_review (farm_id, season, planted, yield_band, problems, plan_followed, would_change, created_at) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (farm_id, body.season, body.planted, body.yield_band, body.problems, body.plan_followed, body.would_change, now_iso()))
    db.commit()
    return mock(row_to_dict(db.execute("SELECT * FROM season_review WHERE id = ?", (cur.lastrowid,)).fetchone()))


@router.get("/farms/{farm_id}/season-review")
def list_reviews(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    rows = db.execute("SELECT * FROM season_review WHERE farm_id = ? ORDER BY id", (farm_id,)).fetchall()
    return mock_list([row_to_dict(r) for r in rows])


# ---- issue button ----------------------------------------------------------------------------------------------------

class IssueIn(BaseModel):
    kind: str | None = None
    crop_id: str | None = None
    text: str

    @field_validator("text")
    @classmethod
    def _text(cls, v):
        if not v or not v.strip():
            raise ValueError("text must not be empty")
        return v.strip()


@router.post("/farms/{farm_id}/issues", status_code=201)
def add_issue(farm_id: int, body: IssueIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    cur = db.execute("INSERT INTO issue_ticket (farm_id, kind, crop_id, text, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
                     (farm_id, body.kind, body.crop_id, body.text, now_iso()))
    db.commit()
    return mock(row_to_dict(db.execute("SELECT * FROM issue_ticket WHERE id = ?", (cur.lastrowid,)).fetchone()))


@router.get("/farms/{farm_id}/issues")
def list_issues(farm_id: int, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    auth.own_farm(db, farm_id, farmer)
    rows = db.execute("SELECT * FROM issue_ticket WHERE farm_id = ? ORDER BY id", (farm_id,)).fetchall()
    return mock_list([row_to_dict(r) for r in rows])


# ---- traditional-practice entries ------------------------------------------------------------------------------------

class PracticeIn(BaseModel):
    name: str
    plants: str | None = None
    zone_or_soil: str | None = None
    season: str | None = None
    effect: str | None = None
    holder: str | None = None
    years_in_use: int | None = None
    visibility: Literal["private", "village", "public"] = "private"
    show_name: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("years_in_use")
    @classmethod
    def _years(cls, v):
        if v is not None and not 0 <= v <= 200:
            raise ValueError("years_in_use must be between 0 and 200")
        return v


@router.post("/practices", status_code=201)
def add_practice(body: PracticeIn, farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    # status always starts as "traditional only": nothing here has been checked against platform data or research
    cur = db.execute(
        "INSERT INTO practice_entry (farmer_id, name, plants, zone_or_soil, season, effect, holder, years_in_use, visibility, show_name, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'traditional only', ?)",
        (farmer["id"], body.name, body.plants, body.zone_or_soil, body.season, body.effect, body.holder, body.years_in_use,
         body.visibility, int(body.show_name), now_iso()))
    db.commit()
    return mock(_practice_view(db.execute("SELECT * FROM practice_entry WHERE id = ?", (cur.lastrowid,)).fetchone(), farmer["id"]))


def _practice_view(row, viewer_id):
    """The owner sees everything. Others see the entry without the holder's name unless the owner agreed (show_name)."""
    d = row_to_dict(row)
    d["show_name"] = bool(d["show_name"])
    d["own"] = d["farmer_id"] == viewer_id
    if not d["own"]:
        if not d["show_name"]:
            d["holder"] = None
        del d["farmer_id"]                               # never reveal who else owns an entry
    return d


@router.get("/practices")
def list_practices(farmer=Depends(auth.current_farmer), db=Depends(get_db)):
    """Own entries (any visibility) plus other farmers' entries marked village or public. The mock-up has no village list yet,
    so "village" is shown to every logged-in farmer; a real village group is on the roadmap."""
    rows = db.execute("SELECT * FROM practice_entry WHERE farmer_id = ? OR visibility IN ('village', 'public') ORDER BY id",
                      (farmer["id"],)).fetchall()
    return mock_list([_practice_view(r, farmer["id"]) for r in rows])
