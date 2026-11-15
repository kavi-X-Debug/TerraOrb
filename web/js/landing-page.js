// The landing page (index.html): scroll animations, dark/light switch, language buttons and the live numbers.
// No animation library: IntersectionObserver reveals sections, requestAnimationFrame writes a few CSS variables.
// All text comes from the strings files (data-i18n); the numbers in the stats row are counted from the project's data files.
import { loadStrings, translatePage, setLang, getLang, t } from "./i18n.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Text and language
// ---------------------------------------------------------------------------
function applyLang(code) {
  setLang(code);
  $$("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === code)));
  translatePage();
  document.title = t("lp.title");
  $('meta[name="description"]').setAttribute("content", t("lp.desc"));
  setThemeLabel();
}

// ---------------------------------------------------------------------------
// Dark / light mode (saved in localStorage; the page starts dark, the inline script in index.html applies the saved choice early)
// ---------------------------------------------------------------------------
const root = document.documentElement;
function setThemeLabel() {
  const dark = root.dataset.theme !== "light";
  const btn = $("#theme");
  btn.setAttribute("aria-pressed", String(!dark));
  $("#theme-label").textContent = t(dark ? "lp.theme.dark" : "lp.theme.light");
  $('meta[name="theme-color"]').setAttribute("content", dark ? "#040806" : "#f3f8f4");
}
function toggleTheme() {
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  try { localStorage.setItem("mc-landing-theme", root.dataset.theme); } catch { /* storage blocked: the choice lasts until reload */ }
  setThemeLabel();
}

// ---------------------------------------------------------------------------
// Header, progress bar and parallax: one rAF loop reads the scroll position and writes CSS variables
// ---------------------------------------------------------------------------
const header = $("#top-bar"), stage = $("#stage"), track = stage?.parentElement, timeline = $(".timeline");
let ticking = false;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function frame() {
  ticking = false;
  const y = window.scrollY, max = document.documentElement.scrollHeight - innerHeight;
  root.style.setProperty("--scroll", max > 0 ? (y / max).toFixed(4) : 0);
  header.classList.toggle("scrolled", y > 24);
  if (!reduced) {
    if (y < innerHeight * 1.2) root.style.setProperty("--sy", y);                    // hero parallax
    if (track) {                                                                      // the story scene: progress 0..1 through the tall section
      const r = track.getBoundingClientRect(), p = clamp(-r.top / Math.max(1, r.height - innerHeight));
      stage.style.setProperty("--p", p.toFixed(4));
      stage.style.setProperty("--r", clamp((p - 0.22) / 0.22).toFixed(3));           // rain starts after the satellite has passed
      stage.style.setProperty("--w", (0.08 + 0.9 * clamp((p - 0.3) / 0.45)).toFixed(3));   // the tank fills
      stage.style.setProperty("--g", clamp((p - 0.68) / 0.25).toFixed(3));           // the paddy grows
      stage.dataset.step = p < 0.34 ? "1" : p < 0.68 ? "2" : "3";
      setFrame(p);
    }
    if (timeline) {                                                                   // the benefits line draws itself
      const r = timeline.getBoundingClientRect();
      timeline.style.setProperty("--tl", clamp((innerHeight * 0.65 - r.top) / r.height).toFixed(3));
    }
    $$(".svc-media img").forEach((img) => {                                           // small parallax inside each service picture
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) img.style.setProperty("--py", ((r.top + r.height / 2 - innerHeight / 2) * -0.06).toFixed(1));
    });
  } else if (timeline) {
    timeline.style.setProperty("--tl", 1);
  }
}
const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };

// ---------------------------------------------------------------------------
// The story animation made in Google Flow: nine frames of one scene (img/landing/story-1..9.jpg). If any frame is missing the page keeps
// the drawn SVG scene instead. While scrolling, the two frames around the scroll position are cross-faded, like a short film you scrub.
// ---------------------------------------------------------------------------
const FRAMES = 9;
let frameImgs = null, frameDots = null;
function loadFrames() {
  const wrap = $("#scene-wrap"), box = $("#frames");
  if (!wrap || !box) return;
  const imgs = Array.from({ length: FRAMES }, (_, i) => {
    const img = new Image();
    img.className = "frame";
    img.alt = "";
    img.decoding = "async";
    img.src = `img/landing/story-${i + 1}.jpg`;
    return img;
  });
  Promise.all(imgs.map((img) => new Promise((done) => {                           // load/error events work in every browser state (decode() can stall in background tabs)
    if (img.complete) return done(img.naturalWidth > 0);
    img.addEventListener("load", () => done(true), { once: true });
    img.addEventListener("error", () => done(false), { once: true });
  }))).then((ok) => {
    if (!ok.every(Boolean)) return;                                              // not all frames exist yet: keep the SVG scene
    const dots = document.createElement("div");
    dots.className = "frame-dots";
    dots.innerHTML = imgs.map(() => "<i></i>").join("");
    box.replaceChildren(...imgs, dots);
    frameImgs = imgs; frameDots = [...dots.children];
    wrap.classList.add("has-frames");
    setFrame(parseFloat(stage?.style.getPropertyValue("--p")) || 0);
  });
}
function setFrame(p) {
  if (!frameImgs) return;
  const pos = clamp(p) * (FRAMES - 1), i = Math.min(FRAMES - 2, Math.floor(pos)), f = pos - i;
  frameImgs.forEach((img, k) => { img.style.opacity = k <= i ? "1" : k === i + 1 ? f.toFixed(3) : "0"; });   // earlier frames stay underneath, the next one fades in on top
  frameDots?.forEach((d, k) => d.classList.toggle("on", k === Math.round(pos)));
}

