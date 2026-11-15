"""
Makes the entry pages ("ends") of TerraOrb, one web address per kind of user:

    web/farmer.html    farmers          tank advice, rain alerts, weekly advice, sowing calendar
    web/learn.html     students         Learn Mode: lessons, games, rewards
    web/officer.html   officers         dashboard of all tanks, CSV download, printable report
    web/research.html  judges / research  method, sources, accuracy tests, data downloads
    web/plan.html      trip and event planners   rain and weather for any place and day

All five are the same app (js/main.js); only the page title, the menu, the web-app manifest and
<body data-end="..."> differ. The page opens on its own home screen (see END in js/main.js).
web/index.html is the separate chooser page that links to them (written by hand, not generated).

Run from the repo root after editing tools/ends/template.html or ENDS below:
    .venv\\Scripts\\python tools\\make_ends.py
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web"
TEMPLATE = (REPO / "tools" / "ends" / "template.html").read_text(encoding="utf-8")

link = lambda href, key, text: f'        <a href="{href}" data-i18n="{key}">{text}</a>'

ENDS = {
    "farmer": {
        "title": "TerraOrb: for farmers",
        "desc": "Tank water, rain and crop advice for Sri Lanka's Dry Zone farmers, from NASA data.",
        "manifest": ("TerraOrb: Farmers", "Farmers", "farmer.html", "#2B5430"),
        "nav": [("#/", "site.nav.tanks", "Tanks"), ("#/calendar", "site.nav.calendar", "Sowing calendar"),
                ("#/farm", "farm.nav", "My farm plan"), ("#/how-it-works", "nav.about", "How it works")],
    },
    "learn": {
        "title": "TerraOrb: learn and play",
        "desc": "Lessons, games and rewards about water, farming and our climate, for children and students.",
        "manifest": ("TerraOrb: Learn", "Learn", "learn.html", "#2477B0"),
        "nav": [("#/learn", "end.learn.nav.home", "Learn home"), ("#/learn/lessons", "lh.card.lessons.title", "Little Lessons"),
                ("#/learn/kids", "mg.entry_title", "Games"), ("#/learn/challenges", "challenge.entry_title", "Challenges"),
                ("#/learn/rewards", "rw.title", "My rewards")],
    },
    "officer": {
        "title": "TerraOrb: for officers",
        "desc": "A dashboard of every tank for agricultural officers and instructors, with downloads and printable reports.",
        "manifest": ("TerraOrb: Officers", "Officers", "officer.html", "#1F5E85"),
        "nav": [("#/officer", "end.officer.nav", "Dashboard"), ("#/calendar", "site.nav.calendar", "Sowing calendar"),
                ("#/how-it-works", "nav.about", "How it works")],
    },
    "research": {
        "title": "TerraOrb: method and data",
        "desc": "How TerraOrb works: NASA data sources, accuracy tests, crop numbers with their sources, and data downloads.",
        "manifest": ("TerraOrb: Method and data", "Method", "research.html", "#5B3F8C"),
        "nav": [("#/research", "end.research.nav", "Method and data"), ("#/how-it-works", "nav.about", "How it works")],
    },
    "plan": {
        "title": "TerraOrb: plan a trip or event",
        "desc": "Will it rain? Rain, heat and the best days for a trip or an event at any place in Sri Lanka.",
        "manifest": ("TerraOrb: Trips and events", "Plan", "plan.html", "#B7791F"),
        "nav": [("#/plan", "end.plan.nav", "Plan a trip or event")],
    },
}

for end, cfg in ENDS.items():
    nav = "\n".join(link(h, k, t) for h, k, t in cfg["nav"])
    page = (TEMPLATE.replace("{{TITLE}}", cfg["title"]).replace("{{DESC}}", cfg["desc"])
            .replace("{{MANIFEST}}", f"manifest-{end}.webmanifest").replace("{{END}}", end)
            .replace("{{NAV}}", nav).replace("{{FOOTER_LINKS}}", "\n".join(link(h, k, t).replace("        ", "        ") for h, k, t in cfg["nav"])))
    (WEB / f"{end}.html").write_text(page, encoding="utf-8")

    name, short, start, colour = cfg["manifest"]
    manifest = {
        "name": name, "short_name": short, "description": cfg["desc"], "lang": "si",
        "start_url": start, "scope": "./", "display": "standalone",
        "background_color": "#FBF6EA", "theme_color": colour,
        "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                  {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                  {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    }
    (WEB / f"manifest-{end}.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("wrote", f"web/{end}.html", f"web/manifest-{end}.webmanifest")
