"""
Weekly advice for every tank
============================

    .venv\\Scripts\\python pipeline\\advisory.py        (run from the repo root, after forecast.py, rules.py, crops.py, ndvi.py)

For every tank this writes the "advisory" section of data/tank/<id>.json: a short list of things
for the coming week (water colour, rain, heat, good days to spray, how green the land is, crops
that suit sowing now). Every item is built ONLY from sections already in the same tank file
(`result`, `forecast`, `crops`, `ndvi`); nothing is invented and nothing is fetched here.

The file holds text KEYS plus numbers, never sentences: the web app turns them into Sinhala or
English from web/si.json and web/en.json. If the saved forecast is too old (fewer than 4 days of
today and later left) the rain, heat and spray items are left out rather than guessed.

All thresholds are in pipeline/config.toml, section [advisory]. They are DRAFT and need an
Agricultural Instructor's review.
"""

import json
import sys
import tomllib
from datetime import datetime, timedelta, timezone
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
REPO = PIPELINE.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
MIN_FORECAST_DAYS = 4          # fewer days than this left in the saved forecast: say nothing about the weather


def load_config(path=PIPELINE / "config.toml"):
    with open(path, "rb") as f:
        return tomllib.load(f)


def week_days(forecast, today, n_days):
    """The forecast days from today for up to n_days, or [] when the saved forecast is too old."""
    days = [d for d in (forecast or {}).get("days", []) if d["date"] >= today][:n_days]
    return days if len(days) >= MIN_FORECAST_DAYS else []


def build_items(doc, today, cfg):
    """The list of advice items, most important first. Each item: id, kind (do / watch / info), key, values."""
    items = []

    # 1. The water colour (the rule engine's signal for this tank).
    signal = (doc.get("result") or {}).get("signal") or "none"
    items.append({"id": "water", "kind": "do" if signal in ("green", "amber", "red") else "info",
                  "key": f"advisory.water.{signal}", "values": {}})

    # 2-4. The weather for the coming days, from the saved forecast.
    days = week_days(doc.get("forecast"), today, cfg["days"])
    if days:
        known = [d for d in days if d["rain_mm"] is not None]
        total = round(sum(d["rain_mm"] for d in known), 1)
        rain_days = sum(1 for d in known if d["rain_mm"] >= doc["forecast"].get("rain_day_mm", 1.0))
        heaviest = max(known, key=lambda d: d["rain_mm"], default=None)
        hot_days = sum(1 for d in days if d["tmax_c"] is not None and d["tmax_c"] >= cfg["hot_day_c"])
        if heaviest and heaviest["rain_mm"] >= cfg["heavy_rain_mm"]:
            items.append({"id": "rain", "kind": "watch", "key": "advisory.rain.heavy",
                          "values": {"mm": round(heaviest["rain_mm"]), "date": heaviest["date"], "total": round(total)}})
        elif total < cfg["dry_week_mm"]:
            items.append({"id": "rain", "kind": "watch", "key": "advisory.rain.dry", "values": {"mm": total}})
        else:
            items.append({"id": "rain", "kind": "info", "key": "advisory.rain.some",
                          "values": {"mm": round(total), "days": rain_days}})
        if hot_days >= cfg["hot_days_alert"]:
            items.append({"id": "heat", "kind": "watch", "key": "advisory.heat",
                          "values": {"days": hot_days, "c": cfg["hot_day_c"]}})
        spray = [d["date"] for d in days if d["rain_mm"] is not None and d["rain_mm"] < cfg["spray_max_mm"]
                 and d["rain_chance"] is not None and d["rain_chance"] < cfg["spray_max_chance"]]
        items.append({"id": "spray", "kind": "info", "key": "advisory.spray.days" if spray else "advisory.spray.none",
                      "values": {}, "dates": spray})
    else:
        items.append({"id": "rain", "kind": "info", "key": "advisory.forecast_old", "values": {}})

    # 5. How green the land is (NASA MODIS), only when we have a real "usual" to compare with.
    current = (doc.get("ndvi") or {}).get("current")
    if current and current.get("state"):
        items.append({"id": "green", "kind": "info", "key": f"advisory.green.{current['state']}",
                      "values": {"date": current["date"]}})

    # 6. Crops that suit sowing now (the crop advice already in the file).
    good = [c["id"] for c in (doc.get("crops") or {}).get("items", [])
            if c.get("rating") == "good" and c.get("kind") != "paddy"]
    if good:
        items.append({"id": "crops", "kind": "do", "key": "advisory.crops", "values": {}, "crops": good[:4]})
    return items


def advisory_section(doc, today, now, cfg):
    days = week_days(doc.get("forecast"), today, cfg["days"])
    return {
        "issued": now,
        "week_start": days[0]["date"] if days else today,
        "week_end": days[-1]["date"] if days else today,
        "items": build_items(doc, today, cfg),
        # The thresholds travel with the data, so the web page can redo the weather items from the LIVE
        # forecast with exactly the same numbers (web/js/week.js). One place to change them: config.toml.
        "settings": {**{k: cfg[k] for k in ("days", "heavy_rain_mm", "dry_week_mm", "hot_day_c", "hot_days_alert",
                                            "spray_max_mm", "spray_max_chance")},
                     "min_forecast_days": MIN_FORECAST_DAYS},
        "sources": ["rules (NASA POWER, NASA water data)", "Open-Meteo forecast (not NASA data)",
                    "NASA MODIS NDVI", "crop rules"],
        "demo": bool(doc.get("demo")),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()["advisory"]
    now_dt = datetime.now(SRI_LANKA).replace(microsecond=0)
    today, now = now_dt.date().isoformat(), now_dt.isoformat()
    tanks = json.loads((REPO / "data" / "tanks.json").read_text(encoding="utf-8"))["tanks"]
    written = 0
    for tank in tanks:
        path = REPO / "data" / "tank" / f"{tank['id']}.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["advisory"] = advisory_section(doc, today, now, cfg)
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written += 1
    print(f"Wrote the weekly advice for {written} tanks.")


if __name__ == "__main__":
    main()
