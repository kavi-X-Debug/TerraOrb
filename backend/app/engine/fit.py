"""Crop filter: does a crop fit a zone? score 1 (fits well), 0.5 (marginal: tolerable only, or close to an edge), 0 (fails)."""

MARGIN = 0.10          # inside the optimum range but within 10% of its width from an edge counts as marginal (a design choice)
COLD_REASON = "no cold season for corm development"


def _range_test(test, value, rng):
    """Returns (score, entry or None). `rng` = {optimum:[lo,hi], tolerable:[lo,hi]} (tolerable optional)."""
    if value is None or not isinstance(rng, dict):
        return None, None
    opt = rng.get("optimum") or rng.get("tolerable")
    tol = rng.get("tolerable") or opt
    if tol[0] <= value <= tol[1]:
        if opt[0] <= value <= opt[1]:
            edge = (opt[1] - opt[0]) * MARGIN
            if value - opt[0] < edge or opt[1] - value < edge:
                return 0.5, {"test": test, "value": value, "range": opt, "status": "marginal"}
            return 1, None
        return 0.5, {"test": test, "value": value, "range": opt, "status": "marginal"}
    return 0, {"test": test, "value": value, "range": tol, "status": "fail"}


def crop_fits(crop, ctx):
    """-> {score, failed:[{test,value,range,status,reason?}], unknown:[tests that could not be checked]}.
    `failed` lists failures and marginal results (see `status`). The score is the worst single test.
    A test whose input is missing goes to `unknown` (never guessed)."""
    s = crop.get("suitability", {}) or {}
    scores, failed, unknown = [], [], []

    def add(result, test):
        sc, entry = result
        if sc is None:
            unknown.append(test)
            return
        scores.append(sc)
        if entry:
            failed.append(entry)

    for test, key, ctxkey in (("rain", "rain_mm", "rain_mm_season"), ("temperature", "tmean_c", "tmean_c"), ("ph", "ph", "ph")):
        if key in s:
            add(_range_test(test, ctx.get(ctxkey), s[key]), test)
    if s.get("slope_pct_max") is not None:
        v = ctx.get("slope_pct")
        if v is None:
            unknown.append("slope")
        elif v > s["slope_pct_max"]:
            scores.append(0)
            failed.append({"test": "slope", "value": v, "range": [0, s["slope_pct_max"]], "status": "fail"})
        else:
            scores.append(1)
    for test in ("drainage", "texture"):
        allowed, v = s.get(test), ctx.get(test)
        if allowed:
            if v is None:
                unknown.append(test)
            elif v not in allowed:
                scores.append(0)
                failed.append({"test": test, "value": v, "range": allowed, "status": "fail"})
            else:
                scores.append(1)
    if crop.get("needs_cold_season") or s.get("needs_cold_season"):
        if ctx.get("cold_season", False):
            scores.append(1)
        else:
            scores.append(0)
            failed.append({"test": "cold_season", "value": False, "range": True, "status": "fail",
                           "reason": COLD_REASON, "reason_key": "reason.no_cold_season"})
    return {"score": min(scores) if scores else 1, "failed": failed, "unknown": unknown}
