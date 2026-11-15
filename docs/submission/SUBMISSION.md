# TerraOrb: NASA Space Apps 2026 submission content

Copy each section into the matching field on the Space Apps **Project** tab.
Things you still have to fill in or check are marked **[TODO]**.

---

## 1. Project name

**TerraOrb: your season's direction, read from space**

(If the field is short: **TerraOrb**)

---

## 2. High-level project summary

TerraOrb is a free, offline-capable website that turns NASA Earth observation data into plain-language farming decisions for Sri Lanka's Dry Zone, where village farmer organisations depend on small ancient irrigation tanks (wewas) and the monsoon rains are becoming harder to predict. A farmer picks their village tank on a map and sees how much water it holds compared with usual (satellite water extent), when the Yala and Maha rains really started in past seasons (NASA POWER, 1981 onwards), a green, amber or red signal with three options (full paddy; short-duration paddy with bethma land-sharing; or switching to drought-hardy crops such as mung bean, cowpea and black gram), a 16-day forecast, what to sow now and a 12-week sowing calendar. A one-page card can be shared on WhatsApp for the village meeting (kanna meeting) where the season is planned together.

Farmers are not the only audience. TerraOrb has five "ends": **Farmer**, **Learn** (lessons and games for students and young farmers), **Officer** (a dashboard for agricultural officers covering all 103 mapped tanks, NASA FIRMS fires and GRACE-FO water storage), **Research** (data, backtests and NASA datasets) and **Plan** (a weather-aware trip and field-visit planner). It addresses *Field Shift: Adapting Farms with NASA Data* by putting NASA satellite and climate data in front of the people who decide what is planted. It works in Sinhala and English, and every number shows its data source. Where data is missing, the site says so and never guesses.

---

## 3. Project demo (up to 7 slides or a 30-second video)

**Suggested format: a 7-slide deck** (PDF or Google Slides, link set to public).
Screenshots for the slides are in `docs/submission/shots/`. The full illustrated walkthrough is `docs/submission/TerraOrb-Demo.pdf`.

| # | Slide | Content | Picture |
|---|---|---|---|
| 1 | **Title** | TerraOrb: your season's direction, read from space. Team **[TODO team name]**, members **[TODO names]**. Challenge: *Field Shift: Adapting Farms with NASA Data*. | `00-landing-hero.jpg` |
| 2 | **The problem** | Sri Lanka's Dry Zone farms rely on village tanks. Monsoon onset now swings by weeks. Each season the farmer organisation must decide how much land to plant: full paddy, shared (bethma) paddy, or other crops. Today they decide with little data. | `10-farmer-home.jpg` |
| 3 | **Our solution: Farmer end** | Pick your tank, then read: water vs usual, rain start dates, and a green / amber / red plan with "Why?" reasons. Sinhala first, works offline, shared to WhatsApp. | `11-farmer-plan.jpg`, `18-farmer-mobile.jpg` |
| 4 | **NASA data makes it possible** | NASA POWER (46 years of daily rain and heat), OPERA DSWx-HLS / HLS (tank water), MODIS NDVI, GPM IMERG, SMAP, GLDAS, MODIS ET/LST, FIRMS fires, GRACE-FO, NASADEM, and GIBS satellite maps. | `12-farmer-tank.jpg` |
| 5 | **One data source, five ends** | Farmer · Learn · Officer · Research · Plan. One screenshot each. | `20-`, `31-`, `40-`, `50-` |
| 6 | **Is it right?** | Backtest: the rain-fed crop advice is right 79% of the time vs 57% for guessing (trained 1981–2010, tested 2011–2025). We also publish what *didn't* work: the El Niño outlook and a tank-level model did not beat their baselines, so they are shown only as counts or not used. | `41-research-national.jpg` |
| 7 | **What's next** | Satellite water for all 103 tanks, review by an Agricultural Instructor, native-speaker Sinhala review, SMS and voice for farmers without smartphones, then Sri Lanka's thousands of other tanks. Link: https://terraorb.pages.dev | `16-farmer-card.jpg` |

**Alternative: a 30-second video.** The script is in `docs/video-script.md`. Update its numbers to Nuwara Wewa (the tank with real satellite water data) before recording. If you speak Sinhala, add English subtitles.

**Demo link:** **[TODO: upload the deck or video to Google Drive / YouTube, set it to "Anyone with the link", and paste the URL here]**

---

## 4. Final project link

- Live website: **https://terraorb.pages.dev** (landing page: https://terraorb.pages.dev/web/)
- Source code: **https://github.com/kavi-X-Debug/TerraOrb** **[TODO: make sure the repository is public]**

Direct links to each end:
- Farmer: https://terraorb.pages.dev/web/farmer.html
- Learn: https://terraorb.pages.dev/web/learn.html
- Officer: https://terraorb.pages.dev/web/officer.html
- Research: https://terraorb.pages.dev/web/research.html
- Plan: https://terraorb.pages.dev/web/plan.html

---

## 5. Detailed project description

