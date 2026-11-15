// Talks to the farm service (backend/, FastAPI). Everything the farm screens send or read goes through here.
//
// The address of the service is, in this order: window.MC_API, localStorage "mc-api", http://localhost:8000.
// The login token is kept on this phone only (localStorage "mc-farm-token").
// A failed call throws an ApiError: err.network is true when the service could not be reached at all,
// err.status is the HTTP status otherwise, and err.message is the service's own explanation.

const TOKEN_KEY = "mc-farm-token";
const API_KEY = "mc-api";
const DEFAULT_BASE = "http://localhost:8000";

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage blocked */ } }

export class ApiError extends Error {
  constructor(message, status = 0, network = false) {
    super(message);
    this.status = status;
    this.network = network;
  }
}

export const apiBase = () => String(window.MC_API || lsGet(API_KEY) || DEFAULT_BASE).replace(/\/+$/, "");
export const setApiBase = (url) => lsSet(API_KEY, url ? String(url).trim() : null);
export const getToken = () => lsGet(TOKEN_KEY);
export const setToken = (token) => lsSet(TOKEN_KEY, token || null);

// FastAPI sends {"detail": "text"} or, for a bad form, {"detail": [{loc, msg}, ...]}.
function detailText(body, fallback) {
  const d = body && body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x && x.msg) || "").filter(Boolean).join("; ") || fallback;
  return fallback;
}

// request("/farms", { method: "POST", body: {...}, auth: false })  ->  the JSON answer
export async function request(path, { method = "GET", body, auth = true, timeout = 20000 } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(`${apiBase()}/api${path}`, { method, headers, signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    throw new ApiError(err.message || "network", 0, true);          // not reachable, blocked, or too slow
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await response.json(); } catch { /* an empty or non-JSON answer */ }
  if (!response.ok) {
    if (response.status === 401 && auth) setToken(null);          // the login ran out: the screens will ask again
    throw new ApiError(detailText(data, `HTTP ${response.status}`), response.status, false);
  }
  return data;
}

// The object the screens receive as ctx.api
export const api = {
  get: (path, opts) => request(path, { ...opts }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body: body ?? {} }),
  put: (path, body, opts) => request(path, { ...opts, method: "PUT", body: body ?? {} }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body: body ?? {} }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
  health: () => request("/health", { auth: false, timeout: 6000 }),
  base: apiBase,
  setBase: setApiBase,
  token: getToken,
  setToken,
  isLoggedIn: () => Boolean(getToken()),
  logout: () => setToken(null),
};

// ---- Things kept on this phone until they can be sent (registration draft, answers waiting) ----
export function saveLocal(key, value) { lsSet(`mc-farm-${key}`, JSON.stringify(value)); }
export function loadLocal(key) { try { return JSON.parse(lsGet(`mc-farm-${key}`)); } catch { return null; } }
export function clearLocal(key) { lsSet(`mc-farm-${key}`, null); }

// ---- A tiny element builder so screens never need innerHTML (text is always set as text) ----
//   h("button", { class: "fm-btn", onclick: fn, text: "..." }, child, [more children])
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
