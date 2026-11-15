// The navigation bar (all apps): a highlight that slides to the current page, a small-screen menu, and a "scrolled" shadow.
// It only reads the page's markup (js/main.js still decides which link is current by setting aria-current="page"), so it never
// changes what the links do. If this script fails, the bar still works: the CSS shows the current link without the slide.
const $ = (s, r = document) => r.querySelector(s);
const header = $("#site-header"), nav = $(".site-nav"), ind = $(".nav-ind"), burger = $("#nav-burger"), panel = $("#site-menu");
const small = () => window.matchMedia("(max-width: 1199px)").matches;

// ---- the sliding highlight ----
function place() {
  if (!nav || !ind) return;
  const current = nav.querySelector('a[aria-current="page"]');
  if (!current || small()) { ind.classList.remove("on"); nav.classList.remove("has-ind"); return; }
  const n = nav.getBoundingClientRect(), a = current.getBoundingClientRect();
  ind.style.setProperty("--x", `${Math.round(a.left - n.left - 1)}px`);          // 1 = the nav's border (the highlight is positioned inside it)
  ind.style.setProperty("--w", `${Math.round(a.width)}px`);
  nav.classList.add("has-ind");
  requestAnimationFrame(() => ind.classList.add("on"));
}
const later = () => setTimeout(place, 60);
if (nav) {
  new MutationObserver(later).observe(nav, { attributes: true, attributeFilter: ["aria-current"], subtree: true });
  window.addEventListener("resize", place);
  window.addEventListener("hashchange", later);
  document.addEventListener("mc-lang", later);                                    // link text widths change with the language
  if (document.fonts?.ready) document.fonts.ready.then(place);
  if ("ResizeObserver" in window) { const ro = new ResizeObserver(place); ro.observe(nav); nav.querySelectorAll("a").forEach((a) => ro.observe(a)); }   // text arrives or changes size: measure again
  place(); later();
}

// ---- the small-screen menu ----
function setOpen(open) {
  if (!header || !burger) return;
  header.classList.toggle("nav-open", open);
  document.body.classList.toggle("nav-lock", open && small());
  burger.setAttribute("aria-expanded", String(open));
}
if (burger) {
  burger.addEventListener("click", () => setOpen(!header.classList.contains("nav-open")));
  panel?.addEventListener("click", (e) => { if (e.target.closest(".site-nav a, .ends-link")) setOpen(false); });
  document.addEventListener("click", (e) => { if (header.classList.contains("nav-open") && !header.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && header.classList.contains("nav-open")) { setOpen(false); burger.focus(); } });
  window.addEventListener("hashchange", () => setOpen(false));
  window.matchMedia("(max-width: 1199px)").addEventListener("change", () => { setOpen(false); place(); });
}

// ---- the shadow once the page is scrolled ----
const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();
