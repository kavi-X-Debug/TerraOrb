// The home pages of the apps: a hero banner (optional) and "what you can do here" service cards, each with a picture.
// One shared component, so every app's home looks and behaves alike:
//   mountHome(element, "farmer" | "learn" | "officer" | "research", { hero: true })
// All text comes from web/strings/home.*.json (keys hm.<end>.*); the pictures are web/img/home/<end>-<n>.jpg and hero-<end>.jpg (made in
// Google Flow). A picture that is missing falls back to an existing site picture, so a home page never has a hole.
// Optional: web/img/home/hero-<end>.mp4 (a short loop) plays behind the hero when the file exists. Scroll animations use
// IntersectionObserver and CSS only; prefers-reduced-motion turns them off.
import { t } from "./i18n.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// What each app offers. `href` is a page address, or "scroll:<selector>" (smooth scroll on this page), or "assistant:" (opens the chat).
const HOMES = {
  farmer: {
    services: [
      { k: "s1", img: "farmer-1", fb: "img/hero.jpg", href: "scroll:#hero" },
      { k: "s2", img: "farmer-2", fb: "img/crops.jpg", href: "scroll:#hero" },
      { k: "s3", img: "farmer-3", fb: "img/how/farmer.jpg", href: "#/calendar" },
      { k: "s4", img: "farmer-4", fb: "img/rain.jpg", href: "scroll:#hero" },
      { k: "s5", img: "farmer-5", fb: "img/how/satellite.jpg", href: "#/farm" },
      { k: "s6", img: "farmer-6", fb: "img/how/meeting.jpg", href: "assistant:" },
    ],
  },
  learn: {
    hero: { img: "hero-learn", fb: "img/learn/hero.jpg", cta: "#/learn/lessons" },
    services: [
      { k: "s1", img: "learn-1", fb: "img/learn/hero.jpg", href: "#/learn/lessons" },
      { k: "s2", img: "learn-2", fb: "img/learn/kids.jpg", href: "#/learn/kids" },
      { k: "s3", img: "learn-3", fb: "img/learn/cloud.jpg", href: "#/learn/cloud" },
      { k: "s4", img: "learn-4", fb: "img/learn/challenges.jpg", href: "#/learn/challenges" },
      { k: "s5", img: "learn-5", fb: "img/learn/farmer.jpg", href: "#/learn/rewards" },
    ],
  },
  officer: {
    hero: { img: "hero-officer", fb: "img/how/laptop.jpg", cta: "scroll:.fm-card" },
    services: [
      { k: "s1", img: "officer-1", fb: "img/how/laptop.jpg", href: "scroll:.fm-card" },
      { k: "s2", img: "officer-2", fb: "img/how/satellite.jpg", href: "scroll:.fm-card" },
      { k: "s3", img: "officer-3", fb: "img/how/meeting.jpg", href: "scroll:.fm-card" },
      { k: "s4", img: "officer-4", fb: "img/how/farmer.jpg", href: "scroll:.fm-card" },
    ],
  },
  research: {
    hero: { img: "hero-research", fb: "img/how/satellite.jpg", cta: "#/how-it-works" },
    services: [
      { k: "s1", img: "research-1", fb: "img/how/satellite.jpg", href: "#/how-it-works" },
      { k: "s2", img: "research-2", fb: "img/how/laptop.jpg", href: "scroll:.rs-tests" },
      { k: "s3", img: "research-3", fb: "img/how/rain.jpg", href: "#/how-it-works" },
      { k: "s4", img: "research-4", fb: "img/how/meeting.jpg", href: "#/how-it-works" },
    ],
  },
};
const DIR = "img/home/";
const mounted = new Set();

function actionAttrs(href) {
  if (href.startsWith("scroll:")) return `href="#" data-scroll="${esc(href.slice(7))}"`;
  if (href === "assistant:") return `href="#" data-assistant="1"`;
  return `href="${esc(href)}"`;
}

