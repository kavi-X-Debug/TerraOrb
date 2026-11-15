"""Officer sign-in: only listed phone numbers become officers; /api/officer/check refuses everyone else."""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MC_DB", os.path.join(tempfile.mkdtemp(), "o.db"))
    monkeypatch.setenv("MC_DEV", "1")
    monkeypatch.setenv("MC_OFFICERS", "0770000000")
    from backend.app.db import init_db
    from backend.app.main import app
    init_db()
    return TestClient(app)


def login(c, phone):
    code = c.post("/api/auth/request", json={"phone": phone}).json()["dev_code"]
    return {"Authorization": "Bearer " + c.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]}


def test_officer_number_gets_in(client):
    r = client.get("/api/officer/check", headers=login(client, "0770000000"))
    assert r.status_code == 200 and r.json()["role"] == "officer"


def test_farmer_is_refused(client):
    assert client.get("/api/officer/check", headers=login(client, "0771111111")).status_code == 403


def test_no_login_is_refused(client):
    assert client.get("/api/officer/check").status_code == 401
