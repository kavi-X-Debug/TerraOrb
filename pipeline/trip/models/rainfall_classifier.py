"""
Task A: will it rain (>= [trip.ml] occurrence_mm, 1 mm) on day t+1?   XGBoost and Random Forest classifiers.

Both give a probability. The hyper-parameters are in [trip.ml.xgb] and [trip.ml.rf] of pipeline/config.toml and were
fixed before looking at the test period. XGBoost uses the validation years only for early stopping.

Random Forest: scikit-learn's RandomForestClassifier is used when it can be imported. On the laptop this project was built
on, Windows Application Control (Smart App Control) blocks one of scikit-learn's compiled files (_kd_tree), so the import
fails; the code then falls back to XGBoost's own random-forest mode (XGBRFClassifier: many trees on random subsets of rows
and features, no boosting). `rf_name()` says which one is in use, and model_metadata.json records it.
"""

from xgboost import XGBClassifier, XGBRFClassifier

try:                                                       # may be blocked by Windows Application Control (see above)
    from sklearn.ensemble import RandomForestClassifier
    RF_IMPORT_ERROR = None
except Exception as err:                                   # noqa: BLE001 (any failure to load a compiled file)
    RandomForestClassifier = None
    RF_IMPORT_ERROR = str(err)[:160]


def rf_name():
    return "RandomForestClassifier" if RandomForestClassifier is not None else "XGBRFClassifier"


def rf_note():
    if RandomForestClassifier is not None:
        return None
    return ("scikit-learn's RandomForestClassifier could not be imported on this machine "
            f"({RF_IMPORT_ERROR}); XGBoost's random-forest mode (XGBRFClassifier) was used instead.")


def fit_xgb(X_train, y_train, X_valid, y_valid, ml_cfg):
    p = ml_cfg["xgb"]
    model = XGBClassifier(
        n_estimators=p["n_estimators"], max_depth=p["max_depth"], learning_rate=p["learning_rate"],
        subsample=p["subsample"], colsample_bytree=p["colsample_bytree"], eval_metric="logloss",
        early_stopping_rounds=p["early_stopping_rounds"], random_state=ml_cfg["seed"], n_jobs=2, verbosity=0)
    model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)], verbose=False)
    return model


def fit_rf(X_train, y_train, ml_cfg):
    p = ml_cfg["rf"]
    if RandomForestClassifier is not None:
        model = RandomForestClassifier(
            n_estimators=p["n_estimators"], max_depth=p["max_depth"], min_samples_leaf=p["min_samples_leaf"],
            random_state=ml_cfg["seed"], n_jobs=2)
    else:
        model = XGBRFClassifier(
            n_estimators=p["n_estimators"], max_depth=p["max_depth"], subsample=0.63, colsample_bynode=0.6,
            min_child_weight=max(1, p["min_samples_leaf"] // 8), random_state=ml_cfg["seed"], n_jobs=2, verbosity=0)
    model.fit(X_train, y_train)
    return model


def predict_proba(model, X):
    """Probability of rain on day t+1 for each row."""
    return model.predict_proba(X)[:, 1]
