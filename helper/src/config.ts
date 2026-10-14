// Settings, the helper PIN, and the encrypted ChatGPT login, all stored in the
// app data folder (never in her Pia folder).

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { clampLimits, type Limits } from "./budget.ts";

export type Features = { documents: boolean; spreadsheets: boolean; webpages: boolean; photos: boolean; settingsHelp: boolean };
export type Thinking = "off" | "low" | "medium";

export type Settings = {
  model: string;
  thinking: Thinking;
  features: Features;
  limits: Limits;
  pinHash?: string;
  pausedUntil?: number;
};

export const PROVIDER = "openai-codex";
export const DEFAULT_MODEL = "gpt-6.1-sol";

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  thinking: "low",
  features: { documents: true, spreadsheets: true, webpages: true, photos: true, settingsHelp: true },
  limits: clampLimits(undefined),
};

export class Config {
  private file: string;
  settings: Settings;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "settings.json");
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      return normalize(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  update(change: Partial<Settings>): Settings {
    this.settings = normalize({ ...this.settings, ...change });
    writeAtomic(this.file, JSON.stringify(this.settings, null, 2));
    return this.settings;
  }

  get pinSet(): boolean {
    return Boolean(this.settings.pinHash);
  }

  checkPin(pin: string): boolean {
    const stored = this.settings.pinHash;
    if (!stored) return false;
    const [salt, hash] = stored.split(":");
    const candidate = scryptSync(String(pin), Buffer.from(salt, "hex"), 32);
    return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
  }

  setPin(pin: string): void {
    const salt = randomBytes(16);
    this.update({ pinHash: `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}` });
  }
}

export function normalize(input: Partial<Settings>): Settings {
  const features = { ...DEFAULT_SETTINGS.features };
  for (const key of Object.keys(features) as (keyof Features)[]) {
    if (typeof input.features?.[key] === "boolean") features[key] = input.features[key];
  }
  return {
    model: typeof input.model === "string" && /^[\w.-]+$/.test(input.model) ? input.model : DEFAULT_MODEL,
    thinking: input.thinking === "off" || input.thinking === "medium" ? input.thinking : "low",
    features,
    limits: clampLimits(input.limits),
    pinHash: typeof input.pinHash === "string" && /^[0-9a-f]{32}:[0-9a-f]{64}$/.test(input.pinHash) ? input.pinHash : undefined,
    pausedUntil: typeof input.pausedUntil === "number" ? input.pausedUntil : undefined,
  };
}

export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4,8}$/.test(pin);
}

/**
 * Login storage encrypted with AES-256-GCM. The key comes from the shell, which
 * keeps it in the Windows Credential Manager, so the file alone is useless.
 */
export class EncryptedCredentialStore implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private file: string,
    private key: Buffer,
  ) {
    if (key.length !== 32) throw new Error("key must be 32 bytes");
  }

  async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.readAll()[providerId];
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.readAll()).map(([providerId, credential]) => ({ providerId, type: credential.type }) as CredentialInfo);
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const next = this.chain.then(async () => {
      const all = this.readAll();
      const updated = await fn(all[providerId]);
      if (updated === undefined) delete all[providerId];
      else all[providerId] = updated;
      this.writeAll(all);
      return updated;
    });
    this.chain = next.catch(() => {});
    return next;
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    await this.modify(providerId, async () => undefined, options);
  }

  private readAll(): Record<string, Credential> {
    let raw: Buffer;
    try {
      raw = readFileSync(this.file);
    } catch {
      return {};
    }
    try {
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
      return JSON.parse(plain.toString("utf8"));
    } catch {
      return {}; // wrong key or damaged file: treat as signed out
    }
  }

  private writeAll(all: Record<string, Credential>): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(all), "utf8"), cipher.final()]);
    writeAtomic(this.file, Buffer.concat([iv, cipher.getAuthTag(), body]));
  }
}

function writeAtomic(file: string, data: string | Buffer): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, data, { mode: 0o600 });
  renameSync(temp, file);
}
