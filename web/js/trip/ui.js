// Small shared helpers for the trip planner screens: elements, toasts, dialogs, loading/error states, source badges, charts.
// Every screen uses these so the look, the wording of states and the accessibility behaviour stay the same everywhere.
import { t, getLang } from "../i18n.js";

// h("div", { class: "x", onclick: fn, text: "..." }, child, "text", ...) -> element. `text` is set as textContent (never HTML).
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// A message that fades away: toast("trip.saved", "ok") or a ready text. kind: ok | warn | error | info
export function toast(keyOrText, kind = "info", vars) {
  let box = document.getElementById("tp-toasts");
  if (!box) { box = h("div", { id: "tp-toasts", class: "tp-toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const text = t(keyOrText, vars);
  const el = h("div", { class: `tp-toast ${kind}`, text });
  box.append(el);
  setTimeout(() => el.remove(), 4500);
}

// A dialog: modal({ title, body (element or text), actions:[{label, primary, onclick}] }) -> { close }
export function modal({ title, body, actions = [] }) {
  const previous = document.activeElement;
  const dialog = h("div", { class: "tp-modal", role: "dialog", "aria-modal": "true", "aria-label": title || "" },
    h("div", { class: "tp-modal-card" },
      title ? h("h2", { text: title }) : null,
      h("div", { class: "tp-modal-body" }, typeof body === "string" ? h("p", { text: body }) : body),
      h("div", { class: "tp-modal-actions" }, actions.map((a) => h("button", { type: "button", class: a.primary ? "tp-btn primary" : "tp-btn", text: a.label, onclick: () => { if (a.onclick) a.onclick(); if (!a.keepOpen) close(); } })))));
  const close = () => { dialog.remove(); document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.querySelector("button")?.focus();
  return { close };
}

// Loading and error states for a view or any container
export function loading(container, key = "trip.state.loading") {
  container.replaceChildren(h("p", { class: "tp-state", role: "status", text: t(key) }));
}
export function errorBox(container, key = "trip.state.error", retry) {
  container.replaceChildren(h("div", { class: "tp-state error", role: "alert" }, h("p", { text: t(key) }), retry ? h("button", { type: "button", class: "tp-btn", text: t("trip.state.retry"), onclick: retry }) : null));
}

// What kind of data a number is: forecast | tendency | seasonal | ml | nasa | notnasa
export function badge(kind) {
  return h("span", { class: `tp-badge ${kind}`, text: t(`trip.badge.${kind}`) });
}

// "Updated 15 Nov, 14:05" for a timestamp; cached data is marked as such by the caller
export function stamp(iso, key = "trip.updated") {
  if (!iso) return t("trip.updated_unknown");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("trip.updated_unknown");
  const text = d.toLocaleString(getLang() === "si" ? "si-LK" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return t(key, { time: text });
}

export const destName = (d) => (getLang() === "si" && d.name_si ? d.name_si : d.name_en);
export const fmtDate = (iso, opts = { day: "numeric", month: "short" }) => new Date(`${iso}T12:00:00`).toLocaleDateString(getLang() === "si" ? "si-LK" : "en-GB", opts);
export const fmtMm = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${(Math.round(x * 10 ** d) / 10 ** d).toFixed(d)} mm`);
export const fmtTemp = (x) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${Math.round(x)}°C`);
export const fmtPct = (x) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${Math.round(x)}%`);

// Draw a Chart.js chart on a canvas, destroying the previous chart on it. Returns the chart or null (Chart.js not loaded).
export function chart(canvas, config) {
  if (!window.Chart) return null;
  window.Chart.getChart(canvas)?.destroy();
  return new window.Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, ...(config.options || {}) } });
}

// Add a stylesheet once (id = tp-css-<name>)
export function ensureCss(name) {
  if (document.getElementById(`tp-css-${name}`)) return;
  const link = h("link", { id: `tp-css-${name}`, rel: "stylesheet", href: `css/${name}.css` });
  document.head.append(link);
}