### What it does
TerraOrb answers one question for a Dry Zone farmer organisation: *what should we plant this season, and on how much land?* For each of **103 village tanks** (100 real tanks mapped from OpenStreetMap plus 3 clearly labelled demo tanks) it shows:

- **Tank water now vs usual:** the water surface inside the tank outline, measured from 30 m satellite images, compared with the same month in other years.
- **When the rains started:** the onset of every Yala and Maha season since 1981, how late or early it was against the 1991–2020 average, and season totals.
- **A season signal:** green (full paddy), amber (short-duration paddy with bethma sharing on part of the land) or red (other field crops). A **"Why?"** panel lists the exact values that triggered it, each with its NASA source.
- **What to sow now and a 12-week sowing calendar**, based on crop water needs (FAO-56 method) and NASA POWER temperatures.
- **This week's advice**, a 16-day forecast, live rain and heavy-rain warnings, greenness (MODIS NDVI), soil moisture (SMAP and GLDAS) and a seasonal rain outlook.
- **A shareable summary card** for WhatsApp or printing, for the village meeting.

### The five ends
1. **Farmer:** tank finder map, season plan, tank charts, crops, weather, weekly advice, sowing calendar, summary card and a farm planner ("My farm plan").
2. **Learn:** 16 illustrated "Little Lessons" (water cycle, monsoons, cascades, satellites, El Niño and La Niña, global warming and more), games for small children, a quiz and challenges that use real tank data, and a rewards system with badges and a printable certificate.
3. **Officer:** a dashboard of all tanks by signal, filters, a CSV export, NASA FIRMS active fires from the last 7 days and GRACE-FO water storage.
4. **Research:** climate time series, backtest results, the national NASA layers (fires, GRACE-FO, flood and cloud layers) and how every number was computed.
5. **Plan:** a trip and field-visit planner that combines a live forecast with NASA POWER history beyond 16 days, rain-by-hour views, comparing two places, packing lists, sunrise and sunset, an .ics calendar file and a rule-based copilot.

### How it works
1. **Data pipeline (Python: pandas, numpy, xarray, rasterio, requests).** It downloads NASA POWER daily rain and temperature for each tank since 1981 and finds each season's onset (the first day from 15 Mar or 15 Sep with at least 25 mm in 3 days, not followed by a 7-day dry spell within 30 days). It measures tank water from OPERA DSWx-HLS, or from HLS with NDWI, and reads MODIS, SMAP, GLDAS, IMERG, FIRMS and GRACE-FO.
2. **Transparent rule engine.** All thresholds live in one config file. The signal is checked in a fixed order (red, then amber, then green). **Missing data never turns a signal green.**
3. **Static website (HTML, CSS, JavaScript, Leaflet, Chart.js).** It reads the pre-computed JSON files, so it is fast on a basic phone. It works offline as a PWA (service worker), in Sinhala and English, with NASA GIBS satellite layers on the maps. A small FastAPI and SQLite backend serves only the farm planner.
4. **Automation.** Scheduled jobs refresh the data. The site is hosted for free on Cloudflare Pages.

### Honesty and validation
- Every value on screen carries its data source label. Non-NASA data (Open-Meteo forecasts, OpenStreetMap tank outlines) is labelled "Not NASA data".
- **Backtest:** the rain-fed crop advice was right **79%** of the time against **57%** for guessing (trained on 1981–2010, tested on 2011–2025).
- We publish what failed too: the El Niño analogue outlook and a rain-to-tank-level model did **not** beat their baselines, so they are shown only as counts or not used.
- Known data issues are documented, not hidden. For example, NASA POWER's near-real-time rain from October 2026 is about 24 times too large and is skipped.

### Benefits
- Village meetings can decide on land and crops from evidence, before water runs out.
- Switching to drought-hardy crops early reduces crop failure and debt.
- It is free, works offline, is Sinhala first and uses plain words, so it suits farmers with little technical knowledge.
- One method can scale to the many thousands of small tanks across Sri Lanka.

### What we hope to achieve
Run the satellite water step for every tank, have the advice and thresholds reviewed by an Agricultural Instructor and the Sinhala text reviewed by native speakers, add SMS and voice access for farmers without smartphones, and pilot it with a farmer organisation in Anuradhapura District.

### Tools and languages
Python 3 (pandas, numpy, xarray, rasterio, requests, pytest) · HTML, CSS, JavaScript (ES modules, no build step) · Leaflet · Chart.js · FastAPI and SQLite · GitHub · Cloudflare Pages · Hugging Face Spaces (copilot API) · Node.js (tests).

---

## 6. Explanation of SI / AI usage

