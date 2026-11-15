# Farm planner: shared contract (read this before touching `backend/` or `web/js/farm/`)

This is the agreed design for the **farm-planning end** of Monsoon Compass, built from the product owner's two documents
("NASA functionalities", functions F1 to F30, and "Steps", phases 0 to 9). Every agent builds against this contract so the pieces fit.

## 0. Decisions already made

* **Backend: yes, for this end only.** Python 3 + FastAPI + SQLite (`backend/`). The rest of the website stays static (GitHub Pages).
  The farm screens call the API at a configurable address and say plainly when it cannot be reached.
* **Scope of this round = the owner's hackathon build order:**
  1. pre-computed data tables for ONE pilot district (Anuradhapura, bounding box lat 7.8 to 9.1, lon 79.9 to 81.1),
  2. farm registration and location card (F1 to F6a),
  3. terrain zones and threat map (F7 to F10),
  4. crop filter, scoring and three rotation cards with explanations (F11 to F14, F16),
  5. scenario slider and confidence (F15),
  6. soil monitoring and practice entry as **mock-ups** (store and show, no analysis beyond a simple trend),
  7. alerts, learning loop, officer review and village view are **roadmap only** (described in the app, not built).
* **Pre-compute, don't query live.** NASA and other data for the pilot area is processed ahead of time into static tables; the app reads tables.
* **Honesty rules still apply** (see AGENTS.md): never invent data; every value carries its source; modelled vs measured is labelled; area-level data says so;
  confidence on every output; "not enough data" when true; Sinhala text is a draft; the tool supports and never replaces local expertise.
* Languages this round: Sinhala and English (Tamil is a later addition; keep strings in files so it can be added).
* Phone-number login uses a one-time code. **No SMS provider yet**: in development mode (`MC_DEV=1`) the code is returned in the response; otherwise it is only stored.

## 1. Folders and who owns what

```
backend/
  app/
    main.py            app, CORS, router auto-loading                      (lead, done)
    db.py              SQLite connection and the full schema                (lead, done)
    auth.py            one-time code login, sessions, roles                 (lead, done)
    routes_auth.py     /api/auth/*, /api/me                                 (lead, done)
    routes_farms.py    farms, plots, priorities, history, export, delete    (agent "api")
    routes_extra.py    mock-up stores: monitoring, soil visits, practices,
                       season review, issues, ground-truth answers          (agent "api")
    routes_profile.py  /api/farms/{id}/location and /profile                (agent "profile")
    routes_terrain.py  zones, soil layers, threats                          (agent "terrain")
    routes_plan.py     /api/farms/{id}/plan, knowledge endpoints            (agent "engine")
    terrain.py         DEM tiles, slope, flow accumulation, zones, erosion  (agent "terrain")
    engine/            filter, scoring, compatibility, rotations, scenario,
                       confidence, explanation                              (agent "engine")
  knowledge/           crops.json, zone_weights.json, rotation_templates.json,
                       claims.json, glossary.json                           (agent "knowledge")
  tests/               one test file per area (pytest)
  requirements.txt  README.md  run.ps1
pipeline/farm_profile.py   pre-computed climate / onset / dry-spell / NDVI tables   (agent "profile")
data/farm/                 the pre-computed tables (static JSON)                     (agent "profile")
web/js/farm/               the screens (see section 7)                               (agents "app1", "app2")
web/css/farm.css, farm-plan.css
web/strings/farm.{en,si}.json (app1)   web/strings/farm-plan.{en,si}.json (app2)
```

`main.py` loads every `backend/app/routes_*.py` that defines a FastAPI `router`, so nobody edits `main.py`.
**Touch only the files you own.** If you need something from another owner, read their file and call it; do not edit it.
Run tests with `.venv\Scripts\python.exe -m pytest backend\tests -q` from the repo root.

## 2. Database (schema is in `backend/app/db.py`)

