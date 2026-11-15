# 🌍 TerraOrb (Monsoon Compass)

> **Your season's direction, read from space.**  
> Translating NASA Earth Observation data into timely agricultural decisions for Sri Lanka's Dry Zone farmer organisations.

[![NASA Space Apps 2026](https://img.shields.io/badge/NASA%20Space%20Apps-2026-blue.svg)](https://www.spaceappschallenge.org/)
[![Challenge: Field Shift](https://img.shields.io/badge/Challenge-Field%20Shift-orange.svg)](https://www.spaceappschallenge.org/)
[![PWA: Offline First](https://img.shields.io/badge/PWA-Offline%20First-emerald.svg)](web/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌾 What is TerraOrb?

In Sri Lanka's Dry Zone, ancient cascade tanks (*Ellangawa*) supply irrigation to village paddy fields. Climate volatility causes monsoon onset dates to shift drastically, making seasonal planning difficult for village *kanna* meetings.

TerraOrb maps **103 cascade tanks**, fusing satellite radar with 46 years of NASA agroclimatology to provide:
1. **Satellite Tank Water:** Current water extent vs. historical normal (30m resolution).
2. **Monsoon Shift Tracking:** Yala & Maha rainfall onset delays over 30+ years.
3. **Transparent Advisory:** Green / Amber / Red signals:
   - 🟢 **Full Paddy:** 100% command area under standard varieties.
   - 🟡 **Bethma Sharing:** Cultivate shared upper plots using short-duration paddy.
   - 🔴 **Alternative Crops:** Switch to drought-resilient mung bean, cowpea, or black gram.
4. **Live Nowcasting & Warnings:** 16-day forecasts, hourly rainfall, and flash flood alerts.
5. **Offline Support:** Full PWA service worker with Sinhala & English translations.

---

## 📱 App Interfaces

| End | URL | Focus |
|---|---|---|
| **Farmer** | [`web/farmer.html`](web/farmer.html) | Village tank finder, crop calendar, advice & WhatsApp share cards |
| **Officer** | [`web/officer.html`](web/officer.html) | Regional cascade oversight, FIRMS fire alerts & divisional reports |
| **Research** | [`web/research.html`](web/research.html) | Climate time series, GRACE-FO groundwater & backtest stats |
| **Plan** | [`web/plan.html`](web/plan.html) | Field travel planner with rain probability & heat indexes |
| **Learn** | [`web/learn.html`](web/learn.html) | 16 illustrated lessons, crop thirst mini-games & rewards |

---

## 🛰️ NASA Data Stack

| Dataset | Provider | Usage in TerraOrb |
|---|---|---|
| **NASA POWER** | MERRA-2 | 46 years of daily rainfall & temperature (1981–2026) for onset detection |
| **OPERA DSWx-HLS** | PO.DAAC | 30m satellite surface water extent vs. 10-year monthly baselines |
| **HLS (Landsat/Sentinel)** | LP DAAC | NDWI spectral water index fallback |
| **GPM IMERG** | NASA GIBS | Satellite precipitation rate & real-time nowcasting |
| **MODIS & VIIRS** | NASA GIBS | NDVI vegetation vigor, land temperature & active fires (FIRMS) |
| **GRACE-FO** | JPL | Terrestrial groundwater storage thickness anomalies |

---

## 🚀 Quickstart

Run the static web app locally (no Node or npm required):

```powershell
# From repository root
python -m http.server 8010
