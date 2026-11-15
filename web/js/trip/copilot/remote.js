// Copilot optional provider: the backend's language model (backend/app/copilot). It is OFF unless the server reports it is enabled
// (GET /api/copilot/status). It never answers by itself: the rule-based provider has already retrieved the facts from real data, and the
// model only REWORDS them. Only the question and those facts are sent (no name, no trips, no location of the visitor).
//
// The address of the service is the same as the farm planner's: window.MC_API, localStorage "mc-api", else http://localhost:8000.
const API_KEY = "mc-api";
const DEFAULT_BASE = "http://localhost:8000";
const STATUS_MINUTES = 5;

const ls = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
export const apiBase = () => String((typeof window !== "undefined" && window.MC_API) || ls(API_KEY) || DEFAULT_BASE).replace(/\/+$/, "");

let cached = null;           // { at, value }
export function resetStatus() { cached = null; }

async function call(path, { method = "GET", body, timeout, fetchImpl }) {
  const f = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await f(`${apiBase()}/api/copilot${path}`, { method, signal: controller.signal, headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${r.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

// { enabled, provider }. Any failure (no server, blocked, slow) means "not enabled", and is remembered for a while so the page does not keep trying.
export async function status({ force = false, fetchImpl, now = Date.now() } = {}) {
  if (!force && cached && now - cached.at < STATUS_MINUTES * 60000) return cached.value;
  let value = { enabled: false, provider: null };
  try {
    const d = await call("/status", { timeout: 3000, fetchImpl });
    if (d && d.enabled === true) value = { enabled: true, provider: String(d.provider || "") };
  } catch { /* server not reachable: rules only */ }
  cached = { at: now, value };
  return value;
}

// Numbers in a text, normalised ("12.50" and "12.5" are the same number)
const nums = (s) => new Set((String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => { const x = n.replace(",", "."); return x.includes(".") ? x.replace(/0+$/, "").replace(/\.$/, "") : x; }));
export function numbersGrounded(text, message, facts) {
  const allowed = new Set([...nums(message), ...nums(facts.join(" "))]);
  return [...nums(text)].every((n) => allowed.has(n));
}

// Reword `facts` (plain sentences already made by the rules provider). Returns the text, or throws (the caller then keeps the rules answer).
export async function rephrase({ message, lang, facts, fetchImpl }) {
  const body = { message: String(message).slice(0, 500), lang: lang === "si" ? "si" : "en", facts: facts.map((f) => String(f).slice(0, 600)).slice(0, 40) };
  const d = await call("/rephrase", { method: "POST", body, timeout: 20000, fetchImpl });
  const text = typeof d?.text === "string" ? d.text.trim() : "";
  if (!text) throw new Error("empty answer");
  if (!numbersGrounded(text, body.message, body.facts)) throw new Error("answer has a number that is not in the facts");      // second check, besides the server's
  return text;
}
