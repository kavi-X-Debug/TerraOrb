"""Three rotation options (baseline from crop history, soil-building, water-saving) built from the filter, the scores and the rules.

farm_ctx (plain dict):
  zones: [zone_ctx + {id, area_ha}]           zone_ctx = {kind, slope_pct, wet_low, rain_mm_season, tmean_c, drainage, texture, ph,
                                                          water_source, erosion_level, bare_months, cold_season}
  priorities: {save_water, income, soil, low_work, family_food}      history: [{season, crop_id}] (oldest first)
  labour: low|medium|high      next_season: "maha"|"yala"      rain_by_season: {maha: mm, yala: mm} (optional)
  data_quality, local_verification: 0 to 1 (defaults 0.6 and 0.2: area-level data, nothing checked on the ground yet)
  scenario: set by apply_scenario
Every decision is appended to a rule trace: {rule, text_key, params, evidence, zone, season, crop_id}.
"""
from .confidence import confidence, evidence_value
from .fit import crop_fits
from .knowledge import FUNCTIONS
from .scoring import blend, family_penalty, pair_flags, score_crop

N_SEASONS = 4
DEFAULT_ZONE_WEIGHTS = {f: 0.25 for f in FUNCTIONS}           # used only when zone_weights.json has no entry; flagged as a gap
FALLBACK_TEMPLATES = {                                         # used only if rotation_templates.json is missing; flagged as a gap
    "soil_building": ["cereal", "legume", "green_manure", "cereal"],
    "water_saving": ["drought_tolerant_millet_or_pulse", "legume", "drought_tolerant_millet_or_pulse", "deep_rooted_or_cover"],
}
OPTION_NAMES = {1: ("baseline", "plan.option.baseline"), 2: ("soil_building", "plan.option.soil_building"),
                3: ("water_saving", "plan.option.water_saving")}


class Trace(list):
    def add(self, rule, text_key, params=None, evidence=None, **where):
        self.append({"rule": rule, "text_key": text_key, "params": params or {}, "evidence": evidence, **where})


def season_labels(next_season="maha"):
    order = ["maha", "yala"] if next_season != "yala" else ["yala", "maha"]
    return [order[i % 2] for i in range(N_SEASONS)]


def _is_legume(c):
    return c.get("type") == "legume" or (c.get("n_fixing") or 0) >= 1


def role_matches(crop, role, rules=None):
    """Does the crop fill this role? Uses role_rules from rotation_templates.json when present, else the built-in defaults."""
    t, fn = crop.get("type"), crop.get("functions", {}) or {}
    rule = (rules or {}).get(role)
    if rule:
        return (t in rule.get("types", [t]) and (crop.get("n_fixing") or 0) >= rule.get("n_fixing_min", 0)
                and all((fn.get(f) or 0) >= v for f, v in (rule.get("functions_min") or {}).items()))
    if role == "cereal":
        return t == "cereal"
    if role == "legume":
        return t == "legume"
    if role == "green_manure":
        return (crop.get("n_fixing") or 0) >= 2 and t in ("cover", "legume")
    if role == "deep_rooted_or_cover":
        return t in ("tree", "root", "cover")
    if role == "drought_tolerant_millet_or_pulse":
        return t in ("cereal", "legume") and (fn.get("drought") or 0) >= 2
    return True


def _season_ok(crop, season):
    return crop.get("season") in (None, "both", season)


def template_roles(knowledge, key):
    """-> (roles per season, season labels or None, used_fallback). Reads rotation_templates.json: {seasons: [{label, role}]}
    (also tolerates plain lists of role names)."""
    t = (knowledge.templates or {}).get(key)
    if isinstance(t, dict):
        t = t.get("seasons") or t.get("sequence") or t.get("roles")
    roles, labels = [], []
    for entry in t or []:
        label = None
        if isinstance(entry, dict):
            label = (entry.get("label") or entry.get("season") or "").lower() or None
            entry = entry.get("roles") or entry.get("role") or entry.get("crop_role")
        if isinstance(entry, str):
            entry = [entry]
        if entry:
            roles.append(list(entry))
            labels.append(label if label in ("maha", "yala") else None)
    if roles:
        return roles, (labels if all(labels) else None), False
    return [[r] for r in FALLBACK_TEMPLATES[key]], None, True


