// Method and data hub (research end, #/research): for judges, researchers and anyone who wants to check the work.
//   - what each part of the site uses and where it comes from (links to "How it works", "Data sources" and the image credits)
//   - the accuracy tests exactly as the pipeline saved them (data/validation.json), good and bad results alike
//   - the data files, for download
// Numbers are read from the saved files; nothing is typed in here.
import { mountNational } from "./national.js";
import { t } from "./i18n.js";
import { escapeHtml, num, date, demoBadge } from "./ui.js";
import { loadValidation } from "./data.js";
import { mountHome } from "./home.js";
import { mountGuide } from "./guide.js";

const FILES = [
  ["tanks.json", "rs.file.tanks"], ["climatology.json", "rs.file.climatology"], ["validation.json", "rs.file.validation"],
  ["crop_sources.json", "rs.file.crops"], ["places.json", "rs.file.places"],
];
const pct = (x) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);

function testsBlock(v) {
  if (!v) return `<p>${escapeHtml(t("rs.tests.none"))}</p>`;
  const crops = v.crops?.summary, el = v.summary?.elnino, tm = v.summary?.tank_model;
  const row = (title, text, good) => `<li class="rs-test ${good === true ? "good" : good === false ? "bad" : ""}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></li>`;
  return `
    <p class="fact-small">${escapeHtml(t("rs.tests.when", { date: v.generated ? date(v.generated) : "–" }))} ${demoBadge(v.demo)}</p>
    <ul class="rs-tests">
      ${crops ? row(t("rs.crops.title"), t("rs.crops.text", { a: pct(crops.accuracy), g: pct(crops.accuracy_guessing), n: num(crops.n, 0), ok: pct(crops.good_was_right) }), !!crops.beats_guessing) : ""}
      ${el ? row(t("rs.elnino.title"), t("rs.elnino.text", { h: el.hits, c: el.calls }), false) : ""}
      ${tm ? row(t("rs.tank.title"), t("rs.tank.text", { n: tm.tanks_beating_baseline, total: tm.tanks_tested }), false) : ""}
    </ul>
    <p class="fact-small">${escapeHtml(t("rs.tests.note"))}</p>`;
}

export async function renderResearch(state, parts, view) {
  const validation = await loadValidation();
  view.innerHTML = `
    <div class="tank-head learn-head">
      <h1>${escapeHtml(t("rs.title"))}</h1>
      <p class="meta">${escapeHtml(t("rs.sub"))}</p>
    </div>
    <div class="panel-body rs-page">
      <section class="block" aria-labelledby="rs-read">
        <h2 id="rs-read">${escapeHtml(t("rs.read"))}</h2>
        <div class="rs-cards">
          <a class="rs-card" href="#/how-it-works"><strong>${escapeHtml(t("nav.about"))}</strong><span>${escapeHtml(t("rs.card.how"))}</span></a>
        </div>
      </section>

      <section class="block" aria-labelledby="rs-uses">
        <h2 id="rs-uses">${escapeHtml(t("rs.uses.title"))}</h2>
        <div class="of-scroll"><table class="of-table rs-uses">
          <thead><tr><th scope="col">${escapeHtml(t("rs.uses.what"))}</th><th scope="col">${escapeHtml(t("rs.uses.from"))}</th><th scope="col">${escapeHtml(t("rs.uses.nasa"))}</th></tr></thead>
          <tbody>${["rain", "water", "green", "outlook", "forecast", "tanks"].map((k) => `<tr><th scope="row">${escapeHtml(t(`rs.uses.${k}.what`))}</th><td>${escapeHtml(t(`rs.uses.${k}.from`))}</td><td>${escapeHtml(t(`rs.uses.${k}.nasa`))}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>

      <section class="block" aria-labelledby="rs-tests">
        <h2 id="rs-tests">${escapeHtml(t("rs.tests.title"))}</h2>
        ${testsBlock(validation)}
      </section>

      <section class="block" aria-labelledby="rs-files">
        <h2 id="rs-files">${escapeHtml(t("rs.files.title"))}</h2>
        <p>${escapeHtml(t("rs.files.text"))}</p>
        <ul class="rs-files">${FILES.map(([f, key]) => `<li><a href="../data/${f}" target="_blank" rel="noopener" download>${escapeHtml(f)}</a> <span>${escapeHtml(t(key))}</span></li>`).join("")}</ul>
        <p class="fact-small">${escapeHtml(t("rs.files.tank"))}</p>
      </section>

      <section class="block" aria-labelledby="rs-limits">
        <h2 id="rs-limits">${escapeHtml(t("rs.limits.title"))}</h2>
        <ul class="rs-limits">${["power", "water", "demo", "sinhala", "advice"].map((k) => `<li>${escapeHtml(t(`rs.limits.${k}`))}</li>`).join("")}</ul>
      </section>
    </div>`;
  mountNational(view.querySelector(".rs-page"));          // NASA fires, groundwater and the flood/cloud map
  const home = document.createElement("div");
  view.prepend(home);
  mountHome(home, "research");
  const guide = document.createElement("div"); view.append(guide); mountGuide(guide, "research");          // detailed how-to guide
}
