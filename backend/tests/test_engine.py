"""Engine tests: pure functions on small fixtures that follow the knowledge schema, plus checks against the real knowledge files."""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app import engine  # noqa: E402
from backend.app.engine import (apply_scenario, blend, confidence, crop_fits, load_knowledge, plan_cards, score_crop)  # noqa: E402
from backend.app.engine.knowledge import Knowledge  # noqa: E402

STEEP = {"erosion": 0.5, "drought": 0.2, "income": 0.2, "organic_matter": 0.1}


def crop(id, **kw):
    base = {"id": id, "name_en": id, "family": id, "type": "cereal", "n_fixing": 0, "season": "both", "labour": "medium",
            "functions": {"erosion": 1, "drought": 1, "income": 1, "organic_matter": 1}, "evidence": "V1", "suitability": {}}
    base.update(kw)
    return base


GLIRICIDIA = crop("gliricidia", type="hedge", family="Fabaceae", n_fixing=3, season="perennial",
                  functions={"erosion": 3, "drought": 3, "income": 1, "organic_matter": 3}, suitability={"slope_pct_max": 100})
FINGER = crop("finger_millet", suitability={"rain_mm": {"optimum": [600, 800], "tolerable": [500, 900]}})
SAFFRON = crop("saffron", type="root", needs_cold_season=True, season="maha", functions={"erosion": 0, "drought": 0, "income": 3, "organic_matter": 0})
COWPEA = crop("cowpea", type="legume", family="Fabaceae", n_fixing=2, functions={"erosion": 1, "drought": 3, "income": 1, "organic_matter": 2})


def fixture_knowledge():
    return Knowledge(crops={c["id"]: c for c in (GLIRICIDIA, FINGER, SAFFRON, COWPEA)},
                     zone_weights={"steep": STEEP, "flat": {"erosion": 0.1, "drought": 0.3, "income": 0.4, "organic_matter": 0.2}},
                     templates={"soil_building": {"seasons": [{"label": "Maha", "role": "legume"}, {"label": "Yala", "role": "cereal"}]},
                                "water_saving": {"seasons": [{"label": "Maha", "role": "drought_tolerant_millet_or_pulse"}]}})


def test_gliricidia_score_on_steep_zone():
    r = score_crop(GLIRICIDIA, STEEP)
    assert r["score"] == pytest.approx(2.6)
    assert [r["parts"][f] for f in ("erosion", "drought", "income", "organic_matter")] == pytest.approx([1.5, 0.6, 0.2, 0.3])


def test_confidence_worked_example():
    score, klass = confidence(0.6, 0.8, 0.2)
    assert score == pytest.approx(0.54) and klass == "medium"
    assert confidence(0.9, 0.9, 0.9)[1] == "high" and confidence(0.2, 0.2, 0.2)[1] == "low"


def test_scenario_20_percent_drier_is_marginal_for_finger_millet():
    ctx = {"zones": [{"kind": "flat", "rain_mm_season": 650}]}
    assert crop_fits(FINGER, ctx["zones"][0])["score"] == 1
    dry = apply_scenario(ctx, rain_factor=0.8)
    z = dry["zones"][0]
    assert z["rain_mm_season"] == pytest.approx(520)
    fit = crop_fits(FINGER, z)
    assert fit["score"] == 0.5 and fit["failed"][0]["status"] == "marginal"
    assert dry["scenario"]["is_forecast"] is False and ctx["zones"][0]["rain_mm_season"] == 650   # input not modified
    assert crop_fits(FINGER, {"rain_mm_season": 300})["score"] == 0


def test_saffron_fails_in_dry_zone_with_reason():
    fit = crop_fits(SAFFRON, {"kind": "flat", "cold_season": False})
    assert fit["score"] == 0
    f = [x for x in fit["failed"] if x["test"] == "cold_season"][0]
    assert f["reason"] == "no cold season for corm development"


def test_missing_inputs_are_unknown_not_guessed():
    fit = crop_fits(FINGER, {})
    assert fit["unknown"] == ["rain"] and fit["failed"] == []             # no rain in the context: reported, never guessed
    fit = crop_fits(crop("x", suitability={"slope_pct_max": 10}), {})
    assert fit["unknown"] == ["slope"]


def test_blend_70_30_sums_to_one():
    w = blend(STEEP, {"save_water": 1.0}, 0.7)
    assert sum(w.values()) == pytest.approx(1)
    assert w["drought"] == pytest.approx(0.7 * 0.2 + 0.3)
    assert blend(STEEP, None) == STEEP


