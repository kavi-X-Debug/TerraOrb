"""
Checks that every file in data/trip/ follows docs/trip-spec.md section 2. Pure functions return a list of problems
(empty list = fine); `validate_all()` reads the files and prints a report.

    .venv\\Scripts\\python -m pipeline.trip.validation.validate_data      (exit code 1 if there is a problem)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402

KINDS = {"beach", "hill", "waterfall", "wildlife", "culture", "city", "lake", "forest", "coast"}
ACTIVITIES = {"hiking", "camping", "beach", "waterfalls", "photography", "wildlife", "sightseeing", "cycling",
              "museums", "restaurants", "culture", "entertainment", "shopping", "workshops"}
BOX = (5.8, 9.95, 79.4, 82.0)


def check_header(doc, schema_key, name):
    problems = []
    for k in ("schema", "generated", "source", "demo"):
        if k not in doc:
            problems.append(f"{name}: missing field {k!r}")
    if doc.get("schema") != common.SCHEMAS[schema_key]:
        problems.append(f"{name}: schema is {doc.get('schema')!r}, expected {common.SCHEMAS[schema_key]!r}")
    return problems


def validate_destinations(doc, cfg=None, minimum=40):
    problems = check_header(doc, "destinations", "destinations.json")
    dests = doc.get("destinations", [])
    if len(dests) < minimum:
        problems.append(f"destinations.json: only {len(dests)} destinations (need {minimum})")
    ids = [d.get("id") for d in dests]
    if len(ids) != len(set(ids)):
        problems.append("destinations.json: duplicate ids")
    for d in dests:
        who = f"destinations.json[{d.get('id')}]"
        if not (BOX[0] <= (d.get("lat") or 0) <= BOX[1] and BOX[2] <= (d.get("lon") or 0) <= BOX[3]):
            problems.append(f"{who}: coordinates outside Sri Lanka")
        if not d.get("name_en"):
            problems.append(f"{who}: no name_en")
        if not d.get("kinds") or any(k not in KINDS for k in d["kinds"]):
            problems.append(f"{who}: bad kinds {d.get('kinds')}")
        if any(a not in ACTIVITIES for a in d.get("activities", [])):
            problems.append(f"{who}: unknown activity in {d.get('activities')}")
        if "lat" in d and "lon" in d and d.get("cell") != common.cell_key(d["lat"], d["lon"], cfg):
            problems.append(f"{who}: cell {d.get('cell')} does not match the NASA POWER square rule")
        if d.get("cost_level") is not None and (d["cost_level"] not in (1, 2, 3) or d.get("cost_level_evidence") != "assumption"):
            problems.append(f"{who}: cost_level must be 1..3 and flagged as an assumption")
        if d.get("elevation_m") is not None and not (-50 <= d["elevation_m"] <= 2700):
            problems.append(f"{who}: elevation {d['elevation_m']} m is implausible for Sri Lanka")
    return problems


def validate_history(doc, destinations=None):
    problems = check_header(doc, "history", "rainfall_history.json")
    if doc.get("window_days") != 7 or doc.get("wet_day_mm") is None:
        problems.append("rainfall_history.json: window_days must be 7 and wet_day_mm present")
    cells = doc.get("cells", {})
    if not cells:
        problems.append("rainfall_history.json: no squares")
    for key, c in cells.items():
        who = f"rainfall_history.json[{key}]"
        for k in ("p_wet", "mean_mm", "p90_mm"):
            arr = c.get(k)
            if not isinstance(arr, list) or len(arr) != 366:
                problems.append(f"{who}: {k} must have 366 values")
                continue
            body = [v for v in arr[:365]]
            if any(v is None for v in body):
                problems.append(f"{who}: {k} has missing days 0..364")
            elif k == "p_wet" and not all(0 <= v <= 1 for v in body):
                problems.append(f"{who}: p_wet outside 0..1")
            elif k != "p_wet" and not all(v >= 0 for v in body):
                problems.append(f"{who}: {k} negative")
        if c.get("monthly_mm") is not None and len(c["monthly_mm"]) != 12:
            problems.append(f"{who}: monthly_mm must have 12 values")
        if c.get("tmax_c_monthly") is not None and len(c["tmax_c_monthly"]) != 12:
            problems.append(f"{who}: tmax_c_monthly must have 12 values")
    if destinations is not None:
        have = set(cells)
        for d in destinations:
            if d["cell"] not in have and d["cell"] not in doc.get("missing_cells", []):
                problems.append(f"rainfall_history.json: square {d['cell']} of {d['id']} is neither present nor listed as missing")
    return problems


def validate_forecast(doc, days=16):
    problems = check_header(doc, "forecast", "forecast_snapshot.json")
    if doc.get("not_nasa") is not True:
        problems.append("forecast_snapshot.json: not_nasa must be true")
    if not doc.get("fetched_at"):
        problems.append("forecast_snapshot.json: fetched_at missing")
    for did, e in doc.get("destinations", {}).items():
        n_h, n_d = len(e["hourly"]["time"]), len(e["daily"]["time"])
        if n_h != days * 24 or n_d != days:
            problems.append(f"forecast_snapshot.json[{did}]: {n_h} hours / {n_d} days")
        for block in ("hourly", "daily"):
            for k, v in e[block].items():
                if v is None or len(v) != len(e[block]["time"]):
                    problems.append(f"forecast_snapshot.json[{did}]: {block}.{k} wrong length")
    return problems


def validate_config(doc):
    problems = check_header(doc, "config", "trip_config.json")
    w = doc.get("weights", {})
    if abs(sum(w.values()) - 1.0) > 1e-9:
        problems.append(f"trip_config.json: weights add up to {sum(w.values())}, not 1")
    i = doc.get("intensity", {})
    if not (0 < i.get("light_min", 0) < i.get("moderate_min", 0) < i.get("heavy_min", 0) < i.get("very_heavy_min", 0)):
        problems.append("trip_config.json: intensity thresholds must increase")
    return problems


def validate_models(doc, estimates_exist):
    problems = check_header(doc, "models", "model_metadata.json")
    if doc.get("imerg", {}).get("used") is not False:
        problems.append("model_metadata.json: imerg.used must be false while there is no IMERG data")
    any_winner = any(m.get("beats_baseline") for m in doc.get("models", []))
    if estimates_exist and not any_winner:
        problems.append("ml_estimates.json exists but no model beats the baseline")
    if doc.get("ml_available") and not estimates_exist:
        problems.append("model_metadata.json says ml_available but ml_estimates.json is missing")
    for m in doc.get("models", []):
        if "beats_baseline" not in m or "baseline" not in m:
            problems.append(f"model_metadata.json[{m.get('id')}]: missing beats_baseline or baseline")
    return problems


def validate_env(doc, destinations=None):
    problems = check_header(doc, "env", "environmental_data.json")
    envs = doc.get("destinations", {})
    for did, e in envs.items():
        if e.get("ndvi") is not None and not (-0.2 <= e["ndvi"] <= 1.0):
            problems.append(f"environmental_data.json[{did}]: ndvi {e['ndvi']} out of range")
        if e.get("ndvi") is not None and not e.get("ndvi_source"):
            problems.append(f"environmental_data.json[{did}]: ndvi without ndvi_source")
    if destinations is not None:
        missing = {d["id"] for d in destinations} - set(envs)
        if missing:
            problems.append(f"environmental_data.json: no entry for {sorted(missing)[:5]}")
    return problems


def validate_all(log=print):
    """Read every file in data/trip/ and check it. Returns the list of problems."""
    problems = []

    def load(name):
        try:
            return common.read_json(name)
        except json.JSONDecodeError as err:
            problems.append(f"{name}: not valid JSON ({err})")
            return None

    dest = load("destinations.json")
    dests = dest["destinations"] if dest else None
    checks = [("destinations.json", dest, lambda d: validate_destinations(d)),
              ("rainfall_history.json", load("rainfall_history.json"), lambda d: validate_history(d, dests)),
              ("forecast_snapshot.json", load("forecast_snapshot.json"), validate_forecast),
              ("trip_config.json", load("trip_config.json"), validate_config),
              ("model_metadata.json", load("model_metadata.json"), lambda d: validate_models(d, (common.DATA_TRIP / "ml_estimates.json").exists())),
              ("environmental_data.json", load("environmental_data.json"), lambda d: validate_env(d, dests))]
    for name, doc, fn in checks:
        if doc is None:
            problems.append(f"{name}: file missing")
            continue
        found = fn(doc)
        log(f"  {name}: {'ok' if not found else str(len(found)) + ' problem(s)'}")
        problems += found
    for p in problems:
        log(f"  PROBLEM: {p}")
    return problems


if __name__ == "__main__":
    common.console_utf8()
    sys.exit(1 if validate_all() else 0)
