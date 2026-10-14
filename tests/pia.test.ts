import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import { type Outgoing, Pia } from "../helper/src/pia.ts";

let pia: Pia;
let sent: Outgoing[];
let faux: ReturnType<typeof fauxProvider>;

async function makePia(): Promise<Pia> {
  const base = mkdtempSync(path.join(os.tmpdir(), "pia-e2e-"));
  faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", input: ["text", "image"] }], tokensPerSecond: 0 });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  sent = [];
  const instance = new Pia({
    dataDir: path.join(base, "data"),
    workspace: path.join(base, "Pia"),
    key: Buffer.alloc(32, 1),
    emit: (m) => sent.push(m),
    modelRuntime: runtime,
    provider: "faux",
  });
  await instance.start();
  return instance;
}

const of = (type: string) => sent.filter((m) => m.type === type);

beforeEach(async () => {
  pia = await makePia();
});

describe("Pia", () => {
  it("gives the model exactly Pia's tools and nothing else", () => {
    expect(pia.activeTools().sort()).toEqual(
      [
        "ask_for_bigger_job",
        "computer_info",
        "create_document",
        "create_spreadsheet",
        "create_webpage",
        "edit_file",
        "list_files",
        "list_older_versions",
        "open_file",
        "open_settings_page",
        "read_file",
        "restore_older_version",
        "write_text_file",
      ].sort(),
    );
  });

  it("writes a letter and tells the window about it in plain words", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("create_document", { name: "Brief an Anna.docx", markdown: "Liebe Anna," })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Fertig! Dein Brief heißt „Brief an Anna.docx“.")]),
    ]);
    await pia.prompt("Schreib einen Brief an Anna", []);
    expect(of("file_made")).toEqual([{ type: "file_made", name: "Brief an Anna.docx", kind: "brief" }]);
    expect(of("activity")[0]).toMatchObject({ text: "Ich schreibe den Brief …" });
    expect(of("reply_end").at(-1)).toMatchObject({ text: expect.stringContaining("Fertig!") });
    expect(of("busy").map((m) => m.busy)).toEqual([true, false]);
    expect(pia.files().map((f) => f.name)).toEqual(["Brief an Anna.docx"]);

    const transcript = pia.transcript();
    expect(transcript[0]).toMatchObject({ role: "user", text: "Schreib einen Brief an Anna" });
    expect(transcript[1]).toMatchObject({ role: "pia", files: [{ name: "Brief an Anna.docx" }] });
  });

  it("refuses work beyond the limit until she says yes", async () => {
    const calls = Array.from({ length: 4 }, (_, i) => fauxToolCall("write_text_file", { name: `n${i}.txt`, content: "x" }));
    faux.setResponses([
      fauxAssistantMessage(calls, { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Ich habe drei gemacht.")]),
    ]);
    await pia.prompt("Mach vier Notizen", []);
    expect(pia.files()).toHaveLength(3);
  });

  it("asks the big-job question and continues after yes", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("ask_for_bigger_job", { title: "Soll ich 5 Seiten bauen?", points: ["5 Seiten"] })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        Array.from({ length: 5 }, (_, i) => fauxToolCall("write_text_file", { name: `s${i}.txt`, content: "x" })),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Fertig.")]),
    ]);
    const running = pia.prompt("Bau mir was Großes", []);
    await waitFor(() => of("confirm_request").length > 0);
    const question = of("confirm_request")[0];
    expect(question).toMatchObject({ title: "Soll ich 5 Seiten bauen?", points: ["5 Seiten"] });
    pia.answerConfirmation(String(question.requestId), true);
    await running;
    expect(pia.files()).toHaveLength(5);
  });

  it("says no politely when the model is told no", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("ask_for_bigger_job", { title: "Groß?", points: [] })], { stopReason: "toolUse" }),
      (context) => {
        const last = JSON.stringify(context.messages.at(-1));
        return fauxAssistantMessage([fauxText(last.includes("Nein gesagt") ? "Gut, dann klein." : "??")]);
      },
    ]);
    const running = pia.prompt("Groß", []);
    await waitFor(() => of("confirm_request").length > 0);
    pia.answerConfirmation(String(of("confirm_request")[0].requestId), false);
    await running;
    expect(of("reply_end").at(-1)).toMatchObject({ text: "Gut, dann klein." });
  });

  it("does not talk to ChatGPT while paused and shows when it is back", async () => {
    pia.config.update({ pausedUntil: Date.now() + 90 * 60_000 });
    await pia.prompt("Hallo", []);
    expect(faux.state.callCount).toBe(0);
    expect(of("paused")[0]).toMatchObject({ text: expect.stringMatching(/In einer Stunde und (29|30) Minuten bin ich wieder da/) });
  });

  it("lists and reopens earlier conversations", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Hallo!")])]);
    await pia.prompt("Guten Morgen", []);
    const first = (await pia.status()).chatId;
    await pia.openChat(undefined);
    const chats = await pia.listChats();
    expect(chats.map((c) => c.title)).toContain("Guten Morgen");
    const messages = await pia.openChat(first!);
    expect(messages.map((m) => m.text)).toEqual(["Guten Morgen", "Hallo!"]);
  });

  it("protects the helper settings with a PIN", () => {
    expect(pia.unlocked).toBe(false);
    expect(pia.setPin("", "12").ok).toBe(false);
    expect(pia.setPin("", "4711").ok).toBe(true);
    pia.lock();
    expect(pia.unlock("0000").ok).toBe(false);
    expect(pia.unlock("4711").ok).toBe(true);
    expect(pia.unlocked).toBe(true);
  });

  it("stops guessing PINs after too many tries", () => {
    pia.setPin("", "4711");
    pia.lock();
    for (let i = 0; i < 5; i++) pia.unlock("0000");
    expect(pia.unlock("4711").ok).toBe(false);
  });
});

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("friendlyError", async () => {
  const { friendlyError } = await import("../helper/src/pia.ts");
  it.each([
    ["401 Unauthorized", "angemeldet"],
    ["Your refresh token has expired", "angemeldet"],
    ["fetch failed: getaddrinfo ENOTFOUND chatgpt.com", "Internet"],
    ["context_length_exceeded: too many tokens", "schiefgegangen"],
    ["something odd", "schiefgegangen"],
  ])("%s", (error, expected) => {
    expect(friendlyError(new Error(error))).toContain(expected);
  });
});

describe("bubbles", () => {
  it("does not open empty bubbles for tool-only steps", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("list_files", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Der Ordner ist leer.")]),
    ]);
    await pia.prompt("Was habe ich?", []);
    expect(of("reply_start")).toHaveLength(1);
    expect(of("reply_end")).toEqual([{ type: "reply_end", text: "Der Ordner ist leer." }]);
  });
});

describe("start-up", () => {
  it("reopening the fresh current conversation is not a problem", async () => {
    const { chatId } = await pia.status();
    await expect(pia.openChat(chatId!)).resolves.toEqual([]);
  });
});
