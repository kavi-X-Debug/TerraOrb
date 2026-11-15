# Monsoon Compass — guide for AI coding agents

Read this first. It is the hand-over from the previous agent (Claude Code) so work can continue in another tool.

## What this is
**Monsoon Compass** is a website for Sri Lankan Dry Zone farmer organisations, built for the NASA Space Apps Challenge 2026
("Field Shift: Adapting Farms with NASA Data"). A farmer picks a village tank (wewa) and sees:
tank water now vs usual, a green/amber/red signal with advice (full paddy / short paddy + bethma / other field crops),
rain and heat history, a 16-day forecast, what to sow now, a 12-week sowing calendar, and a shareable summary card.
Users are farmers with little technical knowledge: **plain words first, numbers only in Advanced view.**

## Rules from the product owner (always follow)
1. **Never invent data.** If a fetch fails, stop and tell the user. Placeholder values must be marked `"demo": true` and shown as "Demo data".
2. **Keep modules separate:** data pipeline (`pipeline/`), rule engine (`pipeline/rules.py`) and the web UI (`web/`) never import each other's internals. They share only the JSON files described in `docs/schema.md`.
3. **All UI text lives in `web/si.json` and `web/en.json`** (same keys in both). No text typed into HTML/JS. The Sinhala is a draft that needs native-speaker review.
4. **Every value shown in the UI carries its data source label.** Non-NASA sources (Open-Meteo forecast and live weather; OpenStreetMap tanks) are labelled "Not NASA data" / credited.
5. Write clear, commented code a student team can follow. Explain what you did after each step.
6. Stack: Python 3 (pandas, numpy, requests, xarray, rasterio) for data; plain HTML/CSS/JS + Leaflet + Chart.js for the site (no build step); GitHub Pages hosting; scheduled GitHub Actions. No paid services. **Exception (owner decision, Nov 2026): the farm-planning end ("My farm plan", `#/farm`) has a real backend** in `backend/` (FastAPI + SQLite, phone + one-time-code login). Everything else stays static. Design contract: `docs/farm-spec.md`. Run: `backend
un.ps1` (port 8000, `MC_DEV=1` returns the login code); tests: `pytest backend/tests`.
7. Stay a website/PWA (the backend serves only the farm planner's data). Do not propose native app or store packaging for now.

## Layout
```
pipeline/   Python data steps + tests (rain.py, forecast.py, water.py, rules.py, crops.py, seasonal.py, ndvi.py, advisory.py, validate.py, finish.py, tanks_from_osm.py)
            config.toml (all thresholds), rules_config.json, crops_data.json (crop facts, each with source + confidence)
data/       tanks.json, tank/<id>.json (one per tank), cells/<lat>_<lon>.json (daily climate per NASA grid cell), polygons/, validation.json
web/        index.html, css/{style,site,earth}.css, js/*.js (ES modules), si.json, en.json, sw.js (offline cache), manifest, icon
docs/       schema.md (JSON format, v1.7), deploy.md, project-page.md, validation.md, video-script.md
.github/workflows/  pages.yml (deploy), refresh.yml (daily data refresh)
```

## Ends (separate entry pages)
`web/index.html` is a chooser; the apps are generated pages `farmer.html`, `learn.html`, `officer.html`, `research.html`, `plan.html` (one app, `js/main.js`, chosen by `<body data-end>`). Edit `tools/ends/template.html` or `ENDS` in `tools/make_ends.py`, then run `.venv\Scripts\python tools\make_ends.py`. Routes added: `#/officer` (dashboard), `#/research`, `#/plan` (trip/event planner, live Open-Meteo, `data/climatology.json` from `pipeline/climatology.py`, run once, resumable), `#/farm` (farm planner, needs the backend). The trip planner also has kinds of trip (usual hours), wind / UV / feels-like warnings (draft levels), sunrise and sunset, a "what to bring" list, a two-place comparison and an .ics calendar file (`web/js/planner-extras.js`, pure functions tested with `node tools/test_planner_extras.mjs`). Extra UI strings: `web/strings/manifest.json` lists files merged by `i18n.js`. Farmer app URL: http://localhost:8010/web/farmer.html

## Run it
```powershell
# website (from the repo root; the site reads ../data)
.\.venv\Scripts\python.exe -m http.server 8010      # then open http://localhost:8010/web/
# tests
.\.venv\Scripts\python.exe -m pytest pipeline\tests
# data pipeline order
python pipeline\rain.py; python pipeline\forecast.py; python pipeline\water.py; python pipeline\rules.py; python pipeline\crops.py; python pipeline\seasonal.py; python pipeline\ndvi.py; python pipeline\advisory.py; python pipeline\finish.py
```
Windows laptop notes: Python 3.13 in `.venv`; Smart App Control blocks pandas 3.x and old rasterio (use pandas 2.2.3, rasterio 1.5.2). Use `PYTHONIOENCODING=utf-8` for console output with Sinhala.

## Current state (26 Oct 2026)
- 103 tanks (100 real from OpenStreetMap + 3 demo). Rain, heat, dry spells, El Niño, 16-day forecast, live weather, crop advice and the sowing calendar are done for all.
- Added 6 Nov 2026: weekly advice (`advisory`), NASA MODIS greenness (`ndvi`) and a seasonal rain outlook (`seasonal`, Open-Meteo, not NASA). `ndvi.py` is slow the first time (about 4.5 min per tank, resumable; values kept in `data/ndvi_cache/`), so check how many tanks have an `ndvi` section before relying on it. Thresholds for the advice are in `[advisory]` in `pipeline/config.toml` and are drafts for an Agricultural Instructor to review. The week page redoes its weather items live in the browser (live Open-Meteo forecast, thresholds from `advisory.settings`, plus the rain of the last 7 days) every 10 minutes; `weatherItems()` in `web/js/week.js` mirrors `build_items()` in `pipeline/advisory.py`, so change both together. The seasonal outlook is shown as a range next to the usual rain and never as "wetter/drier" (low skill, and the model is not comparable with NASA POWER).
- Live rain (9 Nov 2026): `web/js/nowcast.js` loads hourly rain (last 24 h, next 12 h, rain of the last minutes) from Open-Meteo in the browser (not NASA data, not radar) and shows it as a card on the plan pages and the Weather page, plus a heavy-rain banner under the tank title on every tank page. Reloaded every 5 minutes while open (and on coming back online); the satellite rain layer asks NASA GIBS for the newest picture every 10 minutes. Warning thresholds (`ALERT_HOUR_MM` 7.6, `ALERT_6H_MM` 30) are drafts. Text under `rn.*`. The saved data in `data/` still refreshes only when the GitHub workflow runs.
- Rewards (9 Nov 2026): one shared points system for all Learn Mode games, `web/js/rewards.js` (rules, badges, icons drawn in code) and `web/js/rewardspage.js` (`#/learn/rewards`: level, 19 badges, 16 lesson cards, printable certificate, reset), styles in `web/css/rewards.css`, text under `rw.*`. Saved only in the browser (`localStorage` key `mc-rewards`); no accounts, no leaderboard. Games call `reward(game, id, stars)` at their end screens (lessons, match, cloud, kids, chal, farmer) and `checkBadges()` when a farm crop reaches level 5. Drops: 5 per star, +5 first pass, +5 first perfect, +2 first reward of a day, +10 per new badge; replaying only pays for stars above the best. `LESSON_IDS` in `rewards.js` must stay in step with `LESSONS` in `lessons.js` (add a new lesson to both, and its card picture `<id>1.jpg`). Not built yet: My Farm decorations/seeds, guide outfits, weekly challenge.
- **Real tank water exists for only one tank** (Nuwara Wewa, `osm-way-30378745`). `water.py` works but must be run for all tanks (hours; results cached in `pipeline/cache`). Until then most tanks show "Water not checked yet" and paddy advice is "Cannot say yet".
- Backtests (`validate.py`): the rain-fed crop advice beats guessing (79% vs 57% right on 2011–2025 after learning from 1981–2010); the El Niño outlook does NOT beat its baseline and is shown only as a count.
- Design: "Earthy & warm" (css/earth.css over the website layout in css/site.css). Hash-routed pages (`#/learn` is a game hub with Flow artwork in `web/img/learn/`): `#/`, `#/tank/<id>/{plan,tank,crops,weather,week,card}` (`week` = "This week's advice", `web/js/week.js`, built from the `advisory` section, with WhatsApp share/copy; the `tank` charts page also has monthly rain, NASA MODIS greenness (NDVI) and the seasonal rain outlook, `web/js/outlook.js`), `#/calendar[/<id>]`, `#/how-it-works`, `#/learn/kids[/memory|sort|grow|season]` (Little Farmers' Games; `memory` = "Match the crops", its own file `matchgame.js` with Flow art in `web/img/match/`, 10 levels (6 to 24 cards, 12 crops; unlocked one by one, saved in localStorage `mc-match-level`), music via `gamesound.js`: tiny one-idea games for small children, one short sentence from a drop guide, optional read-aloud) and `#/learn/lessons[/<id>]` ("Little Lessons": 16 picture stories (water, seasons, cascade, sat, bethma, crops, forecast, sowing, fire, slide, elnino, lanina, carbon, warming = what is global warming, cycle = the big water cycle, ice = melting glaciers; a lesson with no mp4 for a picture just shows the still; `slide2.mp4`, the mudslide animation, is still missing: it was still rendering in Flow when the project was downloaded) with Flow art and a 10 s looping animation per picture in `web/img/lessons/` (jpg + mp4, 640 px, no audio) and a small game each; code `web/js/lessons.js`; general facts, no tank data; stars in localStorage `mc-lessons`) and `#/learn/cloud` ("Rain Cloud": slider-steering game, sea-warmth map is game art, not data) and `#/learn/play` ("Tank Farmer", a guide + tap-and-feed mini game for small children with Flow-made sprites in `web/img/farm/` and music from `cloudaudio.js` style "farm"; crop thirst comes from real data) and `#/learn/play/farm` ("My Farm": 8 crops, spend cups caught in Tank Farmer to plant and upgrade them to level 5, Clash-of-Clans style; upgrade cost = crop's real water need in cups; saved in localStorage `mc-farm`; code in `web/js/plantation.js`) and `#/learn/challenges[/quiz|ladder|week]` (practice games for students; the quiz is fixed facts, the other two read real tank data).
- Offline cache version is in `web/sw.js` (`SHELL_CACHE`): **bump it after any web change** and reload twice when testing (the service worker shows the previous version on first load).

## Ask Monsoon Compass (assistant)
`web/js/assistant.js` is a floating chat button on every page. It is rule-based, NOT an AI (owner decision, Nov 2026: stay rule-based, free and accurate). Every end has its own topic list with written answers (`web/js/assistant-kb.js` + `web/strings/assistant.{en,si}.json`, keys `ak.<topic>.{kw,q,a}`), matched with a spelling-tolerant ranking; when unsure it offers "Did you mean...?". Some answers fill in live numbers (tank counts, `data/validation.json`). Add a topic: write its three strings in both languages, add its id to `TOPICS` (and a page to `LINKS`), then run `node tools/test_assistant.mjs`. The older tank-question part: it matches keywords (lists in `si.json`/`en.json`, keys `assistant.kw.*`) and answers only from the tank JSON files, with the source and a link. Anything it does not understand gets a polite refusal. If you ever replace it with an LLM, keep it grounded in the data, cite sources, refuse everything else, keep the API key out of the page, and disclose the AI use.

## Known data issues (do not "fix" silently)
- NASA POWER's near-real-time GEOSIT rain from 1 Oct 2026 is about 24 times too large; `rain.py` skips it, so rain data ends 30 Sep 2026.
- POWER rain before 1997 looks too low at some places; cross-check before trusting trends.
- Several tanks share a POWER grid cell (about 50 km), so they have identical rain.

## Secrets
Earthdata login goes in environment variables only (`EARTHDATA_TOKEN`, or `EARTHDATA_USERNAME` + `EARTHDATA_PASSWORD`). Never write a token into a file, chat or commit. Tokens expire (about 60 days).
If `water.py` fails with "not recognized as being in a supported file format", run `pipeline/earthdata_check.py`.

## Next tasks (suggested order)
1. Run `water.py` for all tanks (overnight), then `rules.py`, `crops.py`, `finish.py`, `validate.py`; check results look sensible.
2. Dry-spell warning banner from the 16-day forecast.
3. Water-sharing (bethma) planner; compare tanks; tank water trend with "weeks of water left" (only where satellite data is good).
4. Read advice aloud in Sinhala (browser speech; test on common phones first); WhatsApp text share; "Was this right?" feedback link.
5. "How it works" page; an expert review page listing every crop number with its source and confidence.
6. Push to GitHub and enable Pages + the daily refresh (see `docs/deploy.md`); add Earthdata secrets; replace demo tanks with real cascade data.
7. Native-speaker review of all Sinhala text; Agricultural Instructor review of `crops_data.json` and thresholds in `config.toml`.
