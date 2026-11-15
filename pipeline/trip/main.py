"""
Trip planner data pipeline: builds every file in data/trip/.

    .venv\\Scripts\\python -m pipeline.trip.main                      (all steps; slow the first time)
    .venv\\Scripts\\python -m pipeline.trip.main --only power         (just the NASA POWER download, resumable)
    .venv\\Scripts\\python -m pipeline.trip.main --only history,ml    (steps from files already downloaded)
    .venv\\Scripts\\python -m pipeline.trip.main --skip-download      (no internet: use caches and existing files only)

Steps, in order (names for --only, comma separated):
  config        data/trip/trip_config.json          from [trip] in pipeline/config.toml
  destinations  data/trip/destinations.json         data/places.json + OpenStreetMap (Overpass), elevation from AWS terrain tiles
  power         (cache only)                        NASA POWER daily rain/T2M_MAX for each square that covers a destination
  history       data/trip/rainfall_history.json     366-day chance of rain and amounts per square, from the POWER daily record
  forecast      data/trip/forecast_snapshot.json    Open-Meteo 16-day forecast for every destination (NOT NASA)
  env           data/trip/environmental_data.json   elevation, slope, NASA MODIS NDVI where it exists
  ml            data/trip/model_metadata.json (+ ml_estimates.json only if a model beats the baseline)
  validate      checks all files against docs/trip-spec.md

If something cannot be downloaded the step says so and the pipeline carries on with the other steps; nothing is invented.
Re-run `--only power` (and then `history,ml`) to fill in squares that did not answer.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pipeline.trip import common  # noqa: E402

STEPS = ["config", "destinations", "power", "history", "forecast", "env", "ml", "validate"]
LIMITS = [
    "Rain history is NASA POWER (MERRA-2 based, 0.5 x 0.625 degree squares of about 50 km): places in one square share the same history.",
    "POWER rain before about 1997 looks too low at some places and the near-real-time days after 30 Sep 2026 are skipped; trends are not computed.",
    "Models only see daily rain, season and position; they have no weather-model input, so for tomorrow the Open-Meteo forecast is expected to be better.",
    "GPM IMERG is not used (no Earthdata token).",
    "Hourly rain is never produced by these models: it comes only from the Open-Meteo hourly forecast (16 days).",
]


# ---------------------------------------------------------------------------
def step_config(cfg, args):
    t = cfg["trip"]
    doc = common.header("config", "pipeline/config.toml [trip] (draft thresholds of the team, not reviewed by a meteorologist)")
    doc.update({
        "intensity": dict(t["intensity"]), "no_rain_day_mm": t["no_rain_day_mm"], "wet_day_mm": t["wet_day_mm"],
        "forecast_horizon_days": t["forecast_horizon_days"], "cache_minutes": t["cache_minutes"],
        "verdict": dict(t["verdict"]), "comfort": dict(t["comfort"]), "weights": dict(t["weights"]),
        "day_periods": {k: list(v) for k, v in t["day_periods"].items()},
    })
    from pipeline.trip.validation import validate_data
    problems = validate_data.validate_config(doc)
    if problems:
        common.stop("; ".join(problems))
    print("  wrote", common.write_json("trip_config.json", doc, indent=1).name)


def read_destinations():
    doc = common.read_json("destinations.json")
    if not doc:
        common.stop("data/trip/destinations.json does not exist yet: run the 'destinations' step first")
    return doc["destinations"]


def step_destinations(cfg, args):
    from pipeline.trip.download import osm
    from pipeline.trip.processing import spatial_processing as sp
    import json
    t = cfg["trip"]
    places = json.loads((common.REPO / "data" / "places.json").read_text(encoding="utf-8"))["places"]
    try:
        elements = osm.fetch_all(t, offline=args.skip_download)
    except (osm.OsmError, FileNotFoundError) as err:
        common.stop(f"OpenStreetMap places are not available ({err}). The 30 places of data/places.json alone are fewer than the 40 required")
    provinces = sp.province_polygons_merged(elements.pop("provinces"))
    print(f"  {len(provinces)} province outlines")
    dests = sp.build_destinations(places, elements, provinces, cfg)
    import requests
    session = requests.Session()
    missing_elev = 0
    for d in dests:
        elev, _ = sp.elevation_and_slope(d["lat"], d["lon"], cfg, session)
        d["elevation_m"] = elev
        missing_elev += elev is None
    doc = common.header(
        "destinations",
        "data/places.json (team's list of well-known places) + OpenStreetMap (c) OpenStreetMap contributors, ODbL; "
        "elevation: AWS terrain tiles (terrarium). kinds, activities and cost_level are DRAFT assumptions (config.toml).")
    doc.update({"country": "LK", "osm_credit": "(c) OpenStreetMap contributors, ODbL", "destinations": dests})
    path = common.write_json("destinations.json", doc, indent=1)
    from collections import Counter
    print(f"  wrote {path.name}: {len(dests)} destinations ({len(places)} from places.json, {len(dests) - len(places)} from OSM), "
          f"{len({d['cell'] for d in dests})} NASA POWER squares, {missing_elev} without elevation")
    print("  kinds:", dict(Counter(k for d in dests for k in d["kinds"])))


def step_power(cfg, args):
    from pipeline.trip.download import nasa_power
    dests = read_destinations()
    keys = sorted({d["cell"] for d in dests})
    print(f"  {len(keys)} NASA POWER squares cover the destinations")
    have, missing = nasa_power.ensure_cells(keys, cfg, allow_download=not args.skip_download)
    print(f"  squares available: {len(have)}; missing: {len(missing)} {missing}")
    if missing:
        print("  Run '--only power' again later to fill the missing squares, then '--only history,ml'.")


def load_squares(cfg, keys):
    """Daily data of every square we already have (cache or data/cells); never downloads."""
    from pipeline.trip.download import nasa_power
    return nasa_power.ensure_cells(keys, cfg, allow_download=False, log=lambda *_: None)


def step_history(cfg, args):
    from pipeline.trip.processing import cleaning
    t = cfg["trip"]
    dests = read_destinations()
    keys = sorted({d["cell"] for d in dests})
    have, missing = load_squares(cfg, keys)
    if not have:
        common.stop("no NASA POWER square is available yet: run the 'power' step first")
    cells = {key: cleaning.history_for_cell(df, t) for key, df in have.items()}
    doc = common.header("history", f"NASA POWER daily PRECTOTCORR / T2M_MAX {t['first_year']}-{t['last_year']} (MERRA-2 based squares)")
    doc.update({"period": f"{t['first_year']}-{t['last_year']}", "wet_day_mm": t["wet_day_mm"], "window_days": t["window_days"],
                "years": t["last_year"] - t["first_year"] + 1,
                "index_note": "index = day of year in a non-leap year minus 1 (Feb 29 -> 59); index 365 is unused (null); "
                              "p90_mm = 90th percentile of all days (dry days included) in the window",
                "missing_cells": missing, "cells": cells})
    common.write_json("rainfall_history.json", doc)
    print(f"  wrote rainfall_history.json: {len(cells)} squares; missing (not downloaded yet): {missing or 'none'}")


def step_forecast(cfg, args):
    from pipeline.trip.download import open_meteo
    if args.skip_download:
        print("  skipped (--skip-download): data/trip/forecast_snapshot.json is left as it is")
        return
    t = cfg["trip"]
    dests = read_destinations()
    data, failed = open_meteo.fetch_snapshot(dests, cfg)
    if not data:
        common.stop("Open-Meteo did not answer for any destination")
    doc = common.header("forecast", t["forecast"]["source"])
    doc.update({"fetched_at": common.now_iso(), "timezone": t["forecast"]["timezone"], "forecast_days": t["forecast_horizon_days"],
                "not_nasa": True, "credit": t["forecast"]["credit"], "failed": failed, "destinations": data})
    common.write_json("forecast_snapshot.json", doc)
    print(f"  wrote forecast_snapshot.json: {len(data)} destinations; failed: {failed or 'none'}")


def step_env(cfg, args):
    from pipeline.trip.download import modis
    from pipeline.trip.processing import spatial_processing as sp
    import requests
    dests = read_destinations()
    session = requests.Session()
    previous = (common.read_json("environmental_data.json") or {}).get("destinations", {})
    if args.skip_download:
        ndvi = {d["id"]: (previous.get(d["id"], {}).get("ndvi"), previous.get(d["id"], {}).get("ndvi_date")) for d in dests}
        failed = []
    else:
        ndvi, failed = modis.fetch_ndvi(dests, cfg)
    out = {}
    for d in dests:
        elev, slope = sp.elevation_and_slope(d["lat"], d["lon"], cfg, session)
        value, when = ndvi.get(d["id"], (None, None))
        out[d["id"]] = {"elevation_m": d["elevation_m"] if d["elevation_m"] is not None else elev, "slope_pct": slope,
                        "ndvi": value, "ndvi_date": when if value is not None else None,
                        "ndvi_source": "NASA MODIS Terra MOD13Q1 (250 m, 16-day), via ORNL DAAC" if value is not None else None}
    doc = common.header("env", "AWS terrain tiles (terrarium DEM; slope over about 150 m) and NASA MODIS Terra NDVI (null where no real value)")
    doc.update({"ndvi_failed": failed, "destinations": out})
    common.write_json("environmental_data.json", doc)
    n = sum(1 for e in out.values() if e["ndvi"] is not None)
    print(f"  wrote environmental_data.json: {len(out)} destinations, NDVI for {n}, no NDVI answer for {len(failed)}")


def step_ml(cfg, args):
    from pipeline.trip.download import gpm_imerg, nasa_power
    from pipeline.trip.models import predict, train
    from pipeline.trip.processing import spatial_processing as sp
    import requests
    ml = cfg["trip"]["ml"]
    dests = read_destinations()
    keys = sorted({d["cell"] for d in dests})
    have, missing = load_squares(cfg, keys)
    have = {k: df for k, df in have.items() if df["PRECTOTCORR"].notna().mean() >= 0.9}        # drop squares with too many gaps
    session = requests.Session()
    centres = {k: nasa_power.split_key(k) for k in have}
    elevations = {k: sp.elevation_and_slope(centres[k][0], centres[k][1], cfg, session)[0] for k in have}
    result, trained = train.run(have, centres, elevations, cfg)
    doc = common.header("models", "XGBoost and scikit-learn Random Forest trained on NASA POWER daily rain; climatology baseline")
    if result is None:
        doc.update({"ml_available": False, "imerg": gpm_imerg.status(), "models": [], "limits": LIMITS,
                    "ml_estimates": {"written": False, "reason": f"fewer than {ml['min_cells']} squares with data: no model trained"},
                    "squares_used": sorted(have), "squares_missing": missing})
        common.write_json("model_metadata.json", doc, indent=1)
        print("  no model trained (too few squares)")
        return
    # newest data for the prediction: squares from pipeline/rain.py go up to 30 Sep 2026, downloaded ones to 2025-12-31
    latest = {}
    for k in have:
        df = nasa_power.load_from_rain_pipeline(k, cfg) if nasa_power.reuse_file(k, cfg).exists() else nasa_power.load_own_cache(k)
        if df is not None:
            latest[k] = df
    estimates, reason = predict.build_estimates(trained, result, latest, centres, elevations, dests, cfg)
    est_path = common.DATA_TRIP / "ml_estimates.json"
    if estimates:
        body = common.header("models", "ML estimate (XGBoost / Random Forest) - beats the climatology baseline on held-out years")
        body.update(estimates)
        common.write_json("ml_estimates.json", body)
    elif est_path.exists():
        est_path.unlink()                                   # a stale estimate file must not outlive its justification
    doc.update({"ml_available": estimates is not None, "imerg": gpm_imerg.status(), "models": result["models"], "limits": LIMITS,
                "ml_estimates": {"written": estimates is not None, "reason": reason},
                "squares_used": result["squares"], "squares_missing": missing, "rows": result["rows"],
                "data_period": f"{cfg['trip']['first_year']}-{cfg['trip']['last_year']}",
                "any_model_beats_baseline": any(m["beats_baseline"] for m in result["models"])})
    common.write_json("model_metadata.json", doc, indent=1)
    print(f"  wrote model_metadata.json; ml_estimates.json written: {estimates is not None} ({reason})")


def step_validate(cfg, args):
    from pipeline.trip.validation import validate_data
    problems = validate_data.validate_all()
    if problems:
        print(f"  {len(problems)} problem(s) found")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Monsoon Compass trip planner data pipeline.")
    parser.add_argument("--only", help="comma-separated steps: " + ", ".join(STEPS))
    parser.add_argument("--skip-download", action="store_true", help="use caches and existing files only; no internet")
    args = parser.parse_args(argv)
    common.console_utf8()
    wanted = STEPS if not args.only else [s.strip() for s in args.only.split(",")]
    bad = [s for s in wanted if s not in STEPS]
    if bad:
        parser.error(f"unknown step(s) {bad}; choose from {STEPS}")
    cfg = common.load_config()
    for step in STEPS:                                      # always in pipeline order
        if step in wanted:
            print(f"== {step}", flush=True)
            globals()[f"step_{step}"](cfg, args)


if __name__ == "__main__":
    main()
