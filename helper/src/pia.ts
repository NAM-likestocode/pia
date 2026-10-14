// Pia's core: one pi session at a time, only Pia's own tools, and every event
// translated into the plain messages described in docs/protocol.md.

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Budget } from "./budget.ts";
import { Config, EncryptedCredentialStore, PROVIDER, type Settings, validPin } from "./config.ts";
import { History } from "./history.ts";
import { Jail, JailError, jailMessage } from "./jail.ts";
import { canOpen, openPath, SETTINGS_PAGES, type SettingsPage } from "./platform.ts";
import { systemPrompt } from "./prompt.ts";
import { S } from "./strings.ts";
import { createTools, kindOf, listFiles, type MadeFile, type ToolDetails } from "./tools.ts";
import { pauseText, watchUsageLimits } from "./usage.ts";

export type Outgoing = Record<string, unknown> & { type: string };
export type Emit = (message: Outgoing) => void;

export type PiaOptions = {
  dataDir: string;
  workspace: string;
  key: Buffer;
  emit: Emit;
  /** Tests inject a model runtime with a fake provider, and name that provider. */
  modelRuntime?: ModelRuntime;
  provider?: string;
  now?: () => number;
};

type ChatMessage =
  | { role: "user"; text: string; imageCount: number }
  | { role: "pia"; text: string; files: MadeFile[] };

const ADMIN_MINUTES = 15;
const MAX_PIN_TRIES = 5;

export class Pia {
  readonly config: Config;
  readonly jail: Jail;
  readonly history: History;
  readonly budget: Budget;
  private emit: Emit;
  private now: () => number;
  private runtime!: ModelRuntime;
  private session?: AgentSession;
  private sessionManager?: SessionManager;
  private sessionDir: string;
  private busy = false;
  private stopRequested = false;
  private pausedThisRun = false;
  private replyOpen = false;
  private confirmations = new Map<string, (yes: boolean) => void>();
  private adminUntil = 0;
  private pinFailures: number[] = [];
  private signIn?: AbortController;
  private provider: string;

  constructor(private options: PiaOptions) {
    this.emit = options.emit;
    this.now = options.now ?? Date.now;
    this.provider = options.provider ?? PROVIDER;
    this.config = new Config(options.dataDir);
    this.jail = new Jail(options.workspace);
    this.history = new History(this.jail);
    this.budget = new Budget(() => this.config.settings.limits);
    this.sessionDir = path.join(options.dataDir, "gespraeche");
    mkdirSync(this.sessionDir, { recursive: true });
  }

  async start(): Promise<void> {
    this.runtime =
      this.options.modelRuntime ??
      (await ModelRuntime.create({
        credentials: new EncryptedCredentialStore(path.join(this.options.dataDir, "anmeldung.bin"), this.options.key),
        modelsPath: null,
        refreshOnCreate: false,
      }));
    if (!this.options.modelRuntime) {
      watchUsageLimits((hit) => this.onUsageLimit(hit.until), this.now);
    }
    await this.openChat(undefined);
    this.emit({ type: "ready", status: await this.status() });
  }

  // ---------------------------------------------------------------- state

  async status() {
    const settings = this.config.settings;
    const paused = settings.pausedUntil && settings.pausedUntil > this.now() ? settings.pausedUntil : null;
    return {
      signedIn: await this.signedIn(),
      busy: this.busy,
      chatId: this.sessionManager?.getSessionId() ?? null,
      pinSet: this.config.pinSet,
      pausedUntil: paused,
      workspace: this.jail.root,
      features: settings.features,
    };
  }

  private async signedIn(): Promise<boolean> {
    if (this.options.modelRuntime) return true;
    const list = await this.runtime.listCredentials();
    return list.some((c) => c.providerId === this.provider);
  }

  private model(): Model<any> | undefined {
    const provider = this.provider;
    return this.runtime.getModel(provider, this.config.settings.model) ?? this.runtime.getModels(provider)[0];
  }

  models(): string[] {
    return this.runtime
      .getModels(this.provider)
      .filter((m) => m.input.includes("image"))
      .map((m) => m.id);
  }

  // ---------------------------------------------------------------- chats

