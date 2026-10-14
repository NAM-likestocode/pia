// Pia's window: wires the helper connection to the screens.

import { createTransport, Helper } from "./bridge";
import { ChatView } from "./chat";
import { problemText } from "./common";
import { button, h } from "./dom";
import { HelperSettingsView } from "./helper-settings";
import { avatar, icon } from "./icons";
import { FilesView, HistoryView } from "./panels";
import type { HelperMessage, Status } from "./protocol";
import { T } from "./strings";
import { startUpdates } from "./updates";

type View = "loading" | "signedOut" | "chat" | "files" | "history" | "helper";

async function main(): Promise<void> {
  document.title = T.appName;
  const root = document.getElementById("app")!;
  const helper = new Helper(await createTransport());

  let status: Status | null = null;
  let view: View = "loading";
  let busy = false;
  let started = false;

  // --- screens ---------------------------------------------------------------
  const chat = new ChatView(helper);
  const files = new FilesView(helper, () => show("chat"));
  const history = new HistoryView(helper, () => show("chat"), openChat);
  const settings = new HelperSettingsView({
    helper,
    pinSet: () => status?.pinSet ?? true,
    workspace: () => status?.workspace ?? "",
    onLeave: (locked) => {
      if (locked) refreshStatus();
      show(status && !status.signedIn ? "signedOut" : "chat");
    },
  });

  const loading = h(
    "section",
    { class: "view center-view" },
    h("div", { class: "center-card" }, avatar("large"), h("p", { class: "loading-line" }, T.loading)),
  );
  const helperLink = (extra = "") =>
    button(T.footer.helperLink, () => show("helper"), { kind: "link", className: extra });
  const signedOut = h(
    "section",
    { class: "view center-view", hidden: true },
    h(
      "div",
      { class: "center-card" },
      avatar("large"),
      h("h1", {}, T.signedOut.title),
      h("p", {}, T.signedOut.text),
      helperLink("signed-out-link"),
    ),
  );

  // --- top bar -----------------------------------------------------------------
  const newChatBtn = button(T.top.newChat, () => void newChat(), { kind: "nav", icon: icon.plus() });
  const filesBtn = button(T.top.files, () => show("files"), { kind: "nav", icon: icon.folder() });
  const historyBtn = button(T.top.history, () => show("history"), { kind: "nav", icon: icon.clock() });
  const nav = h("nav", { class: "top-nav", "aria-label": T.appName }, newChatBtn, filesBtn, historyBtn);
  const topbar = h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand" }, avatar(), h("span", { class: "brand-name" }, T.appName)),
    nav,
  );
  const footer = h("footer", { class: "footer" }, helperLink());

  const updateSlot = h("div", { class: "update-slot" });
  const cover = h("div", { class: "update-cover", hidden: true });
  const main = h("main", { class: "main" }, loading, signedOut, chat.el, files.el, history.el, settings.el);
  root.replaceChildren(updateSlot, topbar, main, footer, cover);

  // --- navigation --------------------------------------------------------------
  function show(next: View): void {
    if (view === "helper" && next !== "helper") settings.close();
    view = next;
    loading.hidden = next !== "loading";
    signedOut.hidden = next !== "signedOut";
    chat.el.hidden = next !== "chat";
    files.el.hidden = next !== "files";
    history.el.hidden = next !== "history";
    settings.el.hidden = next !== "helper";

    const navVisible = next === "chat" || next === "files" || next === "history";
    nav.hidden = !navVisible;
    footer.hidden = next === "helper" || next === "signedOut" || next === "loading";
    filesBtn.toggleAttribute("aria-current", next === "files");
    historyBtn.toggleAttribute("aria-current", next === "history");
    if (next === "files") {
      void files.load();
      files.focus();
    } else if (next === "history") {
      void history.load();
      history.focus();
    } else if (next === "helper") {
      settings.open();
    } else if (next === "chat") {
      chat.focusInput();
    }
  }

  function setBusy(next: boolean): void {
    busy = next;
    chat.setBusy(next);
    history.setBusy(next);
    newChatBtn.disabled = next;
    newChatBtn.title = next ? T.top.waitUntilDone : "";
  }

  async function newChat(): Promise<void> {
    if (busy) return;
    newChatBtn.disabled = true;
    try {
      const answer = await helper.request({ type: "new_chat" });
      if (answer.type === "chat") {
        if (status) status.chatId = answer.chatId;
        chat.reset(answer.messages);
      } else {
        chat.problem(problemText(answer));
      }
    } catch {
      chat.problem(T.problem.noAnswer);
    } finally {
      newChatBtn.disabled = busy;
    }
    show("chat");
  }

  /** Opens an earlier conversation. Returns a problem text or null. */
  async function openChat(chatId: string): Promise<string | null> {
    try {
      const answer = await helper.request({ type: "open_chat", chatId });
      if (answer.type !== "chat") return problemText(answer);
      if (status) status.chatId = answer.chatId;
      chat.reset(answer.messages);
      show("chat");
      return null;
    } catch {
      return T.problem.noAnswer;
    }
  }

  // --- status ------------------------------------------------------------------
  function applyStatus(next: Status): void {
    const previous = status;
    status = next;
    chat.setFeatures(next.features);
    if (next.busy !== busy) setBusy(next.busy);
    if (next.pausedUntil && next.pausedUntil > Date.now()) chat.showPause(next.pausedUntil, T.pause.defaultText);

    if (!started) {
      started = true;
      void start(next);
      return;
    }
    if (previous && previous.signedIn !== next.signedIn && view !== "helper") {
      show(next.signedIn ? "chat" : "signedOut");
    }
  }

  async function start(first: Status): Promise<void> {
    if (first.chatId) {
      try {
        const answer = await helper.request({ type: "open_chat", chatId: first.chatId });
        if (answer.type === "chat") chat.reset(answer.messages);
      } catch {
        // Start with an empty conversation instead.
      }
    }
    show(first.signedIn ? "chat" : "signedOut");
  }

  function refreshStatus(): void {
    helper.request({ type: "status" }).catch(() => undefined);
  }

  // --- helper messages -------------------------------------------------------
  helper.on((message: HelperMessage) => {
    switch (message.type) {
      case "ready":
        chat.showRestarting(false);
        applyStatus(message.status);
        break;
      case "status":
        applyStatus(message.status);
        break;
      case "busy":
        setBusy(message.busy);
        break;
      case "reply_start":
        chat.replyStart();
        break;
      case "reply_delta":
        chat.replyDelta(message.text);
        break;
      case "reply_end":
        chat.replyEnd(message.text);
        break;
      case "activity":
        chat.setActivity(message.text);
        break;
      case "activity_end":
        chat.setActivity(null);
        break;
      case "file_made":
        chat.fileMade(message.name, message.kind);
        break;
      case "confirm_request":
        chat.confirmRequest(message.requestId, message.title, message.points);
        if (view !== "chat" && view !== "helper") show("chat");
        break;
      case "paused":
        if (status) status.pausedUntil = message.until;
        chat.showPause(message.until, message.text || T.pause.defaultText);
        break;
      case "problem":
        // Problems that answer a request are shown where the request came from.
        if (!message.replyTo) chat.problem(message.text);
        break;
      default:
        break;
    }
  });

  helper.onExit(() => {
    setBusy(false);
    chat.showRestarting(true);
  });

  startUpdates(updateSlot, cover);

  // The helper may have said "ready" before the window was listening.
  const askStatus = async (): Promise<void> => {
    while (!started) {
      try {
        await helper.request({ type: "status" }, 5_000);
      } catch {
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  };
  void askStatus();
}

void main();
