"""
Tests for pipeline/rules.py. Every branch of the signal is covered, including the
boundaries (exactly 0.6, 0.9, 14 days) and missing values. No files are written.

    .venv\\Scripts\\python -m pytest pipeline\\tests -v
"""

import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # so "import rules" works
import rules  # noqa: E402

CFG = rules.load_config()
REPO = Path(__file__).resolve().parents[2]


def keys(fired):
    return [name for name, _ in fired]


# ---------------------------------------------------------------------------
# Signal: every branch, in the order the rules are checked
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("T, R, onset, signal, fired", [
    # red, first condition: T < 0.6
    (0.45, 1.20, 0,    "red",   ["tank_far_below_normal"]),
    # red, both conditions: far-below tank AND low rain (tank listed once)
    (0.45, 0.50, 0,    "red",   ["tank_far_below_normal", "rain_below_normal"]),
    # red, second condition only: T < 0.75 and R < 0.75 (also fits amber; red wins by order)
    (0.70, 0.70, 0,    "red",   ["tank_below_normal", "rain_below_normal"]),
    # boundary: T = 0.6 is not "< 0.6"; R = 0.75 is not "< 0.75" → not red, but T < 0.9 → amber
    (0.60, 0.75, 0,    "amber", ["tank_below_normal"]),
    # T < 0.75 but rain fine → not red; amber because T < 0.9
    (0.70, 0.80, 0,    "amber", ["tank_below_normal"]),
    # amber, both conditions
    (0.80, 1.00, 20,   "amber", ["tank_below_normal", "onset_late"]),
    # amber, onset only: everything else is green
    (0.95, 0.95, 15,   "amber", ["onset_late"]),
    # boundary: 14 days is not "> 14" → green
    (0.95, 0.95, 14,   "green", ["tank_normal", "rain_normal"]),
    # green exactly at the thresholds
    (0.90, 0.90, 0,    "green", ["tank_normal", "rain_normal"]),
    # otherwise amber: tank fine, rain below 0.9 (but not low enough for red)
    (0.95, 0.85, 0,    "amber", ["rain_below_normal"]),
])
def test_signal_branches(T, R, onset, signal, fired):
    got_signal, got_fired = rules.decide(T, R, onset, CFG)
    assert got_signal == signal
    assert keys(got_fired) == fired


def test_missing_rain_never_gives_green_or_the_rain_part_of_red():
    # T < 0.75 with unknown rain: the "T < 0.75 and R < 0.75" red rule can't fire → amber
    assert rules.decide(0.70, None, 0, CFG)[0] == "amber"
    # Tank fine, rain unknown: green needs R ≥ 0.9, so → otherwise amber, saying why
    signal, fired = rules.decide(1.02, None, 0, CFG)
    assert signal == "amber" and keys(fired) == ["rain_unknown"]


def test_missing_onset_never_fires_the_onset_rule():
    assert rules.decide(0.95, 0.95, None, CFG)[0] == "green"


def test_missing_tank_index_gives_no_signal():
    signal, fired = rules.decide(None, 0.95, 0, CFG)
    assert signal is None and keys(fired) == ["no_tank_data"]


def test_otherwise_amber_names_the_tank_when_green_threshold_is_higher():
    # Only reachable if someone sets green_T above amber_T in the config.
    cfg = dict(CFG, green_T=0.95)
    signal, fired = rules.decide(0.92, 0.95, 0, cfg)
    assert signal == "amber" and keys(fired) == ["tank_below_normal"]


def test_thresholds_come_from_the_config():
    cfg = dict(CFG, red_T=0.5)                       # loosen the red tank threshold
    assert rules.decide(0.55, 1.0, 0, CFG)[0] == "red"
    assert rules.decide(0.55, 1.0, 0, cfg)[0] == "amber"


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("signal, recommended", [
    ("green", "full_paddy"), ("amber", "short_paddy_bethma"), ("red", "ofc"), (None, None)])
def test_always_three_scenarios_with_one_marked(signal, recommended):
    out = rules.scenarios(signal, 0.72, CFG)
    assert [s["id"] for s in out] == ["full_paddy", "short_paddy_bethma", "ofc"]
    marked = [s["id"] for s in out if s["recommended"]]
    assert marked == ([recommended] if recommended else [])


def test_bethma_share_is_T_as_whole_percent():
    by_id = {s["id"]: s for s in rules.scenarios("amber", 0.724, CFG)}
    assert by_id["short_paddy_bethma"]["share_of_command_area"] == 0.72    # round(72.4) = 72 %
    assert by_id["full_paddy"]["share_of_command_area"] == 1.0
    assert by_id["ofc"]["crops"] == ["mung_bean", "cowpea", "black_gram"]


