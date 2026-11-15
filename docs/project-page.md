# TerraOrb — Space Apps 2026 project page (DRAFT)

> **Draft for the team to edit.** Every number below comes from `data/` or `docs/` in this
> repo (sources listed at the end). The demo tanks are **placeholders**: their locations,
> names and water levels are not real yet. Keep that clear on the submitted page.

**Challenge:** Field Shift: Adapting Farms with NASA Data
**Tagline:** Your season's direction, read from space.

## Summary

TerraOrb helps a farmer organisation in Sri Lanka's Dry Zone decide what to grow
next season. Pick your village tank (wewa) on a map and one screen shows three things,
each with the NASA dataset behind it: how much water the tank holds compared with
normal, how the start of the Yala and Maha rains has moved over the years, and a
green / amber / red signal with three plans for the 2027 Yala season: full paddy,
short-duration paddy with bethma (sharing part of the command area), or other field
crops such as mung bean, cowpea and black gram.

It is built for the kanna meeting, where the farmer organisation decides together how
much land to cultivate. A one-page summary card can be printed or shared to the
group's WhatsApp, and a Learn Mode with games and short lessons lets students and young
farmers learn how rain, tanks and crops fit together.

## How it works

1. **Rainfall (NASA POWER).** For each tank we download daily rainfall from 1981 and
   work out, for every Yala and Maha season, when the rains really started (the onset),
   how late or early that was against the 1991–2020 average, and the season's total
   against normal. The onset rule is simple and adjustable: the first day from 15 March
   (Yala) or 15 September (Maha) with at least 25 mm in 3 days, not followed by a dry
   spell (7 days with under 10 mm) within 30 days.
2. **Tank water (NASA OPERA DSWx-HLS, or HLS with NDWI).** We measure the water surface
   inside each tank's outline in every clear 30 m satellite scene since 2017, take the
   monthly median, and compare this month with the same month in other years (the tank
   index T).
3. **Rule engine.** Transparent thresholds, all in one file, turn the tank index, the rain
   index and the onset delay into a signal, checked in a fixed order: red, then amber,
   then green, otherwise amber. Every recommendation stores the values that triggered
   it, so the "Why?" button can show them with their source. Missing data never turns a
   signal green.
4. **El Niño outlook.** We count how many past strong El Niño years (Yala 1983, 1998,
   2016) had below-normal Yala rain at the tank, and always show it as a count, never a
   percentage, because three years are too few for a probability.
5. **Web app.** A static, mobile-first site (Leaflet, Chart.js) with a NASA GIBS
   satellite map. It reads only pre-computed JSON, so it is fast and works on a basic
   phone. Sinhala first, with English available.

### What the demo shows today

For **Demo tank 2** (placeholder location, 25 ha command area):

- Tank water: 6.9 ha on 20 October 2026, against a normal of 9.6 ha for October:
  **72 % of normal**. *(Demo water values: the satellite step has not run yet.)*
- The last season, Yala 2026, started **17 days late**; Maha 2025/26 started **27 days
  late**. *(Real NASA POWER rainfall at the placeholder point.)*
- Signal: **Amber**. Recommended plan: **short-duration paddy with bethma on 72 % of
  the command area**.
- El Niño line: **in 1 of 3** past strong El Niño years, Yala rain here was below normal.

## NASA data used

| Dataset | What we use it for | Status in the demo |
|---|---|---|
| **NASA POWER** daily point API, `PRECTOTCORR` (precipitation) and `T2M_MAX` (max temperature), agroclimatology community; source MERRA-2 | Season onset, onset delay, season totals, rain so far vs normal, El Niño analogue count | **Used.** 549 complete months, January 1981 to September 2026 |
| **OPERA DSWx-HLS** (`OPERA_L3_DSWX-HLS_V1`), via NASA Earthdata / PO.DAAC | Tank water area, preferred source | Code written and tested; **not yet run** (needs an Earthdata login) |
| **HLS** Landsat (`HLSL30`) and Sentinel-2 (`HLSS30`) v2.0 surface reflectance, via LP DAAC | Tank water area with NDWI = (Green − NIR) / (Green + NIR), fallback | Code written and tested; **not yet run** |
| **NASA GIBS** (`MODIS_Terra_CorrectedReflectance_TrueColor`) | Satellite base map | **Used** |
| **GPM IMERG** rain rate (`IMERG_Precipitation_Rate`, via NASA GIBS) | "Rain" layer on each tank's Weather page: the latest satellite estimate of rain that has fallen | **Used** (no login) |
| **VIIRS** true colour (`VIIRS_SNPP_CorrectedReflectance_TrueColor`, via NASA GIBS) | "Clouds" layer: yesterday's natural-colour satellite picture | **Used** (no login) |
| *Not NASA:* **Open-Meteo** weather-model forecast (ECMWF, GFS and others) | The 16-day forecast on the Weather page and the live "right now" weather (temperature, rain, humidity, wind) on every tank card, labelled "Not NASA data" in the app | **Used** |
| **NASA POWER** daily temperatures (maximum and minimum) | Evapotranspiration for the "What to sow now" crop advice (Hargreaves-Samani, FAO method) | **Used** |
| **NASA CMR** (Common Metadata Repository) | Finding DSWx and HLS scenes over each tank | **Used** for scene search |

