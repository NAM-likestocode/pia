// "Meine Dateien" and "Frühere Gespräche": full panels that replace the
// conversation until she goes back.

import type { Helper } from "./bridge";
import { kindBadge, notice, openFile, problemText, setNotice } from "./common";
import { button, clear, h, setButtonLabel } from "./dom";
import { dateWords, kindLabel, sizeWords } from "./format";
import { icon } from "./icons";
import type { ChatItem, FileItem, VersionItem } from "./protocol";
import { T } from "./strings";

function panelHeader(title: string, intro: string, onBack: () => void, extra: HTMLElement[] = []): HTMLElement {
  return h(
    "header",
    { class: "panel-header" },
    button(T.files.backToChat, onBack, { kind: "secondary", icon: icon.back(), className: "back-btn" }),
    h("h1", { class: "panel-title", tabindex: "-1" }, title),
    h("p", { class: "panel-intro" }, intro),
    extra.length > 0 ? h("div", { class: "panel-tools" }, extra) : null,
  );
}

export class FilesView {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private versions: HTMLElement;
  private folderNote: HTMLElement;

  constructor(private helper: Helper, onBack: () => void) {
    this.folderNote = h("p", { class: "notice notice-inline", role: "status", hidden: true });
    const folderBtn = button(T.files.openFolder, () => void this.openFolder(folderBtn), {
      kind: "secondary",
      icon: icon.folder(),
    });
    this.list = h("div", { class: "item-list" });
    this.versions = h("div", { class: "item-list" });
    this.el = h(
      "section",
      { class: "view panel", hidden: true },
      h(
        "div",
        { class: "panel-inner" },
        panelHeader(T.files.title, T.files.intro, onBack, [folderBtn, this.folderNote]),
        this.list,
        h(
          "section",
          { class: "panel-section" },
          h("h2", {}, T.files.versionsTitle),
          h("p", { class: "panel-intro" }, T.files.versionsIntro),
          this.versions,
        ),
      ),
    );
  }

  focus(): void {
    this.el.querySelector<HTMLElement>(".panel-title")?.focus();
  }

  async load(): Promise<void> {
    this.list.replaceChildren(h("p", { class: "loading-line" }, T.files.loading));
    this.versions.replaceChildren();
    const [files, versions] = await Promise.allSettled([
      this.helper.request({ type: "list_files" }),
      this.helper.request({ type: "list_versions" }),
    ]);

    clear(this.list);
    if (files.status === "fulfilled" && files.value.type === "files") {
      this.renderFiles(files.value.items);
    } else {
      this.list.append(notice(problemText(files.status === "fulfilled" ? files.value : null)));
    }

    clear(this.versions);
    if (versions.status === "fulfilled" && versions.value.type === "versions") {
      this.renderVersions(versions.value.items);
    } else {
      this.versions.append(notice(problemText(versions.status === "fulfilled" ? versions.value : null)));
    }
  }

  private renderFiles(items: FileItem[]): void {
    if (items.length === 0) {
      this.list.append(h("p", { class: "empty-line" }, T.files.empty));
      return;
    }
    const now = Date.now();
    for (const file of items) {
      const slot = h("p", { class: "notice notice-inline", role: "status", hidden: true });
      const open = button(T.files.open, () => void openFile(this.helper, file.name, open, slot), {
        kind: "primary",
        icon: icon.open(),
        ariaLabel: T.files.openLabel(file.name),
      });
      this.list.append(
        h(
          "article",
          { class: "item-row" },
          kindBadge(file.kind),
          h(
            "div",
            { class: "item-info" },
            h("span", { class: "file-kind" }, kindLabel(file.kind)),
            h("span", { class: "item-title" }, file.name),
            h("span", { class: "item-meta" }, `${T.files.madeOn(dateWords(file.modifiedAt, now))} · ${sizeWords(file.size)}`),
          ),
          open,
          slot,
        ),
      );
    }
  }

