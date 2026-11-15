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
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pipeline.trip import common  # noqa: E402

STEPS = ["config", "destinations", "power", "history", "forecast", "env", "ml", "imerg", "validate"]
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


def step_imerg(cfg, args):
    """GPM IMERG: compare with NASA POWER, then (only with the days already downloaded by
    `python -m pipeline.trip.download.gpm_imerg`) train IMERG-based models and write the honest result into model_metadata.json."""
    from pipeline.trip.download import gpm_imerg, nasa_power
    from pipeline.trip.models import predict, train
    from pipeline.trip.processing import spatial_processing as sp
    from pipeline.trip.validation import imerg_compare as ic
    import requests
    import pandas as pd
    meta_path = common.DATA_TRIP / "model_metadata.json"
    if not meta_path.exists():
        print("  model_metadata.json is missing: run the 'ml' step first")
        return
    doc = json.loads(meta_path.read_text(encoding="utf-8"))
    days = len(list(gpm_imerg.CACHE.glob("2*.npy"))) if gpm_imerg.CACHE.exists() else 0
    if days < ic.MIN_DAYS:
        doc["imerg"] = gpm_imerg.status()
        common.write_json("model_metadata.json", doc, indent=1)
        print(f"  only {days} IMERG days cached: nothing to compare (download with: python -m pipeline.trip.download.gpm_imerg)")
        return
    ml = cfg["trip"]["ml"]
    dests = read_destinations()
    keys = sorted({d["cell"] for d in dests})
    have, _missing = load_squares(cfg, keys)
    have = {k: df for k, df in have.items() if df["PRECTOTCORR"].notna().mean() >= 0.9}
    centres = {k: nasa_power.split_key(k) for k in have}
    frames, per_square = {}, {}
    for k in sorted(have):
        ser = ic.square_series(*centres[k])
        if len(ser) < ic.MIN_DAYS:
            continue
        frames[k] = pd.DataFrame({"PRECTOTCORR": ser.asfreq("D")})            # a missing day stays missing (NaN), never filled
        per_square[k] = ic.compare(have[k]["PRECTOTCORR"], ser, cfg["trip"]["wet_day_mm"])
    text, usable = ic.verdict(per_square)
    print("  " + text)
    comparison = {"per_square": per_square, "verdict": text, "usable_as_independent_rain_source": usable,
                  "thresholds_are_drafts": True, "days_cached": days, "squares": sorted(per_square)}
    doc_cmp = common.header("imerg", "NASA GPM IMERG V07 daily (Late run) versus NASA POWER daily rain, averaged over each POWER square")
    doc_cmp.update(comparison)
    common.write_json("imerg_comparison.json", doc_cmp, indent=1)
    imerg_block = {"used": False, "days_cached": days, "role": None, "comparison_file": "imerg_comparison.json", "verdict": text}
    if not usable or len(frames) < ml["min_cells"]:
        imerg_block["reason"] = "IMERG does not agree well enough with NASA POWER (or too few squares), so it is not used"
        doc["imerg"] = imerg_block
        common.write_json("model_metadata.json", doc, indent=1)
        return
    session = requests.Session()
    elevations = {k: sp.elevation_and_slope(centres[k][0], centres[k][1], cfg, session)[0] for k in frames}
    result, trained = train.run(frames, {k: centres[k] for k in frames}, elevations, cfg)
    if result is None:
        imerg_block["reason"] = "too few squares to train"
        doc["imerg"] = imerg_block
        common.write_json("model_metadata.json", doc, indent=1)
        return
    estimates, reason = predict.build_estimates(trained, result, frames, {k: centres[k] for k in frames}, elevations, dests, cfg)
    est_path = common.DATA_TRIP / "ml_estimates.json"
    if estimates:
        body = common.header("models", "ML estimate trained and fed with NASA GPM IMERG rain; beats BOTH the climatology and the persistence baselines on held-out years")
        body.update(estimates)
        body["input_source"] = "NASA GPM IMERG V07 (daily, Late run)"
        common.write_json("ml_estimates.json", body)
    elif est_path.exists():
        est_path.unlink()
    imerg_block.update({"used": True, "role": "an independent rain record used to train and test a second set of models (data_pipeline, not shown as a forecast)",
                        "models": result["models"], "rows": result["rows"], "squares_used": result["squares"],
                        "ml_estimates": {"written": estimates is not None, "reason": reason},
                        "any_model_beats_both_baselines": any(m["beats_baseline"] for m in result["models"]),
                        "period": f"{min(f.index.min() for f in frames.values()).date()} to {max(f.index.max() for f in frames.values()).date()}"})
    doc["imerg"] = imerg_block
    doc["ml_available"] = estimates is not None                   # true only while a current estimate exists
    doc["models_beat_baselines"] = imerg_block["any_model_beats_both_baselines"]
    doc["ml_estimates"] = imerg_block["ml_estimates"]                        # the latest reason (written or not) is what the web app shows
    common.write_json("model_metadata.json", doc, indent=1)
    print(f"  IMERG models: beat both baselines: {imerg_block['any_model_beats_both_baselines']}; ml_estimates.json written: {estimates is not None} ({reason})")


def step_validate(cfg, args):
    from pipeline.trip.validation import validate_data
    problems = validate_data.validate_all()
    if problems:
        print(f"  {len(problems)} problem(s) found")


def main(argv=None):
    parser = argparse.ArgumentParser(description="TerraOrb trip planner data pipeline.")
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
