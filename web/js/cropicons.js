// Illustrated crop icons (drawn here as SVG: gradients, shading and detail, so they read as the real plant part).
// cropIcon("maize", "my-class") → an <svg> string, 64 x 64, round soft background.
// No pictures are downloaded; every icon is just code.

// Little helpers so each icon stays short
const grad = (id, a, b, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const leaf = (x, y, rot, s = 1, fill = "url(#lf)") =>
  `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 0C6-8 16-8 22 0 16 8 6 8 0 0z" fill="${fill}" stroke="#2F6B34" stroke-width=".8"/><path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M1 0H20" stroke="#2F6B34" stroke-width=".7" opacity=".6"/>`;
const common = `${grad("lf", "#8FCB5A", "#3F8A3A")}`;

const ICONS = {
  // ---- pulses -------------------------------------------------------------------------
  mung_bean: () => `<defs>${common}${grad("mb", "#9ED66B", "#4F9A3A")}</defs>
    <path d="M32 58C32 44 30 34 26 24" stroke="#3E7D32" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${leaf(30, 40, -150, .9)}${leaf(32, 34, -20, .9)}
    <g fill="url(#mb)" stroke="#3E7D32" stroke-width=".8">
      <path d="M26 24c-2-8 0-15 4-20 3 6 2 14-4 20z"/><path d="M26 25c-6-4-10-10-10-17 6 2 11 9 10 17z"/><path d="M27 26c4-7 10-11 18-11-1 8-8 13-18 11z"/></g>
    <g stroke="#2F6B34" stroke-width=".7" opacity=".6" fill="none"><path d="M28 6c0 6-1 10-2 16"/><path d="M18 11c3 4 6 8 8 12"/><path d="M42 17c-6 2-11 5-14 8"/></g>`,

  cowpea: () => `<defs>${common}${grad("cp", "#B6E07A", "#6DAF3E")}</defs>
    <path d="M30 6C30 20 28 32 30 44" stroke="#3E7D32" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    ${leaf(30, 14, 20, .8)}${leaf(30, 18, 160, .8)}
    <g fill="url(#cp)" stroke="#4B8F34" stroke-width=".8">
      <path d="M30 24C26 36 24 48 26 60c4-10 5-24 4-36z"/><path d="M31 24C37 34 42 46 44 58c-6-8-11-22-13-34z"/></g>
    <g fill="#5E9B3A" opacity=".45"><circle cx="27.5" cy="38" r="1.7"/><circle cx="26.5" cy="48" r="1.7"/><circle cx="38" cy="40" r="1.7"/><circle cx="41" cy="50" r="1.7"/></g>
    <path d="M26 60c0 2 1 3 2 3M44 58c1 2 2 3 3 3" stroke="#7A5C2E" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,

  black_gram: () => `<defs>${common}${grad("bg", "#7A8450", "#3E4A27")}</defs>
    <path d="M32 58V30" stroke="#3E7D32" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${leaf(32, 46, -150, .95)}${leaf(32, 42, -30, .95)}
    <g fill="url(#bg)" stroke="#2F3A1B" stroke-width=".8">
      <path d="M32 30c-8-2-14-8-16-16 7 0 14 5 16 16z"/><path d="M32 30c-2-8 2-17 9-22 3 8 0 17-9 22z"/><path d="M33 31c6-5 13-6 19-3-3 7-11 9-19 3z"/></g>
    <g stroke="#C9CDA0" stroke-width=".6" opacity=".8" stroke-linecap="round">
      <path d="M20 17l1 1M24 20l1 1M29 24l1 1M38 12l1-1M36 20l1-1M41 14l1-1M44 28l1 1M49 30l1 1M40 30l1 1"/></g>`,

  soybean: () => `<defs>${common}${grad("sb", "#A5CF63", "#5F9A36")}</defs>
    <path d="M30 58C30 46 32 38 36 28" stroke="#3E7D32" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${leaf(30, 50, 180, 1)}${leaf(31, 44, 20, 1)}
    <g fill="url(#sb)" stroke="#4B7F2A" stroke-width=".8">
      <path d="M36 28C34 18 30 12 22 8c-2 8 2 16 14 20z"/><path d="M36 28c4-8 10-12 18-12 0 8-6 14-18 12z"/></g>
    <g fill="#E9F2C6" opacity=".9"><ellipse cx="27" cy="15" rx="2.3" ry="3" transform="rotate(-30 27 15)"/><ellipse cx="32" cy="21" rx="2.3" ry="3" transform="rotate(-30 32 21)"/><ellipse cx="44" cy="19" rx="2.3" ry="3" transform="rotate(40 44 19)"/><ellipse cx="50" cy="17" rx="1.8" ry="2.4" transform="rotate(40 50 17)"/></g>
    <g stroke="#DDE8B0" stroke-width=".6" opacity=".8"><path d="M24 12l1 1M30 17l1 1M38 25l1 1M46 22l1-1"/></g>`,

  // ---- cereals and millets ------------------------------------------------------------
  maize: () => {
    let kernels = "";
    for (let y = 14, r = 0; y <= 46; y += 4.2, r++) for (let x = 25 + (r % 2) * 2; x <= 39; x += 4) kernels += `<circle cx="${x}" cy="${y}" r="1.7"/>`;
    return `<defs>${grad("mz", "#FFE066", "#E3A21A")}${grad("hk", "#79B552", "#3C8A38", false)}</defs>
    <path d="M31 58C14 52 10 34 20 14c4 12 9 26 11 44z" fill="url(#hk)" stroke="#2F6B34" stroke-width=".8"/>
    <path d="M33 58C50 52 54 34 44 14c-4 12-9 26-11 44z" fill="url(#hk)" stroke="#2F6B34" stroke-width=".8"/>
    <path d="M32 8c9 3 12 15 11 30-1 10-5 18-11 18S22 48 21 38C20 23 23 11 32 8z" fill="url(#mz)" stroke="#C48A12" stroke-width=".8"/>
    <g fill="#F4C430" stroke="#C48A12" stroke-width=".4" clip-path="inset(0)">${kernels}</g>
    <path d="M32 8c-1-3 0-5 3-7M32 8c-3-2-6-2-9 1M32 8c2-3 5-3 8-2" stroke="#B8893A" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;
  },

  finger_millet: () => `<defs>${common}${grad("fm", "#C98B3C", "#8A5521", false)}</defs>
    <path d="M32 60V34" stroke="#4B8F34" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    ${leaf(32, 52, -165, 1.05)}${leaf(32, 48, -15, 1.05)}
    <g fill="none" stroke="url(#fm)" stroke-width="5" stroke-linecap="round">
      <path d="M32 34C26 28 20 22 17 12"/><path d="M32 34C29 26 26 18 25 7"/><path d="M32 34C33 26 36 18 40 8"/><path d="M32 34C38 28 44 22 48 13"/></g>
    <g fill="#E9B866" opacity=".9"><circle cx="20" cy="22" r="1"/><circle cx="19" cy="15" r="1"/><circle cx="25" cy="22" r="1"/><circle cx="26" cy="12" r="1"/><circle cx="37" cy="20" r="1"/><circle cx="40" cy="12" r="1"/><circle cx="43" cy="24" r="1"/><circle cx="47" cy="17" r="1"/></g>`,

  // ---- oil crops ---------------------------------------------------------------------
  groundnut: () => `<defs>${common}${grad("gn", "#EBCB94", "#BC8E52")}</defs>
    ${leaf(14, 24, -70, .8)}${leaf(14, 24, -20, .8)}${leaf(14, 24, -110, .8)}
    <g transform="rotate(-25 34 38)">
      <path d="M12 38a9 9 0 0 1 9-9h4c4 0 5 3 9 3s5-3 9-3h4a9 9 0 0 1 0 18h-4c-4 0-5-3-9-3s-5 3-9 3h-4a9 9 0 0 1-9-9z" fill="url(#gn)" stroke="#9A6E3A" stroke-width="1"/>
      <g stroke="#A67B45" stroke-width=".7" opacity=".7" fill="none"><path d="M17 33l4 4M21 31l5 5M26 33l4 4M38 31l4 4M43 33l4 4M17 41l4-4M24 44l4-4M40 44l4-4M46 40l3-3"/></g></g>
    <ellipse cx="46" cy="52" rx="7" ry="4" fill="#CFA56C" stroke="#9A6E3A" stroke-width=".8" transform="rotate(-20 46 52)"/>`,

  sesame: () => `<defs>${common}${grad("sf", "#FFFFFF", "#F4D7E4")}${grad("sc", "#B8D56A", "#6A9A32")}</defs>
    <path d="M32 60V12" stroke="#4B8F34" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${leaf(32, 52, -160, 1)}${leaf(32, 46, -20, 1)}
    <g fill="url(#sc)" stroke="#4B7A2A" stroke-width=".8"><path d="M32 40c-4-4-5-10-3-15 4 3 5 9 3 15z"/><path d="M33 34c3-4 8-6 11-4-1 5-5 8-11 4z"/></g>
    <path d="M32 24c-6-3-11-9-9-15 6 1 10 7 9 15z" fill="url(#sf)" stroke="#D88BAE" stroke-width=".9"/>
    <path d="M32 24c6-3 11-9 9-15-6 1-10 7-9 15z" fill="url(#sf)" stroke="#D88BAE" stroke-width=".9"/>
    <path d="M28 16c1 3 2 5 4 8M36 16c-1 3-2 5-4 8" stroke="#E9A9C5" stroke-width=".8" fill="none"/>
    <g fill="#7A5230"><circle cx="30" cy="30" r=".9"/><circle cx="34" cy="31" r=".9"/><circle cx="31" cy="35" r=".9"/></g>`,

  // ---- roots, bulbs and vegetables ---------------------------------------------------
  sweet_potato: () => `<defs>${common}${grad("sp", "#C2658F", "#7E3558")}${grad("sw", "#FFC36B", "#F08A24")}</defs>
    ${leaf(46, 18, -80, 1)}${leaf(46, 18, -30, 1)}
    <path d="M46 18C46 24 44 28 40 32" stroke="#4B8F34" stroke-width="2" fill="none"/>
    <path d="M8 44C8 30 22 24 38 28c10 3 16 8 14 15-3 9-20 14-34 10-6-2-10-5-10-9z" fill="url(#sp)" stroke="#6B2D4A" stroke-width="1"/>
    <path d="M10 46C14 38 26 34 40 34c-14 0-24 5-30 12z" fill="#E8A5C2" opacity=".35"/>
    <g stroke="#5B2540" stroke-width=".8" opacity=".6" fill="none"><path d="M18 42c4 1 8 0 12-2M34 46c4 0 8-1 12-4"/></g>
    <path d="M52 40C56 44 56 48 52 50" stroke="#5B2540" stroke-width="1" fill="none"/>
    <path d="M8 44c-2 2-2 4 0 6 3 1 5 0 6-2z" fill="url(#sw)" stroke="#C26A12" stroke-width=".8"/>`,

  big_onion: () => `<defs>${grad("on", "#F5D0A0", "#C98A4A")}${grad("oc", "#F7E1C6", "#E6B68B", false)}</defs>
    <path d="M32 6c-3 6-3 12 0 16 3-4 3-10 0-16z" fill="#8BBF5A" stroke="#4B8F34" stroke-width=".8"/>
    <path d="M32 18c14 0 24 10 24 22 0 10-9 17-24 17S8 50 8 40c0-12 10-22 24-22z" fill="url(#on)" stroke="#9A6228" stroke-width="1"/>
    <g fill="none" stroke="#B7763A" stroke-width="1.1" opacity=".8"><path d="M32 19c-9 6-13 16-11 36"/><path d="M32 19c9 6 13 16 11 36"/><path d="M32 19c-3 8-3 22 0 38"/></g>
    <path d="M16 36c2-6 6-10 11-12" stroke="#fff" stroke-width="2.2" opacity=".55" fill="none" stroke-linecap="round"/>
    <path d="M26 58l-1 4M32 58v5M38 58l1 4" stroke="#A67B45" stroke-width="1.4" stroke-linecap="round"/>`,

  brinjal: () => `<defs>${grad("br", "#8A4FB5", "#3E1F63", false)}${grad("cap", "#7DBB57", "#3F8A3A")}</defs>
    <path d="M44 14c8 4 10 14 6 26-4 12-14 20-24 20-8 0-12-6-10-14 2-8 8-12 14-20 4-6 8-14 14-12z" fill="url(#br)" stroke="#2D1648" stroke-width="1"/>
    <path d="M36 22c-6 6-10 14-12 22" stroke="#fff" stroke-width="3" opacity=".35" fill="none" stroke-linecap="round"/>
    <path d="M30 10c4-4 11-4 16 0-2 6-9 10-15 6-1-2-1-4-1-6z" fill="url(#cap)" stroke="#2F6B34" stroke-width=".9"/>
    <path d="M26 8c-1-3 0-5 3-5M30 10l-6-3M37 6l-2-4" stroke="#3F8A3A" stroke-width="2" stroke-linecap="round" fill="none"/>`,

  chilli: () => `<defs>${grad("ch", "#FF6A4D", "#B71C1C", false)}${grad("cs", "#7DBB57", "#3F8A3A")}</defs>
    <path d="M16 18C34 14 54 28 56 52c-8-6-14-14-22-18-6-3-12-4-18-4z" fill="url(#ch)" stroke="#7A0F0F" stroke-width="1"/>
    <path d="M12 12C22 6 34 12 36 22 28 26 18 22 12 12z" fill="url(#ch)" stroke="#7A0F0F" stroke-width="1" transform="translate(0 22) scale(.85) translate(0 -6)" opacity=".92"/>
    <path d="M20 22C34 22 46 30 52 44" stroke="#fff" stroke-width="2" opacity=".45" fill="none" stroke-linecap="round"/>
    <path d="M10 20c1-6 5-10 9-11 2 3 2 7-1 12z" fill="url(#cs)" stroke="#2F6B34" stroke-width=".9"/>
    <path d="M10 14c-2-3-2-6 0-9" stroke="#3F8A3A" stroke-width="2.4" stroke-linecap="round" fill="none"/>`,

  pumpkin: () => `<defs>${grad("pk", "#FFB347", "#E3721A", false)}${common}</defs>
    <path d="M32 18c-16-4-26 6-26 20 0 12 10 20 26 20s26-8 26-20c0-14-10-24-26-20z" fill="url(#pk)" stroke="#B5530D" stroke-width="1"/>
    <g fill="none" stroke="#C45F10" stroke-width="1.4" opacity=".8"><path d="M32 20c-9 6-12 20-6 36"/><path d="M32 20c9 6 12 20 6 36"/><path d="M32 20c-3 8-3 24 0 36"/></g>
    <path d="M14 34c2-6 6-9 10-10" stroke="#fff" stroke-width="2.4" opacity=".45" fill="none" stroke-linecap="round"/>
    <path d="M32 18c0-5 2-9 6-11" stroke="#6B8E23" stroke-width="4" stroke-linecap="round" fill="none"/>
    <path d="M38 10c4-3 8-2 10 2" stroke="#4B8F34" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    ${leaf(41, 14, -40, .8)}`,

  // ---- rice -------------------------------------------------------------------------
  paddy: () => `<defs>${common}${grad("pd", "#F7D774", "#D9A22B", false)}</defs>
    <path d="M6 54c6-3 10 3 16 0s10 3 16 0 10 3 16 0" stroke="#5BA3C7" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M30 56C30 40 30 28 36 14" stroke="#4B8F34" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M26 56C22 44 18 36 10 30c10 0 18 8 20 26z" fill="url(#lf)" stroke="#2F6B34" stroke-width=".8"/>
    <path d="M34 56C38 46 44 40 54 38c-8 2-16 8-20 18z" fill="url(#lf)" stroke="#2F6B34" stroke-width=".8"/>
    <g fill="url(#pd)" stroke="#B8821C" stroke-width=".7">
      <ellipse cx="37" cy="13" rx="2.2" ry="4" transform="rotate(20 37 13)"/><ellipse cx="42" cy="17" rx="2.2" ry="4" transform="rotate(50 42 17)"/>
      <ellipse cx="45" cy="23" rx="2.2" ry="4" transform="rotate(75 45 23)"/><ellipse cx="46" cy="30" rx="2.2" ry="4" transform="rotate(95 46 30)"/>
      <ellipse cx="33" cy="18" rx="2.2" ry="4" transform="rotate(-10 33 18)"/><ellipse cx="38" cy="22" rx="2.2" ry="4" transform="rotate(25 38 22)"/>
      <ellipse cx="41" cy="28" rx="2.2" ry="4" transform="rotate(55 41 28)"/></g>
    <path d="M37 9c1-2 3-3 5-3" stroke="#B8821C" stroke-width="1" fill="none" stroke-linecap="round"/>`,

  paddy_short: () => ICONS.paddy(),
};

// The icon on its soft round background
export function cropIcon(id, cls = "crop-icon-svg") {
  const art = ICONS[id];
  if (!art) return "";
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="31" fill="#F1F7EA" stroke="#D6E6CC"/>
    <g transform="translate(5.6 5.6) scale(.825)">${art()}</g></svg>`;
}
export const CROP_ICON_IDS = Object.keys(ICONS);
