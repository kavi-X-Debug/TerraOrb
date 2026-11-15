"""Tests for evaluation, training, honest 'beats baseline' logic, ml_estimates gating and data validation.
All data is SYNTHETIC (generated in the test)."""

import copy
from datetime import date

import numpy as np
import pandas as pd
import pytest

from pipeline.trip import common
from pipeline.trip.models import evaluate as ev
from pipeline.trip.models import predict, train
from pipeline.trip.validation import validate_data as vd


# ---------------------------------------------------------------------------
# evaluate.py: by hand
# ---------------------------------------------------------------------------
def test_occurrence_metrics_by_hand():
    y = np.array([1, 1, 0, 0])
    p = np.array([0.9, 0.4, 0.6, 0.1])
    m = ev.occurrence_metrics(y, p, 0.5)
    # predictions at 0.5: [1, 0, 1, 0] -> tp 1, fp 1, fn 1 -> precision 0.5, recall 0.5, f1 0.5
    assert (m["precision"], m["recall"], m["f1"]) == (0.5, 0.5, 0.5)
    assert m["brier"] == pytest.approx((0.01 + 0.36 + 0.36 + 0.01) / 4)
    assert m["roc_auc"] == 0.75                    # 3 of the 4 (wet, dry) pairs are ordered correctly


def test_amount_metrics_by_hand():
    m = ev.amount_metrics([0, 2, 4], [1, 2, 1])
    assert m["mae"] == pytest.approx((1 + 0 + 3) / 3, abs=1e-4)
    assert m["rmse"] == pytest.approx(np.sqrt((1 + 0 + 9) / 3), abs=1e-4)
    assert m["bias"] == pytest.approx((1 + 0 - 3) / 3, abs=1e-4)


def test_calibration_bins_sum_to_n():
    rng = np.random.default_rng(0)
    p = rng.random(500)
    y = (rng.random(500) < p).astype(int)
    bins = ev.calibration_bins(y, p)
    assert sum(b["n"] for b in bins) == 500
    assert all(abs(b["mean_pred"] - b["observed"]) < 0.25 for b in bins)       # a calibrated synthetic predictor


def test_share_of_years_better():
    years = np.array([2019, 2019, 2020, 2020])
    assert ev.share_of_years_better(years, [0, 0, 5, 5], [1, 1, 1, 1]) == 0.5


def test_single_class_auc_is_none():
    assert ev.safe_auc([0, 0, 0], [0.1, 0.2, 0.3]) is None


# ---------------------------------------------------------------------------
# training on synthetic squares
# ---------------------------------------------------------------------------
def synthetic_cells(structured, years=("1981-01-01", "2025-12-31")):
    """SYNTHETIC squares. structured=False: rain is pure seasonal chance (climatology is the best possible model).
    structured=True: wet days come in long spells (yesterday's rain strongly predicts tomorrow's)."""
    idx = pd.date_range(*years, freq="D")
    cells = {}
    for n, key in enumerate(["7.5_80.625", "8.0_80.0"]):
        rng = np.random.default_rng(10 + n)
        doy = idx.dayofyear.to_numpy()
        base = 0.15 + 0.35 * (np.sin(2 * np.pi * (doy - 100) / 365) > 0)
        if structured:
            wet = np.zeros(len(idx), bool)
            for i in range(1, len(idx)):
                p = 0.85 if wet[i - 1] else 0.08                       # a two-state Markov chain: strong persistence
                wet[i] = rng.random() < p
        else:
            wet = rng.random(len(idx)) < base
        mm = np.where(wet, rng.gamma(1.2, 5.0, len(idx)) + 1.0, rng.random(len(idx)) * 0.5)
        cells[key] = pd.DataFrame({"PRECTOTCORR": mm, "T2M_MAX": 30.0}, index=idx)
    return cells


def small_cfg(cfg):
    c = copy.deepcopy(cfg)
    c["trip"]["ml"]["xgb"].update(n_estimators=60, early_stopping_rounds=10)
    c["trip"]["ml"]["rf"].update(n_estimators=40, max_depth=8)
    return c


def run_train(cells, cfg):
    centres = {"7.5_80.625": (7.5, 80.625), "8.0_80.0": (8.0, 80.0)}
    return train.run(cells, centres, {"7.5_80.625": 100, "8.0_80.0": 80}, small_cfg(cfg), log=lambda *_: None)


