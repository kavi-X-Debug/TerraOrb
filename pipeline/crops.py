"""
Which crops suit sowing now, given the rain they need?
======================================================

    .venv\\Scripts\\python pipeline\\crops.py            (run from the repo root, after rain.py,
                                                          forecast.py and rules.py)
    .venv\\Scripts\\python pipeline\\crops.py --today 2026-11-14

For every tank this writes the "crops" section of data/tank/<id>.json: for each crop, how much
water it needs over its growing days, how much USEFUL rain to expect, how often the rain was
enough in the past, and a rating (good / possible / not now).

It is a plain water balance, not a black box:

  need   Rain-fed pulses (mung bean, cowpea, black gram): ETc = the sum over the crop's days of
         Kc x ET0.
           ET0 = reference evapotranspiration estimated from NASA POWER daily temperatures
                 (written by rain.py into data/cells/);
           Kc  = FAO crop coefficient by growth stage (FAO Irrigation and Drainage Paper 56).
         Paddy also needs water to saturate the field, a standing water layer and seepage
         (FAO: IN = ETc + SAT + WL + PERC - Pe).
  rain   Useful ("effective") rain by FAO's rule: Pe = 0.8P - 25 if P > 75 mm a month,
         0.6P - 10 otherwise. The first 16 days come from the weather-model forecast
         (forecast.py); the days after that use the usual rain for that date (1991-2020).
  past   The same calculation for every past year in the NASA POWER record (about 45 years) for
         a sowing on today's date: "in how many years was the rain enough?"
  rating Paddy follows the water signal from rules.py (it depends on the tank). Pulses are rated
         from the expected rain/need ratio and the past reliability; thresholds in config.toml
         [crops] are drafts for an Agricultural Instructor to review.

Every crop number has a source in pipeline/crops_data.json. Nothing here predicts the weather
beyond the forecast; "usual rain" is the past average, and the app says so.
"""

import argparse
import json
import sys
import tomllib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
SCHEMA_VERSION = "1.7"


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def load_crop_data(path=PIPELINE / "crops_data.json"):
    return json.loads(path.read_text(encoding="utf-8"))


# ===========================================================================
# 1. Building blocks (pure functions)
# ===========================================================================
def kc_curve(kc, fractions, days):
    """Daily crop coefficient for a crop that grows for `days` days (FAO-56 method).

    Initial stage: constant Kc ini. Development: straight line from Kc ini up to Kc mid.
    Mid-season: constant Kc mid. Late season: straight line down to Kc end.
    `fractions` = share of the days spent in each stage (ini, dev, mid, late).
    """
    total = sum(fractions.values())
    n_ini = round(days * fractions["ini"] / total)
    n_dev = round(days * fractions["dev"] / total)
    n_mid = round(days * fractions["mid"] / total)
    n_late = days - n_ini - n_dev - n_mid
    parts = [
        np.full(n_ini, kc["ini"]),
        np.linspace(kc["ini"], kc["mid"], n_dev + 2)[1:-1] if n_dev else np.array([]),
        np.full(n_mid, kc["mid"]),
        np.linspace(kc["mid"], kc["end"], n_late + 1)[1:] if n_late > 0 else np.array([]),
    ]
    return np.concatenate(parts)[:days]


def fao_effective_rain(month_rain_mm):
    """FAO rule for the part of a month's rain a crop can use (never negative)."""
    p = month_rain_mm
    pe = 0.8 * p - 25 if p > 75 else 0.6 * p - 10
    return max(0.0, pe)


def effective_rain(dates, rain):
    """Useful rain over a run of days, applying the monthly FAO rule month by month.

    A month that is only partly inside the window is scaled to 30 days, converted, and scaled
    back, so a short stretch of heavy rain isn't judged as if it were a whole month's total.
    """
    total = 0.0
    months = pd.Series(np.asarray(rain, dtype=float), index=pd.DatetimeIndex(dates)).groupby(
        [pd.DatetimeIndex(dates).year, pd.DatetimeIndex(dates).month])
    for _, chunk in months:
        n = len(chunk)
        total += fao_effective_rain(chunk.sum() * 30 / n) * n / 30
    return float(total)


def paddy_extra_mm(extra, days):
    """Water paddy needs on top of what the plant uses: saturation, water layer, seepage."""
    perc = extra["percolation_mm_per_day"][extra["percolation_used"]]
    return extra["saturation_mm"] + extra["water_layer_mm"] + perc * days


