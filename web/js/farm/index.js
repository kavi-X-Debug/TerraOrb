// Farm planner screens (#/farm/...). Called by main.js as renderFarm(state, parts, view); `parts` is the address after "#/farm".
//
//   #/farm                      home: my farms and links to each screen
//   #/farm/login                phone number + one-time code
//   #/farm/register             add a farm
//   #/farm/location/<id>        location card and climate profile      (location.js)
//   #/farm/zones/<id>           terrain zones and threats              (zones.js,    other agent)
//   #/farm/plan/<id>            rotation cards and scenario slider     (plan.js,     other agent)
//   #/farm/mockups/<id>         soil monitoring and practice mock-ups  (mockups.js,  other agent)
//
// Screen modules get ctx = { api, farm, view, t, go(hash), tank? } and fill ctx.view. A module that does not exist yet shows "coming soon".
import { t } from "../i18n.js";
import { api, ApiError, h, apiBase } from "./api.js";
import { renderLogin } from "./auth.js";
import { renderRegister } from "./register.js";
import { renderLocation } from "./location.js";

// Screens that live in their own modules: route -> [file, exported function]. Loaded only when opened.
const MODULES = {
  zones: ["./zones.js", "renderZones"],
  plan: ["./plan.js", "renderPlan"],
  mockups: ["./mockups.js", "renderMockups"],
};
const LINKS = [["location", "farm.link.location"], ["zones", "farm.link.zones"], ["plan", "farm.link.plan"], ["mockups", "farm.link.mockups"]];

let run = 0;                                                     // each draw gets a number so a slow answer never paints over a newer screen

function loadCss() {
  if (document.getElementById("farm-css")) return;
  const link = document.createElement("link");
  link.id = "farm-css"; link.rel = "stylesheet"; link.href = "css/farm.css";
  document.head.append(link);
}

const go = (hash) => { if (location.hash === hash) window.dispatchEvent(new Event("hashchange")); else location.hash = hash; };

// A friendly message when the service cannot be reached (and how to start it), with a retry button and a way to change the address.
function showError(view, err, retry) {
  view.innerHTML = "";
  const box = h("div", { class: "fm-page" });
  const network = err instanceof ApiError && err.network;
  box.append(h("h1", { text: t(network ? "farm.err.offline_title" : "farm.err.title") }),
    h("p", { class: "fm-lead", text: network ? t("farm.err.offline") : err.message }));
  if (network) {
    box.append(h("p", { text: t("farm.err.start_hint") }), h("pre", { class: "fm-code-block", text: "backend\\run.ps1" }),
      h("p", { class: "fm-fine", text: t("farm.err.address", { url: apiBase() }) }));
    const input = h("input", { class: "fm-input", type: "url", id: "fm-api", value: apiBase(), "aria-label": t("farm.err.change_address") });
    box.append(h("details", { class: "fm-details" }, h("summary", { text: t("farm.err.change_address") }), input,
      h("button", { class: "fm-btn fm-secondary", type: "button", text: t("farm.err.save_address"), onclick: () => { api.setBase(input.value); retry(); } })));
    box.append(h("p", { class: "fm-fine", text: t("farm.err.kept_on_phone") }));
  }
  box.append(h("button", { class: "fm-btn fm-primary", type: "button", text: t("farm.err.retry"), onclick: retry }));
  view.append(box);
}

const loading = (view) => { view.innerHTML = ""; view.append(h("p", { class: "fm-status fm-page", role: "status", text: t("farm.state.loading") })); };

// "Coming soon" for a screen whose module has not been added yet.
function comingSoon(view, farm) {
  view.innerHTML = "";
  view.append(h("div", { class: "fm-page" }, h("a", { class: "fm-back", href: "#/farm", text: t("farm.back_home") }),
    h("h1", { text: t("farm.soon.title") }), h("p", { class: "fm-lead", text: t("farm.soon.text") }),
    farm ? h("a", { class: "fm-btn fm-secondary", href: `#/farm/location/${farm.id}`, text: t("farm.link.location") }) : null));
}

