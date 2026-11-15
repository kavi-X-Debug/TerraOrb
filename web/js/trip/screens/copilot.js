// #/plan/copilot: the AI travel copilot chat screen.
//
// The visitor types a question (English or Sinhala). copilot/index.js ask() turns it into an intent, calls tools that use only real data
// (live forecast, NASA POWER history, the saved trips) and returns an answer made of text keys + params. This file only draws it.
// Every answer shows: what kind of data it uses (forecast / historical tendency), the source and when it was fetched, how sure it is,
// the planning disclaimer for weather, and links to the right screen. The chat history is kept in memory and in localStorage
// ("mc-trip-chat") on this device only; saved answers are marked as possibly out of date when shown again.
import { getLang, tBoth } from "../../i18n.js";
import { ask, resolve, remote } from "../copilot/index.js";
import { dedupeSources, exampleQuestion, sourceLine } from "../copilot/rules.js";
import { getConfig } from "../config.js";

const CHAT_KEY = "mc-trip-chat";
const OPT_KEY = "mc-trip-copilot-remote";           // "off" when the visitor turned the AI wording off
const MAX_MESSAGES = 30;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked: memory only */ } };

function loadHistory() {
  try {
    const v = JSON.parse(lsGet(CHAT_KEY));
    if (v && v.v === 1 && Array.isArray(v.messages)) return v.messages.filter((m) => m && (m.role === "user" || m.role === "bot")).slice(-MAX_MESSAGES).map((m) => (m.role === "bot" ? { ...m, restored: true } : m));
  } catch { /* nothing saved, or damaged: start empty */ }
  return [];
}
function saveHistory(messages) {
  const keep = messages.filter((m) => !m.pending && !m.error).slice(-MAX_MESSAGES).map(({ restored, ...m }) => m);
  lsSet(CHAT_KEY, JSON.stringify({ v: 1, messages: keep }));
}

