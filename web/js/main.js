// Starts the app and switches between screens.
// Address (#hash) decides what's shown, so the phone's Back button works:
//   #/                     map
//   #/tank/<id>/tank       one tank: water and rain
//   #/tank/<id>/plan       one tank: season plan
//   #/tank/<id>/card       one tank: one-page summary card (print / share)
//   #/tank/<id>/weather    one tank: weather, 16-day forecast and NASA rain/cloud map
//   #/tank/<id>/crops      one tank: what to sow now (crop water needs vs expected rain)
//   #/tank/<id>/week       one tank: the weekly advice (what to do and watch this week)
//   #/calendar[/<id>]      sowing calendar: when to sow, for the chosen tank
//   #/learn...             Learn Mode (see learn.js)
//   #/officer              officer dashboard (officer.js)
//   #/research             method and data hub (research.js)
//   #/plan                 trip and event planner (planner.js)
//
// One app, several "ends": farmer.html, learn.html, officer.html, research.html and plan.html all load this file.
// <body data-end="..."> says which one; each opens on its own home screen (HOME below). index.html is only a chooser.
import { loadStrings, translatePage, setLang, getLang, t } from "./i18n.js";
import { loadAll } from "./data.js";
import { initMap, renderMap, renderTankList, showUser, refreshMapSize, focusTank } from "./map.js";
import { renderTank } from "./tank.js";
import { renderLearn } from "./learn.js";
import { renderCalendarPage } from "./calendar.js";
import { renderAbout } from "./about.js";
import { renderOfficer } from "./officer.js";
import { renderResearch } from "./research.js";
import { renderTrip } from "./trip/index.js";
import { mountHome } from "./home.js";
import { mountGuide } from "./guide.js";
import { renderFarm } from "./farm/index.js";
import { initAssistant } from "./assistant.js";
import { date } from "./ui.js";
import { loadLive, clock } from "./live.js";

// Which end of the site this page is (set by <body data-end> in the page), and where each one opens.
const END = document.body.dataset.end || "farmer";
const HOME = { farmer: "#/", learn: "#/learn", officer: "#/officer", research: "#/research", plan: "#/plan" };

// query = text in the search box; userPos = {lat, lon} after "Near me";
// mode = "simple" (default, for farmers) or "advanced" (charts, percentages, sources)
const state = { generated: null, tanks: [], mapFitted: false, query: "", userPos: null, mode: "simple", live: new Map() };

// ---------------------------------------------------------------------------
// Live weather for every tank (Open-Meteo; not NASA). Refreshed every 10 minutes while the page
// is open, when the phone comes back online, and when the tab becomes visible again.
// ---------------------------------------------------------------------------
function showLiveStatus() {
  const el = document.getElementById("live-status");
  if (!el) return;
  const times = [...state.live.values()].map((w) => w.time).sort();
  el.textContent = times.length
    ? `${t("live.list_status", { time: clock(times[times.length - 1]) })} ${t("live.source")}`
    : t("live.offline");
}

async function refreshLive(force = false) {
  if (!state.tanks.length) return;
  state.live = await loadLive(state.tanks, { force });
  renderTankList(state);
  showLiveStatus();
}

function startLiveUpdates() {
  refreshLive(false);
  setInterval(() => { if (document.visibilityState === "visible") refreshLive(true); }, 10 * 60 * 1000);
  window.addEventListener("online", () => refreshLive(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshLive(false); });
}

// ---------------------------------------------------------------------------
// Simple / Advanced view (remembered on this phone)
// ---------------------------------------------------------------------------
function applyMode(mode) {
  state.mode = mode;
  try { localStorage.setItem("mc-mode", mode); } catch { /* storage blocked: keep for this visit */ }
  document.body.classList.toggle("mode-simple", mode === "simple");
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  if (state.tanks.length && END === "farmer") renderTankList(state);
  route();
}

function setUpMode() {
  let saved = null;
  try { saved = localStorage.getItem("mc-mode"); } catch { /* ignore */ }
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => applyMode(b.dataset.mode)));
  applyMode(saved === "advanced" ? "advanced" : "simple");
}

