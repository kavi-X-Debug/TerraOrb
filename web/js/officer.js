// Officer dashboard (officer end, #/officer): every tank on one screen for agricultural officers and instructors.
//
//   - counts by signal (tap one to filter), a search box, a sort choice and "hide demo tanks"
//   - one row per tank: signal, water vs usual, rain this season, when the rains started, forecast rain for the next 7 days
//     (saved copy), rain expected in the next 6 hours (live), and how green the land is (NASA MODIS)
//   - a CSV download of the rows on screen and a printable report
// Every number comes from the saved tank files (the pipeline's work) except the "next 6 hours" column, which is a live weather
// forecast from Open-Meteo (NOT NASA data). A missing number is shown as a dash, never guessed. Tap a tank for its full advice.
import { t, getLang } from "./i18n.js";
import { api, ApiError } from "./farm/api.js";
import { renderLogin } from "./farm/auth.js";
import { escapeHtml, signalIcon, signalKey, tankName, num, date, localToday } from "./ui.js";

const API = "https://api.open-meteo.com/v1/forecast";
const BATCH = 40;                                  // tanks per live-rain request
const ORDER = { red: 0, amber: 1, none: 2, green: 3 };      // worst first

let live = new Map();                               // tank id -> mm expected in the next 6 hours
let filter = { signal: "all", query: "", sort: "signal", hideDemo: false };

// ---------------------------------------------------------------------------
// One row of numbers per tank (pure: used for the table, the CSV and the tests)
// ---------------------------------------------------------------------------
export function rowOf(tank, today = localToday()) {
  const d = tank.doc || {};
  const days = (d.forecast?.days || []).filter((x) => x.date >= today).slice(0, 7);
  const known = days.filter((x) => x.rain_mm !== null && x.rain_mm !== undefined);
  const inputs = d.result?.inputs || {};
  const T = d.water?.T;
  return {
    id: tank.id, name: tankName(tank), demo: !!(tank.demo || d.demo),
    signal: signalKey(d.result?.signal),
    water: T === null || T === undefined ? null : Math.round(T * 100),
    rain: d.rain?.current?.R == null ? null : Math.round(d.rain.current.R * 100),
    onset: inputs.onset_delay_days ?? null,
    fc7: days.length >= 4 && known.length ? Math.round(known.reduce((a, x) => a + x.rain_mm, 0)) : null,
    live6: live.has(tank.id) ? live.get(tank.id) : null,
    green: d.ndvi?.current?.state ?? null,
    updated: d.generated || null,
  };
}

export function applyFilter(rows, f) {
  const q = f.query.trim().toLowerCase();
  let out = rows.filter((r) => (f.signal === "all" || r.signal === f.signal || (f.signal === "heavy" && r.live6 !== null && r.live6 >= 30))
    && (!q || r.name.toLowerCase().includes(q)) && !(f.hideDemo && r.demo));
  const num_ = (v, dir) => (v === null ? Infinity : dir * v);                  // missing numbers go last
  const sorts = {
    signal: (a, b) => ORDER[a.signal] - ORDER[b.signal] || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    water: (a, b) => num_(a.water, 1) - num_(b.water, 1),
    fc7: (a, b) => num_(a.fc7, -1) - num_(b.fc7, -1),
  };
  out = [...out].sort(sorts[f.sort] || sorts.signal);
  return out;
}

const dash = "–";
const cell = (v, suffix = "") => (v === null || v === undefined ? dash : `${v}${suffix}`);
const onsetText = (n) => (n === null ? dash : n > 2 ? t("of.onset.late", { n }) : n < -2 ? t("of.onset.early", { n: -n }) : t("of.onset.ontime"));
const greenText = (g) => (g ? t(`of.green.${g}`) : dash);

