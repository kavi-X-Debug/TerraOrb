// "My rewards" page (#/learn/rewards): the farmer level, drops, badges, the lesson card collection and the certificate.
// Everything shown here is read from this browser's saved progress (rewards.js); nothing is sent anywhere.
import { t } from "./i18n.js";
import { escapeHtml, date, localToday } from "./ui.js";
import { getRewards, setName, resetRewards, levelIndex, LEVELS, BADGES, LESSON_IDS, badgeIcon, emblem } from "./rewards.js";

const wire = (view) => view.querySelectorAll("[data-go]").forEach((el) => { el.onclick = () => { location.hash = el.dataset.go; }; });

// Where the child stands: current level, drops, and how far to the next level
export function levelSummary(s = getRewards()) {
  const i = levelIndex(s.drops), next = LEVELS[i + 1];
  return { index: i, name: t(`rw.level.${LEVELS[i].id}`), next, nextName: next ? t(`rw.level.${next.id}`) : "",
    left: next ? next.at - s.drops : 0, share: next ? (s.drops - LEVELS[i].at) / (next.at - LEVELS[i].at) : 1 };
}

function levelBlock(s) {
  const L = levelSummary(s);
  return `
  <section class="rw-hero" aria-labelledby="rw-level">
    ${emblem(L.index, 96)}
    <div class="rw-hero-text">
      <p class="rw-kicker">${escapeHtml(t("rw.level.label"))}</p>
      <h2 id="rw-level">${escapeHtml(L.name)}</h2>
      <p class="rw-drops"><span class="rw-dropmark" aria-hidden="true"></span><strong>${escapeHtml(t("rw.drops", { n: s.drops }))}</strong></p>
      <div class="rw-bar" role="img" aria-label="${escapeHtml(L.next ? t("rw.next", { n: L.left, level: L.nextName }) : t("rw.max"))}"><span style="width:${Math.round(L.share * 100)}%"></span></div>
      <p class="rw-sub">${escapeHtml(L.next ? t("rw.next", { n: L.left, level: L.nextName }) : t("rw.max"))}</p>
      ${s.streak >= 2 ? `<p class="rw-streak">${badgeIcon("flame", "red", 26)} ${escapeHtml(t("rw.streak", { n: s.streak }))}</p>` : ""}
    </div>
  </section>`;
}

function badgesBlock(s) {
  const got = BADGES.filter((b) => s.badges[b.id]).length;
  return `
  <section class="rw-sec" aria-labelledby="rw-badges">
    <h2 id="rw-badges">${escapeHtml(t("rw.badges.title"))}</h2>
    <p class="rw-sub">${escapeHtml(t("rw.badges.count", { n: got, total: BADGES.length }))}</p>
    <ul class="rw-badges">${BADGES.map((b) => {
      const on = !!s.badges[b.id];
      return `<li class="rw-badge${on ? " on" : ""}">
        ${badgeIcon(b.icon, b.tone, 60, !on)}
        <strong>${escapeHtml(t(`rw.badge.${b.id}.name`))}</strong>
        <span>${escapeHtml(t(`rw.badge.${b.id}.desc`, { total: LESSON_IDS.length }))}</span>
        ${on ? `<em>${escapeHtml(date(s.badges[b.id], { day: "numeric", month: "short" }))}</em>` : `<em>${escapeHtml(t("rw.locked"))}</em>`}
      </li>`;
    }).join("")}</ul>
  </section>`;
}

function cardsBlock(s) {
  const got = LESSON_IDS.filter((id) => s.cards[id]).length;
  return `
  <section class="rw-sec" aria-labelledby="rw-cards">
    <h2 id="rw-cards">${escapeHtml(t("rw.cards.title"))}</h2>
    <p class="rw-sub">${escapeHtml(t("rw.cards.count", { n: got, total: LESSON_IDS.length }))}</p>
    <div class="rw-cards">${LESSON_IDS.map((id) => {
      const on = !!s.cards[id], title = t(`ls.${id}.title`);
      return on
        ? `<button type="button" class="rw-card on" data-card aria-pressed="false" aria-label="${escapeHtml(title)}. ${escapeHtml(t("rw.cards.flip"))}">
             <span class="rw-card-in">
               <span class="rw-face rw-front"><img src="img/lessons/${id}1.jpg" alt="" loading="lazy" width="320" height="180"><strong>${escapeHtml(title)}</strong></span>
               <span class="rw-face rw-back"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(t(`ls.${id}.learned`))}</span></span>
             </span>
           </button>`
        : `<div class="rw-card off" role="img" aria-label="${escapeHtml(t("rw.cards.locked"))}">
             <span class="rw-card-in"><span class="rw-face rw-front"><img src="img/lessons/${id}1.jpg" alt="" loading="lazy" width="320" height="180"><strong>?</strong></span></span>
           </div>`;
    }).join("")}</div>
    <p class="rw-sub">${escapeHtml(t("rw.cards.hint"))}</p>
  </section>`;
}

