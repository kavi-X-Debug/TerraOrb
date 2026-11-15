# TerraOrb — 30-second demo video script (DRAFT)

> **Draft for the team.** Narration is in English; translate it into Sinhala (with English
> subtitles) when recording. All app numbers come from `data/tank/demo-tank-2.json`, a
> **placeholder tank**: keep the app's "Demo data" badge visible in every app shot.
> Screen captures: run the app locally (`web/README.md`) at phone size (360 × 760).

**Length:** 30 s · **Narration:** about 70 words · **Hero tank:** Demo tank 2 (amber)

| Time | Picture | Narration | On-screen text |
|---|---|---|---|
| **0:00–0:05** | A farmer organisation meeting under a tree by a village tank bund (team footage or a still photo). The leader holds a phone. | "Yala 2027 is coming. How much land should our farmer organisation plant?" | *Kanna meeting · Yala 2027* |
| **0:05–0:11** | App: tap the tank on the NASA satellite map. The tank screen opens; the wewa gauge fills to **72 %**, then the water history chart slides down to its last point. | "Our tank holds 6.9 hectares: 72 percent of normal for October." | *6.9 ha now, normal 9.6 ha: 72 %* · badge *Demo data* · *NASA OPERA DSWx-HLS / HLS (planned)* |
| **0:11–0:17** | Onset chart (Maha, then Yala) with the dashed trend line. Highlight two bars: **Maha 2025/26: 27 days late** and **Yala 2026: 17 days late**. | "And the rains came late: 27 days last Maha, 17 days in Yala." | *Rains started 27 and 17 days late* · *NASA POWER* |
| **0:17–0:25** | Season plan tab: the big **Amber** signal. Recommended card: **short-duration paddy + bethma, 72 % of the command area**. Tap **Why?**: the reasons appear with NASA source badges. | "TerraOrb says amber: short-duration paddy, with bethma on 72 percent of the land, and shows the NASA data behind every reason." | *Amber · Bethma on 72 %* |
| **0:25–0:30** | Zoom out from the tank to the whole Dry Zone on the satellite map. End card: logo, tagline, disclaimer. | "One method, for every village tank. Sri Lanka has around 23,000." | *TerraOrb: your season's direction, read from space* · *A decision aid; consult your Agricultural Instructor.* |

## Numbers used, and where they come from

| In the video | Value | Source |
|---|---|---|
| Tank water now | 6.9 ha, 20 Oct 2026 *(demo)* | `data/tank/demo-tank-2.json` → `water.current_extent_ha`, `current_date` |
| Normal for October | 9.6 ha *(demo)* | `water.normal_extent_ha` |
| % of normal | 72 % *(demo)* | `water.T` = 0.72 |
| Onset delays | Maha 2025/26: 27 days late; Yala 2026: 17 days late *(real NASA POWER, placeholder point)* | `rain.seasons` |
| Signal and plan | Amber; short-duration paddy + bethma on 72 % | `result.signal`, `result.scenarios` |
| **~23,000 small tanks** | **Not in our data files.** It comes from the project proposal, which cites the UCL / World Bank tank prioritisation index (zenodo.org/records/10927868). | **Verify against that source before recording**, and show the source on screen. Otherwise, drop the number: "One method, for every village tank in Sri Lanka." |

## Notes for recording

- Don't say "the onset is getting later every year". The chart shows late seasons and a
  trend line, but we haven't measured or tested a trend. "Came late" refers only to the
  two seasons named.
- The El Niño line ("in 1 of 3 past strong El Niño years…") appears in the Why? panel. If
  there's time, let it be seen, but don't present it as a forecast.
- If the satellite water step has run on a real tank by recording day, re-read the numbers
  from that tank's file, and update this script and the "Demo data" note.
