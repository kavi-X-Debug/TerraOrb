// Data sources page (#/data-sources): where every number, picture and fact on this website comes from.
//
//   1. a short summary and "how fresh is the data" (real dates read from the data files)
//   2. NASA data, other data, and pictures: provider, what it gives, where we use it, licence and known problems
//   3. the crop facts table: growing time of every crop with its source and confidence (data/crop_sources.json)
// The descriptions are fixed text in si.json / en.json (keys "dsp.*"); the dates, counts and crop table are read from the data.
import { t } from "./i18n.js";
import { escapeHtml, date, num } from "./ui.js";
import { loadValidation, loadCropSources } from "./data.js";

// group: nasa | other | pictures.  state: used | backup.  url: the provider's own home page.
const SOURCES = [
  { id: "power", group: "nasa", state: "used", url: "https://power.larc.nasa.gov/" },
  { id: "dswx", group: "nasa", state: "used", url: "https://www.earthdata.nasa.gov/" },
  { id: "hls", group: "nasa", state: "backup", url: "https://lpdaac.usgs.gov/" },
  { id: "gibs", group: "nasa", state: "used", url: "https://www.earthdata.nasa.gov/" },
  { id: "modis", group: "nasa", state: "used", url: "https://modis.ornl.gov/" },
  { id: "cmr", group: "nasa", state: "used", url: "https://www.earthdata.nasa.gov/" },
  { id: "openmeteo", group: "other", state: "used", url: "https://open-meteo.com/" },
  { id: "osm", group: "other", state: "used", url: "https://www.openstreetmap.org/copyright" },
  { id: "fao", group: "other", state: "used", url: "https://www.fao.org/4/x0490e/x0490e0b.htm" },
  { id: "doa", group: "other", state: "used", url: "https://doa.gov.lk/" },
  { id: "commons", group: "pictures", state: "used", url: "https://commons.wikimedia.org/" },
  { id: "canva", group: "pictures", state: "used", url: "https://www.canva.com/" },
  { id: "flow", group: "pictures", state: "used", url: "https://flow.google.com/" },
];
const GROUPS = ["nasa", "other", "pictures"];