def test_bethma_share_never_above_100_percent_and_null_without_T():
    assert rules.scenarios("green", 1.30, CFG)[1]["share_of_command_area"] == 1.0
    assert rules.scenarios(None, None, CFG)[1]["share_of_command_area"] is None


# ---------------------------------------------------------------------------
# Reasons and the El Niño line
# ---------------------------------------------------------------------------
def tank_doc(T=0.35, R=0.70, onset=5, elnino=(2, 3), demo=False):
    return {
        "water": {"T": T, "source": "NASA HLS", "demo": demo},
        "rain": {"seasons": [{"season": "Maha 2025/26", "onset_delay_days": 30},
                             {"season": "Yala 2026", "onset_delay_days": onset}],
                 "current": None if R is None else {"R": R},
                 "source": "NASA POWER", "demo": False},
        "soil": None,
        "elnino": {"analog_seasons": ["Yala 1983", "Yala 1998", "Yala 2016"],
                   "below_normal_count": elnino[0], "total": elnino[1],
                   "source": "NASA POWER", "demo": False},
        "result": None,
    }


def test_reasons_store_text_key_value_and_source():
    result = rules.build_result(tank_doc(T=0.35, R=0.70), CFG, "now")
    assert result["signal"] == "red"
    assert result["reasons"][:2] == [
        {"text_key": "reason.tank_far_below_normal", "value": 35, "unit": "percent",
         "source": "NASA HLS", "kind": "rule"},
        {"text_key": "reason.rain_below_normal", "value": 70, "unit": "percent",
         "source": "NASA POWER", "kind": "rule"},
    ]


def test_onset_reason_uses_latest_season_in_days():
    result = rules.build_result(tank_doc(T=0.95, R=0.95, onset=21), CFG, "now")
    assert result["signal"] == "amber"
    assert result["reasons"][0] == {"text_key": "reason.onset_late", "value": 21, "unit": "days",
                                    "source": "NASA POWER", "kind": "rule"}
    assert result["inputs"]["onset_season"] == "Yala 2026"     # the last season, not Maha's 30 days


def test_elnino_line_is_a_count_never_a_percentage():
    line = rules.build_result(tank_doc(elnino=(2, 3)), CFG, "now")["reasons"][-1]
    assert line == {"text_key": "reason.elnino", "value": 2, "total": 3, "unit": "count",
                    "source": "NASA POWER", "kind": "outlook"}


def test_no_elnino_line_without_data():
    reasons = rules.build_result(tank_doc(elnino=(0, 0)), CFG, "now")["reasons"]
    assert all(r["text_key"] != "reason.elnino" for r in reasons)


def test_result_records_inputs_version_and_demo():
    result = rules.build_result(tank_doc(T=0.95, R=0.95, demo=True), CFG, "2026-10-25T10:00:00+05:30")
    assert result["inputs"] == {"T": 0.95, "R": 0.95, "S": None, "onset_delay_days": 5,
                                "onset_season": "Yala 2026"}
    assert result["rules_version"] == CFG["version"]
    assert result["updated"] == "2026-10-25T10:00:00+05:30"
    assert result["demo"] is True                    # water was demo → result is demo


def test_tank_file_without_water_or_rain_gives_no_signal():
    result = rules.build_result({"water": None, "rain": None}, CFG, "now")
    assert result["signal"] is None and result["recommended_scenario"] is None
    assert [r["text_key"] for r in result["reasons"]] == ["reason.no_tank_data"]


# ---------------------------------------------------------------------------
# Learn Mode cases
# ---------------------------------------------------------------------------
def learn_doc(pre_2017=10.0, season_2017=10.0, maha_total=500.0, yala_total=300.0):
    """Tank holds 20 ha in March and Apr–Aug of every year except 2017 (set by the arguments)."""
    series = []
    for year in (2016, 2017, 2018):
        for month in range(1, 13):
            ha = 20.0
            if year == 2017 and month == 3:
                ha = pre_2017
            elif year == 2017 and 4 <= month <= 8:
                ha = season_2017
            series.append({"date": f"{year}-{month:02d}-01", "extent_ha": ha})
    return {
        "water": {"series": series, "source": "NASA HLS", "demo": False},
        "rain": {"seasons": [
            {"season": "Maha 2016/17", "total_mm": maha_total, "normal_mm": 1000.0, "onset_delay_days": 3},
            {"season": "Yala 2017", "total_mm": yala_total, "normal_mm": 300.0, "onset_delay_days": 2}],
            "source": "NASA POWER", "demo": False},
    }