class Cell:
    """One NASA POWER grid cell's daily rain and ET0 (from data/cells/<lat>_<lon>.json)."""

    def __init__(self, doc):
        self.start = date.fromisoformat(doc["start"])
        self.rain = np.array([np.nan if v is None else v / 10 for v in doc["rain_tenths"]])
        self.et0 = np.array([np.nan if v is None else v / 10 for v in doc["et0_tenths"]])
        self.last = self.start + timedelta(days=len(self.rain) - 1)
        self.index = pd.date_range(self.start, periods=len(self.rain))

    def window(self, start, days):
        """(dates, rain, et0) for `days` days from `start`, or None if any day is outside the record or missing."""
        i = (start - self.start).days
        if i < 0 or i + days > len(self.rain):
            return None
        rain, et0 = self.rain[i:i + days], self.et0[i:i + days]
        if np.isnan(rain).any() or np.isnan(et0).any():
            return None
        return self.index[i:i + days], rain, et0

    def usual(self, first_year, last_year, smooth_days):
        """Usual daily rain and ET0 by day of year (averaged over the normal years and smoothed)."""
        df = pd.DataFrame({"rain": self.rain, "et0": self.et0}, index=self.index)
        df = df[(df.index.year >= first_year) & (df.index.year <= last_year)]
        by_doy = df.groupby(df.index.dayofyear).mean().reindex(range(1, 367))
        by_doy = by_doy.interpolate(limit_direction="both")
        wide = pd.concat([by_doy.iloc[-smooth_days:], by_doy, by_doy.iloc[:smooth_days]])     # wrap round the year
        smooth = wide.rolling(2 * smooth_days + 1, center=True).mean().iloc[smooth_days:-smooth_days]
        return smooth


def safe_start(year, month, day):
    try:
        return date(year, month, day)
    except ValueError:                                  # 29 February in a non-leap year
        return date(year, month, day - 1)


# ===========================================================================
# 2. One crop
# ===========================================================================
def crop_water(crop, curve, et0, extra):
    """Water the crop needs over the window (mm). Paddy includes saturation, layer and seepage."""
    etc = float((curve * et0).sum())
    return etc, (etc + paddy_extra_mm(extra, len(curve)) if crop["kind"] == "paddy" else etc)


def reliability(cell, crop, curve, extra, sow, cfg):
    """In how many past years was the useful rain enough for this crop sown on `sow`'s date?"""
    ok = years = 0
    for year in range(cell.start.year, cell.last.year + 1):
        w = cell.window(safe_start(year, sow.month, sow.day), len(curve))
        if w is None:
            continue
        dates, rain, et0 = w
        etc, _ = crop_water(crop, curve, et0, extra)
        years += 1
        if effective_rain(dates, rain) >= cfg["adequate_ratio"] * etc:
            ok += 1
    return ok, years


def expected_series(cell, usual, sow, days, forecast_days):
    """Rain and ET0 we expect over the window: the forecast first, the usual values after it."""
    dates = pd.date_range(sow, periods=days)
    fc = {d["date"]: d["rain_mm"] for d in (forecast_days or []) if d.get("rain_mm") is not None}
    rain, et0, used_forecast = [], [], 0
    for d in dates:
        doy = min(d.dayofyear, 366)
        if d.date().isoformat() in fc:
            rain.append(fc[d.date().isoformat()])
            used_forecast += 1
        else:
            rain.append(float(usual["rain"].loc[doy]))
        et0.append(float(usual["et0"].loc[doy]))
    return dates, np.array(rain), np.array(et0), used_forecast


def rate_ofc(ratio, past_ok, past_years, cfg):
    """good / possible / not_now for a rain-fed crop."""
    reliable = past_years < cfg["min_years"] or (past_ok / past_years) >= cfg["good_reliability"]
    if ratio >= cfg["good_ratio"] and reliable:
        return "good"
    if ratio >= cfg["possible_ratio"]:
        return "possible"
    return "not_now"


def rate_paddy(crop_id, signal):
    """Paddy depends on the tank's water, which the rule engine has already judged."""
    if signal is None:
        return "unknown"
    if crop_id == "paddy":
        return "good" if signal == "green" else "not_now"
    return "good" if signal in ("green", "amber") else "not_now"          # short-duration paddy


