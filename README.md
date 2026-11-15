# 🌍 TerraOrb (Monsoon Compass)

> **Your season's direction, read from space.**
> Turning NASA Earth observation data into plain advice for Sri Lanka's Dry Zone farmer organisations, students, agriculture officers, researchers and travellers.

[![NASA Space Apps 2026](https://img.shields.io/badge/NASA%20Space%20Apps-2026-blue.svg)](https://www.spaceappschallenge.org/)
[![Challenge: Field Shift](https://img.shields.io/badge/Challenge-Field%20Shift-orange.svg)](https://www.spaceappschallenge.org/)
[![PWA: Offline First](https://img.shields.io/badge/PWA-Offline%20First-emerald.svg)](web/)
[![Live site](https://img.shields.io/badge/Live-terraorb.pages.dev-brightgreen.svg)](https://terraorb.pages.dev/)

**Live site:** <https://terraorb.pages.dev/> · Built for the NASA Space Apps Challenge 2026, *"Field Shift: Adapting Farms with NASA Data"*.

TerraOrb supports the knowledge of farmers and their Agriculture Instructor. It does **not** replace them: every piece of advice is a suggestion to discuss locally.

---

## 🌾 What is TerraOrb?

In the Dry Zone, ancient cascade tanks (*wewa*) irrigate village paddy fields. Monsoon onset dates are shifting, which makes seasonal planning hard for small farmer organisations.

A farmer picks a village tank and sees, in plain words first (numbers only in the Advanced view):

1. **Tank water now vs usual** from NASA satellite water maps (only where the satellite check has been run).
2. **A green / amber / red signal** with advice:
   - 🟢 **Full paddy:** enough water for the whole command area.
   - 🟡 **Short paddy + bethma sharing:** grow short-duration paddy on shared upper plots.
   - 🔴 **Other field crops:** mung bean, cowpea, black gram and other drought-tolerant crops.
3. **Rain and heat history** since 1981, a **16-day forecast**, **live rain** and heavy-rain warnings.
4. **What to sow now**, a **12-week sowing calendar** and **this week's advice** that can be shared on WhatsApp.
5. **Soil moisture, satellite rain and more** for the tank's area (see the data table below).

103 tanks are on the map: 100 real tanks from OpenStreetMap and 3 labelled demo tanks.

---

## 📱 The five ends

Each end is its own app with its own home page, a detailed how-to guide with pictures, a colour theme and a chat helper.

| End | Page | Focus |
|---|---|---|
| **Farmer** | `web/farmer.html` | Tank finder and map, advice, weather, sowing calendar, weekly advice, **My farm plan** (own field, land zones, crop rotation ideas with reasons) |
| **Learn** | `web/learn.html` | 16 picture-story lessons, little games for children, Rain Cloud, Tank Farmer and My Farm games, practice challenges, rewards and certificate |
| **Officer** | `web/officer.html` | Dashboard of every tank (filters, CSV, printable report), NASA fires, groundwater and a flood / cloud map |
| **Research** | `web/research.html` | Method, accuracy tests (good and bad results shown), downloadable data files, country-level NASA data |
| **Plan** | `web/plan.html` | Trip and event planner: will it rain, best dates, compare places, saved trips, packing list, calendar file |

The landing page is `web/index.html`. An **Ask TerraOrb** chat helper is on every page. It is rule-based (written, checked answers) and, when the server allows it, uses **Google Gemini** only to answer from those written answers; it says so on the answer. Gemini is not NASA data.

---

## 🛰️ Data used

Every value on the site carries its source. Anything that is not NASA data is labelled **"Not NASA data"** and credited.

| Dataset | Used for |
|---|---|
| **NASA POWER** | Daily rain, temperature, humidity, wind and sunshine since 1981; usual weather by month |
| **NASA OPERA DSWx-HLS / HLS** | Tank water area from 30 m satellite water maps (NDWI fallback) |
| **NASA GPM IMERG** | Satellite rain: a second rain record beside POWER, trip-planner checks and layer on maps |
| **NASA SMAP** (L3) | Satellite soil moisture (top 5 cm), area-level |
| **NASA GLDAS-2.1 Noah** | Modelled soil moisture, top and deeper soil (a model product, not SMAP) |
| **NASA MODIS** | Greenness (NDVI), evapotranspiration (MOD16), ground heat (MOD11), land cover (MCD12Q1), flood and cloud layers |
| **NASA FIRMS** | Fires seen from space in the last 7 days |
| **NASA GRACE-FO** | Country-level stored water (groundwater signal, about 300 km) |
| **NASADEM** | 30 m land height for trip places |
| **NASA GIBS** | Satellite map layers: real colour, rain, greenness, flood, cloud, night lights, air haze and ground heat |

**Not NASA data (always labelled):** Open-Meteo (forecast, live rain, seasonal outlook), OpenStreetMap (tank locations, map), Google Gemini (optional chat wording).

---

## 🧭 Project rules

1. **Never invent data.** If a fetch fails the step stops. Placeholder values carry `"demo": true` and show as *Demo data*.
2. **Modules stay separate:** the data pipeline (`pipeline/`), the rule engine (`pipeline/rules.py`) and the web app (`web/`) share only the JSON files described in `docs/schema.md`.
3. **All text lives in language files** (`web/si.json`, `web/en.json` and `web/strings/*`), with the same keys in Sinhala and English. The Sinhala is a **draft** that needs native-speaker review.
4. **Plain words for farmers**, numbers in the Advanced view only.
5. **Honest limits:** forecasts are not certain, satellite values are area-level, thresholds are drafts waiting for expert review.

---

## 🚀 Run it on your computer

Needs Python 3.12 or newer. No Node or npm is needed to run the site.

```powershell
# 1. the website (from the repository root; the site reads ../data)
.\.venv\Scripts\python.exe -m http.server 8010
# open http://localhost:8010/web/

# 2. the farm planner backend (FastAPI + SQLite), on http://localhost:8000
backend\run.ps1
```

Tests:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests pipeline/tests pipeline/trip/tests
node tools/test_trip_logic.mjs ; node tools/test_trip_copilot.mjs ; node tools/test_assistant.mjs ; node tools/test_planner_extras.mjs
```

The data pipeline (rain, water, rules, crops, NASA datasets) is in `pipeline/`; see [`AGENTS.md`](AGENTS.md) for the run order and notes. NASA data that needs a login reads your **Earthdata token from the environment variable `EARTHDATA_TOKEN`**. Never put a token or key into a file.

---

## 🌐 Hosting

| Part | Where | Notes |
|---|---|---|
| Website and chat function | **Cloudflare Pages** (free) | The chat's Gemini key is a Pages secret (`GEMINI_API_KEY`), never in the browser |
| Farm planner backend | **PythonAnywhere** (free) | FastAPI + SQLite; guest accounts (no sign-in) when `MC_GUEST=1` |
| Daily data refresh | GitHub Actions (`.github/workflows/refresh.yml`) | Commits new data to `data/` |

Build the upload folders with `python deploy/make_deploy.py`, then deploy with Wrangler (`wrangler pages deploy`). Step-by-step notes are in [`docs/deploy.md`](docs/deploy.md) and the `deploy/` folder.

---

## 📁 Repository layout

```
web/        the apps (plain HTML, CSS and JavaScript modules, Leaflet and Chart.js; no build step)
data/       tank files, climate cells, trip data, farm tables and national NASA data (JSON)
pipeline/   Python data steps, the rule engine, the trip-planner pipeline and tests
backend/    farm planner API (FastAPI + SQLite) and its tests
deploy/     hosting scripts (Cloudflare Pages, PythonAnywhere, EC2 and Hugging Face notes)
docs/       data format, validation results, trip and farm specs, submission material
tools/      page generators, picture tools and JavaScript tests
```

---

## ⚠️ Known limits

- Real satellite tank water exists for only **one tank** so far; the rest show "Water not checked yet".
- Rain data from 1 Oct 2026 in NASA POWER's near-real-time feed is skipped (a known fault); POWER rain before 1997 looks low at some places. IMERG covers the gap in the tank rain view.
- The El Niño outlook does **not** beat its baseline and is shown only as a count. The rain-fed crop advice beats guessing in the backtest (`docs/validation.md`).
- Phone sign-in needs an SMS service that is not built; the hosted farm planner and officer dashboard open without sign-in.
- The Sinhala text is a draft.

---

## 🙏 Credits

NASA Earth observation data (POWER, GPM IMERG, SMAP, GLDAS, MODIS, FIRMS, GRACE-FO, NASADEM, GIBS, OPERA and HLS). Tank locations © OpenStreetMap contributors (ODbL). Forecasts by Open-Meteo. Pictures and videos were made with Google Flow (AI-generated). Built by the TerraOrb team for NASA Space Apps 2026.