def test_pure_seasonal_noise_does_not_beat_climatology(cfg):
    """The honest-evaluation rule: when climatology is the truth, no model may claim to beat it."""
    result, _ = run_train(synthetic_cells(structured=False), cfg)
    occ = [m for m in result["models"] if m["task"] == "occurrence"]
    assert len(occ) == 2
    assert not any(m["beats_baseline"] for m in occ)


def test_persistent_rain_is_detected_as_beating_climatology(cfg):
    result, _ = run_train(synthetic_cells(structured=True), cfg)
    occ = {m["id"]: m for m in result["models"]}
    for mid in ("xgb_occurrence", "rf_occurrence"):
        m = occ[mid]
        assert m["metrics"]["brier"] < m["baseline"]["brier"] and m["beats_baseline"] is True
    rec = occ["xgb_occurrence"]
    assert {"precision", "recall", "f1", "roc_auc", "brier"} <= set(rec["metrics"])
    assert set(rec["by_cell"]) == {"7.5_80.625", "8.0_80.0"} and rec["by_season"] and rec["calibration"]
    assert rec["train"] == "1981-2012" and rec["valid"] == "2013-2018" and rec["test"] == "2019-2025"
    assert result["rows"]["test"] > 0 and result["n_squares"] == 2


def test_training_refuses_with_too_few_squares(cfg):
    one = dict(list(synthetic_cells(False).items())[:1])
    assert train.run(one, {"7.5_80.625": (7.5, 80.625)}, {}, cfg, log=lambda *_: None) == (None, None)


# ---------------------------------------------------------------------------
# ml_estimates.json gating
# ---------------------------------------------------------------------------
def test_no_estimates_when_no_model_wins(cfg):
    meta = {"models": [{"id": "a", "task": "occurrence", "beats_baseline": False, "metrics": {"brier": 0.2}}]}
    est, reason = predict.build_estimates({"features": []}, meta, {}, {}, {}, [], cfg)
    assert est is None and "no model beats" in reason


def test_no_estimates_when_newest_rain_is_old(cfg):
    cells = synthetic_cells(structured=True, years=("2001-01-01", "2025-12-31"))
    result, trained = run_train(cells, cfg)
    result["models"][0]["beats_baseline"] = True            # pretend the model won, to test the second gate on its own
    centres = {"7.5_80.625": (7.5, 80.625), "8.0_80.0": (8.0, 80.0)}
    dests = [{"id": "kandy", "cell": "7.5_80.625"}]
    elev = {"7.5_80.625": 100, "8.0_80.0": 80}
    est, reason = predict.build_estimates(trained, result, cells, centres, elev, dests, cfg, today=date(2026, 11, 15))
    assert est is None and "days old" in reason                       # data ends 2025-12-31: far too old
    est, reason = predict.build_estimates(trained, result, cells, centres, elev, dests, cfg, today=date(2026, 1, 1))
    assert est is not None and 0 <= est["destinations"]["kandy"]["p_rain"] <= 1
    assert est["ml_estimate"] is True and est["for_date"] == "2026-01-01"


# ---------------------------------------------------------------------------
# validation of the files
# ---------------------------------------------------------------------------
def good_destination(i=0, **over):
    d = {"id": f"p{i}", "name_en": f"Place {i}", "name_si": None, "lat": 7.29, "lon": 80.63, "region": "Central",
         "kinds": ["culture"], "activities": ["culture", "sightseeing"], "cell": "7.5_80.625", "elevation_m": 500,
         "cost_level": 2, "cost_level_evidence": "assumption", "osm": None, "image": None, "note": None}
    d.update(over)
    return d


def dest_doc(n=40, **over):
    doc = {"schema": "trip-destinations-1", "generated": "x", "source": "s", "demo": False, "destinations": [good_destination(i) for i in range(n)]}
    doc.update(over)
    return doc


def test_valid_destinations_pass(cfg):
    assert vd.validate_destinations(dest_doc(), cfg) == []


def test_destination_problems_are_found(cfg):
    assert any("only 3" in p for p in vd.validate_destinations(dest_doc(3), cfg))
    bad = dest_doc()
    bad["destinations"][0].update(cell="1.0_1.0", kinds=["moon"], cost_level_evidence=None, lat=50.0)
    problems = " | ".join(vd.validate_destinations(bad, cfg))
    assert "does not match the NASA POWER square rule" in problems and "bad kinds" in problems
    assert "flagged as an assumption" in problems and "outside Sri Lanka" in problems
    dup = dest_doc()
    dup["destinations"][1]["id"] = "p0"
    assert any("duplicate" in p for p in vd.validate_destinations(dup, cfg))