  private renderVersions(items: VersionItem[]): void {
    if (items.length === 0) {
      this.versions.append(h("p", { class: "empty-line" }, T.files.versionsEmpty));
      return;
    }
    const now = Date.now();
    for (const version of items) {
      const slot = h("p", { class: "notice notice-inline", role: "status", hidden: true });
      const restore = button(T.files.restore, () => void this.restore(version, restore, slot), {
        kind: "secondary",
        icon: icon.restore(),
        ariaLabel: T.files.restoreLabel(version.name),
      });
      this.versions.append(
        h(
          "article",
          { class: "item-row" },
          h("span", { class: "kind-badge kind-version" }, icon.clock()),
          h(
            "div",
            { class: "item-info" },
            h("span", { class: "item-title" }, version.name),
            version.why ? h("span", { class: "item-why" }, version.why) : null,
            h("span", { class: "item-meta" }, T.files.savedOn(dateWords(version.savedAt, now))),
          ),
          restore,
          slot,
        ),
      );
    }
  }

  private async restore(version: VersionItem, btn: HTMLButtonElement, slot: HTMLElement): Promise<void> {
    btn.disabled = true;
    setNotice(slot, null);
    try {
      const answer = await this.helper.request({ type: "restore_version", versionId: version.id });
      if (answer.type === "ok") {
        setNotice(slot, T.files.restored, "good");
        btn.hidden = true;
        return;
      }
      setNotice(slot, problemText(answer));
    } catch {
      setNotice(slot, T.problem.noAnswer);
    }
    btn.disabled = false;
  }

  private async openFolder(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    setNotice(this.folderNote, null);
    try {
      const answer = await this.helper.request({ type: "open_folder" });
      if (answer.type !== "ok") setNotice(this.folderNote, problemText(answer));
    } catch {
      setNotice(this.folderNote, T.problem.noAnswer);
    } finally {
      btn.disabled = false;
      setButtonLabel(btn, T.files.openFolder);
    }
  }
}

export class HistoryView {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private busy = false;

  constructor(
    private helper: Helper,
    onBack: () => void,
    private onOpen: (chatId: string) => Promise<string | null>,
  ) {
    this.list = h("div", { class: "item-list" });
    this.el = h(
      "section",
      { class: "view panel", hidden: true },
      h("div", { class: "panel-inner" }, panelHeader(T.history.title, T.history.intro, onBack), this.list),
    );
  }

  focus(): void {
    this.el.querySelector<HTMLElement>(".panel-title")?.focus();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.el.querySelectorAll<HTMLButtonElement>(".chat-row").forEach((b) => (b.disabled = busy));
    this.el.querySelector(".busy-hint")?.toggleAttribute("hidden", !busy);
  }

  async load(): Promise<void> {
    this.list.replaceChildren(h("p", { class: "loading-line" }, T.history.loading));
    let answer;
    try {
      answer = await this.helper.request({ type: "list_chats" });
    } catch {
      answer = null;
    }
    clear(this.list);
    if (!answer || answer.type !== "chats") {
      this.list.append(notice(problemText(answer)));
      return;
    }
    this.render(answer.items);
  }

  private render(items: ChatItem[]): void {
    const hint = h("p", { class: "notice notice-inline busy-hint", hidden: !this.busy }, T.top.waitUntilDone);
    this.list.append(hint);
    if (items.length === 0) {
      this.list.append(h("p", { class: "empty-line" }, T.history.empty));
      return;
    }
    const now = Date.now();
    for (const chat of items) {
      const slot = h("p", { class: "notice notice-inline", role: "status", hidden: true });
      const row = h(
        "button",
        { type: "button", class: "chat-row" },
        h("span", { class: "kind-badge kind-chat" }, icon.clock()),
        h(
          "span",
          { class: "item-info" },
          h("span", { class: "item-title" }, chat.title || T.history.untitled),
          h("span", { class: "item-meta" }, dateWords(chat.updatedAt, now)),
        ),
        h("span", { class: "btn btn-primary chat-row-action", "aria-hidden": "true" }, h("span", { class: "btn-label" }, T.history.open)),
      );
      row.disabled = this.busy;
      row.addEventListener("click", async () => {
        row.disabled = true;
        setNotice(slot, null);
        const problem = await this.onOpen(chat.id);
        row.disabled = this.busy;
        if (problem) setNotice(slot, problem);
      });
      this.list.append(h("div", { class: "chat-row-wrap" }, row, slot));
    }
  }
}
