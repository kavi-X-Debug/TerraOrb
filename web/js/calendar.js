// Sowing calendar page (#/calendar or #/calendar/<tank id>).
//
// Choose a tank, then a crop. For the chosen crop the page shows:
//   1. its status for sowing NOW (good / possible / not now) and the next good week
//   2. the best window to sow, the harvest date, the growing time, how often the rain was enough in past years
//   3. a 12-week bar (colour + shape + word, never colour alone); tap a week for details
// Below that, all crops at a glance in one timeline.
// Everything comes from the tank's "crops" section (written by pipeline/crops.py); nothing is worked out here
// except simple date arithmetic and picking the first run of good weeks.
import { t } from "./i18n.js";
import { signalIcon, escapeHtml, date, tankName, num, cropPhoto } from "./ui.js";
import { cropIcon } from "./cropicons.js";

const ICON_FOR = { good: "green", possible: "amber", not_now: "red", unknown: null };
const DAY_MS = 86400000;
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const shortDate = (iso) => date(iso, { day: "numeric", month: "short" });
const cropName = (id) => t(`crop.${id}`);

// First run of good weeks for one crop: { from, to, firstIndex, lastIndex } (ISO dates) or null.
export function bestWindow(weeks, id) {
  const ratings = weeks.map((w) => w.items.find((i) => i.id === id).rating);
  const first = ratings.indexOf("good");
  if (first < 0) return null;
  let last = first;
  while (last + 1 < ratings.length && ratings[last + 1] === "good") last++;
  return { from: weeks[first].start, to: addDays(weeks[last].start, 6), firstIndex: first, lastIndex: last };
}