function certBlock(s) {
  const got = LESSON_IDS.filter((id) => s.cards[id]).length, total = LESSON_IDS.length;
  if (got < total) {
    return `
    <section class="rw-sec" aria-labelledby="rw-cert">
      <h2 id="rw-cert">${escapeHtml(t("rw.cert.title"))}</h2>
      <p>${escapeHtml(t("rw.cert.locked", { n: got, total }))}</p>
      <div class="rw-bar"><span style="width:${Math.round((got / total) * 100)}%"></span></div>
    </section>`;
  }
  return `
  <section class="rw-sec rw-cert-sec" aria-labelledby="rw-cert">
    <h2 id="rw-cert">${escapeHtml(t("rw.cert.title"))}</h2>
    <label class="rw-name">${escapeHtml(t("rw.cert.name"))}
      <input id="rw-name" type="text" maxlength="30" value="${escapeHtml(s.name)}" autocomplete="off">
    </label>
    <div class="rw-cert-buttons">
      <button type="button" class="mg-big" id="rw-showcert">${escapeHtml(t("rw.cert.show"))}</button>
      <button type="button" class="mg-small" id="rw-print" hidden>${escapeHtml(t("rw.cert.print"))}</button>
    </div>
    <div class="rw-cert" id="rw-certbox" hidden>
      ${emblem(levelIndex(s.drops), 72)}
      <p class="rw-cert-top">${escapeHtml(t("rw.cert.heading"))}</p>
      <p class="rw-cert-name" id="rw-certname"></p>
      <p class="rw-cert-text">${escapeHtml(t("rw.cert.text", { total }))}</p>
      <p class="rw-cert-meta">${escapeHtml(t("rw.cert.meta", { level: levelSummary(s).name, drops: s.drops, date: date(localToday()) }))}</p>
      <p class="rw-cert-foot">${escapeHtml(t("rw.cert.foot"))}</p>
    </div>
  </section>`;
}

export function renderRewards(state, parts, view) {
  const s = getRewards();
  view.innerHTML = `
    <div class="tank-head learn-head">
      <button type="button" class="back" data-go="#/learn">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
        ${escapeHtml(t("kd.back"))}
      </button>
      <h1>${escapeHtml(t("rw.title"))}</h1>
    </div>
    <div class="panel-body rw-page">
      ${levelBlock(s)}
      <section class="rw-sec rw-how" aria-labelledby="rw-how">
        <h2 id="rw-how">${escapeHtml(t("rw.how.title"))}</h2>
        <p>${escapeHtml(t("rw.how.text"))}</p>
      </section>
      ${badgesBlock(s)}
      ${cardsBlock(s)}
      ${certBlock(s)}
      <section class="rw-sec rw-reset">
        <p class="rw-sub">${escapeHtml(t("rw.reset.note"))}</p>
        <button type="button" class="mg-small" id="rw-reset">${escapeHtml(t("rw.reset"))}</button>
      </section>
    </div>`;
  wire(view);

  // tap a collected card to turn it over and read the fact on the back
  view.querySelectorAll("[data-card]").forEach((b) => {
    b.onclick = () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("flipped", on); };
  });

  // certificate: the child types their own name (kept in this browser only)
  const show = view.querySelector("#rw-showcert");
  if (show) {
    const input = view.querySelector("#rw-name"), box = view.querySelector("#rw-certbox"), nameEl = view.querySelector("#rw-certname"), print = view.querySelector("#rw-print");
    show.onclick = () => {
      setName(input.value.trim());
      nameEl.textContent = input.value.trim() || t("rw.cert.noname");
      box.hidden = false; print.hidden = false;
      box.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    print.onclick = () => {
      document.body.classList.add("rw-printing");
      window.addEventListener("afterprint", () => document.body.classList.remove("rw-printing"), { once: true });
      window.print();
    };
  }

  // reset: two taps, so it cannot happen by accident
  const reset = view.querySelector("#rw-reset");
  let armed = false;
  reset.onclick = () => {
    if (!armed) { armed = true; reset.textContent = t("rw.reset.sure"); setTimeout(() => { armed = false; reset.textContent = t("rw.reset"); }, 4000); return; }
    resetRewards();
    renderRewards(state, parts, view);
  };
}
