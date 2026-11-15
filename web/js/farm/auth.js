// Login screen: phone number, then the one-time code. (No SMS service yet: when the service runs in development mode
// it sends the code back and we show it, clearly marked "development only". Otherwise the code is never shown.)
import { h } from "./api.js";
import { getLang } from "../i18n.js";

export function renderLogin(ctx, onDone) {
  const { api, view, t } = ctx;
  view.innerHTML = "";

  const status = h("p", { class: "fm-status", role: "status", "aria-live": "polite" });
  const say = (key, isError = false, vars) => {
    status.textContent = key ? t(key, vars) : "";
    status.classList.toggle("fm-error", isError);
  };
  const explain = (err, fallbackKey) => {
    if (err.network) say("farm.err.offline", true);
    else if (err.status === 429) say("farm.auth.too_many", true);
    else status.textContent = `${t(fallbackKey)} (${err.message})`, status.classList.add("fm-error");
  };

  let phone = "";
  const card = h("section", { class: "fm-card fm-narrow" });
  view.append(h("div", { class: "fm-page" }, h("h1", { text: t("farm.auth.title") }), h("p", { class: "fm-lead", text: t("farm.auth.lead") }), card));

  // Step 1: the phone number
  function stepPhone() {
    card.innerHTML = "";
    const input = h("input", { class: "fm-input fm-big", type: "tel", inputmode: "tel", autocomplete: "tel", id: "fm-phone", value: phone, placeholder: t("farm.auth.phone_hint") });
    const go = h("button", { class: "fm-btn fm-primary", type: "submit", text: t("farm.auth.send_code") });
    const form = h("form", { class: "fm-form" },
      h("label", { for: "fm-phone", class: "fm-label", text: t("farm.auth.phone") }), input, go, status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      phone = input.value.trim();
      if (phone.replace(/\D/g, "").length < 9) { say("farm.auth.phone_bad", true); return; }
      go.disabled = true; say("farm.state.sending");
      try {
        const r = await api.post("/auth/request", { phone }, { auth: false });
        stepCode(r && r.dev_code);
      } catch (err) { explain(err, "farm.auth.send_failed"); go.disabled = false; }
    });
    card.append(form, h("p", { class: "fm-fine", text: t("farm.auth.privacy") }));
    input.focus();
  }

  // Step 2: the code
  function stepCode(devCode) {
    card.innerHTML = "";
    say("");
    const input = h("input", { class: "fm-input fm-big fm-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "8", id: "fm-code" });
    const go = h("button", { class: "fm-btn fm-primary", type: "submit", text: t("farm.auth.sign_in") });
    const back = h("button", { class: "fm-btn fm-quiet", type: "button", text: t("farm.auth.change_phone"), onclick: stepPhone });
    const form = h("form", { class: "fm-form" },
      h("p", { text: t("farm.auth.code_sent", { phone }) }),
      devCode ? h("p", { class: "fm-dev", role: "note" },
        h("strong", { text: t("farm.auth.dev_only") }), " ", t("farm.auth.dev_code", { code: devCode })) : null,
      h("label", { for: "fm-code", class: "fm-label", text: t("farm.auth.code") }), input, go, back, status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = input.value.replace(/\s/g, "");
      if (!code) { say("farm.auth.code_bad", true); return; }
      go.disabled = true; say("farm.state.checking");
      try {
        const r = await api.post("/auth/verify", { phone, code, language: getLang() }, { auth: false });
        api.setToken(r.token);
        onDone(r.farmer);
      } catch (err) {
        if (err.status === 400 || err.status === 401 || err.status === 403) say("farm.auth.code_wrong", true);
        else explain(err, "farm.auth.verify_failed");
        go.disabled = false;
      }
    });
    card.append(form);
    input.focus();
  }

  stepPhone();
}
