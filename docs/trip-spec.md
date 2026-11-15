# Trip planner: shared contract for all agents (read fully before touching anything)

Read first: `docs/trip-planner-plan.md` (assessment), `AGENTS.md` (rules), `web/js/planner.js` and `web/js/planner-extras.js` (existing single-place planner, keep working),
`web/js/main.js`, `web/js/i18n.js`, `web/js/farm/*.js` (an example of screens + strings files), `pipeline/rain.py`, `pipeline/climatology.py`.

## 0. Decisions (final)

* The trip platform is the **`plan` end** (`web/plan.html`, hash routes `#/plan/...`). Farmer/learn/officer/research ends and the farm planner are **not touched**.
* Stack: vanilla JS ES modules, no build step, Leaflet (global `L`) and Chart.js (global `window.Chart`, already loaded by the page), Python 3.13, pandas 2.2.3, numpy, requests, xarray, rasterio, **xgboost + scikit-learn (installed)**, FastAPI + sqlite3 (no ORM), pytest, Node for pure-JS tests.
* **No invented data.** Missing = `null` and shown as a dash/"not available". Forecast (Open-Meteo, <=16 days, NOT NASA) / historical tendency (NASA POWER 1981-2025) / seasonal outlook (Open-Meteo, NOT NASA) / ML estimate are always labelled as what they are. Hourly rain comes ONLY from the Open-Meteo hourly forecast, never from daily averages or ML. Beyond the 16-day horizon show tendencies, never daily/hourly "forecasts".
* IMERG is **skipped for now** (no Earthdata token). The UI/metadata say "GPM IMERG: not used yet". Never imply it is used.
* An ML estimate is shown in the UI **only if** `model_metadata.json` says `beats_baseline: true` on held-out data. Otherwise the UI says no ML estimate is used.
* Copilot: rule-based provider in the browser (default, grounded), plus a backend LLM provider that is OFF unless the server has a key (`MC_LLM_API_KEY`). No keys in web files.
* Trips, packing lists, settings live in `localStorage` (keys start with `mc-trip-`, every access wrapped in try/catch).
* All visible text via the strings system: keys in `web/strings/trip-<area>.{en,si}.json` (identical keys in both; Sinhala = draft needing native review), listed in `web/strings/manifest.json`. No text typed in JS/HTML. Logic modules return **text keys + params**, never sentences.
* Palette (scoped to `body[data-end="plan"]`): navy #101C2C, ocean #1677C8, sky #56B4E9, background #F5F8FC, cards #FFFFFF, warning #F59E0B, rain #3182CE, success #16A34A. Accessible contrast, mobile first (360 px), 16 px gutters, no horizontal scroll.
* **Touch only the files you own.** If you need something from another owner, read it and call it; do not edit it. Do not commit. Run tests before reporting. Report briefly: files, what works, what is untested, contract questions.

## 1. File ownership

```
LEAD (done before agents start)   web/js/trip/index.js (router)  web/js/trip/ui.js  web/js/trip/data.js  web/css/trip.css (base theme + shared classes)
                                  web/strings/trip-core.{en,si}.json  tools/make_ends.py nav  web/sw.js  main.js hook  web/js/trip/config.js (defaults)
agent DATA     pipeline/trip/**   data/trip/*.json   [trip] section of pipeline/config.toml   pipeline/tests -> pipeline/trip/tests/
agent LOGIC    web/js/trip/{intensity,forecast,history,scoring,dates,activities,packing,itinerary,store}.js
               web/strings/trip-logic.{en,si}.json   tools/test_trip_logic.mjs
agent SCREENS-A web/js/trip/screens/{rain,compare,dates}.js   web/css/trip-a.css   web/strings/trip-a.{en,si}.json
agent SCREENS-B web/js/trip/screens/{dashboard,explore,suggest,settings}.js   web/css/trip-b.css   web/strings/trip-b.{en,si}.json
agent SCREENS-C web/js/trip/screens/{trips,packing}.js   web/css/trip-c.css   web/strings/trip-c.{en,si}.json
agent COPILOT  web/js/trip/screens/copilot.js  web/js/trip/copilot/**  web/css/trip-d.css  web/strings/trip-d.{en,si}.json
               backend/app/copilot/** backend/app/routes_copilot.py backend/tests/test_copilot.py tools/test_trip_copilot.mjs
```
Each screen module adds its own `<link rel=stylesheet>` for its css on first render (see `web/js/farm/index.js` `ensureCss`).

