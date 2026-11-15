# Trip planner data pipeline (`pipeline/trip/`)

Builds the static data of the trip planner (`#/plan/...`) in `data/trip/`. Contract: `docs/trip-spec.md` section 2.
Rules that apply to everything here: **never invent data** (missing = `null`), keep the sources labelled, no secrets in files.

## Run (from the repo root, Windows)

```powershell
.\.venv\Scripts\python.exe -m pipeline.trip.main                      # all steps (slow the first time: OSM + NASA POWER downloads)
.\.venv\Scripts\python.exe -m pipeline.trip.main --only power         # only the NASA POWER download (resumable, run it again to fill gaps)
.\.venv\Scripts\python.exe -m pipeline.trip.main --only history,ml    # rebuild from what is already downloaded
.\.venv\Scripts\python.exe -m pipeline.trip.main --only forecast      # refresh the 16-day forecast snapshot
.\.venv\Scripts\python.exe -m pipeline.trip.main --skip-download      # offline: caches and existing files only
.\.venv\Scripts\python.exe -m pytest pipeline\trip\tests -q           # tests (offline)
```

Steps (in order): `config`, `destinations`, `power`, `history`, `forecast`, `env`, `ml`, `validate`.

| File in `data/trip/` | Step | Source |
|---|---|---|
| `trip_config.json` | config | `[trip]` in `pipeline/config.toml` (draft thresholds) |
| `destinations.json` | destinations | `data/places.json` + OpenStreetMap (Overpass), elevation from AWS terrain tiles |
| `rainfall_history.json` | history | NASA POWER daily rain/T2M_MAX 1981-2025 per 0.5 x 0.625 degree square |
| `forecast_snapshot.json` | forecast | Open-Meteo 16 days hourly + daily (not NASA) |
| `environmental_data.json` | env | AWS terrain (elevation, slope); NASA MODIS NDVI only where a real value exists |
| `model_metadata.json` | ml | XGBoost / Random Forest vs climatology baseline, honest metrics |
| `ml_estimates.json` | ml | only if a model beats the baseline on the held-out years **and** the newest rain is at most 3 days old |

## Layout

```
download/    osm.py  nasa_power.py  open_meteo.py  modis.py  gpm_imerg.py (documented stub, refuses without EARTHDATA_TOKEN)
processing/  cleaning.py (POWER cleaning + 366-day history)  feature_engineering.py (ML features, no leakage)  spatial_processing.py (destinations, terrain)
models/      rainfall_classifier.py  rainfall_regressor.py  train.py  evaluate.py  predict.py
validation/  validate_data.py (checks every file against the spec)
tests/       pytest, offline, synthetic fixtures (clearly labelled)
common.py    paths, config, NASA POWER square rule, JSON header
main.py      orchestrator
```

## Data notes

* **Squares.** NASA POWER daily data come on 0.5 deg (lat) x 0.625 deg (lon) squares. The key (`"7.5_80.625"`) is the square centre with Python float
  repr, same rule as `pipeline/rain.py`. Destinations in one square share the same history.
* **Downloads.** One request per square for 1981-2025 (if that fails, one per year). POWER resets connections that come too fast: 12 s pause,
  3 retries with longer waits, everything cached in `pipeline/cache/trip/` (git-ignored). A square that does not answer is listed in
  `rainfall_history.json` -> `missing_cells`; run `--only power` again later, then `--only history,ml`. Squares already downloaded by
  `pipeline/rain.py` (`data/cells/`) are reused (rain) together with the cached yearly files (T2M_MAX).
* **GEOSIT.** Near-real-time POWER days from 1 Oct 2026 are about 24 times too large and are never used (see `[power] skip_sources`). Rain data end 30 Sep 2026,
  and the history only uses 1981-2025.
* **History index.** `p_wet[i]` etc. use the days within +/-3 days of calendar day `i` (day of year in a non-leap year minus 1; Feb 29 is folded into index 59).
  Index 365 exists only to make the arrays 366 long and is `null`. `p90_mm` is the 90th percentile of all days in the window (dry days included).
* **Destinations.** The 30 places of `data/places.json` plus the best-documented OpenStreetMap waterfalls, viewpoints, national parks, beaches, historic
  sites and temples (counts per category in `[trip.osm.categories]`). Coordinates only from those two sources. `kinds`, `activities` and `cost_level`
  follow the **draft** tables in `config.toml` (team assumptions; `cost_level_evidence` is `"assumption"`). `name_si` is `null` where OSM has no Sinhala name.
  `region` = province outline containing the point (from OSM).
* **ML honesty.** Chronological splits by target day: train 1981-2012, validation 2013-2018, test 2019-2025. Metrics on the test years only, compared with a
  climatology baseline from the training years. `beats_baseline` is true only if the model has a lower Brier score (A) or RMSE (B) overall and in more than
  half of the test years (and a higher ROC-AUC for A). The result is written either way. IMERG is not used (`imerg.used = false`).
* **Random Forest.** If scikit-learn's compiled files are blocked by Windows Application Control (they are on the development laptop), the Random Forest is
  XGBoost's random-forest mode (`XGBRF*`); `model_metadata.json` names the algorithm that was really used.

## Install

`pip install -r pipeline/requirements.txt` plus `xgboost scikit-learn pillow shapely` (all in `.venv`).
