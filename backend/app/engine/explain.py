"""explain(trace): turns a rule trace into text KEYS with parameters. The app translates them; there is no language model
and no free text, so nothing can be said that the rules did not decide."""

WHY = {"select_crop", "legume_bonus", "select_hedge"}
RISKS = {"fit_marginal", "family_penalty", "no_legume", "bare_season", "pair_conflict", "baseline_unfit"}
GAPS = {"missing_input", "template_fallback", "no_history"}


def _item(e):
    return {"text_key": e["text_key"], "params": e.get("params", {}), "evidence": e.get("evidence"),
            "zone": e.get("zone"), "season": e.get("season"), "crop_id": e.get("crop_id")}


def explain(trace):
    why = [_item(e) for e in trace if e["rule"] in WHY]
    risks = [_item(e) for e in trace if e["rule"] in RISKS]
    gaps = [_item(e) for e in trace if e["rule"] in GAPS]
    conf = next((e for e in trace if e["rule"] == "confidence"), None)
    levels = sorted({e["evidence"] for e in trace if e.get("evidence")})
    klass = (conf or {}).get("params", {}).get("class")
    check = bool(levels and set(levels) & {"V2", "V3", "assumption"}) or klass == "low"
    return {
        "why": why,
        "evidence": [{"text_key": "evidence.level_used", "params": {"level": l}} for l in levels],
        "benefits": [{"text_key": "benefit.see_card", "params": {}}],
        "gaps": gaps,
        "risks": risks,
        "confidence": {"text_key": "confidence.computed", "params": (conf or {}).get("params", {})},
        "check_with_officer": check,
    }
