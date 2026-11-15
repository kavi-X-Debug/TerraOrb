// The chooser page (index.html): language buttons and the text. It does not load any tank data.
import { loadStrings, translatePage, setLang, getLang, t } from "./i18n.js";

function apply(code) {
  setLang(code);
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === code)));
  translatePage();
  document.title = t("app.name");
}

async function start() {
  try { await loadStrings(); } catch (err) { document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="error">Could not load the text files (${err.message}).</p>`); return; }
  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => apply(b.dataset.lang)));
  apply(getLang());
}

// Offline support (see sw.js); only on https:// or localhost.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
start();
