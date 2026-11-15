# pipeline/ — data pipeline and rule engine (Python 3)

Everything here runs **before** the website is used, then writes JSON into `../data/`.
Nothing in `web/` ever runs Python.

## Setup and running (from the repo root)

```
python -m venv .venv
.venv\Scripts\python -m pip install -r pipeline\requirements.txt

.venv\Scripts\python pipeline\rain.py            # rain + elnino sections for every tank

# Water needs a free Earthdata login (https://urs.earthdata.nasa.gov), in environment variables only:
set EARTHDATA_TOKEN=<token from your Earthdata profile>
.venv\Scripts\python pipeline\water.py --search-only   # count scenes, no login needed
.venv\Scripts\python pipeline\water.py                 # water section + charts in pipeline\output\
.venv\Scripts\python pipeline\water.py --only osm-way-30378745   # just one tank (ids in data\tanks.json)

.venv\Scripts\python pipeline\forecast.py              # 16-day rain forecast (daily)
.venv\Scripts\python pipeline\rules.py                 # result section
.venv\Scripts\python pipeline\crops.py                 # crops section: what to sow now (run after rules.py)
.venv\Scripts\python pipeline\seasonal.py              # rain outlook for the coming months (Open-Meteo, not NASA)
.venv\Scripts\python pipeline
dvi.py                  # greenness from NASA MODIS (slow the first time: hours; then only new dates)
.venv\Scripts\python pipelinedvisory.py              # weekly advice (run last: it reads forecast, result, crops and ndvi)
.venv\Scripts\python pipeline\validate.py              # backtests → data\validation.json, docs\validation.md
.venv\Scripts\python -m pytest pipeline\tests    # tests with hand-made rainfall
```

| File | What it does |
|---|---|
| `config.toml` | Every tunable number: onset thresholds, season dates, normal period, El Niño seasons, skipped POWER sources |
| `rain.py` | NASA POWER daily rain → `rain` and `elnino` in `data/tank/<id>.json`, plus a summary table |
| `water.py` | Tank water area from OPERA DSWx-HLS (or HLS NDWI) → `water` in `data/tank/<id>.json`, plus a PNG chart per tank in `output/`. Needs Earthdata login in environment variables. `--search-only` counts scenes without login |
| `rules.py` | Rule engine: reads each tank file, writes only `result` (signal, 3 scenarios with the recommended one marked, reasons, El Niño line) and `learn` (past seasons replayed with the same rules, for Learn Mode). Run it after rain.py / water.py |
| `rules_config.json` | Every rule threshold and the scenario list; bump `version` when you change one |
| `validate.py` | Backtests: El Niño outlook leave-one-out (hits of calls) and the tank level model (fit 2017–2022, test 2023–2025) vs climatology. Writes `data/validation.json` and `docs/validation.md` |
| `tanks_from_osm.py` | Builds `data/tanks.json` (100 real tanks in Anuradhapura District) and `data/polygons/` from OpenStreetMap (© OpenStreetMap contributors, ODbL). Settings: `[tanks]` in `config.toml`. Command areas and most Sinhala names are not in OSM, so they stay empty |
| `crops.py` | "What to sow now": for paddy, short-duration paddy, mung bean, cowpea and black gram it works out the water the crop needs (FAO-56 crop coefficients x evapotranspiration from NASA POWER temperatures; FAO effective-rain rule) and compares it with the rain expected (16-day forecast first, then the usual rain) and with how often the rain was enough in past years. Writes the `crops` section. Crop numbers live in `crops_data.json`, each with a source and a confidence; `validate.py` backtests it |
| `seasonal.py` | Rain outlook for the next whole months from the ECMWF long-range ensemble via Open-Meteo (not NASA data), as a range next to NASA POWER's usual rain. Writes the `seasonal` section. Seasonal forecasts have low skill: the app shows the spread and never says wetter or drier |
| `ndvi.py` | Greenness (NDVI) around every tank from NASA MODIS Terra MOD13Q1 (250 m, every 16 days) via the ORNL DAAC MODIS web service (no login). Median of the land pixels within 1 km. Downloads are kept in `data/ndvi_cache/`, so a re-run only fetches new dates. Writes the `ndvi` section |
| `advisory.py` | Weekly advice list for every tank, built only from sections already in the tank file (water colour, forecast, NDVI, crops). Writes the `advisory` section: text keys and numbers, no sentences |
| `forecast.py` | 16-day rain forecast for every tank from global weather models via Open-Meteo (no login; not NASA data, credited in the app). Writes the `forecast` section; the web app also fetches it live when online |
| `finish.py` | Last step of the daily refresh: checks every file in `data/` (valid JSON, no NaN, required sections) and stamps the date in `data/tanks.json`; stops without writing if anything is wrong |
| `output/` | Charts for checking by eye (not in git) |
| `cache/` | Raw downloads and per-scene water results (not in git). Complete years/months are never downloaded again; first run takes ~5 minutes for 3 tanks |
| `tests/test_rain.py` | Onset, totals, normals, current season and El Niño checked on small hand-made series |

## Layout

```
pipeline/
  fetch/      Data pipeline: NASA POWER, HLS / OPERA DSWx, SMAP → water, rain, soil, elnino sections
  rules/      Rule engine: reads a tank JSON, writes its "result" section
  demo/       make_demo_tanks.py — writes clearly marked DEMO tank files so the
              frontend can be built before real data exists (standard library only)
```

Regenerate the demo tank files (from the repo root):

```
python pipeline/demo/make_demo_tanks.py
```

It only touches tanks marked `"demo": true` in `data/tanks.json`. Its signal logic is a
stand-in for the frontend, **not** the real rule engine.

`fetch/` and `rules/` are separate modules on purpose:

- `fetch/` writes `water`, `rain`, `soil`, `elnino` into `data/tank/<id>.json`.
- `rules/` reads those sections **from the JSON file** and writes `result`.
- `rules/` must not import anything from `fetch/`, and vice versa.
  That way the logic lead can test rules on hand-made JSON while data work continues.

The file format both sides agree on is in [../docs/schema.md](../docs/schema.md).

Stack: pandas, requests, numpy, xarray, rasterio.

> Note: on the team laptop, Windows Smart App Control blocks pandas 3.x and rasterio
> 1.4.3 / 1.3.11, but pandas 2.2.3 and rasterio 1.5.2 load fine (checked 25 Oct 2026).
> That's why `requirements.txt` pins those versions.