// ---------------------------------------------------------------------------
// Round crop badges, drawn here as simple shapes (no pictures needed)
// ---------------------------------------------------------------------------
const POD = (fill) => `<g fill="${fill}" stroke="none">`;
const BADGE = {
  mung_bean: `<path d="M32 52V26"/><path d="M32 40c-8-2-12-8-12-14M32 34c7-1 11-6 12-12"/>${POD("#6AA547")}<ellipse cx="20" cy="22" rx="3" ry="8" transform="rotate(-18 20 22)"/><ellipse cx="44" cy="18" rx="3" ry="8" transform="rotate(18 44 18)"/><ellipse cx="32" cy="20" rx="3" ry="8"/></g>`,
  cowpea: `<path d="M32 54V20"/><path d="M32 30c-6 0-10-4-12-10M32 24c6 0 10-3 12-9"/>${POD("#4F9A4A")}<rect x="17" y="18" width="4" height="26" rx="2" transform="rotate(-8 19 31)"/><rect x="43" y="14" width="4" height="30" rx="2" transform="rotate(8 45 29)"/></g>`,
  black_gram: `<path d="M32 54V28"/><path d="M32 42c-7-1-11-6-12-12M32 36c7-1 11-5 12-11"/>${POD("#3E5F36")}<path d="M16 22c2-5 7-6 10-3-2 6-7 8-10 3z"/><path d="M38 18c3-4 8-3 10 1-3 5-8 6-10 2z"/><path d="M27 28c2-4 7-4 9-1-2 5-6 6-9 2z"/></g>`,
  maize: `<g stroke="none"><path d="M32 12c8 4 10 16 8 30-2 8-6 10-8 10s-6-2-8-10c-2-14 0-26 8-30z" fill="#F2C94C"/></g><path d="M32 14c-9 14-13 24-12 36M32 14c9 14 13 24 12 36" stroke="#4F9A4A" stroke-width="4"/><path d="M29 22h6M28 29h8M28 36h8" stroke="#D9A21B" stroke-width="2"/>`,
  groundnut: `<g stroke="none"><path d="M22 14c6-4 12 0 11 8-1 6 1 8 6 10 6 3 5 14-3 16-7 1-10-4-9-10 1-6-2-8-6-10-5-3-4-11 1-14z" fill="#C9A06A" transform="rotate(-20 32 32)"/></g><path d="M24 24l5 4M31 36l5 4" stroke="#8C6A43" stroke-width="2"/>`,
  sweet_potato: `<g stroke="none"><path d="M12 38c2-12 14-18 28-16 10 2 14 8 10 14-5 8-22 12-34 6-3-1-4-3-4-4z" fill="#B0577A"/></g><path d="M44 22c4-4 8-4 10-8" stroke="#4F9A4A" stroke-width="3"/><path d="M22 34l6 2M32 38l6 1" stroke="#8E3E5F" stroke-width="2"/>`,
  big_onion: `<g stroke="none"><path d="M32 18c10 0 18 8 18 18 0 8-6 14-18 14s-18-6-18-14c0-10 8-18 18-18z" fill="#E7B8C8"/></g><path d="M32 18c-4-6-2-10 0-12M32 18c4-6 2-10 0-12M24 24c-4 8-4 16 0 24M40 24c4 8 4 16 0 24" stroke="#B0577A" stroke-width="2"/><path d="M32 50v6" stroke="#8C6A43" stroke-width="2"/>`,
  brinjal: `<g stroke="none"><path d="M18 26c6-6 18-6 24 2 8 10 6 22-4 26-8 2-14-4-14-12 0-5-2-8-6-10z" fill="#6A3D8F" transform="rotate(20 32 32)"/><path d="M14 18c6-4 12-2 14 4-4 2-10 2-14-4z" fill="#4F9A4A"/></g>`,
  chilli: `<g stroke="none"><path d="M16 14c10-2 26 8 30 24 2 8-2 12-6 12-4-12-14-18-26-20 0-6 0-12 2-16z" fill="#D8432E"/><path d="M14 12c2-4 6-6 10-6l-2 8z" fill="#4F9A4A"/></g>`,
  pumpkin: `<g stroke="none"><ellipse cx="32" cy="38" rx="21" ry="15" fill="#F08A24"/></g><path d="M22 25c-4 8-4 18 0 26M32 23v30M42 25c4 8 4 18 0 26" stroke="#C86A10" stroke-width="2"/><path d="M32 23c0-5 2-8 5-9" stroke="#4F9A4A" stroke-width="4"/>`,
  soybean: `<path d="M32 54V30" stroke="#4F9A4A"/><g stroke="none"><path d="M14 22c10-8 22-6 30 4-2 8-12 12-22 8-4-2-8-6-8-12z" fill="#8FBF5A"/></g><g fill="#F3EBC4" stroke="none"><circle cx="22" cy="28" r="3.4"/><circle cx="30" cy="27" r="3.4"/><circle cx="38" cy="29" r="3.4"/></g>`,
  finger_millet: `<path d="M32 54V32" stroke="#4F9A4A"/><g stroke="#8C5A2B" stroke-width="3.4"><path d="M32 32L18 12M32 32L26 8M32 32L38 8M32 32L46 12M32 32L32 6"/></g><g fill="#C58A3F" stroke="none"><circle cx="18" cy="12" r="3"/><circle cx="26" cy="8" r="3"/><circle cx="32" cy="6" r="3"/><circle cx="38" cy="8" r="3"/><circle cx="46" cy="12" r="3"/></g>`,
  sesame: `<path d="M32 54V24" stroke="#4F9A4A"/><g stroke="none"><path d="M32 10c6 4 8 14 0 22-8-8-6-18 0-22z" fill="#E9DDB4"/></g><g fill="#6B4B2A" stroke="none"><circle cx="30" cy="18" r="1.6"/><circle cx="34" cy="22" r="1.6"/><circle cx="30" cy="26" r="1.6"/></g><path d="M32 40c-6-1-10-5-12-9M32 44c6-1 10-4 12-8" stroke="#4F9A4A"/>`,
};
const badge = (id, cls = "calt-badge") => `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#3F7D3A" stroke-width="3" stroke-linecap="round"><circle cx="32" cy="32" r="30" fill="#E3F1E6" stroke="none"/>${BADGE[id] || ""}</svg>`;

