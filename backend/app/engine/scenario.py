"""Scenario slider: a stress test from historical variability, NOT a forecast."""
import copy


def apply_scenario(farm_ctx, rain_factor=1.0, onset_delay_days=0):
    """Returns a copy of farm_ctx with every zone's seasonal rain multiplied (650 mm x 0.8 = 520 mm) and the onset delay recorded."""
    ctx = copy.deepcopy(farm_ctx)
    for z in ctx.get("zones", []):
        if z.get("rain_mm_season") is not None:
            z["rain_mm_season"] = round(z["rain_mm_season"] * rain_factor, 1)
    if ctx.get("rain_by_season"):
        ctx["rain_by_season"] = {k: round(v * rain_factor, 1) for k, v in ctx["rain_by_season"].items()}
    ctx["scenario"] = {"rain_factor": rain_factor, "onset_delay_days": onset_delay_days, "is_forecast": False,
                       "note_key": "scenario.stress_test_not_forecast"}
    return ctx
