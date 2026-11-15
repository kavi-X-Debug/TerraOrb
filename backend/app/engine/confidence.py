"""Confidence = 0.4 x data quality + 0.3 x evidence + 0.3 x local verification (each 0 to 1). High from 0.7, medium from 0.4."""
W_DATA, W_EVIDENCE, W_LOCAL = 0.4, 0.3, 0.3
HIGH, MEDIUM = 0.7, 0.4
EVIDENCE_SCORE = {"V1": 1.0, "V2": 0.8, "V3": 0.4, "V4": 1.0, "assumption": 0.2}   # draft mapping, for review


def confidence(data_quality, evidence, local_verification):
    score = round(W_DATA * data_quality + W_EVIDENCE * evidence + W_LOCAL * local_verification, 4)
    return score, ("high" if score >= HIGH else "medium" if score >= MEDIUM else "low")


def evidence_value(levels):
    """The weakest evidence used decides (a plan is only as strong as its weakest claim)."""
    vals = [EVIDENCE_SCORE.get(level, 0.2) for level in levels]
    return min(vals) if vals else 0.2
