# Trip planner ("Travel Smarter with Earth Intelligence"): architecture assessment and plan

Status: **plan only, nothing built yet.** Written 15 Nov 2026 after inspecting the repository against the master prompt.

## 1. What already exists (and what we reuse)

| Master-prompt need | What is already in the repo | Verdict |
|---|---|---|
| Five generated entry pages, hash routing | `tools/make_ends.py` + `tools/ends/template.html` build `farmer/learn/officer/research/plan.html`; `web/js/main.js` routes by `data-end` | Reuse. The trip platform lives in the **`plan` end** (`plan.html`). |
| Single-place rain planner | `web/js/planner.js` (Open-Meteo hourly, dry/maybe/wet, best window, climatology, kinds of trip, wind/UV/heat, bring list, compare 2 places, .ics) + `planner-extras.js` (tested with Node) | Keep working at `#/plan/<lat>,<lon>/<date>/<from>-<to>[/kind]`; becomes the "Rainfall Prediction" screen. |
| Localization | `web/en.json`/`si.json` + extra files listed in `web/strings/manifest.json` | Reuse: new text goes in `web/strings/trip.{en,si}.json`. |
| Offline | `web/sw.js` shell list, per-end manifests | Extend: add trip files; never serve cached weather as current. |
| Leaflet, Chart.js | Leaflet used; Chart.js used in tank pages; CSS-only charts in the farm planner | Reuse. |
| NASA POWER | `pipeline/rain.py`, `climatology.py`; `data/cells/` daily 1981-2025 for **5** squares; `data/climatology.json` monthly for **35 of 45** squares | Partial: daily history needed for more squares. |
| NASA MODIS NDVI | `pipeline/ndvi.py`, `data/ndvi_cache/` (per tank, Anuradhapura only) | Partial: only the Dry Zone tanks. |
| NASA GIBS | satellite layers already used in maps | Reuse. |
| NASA Earthdata / GPM IMERG | Earthdata used for tank water (`water.py`); **no token set in this environment**; no IMERG code | New, needs the user's token. |
| Open-Meteo | forecast, live rain, seasonal, planner | Reuse (non-NASA, labelled). |
| OpenStreetMap | tanks via Overpass; `data/places.json` (30 well-known places) | Extend to tourist destinations. |
| AWS terrain tiles | `backend/app/terrain.py` (DEM fetch, slope) | Reuse for elevation of destinations. |
| FastAPI backend | `backend/` (farm planner, auth, SQLite, rule engine pattern, auto-loaded `routes_*.py`) | Reuse the pattern; add `routes_trip.py` / `routes_copilot.py`. Farm planner untouched. |
| Rule-based assistant | `assistant.js` + `assistant-kb.js` (topics per end, fuzzy matching) | Reuse as the Copilot's default "provider". |
| Tests | pytest (`pipeline/tests`, `backend/tests`, 79 passing), Node tests in `tools/` | Reuse both styles. |

## 2. Conflicts and gaps to resolve (decisions needed or proposed)

1. **AI Travel Copilot vs "rule-based, no paid services".** No API key exists. Proposal: a provider interface on the backend
   (`/api/copilot`), default provider = our rule-based parser + tools (always works, free, grounded), optional LLM provider that is
   switched on only when a server-side key is set. Answers are built from retrieved data in both cases.
2. **GPM IMERG needs an Earthdata token** (none in this environment; tokens expire in ~60 days). Without it IMERG is skipped and the
   app says "not used", never faked.
3. **Machine learning honesty.** Daily rain from past rain alone rarely beats climatology beyond ~2 days, and Open-Meteo's forecast is
   better for the near term. Plan: train and evaluate XGBoost/Random Forest on chronological splits against climatology, publish
   results in `model_metadata.json` either way, and show an "ML estimate" in the UI **only if it beats the baseline on held-out data**.
   Hourly rain is never produced by ML or from daily averages: hourly = Open-Meteo forecast only (<= 16 days).
4. **Long-range dates (beyond the 16-day forecast).** Use NASA POWER historical tendencies (chance of a wet day and mean rain in a
   +/-7-day window around each calendar day) plus the seasonal outlook, labelled "historical tendency", never "forecast". This needs
   daily history for all of Sri Lanka's ~45 POWER squares (we have 5): a resumable, rate-limit-friendly download.
5. **Naming.** The prompt suggests `data_pipeline/`; the repo convention is `pipeline/`. Proposal: `pipeline/trip/` (same sub-structure:
   `download/`, `processing/`, `models/`, `validation/`, `tests/`) and `data/trip/*.json` instead of loose files in `data/`.
6. **Routes.** New screens under `#/plan/...` (dashboard, explore, rain, compare, best-dates, suggestions, trips, copilot, packing,
   settings). The legacy `#/plan/<lat>,<lon>/...` address keeps working (detected by its pattern).
7. **Look and feel.** The prompt's navy/blue travel-intelligence palette is applied only to the `plan` end (scoped CSS), leaving the
   "earthy" farmer end unchanged.
8. **Intensity thresholds.** The prompt's list mixes mm/day and mm/hour. Implement hourly categories (0.1-2.5 light, 2.5-10 moderate,
   10-50 heavy, >50 very heavy mm/h) in `config.toml`; daily totals are shown as totals plus a "wet day" flag, not as an intensity class.
9. **Storage.** Saved trips, packing lists and preferences stay in `localStorage` (no accounts needed); the backend is used only for
   the Copilot, Open-Meteo caching/rate-limit protection and anything needing secrets.
10. **Frontend tests.** The repo has no browser test runner; use Node tests for pure modules (existing style) plus scripted checks in
    the built-in browser for routing, charts, offline and layout.

## 3. Target architecture

```
pipeline/trip/            download/{nasa_power,gpm_imerg,modis,open_meteo,osm}.py  processing/  models/  validation/  tests/
data/trip/                destinations.json  rainfall_history.json  environmental_data.json  model_metadata.json  (+ cached forecast snapshots)
backend/app/              routes_trip.py (cached forecast proxy, validation)   routes_copilot.py + copilot/{provider,rules,llm}.py
web/js/trip/              shared pure modules: intensity.js scoring.js dates.js activities.js packing.js itinerary.js store.js
                          screens: dashboard explore rain compare bestdates suggest trips copilot packing settings
web/strings/trip.{en,si}.json    web/css/trip.css (scoped to body[data-end=plan])
```

Shared pure modules (testable in Node) hold the logic once: rainfall intensity, suitability score
`S = 0.40 W + 0.25 A + 0.20 P + 0.15 E` (weights in settings), date ranking, activity rules, packing rules, itinerary optimisation.

## 4. Phases (each ends with files created/modified, tests run, limits, next step)

1. Inspection and plan (this document).
2. Data integration: Open-Meteo hourly/daily client with cache and timeouts; POWER daily history for all squares; IMERG (if token); OSM destinations.
3. Preprocessing and static JSON generation with source/timestamp metadata.
4. Rainfall models (classifier, regressor, climatology baseline), honest evaluation, `model_metadata.json`.
5. Comparison (3+ destinations) and best-date finder.
6. Activity recommendation and destination suggestion engine.
7. Itinerary rescheduler (proposals only; user approves; never touches confirmed bookings).
8. Copilot (provider interface, rule-based default, grounded answers).
9. Packing assistant.
10. UI integration, localisation, offline, tests, README with install/config/data/training/run steps.

Parallelisation (as for the farm planner): after phase 2 fixes the JSON contracts, run agents with strict file ownership:
data/ML, shared logic modules, comparison + best dates screens, suggestions + activities screens, itinerary + packing screens, copilot, integration/offline.
