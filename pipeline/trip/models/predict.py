"""
ML estimates for the next day (ml_estimates.json) - written ONLY when it is honest to do so.

Conditions (all must hold, otherwise NO file is written and the reason goes into model_metadata.json):
  1. at least one model beats the climatology baseline on the held-out test years (`beats_baseline: true`);
  2. the newest rain value we have is at most [trip.ml] max_data_age_days old. NASA POWER lags real time by days,
     and rain from 1 Oct 2026 is skipped (GEOSIT), so with the current data this condition fails: a model that needs
     "rain yesterday" cannot say anything about tomorrow when our newest rain is weeks old.
Estimates are per destination, from the features of the destination's NASA POWER square.
"""

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402
from pipeline.trip.models import rainfall_classifier as clf  # noqa: E402
from pipeline.trip.models import rainfall_regressor as reg  # noqa: E402
from pipeline.trip.processing import feature_engineering as fe  # noqa: E402


def winners(metadata):
    """{task: model id} for the best model per task that beats the baseline (by test Brier / RMSE), or nothing."""
    best = {}
    for m in metadata["models"]:
        if not m["beats_baseline"]:
            continue
        score = m["metrics"]["brier"] if m["task"] == "occurrence" else m["metrics"]["rmse"]
        if m["task"] not in best or score < best[m["task"]][0]:
            best[m["task"]] = (score, m["id"])
    return {task: mid for task, (score, mid) in best.items()}


def latest_features(cells_latest, centres, elevations, cfg, features):
    """{key: (feature row as 1-row DataFrame, last observed date)} using rain up to the newest valid day of each square."""
    t, ml = cfg["trip"], cfg["trip"]["ml"]
    out = {}
    for key, df in cells_latest.items():
        rain = df["PRECTOTCORR"]
        last_valid = rain.last_valid_index()
        if last_valid is None:
            continue
        lat, lon = centres[key]
        f = fe.build_features(rain.loc[:last_valid], lat, lon, elevations.get(key), t["wet_day_mm"], ml, require_target=False)
        if f.empty or f.index[-1] != last_valid or not set(features) <= set(f.columns):
            continue                                       # not enough recent data (or no elevation the model was trained with)
        out[key] = (f.iloc[[-1]][features], last_valid.date())
    return out


def build_estimates(trained, metadata, cells_latest, centres, elevations, destinations, cfg, today=None):
    """(estimates document body or None, reason text). Pure given its inputs (`today` can be fixed in tests)."""
    ml = cfg["trip"]["ml"]
    today = today or date.today()
    win = winners(metadata)
    if not win:
        return None, "no model beats the climatology baseline on the held-out test years"
    feats = latest_features(cells_latest, centres, elevations, cfg, trained["features"])
    if not feats:
        return None, "no square has the recent rain needed for a prediction"
    newest = max(d for _, d in feats.values())
    age = (today - newest).days
    if age > ml["max_data_age_days"]:
        return None, (f"the newest rain value we have is from {newest} ({age} days old; limit {ml['max_data_age_days']}): "
                      "the models need rain up to yesterday, so no estimate is made")
    dests = {}
    for d in destinations:
        if d["cell"] not in feats:
            continue
        X, last = feats[d["cell"]]
        entry = {}
        if "occurrence" in win:
            entry["p_rain"] = round(float(clf.predict_proba(trained[win["occurrence"]]["model"], X)[0]), 3)
        if "amount" in win:
            entry["mm"] = round(float(reg.predict_mm(trained[win["amount"]]["model"], X)[0]), 2)
        entry["based_on_rain_until"] = last.isoformat()
        dests[d["id"]] = entry
    for_date = (pd.Timestamp(newest) + pd.Timedelta(1, "D")).date().isoformat()
    if for_date < today.isoformat():                       # the day after the newest rain has already passed: not a forecast any more
        return None, (f"the newest rain value is from {newest}, so the estimate would be for {for_date}, which is already in the past; "
                      "an estimate is only written for today or a later day")
    return {"ml_estimate": True, "for_date": for_date, "models": win, "destinations": dests}, "ok"