`farmer`, `session`, `otp`, `farm`, `plot_polygon`, `farmer_priority`, `crop_history`, `zone`, `soil_layer`, `threat`, `plan`, `plan_option`,
`plan_rule_trace`, `groundtruth_response`, `monitoring_point`, `soil_observation`, `season_review`, `issue_ticket`, `practice_entry`.
Read `db.py` for columns. All timestamps are ISO 8601 text in UTC. Geometry is GeoJSON text (WGS84, `[lon, lat]`).
Privacy: a farmer sees only their own farms (officers: assigned farms later). Exact coordinates are never returned to other users.
Every farm can be exported (`GET /api/farms/{id}/export`) and deleted (`DELETE /api/farms/{id}`, removes all rows of that farm).

## 3. API (JSON, all under `/api`; `Authorization: Bearer <token>` except where marked public)

| Method and path | Purpose | Owner |
|---|---|---|
| `GET /health` (public) | `{ "ok": true, "dev": bool }` | lead |
| `POST /auth/request` `{phone}` (public) | creates a code; returns `{ok, dev_code?}` | lead |
| `POST /auth/verify` `{phone, code, language?}` (public) | returns `{token, farmer}` | lead |
| `GET /me` | the farmer | lead |
| `POST /farms` | create farm (body in 3.1) | api |
| `GET /farms`, `GET /farms/{id}`, `PATCH /farms/{id}`, `DELETE /farms/{id}` | read, update, delete | api |
| `GET /farms/{id}/export` | everything stored for the farm as JSON | api |
| `GET /farms/{id}/location` | zone, elevation, seasons (F4) | profile |
| `GET /farms/{id}/profile` | climate, onset, dry spells, NDVI strip, SMAP if any (F5, F6) | profile |
| `POST /farms/{id}/groundtruth` `{question_key, satellite_value, answer}` | ground-truth answers (F6a) | api |
| `POST /farms/{id}/zones/compute` | build zones from the DEM, store as `computed` | terrain |
| `GET /farms/{id}/zones`, `PUT /farms/{id}/zones` | zones (computed and edited versions) (F7) | terrain |
| `GET /farms/{id}/soil`, `PUT /farms/{id}/soil` | soil layers, modelled vs farmer-measured (F8) | terrain |
| `GET /farms/{id}/threats`, `POST /farms/{id}/threats` | computed threats plus farmer additions (F9) | terrain |
| `POST /farms/{id}/plan` `{scenario?}` | run the engine, store, return the three option cards | engine |
| `GET /farms/{id}/plan/latest` | the last stored plan | engine |
| `GET /knowledge/crops`, `GET /knowledge/glossary` (public) | crop table with evidence levels; glossary (F10) | engine |
| `POST /farms/{id}/monitoring-points`, `GET ...`; `POST /farms/{id}/soil-observations`, `GET ...`; `GET /farms/{id}/soil-trend` | mock-up soil monitoring (F20 to F22) | api |
| `POST /farms/{id}/season-review`, `POST /farms/{id}/issues`, `POST /practices`, `GET /practices` | feedback, issue button, traditional knowledge (F23, F24, F26, F27) | api |

Errors use FastAPI's `{"detail": "..."}` with the proper status (400, 401, 403, 404, 422).

### 3.1 Create a farm (`POST /farms`)

```json
{ "name": "Kamal's field", "lat": 8.31, "lon": 80.40, "area_ha": 1.2,
  "polygon": { "type": "Polygon", "coordinates": [[[80.40, 8.31], ...]] },        // optional; if missing the server makes a circle from area_ha
  "water_source": "rain-fed|tank|well|canal", "yala_water": "yes|limited|no", "labour": "low|medium|high", "equipment": "low|medium|high",
  "priorities": { "save_water": 0.3, "income": 0.3, "soil": 0.2, "low_work": 0.1, "family_food": 0.1 },   // 0 to 1, must sum to 1 (server normalises and tells)
  "crop_history": [ { "season": "Maha 2025/26", "crop_id": "paddy" }, { "season": "Yala 2025", "crop_id": "mung_bean" } ] }
```
The reply is the stored farm with `id`, `plot_source` (`"drawn"` or `"circle"`), and `priorities` as saved.

## 4. Pre-computed tables (agent "profile") in `data/farm/`

