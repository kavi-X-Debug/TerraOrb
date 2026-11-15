"""
Task B: how much rain (mm) on day t+1 (all days, including dry ones)?   XGBoost and Random Forest regressors.

Rain amounts are very skewed (many zeros, a few huge days), so these models mostly learn the average; the evaluation
compares them with the climatology mean for that calendar day, which is hard to beat.
Random Forest falls back to XGBoost's random-forest mode if scikit-learn's cannot be imported (see rainfall_classifier.py).
"""

from xgboost import XGBRegressor, XGBRFRegressor

try:
    from sklearn.ensemble import RandomForestRegressor
    RF_IMPORT_ERROR = None
except Exception as err:                                   # noqa: BLE001
    RandomForestRegressor = None
    RF_IMPORT_ERROR = str(err)[:160]


def rf_name():
    return "RandomForestRegressor" if RandomForestRegressor is not None else "XGBRFRegressor"


def rf_note():
    if RandomForestRegressor is not None:
        return None
    return ("scikit-learn's RandomForestRegressor could not be imported on this machine "
            f"({RF_IMPORT_ERROR}); XGBoost's random-forest mode (XGBRFRegressor) was used instead.")


def fit_xgb(X_train, y_train, X_valid, y_valid, ml_cfg):
    p = ml_cfg["xgb"]
    model = XGBRegressor(
        n_estimators=p["n_estimators"], max_depth=p["max_depth"], learning_rate=p["learning_rate"],
        subsample=p["subsample"], colsample_bytree=p["colsample_bytree"],
        early_stopping_rounds=p["early_stopping_rounds"], random_state=ml_cfg["seed"], n_jobs=2, verbosity=0)
    model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)], verbose=False)
    return model


def fit_rf(X_train, y_train, ml_cfg):
    p = ml_cfg["rf"]
    if RandomForestRegressor is not None:
        model = RandomForestRegressor(
            n_estimators=p["n_estimators"], max_depth=p["max_depth"], min_samples_leaf=p["min_samples_leaf"],
            random_state=ml_cfg["seed"], n_jobs=2)
    else:
        model = XGBRFRegressor(
            n_estimators=p["n_estimators"], max_depth=p["max_depth"], subsample=0.63, colsample_bynode=0.6,
            min_child_weight=max(1, p["min_samples_leaf"] // 8), random_state=ml_cfg["seed"], n_jobs=2, verbosity=0)
    model.fit(X_train, y_train)
    return model


def predict_mm(model, X):
    """Rain amount for day t+1 in mm; never below zero."""
    return model.predict(X).clip(min=0)