- **Code and documentation:** we used **Claude Code (Anthropic)** as a coding assistant to write and test the Python data pipeline, the rule engine, the website and its tests, to check NASA API responses and to draft documentation. The team chose the problem, the idea, the data sources and the rules, and reviewed the output. The repository README and docs state this.
- **Images and short animations:** the Learn Mode artwork, the 16 lesson pictures with their 10-second animations, the home-page and guide pictures were made with **Google Flow**. Three decorative banners were made with **Canva's AI image tools**. They are decorative or teach general facts and contain no data. The site states that they are AI-made.
- **No AI makes the advice.** The farm signal comes from published, fixed thresholds. The "Ask TerraOrb" assistant is rule-based with written answers, not an AI model. The optional trip copilot can call an LLM only if a server key is set, and it is off by default.
- An ML model (gradient-boosted trees) gives rain-occurrence estimates in the Plan end only. It is clearly labelled, and we note that it is not proof of forecasting skill.
- No AI voice or AI audio is used.

> **[TODO, required by the rules]** Space Apps requires a **visible watermark** on AI-generated images and videos. Add a small "AI-generated" label to the Flow and Canva pictures (or as a caption on each), and check that no AI picture shows a child-like person, because images of people under 18 are not allowed.

---

## 7. NASA data and resources used

| NASA dataset / resource | How TerraOrb uses it |
|---|---|
| **NASA POWER** (daily API, agroclimatology; `PRECTOTCORR`, `T2M_MAX`, `T2M_MIN`; based on MERRA-2) | 46 years of daily rain and temperature per tank: season onset, delays, totals, dry spells, heat, crop water need (Hargreaves-Samani evapotranspiration), climatology for the trip planner |
| **OPERA DSWx-HLS** (PO.DAAC) | 30 m tank water extent vs the same month in other years |
| **HLS Landsat / Sentinel-2** (`HLSL30`, `HLSS30`, LP DAAC) | Fallback tank water from NDWI |
| **NASA CMR** | Searching for scenes over each tank |
| **MODIS MOD13Q1 NDVI** (ORNL DAAC web service) | Crop greenness per tank |
| **MODIS MOD16A2GF ET and MOD11A2 LST** | Evapotranspiration and land surface temperature for farm cells |
| **SMAP L3 soil moisture** (NSIDC) | Measured topsoil moisture, 9 km |
| **GLDAS-2.1 Noah** (GES DISC) | Monthly soil moisture vs usual (model product) |
| **GPM IMERG** | Rain per tank alongside POWER, live rain map layer, validation of the trip models |
| **NASA FIRMS** (MODIS active fires) | Fires in the last 7 days on the officer and research pages |
| **GRACE-FO** (JPL mascons) | Country-level water storage change |
| **NASADEM** (LP DAAC) | Elevation for trip destinations |
| **NASA GIBS / Worldview layers** | Map layers: MODIS and VIIRS true colour, IMERG rain, NDVI, land surface temperature, MODIS flood (3-day), cloud fraction |
| **NASA Earthdata Login** | Access to the protected datasets |

---

## 8. Space Agency Partner data and other references

**Data and services (not NASA):**
- **ESA / Copernicus Sentinel-2:** the Sentinel-2 surface reflectance inside NASA HLS (`HLSS30`), and within OPERA DSWx-HLS.
- **Open-Meteo** forecast API (ECMWF, GFS and other models): the 16-day forecast, live weather, hourly rain and the seasonal outlook. Labelled "Not NASA data" in the app.
- **OpenStreetMap** contributors: tank outlines and names (ODbL). Map tiles via Leaflet.
- **FAO-56** (Allen et al., 1998): crop water need method and crop coefficients.
- **Sri Lanka Department of Agriculture** crop pages: crop durations and water needs (each value has its source and confidence in `pipeline/crops_data.json`).
- **NOAA ONI**: list of strong El Niño years (1982/83, 1997/98, 2015/16).

**Code libraries (open source):** Leaflet, Chart.js, pandas, numpy, xarray, rasterio, requests, FastAPI, SQLite, XGBoost, pytest.

**Images:** Google Flow and Canva AI (AI-generated, see section 6). All other icons are drawn in code.

**Hosting:** Cloudflare Pages (website), Hugging Face Spaces (API), GitHub (code).

---

## 9. Team name and team member names (for the demo)

- **Team name:** **[TODO]**
- **Members:** **[TODO: full names as on the Space Apps profiles]**
- **Challenge:** Field Shift: Adapting Farms with NASA Data
- **Local event:** **[TODO]**

---

## 10. Check that all external links are publicly accessible

Open each link in a **private / incognito window** before you submit:

- [ ] https://terraorb.pages.dev/web/ loads (checked 15 Nov 2026: loads)
- [ ] Each end loads: farmer, learn, officer, research, plan
- [ ] https://github.com/kavi-X-Debug/TerraOrb is **public**
- [ ] The demo deck or video link opens without signing in ("Anyone with the link")
- [ ] The demo PDF link (if shared) opens without signing in
- [ ] Optional: request a FortiGuard web filter classification for terraorb.pages.dev (category: Education or Web-based application; Company name: N/A)

**Deadline:** Sunday 15 November 2026, 11:59 p.m. local event time. Tick "Terms and Conditions" and "Confirm All Work is Original", then click **Submit for Judging**.
