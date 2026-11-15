"""
NASA GPM IMERG rain for every tank: a second rain record that is NOT NASA POWER.

    .venv\\Scripts\\python pipeline\\imerg_tanks.py        (reads the IMERG daily cache; fill it first with
                                                           python -m pipeline.trip.download.gpm_imerg --start 2001-01-01)

IMERG V07 "Late" daily rain (0.1 degree, about 10 km) comes from satellite microwave and infrared estimates tuned to rain gauges.
For each tank we take the 0.1 degree pixel holding it, add the days up to calendar months and keep every month that has at least 25 days of
data. Output data/farm/imerg_tanks.json: per tank the last 12 full months, the usual value of each calendar month (2001 to the year before
the newest data) and the newest day. A tank outside the cached box gets nothing (never a guess). Pixels are about 10 km, so this is area rain,
not the rain on the tank.
"""
import json
import sys
import tomllib
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.trip.download import gpm_imerg as im  # noqa: E402

OUT = ROOT / "data" / "farm" / "imerg_tanks.json"


def build():
    lons, lats = im.grid()
    files = sorted(im.CACHE.glob("2*.npy"))
    if not files:
        sys.exit("The IMERG cache is empty (run pipeline.trip.download.gpm_imerg first).")
    days = [datetime.strptime(p.stem, "%Y%m%d").date() for p in files]
    stack = np.stack([np.load(p) for p in files])                           # [days, lon, lat]
    tanks = json.loads((ROOT / "data" / "tanks.json").read_text(encoding="utf-8"))
    tanks = tanks["tanks"] if isinstance(tanks, dict) else tanks
    phase = set(tomllib.loads((ROOT / "pipeline" / "config.toml").read_text(encoding="utf-8"))["farm"]["phase_tanks"])     # this phase: five tanks only
    tanks = [x for x in tanks if x["id"] in phase]
    out, skipped = {}, 0
    for t in tanks:
        if not (lons.min() - 0.05 <= t["lon"] <= lons.max() + 0.05 and lats.min() - 0.05 <= t["lat"] <= lats.max() + 0.05):
            skipped += 1
            continue
        i, j = int(np.abs(lons - t["lon"]).argmin()), int(np.abs(lats - t["lat"]).argmin())
        series = stack[:, i, j]
        month = defaultdict(lambda: [0.0, 0])
        for d, v in zip(days, series):
            if np.isfinite(v):
                m = month[(d.year, d.month)]
                m[0] += float(v); m[1] += 1
        full = {k: round(v[0], 1) for k, v in month.items() if v[1] >= 25}
        if not full:
            skipped += 1
            continue
        last_day = max(d for d, v in zip(days, series) if np.isfinite(v))
        newest_year = max(y for y, _ in full)
        usual = {}
        for m in range(1, 13):
            vals = [v for (y, mm), v in full.items() if mm == m and y < newest_year]
            usual[str(m)] = round(sum(vals) / len(vals), 1) if len(vals) >= 10 else None
        recent = sorted(full)[-12:]
        out[t["id"]] = {"pixel": [round(float(lats[j]), 2), round(float(lons[i]), 2)], "newest_day": last_day.isoformat(),
                        "monthly": [{"month": f"{y}-{m:02d}", "total_mm": full[(y, m)]} for y, m in recent], "usual_by_month": usual}
    doc = {"schema": "farm-imerg-tanks-1", "generated": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"), "demo": False,
           "source": "NASA GPM IMERG V07 Late daily rain, 0.1 degree (GES DISC)", "resolution": "area-level, about 10 km",
           "usual_years": f"2001 to the year before the newest data; months with fewer than 25 days of data are left out", "tanks": out}
    OUT.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} tanks, {skipped} without data, {len(days)} cached days")


if __name__ == "__main__":
    build()
