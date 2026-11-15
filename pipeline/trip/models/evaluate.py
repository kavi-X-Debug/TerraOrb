"""
Honest evaluation of the rain models against the climatology baseline (pure functions: arrays in, numbers out).

The baseline is "climatology": for the target day, the share of wet days (Task A) or the mean rain (Task B) in a +/-3-day
window of the same calendar day over the TRAINING years only. A model is shown to users only if it beats this baseline
on the held-out test years: lower Brier score (A) or lower RMSE (B) overall AND in more than
[trip.ml] min_test_years_better of the individual test years.
"""

import numpy as np
import pandas as pd

# (Metrics are written with numpy so that this module never needs scikit-learn's compiled files, which Windows
# Application Control blocks on some machines.)


def brier_score_loss(y, p):
    """Mean squared error of the probability: 0 is perfect, always saying the base rate scores base*(1-base)."""
    return float(np.mean((np.asarray(p, float) - np.asarray(y, float)) ** 2))


def roc_auc_score(y, p):
    """Probability that a random wet day gets a higher score than a random dry day (ties count half)."""
    y = np.asarray(y).astype(int)
    ranks = pd.Series(np.asarray(p, float)).rank(method="average").to_numpy()
    n_pos, n_neg = int((y == 1).sum()), int((y == 0).sum())
    return float((ranks[y == 1].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def safe_auc(y, p):
    y = np.asarray(y)
    return None if len(np.unique(y)) < 2 else float(roc_auc_score(y, p))


def best_threshold(y, p):
    """Probability threshold with the best F1 on the VALIDATION years (never chosen on the test years)."""
    best, best_f1 = 0.5, -1.0
    for thr in np.linspace(0.05, 0.95, 91):
        f1 = classification_counts(y, p, thr)["f1"]
        if f1 is not None and f1 > best_f1:
            best, best_f1 = float(thr), f1
    return best


def classification_counts(y, p, thr):
    y = np.asarray(y).astype(int)
    pred = (np.asarray(p) >= thr).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision is not None and recall is not None else None)
    return {"precision": precision, "recall": recall, "f1": f1}


def _r(x, nd=4):
    return None if x is None else round(float(x), nd)


def occurrence_metrics(y, p, thr):
    c = classification_counts(y, p, thr)
    return {"precision": _r(c["precision"]), "recall": _r(c["recall"]), "f1": _r(c["f1"]),
            "roc_auc": _r(safe_auc(y, p)), "brier": _r(brier_score_loss(y, p)), "threshold": _r(thr, 2), "n": int(len(y))}


def calibration_bins(y, p, bins=10):
    """Reliability table: for each probability bin, the mean predicted probability and the observed wet share."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for i in range(bins):
        hi_ok = p <= edges[i + 1] if i == bins - 1 else p < edges[i + 1]
        m = (p >= edges[i]) & hi_ok
        if m.sum() == 0:
            continue
        out.append({"bin": [round(edges[i], 2), round(edges[i + 1], 2)], "mean_pred": _r(p[m].mean()),
                    "observed": _r(y[m].mean()), "n": int(m.sum())})
    return out


def amount_metrics(y, pred):
    y, pred = np.asarray(y, float), np.asarray(pred, float)
    err = pred - y
    return {"mae": _r(np.abs(err).mean()), "rmse": _r(np.sqrt((err ** 2).mean())), "bias": _r(err.mean()), "n": int(len(y))}


def share_of_years_better(years, loss_model, loss_base):
    """Share of the years in which the model's mean loss is lower than the baseline's (per-element losses in, one per day)."""
    years, lm, lb = np.asarray(years), np.asarray(loss_model, float), np.asarray(loss_base, float)
    better, total = 0, 0
    for yr in np.unique(years):
        m = years == yr
        total += 1
        better += int(lm[m].mean() < lb[m].mean())
    return better / total if total else 0.0


def grouped(values_by_group, fn):
    """{group: fn(mask)} helper: values_by_group is an array of group labels; fn gets a boolean mask. Empty groups are skipped."""
    out = {}
    for g in sorted(set(values_by_group)):
        m = np.asarray(values_by_group) == g
        if m.sum() >= 30:
            out[str(g)] = fn(m)
    return out
