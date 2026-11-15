"""
Tests for pipeline/water.py with small hand-made pixel grids. No internet or login needed.

    .venv\\Scripts\\python -m pytest pipeline\\tests -v
"""

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import water" works
import water  # noqa: E402

CFG = water.load_config()
PIXEL = 30 * 30          # one 30 m pixel = 900 m² = 0.09 ha


# ---------------------------------------------------------------------------
# Counting water pixels
# ---------------------------------------------------------------------------
def test_dswx_area_counts_open_and_partial_water_inside_polygon():
    wtr = np.array([[1, 1, 0],
                    [2, 253, 0],
                    [1, 0, 255]])
    inside = np.array([[True, True, True],
                       [True, True, True],
                       [False, True, True]])      # bottom-left water pixel is outside the tank
    area, bad = water.dswx_area(wtr, inside, PIXEL, water_values=[1, 2], bad_values=[253, 255])
    # Water inside: (0,0), (0,1), (1,0) = 3 pixels × 0.09 ha = 0.27 ha
    assert area == pytest.approx(0.27)
    # Bad inside: 253 at (1,1) and 255 at (2,2) = 2 of 8 inside pixels
    assert bad == pytest.approx(2 / 8)


def test_ndwi_area_uses_green_minus_nir_and_skips_cloud():
    green = np.array([[800, 800], [300, 800]])
    nir = np.array([[200, 200], [2500, 200]])
    # NDWI: (800-200)/1000 = 0.6 (water), (300-2500)/2800 < 0 (land)
    fmask = np.array([[0, 0b10], [0, 0]], dtype="uint8")    # bit 1 = cloud on (0,1)
    inside = np.ones((2, 2), dtype=bool)
    area, bad = water.ndwi_area(green, nir, fmask, inside, PIXEL, threshold=0.0,
                                fill_value=-9999, bad_bits=[1, 2, 3])
    # Water: (0,0) and (1,1) → 2 × 0.09 = 0.18 ha. (0,1) would be water but is cloud.
    assert area == pytest.approx(0.18)
    assert bad == pytest.approx(1 / 4)


def test_ndwi_fill_value_counts_as_bad_not_water():
    green = np.array([[-9999, 800]])
    nir = np.array([[-9999, 200]])
    fmask = np.zeros((1, 2), dtype="uint8")
    area, bad = water.ndwi_area(green, nir, fmask, np.ones((1, 2), bool), PIXEL, 0.0, -9999, [1, 2, 3])
    assert area == pytest.approx(0.09)
    assert bad == pytest.approx(0.5)


def test_empty_polygon_gives_no_area():
    area, bad = water.dswx_area(np.ones((2, 2)), np.zeros((2, 2), bool), PIXEL, [1], [255])
    assert area is None and bad == 1.0


