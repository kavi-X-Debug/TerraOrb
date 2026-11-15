"""Tests for routes_farms.py. Run from the repo root: set PYTHONPATH=. then  .venv\\Scripts\\python.exe -W ignore -m pytest backend\\tests -q"""
import os
import tempfile

os.environ["MC_DB"] = os.path.join(tempfile.mkdtemp(), "test_farms.db")      # set before importing the app
os.environ["MC_DEV"] = "1"

import pytest
from fastapi.testclient import TestClient

from backend.app import db as dbmod
from backend.app.main import app

PRI = {"save_water": 0.3, "income": 0.3, "soil": 0.2, "low_work": 0.1, "family_food": 0.1}


@pytest.fixture()
def client(tmp_path):
    os.environ["MC_DB"] = str(tmp_path / "t.db")          # a fresh database for every test
    dbmod.init_db()
    return TestClient(app)


def login(client, phone):
    code = client.post("/api/auth/request", json={"phone": phone}).json()["dev_code"]
    token = client.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def farm_body(**over):
    body = {"name": "Kamal field", "lat": 8.31, "lon": 80.40, "area_ha": 1.2, "water_source": "tank", "yala_water": "limited",
            "labour": "medium", "equipment": "low", "priorities": dict(PRI),
            "crop_history": [{"season": "Maha 2025/26", "crop_id": "paddy"}, {"season": "Yala 2025", "crop_id": "mung_bean"}]}
    body.update(over)
    return body


def test_create_and_read(client):
    h = login(client, "0771111111")
    r = client.post("/api/farms", json=farm_body(), headers=h)
    assert r.status_code == 201
    farm = r.json()
    assert farm["plot_source"] == "circle" and farm["polygon"]["type"] == "Polygon"
    assert farm["priorities"]["save_water"] == pytest.approx(0.3)
    assert [c["crop_id"] for c in farm["crop_history"]] == ["paddy", "mung_bean"]
    assert client.get(f"/api/farms/{farm['id']}", headers=h).json()["name"] == "Kamal field"
    assert len(client.get("/api/farms", headers=h).json()) == 1


def test_drawn_polygon(client):
    h = login(client, "0771111111")
    ring = [[80.40, 8.31], [80.41, 8.31], [80.41, 8.32], [80.40, 8.31]]
    r = client.post("/api/farms", json=farm_body(polygon={"type": "Polygon", "coordinates": [ring]}), headers=h)
    assert r.json()["plot_source"] == "drawn"
    bad = client.post("/api/farms", json=farm_body(polygon={"type": "Polygon", "coordinates": [[[80.4, 8.3], [80.5, 8.3]]]}), headers=h)
    assert bad.status_code == 422


def test_ownership_isolation(client):
    a, b = login(client, "0771111111"), login(client, "0772222222")
    fid = client.post("/api/farms", json=farm_body(), headers=a).json()["id"]
    assert client.get("/api/farms", headers=b).json() == []
    for method, path, kw in [("get", f"/api/farms/{fid}", {}), ("patch", f"/api/farms/{fid}", {"json": {"name": "x"}}),
                             ("delete", f"/api/farms/{fid}", {}), ("get", f"/api/farms/{fid}/export", {}),
                             ("post", f"/api/farms/{fid}/groundtruth", {"json": {"question_key": "k", "answer": "yes"}})]:
        assert getattr(client, method)(path, headers=b, **kw).status_code == 404, path
    assert client.get(f"/api/farms/{fid}", headers=a).status_code == 200      # untouched


def test_needs_login(client):
    assert client.get("/api/farms").status_code == 401
    assert client.post("/api/farms", json=farm_body()).status_code == 401


@pytest.mark.parametrize("over", [
    {"lat": 4.0}, {"lat": 12.0}, {"lon": 70.0}, {"lon": 85.0}, {"area_ha": 0.01}, {"area_ha": 500},
    {"water_source": "river"}, {"labour": "huge"},
    {"priorities": {**PRI, "income": 0.6}},                       # sums to 1.3
    {"priorities": {**PRI, "income": 1.5}},                       # out of 0 to 1
])
def test_validation(client, over):
    h = login(client, "0771111111")
    assert client.post("/api/farms", json=farm_body(**over), headers=h).status_code == 422


def test_validation_message_is_clear(client):
    h = login(client, "0771111111")
    r = client.post("/api/farms", json=farm_body(lat=4.0), headers=h)
    assert "Sri Lanka" in str(r.json()["detail"])


def test_priorities_normalised(client):
    h = login(client, "0771111111")
    r = client.post("/api/farms", json=farm_body(priorities={**PRI, "income": 0.305}), headers=h).json()
    assert r["priorities_normalised"] is True
    assert sum(r["priorities"].values()) == pytest.approx(1.0, abs=1e-3)


