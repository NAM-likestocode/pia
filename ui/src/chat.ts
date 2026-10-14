// The conversation: messages, Pia's streaming answers, file cards,
// big-job questions, the pause card and the input area.

import type { Helper } from "./bridge";
import { fileCard, notice } from "./common";
import { button, clear, h, setButtonLabel } from "./dom";
import { countdownWords, resumeWords } from "./format";
import { avatar, icon } from "./icons";
import { isImage, prepareImage, type PendingImage } from "./images";
import { renderMarkdown } from "./markdown";
import type { ChatMessage, Features } from "./protocol";
import { T } from "./strings";

const MAX_IMAGES = 4;

type PiaBubble = {
  row: HTMLElement;
  md: HTMLElement;
  files: HTMLElement;
  text: string;
  frame: number | null;
  streaming: boolean;
};

type ConfirmCard = { requestId: string; buttons: HTMLButtonElement[]; answered: boolean; result: HTMLElement };

type Pause = {
  until: number;
  card: HTMLElement;
  text: HTMLElement;
  countdown: HTMLElement;
  resume: HTMLElement;
  timer: ReturnType<typeof setInterval>;
};

export class ChatView {
  readonly el: HTMLElement;
  private log: HTMLElement;
  private inner: HTMLElement;
  private welcome: HTMLElement;
  private activity: HTMLElement;
  private activityText: HTMLElement;
  private restartLine: HTMLElement;

  private textarea: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private photoBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private thumbs: HTMLElement;
  private composerNote: HTMLElement;

  private rows = 0;
  private current: PiaBubble | null = null;
  /** The last Pia bubble of the current turn; file cards go here. */
  private turnBubble: PiaBubble | null = null;
  private busy = false;
  private stopping = false;
  private awaitingBusy = false;
  private pause: Pause | null = null;
  private features: Features = { documents: true, spreadsheets: true, webpages: true, photos: false, settingsHelp: true };
  private images: PendingImage[] = [];
  private preparing = 0;
  private confirms: ConfirmCard[] = [];

