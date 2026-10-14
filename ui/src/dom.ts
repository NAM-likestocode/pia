// Tiny DOM helper so the views stay readable without a framework.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function button(
  label: string,
  onClick: (ev: MouseEvent) => void,
  opts: { kind?: "primary" | "secondary" | "quiet" | "link" | "stop" | "suggestion" | "nav"; icon?: Node; ariaLabel?: string; className?: string } = {},
): HTMLButtonElement {
  const cls = ["btn", `btn-${opts.kind ?? "secondary"}`, opts.className ?? ""].join(" ").trim();
  const el = h(
    "button",
    { type: "button", class: cls, "aria-label": opts.ariaLabel },
    opts.icon ?? null,
    h("span", { class: "btn-label" }, label),
  );
  el.addEventListener("click", onClick);
  return el;
}

/** Sets the visible label of a button made with `button()`. */
export function setButtonLabel(btn: HTMLButtonElement, label: string): void {
  const span = btn.querySelector(".btn-label");
  if (span) span.textContent = label;
  else btn.textContent = label;
}

export function scrollToBottom(el: Element, force = false): void {
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  if (force || nearBottom) el.scrollTop = el.scrollHeight;
}