async function home(view, id) {
  loading(view);
  let farms, me = null;
  try {
    [farms, me] = await Promise.all([api.get("/farms"), api.get("/me").catch((e) => { if (e.network) throw e; return null; })]);
  } catch (err) {
    if (err.status === 401) return routeNow(["login"], view);
    return showError(view, err, () => go("#/farm"));
  }
  if (id !== run) return;
  view.innerHTML = "";
  const list = Array.isArray(farms) ? farms : (farms && farms.farms) || [];
  const page = h("div", { class: "fm-page" });
  page.append(h("h1", { text: t("farm.home.title") }), h("p", { class: "fm-lead", text: t("farm.home.lead") }));
  if (!list.length) page.append(h("p", { class: "fm-note", text: t("farm.home.none") }));
  for (const f of list) {
    page.append(h("section", { class: "fm-card" },
      h("h2", { class: "fm-h2", text: f.name || t("farm.home.unnamed") }),
      h("p", { class: "fm-fine", text: t("farm.home.facts", { ha: f.area_ha, lat: Number(f.lat).toFixed(3), lon: Number(f.lon).toFixed(3) }) }),
      h("div", { class: "fm-row" }, ...LINKS.map(([screen, key], i) => h("a", { class: `fm-btn ${i === 0 ? "fm-primary" : "fm-secondary"}`, href: `#/farm/${screen}/${f.id}`, text: t(key) })))));
  }
  page.append(h("a", { class: "fm-btn fm-primary fm-big", href: "#/farm/register", text: t("farm.home.add") }));
  page.append(h("div", { class: "fm-row fm-account" },
    me && me.phone ? h("span", { class: "fm-fine", text: t("farm.home.signed_in", { phone: me.phone }) }) : null,
    h("button", { class: "fm-btn fm-quiet", type: "button", text: t("farm.home.sign_out"), onclick: () => { api.logout(); go("#/farm/login"); } })));
  page.append(h("p", { class: "fm-fine", text: t("farm.disclaimer") }));
  view.append(page);
}

async function farmScreen(screen, farmId, view, id) {
  loading(view);
  let farm;
  try { farm = await api.get(`/farms/${encodeURIComponent(farmId)}`); }
  catch (err) {
    if (err.status === 401) return routeNow(["login"], view);
    if (err.status === 404 || err.status === 403) {
      view.innerHTML = "";
      view.append(h("div", { class: "fm-page" }, h("h1", { text: t("farm.err.no_farm") }), h("a", { class: "fm-btn fm-primary", href: "#/farm", text: t("farm.back_home") })));
      return;
    }
    return showError(view, err, () => go(location.hash));
  }
  if (id !== run) return;
  const ctx = { api, farm, view, t, go };
  view.innerHTML = "";
  if (screen === "location") return renderLocation(ctx);
  const mod = MODULES[screen];
  if (!mod) return comingSoon(view, farm);
  let fn;
  try { fn = (await import(mod[0]))[mod[1]]; } catch { fn = null; }      // the module may not exist yet
  if (id !== run) return;
  if (typeof fn !== "function") return comingSoon(view, farm);
  try { await fn(ctx); } catch (err) { showError(view, err, () => go(location.hash)); }
}

function routeNow(parts, view) {
  const id = ++run;
  const [screen = "", farmId] = parts;

  if (screen === "login") return renderLogin({ api, view, t, go }, () => go("#/farm"));
  if (!api.isLoggedIn()) return renderLogin({ api, view, t, go }, () => routeNow(parts, view));    // not signed in: ask first, then carry on

  if (screen === "" ) return home(view, id);
  if (screen === "register") return renderRegister({ api, view, t, go });
  if (farmId) return farmScreen(screen, farmId, view, id);
  return home(view, id);
}

export function renderFarm(state, parts, view) {
  loadCss();
  routeNow(parts, view);
}