// ---------------------------------------------------------------------------
// Find my tank: search box and "Near me"
// ---------------------------------------------------------------------------
function setFinderStatus(text, isError = false) {
  const el = document.getElementById("finder-status");
  if (!el) return;                                   // the tank search bar was removed from the home page
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function setUpFinder() {
  const input = document.getElementById("tank-search");
  if (!input) return;                                // no search bar on the home page any more
  input.addEventListener("input", () => {
    state.query = input.value;
    renderTankList(state);
  });

  document.getElementById("near-me").addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setFinderStatus(t("map.my_location.error"), true);
      return;
    }
    setFinderStatus(t("map.my_location.busy"));
    // The position is used only on this phone to sort the list; it is never sent anywhere.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        renderTankList(state);
        showUser(state.userPos);
        setFinderStatus(t("map.my_location.sorted"));
      },
      () => setFinderStatus(t("map.my_location.error"), true),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });
}

function setStatus(text, isError = false) {
  const el = document.getElementById("map-status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function openTankFromMap(id) {
  location.hash = `#/tank/${encodeURIComponent(id)}/plan`;     // open on the answer first
}

// Draw whatever the address asks for.
function route() {
  const view = document.getElementById("tank-view");
  const layout = document.querySelector(".layout");

  // Two kinds of page: the home page (hero + tank list + map) and a full page for one tank / Learn Mode.
  const showPage = (isPage) => {
    document.body.dataset.page = isPage ? "page" : "home";
    const hero = document.getElementById("hero"); if (hero) hero.hidden = isPage || END !== "farmer";          // the tank finder and map belong to the farmer end
    document.getElementById("map-view").hidden = isPage || END !== "farmer";
    const hs = document.getElementById("home-services"); if (hs) hs.hidden = isPage || END !== "farmer";
    const hg = document.getElementById("home-guide"); if (hg) hg.hidden = isPage || END !== "farmer";    // the farmer home's "what you can do" section
    window.scrollTo(0, 0);
  };

  // Every end opens on its own home screen (the farmer end's home is the tank map)
  const hash = location.hash || "#/";
  if (END !== "farmer" && (hash === "#/" || hash === "#")) { location.replace(HOME[END]); return; }

  // Highlight the menu item of the page we are on: the link whose address is the longest start of this one (tank pages count as "Tanks")
  const links = [...document.querySelectorAll(".site-nav a")].filter((a) => a.getAttribute("href").startsWith("#"));
  let best = null;
  for (const a of links) {
    const h = a.getAttribute("href");
    const matches = h === "#/" ? hash === "#/" || hash.startsWith("#/tank") : hash.startsWith(h);
    if (matches && (!best || h.length > best.getAttribute("href").length)) best = a;
  }
  links.forEach((a) => { if (a === best) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });

  if (location.hash === "#/how-it-works/sources" || location.hash === "#/how-it-works/credits") { location.replace("#/how-it-works"); return; }   // old links

  // The pages of the other ends (each end shows its own menu, but all addresses work everywhere)
  const ENDPAGES = [["#/officer", renderOfficer], ["#/research", renderResearch], ["#/plan", renderTrip], ["#/farm", renderFarm]];
  for (const [prefix, render] of ENDPAGES) {
    if (location.hash.startsWith(prefix)) {
      const parts = location.hash.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
      showPage(true);
      view.hidden = false;
      layout.classList.remove("no-tank");
      render(state, parts, view);
      return;
    }
  }

  if (location.hash.startsWith("#/data-sources")) { location.replace(HOME[END]); return; }      // the page was removed: old bookmarks go home

  if (location.hash.startsWith("#/how-it-works")) {
    showPage(true);
    view.hidden = false;
    layout.classList.remove("no-tank");
    renderAbout(state, view);
    return;
  }

  if (location.hash.startsWith("#/calendar")) {
    showPage(true);
    view.hidden = false;
    layout.classList.remove("no-tank");
    const id = decodeURIComponent(location.hash.slice("#/calendar/".length) || "");
    renderCalendarPage(state, id, view);
    return;
  }

  if (location.hash.startsWith("#/learn")) {
    const parts = location.hash.slice("#/learn".length).split("/").filter(Boolean).map(decodeURIComponent);
    showPage(true);
    view.hidden = false;
    layout.classList.remove("no-tank");
    renderLearn(state, parts, view);
    refreshMapSize();
    return;
  }

  const match = location.hash.match(/^#\/tank\/([^/]+)\/(tank|plan|card|weather|crops|week)$/);
  const tank = match && state.tanks.find((x) => x.id === decodeURIComponent(match[1]));

  if (!tank) {
    if (END !== "farmer") { location.replace(HOME[END]); return; }              // an address this end does not know: go to its home
    showPage(false);
    view.hidden = true;
    view.innerHTML = "";
    layout.classList.add("no-tank");
    refreshMapSize();
    return;
  }
  showPage(true);
  view.hidden = false;
  layout.classList.remove("no-tank");
  renderTank(tank, match[2], view, state.mode);
  focusTank(tank);
  refreshMapSize();

  view.querySelector("[data-back]").onclick = (e) => { location.hash = e.currentTarget.dataset.back; };
  // "See more details" in Simple view switches to the Advanced view of the same page.
  view.querySelectorAll("[data-more]").forEach((button) => { button.onclick = () => applyMode("advanced"); });
  // Buttons on the advice page ("See water and rain charts", "Print or share")
  view.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => { location.hash = `#/tank/${encodeURIComponent(tank.id)}/${button.dataset.tab}`; };
  });
}