def evaluate(cell, usual, crops_data, cfg, sow, forecast_days, signal):
    extra = crops_data["rice_extra_water"]
    items = []
    for crop in crops_data["crops"]:
        days = crop["duration_days"]
        curve = kc_curve(crop["kc"], crop["stage_fractions"], days)
        dates, rain, et0, used_forecast = expected_series(cell, usual, sow, days, forecast_days)
        etc, need = crop_water(crop, curve, et0, extra)
        pe = effective_rain(dates, rain)
        item = {
            "id": crop["id"], "kind": crop["kind"], "duration_days": days,
            "need_mm": round(need, 0), "rain_mm": round(pe, 0),
            "ratio": round(pe / need, 2) if need else None,
            "usually_irrigated": bool(crop.get("usually_irrigated")),
            "confidence": crop["duration_confidence"],
        }
        if crop["kind"] == "paddy":
            item["rating"] = rate_paddy(crop["id"], signal)
            item["tank_mm"] = round(max(0.0, need - pe), 0)        # what the tank must supply
            item["tank_m3_per_ha"] = round(max(0.0, need - pe) * 10, 0)     # 1 mm on 1 ha = 10 cubic metres
        else:
            ok, years = reliability(cell, crop, curve, extra, sow, cfg)
            item["past_years_ok"], item["past_years"] = ok, years
            item["rating"] = rate_ofc(pe / etc, ok, years, cfg)
        items.append(item)
    return items


def calendar(cell, usual, crops_data, cfg, start, forecast_days, memo=None, signal=None):
    """When to sow: the same rating as "sow now", worked out for each of the next `calendar_weeks` weeks.

    Rain-fed crops get a rating for every week. Paddy needs the tank as well, and the tank's future
    water isn't known, so it gets NO weekly rating: each week only shows `tank_mm`, how much water the
    tank would have to supply after the rain (less is better), and `rating` is today's tank-based
    rating (the same in every week). For a week that starts inside the 16-day
    forecast the forecast is used for those days; for later weeks the usual rain is used.
    `memo` remembers how often past years had enough rain (it depends only on the date and the
    grid cell), so tanks sharing a cell don't repeat the work.
    """
    extra = crops_data["rice_extra_water"]
    memo = {} if memo is None else memo
    weeks = []
    for k in range(cfg["calendar_weeks"]):
        sow = start + timedelta(days=7 * k)
        items = []
        for crop in crops_data["crops"]:
            days = crop["duration_days"]
            curve = kc_curve(crop["kc"], crop["stage_fractions"], days)
            dates, rain, et0, _ = expected_series(cell, usual, sow, days, forecast_days)
            etc, need = crop_water(crop, curve, et0, extra)
            pe = effective_rain(dates, rain)
            if crop["kind"] == "paddy":
                items.append({"id": crop["id"], "kind": "paddy", "rating": rate_paddy(crop["id"], signal),
                              "ratio": round(pe / need, 2) if need else None, "tank_mm": round(max(0.0, need - pe), 0)})
                continue
            key = (cell.start, cell.last, crop["id"], sow.month, sow.day)
            if key not in memo:
                memo[key] = reliability(cell, crop, curve, extra, sow, cfg)
            ok, years = memo[key]
            items.append({"id": crop["id"], "kind": "ofc", "rating": rate_ofc(pe / etc, ok, years, cfg),
                          "ratio": round(pe / need, 2) if need else None,
                          "past_years_ok": ok, "past_years": years})
        weeks.append({"start": sow.isoformat(), "items": items})
    return weeks


def order(items):
    rank = {"good": 0, "possible": 1, "unknown": 2, "not_now": 3}
    return sorted(items, key=lambda i: (rank[i["rating"]], -(i["ratio"] or 0)))


# ===========================================================================
# 3. Tanks
# ===========================================================================
def load_cell(cell_xy):
    path = REPO / "data" / "cells" / f"{cell_xy[0]}_{cell_xy[1]}.json"
    if not path.exists():
        sys.exit(f"STOPPED: {path.relative_to(REPO)} is missing. Run rain.py first. Nothing was written.")
    return Cell(json.loads(path.read_text(encoding="utf-8")))


