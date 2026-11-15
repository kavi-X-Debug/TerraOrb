"""
16-day rain forecast for every tank
===================================

    .venv\\Scripts\\python pipeline\\forecast.py        (run from the repo root; no login needed)

For every tank in data/tanks.json this writes the "forecast" section of data/tank/<id>.json:
the daily rain (mm), chance of rain (%) and maximum temperature for the next 16 days,
plus a short summary (rain days, total, wettest day).

Where the forecast comes from: global weather models (ECMWF, GFS and others) through the
free Open-Meteo API. It is the weather services' own forecast — not NASA data and not a
model we built — and is labelled that way in the app. The web app also fetches the same
forecast live when the phone is online; this saved copy is what it shows offline.

The daily GitHub Actions refresh runs this. If the download fails, the script stops and
writes nothing (the app keeps yesterday's saved forecast).
"""

import json
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
    """Daily forecast for a list of (lat, lon); returns one Open-Meteo result per point."""
    params = {
        "latitude": ",".join(f"{lat:.5f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.5f}" for _, lon in points),
        "daily": "precipitation_sum,precipitation_probability_max,temperature_2m_max",
        "forecast_days": cfg["forecast_days"],
        "timezone": cfg["timezone"],
    }
    try:
        r = requests.get(cfg["url"], params=params, timeout=120)
    except requests.RequestException as err:
        stop(f"could not reach the forecast service: {err}")
    if r.status_code != 200:
        stop(f"the forecast service returned HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    results = data if isinstance(data, list) else [data]      # one point → a single object
    if len(results) != len(points):
        stop(f"asked for {len(points)} places but got {len(results)} forecasts back")
    return results


# ---------------------------------------------------------------------------
# Turning a response into the "forecast" section (pure functions)
# ---------------------------------------------------------------------------
def to_days(result):
    d = result["daily"]
    return [{"date": day, "rain_mm": rain, "rain_chance": chance, "tmax_c": tmax}
            for day, rain, chance, tmax in zip(d["time"], d["precipitation_sum"],
                                               d["precipitation_probability_max"], d["temperature_2m_max"])]


def summarise(days, rain_day_mm):
    """Rain days, total and wettest day. Days with no value (null) are left out, never guessed."""
    known = [d for d in days if d["rain_mm"] is not None]
    wettest = max(known, key=lambda d: d["rain_mm"]) if known else None
    return {
        "rain_days": sum(1 for d in known if d["rain_mm"] >= rain_day_mm),
        "total_mm": round(sum(d["rain_mm"] for d in known), 1) if known else None,
        "wettest_day": wettest["date"] if wettest and wettest["rain_mm"] >= rain_day_mm else None,
        "wettest_mm": wettest["rain_mm"] if wettest and wettest["rain_mm"] >= rain_day_mm else None,
    }


def forecast_section(result, demo, cfg, now):
    days = to_days(result)
    return {
        "issued": now,
        "days": days,
        **summarise(days, cfg["rain_day_mm"]),
        "rain_day_mm": cfg["rain_day_mm"],
        "source": cfg["source"],
        "credit": "Weather data by Open-Meteo.com (CC BY 4.0)",
        "demo": demo,                      # demo tanks sit at placeholder points
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()["forecast"]
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()

    # Download everything first, so a failure writes nothing.
    sections = {}
    size = cfg["batch_size"]
    for i in range(0, len(tanks), size):
        batch = tanks[i:i + size]
        print(f"Forecast for tanks {i + 1}–{i + len(batch)} of {len(tanks)} ...", flush=True)
        for tank, result in zip(batch, fetch([(t["lat"], t["lon"]) for t in batch], cfg)):
            sections[tank["id"]] = forecast_section(result, bool(tank.get("demo")), cfg, now)

    for tank in tanks:
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            print(f"  {tank['id']}: no data file yet (run rain.py first), skipped")
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["forecast"] = sections[tank["id"]]          # only the forecast section changes
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sample = sections[tanks[0]["id"]]
    print(f"Wrote 16-day forecasts for {len(sections)} tanks. Example ({tanks[0]['id']}): "
          f"{sample['rain_days']} rain days, {sample['total_mm']} mm, wettest {sample['wettest_day']}.")


if __name__ == "__main__":
    main()