// "Data updated <date>", plus a note when the data came from the offline copy.
function showDataStatus() {
  const updated = t("label.updated", { date: date(state.generated) });
  setStatus(state.offline ? `${t("state.offline")} ${updated}` : updated);
}

// Language switch: redraw everything in the chosen language.
function applyLanguage(code) {
  setLang(code);
  document.querySelectorAll("[data-lang]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.lang === code)));
  translatePage();
  document.dispatchEvent(new Event("mc-lang"));        // the assistant redraws its own text
  const title = t(`end.${END}.title`);
  if (title !== `end.${END}.title`) document.title = title;                       // the page title follows the language
  if (state.tanks.length) {
    if (END === "farmer") safeMap(() => renderMap(state, openTankFromMap));
    showDataStatus();
    showLiveStatus();
  }
  route();
}

// The map library (Leaflet) comes from a CDN. If it cannot load (no internet, or the CDN is down), the rest of the site must still work.
function safeMap(fn) { try { fn(); } catch (err) { console.warn("The map could not start:", err.message); } }

// The loading screen (in index.html) stays for at least 0.9 s, so it never just flashes, then fades away.
const loaderStart = performance.now();
function hideLoader() {
  const el = document.getElementById("loader");
  if (!el || el.classList.contains("done")) return;
  setTimeout(() => { el.classList.add("done"); setTimeout(() => el.remove(), 800); }, Math.max(0, 900 - (performance.now() - loaderStart)));
}

async function start() {
  try {
    await loadStrings();
  } catch (err) {
    document.getElementById("map-status").textContent = `Could not load the text files (${err.message}).`;
    hideLoader();
    return;
  }
  document.querySelectorAll("[data-lang]").forEach((b) => {
    b.addEventListener("click", () => applyLanguage(b.dataset.lang));
  });
  applyLanguage(getLang());
  if (END === "farmer") {
    mountHome(document.getElementById("home-services"), "farmer");
    const hs = document.getElementById("home-services");                       // the detailed "how to use" guide sits right below
    if (hs && !document.getElementById("home-guide")) { const g = document.createElement("section"); g.id = "home-guide"; g.hidden = hs.hidden; hs.after(g); }
    mountGuide(document.getElementById("home-guide"), "farmer");
  }          // "what you can do here" on the farmer home

  if (window.Chart) {
    Chart.defaults.font.family = '"Noto Sans", "Noto Sans Sinhala", system-ui, sans-serif';
    Chart.defaults.font.size = 14;
    Chart.defaults.color = "#16302E";
  }
  if (END === "farmer") safeMap(initMap);
  setUpFinder();
  setUpMode();
  setStatus(t("state.loading"));
  try {
    const data = await loadAll();
    state.generated = data.generated;
    state.offline = data.offline;
    state.tanks = data.tanks;
  } catch (err) {
    setStatus(`${t("map.loading_error")} (${err.message})`, true);
    hideLoader();
    return;
  }
  if (END === "farmer") safeMap(() => renderMap(state, openTankFromMap));
  showDataStatus();
  window.addEventListener("hashchange", route);
  route();
  if (END === "farmer") startLiveUpdates();                                        // live weather for the tank list is only shown on the farmer home
  initAssistant(state);
  hideLoader();
}

// Offline support (see sw.js). Browsers only allow it on https:// or localhost.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline mode not available:", err));
}

start();
