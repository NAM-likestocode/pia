// Pieces shared by several screens.

import type { Helper } from "./bridge";
import { button, h, setButtonLabel } from "./dom";
import { kindLabel } from "./format";
import { icon } from "./icons";
import { T } from "./strings";

/** The soft yellow card for problems. Never alarming. */
export function notice(text: string, extraClass = ""): HTMLElement {
  return h("div", { class: `notice ${extraClass}`.trim(), role: "status" }, text);
}

/** Shows `text` in a soft notice inside `slot`, or hides it when null. */
export function setNotice(slot: HTMLElement, text: string | null, kind: "soft" | "good" = "soft"): void {
  slot.textContent = text ?? "";
  slot.hidden = text === null;
  slot.classList.toggle("notice-good", kind === "good");
}

/** Friendly text for a request that failed or answered with a problem. */
export function problemText(answer: { type: string; text?: string } | null): string {
  if (answer && answer.type === "problem" && answer.text) return answer.text;
  return T.problem.noAnswer;
}

export async function openFile(helper: Helper, name: string, btn: HTMLButtonElement, slot: HTMLElement): Promise<void> {
  btn.disabled = true;
  setButtonLabel(btn, T.files.opening);
  setNotice(slot, null);
  try {
    const answer = await helper.request({ type: "open_file", name });
    if (answer.type !== "ok") setNotice(slot, problemText(answer));
  } catch {
    setNotice(slot, T.problem.noAnswer);
  } finally {
    btn.disabled = false;
    setButtonLabel(btn, T.files.open);
  }
}

export function kindBadge(kind: string): HTMLElement {
  return h("span", { class: `kind-badge kind-${kind}` }, icon.file(kind));
}

/** A card for a file Pia made, with a big "Öffnen" button. */
export function fileCard(helper: Helper, name: string, kind: string): HTMLElement {
  const slot = h("p", { class: "notice notice-inline", role: "status", hidden: true });
  const open = button(T.files.open, () => void openFile(helper, name, open, slot), {
    kind: "primary",
    icon: icon.open(),
    ariaLabel: T.files.openLabel(name),
  });
  return h(
    "div",
    { class: "file-card", "data-name": name },
    kindBadge(kind),
    h("div", { class: "file-info" }, h("span", { class: "file-kind" }, kindLabel(kind)), h("span", { class: "file-name" }, name)),
    open,
    slot,
  );
}
