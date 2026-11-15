"""Tests for spatial_processing, open_meteo, modis and the IMERG stub (offline; SYNTHETIC fixtures)."""

import os

import pytest

from pipeline.trip.download import gpm_imerg, modis, open_meteo
from pipeline.trip.processing import spatial_processing as sp


# ---------------------------------------------------------------------------
# terrain tiles
# ---------------------------------------------------------------------------
def test_tile_xy_known_points():
    assert sp.tile_xy(0.0, 0.0, 1)[:2] == (1, 1)
    x, y, px, py = sp.tile_xy(0.0, 0.0, 1)
    assert (px, py) == (0.0, 0.0)
    x, y, _, _ = sp.tile_xy(7.29, 80.63, 12)               # Kandy: tile column ~ (80.63+180)/360*4096
    assert x == int((80.63 + 180) / 360 * 4096)


def test_decode_terrarium():
    assert sp.decode_terrarium(128, 0, 0) == 0.0           # sea level
    assert sp.decode_terrarium(128, 100, 128) == pytest.approx(100.5)
    assert sp.decode_terrarium(127, 255, 0) == pytest.approx(-1.0)


# ---------------------------------------------------------------------------
# destinations
# ---------------------------------------------------------------------------
def test_activities_union_in_order_without_duplicates():
    table = {"beach": ["beach", "photography"], "city": ["shopping", "photography"]}
    assert sp.activities_for(["beach", "city"], table) == ["beach", "photography", "shopping"]


def test_cost_level_is_highest_of_kinds_or_none():
    assert sp.cost_level_for(["waterfall", "wildlife"], {"waterfall": 1, "wildlife": 3}) == 3
    assert sp.cost_level_for(["unknown"], {"waterfall": 1}) is None


def test_names():
    assert sp.slugify("Diyaluma Falls") == "diyaluma-falls"
    assert sp.english_name({"name": "Ravana Falls"}) == "Ravana Falls"
    assert sp.english_name({"name": "රාවණා ඇල්ල"}) is None                       # no Latin name: skipped, never transliterated by us
    assert sp.english_name({"name": "රාවණා ඇල්ල", "name:en": "Ravana Ella"}) == "Ravana Ella"
    assert sp.sinhala_name({"name:si": "රාවණා ඇල්ල"}) == "රාවණා ඇල්ල"
    assert sp.sinhala_name({"name": "Ravana"}) is None


def fake_cfg(cfg):
    import copy
    c = copy.deepcopy(cfg)
    c["trip"]["osm"]["categories"] = {"waterfall": {"kind": "waterfall", "keep": 2}, "beach": {"kind": "beach", "keep": 1}}
    return c


def test_build_destinations_from_synthetic_osm(cfg):
    c = fake_cfg(cfg)
    places = [{"id": "kandy", "name_en": "Kandy", "name_si": "මහනුවර", "lat": 7.29, "lon": 80.63}]
    el = lambda i, name, lat, lon, **tags: {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": {"name": name, **tags}}   # noqa: E731
    osm = {
        "waterfall": [el(1, "Fall A", 6.8, 80.9, wikidata="Q1"), el(2, "Fall B", 6.81, 80.9),          # B is ~1 km from A: duplicate
                      el(3, "Fall C", 7.0, 81.0), el(4, "Outside", 20.0, 80.0)],                        # outside Sri Lanka
        "beach": [el(5, "Beach D", 6.0, 80.2), el(6, "Beach E", 6.2, 80.2)],
    }
    dests = sp.build_destinations(places, osm, [], c)
    ids = [d["id"] for d in dests]
    assert ids == ["kandy", "fall-a", "fall-c", "beach-d"]               # B dropped (too close), Outside dropped, beach capped at 1
    kandy = dests[0]
    assert kandy["kinds"] == ["culture", "city", "hill"] and kandy["cell"] == "7.5_80.625" and kandy["name_si"]
    assert kandy["cost_level_evidence"] == "assumption" and kandy["osm"] is None and kandy["elevation_m"] is None
    assert dests[1]["osm"] == {"type": "node", "id": 1} and dests[1]["activities"] == ["waterfalls", "hiking", "photography"]


def test_every_place_in_places_json_has_kinds(cfg):
    import json
    from pipeline.trip import common
    places = json.loads((common.REPO / "data" / "places.json").read_text(encoding="utf-8"))["places"]
    for p in places:
        assert p["id"] in cfg["trip"]["place_kinds"], p["id"]
        assert set(cfg["trip"]["place_kinds"][p["id"]]) <= set(sp.KINDS)
    for kinds_activities in cfg["trip"]["kind_activities"].values():
        assert kinds_activities


def test_region_of_with_synthetic_square():
    from shapely.geometry import box
    provinces = [("Square", box(80, 7, 81, 8))]
    assert sp.region_of(7.5, 80.5, provinces) == "Square"
    assert sp.region_of(5.0, 80.5, provinces) is None


# ---------------------------------------------------------------------------
# Open-Meteo, MODIS, IMERG
# ---------------------------------------------------------------------------
def snapshot_entry(days=16, drop=None):
    hours = days * 24
    e = {"hourly": {"time": ["t"] * hours, **{k: [0.0] * hours for k in ("precipitation", "temperature_2m")}},
         "daily": {"time": ["d"] * days, "precipitation_sum": [0.0] * days}}
    if drop:
        e["hourly"]["precipitation"] = e["hourly"]["precipitation"][:-1]
    return e


def test_forecast_check_rejects_short_or_ragged(cfg):
    open_meteo.check(snapshot_entry(), cfg["trip"])
    with pytest.raises(open_meteo.ForecastError):
        open_meteo.check(snapshot_entry(days=10), cfg["trip"])
    with pytest.raises(open_meteo.ForecastError):
        open_meteo.check(snapshot_entry(drop=True), cfg["trip"])


def test_modis_median_needs_enough_land_pixels(cfg):
    nd = cfg["ndvi"]
    land = [5000] * 20
    assert modis.median_land_ndvi(land, nd) == 0.5
    assert modis.median_land_ndvi([5000] * 5, nd) is None                  # too few land pixels: null, never a guess
    assert modis.median_land_ndvi([-3000] * 30 + [500] * 30, nd) is None   # fill value and water-like pixels are ignored


def test_imerg_stub_refuses_without_token(monkeypatch):
    for k in ("EARTHDATA_TOKEN", "EARTHDATA_USERNAME", "EARTHDATA_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    assert gpm_imerg.status() == {"used": False, "reason": "no Earthdata token"}
    with pytest.raises(gpm_imerg.ImergNotAvailable):
        gpm_imerg.fetch_daily()
    monkeypatch.setenv("EARTHDATA_TOKEN", "x")
    assert gpm_imerg.status()["used"] is False                              # never "used" while the download is not implemented
    with pytest.raises(NotImplementedError):
        gpm_imerg.fetch_daily()
    assert "EARTHDATA_TOKEN" in os.environ
