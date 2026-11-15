"""Loads the knowledge base (backend/knowledge/*.json). Missing files give empty tables and are listed in `missing`
(the engine then says so in its output; it never fills the gap with invented values)."""
import json
from dataclasses import dataclass, field
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge"
FUNCTIONS = ("erosion", "drought", "income", "organic_matter")


@dataclass
class Knowledge:
    crops: dict = field(default_factory=dict)            # id -> crop dict
    zone_weights: dict = field(default_factory=dict)     # zone kind -> {function: weight}
    templates: dict = field(default_factory=dict)        # id (soil_building / water_saving) -> template
    role_rules: dict = field(default_factory=dict)       # role -> {types, n_fixing_min, functions_min}
    claims: list = field(default_factory=list)
    glossary: list = field(default_factory=list)
    missing: list = field(default_factory=list)


def _read(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _items(data, *keys):
    """A file may be a bare list or an object holding the list under one of `keys`."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), list):
                return data[key]
    return []


def load_knowledge(directory=None) -> Knowledge:
    d = Path(directory) if directory else KNOWLEDGE_DIR
    k = Knowledge()
    crops = _read(d / "crops.json")
    if crops is None:
        k.missing.append("crops.json")
    k.crops = {c["id"]: c for c in _items(crops, "crops") if isinstance(c, dict) and "id" in c}
    for fname, attr, keys in (("claims.json", "claims", ("claims",)), ("glossary.json", "glossary", ("glossary", "terms"))):
        data = _read(d / fname)
        if data is None:
            k.missing.append(fname)
        setattr(k, attr, _items(data, *keys))
    zw = _read(d / "zone_weights.json")
    if not isinstance(zw, dict):
        k.missing.append("zone_weights.json")
    else:
        zones = zw.get("zones") if isinstance(zw.get("zones"), dict) else zw
        k.zone_weights = {kind: v for kind, v in zones.items() if isinstance(v, dict) and not kind.startswith("_")}
    rt = _read(d / "rotation_templates.json")
    if not isinstance(rt, dict):
        k.missing.append("rotation_templates.json")
    else:
        tpl = rt.get("templates")
        k.templates = {t["id"]: t for t in tpl if isinstance(t, dict) and "id" in t} if isinstance(tpl, list) else             {key: v for key, v in rt.items() if not key.startswith("_") and key != "role_rules"}
        k.role_rules = rt.get("role_rules") or {}
    return k