def build_section(doc, cell, usual, crops_data, cfg, sow, now, memo=None):
    forecast = doc.get("forecast") or {}
    days = forecast.get("days") or []
    signal = (doc.get("result") or {}).get("signal")
    items = order(evaluate(cell, usual, crops_data, cfg, sow, days, signal))

    horizon = pd.date_range(sow, periods=16)
    fc_rain = [d["rain_mm"] for d in days if d["date"] in {x.date().isoformat() for x in horizon}
               and d.get("rain_mm") is not None]
    usual_16 = float(sum(usual["rain"].loc[min(d.dayofyear, 366)] for d in horizon))
    return {
        "as_of": sow.isoformat(),
        "sow_date": sow.isoformat(),
        "items": items,
        "recommended": [i["id"] for i in items if i["rating"] == "good"][:3],
        "calendar": calendar(cell, usual, crops_data, cfg, sow, days, memo, signal),
        "forecast_16_mm": round(sum(fc_rain), 0) if len(fc_rain) == 16 else None,
        "usual_16_mm": round(usual_16, 0),
        "signal": signal,
        "settings": {k: cfg[k] for k in ("adequate_ratio", "good_ratio", "good_reliability", "possible_ratio")},
        "past_period": f"{cell.start.year}–{cell.last.year}",
        "sources": ["NASA POWER (rain and temperature)", "FAO-56 (crop coefficients)",
                    "FAO irrigation manual (effective rain, paddy water)", "Sri Lanka Department of Agriculture (durations)",
                    "Open-Meteo (16-day forecast; not NASA)"],
        "updated": now,
        "demo": bool(doc.get("demo")),
    }


def write_crop_sources(crops_data, now):
    """data/crop_sources.json: where every crop number comes from, for the website's Data sources page.
    The website must not read pipeline files, so the facts it shows are copied here (same JSON-only link as the tank files)."""
    doc = {
        "generated": now,
        "effective_rain": crops_data["effective_rain"],
        "crops": [{k: c.get(k) for k in ("id", "kind", "duration_days", "duration_range", "duration_source", "duration_confidence",
                                          "kc_source", "kc_confidence", "stage_source", "usually_irrigated")} for c in crops_data["crops"]],
    }
    path = REPO / "data" / "crop_sources.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + chr(10), encoding="utf-8")
    return path


def main():
    parser = argparse.ArgumentParser(description="Crop suitability for sowing now.")
    parser.add_argument("--today", type=date.fromisoformat, default=datetime.now(SRI_LANKA).date())
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg_all = load_config()
    cfg = cfg_all["crops"]
    crops_data = load_crop_data()
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()

    cells, usuals, sections, memo = {}, {}, {}, {}
    for tank in tanks:                                   # compute everything first: a failure writes nothing
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        cell_xy = tuple((doc.get("rain") or {}).get("power_cell") or ())
        if not cell_xy:
            sys.exit(f"STOPPED: {tank['id']} has no rain.power_cell. Run rain.py first. Nothing was written.")
        if cell_xy not in cells:
            cells[cell_xy] = load_cell(cell_xy)
            usuals[cell_xy] = cells[cell_xy].usual(cfg["normal_first_year"], cfg["normal_last_year"], cfg["smooth_days"])
        sections[tank["id"]] = (path, doc, build_section(doc, cells[cell_xy], usuals[cell_xy], crops_data, cfg, args.today, now, memo))

    for path, doc, section in sections.values():
        doc["crops"] = section                           # only the crops section changes
        doc["schema_version"] = SCHEMA_VERSION
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Summary: one line per grid cell for the pulses (they depend on rain only), then rating counts.
    print(f"Crops for sowing on {args.today} (useful rain vs water need; 'past' = years the rain was enough)")
    seen = set()
    for tank_id, (_, doc, section) in sections.items():
        cell_xy = tuple(doc["rain"]["power_cell"])
        if cell_xy in seen:
            continue
        seen.add(cell_xy)
        print(f"\n  grid cell {cell_xy}   forecast next 16 days: {section['forecast_16_mm']} mm "
              f"(usual {section['usual_16_mm']} mm)")
        print(f"  {'crop':<12}{'days':>5}{'need mm':>9}{'rain mm':>9}{'ratio':>7}{'past years':>13}  rating")
        for i in section["items"]:
            past = f"{i['past_years_ok']}/{i['past_years']}" if "past_years" in i else "-"
            print(f"  {i['id']:<12}{i['duration_days']:>5}{i['need_mm']:>9.0f}{i['rain_mm']:>9.0f}"
                  f"{(i['ratio'] if i['ratio'] is not None else 0):>7.2f}{past:>13}  {i['rating']}")
    counts = {}
    for _, (_, _, section) in sections.items():
        for i in section["items"]:
            counts.setdefault(i["id"], {}).setdefault(i["rating"], 0)
            counts[i["id"]][i["rating"]] += 1
    print("\nRatings across all tanks:", json.dumps(counts))
    print(f"Wrote the crops section for {len(sections)} tank(s).")
    print(f"Wrote {write_crop_sources(crops_data, now).relative_to(REPO)}.")


if __name__ == "__main__":
    main()
