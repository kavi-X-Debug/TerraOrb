"""
Tests for the extra NASA farm datasets (pipeline/smap.py, modis_water.py, imerg_tanks.py, soil_moisture.py).
No internet needed: only the pure helper functions and tiny hand-made inputs. Run from the repo root:

    .venv\\Scripts\\python -m pytest pipeline\\tests\\test_farm_nasa_extras.py -v
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from pipeline import modis_water, smap  # noqa: E402


def test_ease_grid_row_col_matches_a_real_smap_file():
    # Checked against the coordinates inside SMAP_L3_SM_P_E_20261113: the box 10.0 N 79.3 E to 5.6 N 82.2 E is rows 670..732, columns 2776..2807.
    assert smap.rowcol(10.0, 79.3) == (670, 2776)
    assert smap.rowcol(5.6, 82.2) == (732, 2807)


def test_ease_grid_rows_go_south_and_columns_go_east():
    r1, c1 = smap.rowcol(8.0, 80.0)
    r2, c2 = smap.rowcol(7.0, 81.0)
    assert r2 > r1 and c2 > c1


def test_block_median_drops_fill_values_and_needs_enough_pixels():
    # ET: scale 0.1, fill values 32761 and above are not real
    assert modis_water.block_median([100, 120, 140, 32767, 110], -32767, 32760, 0.1) == 11.5      # median of 100,110,120,140 = 115 -> 11.5 mm
    assert modis_water.block_median([100, 32767, 32767], -32767, 32760, 0.1) is None              # only 1 real pixel: never a guess
    # LST: 0 is the fill value
    assert modis_water.block_median([15000, 15200, 0, 15400, 15100], 1, 65534, 0.02) == 303.0     # median of 15000,15100,15200,15400 = 15150 -> 303.0 K


def test_monthly_usual_uses_only_earlier_years_and_needs_six_values():
    obs = {f"{y}-03-{d:02d}": float(v) for y in (2019, 2020) for d, v in ((1, 10), (9, 12), (17, 14))}      # 6 values in March before 2021
    obs["2021-03-01"] = 99.0                                                                                # the newest year must not enter the usual
    usual = modis_water.monthly_usual(obs, 2021)
    assert usual["3"] == {"mean": 12.0, "n": 6}
    assert usual["4"] is None


def test_lst_quality_filter_keeps_only_clear_good_pixels():
    assert modis_water.clear_pixel(0b00000000) is True            # good quality, error <= 1 K
    assert modis_water.clear_pixel(0b01000000) is True            # good quality, error <= 2 K
    assert modis_water.clear_pixel(0b00000010) is False           # bits 0-1 = 10: cloud
    assert modis_water.clear_pixel(0b00000011) is False           # no data
    assert modis_water.clear_pixel(0b10000000) is False           # error up to 3 K: too uncertain
