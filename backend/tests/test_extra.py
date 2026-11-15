"""Tests for routes_extra.py (mock-up stores). Run from the repo root: set PYTHONPATH=. then  .venv\\Scripts\\python.exe -W ignore -m pytest backend\\tests -q"""
import os
import tempfile

os.environ["MC_DB"] = os.path.join(tempfile.mkdtemp(), "test_extra.db")      # set before importing the app
os.environ["MC_DEV"] = "1"

import pytest
from fastapi.testclient import TestClient

from backend.app import db as dbmod
from backend.app.main import app

FARM = {"name": "F", "lat": 8.31, "lon": 80.40, "area_ha": 1.0, "water_source": "rain-fed", "yala_water": "no", "labour": "low",
        "equipment": "low", "priorities": {"save_water": 0.2, "income": 0.2, "soil": 0.2, "low_work": 0.2, "family_food": 0.2}}


@pytest.fixture()
def client(tmp_path):
    os.environ["MC_DB"] = str(tmp_path / "t.db")
    dbmod.init_db()
    return TestClient(app)


def login(client, phone):
    code = client.post("/api/auth/request", json={"phone": phone}).json()["dev_code"]
    token = client.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def make_farm(client, h):
    return client.post("/api/farms", json=FARM, headers=h).json()["id"]


def test_points_and_observations_and_trend(client):
    h = login(client, "0771111111")
    fid = make_farm(client, h)
    p = client.post(f"/api/farms/{fid}/monitoring-points", json={"lat": 8.31, "lon": 80.4, "label": "north"}, headers=h)
    assert p.status_code == 201 and p.json()["mock"] is True
    pid = p.json()["id"]
    assert client.get(f"/api/farms/{fid}/monitoring-points", headers=h).json()["mock"] is True
    assert client.post(f"/api/farms/{fid}/monitoring-points", json={"lat": 40, "lon": 80.4}, headers=h).status_code == 422

    trend = client.get(f"/api/farms/{fid}/soil-trend", headers=h).json()
    assert trend["points"][0]["metrics"]["earthworms"]["status"] == "not enough data"

    for day, worms in (("2026-01-01", 2), ("2026-06-01", 7)):
        r = client.post(f"/api/farms/{fid}/soil-observations", json={"point_id": pid, "visited_on": day, "earthworms": worms, "ph": 6.5}, headers=h)
        assert r.status_code == 201 and r.json()["mock"] is True
    t = client.get(f"/api/farms/{fid}/soil-trend", headers=h).json()["points"][0]["metrics"]
    assert t["earthworms"]["change"] == 5 and t["earthworms"]["direction"] == "up"
    assert t["ph"]["direction"] == "same" and t["cover_percent"]["status"] == "not enough data"
    assert len(client.get(f"/api/farms/{fid}/soil-observations", headers=h).json()["items"]) == 2

    for bad in ({"visited_on": "tomorrow"}, {"visited_on": "2026-01-01", "cover_percent": 150}, {"visited_on": "2026-01-01", "ph": 14}):
        assert client.post(f"/api/farms/{fid}/soil-observations", json={"point_id": pid, **bad}, headers=h).status_code == 422


def test_other_farmers_point_rejected_and_hidden(client):
    a, b = login(client, "0771111111"), login(client, "0772222222")
    fa, fb = make_farm(client, a), make_farm(client, b)
    pid = client.post(f"/api/farms/{fa}/monitoring-points", json={"lat": 8.3, "lon": 80.4}, headers=a).json()["id"]
    assert client.get(f"/api/farms/{fa}/monitoring-points", headers=b).status_code == 404
    assert client.get(f"/api/farms/{fa}/soil-trend", headers=b).status_code == 404
    # farmer b cannot attach an observation to a's point, even through b's own farm
    r = client.post(f"/api/farms/{fb}/soil-observations", json={"point_id": pid, "visited_on": "2026-01-01"}, headers=b)
    assert r.status_code == 422


def test_review_and_issues(client):
    a, b = login(client, "0771111111"), login(client, "0772222222")
    fid = make_farm(client, a)
    r = client.post(f"/api/farms/{fid}/season-review", json={"season": "Maha 2025/26", "planted": "paddy", "yield_band": "medium"}, headers=a)
    assert r.status_code == 201 and r.json()["mock"] is True
    i = client.post(f"/api/farms/{fid}/issues", json={"kind": "pest", "crop_id": "paddy", "text": "leaf folder"}, headers=a)
    assert i.status_code == 201 and i.json()["status"] == "open" and i.json()["mock"] is True
    assert client.post(f"/api/farms/{fid}/issues", json={"text": "  "}, headers=a).status_code == 422
    assert len(client.get(f"/api/farms/{fid}/issues", headers=a).json()["items"]) == 1
    assert client.post(f"/api/farms/{fid}/issues", json={"text": "x"}, headers=b).status_code == 404
    assert client.post(f"/api/farms/{fid}/season-review", json={}, headers=b).status_code == 404


def test_practices_visibility(client):
    a, b = login(client, "0771111111"), login(client, "0772222222")

    def mk(**kw):
        return client.post("/api/practices", json={"name": "ash on seed", "holder": "Grandfather Silva", **kw}, headers=a)

    first = mk().json()
    assert first["visibility"] == "private" and first["status"] == "traditional only" and first["mock"] is True
    mk(name="village one", visibility="village")
    mk(name="public named", visibility="public", show_name=True)
    assert mk(visibility="secret").status_code == 422

    mine = client.get("/api/practices", headers=a).json()
    assert mine["mock"] is True and len(mine["items"]) == 3
    seen = client.get("/api/practices", headers=b).json()["items"]
    assert sorted(x["name"] for x in seen) == ["public named", "village one"]            # private entries stay private
    by_name = {x["name"]: x for x in seen}
    assert by_name["village one"]["holder"] is None                                       # name hidden unless show_name
    assert by_name["public named"]["holder"] == "Grandfather Silva"
    assert all("farmer_id" not in x for x in seen)
    assert client.get("/api/practices").status_code == 401
