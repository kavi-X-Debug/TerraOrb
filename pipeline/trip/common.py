"""
Shared helpers for the trip-planner pipeline (pipeline/trip/).

Nothing here talks to the internet. Every other module in pipeline/trip/ imports from here:
paths, the [trip] settings from pipeline/config.toml, the NASA POWER square rule, and the JSON header every
file in data/trip/ carries (schema, generated, source, demo).
"""

import json
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path

TRIP = Path(__file__).resolve().parent
PIPELINE = TRIP.parent
REPO = PIPELINE.parent
DATA_TRIP = REPO / "data" / "trip"
CACHE = PIPELINE / "cache" / "trip"
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
USER_AGENT = "MonsoonCompass/0.1 (NASA Space Apps student project; trip planner data pipeline)"

SCHEMAS = {
    "destinations": "trip-destinations-1",
    "history": "trip-history-1",
    "forecast": "trip-forecast-1",
    "config": "trip-config-1",
    "models": "trip-models-1",
    "env": "trip-env-1",
}


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def trip_cfg(cfg=None):
    return (cfg or load_config())["trip"]


def now_iso():
    """Current time in Sri Lanka as ISO 8601 with offset (the 'generated' field of every file)."""
    return datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()


def stop(message):
    sys.exit(f"STOPPED: {message}\nNothing was written.")


def power_cell(lat, lon, cfg=None):
    """Centre of the NASA POWER (MERRA-2) square containing a point: (lat, lon).

    Same rule as pipeline/rain.py `power_cell`: 0.5 deg tall x 0.625 deg wide squares.
    """
    power = (cfg or load_config())["power"]
    dlat, dlon = power["grid_lat_deg"], power["grid_lon_deg"]
    return round(round(lat / dlat) * dlat, 4), round(round(lon / dlon) * dlon, 4)


def cell_key(lat, lon, cfg=None):
    """String key of the square, e.g. '7.5_80.625' (Python float repr, like the file names in data/cells/)."""
    clat, clon = power_cell(lat, lon, cfg)
    return f"{clat}_{clon}"


def header(schema_key, source, demo=False, **extra):
    """The fields every file in data/trip/ starts with."""
    doc = {"schema": SCHEMAS[schema_key], "generated": now_iso(), "source": source, "demo": demo}
    doc.update(extra)
    return doc


def write_json(name, doc, indent=None):
    """Write data/trip/<name>. Compact by default (the files are read by browsers)."""
    DATA_TRIP.mkdir(parents=True, exist_ok=True)
    path = DATA_TRIP / name
    text = json.dumps(doc, ensure_ascii=False, indent=indent, separators=(",", ":") if indent is None else None)
    path.write_text(text + "\n", encoding="utf-8")
    return path


def read_json(name, default=None):
    path = DATA_TRIP / name
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def console_utf8():
    """Windows consoles default to an old code page; UTF-8 lets Sinhala print."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