def _zone_for_season(zone, farm_ctx, season):
    z = dict(zone)
    if farm_ctx.get("rain_by_season", {}).get(season) is not None:
        z["rain_mm_season"] = farm_ctx["rain_by_season"][season]
    z.setdefault("water_source", farm_ctx.get("water_source"))
    return z


def _weights(zone, farm_ctx, knowledge, trace):
    zw = knowledge.zone_weights.get(zone["kind"])
    if not zw:
        if not any(e["text_key"] == "gap.no_zone_weights" and e["params"]["zone"] == zone["kind"] for e in trace):
            trace.add("missing_input", "gap.no_zone_weights", {"zone": zone["kind"]}, None, zone=zone.get("id"))
        zw = DEFAULT_ZONE_WEIGHTS
    return blend(zw, farm_ctx.get("priorities"), 0.7)


def _rank(zone, season, role, prev, knowledge, farm_ctx, trace=None, hedge=False):
    """Candidates passing the filter, best first. Each: {crop, fit, score, parts, penalty, bonus}."""
    out = []
    weights = _weights(zone, farm_ctx, knowledge, Trace() if trace is None else trace)
    zc = _zone_for_season(zone, farm_ctx, season)
    for crop in knowledge.crops.values():
        if hedge:
            if crop.get("type") != "hedge":
                continue
        elif crop.get("type") == "hedge" or not role_matches(crop, role, knowledge.role_rules) or not _season_ok(crop, season):
            continue
        fit = crop_fits(crop, zc)
        if fit["score"] <= 0:
            continue
        sc = score_crop(crop, weights)
        pen = family_penalty(prev, crop) if prev else 0.0
        bonus = 0.3 if (prev and _is_legume(prev) and crop.get("type") == "cereal") else 0.0
        if farm_ctx.get("labour") == "low" and crop.get("labour") == "high":
            pen += 0.3
        total = round(sc["score"] * fit["score"] + bonus - pen, 4)
        out.append({"crop": crop, "fit": fit, "score": total, "raw": sc["score"], "parts": sc["parts"], "penalty": pen, "bonus": bonus})
    return sorted(out, key=lambda c: (-c["score"], c["crop"]["id"]))


def _record_pick(trace, cand, zone, season, role):
    c = cand["crop"]
    trace.add("select_crop", "why.crop_selected", {"crop": c["id"], "role": role, "score": cand["score"], "zone_kind": zone["kind"]},
              c.get("evidence"), zone=zone.get("id"), season=season, crop_id=c["id"])
    if cand["fit"]["score"] < 1:
        trace.add("fit_marginal", "risk.marginal_fit", {"crop": c["id"], "tests": cand["fit"]["failed"]}, c.get("evidence"),
                  zone=zone.get("id"), season=season, crop_id=c["id"])
    for t in cand["fit"]["unknown"]:
        trace.add("missing_input", "gap.test_not_checked", {"crop": c["id"], "test": t}, None, zone=zone.get("id"), season=season, crop_id=c["id"])
    if cand["penalty"]:
        trace.add("family_penalty", "risk.penalty_applied", {"crop": c["id"], "penalty": cand["penalty"]}, c.get("evidence"),
                  zone=zone.get("id"), season=season, crop_id=c["id"])
    if cand["bonus"]:
        trace.add("legume_bonus", "why.legume_before_cereal", {"crop": c["id"], "bonus": cand["bonus"]}, c.get("evidence"),
                  zone=zone.get("id"), season=season, crop_id=c["id"])


def _cell(zone, season_no, season, cand, role, fit=None):
    c = cand["crop"] if cand else None
    return {"zone_id": zone.get("id"), "zone_kind": zone["kind"], "season_no": season_no, "season": season, "role": role,
            "crop_id": c["id"] if c else None, "name_en": c.get("name_en") if c else None, "name_si": c.get("name_si") if c else None,
            "fit": cand["fit"]["score"] if cand else 0, "score": cand["score"] if cand else 0, "evidence": c.get("evidence") if c else None}


