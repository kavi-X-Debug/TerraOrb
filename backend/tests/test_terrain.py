"""
Tests for backend/app/terrain.py and routes_terrain.py. They run OFFLINE.

IMPORTANT: the elevation used here is a TEST FIXTURE (a made-up V-shaped valley built from a formula and encoded as terrarium tiles).
It is not real elevation and exists only to check the arithmetic. One optional test (marked `network`, run with RUN_NETWORK=1)
fetches a real tile from the elevation service.
"""
import io
import os

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import auth, routes_terrain, terrain

LAT, LON = 8.31, 80.40


# ----------------------------------------------------------------- TEST FIXTURE (not real elevation)

def fixture_elevation(gx, gy, z=15):
    """TEST FIXTURE: a V valley running east. Sides rise 0.94 m per pixel (about 20 % at z=15), the floor falls 0.02 m per pixel."""
    cx, cy = terrain.lonlat_to_pixel(LON, LAT, z)
    return 50.0 + 0.94 * np.abs(gy - cy) + 0.02 * (cx + 400 - gx)


def fixture_tile(z, x, y):
    """TEST FIXTURE tile getter with the same signature as terrain.fetch_tile."""
    gx, gy = np.meshgrid(x * 256 + np.arange(256) + 0.5, y * 256 + np.arange(256) + 0.5)
    return terrain.encode_terrarium(fixture_elevation(gx, gy, z))


def square_ring(half_m=60.0):
    dlat = half_m / 110540.0
    dlon = half_m / (111320.0 * np.cos(np.radians(LAT)))
    return [[LON - dlon, LAT - dlat], [LON + dlon, LAT - dlat], [LON + dlon, LAT + dlat], [LON - dlon, LAT + dlat], [LON - dlon, LAT - dlat]]


@pytest.fixture(scope="module")
def fixture_dem():
    ring = square_ring()
    return terrain.build_dem(terrain.ring_bbox(ring), zoom=15, tile_getter=fixture_tile), ring


# ----------------------------------------------------------------- tiles and decoding

def test_terrarium_roundtrip():
    elev = np.array([[0.0, 12.5], [-5.25, 1234.75]])
    assert np.allclose(terrain.decode_terrarium(terrain.encode_terrarium(elev)), elev, atol=1 / 256)


def test_decode_formula_example():
    # r=128, g=10, b=128 means 128*256 + 10 + 0.5 - 32768 = 10.5 m
    assert terrain.decode_terrarium(np.array([[[128, 10, 128]]], dtype=np.uint8))[0, 0] == pytest.approx(10.5)


