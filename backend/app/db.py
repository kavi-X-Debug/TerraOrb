"""
The farm planner's database: SQLite, plain `sqlite3` (no ORM, so a student team can read every query).

    MC_DB   path of the database file (default: backend/data/farm.db, created on first start; the folder is git-ignored)

`init_db()` creates every table if it is missing. Columns are explained in docs/farm-spec.md. Geometry is GeoJSON text (WGS84, [lon, lat]);
timestamps are ISO 8601 text in UTC. Rows are returned as dicts (`row_to_dict`). Use `get_db` as a FastAPI dependency.
"""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
DEFAULT_DB = BACKEND / "data" / "farm.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS farmer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  language TEXT NOT NULL DEFAULT 'si',
  role TEXT NOT NULL DEFAULT 'farmer',            -- farmer | officer | researcher | admin
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  token_hash TEXT PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES farmer(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  asked_at TEXT NOT NULL,                         -- for the "no more than 5 codes an hour" limit
  asked_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS farm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id INTEGER NOT NULL REFERENCES farmer(id) ON DELETE CASCADE,
  name TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  area_ha REAL NOT NULL,
  water_source TEXT,                              -- rain-fed | tank | well | canal
  yala_water TEXT,                                -- yes | limited | no (the farmer's own report)
  labour TEXT,                                    -- low | medium | high
  equipment TEXT,                                 -- low | medium | high
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plot_polygon (
  farm_id INTEGER PRIMARY KEY REFERENCES farm(id) ON DELETE CASCADE,
  geojson TEXT NOT NULL,
  source TEXT NOT NULL                            -- drawn | circle
);
CREATE TABLE IF NOT EXISTS farmer_priority (
  farm_id INTEGER PRIMARY KEY REFERENCES farm(id) ON DELETE CASCADE,
  save_water REAL NOT NULL, income REAL NOT NULL, soil REAL NOT NULL, low_work REAL NOT NULL, family_food REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS crop_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  season TEXT NOT NULL,                           -- "Maha 2025/26", "Yala 2025"
  crop_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                             -- flat | gentle | steep | very_steep | wet_low
  geojson TEXT NOT NULL,
  version TEXT NOT NULL,                          -- computed | edited
  area_ha REAL,
  mean_slope_pct REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS soil_layer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES zone(id) ON DELETE SET NULL,
  property TEXT NOT NULL,                         -- texture | ph | organic_carbon | drainage | colour
  value TEXT NOT NULL,
  source TEXT NOT NULL,                           -- modelled | measured_by_farmer
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES zone(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                             -- erosion | waterlogging | drought | heat | wild_animals | theft | pests | flooding_history
  level TEXT,                                     -- low | medium | high (null for farmer-listed items)
  source TEXT NOT NULL,                           -- computed | farmer
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'            -- draft | flagged | reviewed
);
CREATE TABLE IF NOT EXISTS plan_option (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  option_no INTEGER NOT NULL,                     -- 1 baseline, 2 soil-building, 3 water-saving
  name TEXT NOT NULL,
  result_json TEXT NOT NULL,
  confidence REAL,
  confidence_class TEXT
);
CREATE TABLE IF NOT EXISTS plan_rule_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_option_id INTEGER NOT NULL REFERENCES plan_option(id) ON DELETE CASCADE,
  zone TEXT, season TEXT, crop_id TEXT,
  trace_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groundtruth_response (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  satellite_value TEXT,
  answer TEXT NOT NULL,                           -- yes | no
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitoring_point (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES zone(id) ON DELETE SET NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, label TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS soil_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id INTEGER NOT NULL REFERENCES monitoring_point(id) ON DELETE CASCADE,
  visited_on TEXT NOT NULL,
  earthworms INTEGER, infiltration_minutes REAL, colour_class INTEGER, crumb_class INTEGER, cover_percent REAL, ph REAL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS season_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  season TEXT, planted TEXT, yield_band TEXT, problems TEXT, plan_followed TEXT, would_change TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id INTEGER NOT NULL REFERENCES farm(id) ON DELETE CASCADE,
  kind TEXT, crop_id TEXT, text TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id INTEGER NOT NULL REFERENCES farmer(id) ON DELETE CASCADE,
  name TEXT NOT NULL, plants TEXT, zone_or_soil TEXT, season TEXT, effect TEXT, holder TEXT, years_in_use INTEGER,
  visibility TEXT NOT NULL DEFAULT 'private',     -- private | village | public
  show_name INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'traditional only',-- traditional only | supported by platform data | supported by research
  created_at TEXT NOT NULL
);
"""


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def db_path():
    return Path(os.environ.get("MC_DB") or DEFAULT_DB)


def connect(path=None):
    path = Path(path) if path else db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")            # deleting a farm deletes everything that belongs to it
    return conn


def init_db(path=None):
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def get_db():
    """FastAPI dependency: one connection per request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def row_to_dict(row):
    return None if row is None else dict(row)