  /** Start a new conversation (no id) or reopen an earlier one. */
  async openChat(chatId: string | undefined): Promise<ChatMessage[]> {
    // The current conversation is not written to disk before its first message.
    if (chatId && chatId === this.sessionManager?.getSessionId()) return this.transcript();
    if (this.busy) throw new Error("busy");
    let manager: SessionManager;
    if (chatId) {
      const file = SessionManager.findById(this.jail.root, chatId, this.sessionDir);
      if (!file) throw new Error("missing chat");
      manager = SessionManager.open(file, this.sessionDir, this.jail.root);
    } else {
      manager = SessionManager.create(this.jail.root, this.sessionDir);
    }
    await this.buildSession(manager);
    return chatId ? this.transcript() : [];
  }

  private async buildSession(manager: SessionManager): Promise<void> {
    this.session?.dispose();
    this.sessionManager = manager;
    const settings = this.config.settings;
    const tools = createTools({
      jail: this.jail,
      history: this.history,
      budget: this.budget,
      features: () => this.config.settings.features,
      askBiggerJob: (title, points, signal) => this.askBiggerJob(title, points, signal),
    }).map((tool) => this.guard(tool));

    const { session } = await createAgentSession({
      cwd: this.jail.root,
      agentDir: path.join(this.options.dataDir, "pi"),
      modelRuntime: this.runtime,
      model: this.model(),
      thinkingLevel: settings.thinking,
      noTools: "all",
      tools: tools.map((t) => t.name),
      customTools: tools,
      resourceLoader: emptyResources(systemPrompt(settings.features, settings.limits)),
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true, maxRetries: 2 },
      }),
    });
    this.session = session;
    session.subscribe((event) => this.onEvent(event));
  }

  /** Names of the tools the model can call right now. */
  activeTools(): string[] {
    return this.session?.getActiveToolNames() ?? [];
  }

  async listChats() {
    const all = await SessionManager.list(this.jail.root, this.sessionDir);
    return all
      .filter((s) => s.messageCount > 0)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .slice(0, 100)
      .map((s) => ({ id: s.id, title: chatTitle(s.name ?? s.firstMessage), updatedAt: s.modified.getTime() }));
  }

  /** The current conversation as bubbles she can read. */
  transcript(): ChatMessage[] {
    const messages = this.sessionManager?.buildSessionContext().messages ?? [];
    const out: ChatMessage[] = [];
    let pendingFiles: MadeFile[] = [];
    let lastPia: Extract<ChatMessage, { role: "pia" }> | undefined;
    for (const message of messages as any[]) {
      if (message.role === "user") {
        const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
        out.push({
          role: "user",
          text: content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"),
          imageCount: content.filter((c: any) => c.type === "image").length,
        });
        lastPia = undefined;
      } else if (message.role === "assistant") {
        const text = message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
        if (text.trim()) {
          lastPia = { role: "pia", text, files: pendingFiles };
          pendingFiles = [];
          out.push(lastPia);
        }
      } else if (message.role === "toolResult") {
        const made = (message.details as ToolDetails | undefined)?.made;
        if (made) pendingFiles.push(made);
      }
    }
    if (pendingFiles.length > 0) {
      if (lastPia) lastPia.files.push(...pendingFiles);
      else out.push({ role: "pia", text: "", files: pendingFiles });
    }
    return out;
  }

  // ---------------------------------------------------------------- talking

  async prompt(text: string, images: ImageContent[]): Promise<void> {
    if (this.busy || !this.session) {
      this.emit({ type: "problem", text: S.problem.busy });
      return;
    }
    const settings = this.config.settings;
    if (settings.pausedUntil && settings.pausedUntil > this.now()) {
      this.emit({ type: "paused", until: settings.pausedUntil, text: pauseText(settings.pausedUntil, this.now()) });
      return;
    }
    if (!(await this.signedIn())) {
      this.emit({ type: "problem", text: S.problem.signedOut });
      return;
    }
    if (!text.trim() && images.length === 0) {
      this.emit({ type: "problem", text: S.problem.empty });
      return;
    }
    if (images.length > 0 && !settings.features.photos) {
      this.emit({ type: "problem", text: S.problem.photosOff });
      return;
    }
    this.budget.reset();
    this.stopRequested = false;
    this.pausedThisRun = false;
    this.setBusy(true);
    try {
      await this.session.prompt(text.trim() || "Was ist auf diesem Bild?", {
        images: images.slice(0, 6),
        expandPromptTemplates: false,
      });
    } catch (error) {
      if (!this.pausedThisRun && !this.stopRequested) this.emit({ type: "problem", text: friendlyError(error) });
    } finally {
      this.emit({ type: "activity_end" });
      this.setBusy(false);
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    for (const resolve of this.confirmations.values()) resolve(false);
    this.confirmations.clear();
    await this.session?.abort();
  }

  answerConfirmation(requestId: string, yes: boolean): void {
    const resolve = this.confirmations.get(requestId);
    this.confirmations.delete(requestId);
    resolve?.(yes === true);
  }

  private askBiggerJob(title: string, points: string[], signal?: AbortSignal): Promise<boolean> {
    const requestId = `frage-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      this.confirmations.set(requestId, resolve);
      signal?.addEventListener("abort", () => this.answerConfirmation(requestId, false), { once: true });
      this.emit({ type: "activity", text: S.activity.ask_for_bigger_job });
      this.emit({ type: "confirm_request", requestId, title, points });
    });
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.emit({ type: "busy", busy });
  }

  private onUsageLimit(until: number): void {
    if (until - this.now() < 60_000) return; // short waits are retried by pi itself
    this.config.update({ pausedUntil: until });
    this.pausedThisRun = true;
    this.emit({ type: "paused", until, text: pauseText(until, this.now()) });
    void this.session?.abort();
  }

  /** Budget and friendly errors around every tool. */
  private guard(tool: ToolDefinition): ToolDefinition {
    return {
      ...tool,
      execute: async (id, params, signal, onUpdate, ctx) => {
        const verdict = this.budget.step(tool.name);
        if (!verdict.ok) {
          if (verdict.stopNow) {
            this.emit({ type: "problem", text: S.problem.stoppedTooMuch });
            this.stopRequested = true;
            void this.session?.abort();
          }
          throw new Error(verdict.reason);
        }
        try {
          return await tool.execute(id, params, signal, onUpdate, ctx);
        } catch (error) {
          if (error instanceof JailError) throw new Error(jailMessage(error));
          throw error;
        }
      },
    };
  }

  private onEvent(event: any): void {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
          // A bubble opens with the first words, so tool-only steps leave no empty bubbles.
          if (!this.replyOpen) this.emit({ type: "reply_start" });
          this.replyOpen = true;
          this.emit({ type: "reply_delta", text: event.assistantMessageEvent.delta });
        }
        break;
      case "message_end": {
        const message = event.message;
        if (message.role !== "assistant") break;
        const text = message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
        if (text.trim() && !this.replyOpen) this.emit({ type: "reply_start" });
        if (text.trim() || this.replyOpen) this.emit({ type: "reply_end", text });
        this.replyOpen = false;
        if (message.stopReason === "error" && !this.pausedThisRun && !this.stopRequested) {
          this.emit({ type: "problem", text: friendlyError(message.errorMessage) });
        }
        break;
      }
      case "tool_execution_start":
        this.emit({ type: "activity", text: activityFor(event.toolName, event.args ?? {}) });
        break;
      case "tool_execution_end": {
        const made = (event.result?.details as ToolDetails | undefined)?.made;
        if (made && !event.isError) this.emit({ type: "file_made", name: made.name, kind: made.kind });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- files

  files() {
    return listFiles(this.jail);
  }

  openFile(name: string): boolean {
    try {
      const absolute = this.jail.resolve(name);
      if (!existsSync(absolute) || !canOpen(absolute)) return false;
      openPath(absolute);
      return true;
    } catch {
      return false;
    }
  }

  openFolder(): void {
    openPath(this.jail.root);
  }

  versions() {
    return this.history.list().slice(0, 200);
  }

  restore(versionId: string): boolean {
    try {
      this.history.restore(versionId);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- helper area (son)

  unlock(pin: string): { ok: boolean; text?: string } {
    const recent = this.pinFailures.filter((t) => this.now() - t < 60_000);
    this.pinFailures = recent;
    if (recent.length >= MAX_PIN_TRIES) return { ok: false, text: S.helper.tooManyTries };
    if (this.config.checkPin(pin)) {
      this.adminUntil = this.now() + ADMIN_MINUTES * 60_000;
      return { ok: true };
    }
    this.pinFailures.push(this.now());
    return { ok: false, text: S.helper.wrongPin };
  }

  setPin(pin: string, newPin: string): { ok: boolean; text?: string } {
    if (this.config.pinSet && !this.unlock(pin).ok) return { ok: false, text: S.helper.wrongPin };
    if (!validPin(newPin)) return { ok: false, text: S.helper.pinFormat };
    this.config.setPin(newPin);
    this.adminUntil = this.now() + ADMIN_MINUTES * 60_000;
    return { ok: true };
  }

  lock(): void {
    this.adminUntil = 0;
    this.signIn?.abort();
  }

  get unlocked(): boolean {
    return this.adminUntil > this.now();
  }

  async adminSettings() {
    const { pinHash: _hidden, ...settings } = this.config.settings;
    return { settings, signedIn: await this.signedIn(), models: this.models() };
  }

  async saveSettings(change: Partial<Settings>): Promise<void> {
    const { model, thinking, features, limits } = change;
    this.config.update({ model, thinking, features, limits } as Partial<Settings>);
    if (!this.busy && this.sessionManager) await this.buildSession(this.sessionManager);
  }

  async signInWithChatGpt(onCode: (code: string, url: string) => void): Promise<void> {
    this.signIn?.abort();
    const controller = new AbortController();
    this.signIn = controller;
    await this.runtime.login(
      PROVIDER,
      "oauth",
      {
        signal: controller.signal,
        prompt: async (prompt) => {
          if (prompt.type === "select") return "device_code";
          throw new Error("unexpected prompt");
        },
        notify: (event) => {
          if (event.type === "device_code") onCode(event.userCode, event.verificationUri);
        },
      },
      { agentName: "Pia" },
    );
    this.config.update({ pausedUntil: undefined });
    if (this.sessionManager && !this.busy) await this.buildSession(this.sessionManager);
  }

  async signOut(): Promise<void> {
    await this.runtime.logout(PROVIDER);
  }
}

function emptyResources(prompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => prompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  } as unknown as ResourceLoader;
}

export function activityFor(tool: string, args: Record<string, unknown>): string {
  const a = S.activity;
  const name = typeof args.name === "string" ? path.basename(args.name) : "";
  switch (tool) {
    case "list_files":
      return a.list_files;
    case "read_file":
      return a.read_file(name);
    case "write_text_file":
      return a.write_text_file;
    case "edit_file":
      return a.edit_file(name);
    case "create_document":
      return kindOf(name) === "pdf" ? a.create_pdf : a.create_document;
    case "create_spreadsheet":
      return a.create_spreadsheet;
    case "create_webpage":
      return a.create_webpage;
    case "open_file":
      return a.open_file;
    case "list_older_versions":
      return a.list_older_versions;
    case "restore_older_version":
      return a.restore_older_version;
    case "open_settings_page": {
      const page = SETTINGS_PAGES[args.page as SettingsPage];
      return page ? a.open_settings_page(page.label) : a.other;
    }
    case "computer_info":
      return a.computer_info;
    case "ask_for_bigger_job":
      return a.ask_for_bigger_job;
    default:
      return a.other;
  }
}

export function friendlyError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : (error ?? "")).toLowerCase();
  if (
    /\b(401|403)\b|unauthori[sz]ed|forbidden|credential|no api key|not (logged|signed) in|re-?authenticate|(access|refresh) token|token (expired|invalid|refresh)|login required/.test(text)
  ) {
    return S.problem.signedOut;
  }
  if (/fetch failed|network|enotfound|eai_again|econn|timed? ?out|socket|offline|getaddrinfo/.test(text)) return S.problem.offline;
  return S.problem.general;
}

function chatTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return S.chatWithPhoto;
  return clean.length > 60 ? `${clean.slice(0, 57)} …` : clean;
}
