import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Jail, JailError, splitName } from "../helper/src/jail.ts";

let root: string;
let outside: string;
let jail: Jail;

beforeEach(() => {
  const base = mkdtempSync(path.join(os.tmpdir(), "pia-jail-"));
  root = path.join(base, "Pia");
  outside = path.join(base, "geheim");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "passwort.txt"), "x");
  jail = new Jail(root);
});

describe("splitName", () => {
  it.each([
    "Brief.docx",
    "Briefe/Brief an Anna.docx",
    "Briefe\\Brief an Anna.docx",
    "Rezepte/Kuchen/Omas Apfelkuchen.txt",
    "Ä Ö Ü ß.txt",
  ])("allows %s", (name) => {
    expect(() => splitName(name)).not.toThrow();
  });

  it.each([
    ["../geheim/passwort.txt", "parent"],
    ["Briefe/../../x.txt", "parent"],
    ["/etc/passwd", "absolute"],
    ["\\\\server\\share\\x.txt", "absolute"],
    ["C:\\Windows\\win.ini", "absolute"],
    ["c:x.txt", "absolute"],
    ["~/x.txt", "absolute"],
    ["Brief.txt:versteckt", "chars"],
    ["a<b.txt", "chars"],
    ["CON", "reserved"],
    ["nul.txt", "reserved"],
    ["LPT1.docx", "reserved"],
    [".pia-verlauf/index.json", "hidden"],
    [".PIA-VERLAUF/x", "hidden"],
    [".pi/extensions/x.ts", "hidden"],
    ["Briefe/.versteckt", "hidden"],
    ["PIA-VE~1/index.json", "short"],
    ["Brief.txt.", "trailing"],
    ["Briefe /x.txt", "trailing"],
    ["a/b/c/d/e.txt", "deep"],
    ["x\u0000.txt", "chars"],
  ])("refuses %s", (name) => {
    expect(() => splitName(name)).toThrow(JailError);
  });
});

it("trims spaces around the whole name", () => {
  expect(splitName("  Brief.txt ")).toEqual(["Brief.txt"]);
});

describe("Jail.resolve", () => {
  it("stays inside the root", () => {
    expect(jail.resolve("Briefe/a.txt")).toBe(path.join(root, "Briefe", "a.txt"));
    expect(jail.relative(jail.resolve("Briefe/a.txt"))).toBe("Briefe/a.txt");
  });

  it("refuses a symlink that points outside", () => {
    symlinkSync(outside, path.join(root, "Abkuerzung"));
    expect(() => jail.resolve("Abkuerzung/passwort.txt")).toThrow(JailError);
    expect(() => jail.resolve("Abkuerzung")).toThrow(JailError);
  });

  it("refuses symlinked files too", () => {
    symlinkSync(path.join(outside, "passwort.txt"), path.join(root, "link.txt"));
    expect(() => jail.resolve("link.txt")).toThrow(JailError);
  });

  it("refuses to create a parent through a link", () => {
    symlinkSync(outside, path.join(root, "Abkuerzung"));
    expect(() => jail.ensureParent(path.join(root, "Abkuerzung", "neu", "x.txt"))).toThrow(JailError);
  });
});
