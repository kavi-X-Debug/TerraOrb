# Monsoon Compass — JSON schema (v1.8)

*1.8 (6 Nov 2026): `ndvi`, `seasonal` and `advisory` sections (§3.10–3.12); `data/ndvi_cache/<id>.json` (§3.13).*

*1.7 (25 Oct 2026): `crops` section (what to sow now, §3.8); `data/cells/<lat>_<lon>.json` climate files (§3.9).*

*1.6 (25 Oct 2026): `forecast` section (16-day rain forecast, §3.7).*

*1.5 (25 Oct 2026): 100 real tanks from OpenStreetMap (`pipeline/tanks_from_osm.py`); `name_si` and `cascade` may be null; `outline_area_ha`, `tanks_source`, `rain.power_cell`.*

*1.4 (25 Oct 2026): dry spells and hot days per season (`rain.seasons[]`, `rain.extremes`).*

*1.3 (25 Oct 2026): `rain.monthly`; new file `data/validation.json` (§5); `learn` section (§3.6).*

*1.2 (25 Oct 2026): `result.scenarios[].recommended`, `reasons[].total` and `reasons[].kind`,
reason values in whole percent, `inputs.onset_season`.*

*1.1 (25 Oct 2026): `water.series` is monthly (median), with new `series[].scenes` and
`water.polygon`.*

This file is the **contract** between the three parts of Monsoon Compass:

| Part | Folder | Writes | Reads |
|---|---|---|---|
| Data pipeline | `pipeline/fetch/` | `data/tanks.json`, and `water`, `rain`, `soil`, `elnino` in `data/tank/<id>.json` | NASA APIs and files |
| Rule engine | `pipeline/rules/` | `result` in `data/tank/<id>.json` | `data/tank/<id>.json` |
| Web app | `web/` | nothing | `data/tanks.json`, `data/tank/<id>.json`, `web/si.json`, `web/en.json` |

None of these import each other's code. **To change the format: edit this file first,
bump `schema_version`, tell the team, then change the code.**

---

## 1. Conventions used everywhere

| Topic | Rule |
|---|---|
| Encoding | UTF-8 JSON (Sinhala text is stored as-is, not escaped). |
| Dates | `"YYYY-MM-DD"`, e.g. `"2026-11-14"`. |
| Timestamps | ISO 8601 with Sri Lanka offset, e.g. `"2026-11-14T09:30:00+05:30"`. |
| Units | Area in **hectares** (`_ha`), rainfall in **millimetres** (`_mm`), time in **days** (`_days`). The unit is in the field name. |
| Ratios | Indices `T`, `R`, `S` are plain ratios (1.0 = normal), rounded to 2 decimals. The UI turns them into % if it wants. |
| Shares | `share_of_command_area` is a fraction from 0 to 1 (0.6 = 60 %). |
| Missing values | `null`. **Never** `0`, `-999` or a guess. The UI shows "No data". |
| Demo flag | `"demo": true` on anything that is a placeholder, not real data. The UI shows a **Demo data** badge for it. Real pipeline output writes `"demo": false`. |
| Source label | `"source"` is a short, human-readable string shown next to the value, e.g. `"NASA POWER (PRECTOTCORR)"`. Demo placeholders use `"Demo data — not real"`. |
| Text in data | Data files contain **keys** into `web/si.json` / `web/en.json` (fields ending in `_key`), never UI sentences. Exception: tank names (`name_si`, `name_en`). |

### Seasons

| Season | Months | Label format | Example |
|---|---|---|---|
| Maha | September/October – March (crosses a year) | `"Maha YYYY/YY"` | `"Maha 2015/16"` |
| Yala | April – August | `"Yala YYYY"` | `"Yala 2016"` |

Use exactly these spellings: a space, a 4-digit year, and for Maha a slash plus the
2-digit next year.

---

## 2. `data/tanks.json` — the list of tanks

Used by the map to place markers. Small, loaded once.

