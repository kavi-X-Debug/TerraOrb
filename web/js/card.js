// One-page summary card for the selected tank, to print or share at the kanna meeting.
// Shows: tank name, date, signal, recommended scenario, top 3 reasons with sources,
// the El Niño line and the disclaimer. Built only from the tank's JSON file.
//
// "Print / PDF" uses the browser's print dialog (css/style.css has a print stylesheet that
// prints only the card, readable in black and white).
// "Share" turns the card into a PNG with html2canvas, then uses the phone's share sheet
// (Web Share API), or downloads the PNG if sharing files isn't supported.
import { t } from "./i18n.js";
import { reasonText } from "./plan.js";
import { signalIcon, signalKey, demoBadge, date, escapeHtml, tankName } from "./ui.js";

const HTML2CANVAS = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

// Today's date on this phone ("2026-10-25"), not UTC, so it's right just after midnight.
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function renderCard(tank, panel) {
  const doc = tank.doc;
  const result = doc.result;
  const key = signalKey(result?.signal);
  const recommended = result?.scenarios.find((s) => s.recommended);
  const reasons = (result?.reasons || []).filter((r) => r.kind !== "outlook").slice(0, 3);
  const elnino = result?.reasons.find((r) => r.kind === "outlook");
  const otherName = tankName(tank) === tank.name_si ? tank.name_en : tank.name_si;
  const share = recommended?.share_of_command_area;

  panel.innerHTML = `
    <div class="card-actions">
      <button type="button" class="action" data-card="print">${printIcon()}${escapeHtml(t("card.print"))}</button>
      <button type="button" class="action" data-card="share">${shareIcon()}${escapeHtml(t("card.share"))}</button>
    </div>
    <p class="note" id="card-status" role="status"></p>

    <article class="summary-card" id="summary-card" aria-labelledby="card-tank">
      <header class="card-top">
        <p class="card-brand">${escapeHtml(t("card.title"))}</p>
        <h2 id="card-tank">${escapeHtml(tankName(tank))}</h2>
        ${otherName ? `<p class="card-sub">${escapeHtml(otherName)}</p>` : ""}
        <p class="card-sub">${escapeHtml(t("card.date", { date: date(localToday()) }))}</p>
        <p class="card-sub">${escapeHtml(t("card.data_updated", { date: date(doc.generated) }))}</p>
        ${demoBadge(doc.demo)}
      </header>

      <section class="card-signal ${key}">
        <p class="card-label">${escapeHtml(t("signal.title"))}</p>
        <div class="card-signal-row">
          ${signalIcon(result?.signal)}
          <div>
            <p class="card-signal-word">${escapeHtml(t(`signal.short.${key}`))}</p>
            <p>${escapeHtml(t(`signal.${key}.text`))}</p>
          </div>
        </div>
      </section>

      ${recommended ? `
      <section class="card-section">
        <p class="card-label">${escapeHtml(t("card.recommended"))}</p>
        <h3>${escapeHtml(t(recommended.title_key))}</h3>
        <p>${escapeHtml(t("plan.crops"))}: ${escapeHtml(recommended.crops.map((c) => t(`crop.${c}`)).join(", "))}</p>
        ${share == null ? "" : `<p><strong>${escapeHtml(t("plan.share", { value: Math.round(share * 100) }))}</strong></p>`}
      </section>` : ""}

      ${reasons.length ? `
      <section class="card-section">
        <p class="card-label">${escapeHtml(t("card.reasons"))}</p>
        <ol class="card-reasons">
          ${reasons.map((r) => `
            <li>${escapeHtml(reasonText(r))}
              ${r.source ? `<span class="card-source">${escapeHtml(t("label.source"))} ${escapeHtml(r.source)}</span>` : ""}
            </li>`).join("")}
        </ol>
      </section>` : ""}

      ${elnino ? `
      <section class="card-section">
        <p class="card-label">${escapeHtml(t("elnino.title"))}</p>
        <p>${escapeHtml(reasonText(elnino))}</p>
      </section>` : ""}

      <footer class="card-disclaimer">
        <p><strong>${escapeHtml(t("disclaimer.short"))}</strong></p>
        <p>${escapeHtml(t("app.name"))}</p>
      </footer>
    </article>`;

  panel.querySelector('[data-card="print"]').addEventListener("click", () => window.print());
  panel.querySelector('[data-card="share"]').addEventListener("click", () => shareCard(tank, panel));
}

// ---------------------------------------------------------------------------
// Share as PNG
// ---------------------------------------------------------------------------
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HTML2CANVAS;
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("html2canvas did not load"));
    document.head.appendChild(script);
  });
}

async function shareCard(tank, panel) {
  const status = panel.querySelector("#card-status");
  status.textContent = t("card.making");
  let blob;
  try {
    const html2canvas = await loadHtml2canvas();
    await document.fonts.ready;                         // so Sinhala letters are in the picture
    // Draw the card at a fixed 540 px width, so the picture looks the same from any phone.
    const canvas = await html2canvas(panel.querySelector("#summary-card"), {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 600,
      onclone: (copy) => {
        const card = copy.getElementById("summary-card");
        card.style.width = "540px";
        card.style.maxWidth = "540px";
      },
    });
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("empty image");
  } catch (err) {
    status.textContent = t("card.share_error", { error: err.message });
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File([blob], `monsoon-compass-${tank.id}-${stamp}.png`, { type: "image/png" });

  // Phone share sheet (WhatsApp etc.) when the browser can share files.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t("card.title"),
                              text: t("card.share_text", { name: tankName(tank) }) });
      status.textContent = t("card.shared");
      return;
    } catch (err) {
      if (err.name === "AbortError") { status.textContent = ""; return; }   // user closed the sheet
      // any other error: fall through to download
    }
  }

  // Fallback: download the PNG.
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = t("card.downloaded");
}

function printIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
    <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/></svg>`;
}

function shareIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>`;
}
