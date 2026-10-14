import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS } from "../helper/src/budget.ts";
import { DEFAULT_SETTINGS } from "../helper/src/config.ts";
import { History } from "../helper/src/history.ts";
import { Jail } from "../helper/src/jail.ts";
import { createTools, freeName, listFiles, webpageProblem } from "../helper/src/tools.ts";

let jail: Jail;
let history: History;
let budget: Budget;
let tools: ReturnType<typeof createTools>;

const run = (name: string, params: Record<string, unknown>) =>
  tools.find((t) => t.name === name)!.execute("id", params as never, undefined, undefined, {} as never);

beforeEach(() => {
  jail = new Jail(path.join(mkdtempSync(path.join(os.tmpdir(), "pia-tools-")), "Pia"));
  history = new History(jail);
  budget = new Budget(() => DEFAULT_LIMITS);
  tools = createTools({ jail, history, budget, features: () => DEFAULT_SETTINGS.features, askBiggerJob: async () => true });
});

describe("tools", () => {
  it("has no tool that deletes, moves or runs commands", () => {
    const names = tools.map((t) => t.name);
    expect(names.filter((n) => /delete|remove|move|rename|bash|shell|exec|command|powershell/i.test(n))).toEqual([]);
  });

  it("never overwrites by accident", async () => {
    await run("write_text_file", { name: "Liste.txt", content: "eins" });
    const second = await run("write_text_file", { name: "Liste.txt", content: "zwei" });
    expect(second.details).toMatchObject({ made: { name: "Liste (2).txt" } });
    expect(readFileSync(jail.resolve("Liste.txt"), "utf8")).toBe("eins");
  });

  it("keeps the old version when replacing, and can restore it", async () => {
    await run("write_text_file", { name: "Liste.txt", content: "eins" });
    await run("write_text_file", { name: "Liste.txt", content: "zwei", replace_existing: true });
    expect(readFileSync(jail.resolve("Liste.txt"), "utf8")).toBe("zwei");
    const [version] = history.list();
    history.restore(version.id);
    expect(readFileSync(jail.resolve("Liste.txt"), "utf8")).toBe("eins");
    expect(history.list()).toHaveLength(2); // "zwei" was kept too
  });

  it("edits text and keeps history", async () => {
    await run("write_text_file", { name: "Notiz.md", content: "Milch kaufen" });
    await run("edit_file", { name: "Notiz.md", old_text: "Milch", new_text: "Brot" });
    expect(readFileSync(jail.resolve("Notiz.md"), "utf8")).toBe("Brot kaufen");
    expect(history.list()[0].name).toBe("Notiz.md");
  });

  it("refuses wrong file types for a tool", async () => {
    await expect(run("write_text_file", { name: "boese.bat", content: "x" })).rejects.toThrow();
    await expect(run("create_webpage", { name: "x.exe", html: "<p>" })).rejects.toThrow();
    expect(listFiles(jail)).toEqual([]);
  });

  it("refuses to read outside the folder", async () => {
    await expect(run("read_file", { name: "../../../etc/passwd" })).rejects.toThrow();
  });

  it("enforces the file limit per request", async () => {
    for (let i = 0; i < DEFAULT_LIMITS.filesPerRequest; i++) await run("write_text_file", { name: `n${i}.txt`, content: "x" });
    await expect(run("write_text_file", { name: "zuviel.txt", content: "x" })).rejects.toThrow(/ask_for_bigger_job/);
  });

  it("creates Word documents and spreadsheets", async () => {
    const doc = await run("create_document", { name: "Brief", markdown: "Hallo" });
    expect(doc.details).toMatchObject({ made: { name: "Brief.docx", kind: "brief" } });
    const sheet = await run("create_spreadsheet", { name: "Liste.csv", sheets: [{ name: "a", rows: [["x"]] }] });
    expect(sheet.details).toMatchObject({ made: { kind: "tabelle" } });
    expect(existsSync(jail.resolve("Liste.csv"))).toBe(true);
  });

  it("hides the history from listings", async () => {
    await run("write_text_file", { name: "a.txt", content: "1" });
    await run("write_text_file", { name: "a.txt", content: "2", replace_existing: true });
    expect(listFiles(jail).map((f) => f.name)).toEqual(["a.txt"]);
  });

  it("opens only allowed settings pages", () => {
    const tool = tools.find((t) => t.name === "open_settings_page")!;
    expect(JSON.stringify(tool.parameters)).toContain("bildschirm");
    expect(JSON.stringify(tool.parameters)).not.toContain("cmd");
  });

  it("drops tools when features are off", () => {
    const off = createTools({
      jail,
      history,
      budget,
      features: () => ({ documents: false, spreadsheets: false, webpages: false, photos: false, settingsHelp: false }),
      askBiggerJob: async () => true,
    }).map((t) => t.name);
    expect(off).not.toContain("create_document");
    expect(off).not.toContain("create_webpage");
    expect(off).not.toContain("open_settings_page");
  });
});

describe("freeName", () => {
  it("counts up", () => {
    writeFileSync(jail.resolve("a.txt"), "");
    writeFileSync(jail.resolve("a (2).txt"), "");
    expect(freeName(jail, "a.txt")).toBe("a (3).txt");
  });
});

describe("webpageProblem", () => {
  it("allows a self-contained page", () => {
    expect(webpageProblem("<html><style>p{}</style><script>let a=1</script><a href='https://x.de'>x</a></html>")).toBeUndefined();
  });
  it.each([
    "<script src='https://evil/x.js'></script>",
    "<iframe src='https://x'></iframe>",
    "<link rel=stylesheet href='https://fonts/x.css'>",
    "<style>@import url('https://x.css')</style>",
    "<form action='https://x'></form>",
    "<script>fetch('https://x')</script>",
  ])("refuses %s", (html) => {
    expect(webpageProblem(html)).toBeTypeOf("string");
  });
});
