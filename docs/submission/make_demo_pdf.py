"""Build docs/submission/TerraOrb-Demo.html from the screenshots in shots/.
Print it to PDF with headless Chrome (see the command at the end of SUBMISSION.md)."""
from pathlib import Path

HERE = Path(__file__).parent
SHOTS = HERE / "shots"

SECTIONS = [
    ("Landing page", "terraorb.pages.dev/web/", "One entry page leads to five apps (\"ends\") for five kinds of users.", [
        ("00-landing-hero", "The landing page. Sinhala first, with English one tap away."),
        ("01-landing-services", "The services: each end is built for one kind of user."),
    ]),
    ("1. Farmer", "farmer.html", "For Dry Zone farmer organisations: pick your village tank and get a season plan in plain words.", [
        ("10-farmer-home", "Tank finder: search or tap one of the 103 mapped village tanks."),
        ("11-farmer-plan", "Season plan for Nuwara Wewa: an amber signal, short-duration paddy, and what to sow now."),
        ("12-farmer-tank", "Tank water from NASA OPERA DSWx-HLS (30 m) against the usual for the month, with a 2-week rain forecast."),
        ("13-farmer-crops", "What to sow now: crop advice from NASA POWER rain history (\"enough rain in 39 of the last 45 years\")."),
        ("14-farmer-weather", "Weather: 16-day forecast, live rain and NASA GIBS satellite layers (IMERG rain, clouds)."),
        ("15-farmer-week", "This week's advice: short weekly tasks, ready to share on WhatsApp."),
        ("16-farmer-card", "Summary card to print or share at the village (kanna) meeting."),
        ("17-farmer-calendar", "12-week sowing calendar."),
    ]),
    ("2. Learn", "learn.html", "For students, children and young farmers: lessons and games built on real rain, tank and crop data.", [
        ("20-learn-home", "Learn Mode home, with rewards and badges saved on the device. No account needed."),
        ("21-learn-lessons", "16 \"Little Lessons\": the water cycle, monsoons, tank cascades, satellites, El Nino, global warming and more."),
        ("22-learn-lesson-water", "A lesson: a picture story with a small game at the end."),
        ("23-learn-kids", "Little Farmers' Games for small children."),
        ("24-learn-play", "Tank Farmer: a mini game in which crop thirst comes from real data."),
        ("25-learn-farm", "My Farm: plant and upgrade crops. The cost is each crop's real water need."),
        ("26-learn-challenges", "Practice challenges for students: a quiz plus games that read real tank data."),
        ("27-learn-rewards", "Rewards: levels, 19 badges and a printable certificate."),
    ]),
    ("3. Officer", "officer.html", "For agricultural officers and instructors: every tank at a glance.", [
        ("30-officer-home", "Officer home: what the dashboard offers."),
        ("31-officer-dashboard", "Sign-in by phone number with a one-time code. Inside: all tanks by signal, filters, CSV export, NASA FIRMS fires and GRACE-FO water storage."),
    ]),
    ("4. Research", "research.html", "For researchers and judges: how every number is made, and where the method does not work.", [
        ("40-research-home", "Research home: method, tests and known problems, in the open."),
        ("41-research-national", "Data sources table (NASA vs not NASA) and accuracy tests: the crop advice beat guessing in the backtest."),
    ]),
    ("5. Plan", "plan.html", "A weather-aware trip and field-visit planner: live forecast for 16 days, then NASA POWER history beyond that.", [
        ("50-plan-home", "Plan home: where and when, then \"Will it rain?\""),
        ("51-plan-explore", "Explore destinations on a map with NASA GIBS layers."),
        ("52-plan-place", "One place in detail: rain, heat, wind and UV warnings, sunrise and sunset, what to bring."),
        ("53-plan-rain", "Will it rain? An hour-by-hour view."),
        ("54-plan-compare", "Compare two places side by side."),
        ("55-plan-copilot", "A rule-based copilot for trip questions."),
    ]),
]