// ---------------------------------------------------------------------------
// Reveal on scroll
// ---------------------------------------------------------------------------
function startReveal() {
  const items = $$(".reveal");
  if (reduced || !("IntersectionObserver" in window)) { items.forEach((el) => el.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
  items.forEach((el) => io.observe(el));
}

// ---------------------------------------------------------------------------
// Live numbers: counted from the data files. A number that cannot be loaded stays "–" (never guessed).
// ---------------------------------------------------------------------------
async function json(path) {
  try { const r = await fetch(path); return r.ok ? await r.json() : null; } catch { return null; }
}
async function loadCounts() {
  const [tanks, trip, hist, cfg] = await Promise.all([json("../data/tanks.json"), json("../data/trip/destinations.json"),
    json("../data/trip/rainfall_history.json"), json("../data/trip/trip_config.json")]);
  return {
    tanks: tanks?.tanks?.length ?? null,
    places: trip?.destinations?.length ?? null,
    years: hist?.years ?? null,
    days: cfg?.forecast_horizon_days ?? null,
    ends: $$(".service").length || null,
  };
}
function countUp(el, to) {
  if (to === null || to === undefined) return;
  if (reduced) { el.textContent = String(to); return; }
  const t0 = performance.now(), dur = 1400;
  const step = (now) => {
    const k = clamp((now - t0) / dur), eased = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(to * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
async function startCounters() {
  const counts = await loadCounts();
  const els = $$("[data-count]");
  const run = (el) => countUp(el, counts[el.dataset.count]);
  if (reduced || !("IntersectionObserver" in window)) { els.forEach(run); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.6 });
  els.forEach((el) => io.observe(el));
}

// ---------------------------------------------------------------------------
// Rain on the hero: a light canvas of falling streaks, paused when the hero is off-screen or the visitor prefers less motion
// ---------------------------------------------------------------------------
function startRain() {
  const canvas = $("#rain");
  if (!canvas || reduced) { canvas?.remove(); return; }
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, drops = [], running = true, last = 0;
  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = Math.round(r.width * dpr); h = canvas.height = Math.round(r.height * dpr);
    const n = Math.round(Math.min(120, r.width / 9));
    drops = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, l: (10 + Math.random() * 22) * dpr, v: (260 + Math.random() * 360) * dpr, a: 0.25 + Math.random() * 0.5 }));
  };
  const draw = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.4 * (devicePixelRatio || 1);
    const light = root.dataset.theme === "light";
    for (const d of drops) {
      d.y += d.v * dt; d.x -= d.v * dt * 0.12;
      if (d.y - d.l > h) { d.y = -d.l; d.x = Math.random() * w * 1.1; }
      ctx.strokeStyle = light ? `rgba(15,90,52,${d.a * 0.6})` : `rgba(110,231,168,${d.a})`;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.12, d.y + d.l); ctx.stroke();
    }
    requestAnimationFrame(draw);
  };
  resize();
  addEventListener("resize", resize);
  new IntersectionObserver(([e]) => { const was = running; running = e.isIntersecting; if (running && !was) requestAnimationFrame(draw); }).observe($("#hero"));
  requestAnimationFrame(draw);
}

// ---------------------------------------------------------------------------
// Pictures: a missing generated picture falls back to an existing site picture; the optional hero video plays only if the file exists
// ---------------------------------------------------------------------------
function pictures() {
  $$("img[data-fallback]").forEach((img) => {
    const fb = img.dataset.fallback;
    img.addEventListener("error", () => { if (img.getAttribute("src") !== fb) img.src = fb; }, { once: true });
    if (img.complete && img.naturalWidth === 0) img.src = fb;
  });
  const video = $(".hero-video");
  if (video && !reduced) {
    fetch("img/landing/hero.mp4", { method: "HEAD" }).then((r) => {
      if (!r.ok) return;
      video.src = "img/landing/hero.mp4";
      video.addEventListener("canplay", () => { video.classList.add("on"); video.play().catch(() => {}); }, { once: true });
    }).catch(() => {});
  } else video?.remove();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function start() {
  $("#theme").addEventListener("click", toggleTheme);
  const burger = $("#burger"), nav = $("#nav");
  burger.addEventListener("click", () => { const open = nav.classList.toggle("open"); burger.setAttribute("aria-expanded", String(open)); });
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); } });
  try { await loadStrings(); } catch (err) { document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="wrap">Could not load the text files (${err.message}).</p>`); }
  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => applyLang(b.dataset.lang)));
  applyLang(getLang());
  pictures();
  loadFrames();
  startReveal();
  startCounters();
  startRain();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  frame();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
start();