def test_learn_case_before_and_after_with_hindsight_best_choice():
    # Before: March tank 10 of a 20 ha normal (T 0.5), Maha rain 500 of 1000 (R 0.5) → red.
    # After: Apr–Aug tank 20 of 20 (T 1.0), Yala rain 300 of 300 (R 1.0) → green, so full paddy fitted.
    case = rules.build_case(learn_doc(pre_2017=10.0, season_2017=20.0), "Yala 2017", CFG)
    assert case["before"]["month"] == "2017-03"
    assert (case["before"]["T"], case["before"]["R"], case["before"]["prev_season"]) == (0.5, 0.5, "Maha 2016/17")
    assert (case["after"]["T"], case["after"]["R"], case["after"]["months_with_data"]) == (1.0, 1.0, 5)
    assert (case["signal_before"], case["advice_before"]) == ("red", "ofc")
    assert (case["signal_after"], case["best_scenario"]) == ("green", "full_paddy")
    assert case["outcomes"] == {"full_paddy": "right", "short_paddy_bethma": "too_careful", "ofc": "too_careful"}


def test_learn_outcomes_when_the_season_turned_out_dry():
    case = rules.build_case(learn_doc(pre_2017=20.0, season_2017=8.0, maha_total=1000.0), "Yala 2017", CFG)
    assert case["signal_after"] == "red" and case["best_scenario"] == "ofc"
    assert case["outcomes"] == {"full_paddy": "too_risky", "short_paddy_bethma": "too_risky", "ofc": "right"}


def test_learn_normal_leaves_out_the_season_year():
    # 2017's own low March value must not pull down its own normal: normal = 2016 and 2018 = 20 ha.
    case = rules.build_case(learn_doc(pre_2017=10.0), "Yala 2017", CFG)
    assert case["before"]["normal_ha"] == 20.0


def test_learn_skips_seasons_without_data():
    doc = learn_doc()
    assert rules.build_case(doc, "Yala 2019", CFG) is None                 # no rain season listed
    doc["water"]["series"] = []
    assert rules.build_case(doc, "Yala 2017", CFG) is None                 # no water → no signal


def test_maha_season_months_cross_the_year():
    assert rules.season_month_list("Maha 2017/18", CFG) == ["2017-10", "2017-11", "2017-12", "2018-01"]
    assert rules.previous_season("Maha 2017/18") == "Yala 2017"
    assert rules.previous_season("Yala 2017") == "Maha 2016/17"


def test_build_learn_marks_demo():
    doc = learn_doc()
    doc["water"]["demo"] = True
    learn = rules.build_learn(doc, dict(CFG, learn=dict(CFG["learn"], seasons=["Yala 2017"])), "now")
    assert len(learn["cases"]) == 1 and learn["demo"] is True and learn["cases"][0]["demo"] is True


# ---------------------------------------------------------------------------
# main(): writes only the result section, skips tanks without a file
# ---------------------------------------------------------------------------
def test_main_writes_only_result_and_learn(tmp_path, monkeypatch, capsys):
    (tmp_path / "data" / "tank").mkdir(parents=True)
    tanks = {"tanks": [{"id": "t1", "demo": False}, {"id": "no-file-yet", "demo": False}]}
    (tmp_path / "data" / "tanks.json").write_text(json.dumps(tanks), encoding="utf-8")
    doc = tank_doc(T=0.80, R=0.95, onset=3)
    doc["generated"] = "unchanged"
    (tmp_path / "data" / "tank" / "t1.json").write_text(json.dumps(doc), encoding="utf-8")

    monkeypatch.setattr(rules, "REPO", tmp_path)
    rules.main()

    after = json.loads((tmp_path / "data" / "tank" / "t1.json").read_text(encoding="utf-8"))
    assert after["result"]["signal"] == "amber"
    assert after["result"]["recommended_scenario"] == "short_paddy_bethma"
    for name in ("water", "rain", "soil", "elnino", "generated"):
        assert after[name] == doc[name]                 # untouched
    assert after["schema_version"] == rules.SCHEMA_VERSION and after["demo"] is False
    out = capsys.readouterr().out
    assert "no-file-yet" in out and "skipped" in out


# ---------------------------------------------------------------------------
# Every text key the rules can produce exists in the UI strings
# ---------------------------------------------------------------------------
def test_all_reason_and_scenario_keys_exist_in_strings_files():
    en = json.loads((REPO / "web" / "en.json").read_text(encoding="utf-8"))
    si = json.loads((REPO / "web" / "si.json").read_text(encoding="utf-8"))
    names = ["tank_far_below_normal", "tank_below_normal", "tank_normal", "rain_below_normal",
             "rain_normal", "rain_unknown", "onset_late", "no_tank_data", "elnino"]
    needed = [f"reason.{n}" for n in names] + [s["title_key"] for s in CFG["scenarios"]]
    needed += [f"crop.{c}" for s in CFG["scenarios"] for c in s["crops"]]
    assert [k for k in needed if k not in en] == []
    assert [k for k in needed if k not in si] == []