export async function renderCopilot(ctx, parts, view) {
  const { ui, t } = ctx;
  const h = ui.h;
  ui.ensureCss("trip-d");
  if (!ctx.data.destinations.length) { ui.errorBox(view, "trip.state.no_data"); return; }

  const messages = loadHistory();
  let busy = false;
  let remoteState = { enabled: false };

  const getList = (key) => tBoth(key).flatMap((s) => String(s).split("|")).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const stamp = (iso) => new Date(iso).toLocaleString(getLang() === "si" ? "si-LK" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const env = () => ({ data: ctx.data, cfg: getConfig(), t, lang: getLang(), getList,
    fmt: { date: (d) => ui.fmtDate(d), mm: ui.fmtMm, pct: ui.fmtPct, hour: (x) => `${String(x).padStart(2, "0")}:00`, time: stamp, name: ui.destName } });
  const tx = (item) => t(item.key, resolve(item.params || {}, t));

  // ---- layout ----------------------------------------------------------------------------------------------------------------------
  const log = h("div", { class: "tpd-log", role: "log", "aria-live": "polite", "aria-label": t("tripd.title") });
  const chips = h("div", { class: "tpd-chips", "aria-label": t("tripd.suggestions") });
  const input = h("input", { id: "tpd-input", class: "tpd-input", type: "text", maxlength: "500", autocomplete: "off", placeholder: t("tripd.input_placeholder") });
  const send = h("button", { type: "submit", class: "tp-btn primary", text: t("tripd.send") });
  const engine = h("p", { class: "tpd-engine", text: t("tripd.engine_rules") });
  const toggleBox = h("label", { class: "tpd-toggle", hidden: true }, h("input", { type: "checkbox", id: "tpd-remote" }), h("span", { text: t("tripd.remote_toggle") }));
  const form = h("form", { class: "tpd-form", onsubmit: (ev) => { ev.preventDefault(); submit(input.value); } },
    h("label", { class: "tpd-label", for: "tpd-input", text: t("tripd.input_label") }), h("div", { class: "tpd-row" }, input, send));
  const clear = h("button", { type: "button", class: "tp-btn tpd-clear", text: t("tripd.clear"), onclick: () => { messages.length = 0; saveHistory(messages); redraw(); input.focus(); } });
  view.replaceChildren(h("section", { class: "tp-card tpd-card" },
    h("h1", { class: "tpd-title", text: t("tripd.title") }), h("p", { class: "tpd-intro", text: t("tripd.intro") }), engine, toggleBox,
    log, h("h2", { class: "tpd-sub", text: t("tripd.suggestions") }), chips, form, clear));

  const toggle = toggleBox.querySelector("input");
  toggle.checked = lsGet(OPT_KEY) !== "off";
  toggle.addEventListener("change", () => lsSet(OPT_KEY, toggle.checked ? null : "off"));
  remote.status().then((st) => {                                     // is the server's language model switched on?
    remoteState = st;
    if (st.enabled && view.isConnected) { toggleBox.hidden = false; engine.textContent = t("tripd.engine_remote"); }
  });

  // ---- drawing an answer -----------------------------------------------------------------------------------------------------------
  function drawAnswer(m) {
    const a = m.answer;
    const box = h("div", { class: `tpd-msg bot${a.ok === false ? " problem" : ""}` });
    box.append(h("div", { class: "tpd-who" }, h("strong", { text: t("tripd.bot") }), " ", h("span", { class: `tpd-engine-badge ${m.provider === "remote" ? "remote" : "rules"}`, text: t(m.provider === "remote" ? "tripd.remote_badge" : "tripd.rules_badge") })));
    if (m.restored) box.append(h("p", { class: "tpd-restored", text: `${t("tripd.restored")}${m.at ? ` ${t("tripd.old_stamp", { time: stamp(m.at) })}` : ""}` }));
    if (a.headline) box.append(h("h3", { class: "tpd-head", text: tx(a.headline) }));
    if (m.remoteText) box.append(h("p", { class: "tpd-reworded", text: m.remoteText }), h("p", { class: "tpd-small", text: t("tripd.remote_note") }));
    else if (m.remoteError) box.append(h("p", { class: "tpd-small", text: t("tripd.remote_failed") }));
    for (const b of a.blocks) {
      if (b.type === "p") box.append(h("p", { class: `tpd-p${b.tone ? ` ${b.tone}` : ""}`, text: tx(b) }));
      else {
        const ul = h("ul", { class: "tpd-rows" });
        for (const it of b.items) {
          ul.append(h("li", {}, h("span", { text: tx(it) }), it.badge ? [" ", ui.badge(it.badge === "tendency" ? "tendency" : "forecast")] : null,
            it.sub ? h("span", { class: "tpd-sub-line", text: tx(it.sub) }) : null,
            it.href ? [" ", h("a", { class: "tpd-open", href: it.href, text: t("tripd.open") })] : null));
        }
        box.append(ul);
      }
    }
    const srcs = dedupeSources(a.sources);
    if (srcs.length || a.uncertain) {
      const det = h("details", { class: "tpd-details" }, h("summary", { text: t("tripd.sources") }));
      for (const s of srcs) det.append(h("p", { class: "tpd-small" }, ui.badge(s.kind === "forecast" ? "forecast" : "tendency"), " ", sourceLine(s, t, stamp)));
      if (a.uncertain) det.append(h("p", { class: "tpd-small" }, h("strong", { text: `${t("tripd.uncertainty")} ` }), tx(a.uncertain)));
      det.open = true;
      box.append(det);
    }
    if (a.disclaimer) box.append(h("p", { class: "tpd-disclaimer", text: t("trip.disclaimer") }));
    if (a.links?.length) box.append(h("p", { class: "tpd-links" }, a.links.map((l) => h("a", { class: "tp-btn", href: l.href, text: t(l.key) }))));
    if (a.interp) box.append(h("p", { class: "tpd-interp", text: tx(a.interp) }));
    if (a.followups?.length) {
      box.append(h("p", { class: "tpd-small", text: t("tripd.followups") }), h("div", { class: "tpd-chips" }, a.followups.map((f) => chip(tx(f)))));
    }
    return box;
  }
  const chip = (text) => h("button", { type: "button", class: "tpd-chip", text, onclick: () => submit(text) });

  function redraw() {
    log.replaceChildren();
    if (!messages.length) log.append(h("p", { class: "tpd-empty", text: t("tripd.history_empty") }));
    for (const m of messages) {
      if (m.role === "user") log.append(h("div", { class: "tpd-msg user" }, h("div", { class: "tpd-who" }, h("strong", { text: t("tripd.you") })), h("p", { class: "tpd-p", text: m.text })));
      else if (m.pending) log.append(h("div", { class: "tpd-msg bot", "aria-busy": "true" }, h("p", { class: "tpd-p", role: "status", text: t("tripd.thinking") })));
      else if (m.error) log.append(h("div", { class: "tpd-msg bot problem", role: "alert" }, h("p", { class: "tpd-p warn", text: t("tripd.error") })));
      else log.append(drawAnswer(m));
    }
    log.scrollTop = log.scrollHeight;
    chips.replaceChildren(...["will_it_rain", "compare_destinations", "where_to_travel", "plan_trip", "best_dates", "activities_tomorrow", "packing"]
      .map((id) => { const q = exampleQuestion(id, ctx.data, { name: ui.destName }); return chip(t(q.key, q.params)); }));
    send.disabled = busy; input.disabled = busy;
    clear.hidden = !messages.length;
  }

  // what the previous answer left behind (the last place, a pending "which place?")
  function memory() {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "bot" && m.answer?.meta) return { lastDests: m.answer.meta.lastDests || [], pending: m.answer.meta.pending || null };
    }
    return {};
  }

  async function submit(raw) {
    const text = String(raw || "").trim();
    if (!text || busy) return;
    busy = true;
    const mem = memory();
    messages.push({ role: "user", text: text.slice(0, 500), at: new Date().toISOString() });
    const pending = { role: "bot", pending: true };
    messages.push(pending);
    input.value = "";
    redraw();
    try {
      const r = await ask(text, { env: env(), memory: mem, useRemote: remoteState.enabled && toggle.checked });
      messages.splice(messages.indexOf(pending), 1, { role: "bot", answer: r.answer, provider: r.provider, remoteText: r.remoteText, remoteError: r.remoteTried && !r.remoteText ? r.remoteError : null, at: new Date().toISOString() });
    } catch (err) {
      console.error(err);
      messages.splice(messages.indexOf(pending), 1, { role: "bot", error: true });
    }
    busy = false;
    saveHistory(messages);
    redraw();
    input.focus({ preventScroll: true });
  }

  redraw();
}
