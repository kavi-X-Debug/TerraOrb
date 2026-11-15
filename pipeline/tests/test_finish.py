"""Tests for pipeline/finish.py (the last check before data is published)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import finish" works
import finish  # noqa: E402


def make_data(tmp_path, tank_doc=None, raw=None):
    data = tmp_path / "data"
    (data / "tank").mkdir(parents=True)
    (data / "tanks.json").write_text(json.dumps({"generated": "old", "tanks": [{"id": "t1"}]}), encoding="utf-8")
    doc = tank_doc or {k: None for k in finish.TANK_SECTIONS}
    doc.setdefault("id", "t1")
    if doc["id"] is None:
        doc["id"] = "t1"
    (data / "tank" / "t1.json").write_text(raw if raw is not None else json.dumps(doc), encoding="utf-8")
    return data


def test_good_data_passes_and_gets_stamped(tmp_path):
    data = make_data(tmp_path)
    assert finish.check_data(data) == []
    finish.stamp(data, "2026-11-14T06:00:00+05:30")
    assert json.loads((data / "tanks.json").read_text(encoding="utf-8"))["generated"] == "2026-11-14T06:00:00+05:30"


def test_nan_is_rejected(tmp_path):
    # Python's json.dumps writes NaN for float("nan"), which browsers can't parse.
    raw = json.dumps({**{k: None for k in finish.TANK_SECTIONS}, "id": "t1", "water": {"T": float("nan")}})
    assert "NaN" in raw
    problems = finish.check_data(make_data(tmp_path, raw=raw))
    assert len(problems) == 1 and "NaN" in problems[0]


def test_missing_section_and_wrong_id_are_reported(tmp_path):
    doc = {k: None for k in finish.TANK_SECTIONS if k != "rain"}
    doc["id"] = "other"
    problems = finish.check_data(make_data(tmp_path, tank_doc=doc))
    assert any("missing rain" in p for p in problems)
    assert any("expected 't1'" in p for p in problems)


def test_missing_tank_file_and_broken_json_are_reported(tmp_path):
    data = make_data(tmp_path)
    (data / "tank" / "t1.json").unlink()
    (data / "validation.json").write_text("{ not json", encoding="utf-8")
    problems = finish.check_data(data)
    assert any("t1.json: missing" in p for p in problems)
    assert any(p.startswith("validation.json") for p in problems)


def test_main_writes_nothing_when_a_check_fails(tmp_path, monkeypatch):
    data = make_data(tmp_path, raw="{ broken")
    monkeypatch.setattr(finish, "REPO", tmp_path)
    try:
        finish.main()
    except SystemExit as stop:
        assert stop.code == 1
    else:
        raise AssertionError("finish.main() should have stopped")
    assert json.loads((data / "tanks.json").read_text(encoding="utf-8"))["generated"] == "old"