def _fill_templates(farm_ctx, knowledge, key, trace):
    roles_per_season, labels, fallback = template_roles(knowledge, key)
    if fallback:
        trace.add("template_fallback", "gap.template_missing", {"template": key})
    seasons = labels or season_labels(farm_ctx.get("next_season", "maha"))
    last = (farm_ctx.get("history") or [{}])[-1].get("crop_id")
    rows, permanent = [], []
    prev_by_zone = {z.get("id"): knowledge.crops.get(last) for z in farm_ctx["zones"]}
    for i, season in enumerate(seasons):
        roles = roles_per_season[i % len(roles_per_season)]  # the template length sets the number of seasons
        cells = []
        for zone in farm_ctx["zones"]:
            prev, chosen, chosen_role = prev_by_zone.get(zone.get("id")), None, roles[0]
            for role in roles:
                ranked = _rank(zone, season, role, prev, knowledge, farm_ctx, trace)
                if ranked:
                    chosen, chosen_role = ranked[0], role
                    break
            if chosen:
                _record_pick(trace, chosen, zone, season, chosen_role)
                prev_by_zone[zone.get("id")] = chosen["crop"]
            else:
                trace.add("bare_season", "risk.bare_season", {"zone_kind": zone["kind"], "roles": roles}, None,
                          zone=zone.get("id"), season=season)
            cells.append(_cell(zone, i + 1, season, chosen, chosen_role))
        rows.append({"season_no": i + 1, "season": season, "zones": cells})
    for zone in farm_ctx["zones"]:                                  # contour hedge on sloping ground
        if zone["kind"] in ("steep", "very_steep"):
            ranked = _rank(zone, seasons[0], None, None, knowledge, farm_ctx, Trace(), hedge=True)
            if ranked:
                cand = ranked[0]
                trace.add("select_hedge", "why.contour_hedge", {"crop": cand["crop"]["id"], "zone_kind": zone["kind"]},
                          cand["crop"].get("evidence"), zone=zone.get("id"), crop_id=cand["crop"]["id"])
                permanent.append(_cell(zone, 0, "perennial", cand, "hedge"))
    return rows, permanent


def _baseline(farm_ctx, knowledge, trace):
    seasons = season_labels(farm_ctx.get("next_season", "maha"))
    seq = [h["crop_id"] for h in (farm_ctx.get("history") or [])][-2:]
    rows = []
    if not seq:
        trace.add("no_history", "gap.no_crop_history", {})
    for i, season in enumerate(seasons):
        cells = []
        for zone in farm_ctx["zones"]:
            cid = seq[i % len(seq)] if seq else None
            crop = knowledge.crops.get(cid) if cid else None
            if cid and not crop:
                trace.add("missing_input", "gap.crop_not_in_knowledge", {"crop": cid}, None, zone=zone.get("id"), season=season)
            if crop:
                fit = crop_fits(crop, _zone_for_season(zone, farm_ctx, season))
                sc = score_crop(crop, _weights(zone, farm_ctx, knowledge, trace))
                cand = {"crop": crop, "fit": fit, "score": round(sc["score"] * fit["score"], 4), "penalty": 0.0, "bonus": 0.0}
                if fit["score"] == 0:
                    trace.add("baseline_unfit", "risk.baseline_does_not_fit", {"crop": cid, "tests": fit["failed"]}, crop.get("evidence"),
                              zone=zone.get("id"), season=season, crop_id=cid)
                else:
                    _record_pick(trace, cand, zone, season, "as_before")
                cells.append(_cell(zone, i + 1, season, cand, "as_before"))
            else:
                cells.append(_cell(zone, i + 1, season, None, "as_before"))
        rows.append({"season_no": i + 1, "season": season, "zones": cells})
    return rows, []