  constructor(private helper: Helper) {
    this.welcome = h("section", { class: "welcome" });
    this.activityText = h("span", { class: "activity-text" }, T.chat.thinking);
    this.activity = h(
      "div",
      { class: "activity", hidden: true, role: "status", "aria-live": "polite" },
      h("span", { class: "dots", "aria-hidden": "true" }, h("span"), h("span"), h("span")),
      this.activityText,
    );
    this.inner = h("div", { class: "log-inner" }, this.welcome, this.activity);
    this.log = h("div", { class: "log", role: "log", "aria-label": T.chat.logLabel, tabindex: "-1" }, this.inner);

    this.restartLine = h(
      "div",
      { class: "restart-line", hidden: true, role: "status", "aria-live": "polite" },
      h("span", { class: "dots", "aria-hidden": "true" }, h("span"), h("span"), h("span")),
      T.restarting,
    );

    // --- composer --------------------------------------------------------
    this.textarea = h("textarea", {
      id: "message",
      class: "message-input",
      rows: 2,
      placeholder: T.composer.placeholder,
      "aria-describedby": "enter-hint",
    });
    this.textarea.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        this.submit();
      }
    });
    this.textarea.addEventListener("input", () => this.autosize());
    this.textarea.addEventListener("paste", (ev) => {
      const files = Array.from(ev.clipboardData?.files ?? []).filter(isImage);
      if (files.length > 0 && this.features.photos) {
        ev.preventDefault();
        void this.addFiles(files);
      }
    });

    this.fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, tabindex: "-1" });
    this.fileInput.addEventListener("change", () => {
      void this.addFiles(Array.from(this.fileInput.files ?? []));
      this.fileInput.value = "";
    });

    this.photoBtn = button(T.composer.addPhoto, () => this.fileInput.click(), { kind: "secondary", icon: icon.camera() });
    this.sendBtn = button(T.composer.send, () => this.submit(), { kind: "primary", icon: icon.send(), className: "send-btn" });
    this.stopBtn = button(T.chat.stop, () => this.stop(), { kind: "stop", icon: icon.stop(), className: "send-btn" });
    this.stopBtn.hidden = true;

    this.thumbs = h("div", { class: "thumbs", hidden: true });
    this.composerNote = h("p", { class: "notice notice-inline", role: "status", hidden: true });

    const composer = h(
      "form",
      { class: "composer", onsubmit: (ev: Event) => ev.preventDefault() },
      this.thumbs,
      this.composerNote,
      h("label", { for: "message", class: "sr-only" }, T.composer.label),
      this.textarea,
      h(
        "div",
        { class: "composer-actions" },
        this.photoBtn,
        this.fileInput,
        h("span", { id: "enter-hint", class: "enter-hint" }, T.composer.enterHint),
        this.sendBtn,
        this.stopBtn,
      ),
    );

    const dropHint = h("div", { class: "drop-hint", "aria-hidden": "true" }, h("span", {}, icon.camera(), T.composer.dropHere));

    this.el = h(
      "section",
      { class: "view chat-view" },
      this.log,
      h("div", { class: "composer-wrap" }, this.restartLine, composer),
      dropHint,
    );
    this.setupDrop();
    this.renderWelcome();
    this.updateComposer();
  }

  // --- public API -----------------------------------------------------------

  focusInput(): void {
    this.textarea.focus();
  }

  setFeatures(features: Features): void {
    this.features = features;
    if (!features.photos && this.images.length > 0) {
      this.images = [];
      this.renderThumbs();
    }
    this.renderWelcome();
    this.updateComposer();
  }

  /** Replaces the conversation with these messages. */
  reset(messages: ChatMessage[]): void {
    for (const el of Array.from(this.inner.children)) {
      if (el !== this.welcome && el !== this.activity) el.remove();
    }
    this.rows = 0;
    this.current = null;
    this.turnBubble = null;
    this.confirms = [];
    for (const message of messages) {
      if (message.role === "user") {
        this.userMessage(message.text, message.imageCount, []);
      } else {
        const bubble = this.piaBubble();
        bubble.text = message.text;
        bubble.md.replaceChildren(renderMarkdown(message.text));
        for (const file of message.files) bubble.files.append(fileCard(this.helper, file.name, file.kind));
      }
    }
    if (this.pause) this.addRow(this.pause.card);
    this.updateWelcome();
    requestAnimationFrame(() => (this.log.scrollTop = this.log.scrollHeight));
  }

  setBusy(busy: boolean): void {
    const wasAwaiting = this.awaitingBusy;
    this.awaitingBusy = false;
    if (this.busy === busy) {
      if (wasAwaiting) {
        this.setActivity(null);
        this.updateComposer();
      }
      return;
    }
    this.busy = busy;
    if (!busy) {
      if (this.current) this.finishBubble(this.current);
      this.current = null;
      if (this.stopping) this.addRow(h("p", { class: "small-note" }, T.chat.stoppedNote));
      this.stopping = false;
      for (const c of this.confirms) if (!c.answered) c.buttons.forEach((b) => (b.disabled = true));
      this.setActivity(null);
    } else {
      this.setActivity(null);
    }
    this.updateComposer();
  }

  setActivity(text: string | null): void {
    this.activityText.textContent = text ?? T.chat.thinking;
    const show = this.busy || this.awaitingBusy;
    this.activity.hidden = !show;
    // Keep the activity line as the last thing in the conversation.
    this.inner.append(this.activity);
    this.stickToBottom();
  }

  replyStart(): void {
    if (this.current) this.finishBubble(this.current);
    this.current = this.piaBubble();
    this.current.streaming = true;
    this.current.row.classList.add("streaming");
    this.turnBubble = this.current;
    this.log.setAttribute("aria-busy", "true");
  }

  replyDelta(text: string): void {
    if (!this.current) this.replyStart();
    const bubble = this.current!;
    bubble.text += text;
    if (bubble.frame === null) {
      bubble.frame = requestAnimationFrame(() => {
        bubble.frame = null;
        const stick = this.nearBottom();
        // Hide a list marker that has no words yet, so no empty bullet flickers.
        bubble.md.replaceChildren(renderMarkdown(bubble.text.replace(/\n[ \t]*([-*+]|\d+\.)?[ \t]*$/, "")));
        if (stick) this.log.scrollTop = this.log.scrollHeight;
      });
    }
  }

  replyEnd(text: string): void {
    if (!this.current) this.replyStart();
    const bubble = this.current!;
    bubble.text = text;
    this.finishBubble(bubble);
    this.current = null;
  }

  fileMade(name: string, kind: string): void {
    let bubble = this.current ?? this.turnBubble;
    if (!bubble) {
      bubble = this.piaBubble();
      this.turnBubble = bubble;
    }
    const card = fileCard(this.helper, name, kind);
    const existing = Array.from(bubble.files.children).find(
      (el) => el instanceof HTMLElement && el.dataset["name"] === name,
    );
    if (existing) existing.replaceWith(card);
    else bubble.files.append(card);
    this.stickToBottom();
  }

  confirmRequest(requestId: string, title: string, points: string[]): void {
    const result = h("p", { class: "confirm-result", hidden: true });
    const entry: ConfirmCard = { requestId, buttons: [], answered: false, result };
    const answer = (yes: boolean) => {
      if (entry.answered) return;
      entry.answered = true;
      entry.buttons.forEach((b) => (b.disabled = true));
      chosen(yes ? yesBtn : noBtn);
      result.replaceChildren(icon.check(), h("span", {}, yes ? T.confirm.choseYes : T.confirm.choseNo));
      result.hidden = false;
      void this.helper.send({ type: "confirm_answer", requestId, yes }).catch(() => this.problem(T.problem.noAnswer));
    };
    const chosen = (b: HTMLButtonElement) => b.classList.add("chosen");
    const yesBtn = button(T.confirm.yes, () => answer(true), { kind: "primary", icon: icon.check(), className: "btn-big" });
    const noBtn = button(T.confirm.no, () => answer(false), { kind: "secondary", icon: icon.close(), className: "btn-big" });
    entry.buttons = [yesBtn, noBtn];
    this.confirms.push(entry);

    const card = h(
      "div",
      { class: "confirm-card", role: "group", "aria-labelledby": `confirm-${requestId}` },
      h("h3", { id: `confirm-${requestId}` }, title),
      points.length > 0 ? h("ul", {}, points.map((p) => h("li", {}, p))) : null,
      h("div", { class: "confirm-actions" }, yesBtn, noBtn),
      result,
    );
    this.addRow(this.piaRow(card));
    this.stickToBottom(true);
    yesBtn.focus({ preventScroll: true });
  }

  /** A friendly problem from the helper, in a soft yellow card. */
  problem(text: string): void {
    if (this.awaitingBusy) {
      this.awaitingBusy = false;
      this.setActivity(null);
      this.updateComposer();
    }
    this.addRow(this.piaRow(notice(text)));
    this.stickToBottom(true);
  }

  showPause(until: number, text: string): void {
    if (until <= Date.now()) return;
    if (this.pause) {
      this.pause.until = until;
      this.pause.text.textContent = text;
      this.tickPause();
      return;
    }
    const textEl = h("p", { class: "pause-text" }, text);
    const countdown = h("p", { class: "pause-countdown", "aria-live": "polite" });
    const resume = h("p", { class: "pause-resume" });
    const card = h("div", { class: "pause-card" }, h("span", { class: "pause-icon" }, icon.clock()), h("div", {}, textEl, countdown, resume));
    this.pause = { until, card, text: textEl, countdown, resume, timer: setInterval(() => this.tickPause(), 5000) };
    this.addRow(card);
    this.tickPause();
    this.updateComposer();
    this.stickToBottom(true);
  }

  showRestarting(on: boolean): void {
    this.restartLine.hidden = !on;
    if (on) {
      this.awaitingBusy = false;
      this.setBusy(false);
    }
  }

  // --- internals ------------------------------------------------------------

  private tickPause(): void {
    const pause = this.pause;
    if (!pause) return;
    const now = Date.now();
    const words = countdownWords(pause.until, now);
    if (words) {
      pause.countdown.textContent = words;
      pause.resume.textContent = T.pause.resumeAt(resumeWords(pause.until, now));
      return;
    }
    clearInterval(pause.timer);
    pause.card.classList.add("pause-over");
    pause.card.replaceChildren(
      h("span", { class: "pause-icon" }, icon.check()),
      h("div", {}, h("p", { class: "pause-countdown" }, T.pause.back), h("p", { class: "pause-resume" }, T.pause.backHint)),
    );
    this.pause = null;
    this.updateComposer();
  }

  private isPaused(): boolean {
    return this.pause !== null && this.pause.until > Date.now();
  }

  private submit(): void {
    if (this.busy || this.awaitingBusy || this.preparing > 0) return;
    if (this.isPaused()) return;
    let text = this.textarea.value.trim();
    const images = this.features.photos ? this.images : [];
    if (!text && images.length === 0) {
      this.textarea.focus();
      return;
    }
    if (!text) text = T.welcome.suggestions.photo.fill;

    this.turnBubble = null;
    this.userMessage(text, images.length, images.map((i) => i.preview));
    this.stickToBottom(true);
    this.textarea.value = "";
    this.autosize();
    this.images = [];
    this.renderThumbs();
    this.awaitingBusy = true;
    this.setActivity(null);
    this.updateComposer();

    const payload = images.map(({ data, mimeType }) => ({ data, mimeType }));
    this.helper
      .send({ type: "prompt", text, ...(payload.length > 0 ? { images: payload } : {}) })
      .catch(() => this.problem(T.problem.noAnswer));
  }

  private stop(): void {
    if (!this.busy || this.stopping) return;
    this.stopping = true;
    this.updateComposer();
    void this.helper.send({ type: "stop" }).catch(() => {
      this.stopping = false;
      this.updateComposer();
    });
  }

  private updateComposer(): void {
    const working = this.busy || this.awaitingBusy;
    this.sendBtn.hidden = this.busy;
    this.stopBtn.hidden = !this.busy;
    this.stopBtn.disabled = this.stopping;
    setButtonLabel(this.stopBtn, this.stopping ? T.chat.stopping : T.chat.stop);

    const paused = this.isPaused();
    this.sendBtn.disabled = paused || working || this.preparing > 0;
    this.sendBtn.classList.toggle("is-paused", paused);
    setButtonLabel(this.sendBtn, paused ? T.composer.paused : T.composer.send);

    this.photoBtn.hidden = !this.features.photos;
    this.photoBtn.disabled = this.images.length >= MAX_IMAGES;
  }

  private autosize(): void {
    this.textarea.style.height = "auto";
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight + 4, 260)}px`;
  }

  private async addFiles(files: File[]): Promise<void> {
    if (!this.features.photos) return;
    const images = files.filter(isImage);
    if (images.length === 0) return;
    this.setComposerNote(null);
    const room = MAX_IMAGES - this.images.length - this.preparing;
    if (images.length > room) this.setComposerNote(T.composer.tooManyPhotos(MAX_IMAGES));
    for (const file of images.slice(0, Math.max(0, room))) {
      this.preparing++;
      this.updateComposer();
      this.renderThumbs();
      try {
        this.images.push(await prepareImage(file));
      } catch {
        this.setComposerNote(T.composer.photoProblem);
      } finally {
        this.preparing--;
        this.renderThumbs();
        this.updateComposer();
      }
    }
  }

  private setComposerNote(text: string | null): void {
    this.composerNote.textContent = text ?? "";
    this.composerNote.hidden = text === null;
  }

  private renderThumbs(): void {
    clear(this.thumbs);
    this.images.forEach((img, index) => {
      const remove = button(
        T.composer.removePhoto,
        () => {
          this.images = this.images.filter((i) => i.key !== img.key);
          this.renderThumbs();
          this.updateComposer();
          this.textarea.focus();
        },
        { kind: "secondary", icon: icon.close(), ariaLabel: T.composer.removePhotoLabel(index + 1), className: "thumb-remove" },
      );
      this.thumbs.append(
        h("figure", { class: "thumb" }, h("img", { src: img.preview, alt: T.composer.photoAlt(index + 1) }), remove),
      );
    });
    if (this.preparing > 0) {
      this.thumbs.append(h("div", { class: "thumb thumb-loading" }, h("span", {}, T.composer.photoPreparing)));
    }
    this.thumbs.hidden = this.images.length === 0 && this.preparing === 0;
  }

  private setupDrop(): void {
    let depth = 0;
    const hasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer?.types ?? []).includes("Files");
    this.el.addEventListener("dragenter", (ev) => {
      if (!hasFiles(ev) || !this.features.photos) return;
      ev.preventDefault();
      depth++;
      this.el.classList.add("dropping");
    });
    this.el.addEventListener("dragover", (ev) => {
      if (!hasFiles(ev) || !this.features.photos) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    });
    this.el.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.el.classList.remove("dropping");
    });
    this.el.addEventListener("drop", (ev) => {
      depth = 0;
      this.el.classList.remove("dropping");
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      if (this.features.photos) void this.addFiles(Array.from(ev.dataTransfer?.files ?? []));
    });
  }

  private renderWelcome(): void {
    const s = T.welcome.suggestions;
    const choices: { label: string; fill: string; photo?: boolean }[] = [
      s.letter,
      s.shopping,
      ...(this.features.photos ? [{ ...s.photo, photo: true }] : []),
      ...(this.features.settingsHelp ? [s.settings] : []),
    ];
    clear(this.welcome);
    this.welcome.append(
      h("div", { class: "welcome-face" }, avatar("large")),
      h("h1", { class: "welcome-title" }, T.welcome.title, h("br"), T.welcome.question),
      h("p", { class: "welcome-hint" }, T.welcome.hint),
      h(
        "div",
        { class: "suggestions" },
        choices.map((c) =>
          button(c.label, () => {
            this.textarea.value = c.fill;
            this.autosize();
            this.textarea.focus();
            this.textarea.setSelectionRange(c.fill.length, c.fill.length);
            if (c.photo) this.fileInput.click();
          }, { kind: "suggestion" }),
        ),
      ),
    );
    this.updateWelcome();
  }

  private updateWelcome(): void {
    this.welcome.hidden = this.rows > 0;
  }

  private addRow(row: HTMLElement): void {
    this.inner.insertBefore(row, this.activity);
    this.rows++;
    this.updateWelcome();
  }

  private userMessage(text: string, imageCount: number, previews: string[]): void {
    const body = h("div", { class: "bubble bubble-user" });
    if (previews.length > 0) {
      body.append(h("div", { class: "bubble-photos" }, previews.map((src, i) => h("img", { src, alt: T.composer.photoAlt(i + 1) }))));
    } else if (imageCount > 0) {
      body.append(h("p", { class: "photo-count" }, icon.camera(), T.chat.photosAttached(imageCount)));
    }
    body.append(h("p", { class: "user-text" }, text));
    this.addRow(h("div", { class: "msg msg-user" }, h("div", { class: "msg-body" }, h("div", { class: "msg-name" }, T.chat.you), body)));
  }

  private piaRow(content: HTMLElement): HTMLElement {
    return h(
      "div",
      { class: "msg msg-pia" },
      h("div", { class: "msg-avatar" }, avatar()),
      h("div", { class: "msg-body" }, h("div", { class: "msg-name" }, T.chat.pia), content),
    );
  }

  private piaBubble(): PiaBubble {
    const md = h("div", { class: "md" });
    const files = h("div", { class: "file-cards" });
    const row = this.piaRow(h("div", { class: "bubble bubble-pia" }, md, files));
    this.addRow(row);
    return { row, md, files, text: "", frame: null, streaming: false };
  }

  private finishBubble(bubble: PiaBubble): void {
    if (bubble.frame !== null) cancelAnimationFrame(bubble.frame);
    bubble.frame = null;
    bubble.streaming = false;
    bubble.row.classList.remove("streaming");
    const stick = this.nearBottom();
    bubble.md.replaceChildren(renderMarkdown(bubble.text));
    if (!bubble.text.trim() && bubble.files.childElementCount === 0) {
      bubble.row.remove();
      this.rows--;
      this.updateWelcome();
      if (this.turnBubble === bubble) this.turnBubble = null;
    }
    this.log.removeAttribute("aria-busy");
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }

  private nearBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 160;
  }

  private stickToBottom(force = false): void {
    if (force || this.nearBottom()) {
      requestAnimationFrame(() => (this.log.scrollTop = this.log.scrollHeight));
    }
  }
}
