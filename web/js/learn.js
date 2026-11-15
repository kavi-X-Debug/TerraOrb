// Learn Mode home page (#/learn): a hub of games, each with its own picture (made with Google Flow, see the Data sources page).
// The games live in their own files: Rain Cloud, Tank Farmer / My Farm, Little Lessons, Little Farmers' Games and the practice challenges.
import { t } from "./i18n.js";
import { escapeHtml } from "./ui.js";
import { renderChallenges } from "./challenges.js";
import { renderMiniGame } from "./minigame.js";
import { renderKids } from "./kids.js";
import { renderCloudGame } from "./cloudgame.js";
import { renderLessons } from "./lessons.js";
import { renderRewards, levelSummary } from "./rewardspage.js";
import { getRewards, emblem, BADGES } from "./rewards.js";

const go = (hash) => { location.hash = hash; };

export function renderLearn(state, parts, view) {
  // parts: [] | ["kids", ...] | ["play", ...] | ["cloud"] | ["lessons", ...] | ["challenges", ...]
  if (parts[0] === "kids") return renderKids(state, parts.slice(1), view);
  if (parts[0] === "play") return renderMiniGame(state, view, parts.slice(1));
  if (parts[0] === "cloud") return renderCloudGame(state, view);
  if (parts[0] === "lessons") return renderLessons(state, parts.slice(1), view);
  if (parts[0] === "challenges") return renderChallenges(state, parts.slice(1), view);
  if (parts[0] === "rewards") return renderRewards(state, parts.slice(1), view);
  return hubScreen(view);
}

function wireLinks(view) {
  view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => go(el.dataset.go); });
}

// ---------------------------------------------------------------------------
// The Learn Mode home page: a hub of games, each with its own picture (made with Google Flow, see the Data sources page).
// ---------------------------------------------------------------------------
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };   // saved by the games, in this browser only
const CARDS = [
  { id: "cloud", href: "#/learn/cloud", img: "img/learn/cloud.jpg", big: true, fresh: true },
  { id: "farm", href: "#/learn/play", img: "img/learn/farmer.jpg", big: true, fresh: true, second: { href: "#/learn/play/farm", key: "lh.farm.open" } },
  { id: "lessons", href: "#/learn/lessons", img: "img/lessons/water1.jpg", fresh: true },
  { id: "kids", href: "#/learn/kids", img: "img/learn/kids.jpg" },
  { id: "challenges", href: "#/learn/challenges", img: "img/learn/challenges.jpg" },
];

function cardStatus(id) {
  if (id === "cloud") {
    const stars = (readJson("mc-cloud-stars") || []).reduce((a, n) => a + (n || 0), 0);
    return stars ? t("lh.status.cloud", { n: stars }) : "";
  }
  if (id === "lessons") {
    const got = Object.values(readJson("mc-lessons") || {}).reduce((a, n) => a + (n || 0), 0);
    return got ? t("lh.status.lessons", { n: got }) : "";
  }
  if (id === "farm") {
    const f = readJson("mc-farm"), planted = f?.levels ? Object.values(f.levels).filter((v) => v > 0).length : 0;
    return planted ? t("lh.status.farm", { n: planted }) : "";
  }
  return "";
}

function hubCard(c, i) {
  const title = c.id === "kids" ? t("mg.entry_title") : c.id === "challenges" ? t("challenge.entry_title") : t(`lh.card.${c.id}.title`);
  const text = c.id === "kids" ? t("mg.entry_text") : c.id === "challenges" ? t("challenge.entry_text") : t(`lh.card.${c.id}.text`);
  const status = cardStatus(c.id);
  const open = `<a class="lh-go" href="${c.href}">${escapeHtml(t("lh.play"))}</a>`;
  return `
    <article class="lh-card ${c.big ? "big" : ""}" style="--i:${i}">
      <figure class="lh-art">
        <img src="${c.img}" alt="" loading="lazy" decoding="async">
        ${c.fresh ? `<span class="lh-new">${escapeHtml(t("lh.new"))}</span>` : ""}
        ${status ? `<span class="lh-status">${escapeHtml(status)}</span>` : ""}
      </figure>
      <div class="lh-body">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(text)}</p>
        <div class="lh-actions">${open}${c.second ? `<a class="lh-go alt" href="${c.second.href}">${escapeHtml(t(c.second.key))}</a>` : ""}</div>
      </div>
      <a class="lh-cover" href="${c.href}" aria-label="${escapeHtml(title)}" tabindex="-1"></a>
    </article>`;
}

// The strip under the hero: the child's level, drops and how far to the next level; a tap opens "My rewards"
function rewardStrip() {
  const s = getRewards(), L = levelSummary(s), badges = BADGES.filter((b) => s.badges[b.id]).length;
  return `
    <a class="lh-rw" href="#/learn/rewards" aria-label="${escapeHtml(t("lh.rw.open"))}">
      ${emblem(L.index, 64)}
      <span class="lh-rw-main">
        <strong>${escapeHtml(L.name)}</strong>
        <span><span class="rw-dropmark" aria-hidden="true"></span>${escapeHtml(t("rw.drops", { n: s.drops }))} · ${escapeHtml(t("rw.badges.count", { n: badges, total: BADGES.length }))}</span>
        <span class="rw-bar" aria-hidden="true"><span style="width:${Math.round(L.share * 100)}%"></span></span>
      </span>
      <span class="lh-go alt">${escapeHtml(t("lh.rw.open"))}</span>
    </a>`;
}

function hubScreen(view) {
  view.innerHTML = `
    <div class="panel-body lh">
      <section class="lh-hero">
        <img class="lh-hero-img" src="img/learn/hero.jpg" alt="" decoding="async">
        <div class="lh-hero-shade" aria-hidden="true"></div>
        <div class="lh-hero-text">
          <p class="hero-kicker">${escapeHtml(t("lh.kicker"))}</p>
          <h1>${escapeHtml(t("lh.title"))}</h1>
          <p class="lh-tagline">${escapeHtml(t("lh.tagline"))}</p>
        </div>
      </section>
      ${rewardStrip()}
      <section class="lh-grid" aria-label="${escapeHtml(t("lh.title"))}">${CARDS.map(hubCard).join("")}</section>
    </div>`;

  wireLinks(view);
}