css = """
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #10231a; }
.page { width: 297mm; height: 210mm; padding: 12mm 16mm; page-break-after: always; position: relative; overflow: hidden; }
.cover { background: #0c1f17; color: #eaf5ee; display: flex; flex-direction: column; justify-content: center; }
.cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .35; }
.cover .t { position: relative; }
.cover h1 { font-size: 54pt; margin: 0 0 4mm; }
.cover p { font-size: 16pt; margin: 2mm 0; max-width: 190mm; }
.tag { display: inline-block; background: #3fd08a; color: #06210f; padding: 1.5mm 4mm; border-radius: 10mm; font-weight: 700; font-size: 11pt; }
.sec { background: #f4efe4; display: flex; flex-direction: column; justify-content: center; }
.sec h2 { font-size: 40pt; margin: 0 0 3mm; color: #1d5b3a; }
.sec .url { font-family: Consolas, monospace; font-size: 13pt; color: #555; }
.sec p { font-size: 17pt; max-width: 220mm; }
.shot h3 { margin: 0 0 3mm; font-size: 15pt; color: #1d5b3a; }
.shot img { display: block; width: 100%; height: 155mm; object-fit: contain; object-position: top; border: 1px solid #ccd; border-radius: 2mm; background: #fafafa; }
.shot .cap { font-size: 13pt; margin-top: 3mm; }
.foot { position: absolute; bottom: 6mm; right: 16mm; font-size: 9pt; color: #888; }
ul { font-size: 14pt; line-height: 1.5; }
"""

pages = []
pages.append(f"""<section class="page cover"><img src="shots/00-landing-hero.jpg"><div class="t">
<span class="tag">NASA Space Apps Challenge 2026 &middot; Field Shift: Adapting Farms with NASA Data</span>
<h1>TerraOrb</h1><p><b>Your season's direction, read from space.</b></p>
<p>NASA Earth observation data turned into plain-language planting decisions for Sri Lanka's Dry Zone village tank farmers. Five apps, one data source.</p>
<p style="margin-top:8mm">Live: <b>https://terraorb.pages.dev</b><br>Team: [TEAM NAME] &middot; [MEMBER NAMES]</p>
<p style="font-size:10pt;opacity:.8">Demonstration: screenshots of the live website, 15 November 2026. Some pictures on the site were AI-generated (Google Flow, Canva) and are labelled as such.</p>
</div></section>""")
pages.append("""<section class="page sec"><h2>The five ends</h2><ul>
<li><b>Farmer</b>: tank water vs usual, when the rains started, a green / amber / red season plan, what to sow, weekly advice and a share card.</li>
<li><b>Learn</b>: 16 picture lessons, children's games and challenges built on real data, with rewards.</li>
<li><b>Officer</b>: a dashboard of all 103 tanks, NASA FIRMS fires and GRACE-FO water storage.</li>
<li><b>Research</b>: the method, the backtests, the known data problems and the national NASA layers.</li>
<li><b>Plan</b>: trip and field-visit planning with a live forecast and NASA POWER history.</li></ul>
<p style="font-size:13pt"><b>NASA data:</b> POWER &middot; OPERA DSWx-HLS &middot; HLS &middot; MODIS NDVI, ET, LST &middot; SMAP &middot; GLDAS &middot; GPM IMERG &middot; FIRMS &middot; GRACE-FO &middot; NASADEM &middot; GIBS</p></section>""")
n = 0
for title, url, lead, shots in SECTIONS:
    pages.append(f'<section class="page sec"><div class="url">terraorb.pages.dev/web/{url if url.endswith(".html") else ""}</div><h2>{title}</h2><p>{lead}</p></section>')
    for name, cap in shots:
        if not (SHOTS / f"{name}.jpg").exists():
            continue
        n += 1
        pages.append(f'<section class="page shot"><h3>{title}</h3><img src="shots/{name}.jpg"><div class="cap">{cap}</div><div class="foot">TerraOrb &middot; {n}</div></section>')
pages.append("""<section class="page sec"><h2>Mobile first</h2><div style="display:flex;gap:12mm;align-items:center">
<img src="shots/18-farmer-mobile.jpg" style="height:165mm;border:1px solid #ccc;border-radius:4mm">
<p>Built for farmers' phones: works offline as a web app (PWA), uses plain words and Sinhala first, and every number shows where it comes from.<br><br><b>Try it:</b> https://terraorb.pages.dev</p></div></section>""")

html = f"<!doctype html><html><head><meta charset='utf-8'><title>TerraOrb demo</title><style>{css}</style></head><body>{''.join(pages)}</body></html>"
(HERE / "TerraOrb-Demo.html").write_text(html, encoding="utf-8")
print("pages:", len(pages))
