"""
16-day hourly and daily forecast per destination, from Open-Meteo (NOT NASA data).

    .venv\\Scripts\\python -m pipeline.trip.main --only forecast

Writes the body of data/trip/forecast_snapshot.json. The browser still asks Open-Meteo live (web/js/trip/forecast.js);
this snapshot is the offline copy and the fallback, and the web app always shows its `fetched_at` time.
Destinations are asked for in small batches with a pause between requests. A destination that does not answer is left out
(and listed); nothing is filled in. Hourly precipitation at stamp T is the hour ENDING at T (Open-Meteo convention).
Credit: "Weather data by Open-Meteo.com" (CC BY 4.0).
"""

import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from pipeline.trip import common  # noqa: E402


class ForecastError(RuntimeError):
    pass


def request_batch(points, tcfg):
    """One Open-Meteo request for a list of (lat, lon). Returns one result dict per point, in order."""
    f = tcfg["forecast"]
    params = {
        "latitude": ",".join(f"{lat:.4f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.4f}" for _, lon in points),
        "hourly": ",".join(f["hourly"]), "daily": ",".join(f["daily"]),
        "forecast_days": tcfg["forecast_horizon_days"], "timezone": f["timezone"],
        "wind_speed_unit": "kmh", "precipitation_unit": "mm", "temperature_unit": "celsius",
    }
    last = "no answer"
    for attempt in range(f["retries"]):
        try:
            r = requests.get(f["url"], params=params, timeout=f["timeout_seconds"], headers={"User-Agent": common.USER_AGENT})
            if r.status_code == 200:
                data = r.json()
                results = data if isinstance(data, list) else [data]
                if len(results) != len(points):
                    raise ForecastError(f"asked for {len(points)} places, got {len(results)}")
                return results
            last = f"HTTP {r.status_code}: {r.text[:200]}"
        except (requests.RequestException, ValueError) as err:
            last = str(err)[:200]
        time.sleep(10 * (attempt + 1))
    raise ForecastError(f"Open-Meteo did not answer ({last})")


def slim(result, tcfg):
    """Keep only the fields of the contract, as plain lists. Missing fields stay absent (never invented)."""
    f = tcfg["forecast"]
    hourly = {"time": result["hourly"]["time"]}
    for k in f["hourly"]:
        hourly[k] = result["hourly"].get(k)
    daily = {"time": result["daily"]["time"]}
    for k in f["daily"]:
        daily[k] = result["daily"].get(k)
    return {"hourly": hourly, "daily": daily}


def check(entry, tcfg):
    """Raise if the arrays do not have the expected length (a short or ragged forecast must not be saved as complete)."""
    days = tcfg["forecast_horizon_days"]
    if len(entry["daily"]["time"]) != days or len(entry["hourly"]["time"]) != days * 24:
        raise ForecastError(f"unexpected forecast length: {len(entry['daily']['time'])} days, {len(entry['hourly']['time'])} hours")
    for block in ("hourly", "daily"):
        n = len(entry[block]["time"])
        for k, v in entry[block].items():
            if v is None or len(v) != n:
                raise ForecastError(f"field {block}.{k} missing or of the wrong length")


def fetch_snapshot(destinations, cfg, log=print):
    """({id: {hourly, daily}}, [ids that failed]) for every destination."""
    tcfg = cfg["trip"]
    size, pause = tcfg["forecast"]["batch_size"], tcfg["forecast"]["pause_seconds"]
    out, failed = {}, []
    for i in range(0, len(destinations), size):
        batch = destinations[i:i + size]
        try:
            results = request_batch([(d["lat"], d["lon"]) for d in batch], tcfg)
        except ForecastError as err:
            log(f"  forecast batch {i // size + 1} failed: {err}")
            failed += [d["id"] for d in batch]
            continue
        for d, res in zip(batch, results):
            try:
                entry = slim(res, tcfg)
                check(entry, tcfg)
                out[d["id"]] = entry
            except (KeyError, ForecastError) as err:
                log(f"  {d['id']}: skipped ({err})")
                failed.append(d["id"])
        log(f"  forecast: {len(out)} of {len(destinations)} destinations")
        time.sleep(pause)
    return out, failed
