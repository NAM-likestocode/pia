// Inline SVG pictures. Always shown next to a word, never alone.

const NS = "http://www.w3.org/2000/svg";

function svg(markup: string, className: string, viewBox = "0 0 24 24"): SVGSVGElement {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("class", className);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  el.innerHTML = markup;
  return el;
}

/** Pia's face: a simple warm smiling circle. */
export function avatar(size: "small" | "large" = "small"): SVGSVGElement {
  return svg(
    `<circle cx="32" cy="32" r="30" fill="#F2C48D"/>
     <circle cx="32" cy="32" r="30" fill="none" stroke="#0F5E5A" stroke-width="3"/>
     <circle cx="17" cy="37" r="5" fill="#EE9F86" opacity="0.7"/>
     <circle cx="47" cy="37" r="5" fill="#EE9F86" opacity="0.7"/>
     <circle cx="23" cy="27" r="3.4" fill="#2B2622"/>
     <circle cx="41" cy="27" r="3.4" fill="#2B2622"/>
     <path d="M20 39 Q32 50 44 39" fill="none" stroke="#2B2622" stroke-width="3.4" stroke-linecap="round"/>`,
    `avatar avatar-${size}`,
    "0 0 64 64",
  );
}

const stroke = `fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

export const icon = {
  plus: () => svg(`<path ${stroke} d="M12 5v14M5 12h14"/>`, "icon"),
  folder: () =>
    svg(`<path ${stroke} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`, "icon"),
  clock: () => svg(`<circle ${stroke} cx="12" cy="12" r="9"/><path ${stroke} d="M12 7v5l3 2"/>`, "icon"),
  send: () => svg(`<path ${stroke} d="M4 12l16-8-6 16-2-6z"/>`, "icon"),
  stop: () => svg(`<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>`, "icon"),
  camera: () =>
    svg(
      `<path ${stroke} d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle ${stroke} cx="12" cy="13" r="3.5"/>`,
      "icon",
    ),
  back: () => svg(`<path ${stroke} d="M15 5l-7 7 7 7"/>`, "icon"),
  check: () => svg(`<path ${stroke} d="M5 12l5 5 9-10"/>`, "icon"),
  close: () => svg(`<path ${stroke} d="M6 6l12 12M18 6L6 18"/>`, "icon"),
  open: () => svg(`<path ${stroke} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`, "icon"),
  restore: () => svg(`<path ${stroke} d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>`, "icon"),
  file: (kind: string) => {
    const body: Record<string, string> = {
      brief: `<path ${stroke} d="M6 3h8l4 4v14H6z"/><path ${stroke} d="M9 11h6M9 14h6M9 17h4"/>`,
      tabelle: `<rect ${stroke} x="4" y="4" width="16" height="16" rx="1.5"/><path ${stroke} d="M4 10h16M4 15h16M10 4v16"/>`,
      webseite: `<rect ${stroke} x="3" y="4" width="18" height="16" rx="2"/><path ${stroke} d="M3 9h18"/><circle cx="6" cy="6.5" r="0.9" fill="currentColor"/><circle cx="9" cy="6.5" r="0.9" fill="currentColor"/>`,
      bild: `<rect ${stroke} x="3" y="5" width="18" height="14" rx="2"/><circle ${stroke} cx="9" cy="10" r="1.8"/><path ${stroke} d="M3 17l5-5 4 4 3-3 6 6"/>`,
    };
    return svg(body[kind] ?? `<path ${stroke} d="M6 3h8l4 4v14H6z"/><path ${stroke} d="M14 3v4h4"/>`, "icon file-icon");
  },
};