## 2. Static data files (written by agent DATA, read by everyone) in `data/trip/`

All files: `{ "schema": "<name>-1", "generated": ISO8601 with offset, "source": "...", "demo": false, ... }`. Units: mm, mm/h, degC, %, km/h, m.

### destinations.json  (`schema: "trip-destinations-1"`)
```
{ ..., "country": "LK", "destinations": [ {
  "id": "kandy", "name_en": "Kandy", "name_si": "මහනුවර", "lat": 7.2906, "lon": 80.6337,
  "region": "Central", "kinds": ["culture","city","hill"],         // from: beach hill waterfall wildlife culture city lake forest coast
  "activities": ["sightseeing","museums","culture","restaurants","shopping","photography","hiking"],   // activity ids in 2.1
  "cell": "7.5_80.625",              // NASA POWER square key, same rule as pipeline/rain.py (0.5 deg tall x 0.625 wide, Python float repr)
  "elevation_m": 500,                // AWS terrain tile, or null
  "cost_level": 2, "cost_level_evidence": "assumption",   // 1 low .. 3 high, DRAFT, or null
  "osm": { "type": "node", "id": 123 } | null, "image": null, "note": null } ] }
```
At least 40 destinations in Sri Lanka (all 30 of `data/places.json` plus OSM tourist places: waterfalls, viewpoints, national parks, temples, beaches). Coordinates come from places.json / OpenStreetMap only. kinds -> activities mapping is a documented draft assumption in `config.toml`.

### rainfall_history.json  (`schema: "trip-history-1"`)  source NASA POWER daily PRECTOTCORR, period 1981-2025
```
{ ..., "wet_day_mm": 1.0, "window_days": 7, "years": 45,
  "cells": { "7.5_80.625": { "p_wet":[366], "mean_mm":[366], "p90_mm":[366], "monthly_mm":[12], "tmax_c_monthly":[12] | null } } }
```
Index `i` = day of year - 1 (Feb 29 = index 59 and folded into Mar 1 for non-leap years: use `dayIndex(date)` = days since Jan 1 of that date in a NON-leap year, Feb 29 -> 59). Each value is computed over all years from days within +/-3 days (window 7) of that calendar day. `p_wet` is the share of those days with rain >= `wet_day_mm` (0..1). Cells not downloaded are absent (UI says "no historical tendency for this area yet"). Download is resumable and polite (POWER resets connections: pause between requests, retries, cache in `pipeline/cache/trip/`).

### forecast_snapshot.json  (`schema: "trip-forecast-1"`)  source Open-Meteo (NOT NASA), refreshed by `pipeline/trip/main.py`
```
{ ..., "fetched_at": "...", "timezone": "Asia/Colombo", "forecast_days": 16, "not_nasa": true,
  "destinations": { "<id>": { "hourly": { "time":["2026-11-15T00:00",...], "precipitation":[mm per hour], "precipitation_probability":[%], "temperature_2m":[C],
        "relative_humidity_2m":[%], "wind_speed_10m":[km/h], "wind_gusts_10m":[km/h], "weather_code":[WMO] },
      "daily": { "time":["2026-11-15",...], "precipitation_sum":[mm], "precipitation_probability_max":[%], "temperature_2m_max":[C], "temperature_2m_min":[C],
        "wind_speed_10m_max":[km/h], "sunrise":[...], "sunset":[...] } } } }
```
Used as the offline copy and as a fallback; the browser still fetches live (`forecast.js`). Hourly `precipitation[i]` at stamp T is the hour ENDING at T (Open-Meteo convention, see planner.js `windowHours`).

### trip_config.json  (`schema: "trip-config-1"`)  generated from `[trip]` in pipeline/config.toml; the web loads it, with identical built-in defaults in `web/js/trip/config.js`
```
{ "intensity": { "unit": "mm/hour", "light_min": 0.1, "moderate_min": 2.5, "heavy_min": 10, "very_heavy_min": 50 },
  "no_rain_day_mm": 0.1, "wet_day_mm": 1.0, "forecast_horizon_days": 16, "cache_minutes": 30,
  "verdict": { "wet_mm": 3, "wet_chance": 70, "maybe_mm": 0.5, "maybe_chance": 35 },
  "comfort": { "temp_ideal_min": 22, "temp_ideal_max": 32, "hot_c": 34, "cold_c": 16, "windy_kmh": 40, "strong_kmh": 60 },
  "weights": { "weather": 0.40, "activity": 0.25, "preference": 0.20, "environment": 0.15 },
  "day_periods": { "night": [0,5], "morning": [6,11], "afternoon": [12,17], "evening": [18,23] } }
```
Intensity classes: hourly `mm` < 0.1 -> `none`; 0.1-<2.5 `light`; 2.5-<10 `moderate`; 10-<=50 `heavy`; >50 `very_heavy`. Daily totals are reported as a total + wet-day flag (>= wet_day_mm), never classed as an intensity.

