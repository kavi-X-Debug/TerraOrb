"""The NASA POWER square key must follow the same rule as pipeline/rain.py (docs/trip-spec.md section 2)."""

import json

import pytest

import rain                                        # pipeline/rain.py (conftest adds pipeline/ to sys.path)
from pipeline.trip import common


def test_examples_from_the_spec(cfg):
    assert common.cell_key(7.29, 80.63, cfg) == "7.5_80.625"          # Kandy, the example in the spec
    assert common.power_cell(8.31, 80.4, cfg) == (8.5, 80.625)


def test_same_rule_as_rain_py(cfg):
    places = json.loads((common.REPO / "data" / "places.json").read_text(encoding="utf-8"))["places"]
    for p in places:
        assert common.power_cell(p["lat"], p["lon"], cfg) == rain.power_cell(p["lat"], p["lon"], cfg), p["id"]


def test_key_matches_file_names_in_data_cells(cfg):
    for f in (common.REPO / "data" / "cells").glob("*.json"):
        lat, lon = f.stem.split("_")
        assert common.cell_key(float(lat), float(lon), cfg) == f.stem      # a square centre maps to its own key


@pytest.mark.parametrize("lat,lon", [(6.0, 80.0), (9.5, 80.0), (7.0, 81.875)])
def test_key_is_python_float_repr(cfg, lat, lon):
    k = common.cell_key(lat, lon, cfg)
    assert k == f"{float(k.split('_')[0])}_{float(k.split('_')[1])}"