// ---------------------------------------------------------------------------
// The week-by-week bar(s): one continuous bar per crop, month bands and day numbers on top
// ---------------------------------------------------------------------------
function board(crops, ids) {
  const weeks = crops.calendar;
  const bands = [];
  weeks.forEach((w) => {
    const m = w.start.slice(0, 7);
    if (bands.length && bands[bands.length - 1].m === m) bands[bands.length - 1].n++;
    else bands.push({ m, n: 1, label: date(w.start, { month: "long" }) });
  });
  const months = bands.map((b) => `<div class="calt-month" style="grid-column: span ${b.n}">${escapeHtml(b.label)}</div>`).join("");
  const days = weeks.map((w, k) => `<div class="calt-day${k === 0 ? " is-today" : ""}">
      <strong>${new Date(`${w.start}T00:00:00Z`).getUTCDate()}</strong>${k === 0 ? `<em>${escapeHtml(t("calendar.today"))}</em>` : ""}</div>`).join("");
  const rows = ids.map((id) => {
    const win = bestWindow(weeks, id);
    const segs = weeks.map((w, k) => {
      const i = w.items.find((x) => x.id === id);
      const label = `${cropName(id)}, ${t("calendar.week_of", { date: shortDate(w.start) })}: ${t(`crops.rating.${i.rating}`)}`;
      return `<button type="button" class="calt-seg calp-cell rating-${i.rating}${k === 0 ? " is-today" : ""}" style="grid-column:${k + 1}; --c:${k}"
        data-crop="${escapeHtml(id)}" data-week="${k}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${signalIcon(ICON_FOR[i.rating])}</button>`;
    }).join("");
    const best = win ? `<span class="calt-best" style="grid-column:${win.firstIndex + 1} / ${win.lastIndex + 2}" aria-hidden="true"></span>` : "";
    const caption = win ? `${shortDate(win.from)} → ${shortDate(win.to)}` : t("calendar.none_week");
    return `<div class="calt-crop">${cropIcon(id, "calt-photo")}<div><strong>${escapeHtml(cropName(id))}</strong><small>${escapeHtml(caption)}</small></div></div>
      <div class="calt-track">${segs}${best}</div>`;
  }).join("");
  return `
    <div class="calp-scroll">
      <div class="calt" role="group" aria-label="${escapeHtml(t("calendar.board_title"))}">
        <div class="calt-gutter"></div><div class="calt-months">${months}</div>
        <div class="calt-gutter"></div><div class="calt-days">${days}</div>
        ${rows}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// The status panel for ONE crop
// ---------------------------------------------------------------------------
function paddyPanel(crops, id, mode) {
  const weeks = crops.calendar;
  const item = crops.items.find((i) => i.id === id);
  const now = weeks[0].items.find((i) => i.id === id);
  const vals = weeks.map((w) => w.items.find((i) => i.id === id).tank_mm);
  const max = Math.max(...vals), min = Math.min(...vals), best = vals.indexOf(min);
  const known = now.rating !== "unknown";
  const headline = known ? t(`calendar.status.${now.rating}`) : t("calendar.paddy.unknown_head");
  const signal = t(`signal.short.${crops.signal || "none"}`);
  const bars = weeks.map((w, k) => `
    <div class="calpd-col${k === best ? " is-best" : ""}${k === 0 ? " is-today" : ""}" title="${escapeHtml(t("calendar.paddy.tip", { date: shortDate(w.start), mm: num(vals[k], 0) }))}">
      <span class="calpd-val">${num(vals[k], 0)}</span>
      <span class="calpd-plot"><span class="calpd-bar" style="height:${Math.max(8, Math.round((vals[k] / max) * 100))}%"></span></span>
      <span class="calpd-day">${escapeHtml(shortDate(w.start))}</span>
    </div>`).join("");
  const days = item?.duration_days || 0;
  const facts = [
    [t("calendar.paddy.least"), t("calendar.paddy.least_value", { date: shortDate(weeks[best].start), mm: num(min, 0) })],
    [t("calendar.harvest_label"), t("calendar.harvest_about", { date: shortDate(addDays(weeks[best].start, days)) })],
    [t("calendar.growing_label"), t("calendar.growing", { days })],
    mode === "advanced" && item ? [t("calendar.water_label"), t("calendar.water", { need: num(item.need_mm, 0), rain: num(item.rain_mm, 0) })] : null,
  ].filter(Boolean).map(([k, v]) => `<div class="calp-fact"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  return `
    <div class="calp-status rating-${known ? now.rating : "unknown"}">
      ${cropPhoto(id, cropName(id), "calp-status-photo")}
      <div class="calp-status-text">
        <p class="calp-status-crop">${cropIcon(id, "calp-status-icon")}${escapeHtml(cropName(id))}</p>
        <h3>${signalIcon(ICON_FOR[now.rating])}<span>${escapeHtml(headline)}</span></h3>
        <p class="calp-status-next">${escapeHtml(t("calendar.paddy.signal_line", { signal }))}</p>
      </div>
    </div>
    <div class="calp-facts">${facts}</div>
    <div class="calp-scroll"><div class="calpd" role="img" aria-label="${escapeHtml(t("calendar.paddy.axis"))}">${bars}</div></div>
    <p class="calpd-axis">${escapeHtml(t("calendar.paddy.axis"))}</p>
    <p class="calp-note">${escapeHtml(t(known ? "calendar.paddy.note" : "calendar.paddy.note_unknown"))}</p>`;
}

