"""The farm planner's rule engine: pure functions, no database. See docs/farm-spec.md section 5.1."""
import copy

from .confidence import confidence, evidence_value
from .explain import explain
from .fit import crop_fits
from .knowledge import Knowledge, load_knowledge
from .rotation import build_options, excluded_crops
from .scenario import apply_scenario
from .scoring import blend, family_penalty, pair_flags, score_crop


def plan_cards(farm_ctx, knowledge, rain_factor=1.0, onset_delay_days=0):
    """Run the whole engine -> {options: [3 cards], excluded, scenario, missing_knowledge}."""
    ctx = apply_scenario(farm_ctx, rain_factor, onset_delay_days) if (rain_factor != 1.0 or onset_delay_days) else copy.deepcopy(farm_ctx)
    cards = build_options(ctx, knowledge)
    for card in cards:
        ex = explain(card["trace"])
        card.update({"why": ex["why"], "evidence": ex["evidence"], "gaps": ex["gaps"], "risks_for_review": ex["risks"],
                     "explanation": ex})
        card["needs_officer"] = card["needs_officer"] or ex["check_with_officer"]
    return {"options": cards, "excluded": excluded_crops(ctx, knowledge), "scenario": ctx.get("scenario"),
            "missing_knowledge": knowledge.missing}


__all__ = ["Knowledge", "load_knowledge", "crop_fits", "score_crop", "blend", "pair_flags", "family_penalty", "build_options",
           "apply_scenario", "confidence", "evidence_value", "explain", "plan_cards", "excluded_crops"]
