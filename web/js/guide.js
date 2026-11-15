// "How to use" guide for the home page of each end: one card per service with what it does, numbered steps, a tip, a picture
// (web/img/guide/<end>-<section>.jpg) and an optional short video (<end>-<section>.mp4). Text keys gd.<end>.* come from
// web/strings/guide-<end>.{en,si}.json (see docs/guide-spec.md). A missing picture or video is hidden; a missing end shows nothing.
import { t } from "./i18n.js";

const DIR = "img/guide/";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const has = (key) => t(key) !== key;
const mounted = new WeakSet();

function ensureCss() {
  if (document.getElementById("guide-css")) return;
  const link = document.createElement("link");
  link.id = "guide-css"; link.rel = "stylesheet"; link.href = "css/guide.css";
  document.head.append(link);
}

function guideHtml(end) {
  if (!has(`gd.${end}.sections`)) return "";
  const ids = t(`gd.${end}.sections`).split(",").map((s) => s.trim()).filter(Boolean);
  const cards = ids.map((id, i) => {
    const k = `gd.${end}.${id}`;
    if (!has(`${k}.name`)) return "";
    const steps = [1, 2, 3, 4, 5].filter((n) => has(`${k}.step${n}`)).map((n) => `<li>${esc(t(`${k}.step${n}`))}</li>`).join("");
    const go = has(`${k}.go`) && has(`${k}.route`) ? `<a class="gd-go" href="${esc(t(`${k}.route`))}">${esc(t(`${k}.go`))}<i aria-hidden="true"></i></a>` : "";
    return `<article class="gd-card gd-reveal" style="--i:${i % 3}" id="gd-${end}-${id}">
      <div class="gd-media"><img src="${DIR}${end}-${id}.jpg" alt="" width="640" height="400" loading="lazy" decoding="async"><video muted loop playsinline preload="none" data-src="${DIR}${end}-${id}.mp4"></video><span class="gd-num">${i + 1}</span></div>
      <div class="gd-body"><h3>${esc(t(`${k}.name`))}</h3><p class="gd-what">${esc(t(`${k}.what`))}</p>
        ${steps ? `<ol class="gd-steps">${steps}</ol>` : ""}
        ${has(`${k}.tip`) ? `<p class="gd-tip"><strong>${esc(t("gd.tip"))}</strong> ${esc(t(`${k}.tip`))}</p>` : ""}${go}</div>
    </article>`;
  }).join("");
  const nav = ids.filter((id) => has(`gd.${end}.${id}.name`)).map((id) => `<a href="#" data-gd="gd-${end}-${id}">${esc(t(`gd.${end}.${id}.name`))}</a>`).join("");
  return `<section class="gd" aria-labelledby="gd-title-${end}">
    <p class="gd-kicker">${esc(t("gd.kicker"))}</p>
    <h2 id="gd-title-${end}">${esc(t(`gd.${end}.title`))}</h2>
    <p class="gd-intro">${esc(t(`gd.${end}.intro`))}</p>
    <nav class="gd-jump" aria-label="${esc(t("gd.jump"))}">${nav}</nav>
    <div class="gd-list">${cards}</div></section>`;
}

function wire(el) {
  // pictures or videos that do not exist are hidden, not shown broken
  el.querySelectorAll(".gd-media img").forEach((img) => img.addEventListener("error", () => { img.closest(".gd-media").classList.add("gd-nopic"); }, { once: true }));
  el.querySelectorAll(".gd-jump a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const card = el.querySelector(`#${a.dataset.gd}`);
    if (card) card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }));
  const cards = [...el.querySelectorAll(".gd-reveal")];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) cards.forEach((c) => c.classList.add("in"));
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const card = e.target, video = card.querySelector("video");
      if (e.isIntersecting) {
        card.classList.add("in");
        if (video && !reduced) {                                    // play the video only while on screen, if the file exists
          if (!video.src) { video.src = video.dataset.src; video.addEventListener("error", () => video.remove(), { once: true }); video.addEventListener("canplay", () => video.classList.add("on"), { once: true }); }
          video.play().catch(() => {});
        }
      } else if (video) video.pause();
    }), { threshold: 0.35 });
    cards.forEach((c) => io.observe(c));
  }
}

/** Put the guide for `end` into `el` (repainted when the language changes). */
export function mountGuide(el, end) {
  if (!el) return;
  ensureCss();
  const paint = () => { el.innerHTML = guideHtml(end); wire(el); };
  paint();
  if (!mounted.has(el)) {
    mounted.add(el);
    document.addEventListener("mc-lang", () => { if (el.isConnected) paint(); });
  }
}
