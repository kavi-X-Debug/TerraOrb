"""
Train and evaluate the rain models, and write data/trip/model_metadata.json.

    .venv\\Scripts\\python -m pipeline.trip.main --only ml

Data: daily NASA POWER rain for every square we have (1981-2025). One pooled model per task, trained on all squares.
Splits are chronological by the TARGET day: train 1981-2012, validation 2013-2018 (early stopping and the probability
threshold only), test 2019-2025 (never used to choose anything). Four models: XGBoost and Random Forest for
Task A (rain >= 1 mm tomorrow) and Task B (rain amount tomorrow), each compared with a climatology baseline built from the
training years only. `beats_baseline` is true only if the model is better overall AND in more than half of the test years.
The result is written whether or not a model wins. The web app shows an ML estimate only if `beats_baseline` is true.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402
from pipeline.trip.models import evaluate as ev  # noqa: E402
from pipeline.trip.models import rainfall_classifier as clf  # noqa: E402
from pipeline.trip.models import rainfall_regressor as reg  # noqa: E402
from pipeline.trip.processing import cleaning, feature_engineering as fe  # noqa: E402


def build_dataset(cells, centres, elevations, cfg):
    """Stack the features of every square. cells: {key: daily DataFrame}; centres: {key: (lat, lon)}; elevations: {key: m or None}."""
    t, ml = cfg["trip"], cfg["trip"]["ml"]
    parts = []
    for key, df in cells.items():
        lat, lon = centres[key]
        f = fe.build_features(df["PRECTOTCORR"], lat, lon, elevations.get(key), t["wet_day_mm"], ml)
        f["cell"] = key
        parts.append(f)
    data = pd.concat(parts).sort_values(["target_date", "cell"]).reset_index(drop=True)
    # elevation must exist for every square or the column is dropped (never filled with a guess)
    if "elevation_m" in data and data["elevation_m"].isna().any():
        data = data.drop(columns="elevation_m")
    return data


def climatology_baseline(cells, data, cfg):
    """Baseline predictions for every row of `data`: from the training years only, for the target calendar day.
    Returns (p_wet, mean_mm) arrays aligned with data."""
    t, ml = cfg["trip"], cfg["trip"]["ml"]
    half = (t["window_days"] - 1) // 2
    tables = {}
    for key, df in cells.items():
        rain = df["PRECTOTCORR"].loc[ml["train_first"]:ml["train_last"]]
        idx = cleaning.day_index(rain.index)
        p_wet, mean_mm, _ = cleaning.window_stats(rain.to_numpy(float), idx, ml["occurrence_mm"], half)
        tables[key] = (p_wet, mean_mm)
    tidx = cleaning.day_index(pd.DatetimeIndex(data["target_date"]))
    p = np.empty(len(data))
    m = np.empty(len(data))
    for key, (pw, mm) in tables.items():
        sel = (data["cell"] == key).to_numpy()
        p[sel] = pw[tidx[sel]]
        m[sel] = mm[tidx[sel]]
    return p, m


def _split_text(ml, a, b):
    return f"{ml[a][:4]}-{ml[b][:4]}"


def evaluate_occurrence(model_id, algo, proba, thr, base_p, d_test, ml, features, notes):
    """The model_metadata record of one Task A model, from test-year probabilities."""
    y = d_test["y_wet"].to_numpy()
    years = pd.DatetimeIndex(d_test["target_date"]).year.to_numpy()
    seasons = fe.season_of(d_test["target_date"])
    cells = d_test["cell"].to_numpy()
    loss_m, loss_b = (proba - y) ** 2, (base_p - y) ** 2
    share = ev.share_of_years_better(years, loss_m, loss_b)
    m, b = ev.occurrence_metrics(y, proba, thr), ev.occurrence_metrics(y, base_p, thr)
    beats = bool(m["brier"] < b["brier"] and (m["roc_auc"] or 0) > (b["roc_auc"] or 0) and share > ml["min_test_years_better"])
    pair = lambda mask: {"model_brier": ev._r(loss_m[mask].mean()), "baseline_brier": ev._r(loss_b[mask].mean()),   # noqa: E731
                         "model_auc": ev._r(ev.safe_auc(y[mask], proba[mask])), "baseline_auc": ev._r(ev.safe_auc(y[mask], base_p[mask])),
                         "n": int(mask.sum())}
    return {
        "id": model_id, "task": "occurrence", "algo": algo, "target": f"rain >= {ml['occurrence_mm']:g} mm on day t+1",
        "features": features, "train": _split_text(ml, "train_first", "train_last"), "valid": _split_text(ml, "valid_first", "valid_last"),
        "test": _split_text(ml, "test_first", "test_last"),
        "metrics": {k: m[k] for k in ("precision", "recall", "f1", "roc_auc", "brier", "threshold", "n")},
        "baseline": {"name": "climatology", "brier": b["brier"], "roc_auc": b["roc_auc"], "precision": b["precision"],
                     "recall": b["recall"], "f1": b["f1"]},
        "share_of_test_years_better": round(share, 3),
        "beats_baseline": beats,
        "by_cell": ev.grouped(cells, pair), "by_season": ev.grouped(seasons, pair),
        "calibration": ev.calibration_bins(y, proba), "calibration_baseline": ev.calibration_bins(y, base_p),
        "notes": notes,
    }


def evaluate_amount(model_id, algo, pred, base_mm, d_test, ml, features, notes):
    y = d_test["y_mm"].to_numpy()
    years = pd.DatetimeIndex(d_test["target_date"]).year.to_numpy()
    seasons = fe.season_of(d_test["target_date"])
    cells = d_test["cell"].to_numpy()
    loss_m, loss_b = (pred - y) ** 2, (base_mm - y) ** 2
    share = ev.share_of_years_better(years, loss_m, loss_b)
    m, b = ev.amount_metrics(y, pred), ev.amount_metrics(y, base_mm)
    beats = bool(m["rmse"] < b["rmse"] and share > ml["min_test_years_better"])
    pair = lambda mask: {"model_rmse": ev.amount_metrics(y[mask], pred[mask])["rmse"],       # noqa: E731
                         "baseline_rmse": ev.amount_metrics(y[mask], base_mm[mask])["rmse"], "n": int(mask.sum())}
    return {
        "id": model_id, "task": "amount", "algo": algo, "target": "rain amount (mm) on day t+1, all days",
        "features": features, "train": _split_text(ml, "train_first", "train_last"), "valid": _split_text(ml, "valid_first", "valid_last"),
        "test": _split_text(ml, "test_first", "test_last"),
        "metrics": m,
        "baseline": {"name": "climatology", "mae": b["mae"], "rmse": b["rmse"], "bias": b["bias"]},
        "share_of_test_years_better": round(share, 3),
        "beats_baseline": beats,
        "by_cell": ev.grouped(cells, pair), "by_season": ev.grouped(seasons, pair),
        "calibration": None, "notes": notes,
    }


def run(cells, centres, elevations, cfg, log=print):
    """Train + evaluate. Returns (metadata dict without header, trained dict with the fitted models for predict.py)."""
    ml = cfg["trip"]["ml"]
    if len(cells) < ml["min_cells"]:
        return None, None
    data = build_dataset(cells, centres, elevations, cfg)
    features = [c for c in fe.feature_names(ml, with_elevation="elevation_m" in data.columns)]
    tr, va, te = fe.split_masks(data["target_date"], ml)
    d_tr, d_va, d_te = data[tr], data[va], data[te]
    log(f"  rows: train {len(d_tr)}, valid {len(d_va)}, test {len(d_te)} ({len(cells)} squares, {len(features)} features)")
    base_p, base_mm = climatology_baseline(cells, data, cfg)
    base_p_te, base_mm_te = base_p[te], base_mm[te]

    Xtr, Xva, Xte = d_tr[features], d_va[features], d_te[features]
    models, trained = [], {"features": features, "cells": sorted(cells)}

    # Task A: occurrence
    note_a = ("Trained on all squares together. Probability threshold for precision/recall/F1 chosen on the validation years "
              "(same rule for the baseline). Test years were not used for any choice.")
    for mid, algo, fit in (("xgb_occurrence", "XGBClassifier", lambda: clf.fit_xgb(Xtr, d_tr["y_wet"], Xva, d_va["y_wet"], ml)),
                           ("rf_occurrence", clf.rf_name(), lambda: clf.fit_rf(Xtr, d_tr["y_wet"], ml))):
        model = fit()
        thr = ev.best_threshold(d_va["y_wet"], clf.predict_proba(model, Xva))
        extra = f" {clf.rf_note()}" if mid == "rf_occurrence" and clf.rf_note() else ""
        rec = evaluate_occurrence(mid, algo, clf.predict_proba(model, Xte), thr, base_p_te, d_te, ml, features, note_a + extra)
        models.append(rec)
        trained[mid] = {"model": model, "threshold": thr}
        log(f"  {mid}: Brier {rec['metrics']['brier']} vs climatology {rec['baseline']['brier']}; "
            f"AUC {rec['metrics']['roc_auc']} vs {rec['baseline']['roc_auc']}; beats baseline: {rec['beats_baseline']}")

    # Task B: amount
    note_b = "Rain amounts are very skewed (many dry days), so a model that predicts the average is hard to beat; RMSE decides."
    for mid, algo, fit in (("xgb_amount", "XGBRegressor", lambda: reg.fit_xgb(Xtr, d_tr["y_mm"], Xva, d_va["y_mm"], ml)),
                           ("rf_amount", reg.rf_name(), lambda: reg.fit_rf(Xtr, d_tr["y_mm"], ml))):
        model = fit()
        extra = f" {reg.rf_note()}" if mid == "rf_amount" and reg.rf_note() else ""
        rec = evaluate_amount(mid, algo, reg.predict_mm(model, Xte), base_mm_te, d_te, ml, features, note_b + extra)
        models.append(rec)
        trained[mid] = {"model": model}
        log(f"  {mid}: RMSE {rec['metrics']['rmse']} vs climatology {rec['baseline']['rmse']}; beats baseline: {rec['beats_baseline']}")
    return {"models": models, "n_squares": len(cells), "squares": sorted(cells),
            "rows": {"train": int(len(d_tr)), "valid": int(len(d_va)), "test": int(len(d_te))}}, trained
