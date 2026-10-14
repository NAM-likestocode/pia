import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { T } from "../ui/src/strings";

// Words she should never see. `T.helper` (for her son) is exempt.
const FORBIDDEN = [
  "tool",
  "session",
  "token",
  "api",
  "modell",
  "prompt",
  "fehler",
  "json",
  "server",
  "upload",
  "download",
  "cache",
  "admin",
  "workspace",
  "chat",
  "account",
  "login",
  "update",
  "error",
  "http",
];

function collect(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") out.push({ path, text: value });
  else if (typeof value === "function") {
    // Call with sample arguments so interpolated text is checked too.
    const fn = value as (...args: unknown[]) => unknown;
    const samples = [[1], [2, 3, 4], ["Beispiel"], [0, 1, 5]];
    for (const args of samples) {
      try {
        collect(fn(...args), `${path}()`, out);
      } catch {
        // wrong argument shape, ignore
      }
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) collect(v, path ? `${path}.${key}` : key, out);
  }
}

describe("window strings", () => {
  const { helper: _helper, ...visible } = T;
  const texts: { path: string; text: string }[] = [];
  collect(visible, "", texts);

  it("has text to check", () => {
    expect(texts.length).toBeGreaterThan(50);
  });

  it("uses no technical words outside T.helper", () => {
    const hits: string[] = [];
    for (const { path, text } of texts) {
      for (const word of FORBIDDEN) {
        if (new RegExp(`\\b${word}`, "i").test(text)) hits.push(`${path}: "${text}" contains "${word}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("speaks to her with du, not Sie", () => {
    const formal = texts.filter(({ text }) => /\b(Sie|Ihnen|Ihr|Ihre)\b/.test(text));
    expect(formal).toEqual([]);
  });

  it("has the required wording", () => {
    expect(T.composer.placeholder).toBe("Schreib hier, wobei Pia helfen soll …");
    expect(T.footer.helperLink).toBe("Einstellungen für Helfer");
    expect(T.confirm.yes).toBe("Ja, mach das");
    expect(T.confirm.no).toBe("Nein, lieber nicht");
    expect(T.composer.paused).toBe("Pia macht gerade Pause");
    expect(T.updates.button).toBe("Jetzt aktualisieren");
  });
});

describe("window code", () => {
  // German text belongs in strings.ts. The mock helper is exempt: it plays
  // the background helper, whose sentences are not window strings.
  const dir = join(import.meta.dirname, "..", "ui", "src");
  const exempt = new Set(["strings.ts", "mock.ts"]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !exempt.has(f));

  it("keeps German text in strings.ts", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(join(dir, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
        if (/["'`][^"'`]*[äöüÄÖÜß][^"'`]*["'`]/.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
