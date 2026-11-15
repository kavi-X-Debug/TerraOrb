# 🌍 TerraOrb (Monsoon Compass)
> **Your season's direction, read from space.**  
> *Translating NASA Earth Observation data into timely, transparent agricultural decisions for Sri Lanka's Dry Zone farmer organisations.*

[![NASA Space Apps Challenge 2026](https://img.shields.io/badge/NASA%20Space%20Apps-2026-blue.svg)](https://www.spaceappschallenge.org/)
[![Challenge](https://img.shields.io/badge/Challenge-Field%20Shift-orange.svg)](https://www.spaceappschallenge.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20First-emerald.svg)](web/)
[![Python 3.13](https://img.shields.io/badge/Python-3.13-blue.svg)](pipeline/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%2B%20SQLite-009688.svg)](backend/)

---

## 🌾 The Challenge
In Sri Lanka’s Dry Zone, ancient cascading tank systems (*Ellangawa*) have sustained communities for over two millennia. However, accelerating climate volatility has disrupted generational agricultural rhythms:
- **Erratic Monsoon Onset:** The start of the vital Yala and Maha rains can shift by weeks, causing farmers to miss critical planting windows.
- **Water Uncertainty at the Kanna Meeting:** Village farmer committees must decide collectively how much land to cultivate without knowing the true water extent of their reservoirs or seasonal evaporation risks.
- **Risk of Crop Failure:** Misjudging water capacity leads to devastating paddy crop loss, severe debt, and food insecurity.

**TerraOrb** solves this by putting satellite radar, optical surface reflectance, and 46 years of NASA agroclimatology directly into the hands of village farmers, agricultural instructors, and researchers.

---

## ✨ Key Features & User Ends

TerraOrb is built with dedicated interfaces tailored to different stakeholders in the agrarian ecosystem:

### 1. 🧑‍🌾 Farmer End (`/web/farmer.html`)
- **103 Village Tanks Mapped:** Pick any tank across Dry Zone cascade networks to inspect current water extent vs. historical 10-year normals.
- **Monsoon Onset Shift:** Visualizes 30+ year shift trends for Yala (March) and Maha (September) rains calculated with a 3-day 25mm threshold.
- **Green / Amber / Red Advice:** Clear, transparent seasonal strategy:
  - 🟢 **Full Paddy:** Safe to prepare 100% of command area for standard 3.5–4 month varieties.
  - 🟡 **Bethma Sharing:** Moderate water storage; calculates exact percentage of upper command area to share under traditional Bethma tenure using short-duration paddy.
  - 🔴 **Other Field Crops (OFC):** High water stress; recommends low-water alternative crops (mung bean, cowpea, black gram) to guarantee harvest.
- **12-Week Sowing Calendar & Weekly Advice:** Dynamic tasks with WhatsApp sharing cards for village councils.
- **Hyper-Local Nowcasting:** 16-day forecasts, hourly rain rates, and automated flood alert banners.

### 2. 🏛️ Agrarian Officer Dashboard (`/web/officer.html`)
- Real-time cascade-level oversight across administrative agrarian service divisions.
- Regional drought, flood alert indices, and automated reports for divisional Kannameetings.
- Regional active fires from NASA FIRMS and GRACE-FO groundwater anomalies.

### 3. 🔬 Research & Climate Lab (`/web/research.html`)
- Long-term agroclimatological trend analysis, backtesting validation statistics (79% accuracy vs. 57% baseline), and multi-sensor correlation tools.

### 4. 🎒 Trip & Field Event Planner (`/web/plan.html`)
- Event and field travel planner with rain probability tendencies, feel-like heat, and UV alerts.

### 5. 🎮 Learn Mode & Little Farmers (`/web/learn.html`)
- **16 Illustrated Lessons:** Visual stories covering El Niño, cascade cascades, soil moisture, and glaciers.
- **Mini-Games:** Crop memory, water sorting, and the **Tank Farmer** water economy simulator.
- **Rewards System:** Earn drops, badges, and printable agrarian certificates.

---

## 🛰️ NASA Earth Science Datasets Used

TerraOrb operates on a strict **"Zero Invented Data"** principle. Every metric shown carries its source label and uncertainty confidence:

| Dataset | Sensor / Platform | Usage in TerraOrb |
|---|---|---|
| **NASA POWER** | MERRA-2 Agroclimatology | 46 years of daily precipitation, max/min temperatures, and solar radiation (1981–2026) for onset detection & evapotranspiration (FAO Hargreaves-Samani). |
| **OPERA DSWx-HLS** | Landsat 8/9 & Sentinel-2 Fusion | 30-meter surface water dynamics measuring tank area extent vs. historical normal. |
| **HLS (HLSL30 / HLSS30)** | Landsat & Sentinel-2 | High-resolution surface reflectance for NDWI `(Green − NIR) / (Green + NIR)` water fallback. |
| **GPM IMERG** | Multi-satellite precipitation | Satellite precipitation rate mapping and real-time live rain nowcasting. |
| **MODIS & VIIRS** | Terra, Aqua, Suomi-NPP | True-color surface imagery, MOD13Q1 NDVI vegetation vigor, and land surface temperature. |
| **SMAP L3 & GLDAS-2.1** | Radiometer / Noah Model | Root-zone and top 5cm soil moisture anomalies to evaluate field saturation. |
| **NASA FIRMS** | MODIS Active Fire | Near real-time active thermal anomalies and agricultural burning tracking. |
| **GRACE-FO** | JPL Mascon | Terrestrial water storage and regional groundwater thickness dynamics. |
| **Open-Meteo** *(Credited)* | ECMWF / GFS | 16-day numerical weather forecast and hourly nowcast (clearly labeled "Not NASA data"). |

---

## 🏗️ Architecture & Philosophy
