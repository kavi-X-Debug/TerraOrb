"""Tests for /api/farms/{id}/location and /profile. Run from the repo root:  PYTHONPATH=. pytest backend/tests/test_profile.py -q -W ignore"""
import os
import sqlite3
import tempfile

_DB = os.path.join(tempfile.mkdtemp(), "profile_test.db")
os.environ["MC_DB"] = _DB                       # must be set before backend.app.main is imported
os.environ["MC_DEV"] = "1"

import pytest                                    # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

from backend.app.main import app                 # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def _own_database():
    """Other test files also set MC_DB; point it back at this file's database (and create the tables) before every test."""
    os.environ["MC_DB"] = _DB
    from backend.app.db import init_db
    init_db()


def login(phone):
    code = client.post("/api/auth/request", json={"phone": phone}).json()["dev_code"]
    return client.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]


def add_farm(phone, lat, lon):
    """Insert a farm straight into the test database (the farm-creation route belongs to another agent)."""
    token = login(phone)
    conn = sqlite3.connect(_DB)
    fid = conn.execute("SELECT id FROM farmer WHERE phone = ?", (phone,)).fetchone()[0]
    cur = conn.execute("INSERT INTO farm (farmer_id, name, lat, lon, area_ha, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                       (fid, "test", lat, lon, 1.0, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"))
    conn.commit()
    conn.close()
    return cur.lastrowid, {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def anuradhapura():
    os.environ["MC_DB"] = _DB                          # other test files change MC_DB; use this file's database
    from backend.app.db import init_db
    init_db()
    return add_farm("+94770000001", 8.31, 80.40)        # inside cell 8.5_80.625? (checked below by the API)


def test_requires_login(anuradhapura):
    fid, _ = anuradhapura
    assert client.get(f"/api/farms/{fid}/location").status_code == 401
    assert client.get(f"/api/farms/{fid}/profile").status_code == 401


def test_other_farmer_gets_404(anuradhapura):
    fid, _ = anuradhapura
    _, other = add_farm("+94770000002", 8.31, 80.40)
    assert client.get(f"/api/farms/{fid}/location", headers=other).status_code == 404
    assert client.get(f"/api/farms/{fid}/profile", headers=other).status_code == 404


def test_location_card(anuradhapura):
    fid, headers = anuradhapura
    r = client.get(f"/api/farms/{fid}/location", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["climatic_zone"]["name"] == "Dry Zone"
    assert body["climatic_zone"]["source"]
    assert body["elevation_m"] is None                   # no DEM yet: never invented
    assert [s["name"] for s in body["seasons"]] == ["Maha", "Yala"]
    assert body["covered"] is True and body["in_pilot_area"] is True
    assert body["grid_cell"]["key"] == "8.5_80.625"      # 8.31 N rounds to 8.5, 80.40 E rounds to 80.625
    assert "area" in body["area_note"].lower()


def test_profile_has_sources_and_area_note(anuradhapura):
    fid, headers = anuradhapura
    body = client.get(f"/api/farms/{fid}/profile", headers=headers).json()
    assert body["covered"] is True
    for block in ("climate_monthly", "onset", "dry_spells", "ndvi", "bare_calendar"):
        assert body[block]["source"] and body[block]["resolution"].startswith("area-level")
        assert body[block]["demo"] is False
    assert set(body["climate_monthly"]["data"]) == {str(m) for m in range(1, 13)}
    assert body["climate_monthly"]["data"]["10"]["rain_mm"]["mean"] > 0
    assert body["onset"]["data"]["Maha"]["summary"]["years_with_onset"] > 10
    assert body["dry_spells"]["data"]["Yala"]["by_year"][0]["longest_dry_spell_days"] is not None
    assert body["thresholds_are_placeholders"] is True
    assert body["sm_anomaly"]["available"] is False and body["sm_anomaly"]["reason"]
    assert "area" in body["area_note"].lower()


def test_farm_outside_covered_cells_says_so():
    fid, headers = add_farm("+94770000003", 6.9, 79.9)    # Colombo area: not in the pilot
    loc = client.get(f"/api/farms/{fid}/location", headers=headers).json()
    assert loc["covered"] is False and loc["in_pilot_area"] is False
    assert loc["climatic_zone"]["name"] is None and loc["coverage_note"]
    prof = client.get(f"/api/farms/{fid}/profile", headers=headers).json()
    assert prof["covered"] is False and prof["coverage_note"]
    assert "climate_monthly" not in prof                  # no numbers at all for an uncovered farm
