import { describe, expect, it } from "vitest";
import { S } from "../helper/src/strings.ts";
import { SETTINGS_PAGES } from "../helper/src/platform.ts";

// Words she should never have to read. The window's own list is in ui-strings.test.ts.
const JARGON =
  /\b(tool|session|token|api|json|server|upload|download|cache|prompt|modell|model|workspace|account|login|error|fehlercode|exception|stack|null|undefined|http|url|sidecar|helper|provider|oauth|codex|sandbox|jail|budget)\b/i;

function sentences(value: unknown, path: string[] = []): [string, string][] {
  if (typeof value === "string") return [[path.join("."), value]];
  if (typeof value === "function") return [[path.join("."), String(value("Brief.docx"))]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => sentences(inner, [...path, key]));
  }
  return [];
}

describe("helper sentences she can see", () => {
  const { helper: _forTheSon, ...forHer } = S;
  it.each(sentences(forHer))("%s is plain German", (_key, text) => {
    expect(text).not.toMatch(JARGON);
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it.each(Object.entries(SETTINGS_PAGES).map(([k, v]) => [k, v.label]))("settings page %s has a plain label", (_key, label) => {
    expect(label).not.toMatch(JARGON);
  });
});