// Turn web addresses inside a source note into links (the text is escaped first, so nothing in it can run as HTML)
const linkify = (text) => escapeHtml(text || "").replace(/https?:\/\/[^\s)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

// Latest of a list of ISO dates/months, or null
const latest = (list) => list.filter(Boolean).sort().pop() || null;

function freshness(state, validation) {
  const docs = state.tanks.map((x) => x.doc).filter(Boolean);
  const realWater = docs.filter((d) => d.water && !d.water.demo && d.water.source);
  const withNdvi = docs.filter((d) => d.ndvi);
  const lastRainMonth = latest(docs.map((d) => d.rain?.monthly?.at(-1)?.month));
  const rows = [
    [t("dsp.fresh.tanks"), t("dsp.fresh.tanks_value", { n: state.tanks.length }), state.generated ? date(state.generated) : "—"],
    [t("dsp.fresh.rain"), t("dsp.fresh.rain_value"), lastRainMonth ? date(`${lastRainMonth}-01`, { month: "long", year: "numeric" }) : "—"],
    [t("dsp.fresh.water"), t("dsp.fresh.water_value", { n: realWater.length }), date(latest(realWater.map((d) => d.water.current_date)))],
    [t("dsp.fresh.forecast"), t("dsp.fresh.forecast_value"), date(latest(docs.map((d) => d.forecast?.issued)))],
    [t("dsp.fresh.ndvi"), t("dsp.fresh.ndvi_value", { n: withNdvi.length }), withNdvi.length ? date(latest(withNdvi.map((d) => d.ndvi.current?.date))) : "—"],
    [t("dsp.fresh.seasonal"), t("dsp.fresh.seasonal_value"), date(latest(docs.map((d) => d.seasonal?.issued)))],
    [t("dsp.fresh.crops"), t("dsp.fresh.crops_value"), date(latest(docs.map((d) => d.crops?.updated)))],
    [t("dsp.fresh.tests"), t("dsp.fresh.tests_value"), validation?.generated ? date(validation.generated) : "—"],
  ];
  return { rows, realWater: realWater.length, ndvi: withNdvi.length };
}

function card(s, vars) {
  const stateLabel = s.state === "backup" ? t("dsp.state.backup") : t("dsp.state.used");
  const note = t(`dsp.${s.id}.note`, vars);
  return `
  <article class="dsp-card ${s.group}">
    <header>
      <span class="how-tag">${escapeHtml(t(`dsp.group.${s.group}.tag`))}</span>
      <span class="dsp-state ${s.state}">${escapeHtml(stateLabel)}</span>
    </header>
    <h3>${escapeHtml(t(`dsp.${s.id}.name`))}</h3>
    <p class="dsp-provider">${escapeHtml(t(`dsp.${s.id}.provider`))}</p>
    <p>${escapeHtml(t(`dsp.${s.id}.what`, vars))}</p>
    <p class="how-use"><strong>${escapeHtml(t("dsp.used_for"))}</strong> ${escapeHtml(t(`dsp.${s.id}.used`, vars))}</p>
    ${note.startsWith("dsp.") ? "" : `<p class="dsp-note">${escapeHtml(note)}</p>`}
    <a class="dsp-link" href="${s.url}" target="_blank" rel="noopener">${escapeHtml(t("dsp.visit"))} ↗</a>
  </article>`;
}

function cropTable(cs) {
  if (!cs?.crops?.length) return `<p class="note">${escapeHtml(t("dsp.crops.none"))}</p>`;
  const rows = cs.crops.map((c) => `
    <tr>
      <th scope="row">${escapeHtml(t(`crop.${c.id}`))}</th>
      <td>${num(c.duration_days, 0)}</td>
      <td><span class="dsp-conf ${escapeHtml(c.duration_confidence)}">${escapeHtml(t(`dsp.conf.${c.duration_confidence}`))}</span></td>
      <td class="dsp-src">${linkify(c.duration_source)}</td>
    </tr>`).join("");
  return `
    <div class="table-scroll">
      <table class="crop-table dsp-table">
        <thead><tr><th>${escapeHtml(t("crops.col.crop"))}</th><th>${escapeHtml(t("dsp.crops.days"))}</th><th>${escapeHtml(t("dsp.crops.conf"))}</th><th>${escapeHtml(t("dsp.crops.source"))}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">${escapeHtml(t("dsp.crops.kc"))} <a href="https://www.fao.org/4/x0490e/x0490e0b.htm" target="_blank" rel="noopener">FAO-56, Tables 11 and 12 ↗</a></p>`;
}

// Photo credits: required by the free licences of the crop photos (Wikimedia Commons)
async function loadCredits() {
  try { return await (await fetch("img/crops/credits.json")).json(); } catch { return {}; }
}
function creditsBlock(credits) {
  const rows = Object.entries(credits).map(([id, c]) =>
    `<li><strong>${escapeHtml(t(`crop.${id}`))}:</strong> ${escapeHtml(t("calendar.photo", { author: c.author, license: c.license }))} — <a href="${escapeHtml(c.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></li>`).join("");
  return `
  <section class="how-section" id="credits" aria-labelledby="dsp-credits-title">
    <h2 id="dsp-credits-title">${escapeHtml(t("how.credits.title"))}</h2>
    <details class="other-options" open>
      <summary>${escapeHtml(t("how.credits.photos"))}</summary>
      <ul class="how-credit-list">${rows}</ul>
    </details>
    <p class="note">${escapeHtml(t("how.credits.ai"))}</p>
  </section>`;
}

export async function renderDataSources(state, view) {
  const [validation, cropSources, credits] = await Promise.all([loadValidation(), loadCropSources(), loadCredits()]);
  if (!view.isConnected || !location.hash.startsWith("#/data-sources")) return;    // the user already moved on
  const fresh = freshness(state, validation);
  const vars = { n: fresh.realWater, nd: fresh.ndvi, tanks: state.tanks.length };
  const sections = GROUPS.map((g) => `
    <section class="how-section" aria-labelledby="dsp-${g}-title">
      <h2 id="dsp-${g}-title">${escapeHtml(t(`dsp.group.${g}.title`))}</h2>
      <p class="how-lead">${escapeHtml(t(`dsp.group.${g}.lead`))}</p>
      <div class="dsp-cards">${SOURCES.filter((s) => s.group === g).map((s) => card(s, vars)).join("")}</div>
    </section>`).join("");

  view.innerHTML = `
    <div class="tank-head dsp-head">
      <h1>${escapeHtml(t("dsp.title"))}</h1>
      <p class="hint">${escapeHtml(t("dsp.subtitle"))}</p>
    </div>
    <div class="panel-body dsp">
      <section class="block">
        <h2>${escapeHtml(t("dsp.fresh.title"))}</h2>
        <div class="table-scroll">
          <table class="crop-table dsp-table">
            <thead><tr><th>${escapeHtml(t("dsp.fresh.what"))}</th><th>${escapeHtml(t("dsp.fresh.detail"))}</th><th>${escapeHtml(t("dsp.fresh.latest"))}</th></tr></thead>
            <tbody>${fresh.rows.map(([a, b, c]) => `<tr><th scope="row">${escapeHtml(a)}</th><td>${escapeHtml(b)}</td><td><strong>${escapeHtml(c)}</strong></td></tr>`).join("")}</tbody>
          </table>
        </div>
        <p class="note">${escapeHtml(t("dsp.fresh.note"))}</p>
      </section>
      ${sections}
      <section class="how-section" aria-labelledby="dsp-crops-title">
        <h2 id="dsp-crops-title">${escapeHtml(t("dsp.crops.title"))}</h2>
        <p class="how-lead">${escapeHtml(t("dsp.crops.lead"))}</p>
        ${cropTable(cropSources)}
      </section>
      ${creditsBlock(credits)}
      <section class="block">
        <h2>${escapeHtml(t("dsp.planned.title"))}</h2>
        <p>${escapeHtml(t("dsp.planned.text"))}</p>
        <div class="plan-actions">
          <a class="action" href="#/how-it-works">${escapeHtml(t("nav.about"))}</a>
          <a class="action" href="#/">${escapeHtml(t("site.nav.tanks"))}</a>
        </div>
      </section>
    </div>`;
  if (location.hash.endsWith("/credits")) view.querySelector("#credits")?.scrollIntoView();      // footer "Image credits" link
}