def test_stdlib_png_decoder_matches_pillow():
    from PIL import Image
    rng = np.random.default_rng(1)
    base = np.cumsum(rng.integers(0, 4, size=(40, 40, 3)), axis=0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(base).save(buf, format="PNG")
    assert np.array_equal(terrain._png_to_rgb_stdlib(buf.getvalue()), base)


def test_pixel_lonlat_roundtrip():
    x, y = terrain.lonlat_to_pixel(LON, LAT, 15)
    lon, lat = terrain.pixel_to_lonlat(x, y, 15)
    assert (lon, lat) == pytest.approx((LON, LAT), abs=1e-9)
    assert 4.5 < terrain.cell_size_m(LAT, 15) < 4.8


def test_build_dem_covers_plot_and_uses_tiles(fixture_dem):
    dem, ring = fixture_dem
    assert dem["elev"].ndim == 2 and max(dem["elev"].shape) <= 420
    mask = terrain.plot_mask(dem, ring)
    assert 400 < mask.sum() < 800                                    # a 120 m square at about 4.7 m cells is about 650 cells
    assert dem["elev"][mask].min() >= 50.0


def test_build_dem_raises_when_tiles_missing():
    def broken(z, x, y):
        raise terrain.DemUnavailable("offline")
    with pytest.raises(terrain.DemUnavailable):
        terrain.build_dem(terrain.ring_bbox(square_ring()), tile_getter=broken)


# ----------------------------------------------------------------- slope, flow, classes

def test_slope_of_a_plane_is_rise_over_run():
    plane = np.tile(np.arange(30) * 1.0, (30, 1))                    # 1 m per 10 m cell = 10 %
    assert terrain.slope_percent(plane, 10.0)[10, 10] == pytest.approx(10.0)


def test_flow_accumulation_on_a_plane_counts_cells_upstream():
    plane = np.tile(-np.arange(12.0), (8, 1))                        # falls to the east
    acc = terrain.flow_accumulation(plane)
    assert acc[4, 5] == pytest.approx(5.0)                           # itself plus cells 1 to 4 (the border column is an outlet and sends nothing)
    assert acc[4, 10] == pytest.approx(10.0)


def test_pit_is_filled_so_water_leaves_the_grid():
    bowl = np.add.outer((np.arange(15) - 7.0) ** 2, (np.arange(15) - 7.0) ** 2)   # a bowl: every cell drains to the middle pit
    acc = terrain.flow_accumulation(bowl)
    assert acc[:, 0].sum() + acc[:, -1].sum() + acc[0, :].sum() + acc[-1, :].sum() > 15 * 15 * 0.9


def test_classify_uses_the_spec_limits():
    slope = np.array([[0.0, 4.9, 5.0, 14.9], [15.0, 29.9, 30.0, 80.0]])
    cls = terrain.classify(slope, np.ones_like(slope), 5.0)
    assert [terrain.KINDS[c] for c in cls.ravel()] == ["flat", "flat", "gentle", "gentle", "steep", "steep", "very_steep", "very_steep"]


def test_wet_low_needs_flat_ground_and_lots_of_water():
    slope = np.array([[2.0, 2.0, 20.0]])
    acc = np.array([[10000.0, 1.0, 10000.0]])                        # cell area 25 m2 here
    cls = terrain.classify(slope, acc, 5.0, wet_area_m2=5000.0)
    assert [terrain.KINDS[c] for c in cls.ravel()] == ["wet_low", "flat", "steep"]


def test_small_patches_are_merged_into_neighbours():
    cls = np.zeros((10, 10), dtype=np.int8)
    cls[4, 4] = terrain.STEEP                                        # one lonely cell
    merged = terrain.merge_small_patches(cls, np.ones((10, 10), dtype=bool), min_cells=4)
    assert (merged == terrain.FLAT).all()


def test_patch_geometry_has_hole_and_right_area():
    comp = np.zeros((9, 9), dtype=bool)
    comp[1:8, 1:8] = True
    comp[4, 4] = False                                               # a hole
    dem = {"px0": 0, "py0": 0, "z": 15}
    geom = terrain.patch_geometry(comp, dem)
    assert geom["type"] == "Polygon" and len(geom["coordinates"]) == 2
    ring = geom["coordinates"][0]
    assert ring[0] == ring[-1]
    expected_m2 = 48 * terrain.cell_size_m(terrain.pixel_to_lonlat(0, 0, 15)[1], 15) ** 2
    assert terrain.polygon_area_ha(geom) * 10000 == pytest.approx(expected_m2, rel=0.02)


# ----------------------------------------------------------------- erosion

def test_erosion_index_grows_with_slope_and_hedges_halve_it():
    slopes = np.array([2.0, 10.0, 20.0, 40.0])
    idx = terrain.erosion_index(slopes, np.full(4, 10.0), 5.0)
    assert (np.diff(idx) > 0).all()
    assert terrain.erosion_index(slopes, np.full(4, 10.0), 5.0, p=0.5) == pytest.approx(idx * 0.5)


def test_erosion_levels_and_k_lookup():
    assert [terrain.erosion_level(v) for v in (0.01, 0.3, 0.9)] == ["low", "medium", "high"]
    assert terrain.k_from_texture("Sandy loam") == (0.13, True)
    assert terrain.k_from_texture(None) == (terrain.K_DEFAULT, False)


# ----------------------------------------------------------------- the whole analysis on the fixture

def test_analyse_finds_steep_sides_and_a_wet_valley_floor(fixture_dem):
    dem, ring = fixture_dem
    result = terrain.analyse(dem, ring)
    kinds = {z["kind"] for z in result["zones"]}
    assert "wet_low" in kinds and ("steep" in kinds or "very_steep" in kinds or "gentle" in kinds)
    total_ha = sum(z["area_ha"] for z in result["zones"])
    assert total_ha == pytest.approx(terrain.ring_area_m2(ring) / 10000.0, rel=0.15)
    steep = [z for z in result["zones"] if z["kind"] in ("steep", "very_steep")]
    assert steep and all(z["erosion_level"] in ("medium", "high") for z in steep)       # fixture sides are about 20 %
    wet = [z for z in result["zones"] if z["kind"] == "wet_low"]
    assert max(z["erosion_index"] for z in wet) < min(z["erosion_index"] for z in steep)
    assert "not tonnes" in result["summary"]["erosion"]["unit"]
    for z in result["zones"]:
        assert z["geometry"]["type"] in ("Polygon", "MultiPolygon")
        assert z["erosion_index_with_contour_hedges"] == pytest.approx(z["erosion_index"] * 0.5, abs=1e-4)


def test_computed_threats_are_honest_about_what_is_unknown():
    zones = [{"kind": "steep", "area_ha": 0.6, "erosion_index": 0.8}, {"kind": "wet_low", "area_ha": 0.2, "erosion_index": 0.01}]
    t = {x["kind"]: x for x in terrain.computed_threats(zones, {"water_source": "rain-fed", "yala_water": "no"})}
    assert t["erosion"]["level"] == "high"
    assert t["waterlogging"]["level"] == "high"                      # 25 % wet
    assert t["drought"]["level"] == "high"
    assert t["heat"]["level"] is None                                # not computed, not guessed
    assert {x["kind"] for x in terrain.computed_threats([], {})} == {"drought", "heat"}


def test_soilgrids_parsing_and_texture():
    payload = {"properties": {"layers": [
        {"name": n, "unit_measure": {"d_factor": f}, "depths": [{"values": {"mean": v}}]}
        for n, f, v in (("sand", 10, 690), ("silt", 10, 160), ("clay", 10, 150), ("phh2o", 10, 62), ("soc", 10, 95))]}}
    out = terrain.parse_soilgrids(payload)
    assert out == {"texture": "sandy_loam", "ph": 6.2, "organic_carbon": 9.5}
    assert terrain.usda_texture(10, 20, 70) == "clay"
    with pytest.raises(ValueError):
        terrain.parse_soilgrids({"properties": {"layers": []}})


# ----------------------------------------------------------------- the API (offline, using the fixture tiles)

@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("MC_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("MC_DEV", "1")
    monkeypatch.setenv("MC_DEM_CACHE", str(tmp_path / "dem"))
    from backend.app import db as dbm
    dbm.init_db()
    app = FastAPI()
    app.include_router(routes_terrain.router)
    client = TestClient(app)
    conn = dbm.connect()

    def login(phone):
        code = auth.request_code(conn, phone)["dev_code"]
        return {"Authorization": "Bearer " + auth.verify_code(conn, phone, code)["token"]}

    def add_farm(headers_phone="0771234567", **kw):
        farmer = conn.execute("SELECT id FROM farmer WHERE phone = ?", (headers_phone,)).fetchone()
        cur = conn.execute("INSERT INTO farm (farmer_id, name, lat, lon, area_ha, water_source, yala_water, created_at, updated_at) VALUES (?, 'f', ?, ?, ?, ?, ?, 'x', 'x')",
                           (farmer["id"], LAT, LON, kw.get("area_ha", 1.2), kw.get("water_source", "rain-fed"), kw.get("yala_water", "limited")))
        conn.commit()
        return cur.lastrowid

    h1 = login("0771234567")
    yield {"client": client, "h": h1, "login": login, "add_farm": add_farm, "conn": conn}
    conn.close()


def test_compute_zones_endpoint_stores_computed_zones_and_threats(api, monkeypatch):
    monkeypatch.setattr(terrain, "fetch_tile", fixture_tile)
    fid = api["add_farm"]()
    r = api["client"].post(f"/api/farms/{fid}/zones/compute", headers=api["h"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current"] == "computed" and body["computed"] and not body["edited"]
    assert body["summary"]["erosion"]["unit"].startswith("relative")
    assert body["summary"]["plot_source"] == "circle"
    got = api["client"].get(f"/api/farms/{fid}/zones", headers=api["h"]).json()
    assert len(got["computed"]) == len(body["computed"])
    props = got["computed"][0]["feature"]["properties"]
    assert props["erosion_note"] == "relative index, not tonnes per hectare"
    threats = api["client"].get(f"/api/farms/{fid}/threats", headers=api["h"]).json()
    assert {t["kind"] for t in threats["computed"]} == {"erosion", "waterlogging", "drought", "heat"}
    again = api["client"].post(f"/api/farms/{fid}/zones/compute", headers=api["h"]).json()      # recompute replaces, never duplicates
    assert len(again["computed"]) == len(body["computed"])


def test_compute_returns_502_and_stores_nothing_when_elevation_unavailable(api, monkeypatch):
    def broken(z, x, y, client=None):
        raise terrain.DemUnavailable("no network")
    monkeypatch.setattr(terrain, "fetch_tile", broken)
    fid = api["add_farm"]()
    r = api["client"].post(f"/api/farms/{fid}/zones/compute", headers=api["h"])
    assert r.status_code == 502 and "could not be fetched" in r.json()["detail"]
    assert api["client"].get(f"/api/farms/{fid}/zones", headers=api["h"]).json()["current"] is None


def test_zones_edit_keeps_computed_and_validates(api, monkeypatch):
    monkeypatch.setattr(terrain, "fetch_tile", fixture_tile)
    fid = api["add_farm"]()
    api["client"].post(f"/api/farms/{fid}/zones/compute", headers=api["h"])
    poly = {"type": "Polygon", "coordinates": [square_ring(30.0)]}
    r = api["client"].put(f"/api/farms/{fid}/zones", headers=api["h"], json={"zones": [{"kind": "steep", "geometry": poly}]})
    assert r.status_code == 200
    body = r.json()
    assert body["current"] == "edited" and len(body["edited"]) == 1 and body["computed"]
    assert body["edited"][0]["area_ha"] == pytest.approx(0.36, rel=0.05)
    assert api["client"].put(f"/api/farms/{fid}/zones", headers=api["h"], json={"zones": [{"kind": "lava", "geometry": poly}]}).status_code == 422
    assert api["client"].put(f"/api/farms/{fid}/zones", headers=api["h"], json={"zones": [{"kind": "flat", "geometry": {"type": "Point", "coordinates": [0, 0]}}]}).status_code == 422
    assert api["client"].put(f"/api/farms/{fid}/zones", headers=api["h"], json={"zones": []}).json()["current"] == "computed"


def test_soil_modelled_and_measured_stay_separate(api, monkeypatch):
    monkeypatch.setattr(terrain, "fetch_soilgrids", lambda lat, lon: {"texture": "clay", "ph": 6.5})
    fid = api["add_farm"]()
    c, h = api["client"], api["h"]
    assert c.post(f"/api/farms/{fid}/soil/modelled", headers=h).status_code == 200
    r = c.put(f"/api/farms/{fid}/soil", headers=h, json={"layers": [{"property": "texture", "value": "Sandy_Loam"}, {"property": "drainage", "value": "poor"}]})
    body = r.json()
    assert [x["value"] for x in body["modelled"] if x["property"] == "texture"] == ["clay"]
    assert [x["value"] for x in body["measured_by_farmer"] if x["property"] == "texture"] == ["sandy_loam"]
    assert body["effective"]["texture"] == {"value": "sandy_loam", "source": "measured_by_farmer"}
    assert body["effective"]["ph"]["source"] == "modelled"
    # a farmer cannot write a "modelled" value, and bad values are refused
    assert c.put(f"/api/farms/{fid}/soil", headers=h, json={"layers": [{"property": "ph", "value": "6", "source": "modelled"}]}).status_code == 422
    assert c.put(f"/api/farms/{fid}/soil", headers=h, json={"layers": [{"property": "ph", "value": "15"}]}).status_code == 422
    assert c.put(f"/api/farms/{fid}/soil", headers=h, json={"layers": [{"property": "mood", "value": "x"}]}).status_code == 422


def test_modelled_soil_failure_is_502(api, monkeypatch):
    def broken(lat, lon):
        raise RuntimeError("could not reach SoilGrids")
    monkeypatch.setattr(terrain, "fetch_soilgrids", broken)
    fid = api["add_farm"]()
    assert api["client"].post(f"/api/farms/{fid}/soil/modelled", headers=api["h"]).status_code == 502


def test_threats_farmer_items_and_refresh(api):
    fid = api["add_farm"]()
    c, h = api["client"], api["h"]
    body = c.post(f"/api/farms/{fid}/threats", headers=h, json={"kind": "wild_animals", "note": "elephants in Yala"}).json()
    assert body["farmer"][0]["kind"] == "wild_animals" and body["farmer"][0]["level"] is None
    assert c.post(f"/api/farms/{fid}/threats", headers=h, json={"kind": "erosion"}).status_code == 422      # computed kinds are not farmer-listed
    refreshed = c.post(f"/api/farms/{fid}/threats/refresh", headers=h).json()
    assert {t["kind"] for t in refreshed["computed"]} == {"drought", "heat"}                                   # no zones yet: erosion not guessed
    tid = body["farmer"][0]["id"]
    assert c.delete(f"/api/farms/{fid}/threats/{refreshed['computed'][0]['id']}", headers=h).status_code == 403
    assert c.delete(f"/api/farms/{fid}/threats/{tid}", headers=h).json()["farmer"] == []


def test_other_farmers_farm_is_hidden_and_login_needed(api):
    fid = api["add_farm"]()
    other = api["login"]("0779999999")
    c = api["client"]
    for method, path in (("get", "zones"), ("get", "soil"), ("get", "threats")):
        assert getattr(c, method)(f"/api/farms/{fid}/{path}", headers=other).status_code == 404
        assert getattr(c, method)(f"/api/farms/{fid}/{path}").status_code == 401
    assert c.post(f"/api/farms/{fid}/zones/compute", headers=other).status_code == 404


def test_drawn_polygon_is_used_when_stored(api, monkeypatch):
    import json
    monkeypatch.setattr(terrain, "fetch_tile", fixture_tile)
    fid = api["add_farm"]()
    api["conn"].execute("INSERT INTO plot_polygon (farm_id, geojson, source) VALUES (?, ?, 'drawn')",
                        (fid, json.dumps({"type": "Polygon", "coordinates": [square_ring(50.0)]})))
    api["conn"].commit()
    body = api["client"].post(f"/api/farms/{fid}/zones/compute", headers=api["h"]).json()
    assert body["summary"]["plot_source"] == "drawn"


# ----------------------------------------------------------------- optional: the real elevation service

@pytest.mark.network
@pytest.mark.skipif(os.environ.get("RUN_NETWORK") != "1", reason="set RUN_NETWORK=1 to fetch a real tile")
def test_real_tile_near_anuradhapura(tmp_path, monkeypatch):
    monkeypatch.setenv("MC_DEM_CACHE", str(tmp_path))
    dem = terrain.build_dem(terrain.ring_bbox(square_ring(100.0)), zoom=14)
    assert -50 < dem["elev"].min() and dem["elev"].max() < 2500             # Sri Lanka: sea level to about 2500 m
    assert (tmp_path / "14").exists()                                       # the tile was cached on disk