def _post_rules(rows, knowledge, trace):
    """Rules over a whole sequence: repeated family, no legume in two seasons, conflicting pairs."""
    by_zone = {}
    for row in rows:
        for cell in row["zones"]:
            by_zone.setdefault(cell["zone_id"], []).append((row["season"], cell))
    for zid, items in by_zone.items():
        crops = [knowledge.crops.get(c["crop_id"]) if c["crop_id"] else None for _, c in items]
        for i in range(1, len(crops)):
            if crops[i] and crops[i - 1] and family_penalty(crops[i - 1], crops[i]) and items[i][1]["role"] == "as_before":
                trace.add("family_penalty", "risk.same_family_repeated", {"crop": crops[i]["id"], "family": crops[i].get("family")},
                          crops[i].get("evidence"), zone=zid, season=items[i][0], crop_id=crops[i]["id"])
        for i in range(1, len(crops)):
            if all(c is not None and not _is_legume(c) for c in crops[i - 1:i + 1]):
                trace.add("no_legume", "risk.no_legume_two_seasons", {"seasons": [items[i - 1][0], items[i][0]]}, None, zone=zid, season=items[i][0])
        for flag in pair_flags([c for c in crops if c]):
            trace.add("pair_conflict", "risk.crop_conflict", flag, flag.get("evidence"), zone=zid)


def _benefits(rows, permanent, knowledge):
    crops = [knowledge.crops[c["crop_id"]] for r in rows for c in r["zones"] if c["crop_id"] in knowledge.crops]
    crops += [knowledge.crops[c["crop_id"]] for c in permanent if c["crop_id"] in knowledge.crops]
    if not crops:
        return {"water": None, "soil": None, "income": None}
    m = lambda f: round(sum((c.get("functions", {}) or {}).get(f, 0) for c in crops) / len(crops), 2)
    return {"water": m("drought"), "soil": round((m("erosion") + m("organic_matter")) / 2, 2), "income": m("income")}


def build_options(farm_ctx, knowledge):
    """-> [option1, option2, option3] (baseline, soil-building, water-saving), each a full card incl. its rule trace."""
    options = []
    for no, (key, name_key) in OPTION_NAMES.items():
        trace = Trace()
        rows, permanent = _baseline(farm_ctx, knowledge, trace) if no == 1 else _fill_templates(farm_ctx, knowledge, key, trace)
        _post_rules(rows, knowledge, trace)
        used = {c["crop_id"] for r in rows for c in r["zones"] if c["crop_id"]} | {c["crop_id"] for c in permanent}
        levels = sorted({knowledge.crops[i].get("evidence") or "assumption" for i in used if i in knowledge.crops})
        score, klass = confidence(farm_ctx.get("data_quality", 0.6), evidence_value(levels), farm_ctx.get("local_verification", 0.2))
        trace.add("confidence", "confidence.computed", {"score": score, "class": klass, "evidence_levels": levels,
                                                       "weights": [0.4, 0.3, 0.3]}, None)
        sloping = any(z["kind"] in ("steep", "very_steep") for z in farm_ctx["zones"])
        options.append({
            "option_no": no, "key": key, "name_key": name_key, "seasons": rows, "permanent": permanent,
            "benefits": _benefits(rows, permanent, knowledge), "evidence_levels": levels,
            "confidence": {"score": score, "class": klass},
            "needs_officer": bool(sloping or klass == "low" or set(levels) & {"V2", "V3", "assumption"}),
            "trace": list(trace),
        })
    return options


def excluded_crops(farm_ctx, knowledge):
    """'Why not' list: per zone, crops that fail the filter in the first season, with the failed tests."""
    season = season_labels(farm_ctx.get("next_season", "maha"))[0]
    out = []
    for zone in farm_ctx["zones"]:
        zc = _zone_for_season(zone, farm_ctx, season)
        for crop in knowledge.crops.values():
            fit = crop_fits(crop, zc)
            if fit["score"] == 0:
                out.append({"zone_id": zone.get("id"), "zone_kind": zone["kind"], "crop_id": crop["id"], "name_en": crop.get("name_en"),
                            "name_si": crop.get("name_si"), "failed": [f for f in fit["failed"] if f["status"] == "fail"]})
    return out
