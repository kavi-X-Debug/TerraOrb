# User guide for every end (contract for the guide task)

Each end's home page gets a detailed "How to use" guide: one card per service with what it does, numbered steps, a tip, a picture and an optional short video.
Component: `web/js/guide.js` (built separately). Text lives in `web/strings/guide-<end>.en.json` and `guide-<end>.si.json` (same keys; Sinhala is a draft).
Pictures `web/img/guide/<end>-<section>.jpg` (16:10, 640x400) and optional videos `web/img/guide/<end>-<section>.mp4` (a missing file is fine).

## Sections (fixed ids, in this order)
| end | sections |
|---|---|
| farmer | tank, advice, week, calendar, weather, farm |
| learn | lessons, kids, cloud, play, challenges, rewards |
| officer | signin, dashboard, filters, report, national |
| research | method, tests, files, datasets |
| plan | ask, explore, trips, compare, copilot, tools |

## String keys (write ALL for every section of the end; `{e}` = end, `{s}` = section id)
- `gd.{e}.title` : guide heading (e.g. "How to use TerraOrb for Farmers")
- `gd.{e}.intro` : 2 to 3 sentences: who it is for and the one thing to do first
- `gd.{e}.sections` : the section ids, comma separated, exactly as in the table
- `gd.{e}.{s}.name` : service name (2 to 4 words)
- `gd.{e}.{s}.what` : what it gives you, 1 to 2 sentences, plain words (users are farmers and students with little technical knowledge)
- `gd.{e}.{s}.step1` ... `gd.{e}.{s}.step4` : 3 or 4 short action steps (the real buttons and menu names of the site; imperative)
- `gd.{e}.{s}.tip` : one practical tip or honest limit (where relevant say the data source and that forecasts are not certain)
- `gd.{e}.{s}.go` : label of the button that opens the feature (e.g. "Open the sowing calendar")
- `gd.{e}.{s}.route` : the hash route the button opens (e.g. `#/calendar`); must exist in that end's app

## Rules
1. Describe only what the site really does (read the code and the strings in `web/si.json`, `web/en.json`, `web/strings/*.json` and the screens). Never invent a feature, number or data source.
2. Plain words first; numbers only where the feature shows them. Where data is shown, name the source (NASA POWER, MODIS, GPM IMERG, SMAP, GLDAS, OPERA/HLS, GIBS; Open-Meteo and OpenStreetMap are NOT NASA data and must be labelled so).
3. English and Sinhala files must have identical keys. Sinhala is a draft that needs native review.
4. Valid JSON, UTF-8, one key per line, 1-space indent (like `web/strings/farm.en.json`).
5. Do not edit any other file.