def history_doc(keys=("7.5_80.625",)):
    block = {"p_wet": [0.3] * 365 + [None], "mean_mm": [2.0] * 365 + [None], "p90_mm": [8.0] * 365 + [None],
             "monthly_mm": [100.0] * 12, "tmax_c_monthly": None}
    return {"schema": "trip-history-1", "generated": "x", "source": "s", "demo": False, "wet_day_mm": 1.0, "window_days": 7,
            "years": 45, "missing_cells": [], "cells": {k: copy.deepcopy(block) for k in keys}}


def test_history_validation():
    assert vd.validate_history(history_doc()) == []
    doc = history_doc()
    doc["cells"]["7.5_80.625"]["p_wet"][10] = 1.4
    doc["cells"]["7.5_80.625"]["mean_mm"] = [1.0] * 300
    problems = " | ".join(vd.validate_history(doc))
    assert "outside 0..1" in problems and "366 values" in problems
    dests = [good_destination(cell="9.5_80.0")]
    assert any("neither present nor listed as missing" in p for p in vd.validate_history(history_doc(), dests))
    ok = history_doc()
    ok["missing_cells"] = ["9.5_80.0"]
    assert vd.validate_history(ok, dests) == []


def test_models_validation_rules():
    base = {"schema": "trip-models-1", "generated": "x", "source": "s", "demo": False, "ml_available": False,
            "imerg": {"used": False, "reason": "no Earthdata token"},
            "models": [{"id": "m", "beats_baseline": False, "baseline": {}}]}
    assert vd.validate_models(base, estimates_exist=False) == []
    assert any("no model beats" in p for p in vd.validate_models(base, estimates_exist=True))   # an estimate without a winner is forbidden
    claim = copy.deepcopy(base)
    claim["imerg"]["used"] = True
    assert any("imerg" in p for p in vd.validate_models(claim, False))


def test_config_validation_and_generated_values(cfg):
    doc = {"schema": "trip-config-1", "generated": "x", "source": "s", "demo": False, "intensity": dict(cfg["trip"]["intensity"]),
           "weights": dict(cfg["trip"]["weights"])}
    assert vd.validate_config(doc) == []
    doc["weights"]["weather"] = 0.9
    assert any("add up" in p for p in vd.validate_config(doc))
    t = cfg["trip"]
    assert (t["intensity"]["light_min"], t["intensity"]["moderate_min"], t["intensity"]["heavy_min"], t["intensity"]["very_heavy_min"]) == (0.1, 2.5, 10, 50)
    assert t["weights"] == {"weather": 0.40, "activity": 0.25, "preference": 0.20, "environment": 0.15}
    assert t["verdict"] == {"wet_mm": 3, "wet_chance": 70, "maybe_mm": 0.5, "maybe_chance": 35}
    assert t["day_periods"]["morning"] == [6, 11]


def test_env_validation_requires_source_for_ndvi():
    doc = {"schema": "trip-env-1", "generated": "x", "source": "s", "demo": False,
           "destinations": {"a": {"elevation_m": 1, "slope_pct": None, "ndvi": 0.5, "ndvi_source": None},
                            "b": {"elevation_m": 1, "slope_pct": None, "ndvi": None, "ndvi_source": None}}}
    problems = vd.validate_env(doc)
    assert len(problems) == 1 and "ndvi without ndvi_source" in problems[0]


def test_forecast_validation():
    n = 16
    entry = {"hourly": {"time": ["t"] * (n * 24), "precipitation": [0] * (n * 24)}, "daily": {"time": ["d"] * n, "precipitation_sum": [0] * n}}
    doc = {"schema": "trip-forecast-1", "generated": "x", "source": "s", "demo": False, "fetched_at": "x", "not_nasa": True, "destinations": {"a": entry}}
    assert vd.validate_forecast(doc) == []
    doc["not_nasa"] = False
    assert any("not_nasa" in p for p in vd.validate_forecast(doc))


def test_header_helper_has_all_fields():
    h = common.header("history", "src")
    assert {"schema", "generated", "source", "demo"} <= set(h) and h["demo"] is False and h["generated"][-6:] == "+05:30"
