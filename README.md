# Monsoon Compass

*Your season's direction, read from space.*

A mobile-first web tool for farmer organisations in Sri Lanka's Dry Zone.
Pick a village tank (wewa) on the map and see:

1. the tank's water extent now vs normal (satellite data),
2. how the village's Yala and Maha rainfall onset has shifted over 30 years,
3. a green / amber / red signal and three scenarios for the 2027 Yala season,
4. the NASA data reason behind each recommendation,
5. a one-page summary card to share.

NASA Space Apps Challenge 2026 · *Field Shift: Adapting Farms with NASA Data*.
Demo scope: one tank cascade in Anuradhapura District, 10–20 tanks.

## Repository layout

```
pipeline/   Python: fetch NASA data, compute indices, run the rule engine → writes JSON into data/
data/       Generated JSON. The web app reads ONLY this folder.
  tanks.json        list of tanks (map markers)
  tank/<id>.json    everything about one tank
web/        Plain HTML/CSS/JS + Leaflet + Chart.js. Static site for GitHub Pages.
  si.json, en.json  every piece of UI text (Sinhala first)
docs/       Documentation. Start with docs/schema.md.
```

## The one rule that keeps the team unblocked

The pipeline, the rule engine and the web app **never import each other's code**.
They share only the JSON files described in [docs/schema.md](docs/schema.md).
If you need a new field, change `schema.md` first, tell the team, then change the code.

## Deploying

Free hosting on GitHub Pages, with a daily data refresh by GitHub Actions and offline
support in the browser. Step by step: [docs/deploy.md](docs/deploy.md).

## Team rules

- **Never invent data.** If a fetch fails, the pipeline stops and says so.
- **Placeholders are marked** `"demo": true` and the UI shows a **Demo data** badge.
- **Every value shown has a source label.**
- **All UI text lives in `web/si.json`** (and `web/en.json`), never hard-coded in HTML/JS.
