// Trip planner router (plan end, #/plan/...). Shows a small menu, then loads the screen for the address.
//
//   #/plan                         dashboard            #/plan/copilot                 AI travel copilot (rule-based, grounded)
//   #/plan/explore                 destinations         #/plan/packing[/<tripId>]      packing assistant
//   #/plan/rain[/<id>[/<date>]]    hourly rain          #/plan/trips[/<tripId>]        my trips and the rescheduler
//   #/plan/compare[/<ids>/<a>/<b>] compare places       #/plan/settings                thresholds and weights
//   #/plan/dates[/<id>]            best travel dates    #/plan/suggest                 smart suggestions
//   #/plan/place/... or #/plan/<lat>,<lon>/...          the single-place planner (planner.js), unchanged
// Every screen module exports renderXxx(ctx, parts, view). A screen that is missing shows "coming soon" instead of failing.
import { t } from "../i18n.js";
import { renderPlanner } from "../planner.js";
import { loadTripData } from "./data.js";
import { getConfig } from "./config.js";
import * as ui from "./ui.js";

const SCREENS = {
  "": ["dashboard", "renderDashboard", "trip.nav.dashboard"],
  explore: ["explore", "renderExplore", "trip.nav.explore"],
  rain: ["rain", "renderRain", "trip.nav.rain"],
  compare: ["compare", "renderCompare", "trip.nav.compare"],
  dates: ["dates", "renderDates", "trip.nav.dates"],
  suggest: ["suggest", "renderSuggest", "trip.nav.suggest"],
  trips: ["trips", "renderTrips", "trip.nav.trips"],
  copilot: ["copilot", "renderCopilot", "trip.nav.copilot"],
  packing: ["packing", "renderPacking", "trip.nav.packing"],
  settings: ["settings", "renderSettings", "trip.nav.settings"],
};
const isPoint = (s) => /^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(s || "");

function menu(active) {
  const nav = ui.h("nav", { class: "tp-menu", "aria-label": t("trip.nav.label") });
  for (const [key, [, , label]] of Object.entries(SCREENS)) {
    nav.append(ui.h("a", { href: key ? `#/plan/${key}` : "#/plan", class: key === active ? "on" : "", "aria-current": key === active ? "page" : null, text: t(label) }));
  }
  nav.append(ui.h("a", { href: "#/plan/place", class: active === "place" ? "on" : "", text: t("trip.nav.place") }));
  return nav;
}

export async function renderTrip(state, parts, view) {
  const first = parts[0] || "";
  // The single-place planner keeps its own address forms
  if (first === "place" || isPoint(first)) {
    const rest = first === "place" ? parts.slice(1) : parts;
    view.replaceChildren(menu("place"), ui.h("div", { id: "tp-legacy" }));
    return renderPlanner(state, rest, view.querySelector("#tp-legacy"));
  }
  const key = Object.hasOwn(SCREENS, first) ? first : "";
  const [file, fn] = SCREENS[key];
  ui.ensureCss("trip");
  const body = ui.h("div", { class: "tp-screen", id: "tp-body" });
  view.replaceChildren(menu(key), body);
  ui.loading(body);
  const data = await loadTripData();
  if (!body.isConnected) return;                                // the visitor went somewhere else while loading
  const ctx = { state, t, go: (hash) => { location.hash = hash; }, ui, data, cfg: getConfig() };
  // Step 1: load the screen file. Only a missing file means "not ready yet".
  let mod = null;
  try {
    mod = await import(`./screens/${file}.js`);
  } catch (err) {
    if (/Failed to fetch dynamically imported|error loading dynamically|Importing a module script failed|404/i.test(String(err.message))) {
      body.replaceChildren(ui.h("p", { class: "tp-state", text: t("trip.state.soon") }));
      return;
    }
    console.error(err);                                          // the file exists but has a mistake: show it as an error, not "soon"
    ui.errorBox(body, "trip.state.error", () => renderTrip(state, parts, view));
    return;
  }
  // Step 2: run it. Any error inside the screen is a real error.
  try {
    body.replaceChildren();
    await mod[fn](ctx, parts.slice(1), body);
  } catch (err) {
    console.error(err);
    ui.errorBox(body, "trip.state.error", () => renderTrip(state, parts, view));
  }
}