// CSV with a byte-order mark, so Excel shows Sinhala letters correctly. Quotes are doubled.
export function toCsv(rows) {
  const head = ["name", "signal", "tank_water_percent_of_usual", "rain_this_season_percent_of_usual", "rains_started_days_late",
    "rain_next_7_days_mm_forecast", "rain_next_6_hours_mm_live", "greenness_vs_usual", "demo", "data_updated"];
  const esc = (v) => (v === null || v === undefined ? "" : `"${String(v).replaceAll('"', '""')}"`);
  const lines = rows.map((r) => [r.name, r.signal, r.water, r.rain, r.onset, r.fc7, r.live6, r.green, r.demo ? "yes" : "no", r.updated].map(esc).join(","));
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Live rain for all tanks (a few batched requests); failure just leaves the column empty
// ---------------------------------------------------------------------------
async function loadLiveRain(tanks) {
  if (navigator.onLine === false) return false;
  let ok = false;
  for (let i = 0; i < tanks.length; i += BATCH) {
    const batch = tanks.slice(i, i + BATCH);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const url = `${API}?latitude=${batch.map((x) => x.lat.toFixed(3)).join(",")}&longitude=${batch.map((x) => x.lon.toFixed(3)).join(",")}`
        + "&hourly=precipitation&forecast_hours=7&timezone=Asia%2FColombo";
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;
      const data = await response.json();
      const results = Array.isArray(data) ? data : [data];
      if (results.length !== batch.length) continue;                          // never match answers to the wrong tank
      results.forEach((r, k) => {
        const p = r.hourly?.precipitation;
        if (p && p.length >= 7 && p.slice(1, 7).every((x) => x !== null)) live.set(batch[k].id, Math.round(p.slice(1, 7).reduce((a, x) => a + x, 0) * 10) / 10);
      });
      ok = true;
    } catch { /* offline or slow: those tanks have no live number */ }
    finally { clearTimeout(timer); }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
async function renderDashboard(state, parts, view) {
  const tanks = state.tanks;
  view.innerHTML = `
    <div class="tank-head learn-head">
      <h1>${escapeHtml(t("of.title"))}</h1>
      <p class="meta">${escapeHtml(t("of.sub"))}</p>
    </div>
    <div class="panel-body of-page">
      <div class="of-tiles" id="of-tiles" role="group" aria-label="${escapeHtml(t("of.filter"))}"></div>
      <div class="of-controls">
        <label class="of-search"><span class="visually-hidden">${escapeHtml(t("of.search"))}</span>
          <input type="search" id="of-q" autocomplete="off" placeholder="${escapeHtml(t("of.search"))}" value="${escapeHtml(filter.query)}"></label>
        <label>${escapeHtml(t("of.sort"))}
          <select id="of-sort">${["signal", "name", "water", "fc7"].map((k) => `<option value="${k}"${filter.sort === k ? " selected" : ""}>${escapeHtml(t(`of.sort.${k}`))}</option>`).join("")}</select></label>
        <label class="of-check"><input type="checkbox" id="of-demo"${filter.hideDemo ? " checked" : ""}> ${escapeHtml(t("of.hide_demo"))}</label>
        <button type="button" class="mg-small" id="of-csv">${escapeHtml(t("of.csv"))}</button>
        <button type="button" class="mg-small" id="of-print">${escapeHtml(t("of.print"))}</button>
      </div>
      <section class="of-report" id="of-report" aria-live="polite"></section>
    </div>`;

  const draw = () => {
    const rows = tanks.map((x) => rowOf(x));
    const shown = applyFilter(rows, filter);
    const counts = { all: rows.length, red: 0, amber: 0, green: 0, none: 0, heavy: 0 };
    rows.forEach((r) => { counts[r.signal]++; if (r.live6 !== null && r.live6 >= 30) counts.heavy++; });
    const tile = (id, label, cls) => `<button type="button" class="of-tile ${cls}" data-signal="${id}" aria-pressed="${filter.signal === id}"><strong>${counts[id]}</strong><span>${escapeHtml(label)}</span></button>`;
    view.querySelector("#of-tiles").innerHTML = tile("all", t("of.filter.all"), "all") + ["red", "amber", "green", "none"].map((s) => tile(s, t(`signal.short.${s}`), s)).join("")
      + (live.size ? tile("heavy", t("of.filter.heavy"), "heavy") : "");
    view.querySelectorAll("[data-signal]").forEach((b) => { b.onclick = () => { filter.signal = b.dataset.signal; draw(); }; });

    const updated = tanks.map((x) => x.doc?.generated).filter(Boolean).sort().pop();
    view.querySelector("#of-report").innerHTML = `
      <div class="of-print-head"><h2>${escapeHtml(t("of.report.title"))}</h2><p>${escapeHtml(t("of.report.date", { date: date(localToday()), updated: updated ? date(updated) : dash }))}</p></div>
      <p class="fact-small" role="status">${escapeHtml(t("of.count", { n: shown.length, total: rows.length }))}${live.size ? "" : " · " + escapeHtml(t("of.live.none"))}</p>
      <div class="of-scroll"><table class="of-table">
        <thead><tr><th scope="col">${escapeHtml(t("of.col.tank"))}</th><th scope="col">${escapeHtml(t("of.col.signal"))}</th><th scope="col">${escapeHtml(t("of.col.water"))}</th>
          <th scope="col">${escapeHtml(t("of.col.rain"))}</th><th scope="col">${escapeHtml(t("of.col.onset"))}</th><th scope="col">${escapeHtml(t("of.col.fc7"))}</th>
          <th scope="col">${escapeHtml(t("of.col.live6"))}</th><th scope="col">${escapeHtml(t("of.col.green"))}</th></tr></thead>
        <tbody>${shown.map((r) => `<tr data-id="${escapeHtml(r.id)}" tabindex="0">
          <th scope="row"><a href="#/tank/${encodeURIComponent(r.id)}/plan">${escapeHtml(r.name)}</a>${r.demo ? ` <span class="badge demo">${escapeHtml(t("badge.demo"))}</span>` : ""}</th>
          <td><span class="of-sig ${r.signal}">${signalIcon(r.signal === "none" ? null : r.signal)}${escapeHtml(t(`signal.short.${r.signal}`))}</span></td>
          <td>${cell(r.water, "%")}</td><td>${cell(r.rain, "%")}</td><td>${escapeHtml(onsetText(r.onset))}</td>
          <td>${cell(r.fc7, " " + t("unit.mm"))}</td><td class="${r.live6 !== null && r.live6 >= 30 ? "of-hot" : ""}">${cell(r.live6, " " + t("unit.mm"))}</td><td>${escapeHtml(greenText(r.green))}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="fact-small">${escapeHtml(t("of.sources"))}</p>
      <p class="fact-small">${escapeHtml(t("of.live.note"))}</p>`;
    view.querySelectorAll("#of-report tbody tr").forEach((tr) => {
      tr.onclick = (e) => { if (!e.target.closest("a")) location.hash = `#/tank/${encodeURIComponent(tr.dataset.id)}/plan`; };
      tr.onkeydown = (e) => { if (e.key === "Enter") location.hash = `#/tank/${encodeURIComponent(tr.dataset.id)}/plan`; };
    });
    view.querySelector("#of-csv").onclick = () => {
      const blob = new Blob([toCsv(shown)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `monsoon-compass-tanks-${localToday()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
  };

  view.querySelector("#of-q").oninput = (e) => { filter.query = e.target.value; draw(); };
  view.querySelector("#of-sort").onchange = (e) => { filter.sort = e.target.value; draw(); };
  view.querySelector("#of-demo").onchange = (e) => { filter.hideDemo = e.target.checked; draw(); };
  view.querySelector("#of-print").onclick = () => {
    document.body.classList.add("of-printing");
    window.addEventListener("afterprint", () => document.body.classList.remove("of-printing"), { once: true });
    window.print();
  };

  draw();
  if (await loadLiveRain(tanks) && view.isConnected) draw();                  // the live column fills in a moment later
}


// ---------------------------------------------------------------------------
// Sign-in gate: the dashboard opens only for a signed-in officer (the server decides; see backend/app/routes_officer.py).
// NOTE: the tank files themselves are public static files, so this protects the dashboard screen, not the raw files.
// ---------------------------------------------------------------------------
export async function renderOfficer(state, parts, view) {
  if (!document.getElementById("farm-css")) {                       // the sign-in form uses the farm planner's styles
    const link = document.createElement("link");
    link.id = "farm-css"; link.rel = "stylesheet"; link.href = "css/farm.css";
    document.head.append(link);
  }
  const ctx = { api, view, t, go: (hash) => { location.hash = hash; } };
  const again = () => renderOfficer(state, parts, view);
  const note = (key, isError) => {
    const p = document.createElement("p");
    p.className = isError ? "fm-status fm-error" : "fm-fine";
    p.textContent = t(key);
    view.prepend(p);
  };
  if (!api.isLoggedIn()) {
    renderLogin(ctx, again);
    note("of.signin.lead", false);
    return;
  }
  try {
    await api.get("/officer/check");
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {            // signed in, but not an officer account
      renderLogin({ ...ctx, view }, again);                          // signing in with another number replaces this login
      note("of.signin.not_officer", true);
      return;
    }
    if (err instanceof ApiError && err.status === 401) { renderLogin(ctx, again); note("of.signin.lead", false); return; }
    view.innerHTML = "";
    note("of.signin.offline", true);                                // the sign-in service cannot be reached: stay closed
    return;
  }
  await renderDashboard(state, parts, view);
  const out = document.createElement("button");
  out.className = "of-signout";
  out.type = "button";
  out.textContent = t("of.signin.sign_out");
  out.addEventListener("click", () => { api.logout(); again(); });
  view.prepend(out);
}
