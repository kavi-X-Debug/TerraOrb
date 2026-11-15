"""
Rain outlook for the coming months
==================================

    .venv\\Scripts\\python pipeline\\seasonal.py        (run from the repo root, after rain.py; no login needed)

For every tank in data/tanks.json this writes the "seasonal" section of data/tank/<id>.json:
for each of the next whole calendar months, the spread of the forecast rain (lowest likely, middle,
highest likely) next to the usual rain for that month.

Where it comes from: the ECMWF long-range ensemble (50 forecast "members", each a possible future),
through the free Open-Meteo seasonal API. It is NOT NASA data and NOT a model we built.
The usual rain comes from NASA POWER (already in the tank file, `rain.monthly`).

Honest limits: seasonal forecasts have low skill, and the model is not tuned to NASA POWER, so the
two are NOT directly comparable month by month. We therefore show the spread and the usual rain side by
side and never say "wetter" or "drier" for the farmer. The web page says this in plain words.

If the download fails the script stops and writes nothing (the app keeps the last saved outlook).
"""

import calendar
import json
import statistics
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def stop(message):
    sys.exit(f"STOPPED: {message}\nNothing was written.")


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
def fetch(points, cfg):
    """Daily rain of every ensemble member for a list of (lat, lon); one Open-Meteo result per point."""
    params = {
        "latitude": ",".join(f"{lat:.5f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.5f}" for _, lon in points),
        "daily": "precipitation_sum",
        "forecast_days": cfg["forecast_days"],
        "timezone": cfg["timezone"],
    }
    try:
        r = requests.get(cfg["url"], params=params, timeout=180)
    except requests.RequestException as err:
        stop(f"could not reach the seasonal forecast service: {err}")
    if r.status_code != 200:
        stop(f"the seasonal forecast service returned HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    results = data if isinstance(data, list) else [data]
    if len(results) != len(points):
        stop(f"asked for {len(points)} places but got {len(results)} forecasts back")
    return results


# ---------------------------------------------------------------------------
# Pure functions (tested without internet)
# ---------------------------------------------------------------------------
def percentile(values, pct):
    """Linear-interpolated percentile of a list of numbers."""
    ordered = sorted(values)
    if not ordered:
        return None
    pos = (len(ordered) - 1) * pct / 100
    low = int(pos)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def member_totals(daily, month):
    """Rain total of every ensemble member for one calendar month ("YYYY-MM"), or None if a day is missing."""
    times = daily["time"]
    idx = [i for i, day in enumerate(times) if day.startswith(month)]
    year, mon = int(month[:4]), int(month[5:7])
    if len(idx) != calendar.monthrange(year, mon)[1]:
        return None                                   # partial month at either end: never shown
    totals = []
    for key, series in daily.items():
        if not key.startswith("precipitation_sum"):
            continue
        values = [series[i] for i in idx]
        if any(v is None for v in values):
            continue                                  # a member with a missing day is left out, not patched
        totals.append(sum(values))
    return totals


def usual_month_rain(monthly, first_year, last_year):
    """Mean rain per calendar month ("01".."12") over the normal years, from rain.monthly."""
    by_month = {}
    for row in monthly or []:
        year, mon = int(row["month"][:4]), row["month"][5:7]
        if first_year <= year <= last_year and row["total_mm"] is not None:
            by_month.setdefault(mon, []).append(row["total_mm"])
    return {m: round(statistics.mean(v), 1) for m, v in by_month.items() if len(v) >= 20}


def seasonal_section(result, doc, demo, cfg, now):
    """The "seasonal" section, or None when no whole month could be made from the answer."""
    daily = result["daily"]
    usual = usual_month_rain(doc.get("rain", {}).get("monthly"), cfg["normal_first_year"], cfg["normal_last_year"])
    months = []
    for month in sorted({d[:7] for d in daily["time"]}):
        totals = member_totals(daily, month)
        if not totals or len(totals) < 10:
            continue
        months.append({
            "month": month,
            "low_mm": round(percentile(totals, cfg["low_percentile"])),
            "middle_mm": round(statistics.median(totals)),
            "high_mm": round(percentile(totals, cfg["high_percentile"])),
            "usual_mm": usual.get(month[5:7]),
            "members": len(totals),
        })
    if not months:
        return None
    return {
        "issued": now,
        "months": months,
        "range_percent": [cfg["low_percentile"], cfg["high_percentile"]],
        "normal_period": f"{cfg['normal_first_year']}–{cfg['normal_last_year']}",
        "source": cfg["source"],
        "usual_source": "NASA POWER (PRECTOTCORR)",
        "credit": cfg["credit"],
        "demo": demo,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()["seasonal"]
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()

    # Download everything first, so a failure writes nothing.
    answers = {}
    size = cfg["batch_size"]
    for i in range(0, len(tanks), size):
        batch = tanks[i:i + size]
        print(f"Seasonal outlook for tanks {i + 1}-{i + len(batch)} of {len(tanks)} ...", flush=True)
        for tank, result in zip(batch, fetch([(t["lat"], t["lon"]) for t in batch], cfg)):
            answers[tank["id"]] = result

    written = 0
    for tank in tanks:
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            print(f"  {tank['id']}: no data file yet (run rain.py first), skipped")
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        section = seasonal_section(answers[tank["id"]], doc, bool(tank.get("demo")), cfg, now)
        if section is None:
            doc.pop("seasonal", None)
        else:
            doc["seasonal"] = section                  # only the seasonal section changes
            written += 1
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote the seasonal outlook for {written} of {len(tanks)} tanks.")


if __name__ == "__main__":
    main()