Static JSON, keyed by NASA POWER grid cell (same cells as `pipeline/rain.py`: 0.5 deg tall, 0.625 deg wide, key `"<lat>_<lon>"` of the cell centre):
`climate_monthly` (rain, ET0 by FAO-56 Penman-Monteith from POWER variables with Hargreaves as fallback, water balance = rain minus ET0: mean and standard deviation over 10 or more years),
`onset_by_year` (rain onset day per year, plus earliest / median / latest), `dry_spell_by_year` (longest run of days under 1 mm per season),
`ndvi_series` and `bare_calendar` (share of years each month stayed under the bare threshold), `sm_anomaly` only if SMAP data can be fetched (otherwise the file says `"available": false` with the reason).
Every table has `source`, `period`, `resolution` (`"area-level, about 50 km"` and so on) and `demo` (false when real). The pipeline never invents values.
The onset rule and thresholds in "Steps" (40 mm in a trailing 7 days, bare NDVI 0.2 to 0.3, dry z below minus 1 and minus 2) are **placeholders**: put them in `pipeline/config.toml` section `[farm]` and say so in the output.

## 5. Knowledge base (agent "knowledge") in `backend/knowledge/`

All values are **drafts with a source and an evidence level**, never silently invented. Evidence levels: `V1` published research or official guidance, `V2` extension handbook or expert statement,
`V3` traditional knowledge, not validated, `V4` validated by platform data (empty at the start). Anything that cannot be sourced is `"evidence": "assumption"` and `"reviewed": false`.
Use web search for standard references (FAO EcoCrop, Department of Agriculture Sri Lanka, published papers) and write the reference in `sources`.

`crops.json`: a list of crops. Fields:
`id` (snake_case, reuse ids from `pipeline/crops_data.json` where they exist), `name_en`, `name_si`, `family`, `type` (`cereal|legume|vegetable|root|tree|hedge|cover`),
`n_fixing` (0 to 3), `cycle_days`, `sow_offset_days` (days after rain onset), `season` (`maha|yala|both|perennial`),
`suitability`: `rain_mm` {optimum:[lo,hi], tolerable:[lo,hi]} for one crop cycle, `tmean_c` {optimum, tolerable}, `slope_pct_max`, `drainage` (list of tolerated: `well|moderate|poor`), `ph` {optimum, tolerable}, `texture` (tolerated list),
`needs_cold_season` (bool, for example saffron), `functions`: {`erosion`, `drought`, `income`, `organic_matter`} each 0 to 3 (how much the crop helps),
`pests` (list of pest/disease groups), `companions` (ids), `conflicts` [{with, reason, evidence}], `buyers_confirmed` (false until real market data exists), `labour` (low|medium|high),
`evidence` (V1 to V4 or `assumption`), `sources` (list of strings), `reviewed` (bool), `notes`.
`zone_weights.json`: weights per zone kind (`steep`, `very_steep`, `gentle`, `flat`, `wet_low`) over {erosion, drought, income, organic_matter}, each set summing to 1 (steep example from "Steps": erosion 0.5, drought 0.2, income 0.2, organic_matter 0.1).
`rotation_templates.json`: `soil_building`, `water_saving` as ordered seasons of crop roles; roles are `cereal`, `legume`, `green_manure`, `deep_rooted_or_cover`, `drought_tolerant_millet_or_pulse`, ... (the engine fills roles with the best-scoring passing crop).
`claims.json`: pairing and practice claims `{id, kind:"pairing|practice", crops, effect, status:"scientifically supported|traditional, not yet validated", evidence, sources}`.
`glossary.json`: `{term, en, si, example_photo (optional path)}` for water balance, NDVI, erosion risk, onset, dry spell, soil moisture anomaly, area-level, confidence, V1 to V4 and so on.
Saffron must exist in the table and fail in the Dry Zone with the reason "no cold season for corm development"; gliricidia and vetiver must exist as hedge/cover crops.

## 5.1 Engine (agent "engine") in `backend/app/engine/`