def test_patch(client):
    h = login(client, "0771111111")
    fid = client.post("/api/farms", json=farm_body(), headers=h).json()["id"]
    r = client.patch(f"/api/farms/{fid}", json={"name": "New", "labour": "high", "area_ha": 3,
                                                "crop_history": [{"season": "Yala 2026", "crop_id": "cowpea"}]}, headers=h).json()
    assert r["name"] == "New" and r["labour"] == "high" and r["lat"] == 8.31
    assert [c["crop_id"] for c in r["crop_history"]] == ["cowpea"]
    assert r["plot_source"] == "circle"
    assert client.patch(f"/api/farms/{fid}", json={"lat": 1}, headers=h).status_code == 422
    assert client.patch(f"/api/farms/{fid}", json={"priorities": {**PRI, "soil": 0.9}}, headers=h).status_code == 422


def test_export_and_delete_cascade(client):
    h = login(client, "0771111111")
    fid = client.post("/api/farms", json=farm_body(), headers=h).json()["id"]
    client.post(f"/api/farms/{fid}/groundtruth", json={"question_key": "green_in_may", "satellite_value": "NDVI 0.5", "answer": "yes"}, headers=h)
    # rows of other agents' tables, inserted directly so the cascade is tested for every table
    conn = dbmod.connect()
    now = dbmod.now_iso()
    conn.execute("INSERT INTO zone (farm_id, kind, geojson, version, created_at) VALUES (?, 'flat', '{}', 'computed', ?)", (fid, now))
    zid = conn.execute("SELECT id FROM zone").fetchone()[0]
    conn.execute("INSERT INTO threat (farm_id, kind, source, created_at) VALUES (?, 'erosion', 'computed', ?)", (fid, now))
    conn.execute("INSERT INTO soil_layer (farm_id, zone_id, property, value, source, updated_at) VALUES (?, ?, 'ph', '6', 'modelled', ?)", (fid, zid, now))
    conn.execute("INSERT INTO plan (farm_id, created_at, inputs_json) VALUES (?, ?, '{}')", (fid, now))
    conn.execute("INSERT INTO plan_option (plan_id, option_no, name, result_json) VALUES (1, 1, 'base', '{}')")
    conn.execute("INSERT INTO plan_rule_trace (plan_option_id, trace_json) VALUES (1, '[]')")
    conn.execute("INSERT INTO monitoring_point (farm_id, lat, lon, created_at) VALUES (?, 8.3, 80.4, ?)", (fid, now))
    conn.execute("INSERT INTO soil_observation (point_id, visited_on) VALUES (1, '2026-01-01')")
    conn.execute("INSERT INTO season_review (farm_id, created_at) VALUES (?, ?)", (fid, now))
    conn.execute("INSERT INTO issue_ticket (farm_id, text, created_at) VALUES (?, 'x', ?)", (fid, now))
    conn.commit()
    conn.close()

    exp = client.get(f"/api/farms/{fid}/export", headers=h).json()
    assert exp["farm"]["id"] == fid and len(exp["zones"]) == 1 and len(exp["threats"]) == 1 and len(exp["soil_layers"]) == 1
    assert len(exp["plans"]) == 1 and len(exp["plans"][0]["options"][0]["rule_trace"]) == 1
    assert len(exp["groundtruth_responses"]) == 1 and len(exp["soil_observations"]) == 1
    assert len(exp["season_reviews"]) == 1 and len(exp["issue_tickets"]) == 1

    assert client.delete(f"/api/farms/{fid}", headers=h).status_code == 200
    assert client.get(f"/api/farms/{fid}", headers=h).status_code == 404
    conn = dbmod.connect()
    for table in ("plot_polygon", "farmer_priority", "crop_history", "zone", "soil_layer", "threat", "plan", "plan_option", "plan_rule_trace",
                  "groundtruth_response", "monitoring_point", "soil_observation", "season_review", "issue_ticket"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table
    conn.close()


def test_groundtruth(client):
    h = login(client, "0771111111")
    fid = client.post("/api/farms", json=farm_body(), headers=h).json()["id"]
    ok = client.post(f"/api/farms/{fid}/groundtruth", json={"question_key": "green_in_may", "satellite_value": "NDVI 0.5", "answer": "no"}, headers=h)
    assert ok.status_code == 201 and ok.json()["answer"] == "no"
    assert client.post(f"/api/farms/{fid}/groundtruth", json={"question_key": "k", "answer": "maybe"}, headers=h).status_code == 422
