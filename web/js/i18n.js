// UI text. Every visible word comes from si.json or en.json, never from the code.
// If a Sinhala value is still empty (""), the English text is shown instead,
// so the screen is never blank while the Sinhala wording is being written.

const strings = { si: {}, en: {} };
let lang = "si";

export async function loadStrings() {
  const [si, en] = await Promise.all(["si", "en"].map(async (code) => {
    const response = await fetch(`${code}.json`);
    if (!response.ok) throw new Error(`${code}.json: HTTP ${response.status}`);
    return response.json();
  }));
  strings.si = si;
  strings.en = en;
  // Extra string files listed in strings/manifest.json (e.g. the farm planner's) are merged in; missing files are skipped.
  try {
    const list = await (await fetch("strings/manifest.json")).json();
    for (const name of list) {
      for (const code of ["si", "en"]) {
        try {
          const r = await fetch(`strings/${name}.${code}.json`);
          if (r.ok) Object.assign(strings[code], await r.json());
        } catch { /* one missing file must not stop the site */ }
      }
    }
  } catch { /* no manifest: nothing extra to load */ }
  try {
    const saved = localStorage.getItem("mc-lang");     // remembered choice, if any
    if (saved === "si" || saved === "en") lang = saved;
  } catch { /* storage blocked: keep the default */ }
}

export function getLang() { return lang; }

// A key's text in BOTH languages (the assistant understands questions typed in either).
export function tBoth(key) { return [strings.si[key], strings.en[key]].filter(Boolean); }

export function setLang(code) {
  lang = code;
  document.documentElement.lang = code;
  try { localStorage.setItem("mc-lang", code); } catch { /* ignore */ }
}

// t("water.percent_of_normal", { value: 72 })  →  "72% of normal"
export function t(key, vars = {}) {
  let text = strings[lang][key] || strings.en[key];
  if (!text) return key;                 // a missing key shows up as itself, easy to spot
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

// Fill every element marked data-i18n="key" (text) or data-i18n-attr="attr:key".
export function translatePage(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const [attr, key] = el.dataset.i18nAttr.split(":");
    el.setAttribute(attr, t(key));
  });
}