Pure functions, no database, fully unit-tested. Inputs are plain dicts; every decision appends to a **rule trace** (list of `{rule, text_key, params, evidence}`).
`load_knowledge() -> Knowledge`; `crop_fits(crop, zone_ctx) -> {score (1, 0.5 or 0), failed: [{test, value, range}]}`;
`zone_ctx` = `{kind, slope_pct, wet_low, rain_mm_season, tmean_c, drainage, texture, ph, water_source, erosion_level, bare_months}`;
`score_crop(crop, weights)`; `blend(zone_weights, farmer_priorities, zone_share=0.7)` (the owner's 70/30 split, a design choice to test);
`pair_flags(crops)`, `family_penalty(previous, crop)`; `build_options(farm_ctx, knowledge) -> [option1, option2, option3]` (baseline from crop history, soil-building, water-saving; rule penalties for bare season, repeated family, no legume in two seasons, bonus for legume before cereal);
`apply_scenario(farm_ctx, rain_factor=1.0, onset_delay_days=0)` (a stress test from historical variability, NOT a forecast: say so);
`confidence(data_quality, evidence, local_verification) -> (score, class)` with weights 0.4, 0.3, 0.3 and cut-offs 0.7 high, 0.4 medium;
`explain(trace) -> {why, evidence, benefits, gaps, risks, confidence, check_with_officer}` as text KEYS with parameters (the app translates; no language model, no invented claims).
Required tests: saffron excluded in the Dry Zone with the correct reason; gliricidia ranks first in the steep zone with default weights; the worked examples in "Steps"
(gliricidia 1.5 + 0.6 + 0.2 + 0.3 = 2.6; confidence 0.4 x 0.6 + 0.3 x 0.8 + 0.3 x 0.2 = 0.54; 20% drier 650 mm to 520 mm is "marginal" for finger millet 500 to 900 mm).
Plan cards (per option): `why`, `evidence` (levels used), `benefits` (water, soil, income), `gaps`, `risks_for_review`, `confidence` {score, class}, `trace`, `needs_officer` (steep zone, V2/V3 evidence or low confidence).

## 6. Terrain, soil and threats (agent "terrain")

`terrain.py`: elevation from open terrain tiles (AWS "terrarium" tiles, built from SRTM and similar sources; fetched once per farm by the server, cached on disk under `backend/data/dem_cache/`; if the tiles cannot be fetched the endpoint says so and does not invent zones),
slope % from rise over run, D8 flow accumulation (NumPy), classes flat under 5 percent, gentle 5 to 15, steep 15 to 30, very steep over 30, wet low points where accumulation is high and slope is low, small patches merged into neighbours, polygons as GeoJSON.
Soil: SoilGrids values if reachable (texture, pH, organic carbon) labelled `modelled`; farmer overrides labelled `measured_by_farmer` and used in preference.
Erosion: relative RUSLE index A = R x K x LS x C x P in relative units, ranked low / medium / high (worked example in "Steps": 0.24 then 0.12 with contour hedges).
Threats: erosion, waterlogging, drought exposure, heat stress (computed) plus farmer checklist items (wild animals, theft, pests, flooding history).

## 7. Farm screens (agents "app1" and "app2") in `web/js/farm/`

Route `#/farm[/<screen>[/<farm id>]]` in the farmer end. `web/js/farm/index.js` (app1) exports `renderFarm(state, parts, view)` and dispatches to screen modules.
Screen modules take one object `ctx = { api, farm, view, t, go(hash), tank?: ... }` and return nothing (they fill `ctx.view`):
app1: `index.js`, `api.js`, `register.js` (login with phone and code, language, farm pin or drawn polygon on a Leaflet map, big-button questions, priorities that sum to 1; save locally first, sync when online),
`profile.js` (location card, monthly water balance chart, onset window, dry-spell chart, bare-and-stress strip per year, "area-level" and "cloud gaps" notes, ground-truth yes/no prompt).
app2: `zones.js` (zones on a map, drag-to-edit), `soil.js` (modelled vs measured), `threats.js`, `planview.js` (three rotation cards, scenario slider, confidence, "why not" for removed crops, glossary pop-ups), `monitor.js` (mock-ups: monitoring points, guided measurement forms, practice entry with consent, issue button, a roadmap panel for alerts, learning loop, officer review, village view).
All text through `t()` with keys in `web/strings/farm.*.json` (app1, prefix `farm.`) and `web/strings/farm-plan.*.json` (app2, prefix `fp.`), both languages with identical keys.
Plain words first, big icons, works at 360 px wide, every screen shows its data source and "supports, does not replace local expertise".
The API base is `window.MC_API` or `localStorage["mc-api"]` or `http://localhost:8000`; when it cannot be reached, show a clear message and keep entered data on the phone.