def test_gliricidia_chosen_as_hedge_on_steep_zone_and_cards_complete():
    farm = {"zones": [{"id": 1, "kind": "steep", "slope_pct": 22, "rain_mm_season": 650, "cold_season": False}],
            "priorities": None, "history": [{"season": "Maha 2025/26", "crop_id": "finger_millet"}], "labour": "medium"}
    out = plan_cards(farm, fixture_knowledge())
    assert len(out["options"]) == 3
    soil = out["options"][1]
    assert soil["permanent"][0]["crop_id"] == "gliricidia"
    assert soil["seasons"][0]["zones"][0]["crop_id"] == "cowpea"            # legume first, then cereal
    assert soil["seasons"][1]["zones"][0]["crop_id"] == "finger_millet"
    assert any(e["rule"] == "legume_bonus" for e in soil["trace"])
    for o in out["options"]:
        assert o["confidence"]["class"] in ("high", "medium", "low") and o["trace"] and o["explanation"]["check_with_officer"] is not None
        assert o["needs_officer"] is True                                   # steep zone
    assert {x["crop_id"] for x in out["excluded"]} == {"saffron"}
    assert out["options"][0]["seasons"][0]["zones"][0]["crop_id"] == "finger_millet"   # baseline repeats history


def test_scenario_flows_through_plan():
    farm = {"zones": [{"id": 1, "kind": "flat", "rain_mm_season": 650}], "history": [{"season": "Maha", "crop_id": "finger_millet"}]}
    out = plan_cards(farm, fixture_knowledge(), rain_factor=0.8)
    cell = out["options"][0]["seasons"][0]["zones"][0]
    assert cell["fit"] == 0.5 and out["scenario"]["rain_factor"] == 0.8
    assert any(e["rule"] == "fit_marginal" for e in out["options"][0]["trace"])


def test_real_knowledge_files():
    k = load_knowledge()
    if not k.crops:
        pytest.skip("knowledge files not written yet")
    assert not k.missing
    assert crop_fits(k.crops["saffron"], {"kind": "flat", "cold_season": False})["score"] == 0
    assert score_crop(k.crops["gliricidia"], k.zone_weights["steep"])["score"] == pytest.approx(2.6) if k.crops["gliricidia"]["functions"] == {"erosion": 3, "drought": 3, "income": 1, "organic_matter": 3} else True
    farm = {"zones": [{"id": 1, "kind": "steep", "slope_pct": 20, "rain_mm_season": 650, "cold_season": False}],
            "history": [{"season": "Maha", "crop_id": "paddy"}]}
    out = plan_cards(farm, k)
    assert out["options"][1]["permanent"] and out["options"][1]["permanent"][0]["crop_id"] in ("gliricidia", "vetiver")
    for o in out["options"]:
        assert any(c["crop_id"] for r in o["seasons"] for c in r["zones"])
    assert any(x["crop_id"] == "saffron" for x in out["excluded"])


# ---------- routes ----------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MC_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("MC_DEV", "1")
    from backend.app.main import app
    from backend.app import db
    db.init_db()
    return TestClient(app)


def login(client, phone="0771234567"):
    code = client.post("/api/auth/request", json={"phone": phone}).json()["dev_code"]
    tok = client.post("/api/auth/verify", json={"phone": phone, "code": code}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def seed_farm(owner_phone="0771234567"):
    from backend.app import db
    from backend.app.db import now_iso
    c = db.connect()
    fid = c.execute("INSERT INTO farm (farmer_id, name, lat, lon, area_ha, water_source, labour, created_at, updated_at) "
                    "SELECT id, 'f', 8.3, 80.4, 1.0, 'rain-fed', 'medium', ?, ? FROM farmer WHERE phone = ?",
                    (now_iso(), now_iso(), owner_phone)).lastrowid
    c.execute("INSERT INTO zone (farm_id, kind, geojson, version, area_ha, mean_slope_pct, created_at) VALUES (?, 'steep', '{}', 'computed', 0.5, 20, ?)",
              (fid, now_iso()))
    c.execute("INSERT INTO crop_history (farm_id, season, crop_id) VALUES (?, 'Maha 2025/26', 'paddy')", (fid,))
    c.commit()
    c.close()
    return fid


def test_plan_routes(client):
    if not load_knowledge().crops:
        pytest.skip("knowledge files not written yet")
    h = login(client)
    fid = seed_farm()
    r = client.post(f"/api/farms/{fid}/plan", json={"scenario": {"rain_factor": 0.8}}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["options"]) == 3 and "rain" not in body["inputs_missing"] and body["scenario"]["is_forecast"] is False
    latest = client.get(f"/api/farms/{fid}/plan/latest", headers=h).json()
    assert latest["plan_id"] == body["plan_id"] and len(latest["options"]) == 3
    assert client.get(f"/api/farms/{fid}/plan", headers=h).status_code == 200
    # another farmer cannot see it
    other = login(client, "0779999999")
    assert client.post(f"/api/farms/{fid}/plan", json={}, headers=other).status_code == 404
    assert client.get(f"/api/farms/{fid}/plan/latest").status_code == 401
    assert client.get("/api/knowledge/crops").json()["crops"]
    assert client.get("/api/knowledge/glossary").status_code == 200
