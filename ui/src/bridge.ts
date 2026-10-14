// Connection to the background helper.
//
// In the Tauri window, messages go through the `helper_send` command and
// come back as `helper-message` events. In a plain browser (`npx vite`),
// a mock helper stands in so the window can be tried and tested.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HelperMessage, RequestMessage, WindowMessage, WithoutId } from "./protocol";

export interface Transport {
  readonly mock: boolean;
  send(message: WindowMessage): Promise<void>;
  onMessage(callback: (message: HelperMessage) => void): void;
  onExit(callback: () => void): void;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function tauriTransport(): Transport {
  return {
    mock: false,
    async send(message) {
      await invoke("helper_send", { message });
    },
    onMessage(callback) {
      void listen<string>("helper-message", (event) => {
        let parsed: HelperMessage;
        try {
          parsed = JSON.parse(event.payload) as HelperMessage;
        } catch {
          console.warn("pia: unreadable helper message", event.payload);
          return;
        }
        callback(parsed);
      });
    },
    onExit(callback) {
      void listen("helper-exit", () => callback());
    },
  };
}

export async function createTransport(): Promise<Transport> {
  if (isTauri()) return tauriTransport();
  const { createMockTransport } = await import("./mock");
  return createMockTransport();
}

type Pending = {
  resolve: (message: HelperMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class HelperLostError extends Error {}

/** Request/answer bookkeeping on top of a transport. */
export class Helper {
  private listeners = new Set<(message: HelperMessage) => void>();
  private exitListeners = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private counter = 0;

  constructor(private transport: Transport) {
    transport.onMessage((message) => this.dispatch(message));
    transport.onExit(() => {
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new HelperLostError("helper exited"));
        this.pending.delete(id);
      }
      for (const cb of this.exitListeners) cb();
    });
  }

  get mock(): boolean {
    return this.transport.mock;
  }

  on(callback: (message: HelperMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onExit(callback: () => void): void {
    this.exitListeners.add(callback);
  }

  /** Fire-and-forget message. */
  send(message: WindowMessage): Promise<void> {
    return this.transport.send(message);
  }

  /**
   * Sends a message with a fresh `id` and resolves with the first answer
   * that echoes it (which may be a `problem`). Later answers with the same
   * id (for example `sign_in_done`) still reach the `on()` listeners.
   */
  request(message: WithoutId<RequestMessage>, timeoutMs = 20_000): Promise<HelperMessage> & { id: string } {
    const id = `w${Date.now().toString(36)}${(++this.counter).toString(36)}`;
    const full = { ...message, id } as RequestMessage;
    const promise = new Promise<HelperMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("no answer"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(full).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return Object.assign(promise, { id });
  }

  private dispatch(message: HelperMessage): void {
    const replyTo = "replyTo" in message ? message.replyTo : undefined;
    if (replyTo && this.pending.has(replyTo)) {
      const p = this.pending.get(replyTo)!;
      clearTimeout(p.timer);
      this.pending.delete(replyTo);
      p.resolve(message);
    }
    for (const cb of this.listeners) cb(message);
  }
}