// Parts: hero banner, heading ("what you can do here"), service cards, "why it helps" chips. Each app uses the parts it needs.
export function homeHtml(end, { hero = true, heading = true, cards = true, why = true } = {}) {
  const d = HOMES[end];
  if (!d) return "";
  const has = (key) => t(key) !== key;
  const pic = (img, fb, cls = "") => `<img class="${cls}" src="${DIR}${img}.jpg" data-fallback="${esc(fb)}" alt="" width="640" height="400" loading="${cls ? "eager" : "lazy"}" decoding="async">`;   // the hero (has a class) is at the top: load it at once
  const heroHtml = hero && d.hero ? `
    <section class="hm-hero" aria-labelledby="hm-h1">
      <div class="hm-hero-media" aria-hidden="true">${pic(d.hero.img, d.hero.fb, "hm-hero-img")}<video class="hm-hero-video" muted loop playsinline preload="none"></video></div>
      <div class="hm-hero-shade" aria-hidden="true"></div>
      <div class="hm-hero-in">
        <h1 id="hm-h1" class="hm-reveal">${esc(t(`hm.${end}.title`))}</h1>
        <p class="hm-lead hm-reveal" style="--i:1">${esc(t(`hm.${end}.lead`))}</p>
        <a class="hm-btn hm-reveal" style="--i:2" ${actionAttrs(d.hero.cta)}>${esc(t(`hm.${end}.cta`))}</a>
      </div>
    </section>` : "";
  const title = has(`hm.${end}.title2`) ? t(`hm.${end}.title2`) : t(`hm.${end}.title`);
  const headHtml = heading ? `
      <p class="hm-kicker hm-reveal">${esc(t("hm.kicker"))}</p>
      <${end === "farmer" ? "h1" : "h2"} id="hm-h2" class="hm-reveal" style="--i:1">${esc(title)}</${end === "farmer" ? "h1" : "h2"}>
      ${end === "farmer" ? `<p class="hm-sub hm-reveal" style="--i:2">${esc(t("hm.farmer.lead"))}</p>` : ""}` : "";
  const cardsHtml = cards ? `<div class="hm-grid">${d.services.map((sv, i) => `
      <a class="hm-card hm-reveal" style="--i:${i}" ${actionAttrs(sv.href)}>
        <span class="hm-media">${pic(sv.img, sv.fb)}</span>
        <span class="hm-body"><strong>${esc(t(`hm.${end}.${sv.k}.t`))}</strong><span>${esc(t(`hm.${end}.${sv.k}.d`))}</span>
          <em class="hm-go">${esc(t("hm.go"))}<i aria-hidden="true"></i></em></span>
      </a>`).join("")}</div>` : "";
  const whyItems = why ? [1, 2, 3].filter((n) => has(`hm.${end}.b${n}`)).map((n) => `<li class="hm-reveal" style="--i:${n}">${esc(t(`hm.${end}.b${n}`))}</li>`).join("") : "";
  const whyHtml = whyItems ? `<ul class="hm-why" aria-label="${esc(t("hm.why"))}">${whyItems}</ul>` : "";
  const body = `${headHtml}${cardsHtml}${whyHtml}`.trim();
  return `${heroHtml}${body ? `<section class="hm-services"${heading ? ' aria-labelledby="hm-h2"' : ""}>${body}</section>` : ""}`;
}

// Put the home content into `el` and make it alive: pictures with fallbacks, scroll reveal, hero video, link actions
export function mountHome(el, end, opts = {}) {
  if (!el || !HOMES[end]) return;
  const paint = () => {
    el.classList.add("hm-home");
    el.innerHTML = homeHtml(end, opts);
    wire(el, end);
  };
  paint();
  if (!mounted.has(el)) {                                              // repaint in the other language when it is switched
    mounted.add(el);
    document.addEventListener("mc-lang", () => { if (el.isConnected) paint(); else mounted.delete(el); });
  }
}

function wire(el, end) {
  el.querySelectorAll("img[data-fallback]").forEach((img) => {
    const fb = img.dataset.fallback;
    img.addEventListener("error", () => { if (img.getAttribute("src") !== fb) img.src = fb; }, { once: true });
    if (img.complete && img.naturalWidth === 0) img.src = fb;
  });
  el.querySelectorAll("[data-scroll]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(a.dataset.scroll);
    target?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
    target?.querySelector?.("input")?.focus({ preventScroll: true });
  }));
  el.querySelectorAll("[data-assistant]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.querySelector(".asst-fab")?.click(); }));

  const items = [...el.querySelectorAll(".hm-reveal")];
  if (reduced() || !("IntersectionObserver" in window)) items.forEach((n) => n.classList.add("in"));
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
    items.forEach((n) => io.observe(n));
  }
  const video = el.querySelector(".hm-hero-video");                       // an optional loop made in Flow: used only if the file exists
  if (video) {
    if (reduced()) { video.remove(); return; }
    fetch(`${DIR}hero-${end}.mp4`, { method: "HEAD" }).then((r) => {
      if (!r.ok) { video.remove(); return; }
      video.src = `${DIR}hero-${end}.mp4`;
      video.addEventListener("canplay", () => { video.classList.add("on"); video.play().catch(() => {}); }, { once: true });
    }).catch(() => video.remove());
  }
}