### model_metadata.json  (`schema: "trip-models-1"`) and ml_estimates.json (optional)
```
{ ..., "ml_available": false, "imerg": { "used": false, "reason": "no Earthdata token" },
  "models": [ { "id":"xgb_occurrence","task":"occurrence","algo":"XGBClassifier","target":"rain >= 1 mm on day t+1","features":[...],
     "train":"1981-2012","valid":"2013-2018","test":"2019-2025","metrics":{"precision":..,"recall":..,"f1":..,"roc_auc":..,"brier":..},
     "baseline":{"name":"climatology","brier":..,"roc_auc":..},"beats_baseline":false,"by_cell":{...},"by_season":{...},"calibration":[...],"notes":"..." }, ... ],
  "limits": ["..."] }
```
`ml_estimates.json` exists only if some model has `beats_baseline: true`: `{ "for_date": "...", "destinations": { id: { "p_rain": .., "mm": .. } } }` marked `"ml_estimate": true`.

### environmental_data.json (`schema: "trip-env-1"`): per destination `{ elevation_m, slope_pct|null, ndvi|null, ndvi_source }` (NDVI only where a NASA MODIS value really exists, else null).

## 3. JS contracts (written by LOGIC; screens and copilot code against these exact signatures)

Shared data shapes: `forecast = { ok, source:"Open-Meteo", not_nasa:true, fetchedAt, stale, error, hourly:{...as above}, daily:{...} }`.
`prefs = { interests:[activityId], maxRainMm:number|null, preferredTemp:"cool|mild|warm|any", style:"relaxed|balanced|adventurous", budget:1|2|3|null, region:string|null }`.

