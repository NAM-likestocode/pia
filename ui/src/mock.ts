// A pretend helper for the plain browser (`npx vite`). It follows
// docs/protocol.md closely so the window can be tried, tested and
// screenshotted without Tauri or a ChatGPT login.
//
// The German sentences below stand in for what the real helper sends;
// they are not window strings.
//
// Try these in the address bar:
//   ?mock=signedout   not signed in yet
//   ?mock=nopin       no PIN set yet
//   ?mock=paused      start in a usage pause
//   ?mock=required    the new version is required
//   ?mock=noupdate    no new version
//   ?mock=nophotos    photos switched off
// Prompts: "groß" asks before a big job, "limit" starts a pause,
// "problem" shows a problem, "liste" makes a table.
// In the console: piaMock.crash() simulates a helper restart.

import type { Transport } from "./bridge";
import { mockFlags } from "./flags";
import type {
  AdminSettings,
  ChatMessage,
  FileItem,
  HelperMessage,
  Status,
  VersionItem,
  WindowMessage,
} from "./protocol";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type MockChat = { id: string; title: string; updatedAt: number; messages: ChatMessage[] };

class Cancelled extends Error {}

export function createMockTransport(): Transport {
  const flags = mockFlags();
  const now = Date.now();
  const listeners: ((m: HelperMessage) => void)[] = [];
  const exitListeners: (() => void)[] = [];

  const settings: AdminSettings = {
    model: "gpt-5.5",
    thinking: "low",
    features: {
      documents: true,
      spreadsheets: true,
      webpages: true,
      photos: !flags.has("nophotos"),
      settingsHelp: true,
    },
    limits: { filesPerRequest: 3, stepsPerRequest: 20, bigFilesPerRequest: 15, bigStepsPerRequest: 80, maxFileKB: 5000 },
  };

  const status: Status = {
    signedIn: !flags.has("signedout"),
    busy: false,
    chatId: null,
    pinSet: !flags.has("nopin"),
    pausedUntil: flags.has("paused") ? now + 2 * HOUR + 15 * MINUTE : null,
    workspace: "/home/oma/Dokumente/Pia",
    features: settings.features,
  };

  let pin: string | null = status.pinSet ? "1234" : null;
  let unlockedAt = 0;
  let idCounter = 0;
  const newId = (prefix: string) => `${prefix}${++idCounter}`;

  const chats = new Map<string, MockChat>();
  const seedChat = (title: string, ago: number, messages: ChatMessage[]) => {
    const id = newId("c");
    chats.set(id, { id, title, updatedAt: now - ago, messages });
  };
  seedChat("Rezept für Apfelkuchen", 20 * DAY, [
    { role: "user", text: "Hast du ein einfaches Rezept für Apfelkuchen?", imageCount: 0 },
    {
      role: "pia",
      text: "Sehr gern! Hier ist ein einfaches Rezept:\n\n1. Ofen auf **180 Grad** vorheizen.\n2. 200 g Mehl, 100 g Zucker, 100 g Butter und 1 Ei verkneten.\n3. Äpfel schälen, in Spalten schneiden und darauflegen.\n4. Etwa **40 Minuten** backen.\n\nGuten Appetit!",
      files: [],
    },
  ]);
  seedChat("Foto vom Enkel", 3 * DAY, [
    { role: "user", text: "Was ist auf diesem Foto?", imageCount: 1 },
    {
      role: "pia",
      text: "Auf dem Foto sieht man einen kleinen Jungen im Garten. Er lacht und hält einen roten Ball.",
      files: [],
    },
  ]);
  seedChat("Brief an die Krankenkasse", DAY + 2 * HOUR, [
    { role: "user", text: "Bitte schreib einen Brief an meine Krankenkasse. Ich möchte eine neue Karte.", imageCount: 0 },
    {
      role: "pia",
      text: "Gern! Ich habe dir einen Brief geschrieben. Du kannst ihn öffnen, ansehen und ausdrucken.",
      files: [{ name: "Brief an die Krankenkasse.docx", kind: "brief" }],
    },
  ]);

  const files: FileItem[] = [
    { name: "Einkaufsliste.xlsx", size: 9_400, modifiedAt: now - 40 * MINUTE, kind: "tabelle" },
    { name: "Brief an die Krankenkasse.docx", size: 24_800, modifiedAt: now - DAY - 2 * HOUR, kind: "brief" },
    { name: "Rezepte.html", size: 320_000, modifiedAt: now - 6 * DAY, kind: "webseite" },
    { name: "Einladung zum Geburtstag.pdf", size: 1_310_000, modifiedAt: now - 12 * DAY, kind: "pdf" },
    { name: "Enkel im Garten.jpg", size: 2_450_000, modifiedAt: now - 40 * DAY, kind: "bild" },
  ];

  const versions: VersionItem[] = [
    {
      id: "v2",
      name: "Brief an die Krankenkasse.docx",
      savedAt: now - DAY - 2 * HOUR,
      why: "Bevor Pia den Brief geändert hat",
    },
    { id: "v1", name: "Einkaufsliste.xlsx", savedAt: now - 3 * DAY, why: "Bevor Pia die Liste neu gemacht hat" },
  ];

  const emit = (message: HelperMessage) => {
    const copy = JSON.parse(JSON.stringify(message)) as HelperMessage;
    setTimeout(() => listeners.forEach((cb) => cb(copy)), 0);
  };

  // --- the running job -------------------------------------------------
  let job: { cancelled: boolean } | null = null;
  const confirmWaiters = new Map<string, (yes: boolean) => void>();

  const sleep = (ms: number, token: { cancelled: boolean }) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => (token.cancelled ? reject(new Cancelled()) : resolve()), ms),
    );

  const setBusy = (busy: boolean) => {
    status.busy = busy;
    emit({ type: "busy", busy });
  };

  const currentChat = (): MockChat => {
    let chat = status.chatId ? chats.get(status.chatId) : undefined;
    if (!chat) {
      chat = { id: newId("c"), title: "", updatedAt: Date.now(), messages: [] };
      chats.set(chat.id, chat);
      status.chatId = chat.id;
    }
    return chat;
  };

  async function streamReply(token: { cancelled: boolean }, text: string, made: { name: string; kind: string; size: number }[], chat: MockChat) {
    emit({ type: "reply_start" });
    let sent = "";
    const words = text.split(/(?<=\s)/);
    const madeAt = Math.floor(words.length * 0.55);
    const pia: ChatMessage = { role: "pia", text: "", files: [] };
    try {
      for (let i = 0; i < words.length; i++) {
        if (i === madeAt && made.length > 0) {
          for (const file of made) {
            emit({ type: "activity", text: `Ich speichere „${file.name}“ …` });
            await sleep(900, token);
            const existing = files.findIndex((f) => f.name === file.name);
            const item: FileItem = { name: file.name, kind: file.kind, size: file.size, modifiedAt: Date.now() };
            if (existing >= 0) files.splice(existing, 1);
            files.unshift(item);
            pia.files.push({ name: file.name, kind: file.kind });
            emit({ type: "file_made", name: file.name, kind: file.kind });
          }
          emit({ type: "activity_end" });
        }
        const word = words[i] ?? "";
        sent += word;
        emit({ type: "reply_delta", text: word });
        await sleep(25 + Math.random() * 55, token);
      }
    } finally {
      pia.text = sent;
      emit({ type: "reply_end", text: sent });
      chat.messages.push(pia);
      chat.updatedAt = Date.now();
    }
  }

  async function runPrompt(text: string, imageCount: number) {
    const token = { cancelled: false };
    job = token;
    const chat = currentChat();
    chat.messages.push({ role: "user", text, imageCount });
    if (!chat.title) chat.title = text.length > 42 ? `${text.slice(0, 40).trim()} …` : text;
    chat.updatedAt = Date.now();
    const lower = text.toLowerCase();
    setBusy(true);
    try {
      emit({ type: "activity", text: "Ich lese deine Nachricht …" });
      await sleep(900, token);

      if (lower.includes("problem")) {
        emit({ type: "activity_end" });
        emit({ type: "problem", text: "Das hat leider nicht geklappt. Versuch es gleich nochmal." });
        return;
      }

      if (lower.includes("limit")) {
        emit({ type: "activity_end" });
        const until = Date.now() + 2 * HOUR + 15 * MINUTE;
        status.pausedUntil = until;
        emit({ type: "paused", until, text: "Pia hat heute schon viel gearbeitet und braucht eine Pause." });
        return;
      }

      if (lower.includes("groß")) {
        emit({ type: "activity", text: "Ich überlege, wie viel Arbeit das ist …" });
        await sleep(1200, token);
        const requestId = newId("r");
        emit({
          type: "confirm_request",
          requestId,
          title: "Das ist eine größere Aufgabe. Soll ich sie machen?",
          points: [
            "Ich mache 12 neue Briefe, für jeden Gast einen.",
            "Das dauert ungefähr 5 Minuten.",
            "Du findest alles danach unter „Meine Dateien“.",
          ],
        });
        emit({ type: "activity", text: "Ich warte auf deine Antwort …" });
        const yes = await new Promise<boolean>((resolve) => {
          confirmWaiters.set(requestId, resolve);
        });
        confirmWaiters.delete(requestId);
        if (token.cancelled) throw new Cancelled();
        emit({ type: "activity", text: yes ? "Ich schreibe die Briefe …" : "Alles klar …" });
        await sleep(1000, token);
        emit({ type: "activity_end" });
        if (yes) {
          await streamReply(
            token,
            "Fertig! Ich habe **12 Einladungen** geschrieben. Hier ist die erste, die anderen findest du unter „Meine Dateien“.",
            [{ name: "Einladung an Familie Weber.docx", kind: "brief", size: 21_000 }],
            chat,
          );
        } else {
          await streamReply(token, "Gut, dann lasse ich das. Sag mir einfach, wenn du etwas Kleineres möchtest.", [], chat);
        }
        return;
      }

      emit({ type: "activity", text: "Ich denke nach …" });
      await sleep(1100, token);
      emit({ type: "activity_end" });

      if (imageCount > 0) {
        await streamReply(
          token,
          "Auf dem Foto sehe ich einen **Garten im Sommer**. Vorne stehen rote Rosen, hinten ist ein kleiner Holzzaun.\n\nMöchtest du noch etwas dazu wissen?",
          [],
          chat,
        );
      } else if (lower.includes("liste") || lower.includes("einkauf")) {
        await streamReply(
          token,
          "Gern! Ich habe dir eine Einkaufsliste gemacht:\n\n- Milch\n- Brot\n- Butter\n- Äpfel\n- Kaffee\n\nDie Liste ist auch als Tabelle gespeichert. Du kannst sie öffnen und ausdrucken.",
          [{ name: "Einkaufsliste.xlsx", kind: "tabelle", size: 9_800 }],
          chat,
        );
      } else if (lower.includes("einstell") || lower.includes("computer")) {
        await streamReply(
          token,
          "Das machen wir zusammen, Schritt für Schritt:\n\n1. Klick unten links auf das **Fenster-Zeichen**.\n2. Klick auf **Einstellungen**.\n3. Wähle **Anzeige**.\n\nMehr dazu steht auch auf [dieser Seite](https://example.com). Sag mir, wenn du angekommen bist!",
          [],
          chat,
        );
      } else {
        await streamReply(
          token,
          "Gern! Ich habe dir einen Brief geschrieben.\n\nEr ist **freundlich** und kurz. Tipp unten auf **Öffnen**, dann kannst du ihn ansehen und ausdrucken.\n\n- Oben stehen deine Adresse und das Datum.\n- Dann kommt dein Anliegen in zwei Sätzen.\n- Am Ende steht ein lieber Gruß.",
          [{ name: "Brief an die Stadtwerke.docx", kind: "brief", size: 23_500 }],
          chat,
        );
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) throw error;
    } finally {
      emit({ type: "activity_end" });
      if (job === token) job = null;
      setBusy(false);
    }
  }

  // --- admin -----------------------------------------------------------
  const adminOpen = () => Date.now() - unlockedAt < 15 * MINUTE;
  const adminSettingsReply = (replyTo: string): HelperMessage => ({
    type: "admin_settings",
    replyTo,
    settings,
    signedIn: status.signedIn,
    models: ["gpt-5.5", "gpt-5.5-mini", "gpt-5.4"],
  });

  function handle(message: WindowMessage) {
    const later = (ms: number, m: HelperMessage) => setTimeout(() => emit(m), ms);
    switch (message.type) {
      case "status":
        later(80, { type: "status", replyTo: message.id, status });
        break;
      case "prompt":
        if (status.pausedUntil && status.pausedUntil > Date.now()) {
          later(200, { type: "paused", until: status.pausedUntil, text: "Pia macht gerade noch Pause." });
          break;
        }
        if (!status.signedIn) {
          later(200, { type: "problem", text: "Pia ist noch nicht eingerichtet. Bitte frag deinen Sohn." });
          break;
        }
        if (status.busy) {
          later(100, { type: "problem", text: "Pia ist gerade noch beschäftigt. Warte bitte kurz." });
          break;
        }
        void runPrompt(message.text, message.images?.length ?? 0);
        break;
      case "stop":
        if (job) {
          job.cancelled = true;
          for (const resolve of confirmWaiters.values()) resolve(false);
        }
        break;
      case "confirm_answer":
        confirmWaiters.get(message.requestId)?.(message.yes);
        break;
      case "new_chat": {
        const chat: MockChat = { id: newId("c"), title: "", updatedAt: Date.now(), messages: [] };
        chats.set(chat.id, chat);
        status.chatId = chat.id;
        later(150, { type: "chat", replyTo: message.id, chatId: chat.id, messages: [] });
        break;
      }
      case "list_chats": {
        const items = [...chats.values()]
          .filter((c) => c.messages.length > 0)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
        later(250, { type: "chats", replyTo: message.id, items });
        break;
      }
      case "open_chat": {
        const chat = chats.get(message.chatId);
        if (!chat) {
          later(150, { type: "problem", replyTo: message.id, text: "Dieses Gespräch gibt es nicht mehr." });
          break;
        }
        status.chatId = chat.id;
        later(250, { type: "chat", replyTo: message.id, chatId: chat.id, messages: chat.messages });
        break;
      }
      case "list_files":
        later(300, { type: "files", replyTo: message.id, items: files });
        break;
      case "open_file":
        if (files.some((f) => f.name === message.name)) later(400, { type: "ok", replyTo: message.id });
        else later(400, { type: "problem", replyTo: message.id, text: "Diese Datei finde ich nicht mehr." });
        break;
      case "open_folder":
        later(300, { type: "ok", replyTo: message.id });
        break;
      case "list_versions":
        later(300, { type: "versions", replyTo: message.id, items: versions });
        break;
      case "restore_version":
        later(700, { type: "ok", replyTo: message.id });
        break;
      case "admin_unlock":
        if (pin !== null && message.pin === pin) {
          unlockedAt = Date.now();
          later(300, { type: "admin", replyTo: message.id, unlocked: true });
        } else {
          later(500, { type: "admin", replyTo: message.id, unlocked: false, text: "Die PIN stimmt nicht." });
        }
        break;
      case "admin_set_pin":
        if ((pin === null && message.pin === "") || (pin !== null && message.pin === pin)) {
          pin = message.newPin;
          status.pinSet = true;
          unlockedAt = Date.now();
          later(300, { type: "admin", replyTo: message.id, unlocked: true });
        } else {
          later(400, { type: "admin", replyTo: message.id, unlocked: false, text: "Die alte PIN stimmt nicht." });
        }
        break;
      case "admin_lock":
        unlockedAt = 0;
        break;
      case "admin_settings":
      case "admin_save":
      case "admin_sign_in":
      case "admin_sign_out":
        if (!adminOpen()) {
          later(200, { type: "problem", replyTo: message.id, text: "Bitte gib zuerst die PIN ein." });
          break;
        }
        if (message.type === "admin_save") {
          Object.assign(settings, message.settings);
          status.features = settings.features;
        }
        if (message.type === "admin_sign_out") status.signedIn = false;
        if (message.type === "admin_sign_in") {
          later(900, { type: "sign_in_code", replyTo: message.id, code: "ABCD-1234", url: "https://auth.openai.com/codex/device" });
          setTimeout(() => {
            status.signedIn = true;
            emit({ type: "sign_in_done", replyTo: message.id, ok: true, text: "Anmeldung hat geklappt." });
          }, 7000);
          break;
        }
        later(250, adminSettingsReply(message.id));
        break;
    }
  }

  const transport: Transport = {
    mock: true,
    async send(message) {
      handle(JSON.parse(JSON.stringify(message)) as WindowMessage);
    },
    onMessage(callback) {
      listeners.push(callback);
    },
    onExit(callback) {
      exitListeners.push(callback);
    },
  };

  const crash = () => {
    if (job) job.cancelled = true;
    job = null;
    status.busy = false;
    exitListeners.forEach((cb) => cb());
    setTimeout(() => emit({ type: "ready", status }), 2500);
  };
  (window as unknown as { piaMock: unknown }).piaMock = { crash, status, settings };

  setTimeout(() => emit({ type: "ready", status }), 250);
  return transport;
}
