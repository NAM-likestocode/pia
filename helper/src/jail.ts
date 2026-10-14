// The folder lock. Every file Pia touches goes through `Jail.resolve`, which
// only ever returns paths inside her Pia folder, outside the hidden history.

import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

export const HISTORY_DIR = ".pia-verlauf";
export const MAX_DEPTH = 3;
export const MAX_NAME_LENGTH = 120;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// Control characters and everything Windows forbids in names, including ":" so
// drive letters and alternate data streams can never sneak in.
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/;

export class JailError extends Error {}

export class Jail {
  readonly root: string;
  private realRoot: string;

  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    this.root = path.resolve(root);
    this.realRoot = realpathSync.native(this.root);
  }

  /** Validate a name like "Briefe/Brief an Anna.docx" and return its absolute path. */
  resolve(name: string): string {
    const parts = splitName(name);
    const target = path.join(this.root, ...parts);
    this.checkNoLinks(parts);
    return target;
  }

  /** Name relative to the root, with forward slashes, for showing to her and the model. */
  relative(absolute: string): string {
    return path.relative(this.root, absolute).split(path.sep).join("/");
  }

  ensureParent(absolute: string): void {
    const parent = path.dirname(absolute);
    if (!isInside(this.root, parent)) throw new JailError("outside");
    mkdirSync(parent, { recursive: true });
    this.checkNoLinks(splitName(this.relative(parent) || "."));
  }

  // Walk every existing component and refuse symlinks and junctions, then make
  // sure the real location of what exists is still inside the real root.
  private checkNoLinks(parts: string[]): void {
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      let stat;
      try {
        stat = lstatSync(current);
      } catch {
        return; // does not exist yet; nothing below it can be a link
      }
      if (stat.isSymbolicLink()) throw new JailError("link");
      const real = realpathSync.native(current);
      if (!isInside(this.realRoot, real)) throw new JailError("outside");
    }
  }
}

export function splitName(name: string): string[] {
  if (typeof name !== "string") throw new JailError("type");
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === ".") return [];
  if (trimmed.length > 400) throw new JailError("long");
  if (/^[\\/]/.test(trimmed) || /^[a-z]:/i.test(trimmed) || trimmed.startsWith("~")) throw new JailError("absolute");
  const parts = trimmed.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (parts.length > MAX_DEPTH + 1) throw new JailError("deep");
  for (const part of parts) {
    if (part === "..") throw new JailError("parent");
    // Hidden names are refused: that covers the history and any ".pi"-style config.
    if (part.startsWith(".")) throw new JailError("hidden");
    if (FORBIDDEN_CHARS.test(part)) throw new JailError("chars");
    if (WINDOWS_RESERVED.test(part)) throw new JailError("reserved");
    if (/[. ]$/.test(part)) throw new JailError("trailing");
    // Windows 8.3 short names (".PIA-V~1") could otherwise point at the history.
    if (/~\d/.test(part)) throw new JailError("short");
    if (part.length > MAX_NAME_LENGTH) throw new JailError("long");
  }
  return parts;
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The model-facing sentence for a refused name. Plain, so Pia can retell it. */
export function jailMessage(error: unknown): string {
  return error instanceof JailError
    ? "Dieser Name oder Ort ist nicht erlaubt. Nutze nur einfache Dateinamen im Pia-Ordner, ohne Laufwerk, ohne '..' und ohne Sonderzeichen wie : * ? \" < > |."
    : "Die Datei konnte nicht gefunden werden.";
}