Planned but not used yet: SMAP soil moisture, GPM IMERG rainfall values (the app shows IMERG as a map picture only), MODIS NDVI.

## How we checked it

`pipeline/validate.py` backtests our outlooks; results are in `data/validation.json` and
`docs/validation.md`.

- **El Niño outlook, leaving one year out:** across the demo tanks, **0 hits out of 3
  calls**, with 6 ties where no call was made. In the real rainfall, Yala 1998 and 2016
  were above normal at this point. This is one test repeated (all three demo tanks share a
  rainfall grid cell), and three years are too few for a reliable score.
- **Tank level model** (monthly tank extent from rain in the previous 1–3 months, fitted
  on 2017–2022, tested on 2023–2025): it did **not** beat the simple climatology baseline
  on any tank (mean error **17.4** vs **6.5** percentage points). This ran on demo water
  values, so it says nothing about real tanks yet, but the rule stands: if the model does
  not beat the baseline, we don't use it.

## How AI tools were used

- **Claude Code (Anthropic)** helped the team write the code (Python data pipeline, rule
  engine, tests and the web app), check NASA API responses, and draft documentation,
  including this page and the video script. The team set the requirements, reviewed the
  output and made the decisions.
- **No AI is used inside the product.** The signal comes from published thresholds in
  `pipeline/rules_config.json`, and every value on screen carries its NASA data source.
- **AI-generated images:** the hero picture, the crops banner and the monsoon-rain banner on the website were created with Canva's AI image tools (files in web/img/). They are decorative only; no data or advice comes from them.
- **AI-generated pictures and short animations in Learn Mode:** the game artwork and the 16 "Little Lessons" (rain, seasons, tanks, satellites, sharing, crops, forecasts, sowing, wildfires, landslides, El Niño, La Niña, carbon, global warming, the water cycle and glaciers) use pictures and 10-second animations made with Google Flow (files in web/img/). They teach general facts, contain no tank data, and the site says they are AI-made. No AI voice is used.

*(Team: check this against the Space Apps AI-use rules and add anything else you used.)*

## Limitations

- **Crop advice is a draft.** Crop water numbers come from FAO-56 and Department of Agriculture pages, each with a confidence level in pipeline/crops_data.json (black gram uses green gram values as an assumption). An Agricultural Instructor has not yet checked them. Backtest (rain-fed crops, 1981-2010 learned, 2011-2025 tested): the advice beat guessing, but much of that is simply knowing the wet and dry seasons, and the 16-day forecast part cannot be backtested because past forecasts were not saved. Paddy shows "cannot say yet" until tank water data exists.
- **Demo tanks.** The three tanks are placeholders, not real tanks; their water values are
  generated demo data, shown with a "Demo data" badge everywhere.
- **Tank water not yet measured.** The satellite water step needs an Earthdata login to run.
  OPERA DSWx-HLS also has no scenes over the area in 2021–2022.
- **Coarse rainfall.** A NASA POWER grid cell (about 50 km) covers all three demo tanks,
  so they get identical rainfall; village-to-village differences need finer data such as
  GPM IMERG.
- **Rainfall data issues found:**
  - NASA POWER's near-real-time GEOSIT source (from 1 October 2026) returned daily rainfall
    24 times too large; we skip it, so our rainfall currently ends on 30 September 2026.
  - POWER shows implausibly low rain for 1995–1997 at this point (Maha 1995/96: 117.2 mm
    against a 753.5 mm normal).
- **Onset rule needs tuning.** It finds a Yala onset in only 11 of 46 seasons (Maha: 35 of
  45), so Yala onset delays rest on few years.
- **Thresholds not yet validated** by the Department of Agriculture or an Agricultural
  Instructor. The tool is a decision aid only.
- **Sinhala text** still needs to be written; the app falls back to English for now.

## Next steps

1. Run the satellite water step for a real tank cascade in Anuradhapura District.
2. Have an Agricultural Instructor review the thresholds and the Sinhala wording.
3. Add GPM IMERG rainfall to tell neighbouring villages apart.
4. Re-run the validation on real water data, and publish the result whether or not the
   model beats the baseline.
5. Reach farmers without smartphones (SMS and voice), and extend to more tanks.

---

### Where each number comes from

| Number | File |
|---|---|
| 6.9 ha, 9.6 ha, 72 %, 25 ha, 20 Oct 2026 (demo) | `data/tank/demo-tank-2.json` → `water`, `data/tanks.json` |
| 17 days late (Yala 2026), 27 days late (Maha 2025/26), 117.2 mm / 753.5 mm (Maha 1995/96) | `data/tank/demo-tank-2.json` → `rain.seasons` |
| 11 of 46 Yala, 35 of 45 Maha onsets found | counted from `rain.seasons` |
| 549 months, Jan 1981 – Sep 2026 | `rain.monthly` |
| Amber, bethma on 72 %, 1 of 3 | `data/tank/demo-tank-2.json` → `result` |
| 0 of 3 calls, 6 ties; 17.4 vs 6.5 pp | `data/validation.json` → `summary` |
| 25 mm / 3 days, 7 days < 10 mm, 30 days, 15 Mar / 15 Sep, 1991–2020 | `pipeline/config.toml`, `docs/schema.md` |
| GEOSIT 24×, 30 Sep 2026; DSWx gap 2021–2022 | `docs/schema.md` (known data issues) |
