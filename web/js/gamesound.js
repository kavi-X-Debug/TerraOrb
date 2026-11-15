// Music and sound for the small games: one shared "music on / off" choice (the same remembered choice as Rain Cloud and Tank Farmer),
// the big Music button, and the live-made tune from cloudaudio.js. Sound can only start after a tap, so start() is called from a button.
import { t } from "./i18n.js";
import { escapeHtml } from "./ui.js";
import { createAudio } from "./cloudaudio.js";

let muted = false;
try { muted = localStorage.getItem("mc-cloud-muted") === "1"; } catch { /* private window: start with music on */ }

const SOUND_ON = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
const SOUND_OFF = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>';
const icon = (on) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${on ? SOUND_ON : SOUND_OFF}</svg>`;
const inner = () => `${icon(!muted)}<span>${escapeHtml(t("cg.music"))}</span><b>${escapeHtml(t(muted ? "cg.off" : "cg.on"))}</b>`;

export function gameSound(style = "farm") {
  let audio = null;
  return {
    get audio() { return audio; },
    start() { audio?.stop(); audio = createAudio(muted, style); return audio; },
    stop() { audio?.stop(); audio = null; },
    button() {
      return `<button type="button" class="cg-sound" data-sound aria-pressed="${muted ? "false" : "true"}" aria-label="${escapeHtml(t(muted ? "cg.sound.off" : "cg.sound.on"))}">${inner()}</button>`;
    },
    wire(view) {
      view.querySelectorAll("[data-sound]").forEach((btn) => {
        btn.onclick = () => {
          muted = !muted;
          try { localStorage.setItem("mc-cloud-muted", muted ? "1" : "0"); } catch { /* not saved: fine */ }
          audio?.setMuted(muted);
          view.querySelectorAll("[data-sound]").forEach((b) => {
            b.innerHTML = inner();
            b.setAttribute("aria-pressed", String(!muted));
            b.setAttribute("aria-label", t(muted ? "cg.sound.off" : "cg.sound.on"));
          });
        };
      });
    },
  };
}
