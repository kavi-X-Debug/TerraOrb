"""
Final check before data is published
====================================

    .venv\\Scripts\\python pipeline\\finish.py        (run from the repo root, after rules.py)

The daily GitHub Actions refresh runs this last. It:
  1. checks every JSON file in data/ — valid strict JSON (no NaN / Infinity), the
     required sections present, ids matching file names;
  2. only if everything is fine, writes today's date and time into data/tanks.json
     ("generated"), which the web app shows as "Data updated …".

If any check fails it exits with an error, writes nothing, and the workflow does not
commit, so the site keeps yesterday's data.
(Each tank file already carries its own "generated" time, written by the pipeline steps.)
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
TANK_SECTIONS = ("schema_version", "id", "generated", "demo", "water", "rain", "elnino", "result")


def _reject_constant(name):
    raise ValueError(f"{name} is not valid JSON")


def load_strict(path):
    """Parse JSON, refusing NaN / Infinity (Python writes them, browsers can't read them)."""
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)


def check_data(data_dir):
    """Return a list of problems (empty list = all good)."""
    problems = []
    try:
        tanks = load_strict(data_dir / "tanks.json")["tanks"]
    except Exception as err:                      # noqa: BLE001 — report any reason
        return [f"tanks.json: {err}"]

    for tank in tanks:
        path = data_dir / "tank" / f"{tank.get('id')}.json"
        if not path.exists():
            problems.append(f"{path.name}: missing (listed in tanks.json)")
            continue
        try:
            doc = load_strict(path)
        except Exception as err:                  # noqa: BLE001
            problems.append(f"{path.name}: {err}")
            continue
        missing = [k for k in TANK_SECTIONS if k not in doc]
        if missing:
            problems.append(f"{path.name}: missing {', '.join(missing)}")
        if doc.get("id") != tank["id"]:
            problems.append(f"{path.name}: id is {doc.get('id')!r}, expected {tank['id']!r}")

    for path in data_dir.glob("*.json"):
        if path.name != "tanks.json":
            try:
                load_strict(path)
            except Exception as err:              # noqa: BLE001
                problems.append(f"{path.name}: {err}")
    return problems


def stamp(data_dir, now):
    path = data_dir / "tanks.json"
    doc = load_strict(path)
    doc["generated"] = now
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    data_dir = REPO / "data"
    problems = check_data(data_dir)
    if problems:
        print("STOPPED: the data is not safe to publish. Nothing was written.")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    now = datetime.now(SRI_LANKA).replace(microsecond=0).isoformat()
    stamp(data_dir, now)
    print(f"All data files OK. data/tanks.json stamped {now}.")


if __name__ == "__main__":
    main()
