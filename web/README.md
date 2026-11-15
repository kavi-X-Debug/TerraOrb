# web/ — the website (plain HTML/CSS/JS)

A static site for GitHub Pages: no server, no build step, no framework.
Leaflet draws the map, Chart.js draws the charts.

## Run it locally

The app reads `../data/`, so serve the **repo root**, then open `/web/`:

```
.venv\Scripts\python -m http.server 8000
```

→ <http://localhost:8000/web/>. (Opening `index.html` by double-click won't work: browsers
block `fetch` from `file://`.) On GitHub Pages, publish from the repo root; the app is then at
`https://<org>.github.io/<repo>/web/`.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell: top bar, map screen, tank screen, disclaimer. No UI text typed here |
| `css/style.css` | All styles. Mobile-first (360 px), side panel from 900 px. Colours as variables at the top |
| `js/main.js` | Starts the app; the address (`#/tank/<id>/tank` or `/plan`) decides the screen, so Back works |
| `js/i18n.js` | Loads `si.json` / `en.json`, `t(key, {vars})`, language switch (remembered in the browser) |
| `js/data.js` | Loads `../data/tanks.json` and every `../data/tank/<id>.json` |
| `js/map.js` | Screen 1: NASA GIBS base layer (+ street map), tank markers coloured by signal, legend |
| `js/tank.js` | Screen 2: wewa gauge (water now vs normal), water history, onset trend (Maha/Yala), this season vs normal |
| `js/plan.js` | Screen 3: big signal, three scenarios (recommended first), "Why?" reasons with source badges, El Niño line |
| `js/card.js` | One-page summary card (`#/tank/<id>/card`): "Print / PDF" uses the print stylesheet (only the card, black on white, A4); "Share" makes a 1080 px-wide PNG with html2canvas (loaded only when tapped) and opens the phone's share sheet, or downloads the PNG if sharing files isn't supported |
| `js/learn.js` | Learn Mode (`#/learn`), 4 steps: pick a tank and a real past season → what was known before (tank, rain; no signal shown) → choose full paddy / bethma / other field crops → what really happened and how the choice fared → two "Did you know?" cards. Reads the `learn` section written by rules.py |
| `js/forecast.js` | 16-day rain forecast: fetched live from Open-Meteo when online, else the copy saved in the tank's JSON (weather models, not NASA) |
| `js/live.js` | Live weather "right now" for all tanks (temperature, rain in the last hour, humidity, wind, cloud) from Open-Meteo, 50 tanks per request, kept 10 minutes. Nothing is saved or guessed: offline there is simply no live weather. Not NASA data |
| `js/weather.js` | Weather page (`#/tank/<id>/weather`), like a weather app: big card for the chosen day, tap-able 16-day strip with icons, (Advanced) rain chart, and a satellite map with NASA GPM IMERG rain and NASA VIIRS clouds through NASA GIBS. Icons use light / moderate / heavy rain classes of the India Meteorological Department |
| `js/ui.js` | Signal icons (colour + shape + symbol), source and Demo badges, number/date formats |

Signals never rely on colour alone: green = ✓ circle, amber = ! triangle, red = ✕ octagon,
no signal = grey ?, always with the word next to it.

## Where things come from

- **Data:** only from `../data/tanks.json` and `../data/tank/<id>.json`.
  The format is in [../docs/schema.md](../docs/schema.md). The web app never
  calls NASA APIs directly and never computes the signal itself; it shows what the
  JSON says.
- **Text:** only from `si.json` (Sinhala) and `en.json` (English).
  Never type UI text directly into HTML or JS.

## Strings files

- Both files have **exactly the same keys**. Add a key to both at the same time.
- `si.json` values start empty (`""`) until the team writes the Sinhala wording.
  The app shows the `en.json` text for any empty Sinhala value, so nothing appears blank.
- `{name}`-style placeholders are filled in by the code, e.g.
  `"In {count} of {total} strong El Niño years…"`. Keep the placeholders when translating.
- Keys starting with `_` are notes for translators, not UI text.

## Rules the UI must follow

- If a section has `"demo": true`, show the **Demo data** badge (`badge.demo`) next to it.
- Show the `source` label next to every value (`label.source` + the source text).
- If a value is `null`, show `state.no_data`. Never show 0 instead.
