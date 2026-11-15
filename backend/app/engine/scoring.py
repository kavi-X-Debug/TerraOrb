"""Scoring: crop function values times zone weights, zone/farmer blend, pairing and family rules."""
from .knowledge import FUNCTIONS

# Which crop function each farmer priority pushes (a design choice; low_work is handled by the labour rule, not here).
PRIORITY_TO_FUNCTIONS = {
    "save_water": {"drought": 1.0},
    "income": {"income": 1.0},
    "soil": {"erosion": 0.5, "organic_matter": 0.5},
    "family_food": {"income": 0.5, "organic_matter": 0.5},
}


def score_crop(crop, weights):
    """Sum of weight x function value (0 to 3). Gliricidia on steep ground: 0.5*3 + 0.2*3 + 0.2*1 + 0.1*3 = 2.6.
    -> {score, parts:{function: weight*value}}"""
    fn = crop.get("functions", {}) or {}
    parts = {f: round(weights.get(f, 0) * fn.get(f, 0), 4) for f in FUNCTIONS}
    return {"score": round(sum(parts.values()), 4), "parts": parts}


def priorities_to_weights(priorities):
    w = {f: 0.0 for f in FUNCTIONS}
    for p, v in (priorities or {}).items():
        for f, share in PRIORITY_TO_FUNCTIONS.get(p, {}).items():
            w[f] += v * share
    total = sum(w.values())
    return {f: (x / total if total else 0.0) for f, x in w.items()}


def blend(zone_weights, farmer_priorities, zone_share=0.7):
    """70% zone weights + 30% farmer priorities (the owner's split, a design choice to test). Result sums to 1.
    With no priorities the zone weights are used alone."""
    fw = priorities_to_weights(farmer_priorities)
    if not any(fw.values()):
        return dict(zone_weights)
    return {f: round(zone_share * zone_weights.get(f, 0) + (1 - zone_share) * fw[f], 6) for f in FUNCTIONS}


def pair_flags(crops):
    """Known conflicts between crops used together or in a row -> [{a, b, reason, evidence}]."""
    ids = {c["id"] for c in crops}
    out = []
    for c in crops:
        for x in c.get("conflicts", []) or []:
            if x.get("with") in ids:
                out.append({"a": c["id"], "b": x["with"], "reason": x.get("reason"), "evidence": x.get("evidence")})
    return out


def family_penalty(previous, crop, penalty=0.5):
    """Same botanical family as the previous crop on the same ground: disease carry-over -> penalty (0 if none)."""
    if previous and previous.get("family") and previous.get("family") == crop.get("family"):
        return penalty
    return 0.0
