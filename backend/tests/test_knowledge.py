"""Validates the knowledge base in backend/knowledge/*.json against docs/farm-spec.md section 5."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
KNOW = ROOT / "backend" / "knowledge"
EVIDENCE = {"V1", "V2", "V3", "V4", "assumption"}
TYPES = {"cereal", "legume", "vegetable", "root", "tree", "hedge", "cover"}
SEASONS = {"maha", "yala", "both", "perennial"}
FUNCS = ["erosion", "drought", "income", "organic_matter"]
REQUIRED = ["id", "name_en", "name_si", "family", "type", "n_fixing", "cycle_days", "sow_offset_days", "season",
            "suitability", "needs_cold_season", "functions", "pests", "companions", "conflicts",
            "buyers_confirmed", "labour", "evidence", "sources", "reviewed", "notes"]
SI = re.compile(r"[඀-෿]")


def load(name):
    return json.loads((KNOW / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def crops():
    return load("crops.json")


@pytest.fixture(scope="module")
def by_id(crops):
    return {c["id"]: c for c in crops}


@pytest.fixture(scope="module")
def weights():
    return load("zone_weights.json")["zones"]


def score(crop, w):
    return sum(w[f] * crop["functions"][f] for f in FUNCS)


def test_crop_schema(crops):
    ids = [c["id"] for c in crops]
    assert len(ids) == len(set(ids))
    for c in crops:
        for f in REQUIRED:
            assert f in c, f"{c['id']} missing {f}"
        assert re.fullmatch(r"[a-z0-9_]+", c["id"])
        assert c["type"] in TYPES and c["season"] in SEASONS
        assert c["labour"] in {"low", "medium", "high"}
        assert c["n_fixing"] in range(4) and c["cycle_days"] > 0
        assert c["evidence"] in EVIDENCE
        assert c["reviewed"] is False and c["buyers_confirmed"] is False
        assert SI.search(c["name_si"]), f"{c['id']} has no Sinhala name"
        assert set(c["functions"]) == set(FUNCS)
        assert all(v in range(4) for v in c["functions"].values())
        s = c["suitability"]
        for key in ("rain_mm", "tmean_c", "ph"):
            opt, tol = s[key]["optimum"], s[key]["tolerable"]
            assert opt[0] <= opt[1] and tol[0] <= tol[1]
            assert tol[0] <= opt[0] and opt[1] <= tol[1], f"{c['id']} {key}: optimum outside tolerable"
        assert s["slope_pct_max"] > 0
        assert set(s["drainage"]) <= {"well", "moderate", "poor"} and s["drainage"]
        assert s["texture"]
        for cf in c["conflicts"]:
            assert {"with", "reason", "evidence"} <= set(cf) and cf["evidence"] in EVIDENCE


def test_every_value_group_has_source_evidence_note(crops):
    for c in crops:
        fe = c["field_evidence"]
        for group in ("cycle_days", "suitability", "functions", "season_sow_offset"):
            assert group in fe, f"{c['id']} lacks {group}"
        for group, info in fe.items():
            assert info["evidence"] in EVIDENCE, (c["id"], group)
            assert info["source"].strip() and info["note"].strip(), (c["id"], group)
            if info["evidence"] == "assumption":
                assert "review" in info["note"].lower(), f"{c['id']} {group}: assumption must ask for review"


def test_companions_and_conflicts_point_to_real_crops(crops, by_id):
    for c in crops:
        for o in c["companions"] + [x["with"] for x in c["conflicts"]]:
            assert o in by_id, f"{c['id']} refers to unknown crop {o}"


def test_reuses_pipeline_crop_ids(by_id):
    pipe = json.loads((ROOT / "pipeline" / "crops_data.json").read_text(encoding="utf-8"))
    for c in pipe["crops"]:
        assert c["id"] in by_id, f"pipeline crop {c['id']} missing from knowledge base"
        assert by_id[c["id"]]["cycle_days"] == c["duration_days"]


def test_finger_millet_range_and_marginal(by_id):
    rain = by_id["finger_millet"]["suitability"]["rain_mm"]
    assert rain["tolerable"] == [500, 900]
    # 650 mm is optimum; 20 percent drier (520 mm) is tolerable but not optimum, i.e. marginal.
    assert rain["optimum"][0] <= 650 <= rain["optimum"][1]
    assert rain["tolerable"][0] <= 520 < rain["optimum"][0]


def test_saffron_fails_in_dry_zone(by_id):
    s = by_id["saffron"]
    assert s["needs_cold_season"] is True
    assert s["needs_cold_season_reason"] == "no cold season for corm development"
    assert s["suitability"]["tmean_c"]["tolerable"][1] < 27  # Dry Zone mean temperature is about 27 C
    assert all(c["needs_cold_season"] is False for k, c in by_id.items() if k != "saffron")


def test_hedge_crops_exist(by_id):
    assert by_id["gliricidia"]["type"] == "hedge" and by_id["vetiver"]["type"] == "hedge"
    assert by_id["gliricidia"]["n_fixing"] == 3


def test_zone_weights(weights):
    assert set(weights) == {"steep", "very_steep", "gentle", "flat", "wet_low"}
    for kind, w in weights.items():
        assert set(w) == set(FUNCS)
        assert sum(w.values()) == pytest.approx(1.0), kind
    assert weights["steep"] == {"erosion": 0.5, "drought": 0.2, "income": 0.2, "organic_matter": 0.1}


def test_gliricidia_worked_example_and_ranks_first_on_steep(by_id, crops, weights):
    w = weights["steep"]
    f = by_id["gliricidia"]["functions"]
    parts = [w["erosion"] * f["erosion"], w["drought"] * f["drought"], w["income"] * f["income"],
             w["organic_matter"] * f["organic_matter"]]
    assert parts == pytest.approx([1.5, 0.6, 0.2, 0.3])
    assert sum(parts) == pytest.approx(2.6)
    steep_slope = 22  # middle of the 15 to 30 percent steep class
    passing = [c for c in crops if c["suitability"]["slope_pct_max"] >= steep_slope and not c["needs_cold_season"]]
    best = max(passing, key=lambda c: score(c, w))
    assert best["id"] == "gliricidia"
    assert sorted(score(c, w) for c in passing)[-2] < 2.6


def test_rotation_templates():
    rt = load("rotation_templates.json")
    ids = {t["id"] for t in rt["templates"]}
    assert {"soil_building", "water_saving"} <= ids
    for t in rt["templates"]:
        assert t["seasons"]
        for s in t["seasons"]:
            assert s["role"] in rt["role_rules"], s


def test_claims(by_id):
    ok_status = {"scientifically supported", "traditional, not yet validated"}
    claims = load("claims.json")
    assert len({c["id"] for c in claims}) == len(claims)
    for c in claims:
        assert c["kind"] in {"pairing", "practice"} and c["status"] in ok_status
        assert c["evidence"] in EVIDENCE and c["effect"] and c["sources"]
        assert all(cid in by_id for cid in c["crops"])
        if c["status"] == "scientifically supported":
            assert c["evidence"] in {"V1", "V2"}


def test_glossary():
    g = load("glossary.json")
    terms = {x["term"] for x in g}
    assert {"water_balance", "ndvi", "erosion_risk", "onset", "dry_spell", "soil_moisture_anomaly", "area_level",
            "confidence", "v1", "v2", "v3", "v4"} <= terms
    for x in g:
        assert x["en"].strip() and SI.search(x["si"]), x["term"]