* `config.js` (LEAD): `export const DEFAULTS`, `getConfig()` (defaults < trip_config.json < localStorage `mc-trip-settings`), `saveSettings(o)`, `resetSettings()`.
* `intensity.js`: `classifyHour(mm,cfg?)` -> `"none"|"light"|"moderate"|"heavy"|"very_heavy"`; `INTENSITY` = `{id:{key:"trip.int.<id>", color, rank}}`; `periodOf(hour,cfg?)` -> `"night|morning|afternoon|evening"`; `summariseDay(hourlyDay,cfg?)` -> `{totalMm, maxHourMm, maxClass, wetHours, durationHours, firstWetHour, lastWetHour, maxChance, avgTemp, maxTemp, minTemp, avgHumidity, avgWind, maxGust, byPeriod:{...}, goodWindows:[{from,to}]}` where hourly input is `[{h,mm,chance,temp,rh,wind,gust,code}]` (24 rows, missing = null).
* `forecast.js`: `loadForecast(dest,{force})` async -> forecast (live Open-Meteo, in-memory + localStorage cache `mc-trip-fc-<id>` with `fetchedAt`; on failure returns the cached copy with `stale:true`, then the static snapshot with `stale:true`, else `{ok:false,error}`); `loadForecasts(dests,{force})` -> `Map(id->forecast)` fetched with limited concurrency; `hoursOf(forecast,date)` -> 24 rows as above; `dailyOf(forecast,date)`; `dayKind(date,today?,cfg?)` -> `"forecast"` (within horizon) or `"tendency"`.
* `history.js`: `loadHistory()` async (cached); `tendencyFor(history,cellKey,date)` -> `{kind:"historical_tendency", pWet, meanMm, p90Mm, source:"NASA POWER", period}` or `null`; `rangeTendency(history,cellKey,startDate,endDate)` -> `{pWetAvg, meanMmTotal, days}` or `null`; `dayIndex(date)`.
* `scoring.js`: `weatherScore(summary,prefs,cfg?)` -> `{score:0..100, parts:{rain,chance,heavy,temp,wind}, reasons:[{key,params}]}`; `activityScore(dest,summary,prefs,cfg?)`; `preferenceScore(dest,prefs)`; `environmentScore(dest,env?)`; `destinationScore({dest,summary,prefs,env,cfg})` -> `{S,W,A,P,E,reasons:[{key,params}],notAScientificIndex:true}` with `S = wW*W + wA*A + wP*P + wE*E` using `cfg.weights`; `rankDestinations(list,sortBy)` where sortBy in `lowest_rain|lowest_chance|best_score|best_activity`.
* `dates.js`: `findBestDates({dest,forecast,history,durationDays,rangeStart,rangeEnd,prefs,original,today,cfg,limit})` -> `{results:[{start,end,dataKind:"forecast"|"tendency"|"mixed",score,rainMm,pRain,heavyHours|null,reasons:[{key,params}]}], original:{...same fields}|null, notes:[{key,params}]}`; forecast days use hourly/daily forecast data, days beyond the horizon use `history` tendencies and are never shown as forecasts.
* `activities.js`: `ACTIVITIES` = `{id:{kind:"outdoor"|"indoor",key:"trip.act.<id>",icon}}` with ids `hiking camping beach waterfalls photography wildlife sightseeing cycling museums restaurants culture entertainment shopping workshops`; `recommendActivities({dest,hours,summary,interests,durationDays,cfg})` -> `[{id,kind,suitable,score,bestWindow:{from,to}|null,reason:{key,params}}]` sorted best first (rules: heavy rain -> indoor + reschedule outdoor; light rain -> scenic sightseeing/museums; high wind -> avoid exposed ones; dry -> beach/hiking/photography; only activities available at the destination; opening hours are not available so they are never claimed).
* `packing.js`: `buildPacking({dest,summary,activities,durationDays,prefs,saved})` -> `{categories:[{id,key,items:[{id,key,qty,auto:true,reason:{key,params},checked:false}]}]}` merging saved manual additions/removals/checks; categories `rain clothing outdoor essentials`; `togglePackingItem`, `addPackingItem`, `removePackingItem` (pure, return new objects).
* `itinerary.js`: itinerary = `{id,name,items:[{id,day:"YYYY-MM-DD",slot:"morning|afternoon|evening",destId,activity,kind,locked:boolean (confirmed booking),note}]}`; `proposeReschedule({itinerary,forecasts:Map,cfg,distanceKm?})` -> `{proposals:[{itemId,problem:{key,params},options:[{type:"move"|"replace"|"keep",toDay,toSlot,toActivity,toDest,score,reason:{key,params}}]}], unaffected:[itemId]}`; locked items are never changed (they only generate a warning); `applyProposals(itinerary,accepted:[{itemId,option}])` -> new itinerary (pure; the UI saves it only after the user accepts); `distanceKm(a,b)` haversine.
* `store.js`: `listTrips()`, `getTrip(id)`, `saveTrip(trip)`, `deleteTrip(id)`, `newTripId()`, `getPacking(tripId)`, `savePacking(tripId,obj)`, `getPrefs()`, `savePrefs(p)`, `getLastForecastStamp(id)`; all try/catch, fall back to an in-memory map when storage is blocked.

## 4. Router and screen contract (LEAD)

`web/js/trip/index.js` exports `renderTrip(state, parts, view)`. Routes: `#/plan` dashboard; `#/plan/explore`; `#/plan/rain[/<destId>[/<date>]]`; `#/plan/compare[/<id,id,id>/<start>/<end>]`; `#/plan/dates[/<destId>]`; `#/plan/suggest`; `#/plan/trips[/<tripId>]`; `#/plan/copilot`; `#/plan/packing[/<tripId>]`; `#/plan/settings`; `#/plan/place/...` and `#/plan/<lat>,<lon>/...` = the existing single-place planner (`planner.js`), unchanged.
Each screen module exports `renderXxx(ctx, parts, view)` (names: renderDashboard, renderExplore, renderRain, renderCompare, renderDates, renderSuggest, renderTrips, renderCopilot, renderPacking, renderSettings). `ctx = { state, t, go(hash), ui, data, cfg }` where `data = await loadTripData()` = `{ destinations:[...], byId:Map, history, config, snapshot, modelMeta, errors:[...] }` (any part may be null) and `ui` = `web/js/trip/ui.js`: `h(tag,attrs,...kids)`, `toast(key|text,kind)`, `modal({title,body,actions})`, `loading(view)`, `errorBox(view,key,retry)`, `badge(kind)` (kind: `forecast|tendency|seasonal|ml|nasa|notnasa`), `stamp(date)` (formats "updated ..."), `destName(dest)`, `chart(canvas,config)` (wraps Chart.js, destroys the previous chart on that canvas), `fmtDate`, `fmtMm`, `fmtTemp`. Every number shown carries a source badge. Cached forecasts always show "last updated <time>" and are never labelled current.