# ---------------------------------------------------------------------------
# Reading a real GeoTIFF window (a small file we write ourselves)
# ---------------------------------------------------------------------------
def test_read_window_on_synthetic_geotiff(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin
    from shapely.geometry import box
    from pyproj import Transformer

    # 100 × 100 pixels of 30 m in UTM zone 44N (the zone of Anuradhapura), all land (0) ...
    wtr = np.zeros((100, 100), dtype="uint8")
    wtr[40:60, 40:60] = 1                     # ... except a 20 × 20 pixel "tank" = 400 px = 36 ha
    origin_x, origin_y = 400_000, 930_000
    path = tmp_path / "fake_WTR.tif"
    with rasterio.open(path, "w", driver="GTiff", height=100, width=100, count=1, dtype="uint8",
                       crs="EPSG:32644", transform=from_origin(origin_x, origin_y, 30, 30)) as dst:
        dst.write(wtr, 1)

    # A polygon (in lon/lat) around pixels 30..70, which contains the whole tank.
    to_lonlat = Transformer.from_crs("EPSG:32644", "EPSG:4326", always_xy=True).transform
    x0, x1 = origin_x + 30 * 30, origin_x + 70 * 30
    y0, y1 = origin_y - 70 * 30, origin_y - 30 * 30
    (lon0, lon1), (lat0, lat1) = to_lonlat([x0, x1], [y0, y1])
    polygon = box(lon0, lat0, lon1, lat1)

    pixels, inside, px_area = water.read_window(str(path), polygon, fill=255)
    area, bad = water.dswx_area(pixels, inside, px_area, [1, 2], [253, 255])
    assert px_area == pytest.approx(900)
    assert area == pytest.approx(36.0)        # 400 water pixels × 0.09 ha
    assert bad == 0


# ---------------------------------------------------------------------------
# Monthly medians, normal and T
# ---------------------------------------------------------------------------
def scenes(*pairs):
    return [{"date": d, "area_ha": a} for d, a in pairs]


def test_monthly_series_takes_median_and_lists_empty_months():
    s = water.monthly_series(scenes(("2024-01-05", 10.0), ("2024-01-20", 30.0), ("2024-01-28", 12.0),
                                    ("2024-03-10", 8.0)))
    assert s == [
        {"date": "2024-01-01", "extent_ha": 12.0, "scenes": 3},   # median of 10, 12, 30
        {"date": "2024-02-01", "extent_ha": None, "scenes": 0},   # no clear scene → null, not 0
        {"date": "2024-03-01", "extent_ha": 8.0, "scenes": 1},
    ]


def test_current_normal_and_T():
    measurements = scenes(("2023-10-10", 20.0), ("2024-10-12", 30.0), ("2025-09-01", 5.0),
                          ("2026-10-03", 15.0), ("2026-10-20", 17.0))
    series = water.monthly_series(measurements)
    out = water.current_and_normal(series, measurements)
    # Current = Oct 2026 median of 15 and 17 = 16. Normal = Oct 2023 and Oct 2024 = (20 + 30) / 2 = 25.
    assert out["current_extent_ha"] == 16.0
    assert out["current_date"] == "2026-10-20"
    assert out["normal_extent_ha"] == 25.0
    assert out["T"] == 0.64
    assert out["normal_period"] == "2023–2024 (2 years with data)"


def test_no_other_years_means_no_normal():
    measurements = scenes(("2026-10-03", 15.0))
    out = water.current_and_normal(water.monthly_series(measurements), measurements)
    assert out["normal_extent_ha"] is None and out["T"] is None


# ---------------------------------------------------------------------------
# Scene selection
# ---------------------------------------------------------------------------
def test_select_scenes_filters_cloud_coverage_and_duplicates():
    from shapely.geometry import box
    tank = box(80.0, 8.0, 80.01, 8.01)
    big = box(79.0, 7.0, 81.0, 9.0)
    edge = box(79.0, 7.0, 80.005, 9.0)          # cuts through the tank
    base = dict(footprint=big, product="DSWX", sensor="S2A", urls={})
    raw = [
        dict(base, id="a-old", date="2024-01-01", tile="T1", acquired="t1", produced="2024", cloud_percent=5),
        dict(base, id="a-new", date="2024-01-01", tile="T1", acquired="t1", produced="2025", cloud_percent=5),
        dict(base, id="b-tile2", date="2024-01-01", tile="T2", acquired="t1", produced="2025", cloud_percent=5),
        dict(base, id="cloudy", date="2024-02-01", tile="T1", acquired="t2", produced="2025", cloud_percent=30),
        dict(base, id="edge", date="2024-03-01", tile="T1", acquired="t3", produced="2025", cloud_percent=0,
             footprint=edge),
        None,                                    # unusable item (e.g. missing WTR file)
    ]
    kept = water.select_scenes(raw, tank, max_cloud=30)
    # a-new replaces a-old; b-tile2 is the same pass on a neighbouring tile; 30 % is not < 30;
    # "edge" doesn't cover the whole tank.
    assert [s["id"] for s in kept] == ["a-new"]


# ---------------------------------------------------------------------------
# Polygon
# ---------------------------------------------------------------------------
def test_buffer_polygon_has_the_right_area():
    pyproj = pytest.importorskip("pyproj")
    import shapely
    tank = {"id": "no-such-tank-polygon", "lat": 8.31, "lon": 80.45}
    polygon, note = water.tank_polygon(tank, CFG)
    local = f"+proj=aeqd +lat_0=8.31 +lon_0=80.45 +datum=WGS84 +units=m"
    to_m = pyproj.Transformer.from_crs("EPSG:4326", local, always_xy=True).transform
    r = CFG["water"]["buffer_m"]
    assert shapely.transform(polygon, to_m, interleaved=False).area == pytest.approx(math.pi * r * r, rel=0.01)
    assert "circle" in note
