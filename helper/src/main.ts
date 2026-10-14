// Entry point of the helper executable. Reads one JSON message per line from
// stdin and writes one per line to stdout (see docs/protocol.md).

import { createInterface } from "node:readline";
import { type Outgoing, Pia } from "./pia.ts";
import { S } from "./strings.ts";

// stdout belongs to the protocol; anything else goes to stderr.
console.log = console.error;
console.info = console.error;

const args = parseArgs(process.argv.slice(2));
if (!args["data-dir"] || !args.workspace) {
  console.error("usage: pia-helper --data-dir <dir> --workspace <dir>");
  process.exit(2);
}

function send(message: Outgoing): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let pia: Pia | undefined;
const queue: Record<string, any>[] = [];

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message: Record<string, any>;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!pia) {
    if (message.type === "boot") void boot(message);
    else queue.push(message);
    return;
  }
  void handle(pia, message);
});
lines.on("close", () => process.exit(0));

async function boot(message: Record<string, any>): Promise<void> {
  if (typeof message.key !== "string" || !/^[0-9a-f]{64}$/i.test(message.key)) {
    console.error("boot: invalid key");
    process.exit(2);
  }
  const instance = new Pia({
    dataDir: args["data-dir"],
    workspace: args.workspace,
    key: Buffer.from(message.key, "hex"),
    emit: send,
  });
  await instance.start();
  pia = instance;
  for (const queued of queue.splice(0)) void handle(instance, queued);
}

async function handle(pia: Pia, message: Record<string, any>): Promise<void> {
  const replyTo = typeof message.id === "string" ? message.id : undefined;
  try {
    switch (message.type) {
      case "status":
        return send({ type: "status", replyTo, status: await pia.status() });
      case "prompt":
        return await pia.prompt(String(message.text ?? ""), images(message.images));
      case "stop":
        return await pia.stop();
      case "confirm_answer":
        return pia.answerConfirmation(String(message.requestId), message.yes === true);
      case "new_chat":
        await pia.openChat(undefined);
        return send({ type: "chat", replyTo, chatId: (await pia.status()).chatId, messages: [] });
      case "open_chat": {
        const messages = await pia.openChat(String(message.chatId));
        return send({ type: "chat", replyTo, chatId: message.chatId, messages });
      }
      case "list_chats":
        return send({ type: "chats", replyTo, items: await pia.listChats() });
      case "list_files":
        return send({ type: "files", replyTo, items: pia.files() });
      case "open_file":
        return send(pia.openFile(String(message.name)) ? { type: "ok", replyTo } : { type: "problem", replyTo, text: S.problem.cannotOpen });
      case "open_folder":
        pia.openFolder();
        return send({ type: "ok", replyTo });
      case "list_versions":
        return send({ type: "versions", replyTo, items: pia.versions() });
      case "restore_version":
        return send(pia.restore(String(message.versionId)) ? { type: "ok", replyTo } : { type: "problem", replyTo, text: S.problem.versionMissing });
      case "admin_unlock": {
        const result = pia.unlock(String(message.pin ?? ""));
        return send({ type: "admin", replyTo, unlocked: result.ok, text: result.text });
      }
      case "admin_set_pin": {
        const result = pia.setPin(String(message.pin ?? ""), String(message.newPin ?? ""));
        return send({ type: "admin", replyTo, unlocked: result.ok, text: result.text });
      }
      case "admin_lock":
        return pia.lock();
    }
    if (!message.type?.startsWith("admin_")) return;
    if (!pia.unlocked) return send({ type: "problem", replyTo, text: S.helper.locked });
    switch (message.type) {
      case "admin_settings":
        return send({ type: "admin_settings", replyTo, ...(await pia.adminSettings()) });
      case "admin_save":
        await pia.saveSettings(message.settings ?? {});
        return send({ type: "admin_settings", replyTo, ...(await pia.adminSettings()) });
      case "admin_sign_in":
        try {
          await pia.signInWithChatGpt((code, url) => send({ type: "sign_in_code", replyTo, code, url }));
          send({ type: "sign_in_done", replyTo, ok: true, text: S.helper.signedIn });
          send({ type: "status", status: await pia.status() });
        } catch (error) {
          send({ type: "sign_in_done", replyTo, ok: false, text: S.helper.signInFailed(error instanceof Error ? error.message : String(error)) });
        }
        return;
      case "admin_sign_out":
        await pia.signOut();
        send({ type: "admin_settings", replyTo, ...(await pia.adminSettings()) });
        return send({ type: "status", status: await pia.status() });
    }
  } catch (error) {
    console.error(error);
    const text = message.type === "open_chat" ? S.problem.chatMissing : error instanceof Error && error.message === "busy" ? S.problem.busy : S.problem.general;
    send({ type: "problem", replyTo, text });
  }
}

function images(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((i) => typeof i?.data === "string" && /^image\/(png|jpeg|gif|webp)$/.test(i?.mimeType) && i.data.length < 12_000_000)
    .map((i) => ({ type: "image" as const, data: i.data as string, mimeType: i.mimeType as string }));
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && argv[i + 1] !== undefined) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}