function statusPanel(crops, id, mode) {
  if (crops.items.find((i) => i.id === id)?.kind === "paddy") return paddyPanel(crops, id, mode);
  const weeks = crops.calendar;
  const now = weeks[0].items.find((i) => i.id === id);
  const item = crops.items.find((i) => i.id === id);
  const win = bestWindow(weeks, id);
  const nextGood = weeks.findIndex((w) => w.items.find((i) => i.id === id).rating === "good");
  const headline = t(`calendar.status.${now.rating}`);
  const nextLine = now.rating === "good" ? "" : nextGood > 0 ? t("calendar.next_good", { date: shortDate(weeks[nextGood].start) }) : t("calendar.none_week");
  const sample = win ? weeks[win.firstIndex].items.find((i) => i.id === id) : now;
  const days = item?.duration_days || 0;
  const facts = [
    win ? [t("calendar.best_window"), `${shortDate(win.from)} → ${shortDate(win.to)}`] : null,
    win ? [t("calendar.harvest_label"), t("calendar.harvest_about", { date: shortDate(addDays(win.from, days)) })] : null,
    [t("calendar.growing_label"), t("calendar.growing", { days })],
    sample?.past_years ? [t("calendar.history_label"), t("calendar.history", { ok: sample.past_years_ok, years: sample.past_years })] : null,
    mode === "advanced" && item ? [t("calendar.water_label"), t("calendar.water", { need: num(item.need_mm, 0), rain: num(item.rain_mm, 0) })] : null,
  ].filter(Boolean).map(([k, v]) => `<div class="calp-fact"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  const notes = [
    item?.usually_irrigated ? t("calendar.irrigated") : "",
    item?.confidence === "assumption" ? t("calendar.conf.assumption") : item?.confidence === "medium" ? t("calendar.conf.medium") : "",
  ].filter(Boolean).map((x) => `<p class="calp-note">${escapeHtml(x)}</p>`).join("");
  return `
    <div class="calp-status rating-${now.rating}">
      ${cropPhoto(id, cropName(id), "calp-status-photo")}
      <div class="calp-status-text">
        <p class="calp-status-crop">${cropIcon(id, "calp-status-icon")}${escapeHtml(cropName(id))}</p>
        <h3>${signalIcon(ICON_FOR[now.rating])}<span>${escapeHtml(headline)}</span></h3>
        ${nextLine ? `<p class="calp-status-next">${escapeHtml(nextLine)}</p>` : ""}
      </div>
    </div>
    <div class="calp-facts">${facts}</div>
    ${board(crops, [id])}
    ${notes}`;
}

export function renderCalendarPage(state, tankId, view) {
  const withCrops = state.tanks.filter((x) => x.doc?.crops?.calendar);
  let saved = null, savedCrop = null;
  try { saved = localStorage.getItem("mc-cal-tank"); savedCrop = localStorage.getItem("mc-cal-crop"); } catch { /* storage blocked: fine */ }
  const tank = withCrops.find((x) => x.id === tankId) || withCrops.find((x) => x.id === saved)
    || withCrops.find((x) => !x.demo) || withCrops[0];
  if (!tank) {
    view.innerHTML = `<section class="block"><h1>${escapeHtml(t("calendar.page.title"))}</h1><p>${escapeHtml(t("crops.missing"))}</p></section>`;
    return;
  }
  try { localStorage.setItem("mc-cal-tank", tank.id); } catch { /* ignore */ }

  const crops = tank.doc.crops;
  const ids = [...crops.calendar[0].items].sort((a, b) => (b.kind === "paddy") - (a.kind === "paddy")).map((i) => i.id);   // paddy first
  let chosen = ids.includes(savedCrop) ? savedCrop : ids[0];
  const options = [...withCrops].sort((a, b) => tankName(a).localeCompare(tankName(b)))
    .map((x) => `<option value="${escapeHtml(x.id)}"${x.id === tank.id ? " selected" : ""}>${escapeHtml(tankName(x))}</option>`).join("");

  // The crop selector: a list with an illustrated icon, the name and today's status for each crop
  const nowOf = (id) => crops.calendar[0].items.find((i) => i.id === id);
  const optionHtml = (id) => `${cropIcon(id, "calp-ddicon")}<span class="calp-ddname">${escapeHtml(cropName(id))}</span>
      <span class="calp-ddstate rating-${nowOf(id).rating}">${signalIcon(ICON_FOR[nowOf(id).rating])}<span>${escapeHtml(t(`calendar.short.${nowOf(id).rating}`))}</span></span>`;
  const cropOptions = ids.map((id) => `<li role="option" tabindex="-1" data-id="${escapeHtml(id)}" aria-selected="${id === chosen}">${optionHtml(id)}</li>`).join("");

  view.innerHTML = `
    <section class="calp-hero">
      <div class="calp-hero-text">
        <p class="hero-kicker">${escapeHtml(t("calendar.kicker"))}</p>
        <h1>${escapeHtml(t("calendar.page.title"))}</h1>
        <p class="hint">${escapeHtml(t("calendar.page.intro"))}</p>
      </div>
      <div class="calp-picks">
        <label class="calp-pick">
          <span>${escapeHtml(t("calendar.pick"))}</span>
          <select id="cal-tank">${options}</select>
          <small>${escapeHtml(t("calendar.as_of", { date: date(crops.as_of) }))}</small>
        </label>
        <div class="calp-pick calp-crop-pick">
          <span id="cal-crop-label">${escapeHtml(t("calendar.crop_label"))}</span>
          <button type="button" class="calp-ddbtn" id="cal-crop-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="cal-crop-label cal-crop-btn">${optionHtml(chosen)}<svg class="calp-ddarrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <ul class="calp-ddlist" id="cal-crop-list" role="listbox" aria-labelledby="cal-crop-label" hidden>${cropOptions}</ul>
        </div>
      </div>
    </section>
    ${tank.demo || tank.doc.demo ? `<p class="demo-banner">${escapeHtml(t("demo.banner"))}</p>` : ""}

    <section class="calp-section" aria-labelledby="calp-crop-title">
      <h2 id="calp-crop-title">${escapeHtml(t("calendar.crop_timeline", { crop: cropName(chosen) }))}</h2>
      <div class="calp-panel" id="calp-panel" aria-live="polite">${statusPanel(crops, chosen, state.mode)}</div>
      <div class="calp-legend" id="calp-legend">
        ${["good", "possible", "not_now"].map((r) => `<span class="calp-key">${signalIcon(ICON_FOR[r])}${escapeHtml(t(`crops.rating.${r}`))}</span>`).join("")}
      </div>
      <p class="calp-detail" id="cal-detail" role="status" data-hide-for-paddy>${escapeHtml(t("calendar.detail.tap"))}</p>
      <p class="note">${escapeHtml(t("crops.cal.help"))}</p>
      <p class="note">${escapeHtml(t("crops.cal.paddy"))}</p>
    </section>


    <div class="calp-actions">
      <a class="action" href="#/tank/${encodeURIComponent(tank.id)}/crops">${escapeHtml(t("calendar.link"))}</a>
      <a class="action" href="#/how-it-works">${escapeHtml(t("nav.about"))}</a>
    </div>
    <p class="note calp-source">${escapeHtml(t("crops.sources", { list: crops.sources.join("; ") }))}</p>`;

  view.querySelector("#cal-tank").onchange = (e) => { location.hash = `#/calendar/${encodeURIComponent(e.target.value)}`; };

  // Tap a week: say what that week means
  const detail = view.querySelector("#cal-detail");
  function wireCells() {
    view.querySelectorAll(".calp-cell").forEach((cell) => {
      cell.onclick = () => {
        const w = crops.calendar[Number(cell.dataset.week)];
        const i = w.items.find((x) => x.id === cell.dataset.crop);
        let text = t("calendar.detail", { crop: cropName(i.id), date: shortDate(w.start), rating: t(`crops.rating.${i.rating}`) });
        if (i.past_years) text += " " + t("calendar.detail.history", { ok: i.past_years_ok, years: i.past_years });
        if (state.mode === "advanced" && i.ratio != null) text += " " + t("calendar.detail.ratio", { ratio: num(i.ratio, 2) });
        detail.textContent = text;
        view.querySelectorAll(".calp-cell.is-picked").forEach((c) => c.classList.remove("is-picked"));
        cell.classList.add("is-picked");
      };
    });
  }

  // Choose a crop: redraw the heading and the panel
  const btn = view.querySelector("#cal-crop-btn"), list = view.querySelector("#cal-crop-list");
  const isPaddy = () => crops.items.find((i) => i.id === chosen)?.kind === "paddy";
  function syncChrome() {                       // the colour legend and "tap a week" only make sense for rain-fed crops
    view.querySelector("#calp-legend").hidden = isPaddy();
    detail.hidden = isPaddy();
  }
  function closeList(focus = true) { list.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focus) btn.focus(); }
  function openList() {
    list.hidden = false; btn.setAttribute("aria-expanded", "true");
    (list.querySelector('[aria-selected="true"]') || list.firstElementChild).focus();
  }
  function choose(id) {
    chosen = id;
    try { localStorage.setItem("mc-cal-crop", chosen); } catch { /* ignore */ }
    list.querySelectorAll("li").forEach((li) => li.setAttribute("aria-selected", String(li.dataset.id === chosen)));
    btn.innerHTML = optionHtml(chosen) + '<svg class="calp-ddarrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    view.querySelector("#calp-crop-title").textContent = t("calendar.crop_timeline", { crop: cropName(chosen) });
    view.querySelector("#calp-panel").innerHTML = statusPanel(crops, chosen, state.mode);
    detail.textContent = t("calendar.detail.tap");
    syncChrome();
    wireCells();
  }
  btn.onclick = () => (list.hidden ? openList() : closeList());
  btn.onkeydown = (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); } };
  list.querySelectorAll("li").forEach((li) => {
    li.onclick = () => { choose(li.dataset.id); closeList(); };
    li.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); }
      else if (e.key === "Escape") { e.preventDefault(); closeList(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); (li.nextElementSibling || list.firstElementChild).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (li.previousElementSibling || list.lastElementChild).focus(); }
    };
  });
  document.addEventListener("click", (e) => { if (!list.hidden && !e.target.closest(".calp-crop-pick")) closeList(false); });
  syncChrome();
  wireCells();
}