```json
{
  "schema_version": "1.0",
  "generated": "2026-10-25T01:00:00+05:30",
  "tanks": [
    {
      "id": "demo-tank-1",
      "name_si": "…",
      "name_en": "…",
      "lat": 8.35,
      "lon": 80.38,
      "cascade": "demo-cascade",
      "command_area_ha": 40,
      "demo": true,
      "source": "Demo data — not real"
    }
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `schema_version` | string | yes | Version of this document, `"1.0"`. |
| `generated` | timestamp | yes | When the file was written. |
| `tanks` | array | yes | One object per tank, in display order (upstream → downstream if known). |
| `tanks[].id` | string | yes | Unique id. Lower-case letters, digits and `-` only (`^[a-z0-9-]+$`). Also the file name: `data/tank/<id>.json`. Never changes once published. |
| `tanks[].name_si` | string or null | yes | Tank name in Sinhala. `null` if not known yet (OpenStreetMap rarely has it); the app then shows `name_en`. |
| `tanks[].name_en` | string | yes | Tank name in English. |
| `tanks[].lat` | number | yes | Latitude, decimal degrees (WGS84), approx. tank centre. |
| `tanks[].lon` | number | yes | Longitude, decimal degrees (WGS84). |
| `tanks[].cascade` | string or null | yes | Id of the cascade the tank belongs to. `null` if not known (not in OpenStreetMap). |
| `tanks[].outline_area_ha` | number | no | Area of the tank's mapped outline (`data/polygons/<id>.geojson`), i.e. the full tank. *(1.5)* |
| `tanks[].command_area_ha` | number or null | yes | Irrigated command area in hectares. `null` if unknown. |
| `tanks[].demo` | boolean | yes | `true` if this tank is a placeholder. |
| `tanks[].source` | string | yes | Where the name, location and command area come from. |

> The top level is an object with a `tanks` list (not a bare list), so it can carry
> `schema_version` and `generated` too.

---

## 3. `data/tank/<id>.json` — everything about one tank

```json
{
  "schema_version": "1.0",
  "id": "demo-tank-1",
  "generated": "…",
  "demo": true,
  "water":  { … },
  "rain":   { … },
  "soil":   { … } or null,
  "elnino": { … },
  "result": { … }
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `schema_version` | string | yes | `"1.0"` |
| `id` | string | yes | Same as in `tanks.json` and the file name. |
| `generated` | timestamp | yes | When the pipeline last wrote this file. |
| `demo` | boolean | yes | `true` if **any** section below has `"demo": true`. Lets the UI show one badge at the top. |
| `water` | object | yes | Tank water extent (§3.1). Written by the pipeline. |
| `rain` | object | yes | Rainfall and onset (§3.2). Written by the pipeline. |
| `soil` | object or null | no | Catchment soil moisture (§3.3). `null` or missing if not computed. |
| `elnino` | object | yes | El Niño analogue outlook (§3.4). Written by the pipeline. |
| `result` | object or null | yes | Signal and scenarios (§3.5). Written by the rule engine. `null` until the rule engine has run. |

Every section has its own `source` and `demo`, because different sections can come
from different datasets, and one can be real while another is still a placeholder.

### 3.1 `water` — tank water extent

```json
"water": {
  "series": [
    { "date": "2024-08-01", "extent_ha": 31.5, "scenes": 3 },
    { "date": "2024-09-01", "extent_ha": null, "scenes": 0 }
  ],
  "current_date": "2026-10-20",
  "current_extent_ha": 18.2,
  "normal_extent_ha": 27.0,
  "normal_period": "2017–2025 (7 years with data)",
  "T": 0.67,
  "polygon": "circle, radius 600 m around the tank point",
  "source": "NASA OPERA DSWx-HLS",
  "demo": false
}
```
*(Values are illustrative only, to show the shape.)*

Written by `pipeline/water.py` (settings: `[water]` in `pipeline/config.toml`).

| Field | Type | Meaning |
|---|---|---|
| `series` | array | **Monthly** water extent, oldest first, every month from the first to the last month with data. |
| `series[].date` | date | First day of the month (`"YYYY-MM-01"`). |
| `series[].extent_ha` | number or null | **Median** water area of that month's usable scenes. `null` if no scene was clear enough (cloud over the tank). |
| `series[].scenes` | integer | Number of usable scenes behind the median. *(Added in 1.1.)* |
| `current_date` | date | Date of the latest usable scene. |
| `current_extent_ha` | number or null | Median for the latest month with data. |
| `normal_extent_ha` | number or null | Mean of the monthly medians for **the same calendar month in all other years** (the current year is left out so "now" isn't compared with itself). |
| `normal_period` | string | First–last year used for the normal, and how many years had data. |
| `T` | number or null | **Tank index** = `current_extent_ha ÷ normal_extent_ha`, 2 decimals. `null` if either is null or the normal is 0. |
| `polygon` | string | What area was measured: a polygon file in `data/polygons/`, or a circle around the tank point. *(Added in 1.1.)* |
| `source` | string | `"NASA OPERA DSWx-HLS"` (preferred) or `"NASA HLS (NDWI)"` (fallback). One tank never mixes the two. |
| `demo` | boolean | Placeholder flag. |

How a scene is used: water pixels inside the polygon × 900 m² (DSWx classes 1 open and
2 partial water; or HLS NDWI > 0). A scene is skipped if 30 % or more of the polygon is
cloud, shadow or missing. DSWx is used if it gives at least 24 months with data,
otherwise HLS NDWI.

> ⚠ Known coverage gap: OPERA DSWx-HLS has **no scenes in 2021–2022** and few in 2020 and
> 2025 over Anuradhapura (checked 25 Oct 2026). Its normals therefore rest on fewer years
> than HLS, which is continuous from 2013.

### 3.2 `rain` — rainfall and season onset

```json
"rain": {
  "seasons": [
    {
      "season": "Maha 2015/16",
      "onset_date": "2015-10-21",
      "onset_delay_days": 6,
      "total_mm": 812.4,
      "normal_mm": 905.0
    }
  ],
  "normal_period": "1995–2024",
  "current": {
    "season": "Maha 2026/27",
    "as_of": "2026-11-13",
    "rain_so_far_mm": 210.5,
    "normal_so_far_mm": 265.0,
    "R": 0.79
  },
  "source": "NASA POWER (PRECTOTCORR)",
  "demo": false
}
```
*(Values are illustrative only, to show the shape.)*

| Field | Type | Meaning |
|---|---|---|
| `seasons` | array | One entry per past season (both Yala and Maha), oldest first. |
| `seasons[].season` | string | Season label (see §1 Seasons). |
| `seasons[].onset_date` | date or null | Date the season's rains started, by the onset rule in `pipeline/config.toml` (first day from 15 Sep / 15 Mar with ≥ 25 mm in 3 days and no 7-day spell < 10 mm in the next 30 days). `null` if no onset was detected. |
| `seasons[].onset_delay_days` | integer or null | `onset_date` minus the **long-term mean onset** for that season type (Yala or Maha) over `normal_period`. **Positive = late, negative = early.** |
| `seasons[].total_mm` | number or null | Total rainfall in the season. |
| `seasons[].normal_mm` | number or null | Long-term mean total for that season type over `normal_period`. |
| `normal_period` | string | Years used for all "normal" and "long-term mean" values. |
| `current` | object or null | The season in progress. `null` outside a season. |
| `current.season` | string | Label of the current season. |
| `current.as_of` | date | Last day of rainfall data included. |
| `current.rain_so_far_mm` | number or null | Rain from season start to `as_of`. |
| `current.normal_so_far_mm` | number or null | Long-term mean rain over the same part of the season. |
| `current.R` | number or null | **Rain index** = `rain_so_far_mm ÷ normal_so_far_mm`, 2 decimals. |
| `seasons[].longest_dry_spell_days` | integer or null | Longest run of days with less than `extremes.dry_day_mm` rain in the season's total period. *(1.4)* |
| `seasons[].hot_days` | integer or null | Days with maximum temperature ≥ `extremes.hot_day_c` in the total period (NASA POWER `T2M_MAX`). *(1.4)* |
| `seasons[].max_temp_c` | number or null | Hottest day's maximum temperature in the total period. *(1.4)* |
| `extremes` | object | `dry_day_mm`, `hot_day_c` (thresholds from `config.toml`), `normals.{Yala,Maha}.{longest_dry_spell_days, hot_days}` over `normal_period`, and `temp_source`. *(1.4)* |
| `power_cell` | [lat, lon] | Centre of the NASA POWER grid cell the rain comes from. Tanks in the same cell share identical rainfall. *(1.5)* |
| `monthly` | array | Total rain per calendar month, oldest first: `{ "month": "YYYY-MM", "total_mm": number or null }`. Only finished months; `null` if any day is missing. Used by `validate.py`. *(Added in 1.3.)* |
| `source` | string | e.g. `"NASA POWER (PRECTOTCORR)"`. |
| `demo` | boolean | Placeholder flag. |

> ⚠ Known data issues (found 25 Oct 2026):
> - NASA POWER reports implausibly low rainfall for 1995–1997 at Anuradhapura (Maha 1995/96:
>   117 mm, 16 % of normal). Check early years against another source before relying on
>   `normal_period`, and say what was done in the methodology page.
> - POWER's near-real-time source (GEOSIT, from 1 Oct 2026) returned daily rainfall 24× too
>   large. `rain.py` skips GEOSIT (`skip_sources` in `config.toml`), so data currently ends
>   on 30 Sep 2026 and `current` is `null` until MERRA-2 data for October arrives.
> - The 3-day ≥ 25 mm onset rule finds a Yala onset in only 11 of 46 seasons with POWER
>   data, so Yala `onset_delay_days` rest on few years. Tune `[rain.onset]` before using them.

### 3.3 `soil` — catchment soil moisture (optional)

```json
"soil": {
  "as_of": "2026-11-10",
  "percentile": 35,
  "S": 0.35,
  "source": "NASA SMAP L4",
  "demo": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `as_of` | date | Date of the soil moisture value. |
| `percentile` | number or null | Where today's catchment soil moisture sits in its history for this time of year, 0–100. |
| `S` | number or null | **Soil index** = `percentile ÷ 100`, so 0–1. |
| `source` | string | e.g. `"NASA SMAP L4"`. |
| `demo` | boolean | Placeholder flag. |

The whole `soil` section may be `null` or missing (it's a *Should*, not MVP).
The rule engine must work without it.

### 3.4 `elnino` — El Niño analogue outlook

```json
"elnino": {
  "analog_seasons": ["Yala 1983", "Yala 1998", "Yala 2016"],
  "below_normal_count": 2,
  "total": 3,
  "source": "NASA POWER (PRECTOTCORR)",
  "demo": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `analog_seasons` | array of strings | Seasons that followed past strong El Niño years. |
| `below_normal_count` | integer | How many of those seasons had `total_mm` below `normal_mm` at this tank. |
| `total` | integer | Number of analogue seasons **with data** (seasons with `null` totals aren't counted). |
| `source` | string | Dataset used. |
| `demo` | boolean | Placeholder flag. |

Shown as a count ("2 of 3"), never as a percentage: three events are too few for a probability.
"Below normal" here means `total_mm < normal_mm`; the logic lead may tighten it (e.g. below 90 %),
in which case this definition is updated here.

### 3.5 `result` — signal, scenarios and reasons (rule engine output)

```json
"result": {
  "signal": "amber",
  "recommended_scenario": "short_paddy_bethma",
  "scenarios": [
    { "id": "full_paddy",         "title_key": "scenario.full_paddy.title",         "crops": ["paddy"],                             "share_of_command_area": 1.0,  "recommended": false },
    { "id": "short_paddy_bethma", "title_key": "scenario.short_paddy_bethma.title", "crops": ["paddy_short"],                       "share_of_command_area": 0.67, "recommended": true },
    { "id": "ofc",                "title_key": "scenario.ofc.title",                "crops": ["mung_bean", "cowpea", "black_gram"], "share_of_command_area": 1.0,  "recommended": false }
  ],
  "reasons": [
    { "text_key": "reason.tank_below_normal", "value": 67, "unit": "percent", "source": "NASA HLS (NDWI)",  "kind": "rule" },
    { "text_key": "reason.onset_late",        "value": 16, "unit": "days",    "source": "NASA POWER (…)",  "kind": "rule" },
    { "text_key": "reason.elnino", "value": 2, "total": 3, "unit": "count",   "source": "NASA POWER (…)",  "kind": "outlook" }
  ],
  "inputs": { "T": 0.67, "R": 0.79, "S": null, "onset_delay_days": 16, "onset_season": "Yala 2026" },
  "rules_version": "draft-1",
  "updated": "2026-11-14T10:00:00+05:30",
  "demo": false
}
```
*(Values are illustrative only, to show the shape.)*

| Field | Type | Meaning |
|---|---|---|
| `signal` | `"green"` \| `"amber"` \| `"red"` \| null | Water sufficiency signal. `null` if there isn't enough data to decide; the UI then says so instead of guessing. |
| `recommended_scenario` | string or null | `id` of the scenario that matches `signal`. *(Added beyond the original brief so the UI knows which card to highlight.)* |
| `scenarios` | array | Always the same three scenarios, in this order. |
| `scenarios[].id` | `"full_paddy"` \| `"short_paddy_bethma"` \| `"ofc"` | Fixed ids. |
| `scenarios[].title_key` | string | Key in `si.json`/`en.json` for the scenario title. |
| `scenarios[].crops` | array of strings | Crop keys; the UI shows `crop.<key>` from the strings file. Allowed: `paddy`, `paddy_short`, `mung_bean`, `cowpea`, `black_gram`. |
| `scenarios[].share_of_command_area` | number or null | Fraction of the command area to cultivate (0–1). Bethma: `round(T × 100) / 100`, at most 1; `null` without T. Others: 1.0. |
| `scenarios[].recommended` | boolean | `true` on exactly the scenario matching `signal` (none if `signal` is null). *(Added in 1.2.)* |
| `reasons` | array | Feeds the "Why?" panel: one entry per rule condition that fired, then the El Niño outlook line. |
| `reasons[].text_key` | string | Key in the strings file. Its text may contain `{value}`, `{total}`, `{source}`. |
| `reasons[].value` | number or null | The number behind the reason (e.g. 35 for "35 % of normal"). |
| `reasons[].total` | integer | Only on `reason.elnino`: number of analogue years with data. *(Added in 1.2.)* |
| `reasons[].unit` | `"percent"` \| `"days"` \| `"count"` \| null | How to show `value`. T and R are stored as whole percent. The El Niño line is a count ("2 of 3"), **never a percentage**. |
| `reasons[].source` | string or null | Dataset behind the value (copied from the section it came from). |
| `reasons[].kind` | `"rule"` \| `"outlook"` | `rule` = it decided the signal; `outlook` = context only (El Niño). *(Added in 1.2.)* |
| `inputs` | object | `T`, `R`, `S`, `onset_delay_days` and `onset_season` as the rules saw them, so anyone can re-check the decision. |
| `rules_version` | string | Which threshold set was used, e.g. `"draft-1"`. Bump it whenever thresholds change. |
| `updated` | timestamp | When the rule engine wrote this result. |
| `demo` | boolean | `true` if any input was demo data. |

Written by `pipeline/rules.py`; thresholds in `pipeline/rules_config.json`. Checked in
this order, first match wins:

| Signal | Condition | Reasons stored |
|---|---|---|
| red | T < 0.6, or (T < 0.75 and R < 0.75) | `tank_far_below_normal` and/or `tank_below_normal` + `rain_below_normal` |
| amber | T < 0.9, or onset delay > 14 days | `tank_below_normal`, `onset_late` |
| green | T ≥ 0.9 and R ≥ 0.9 | `tank_normal`, `rain_normal` |
| amber | otherwise | what kept it from green: `rain_below_normal` or `rain_unknown` |
| null | T is missing | `no_tank_data` |

A missing value never makes a rule fire, so missing rain can't give green.
`onset_delay_days` is the **latest season** in `rain.seasons` (rain.py has no onset for the
season in progress yet). `S` is recorded in `inputs` but not used in the signal.

Possible reason keys: `reason.tank_far_below_normal`, `tank_below_normal`, `tank_normal`,
`rain_below_normal`, `rain_normal`, `rain_unknown`, `onset_late`, `no_tank_data`, `elnino`.

---

### 3.6 `learn` — past seasons for Learn Mode (rule engine output)

Written by `pipeline/rules.py` from the tank's own `water` and `rain` sections; seasons are
listed in `rules_config.json` → `learn.seasons`. Seasons without enough data are left out.

```json
"learn": {
  "cases": [{
    "season": "Yala 2017",
    "before": { "month": "2017-03", "extent_ha": 12.2, "normal_ha": 18.4, "T": 0.66,
                "prev_season": "Maha 2016/17", "rain_mm": 504.7, "normal_mm": 753.5, "R": 0.67, "onset_delay_days": 14 },
    "after":  { "months_with_data": 5, "extent_ha": 5.3, "normal_ha": 7.3, "T": 0.72,
                "rain_mm": 309.5, "normal_mm": 290.6, "R": 1.07, "onset_delay_days": null },
    "signal_before": "red", "advice_before": "ofc",
    "signal_after": "amber", "best_scenario": "short_paddy_bethma",
    "outcomes": { "full_paddy": "too_risky", "short_paddy_bethma": "right", "ofc": "too_careful" },
    "sources": { "water": "…", "rain": "…" },
    "demo": true
  }],
  "rules_version": "draft-1", "updated": "…", "demo": true
}
```

| Field | Meaning |
|---|---|
| `before` | What was known at the kanna meeting: the tank in `month` (the month before the season) vs the mean for that month in **other** years (`T`), and the previous season's rain (`R`, onset delay) |
| `after` | What happened: mean tank extent over the season's months vs normal (`T`), the season's rain (`R`) |
| `signal_before` / `advice_before` | The signal rules applied to `before`: what Monsoon Compass would have said |
| `signal_after` / `best_scenario` | The same rules applied to `after`: the plan that fitted in hindsight |
| `outcomes` | For each plan: `"right"`, `"too_risky"` (needs more water than the season had) or `"too_careful"`. Based on the rules, **not** on recorded harvests; the UI says so |

### 3.7 `forecast` — 16-day rain forecast (pipeline/forecast.py)

Written daily by `pipeline/forecast.py`. The web app also fetches the same forecast live
when online and shows this saved copy only when it can't.

| Field | Meaning |
|---|---|
| `issued` | When this copy was saved (timestamp) |
| `days[]` | `{date, rain_mm, rain_chance (%), tmax_c}` for each of the next 16 days; `null` where the model gives no value |
| `rain_days`, `total_mm`, `wettest_day`, `wettest_mm` | Summary: days with at least `rain_day_mm`, total rain, the wettest day |
| `rain_day_mm` | Threshold for a rain day (1 mm, from `config.toml` `[forecast]`) |
| `source`, `credit` | "Open-Meteo (ECMWF, GFS and other weather models)"; "Weather data by Open-Meteo.com (CC BY 4.0)". **Not NASA data, and not our own model** |
| `demo` | `true` for the demo tanks (placeholder locations) |

### 3.8 `crops` — what to sow now (pipeline/crops.py)

Written daily by `pipeline/crops.py` after `rules.py`. Crop numbers come from `pipeline/crops_data.json`, each with a source and a confidence level.

| Field | Meaning |
|---|---|
| `as_of`, `sow_date` | Date the advice was made, and the sowing date it is for (today) |
| `items[]` | One per crop, best first: `id` (`paddy`, `paddy_short`, `mung_bean`, `cowpea`, `black_gram`), `kind` (`paddy` or `ofc`), `duration_days`, `need_mm` (water the crop needs over its life), `rain_mm` (useful rain expected over that time), `ratio` (rain / need), `rating` (`good`, `possible`, `not_now`, `unknown`) |
| `items[].usually_irrigated`, `confidence` | Whether the crop is usually irrigated (so a rain-only rating is only a guide), and how sure we are of its growing time (`high`, `medium` or `assumption`; see `pipeline/crops_data.json`) |
| `items[].past_years_ok`, `past_years` | Pulses: in how many of the past years the rain was enough for a sowing on this date |
| `items[].tank_mm`, `tank_m3_per_ha` | Paddy: the water the tank must supply after the rain's share |
| `recommended` | Up to three crop ids rated `good` |
| `calendar[]` | 12 weekly entries (`calendar_weeks` in config.toml) `{start, items[]}`; each item `{id, rating, ratio, past_years_ok, past_years}` for the rain-fed crops only (paddy is left out: the tank's future water is unknown). Uses the forecast for days it covers, the usual rain after |
| `forecast_16_mm`, `usual_16_mm` | Rain expected in the next 16 days (Open-Meteo, not NASA), and the usual rain for the same days (NASA POWER) |
| `signal` | The tank water signal paddy follows (`green`, `amber`, `red`, or `null` when there is no tank water data; paddy is then `unknown`) |
| `settings` | Thresholds used: `good_ratio`, `possible_ratio`, `adequate_ratio`, `good_reliability` |
| `sources`, `updated`, `demo` | Data sources, timestamp, demo flag |

### 3.9 `data/cells/<lat>_<lon>.json` — daily climate of one NASA POWER grid cell

Written by `pipeline/rain.py`. Tanks in the same 0.5° x 0.625° cell share one file. `rain_tenths` and `et0_tenths` are daily values in tenths of a millimetre from `start`; `et0_method` says how evapotranspiration was worked out (Hargreaves-Samani from NASA POWER maximum and minimum temperature). Used by `crops.py` and its backtest.

### 3.10 `ndvi` — greenness of the land around the tank (pipeline/ndvi.py, optional)

NASA MODIS Terra NDVI (MOD13Q1, 250 m, one composite every 16 days) from the ORNL DAAC MODIS web service. One value = the **median of the land pixels** (NDVI of at least 0.1) within `radius_km` of the tank centre; `null` when fewer than 12 land pixels remain. The section is left out when a tank has no real value.

| Field | Meaning |
|---|---|
| `series[]` | `{date, ndvi}`, the last two years, one per 16 days (`ndvi` may be `null`) |
| `normal[]` | `{doy, mean, min, max, years}` for each 16-day slot of the year (day of year 1, 17, 33 ...), from the earlier years only; a slot with fewer than 3 years is left out |
| `normal_years` | years the usual values come from, e.g. `"2019–2025"` |
| `current` | `{date, ndvi, usual, diff, state}`, the newest value; `state` is `above`, `about` or `below` (within 0.05 = about), or `null` when there is no usual to compare with |
| `radius_km`, `source`, `credit`, `demo`, `issued` | as elsewhere |

### 3.11 `seasonal` — rain outlook for the coming months (pipeline/seasonal.py)

From the ECMWF long-range ensemble (51 members) through the Open-Meteo seasonal API. **Not NASA data.** Only whole calendar months. `months[]` = `{month "YYYY-MM", low_mm, middle_mm, high_mm, usual_mm, members}` where low and high are the 10th and 90th percentile of the members (`range_percent`) and `usual_mm` is the NASA POWER average for that month over `normal_period` (`null` if fewer than 20 years). The model and POWER are measured differently, so the UI never says "wetter" or "drier" from them.

### 3.12 `advisory` — the weekly advice (pipeline/advisory.py)

Built only from the `result`, `forecast`, `crops` and `ndvi` sections of the same file; nothing is fetched. `items[]` = `{id, kind (do|watch|info), key, values, dates?, crops?}`. `key` is a text key in `web/si.json` / `web/en.json` (`advisory.*`), `values` fill its `{placeholders}`, `dates` are forecast dates, `crops` are crop ids (`crop.<id>`). When fewer than 4 days of the saved forecast are left, the weather items are replaced by `advisory.forecast_old`. Thresholds: `[advisory]` in `pipeline/config.toml` (draft).

### 3.13 `data/ndvi_cache/<id>.json` — downloaded NDVI values

`{ "YYYY-MM-DD": value or null }` for every composite date downloaded so far. Kept in the repo so the daily refresh only asks NASA for the new dates. Written by `pipeline/ndvi.py`; not read by the web app.

## 4. `web/si.json` and `web/en.json` — UI text

- Flat objects: `"key": "text"`. Keys use dots for grouping, e.g. `"signal.green.title"`.
- Both files have **the same keys**.
- `si.json` values may be `""` while the wording is being written; the UI then falls back
  to `en.json`.
- `{name}` placeholders (e.g. `{value}`, `{count}`, `{total}`) are filled by the UI.
- Keys starting with `_` are translator notes, not shown in the UI.
- Every `title_key`, `text_key` and `crop.<key>` used in data files **must** exist here.

---

## 5. `data/validation.json` — backtest results

Written by `pipeline/validate.py` (settings: `[validate]` in `pipeline/config.toml`), together
with the readable report `docs/validation.md`. Not read by the web app (yet).

| Field | Meaning |
|---|---|
| `generated`, `demo`, `settings` | When, whether any demo data was involved, and the fixed train/test settings |
| `tanks[].elnino.rows[]` | One per analogue season left out: `normal_mm_without_this_year`, `others_below` of `others_total`, `call` (`"below"`, `"not_below"`, `null` = tie), `actual`, `hit` |
| `tanks[].elnino.hits` / `calls` / `no_calls` | Score: hits out of calls; ties are not calls |
| `tanks[].tank_model` | `status` (`"ok"` or `"not_enough_data"` + `reason`), `n_train`, `n_test`, `capacity_ha` (largest training month), `coefficients`, `mae_model_pp`, `mae_baseline_pp`, `beats_baseline`, `verdict` |
| `summary` | Totals over tanks, and one plain-language verdict for the model |
| `notes` | e.g. tanks sharing a rainfall grid cell (same El Niño test counted twice) |

---

## 6. Changing the schema

1. Edit this file and bump `schema_version` (1.0 → 1.1 for added fields; 2.0 for renamed/removed fields).
2. Post the change in the team chat.
3. Update the pipeline, rule engine and web app.
