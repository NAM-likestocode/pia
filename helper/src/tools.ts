// The only tools the model gets. Each one works inside the Pia folder (through
// the jail) or does one fixed, harmless thing outside it.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ASK_TOOL, type Budget } from "./budget.ts";
import type { Features } from "./config.ts";
import { docxText, markdownToDocx, markdownToPdf, sheetsToXlsx, sheetToCsv, xlsxText, type Sheet } from "./documents.ts";
import type { History } from "./history.ts";
import { HISTORY_DIR, type Jail, MAX_DEPTH } from "./jail.ts";
import { canOpen, openPath, openSettings, pcInfo, SETTINGS_PAGES, type SettingsPage } from "./platform.ts";

export type FileKind = "brief" | "tabelle" | "webseite" | "bild" | "text" | "pdf" | "andere";
export type MadeFile = { name: string; kind: FileKind };
export type ToolDetails = { made?: MadeFile };

export type ToolContext = {
  jail: Jail;
  history: History;
  budget: Budget;
  features: () => Features;
  /** Ask her the big-job question; resolves with her answer. */
  askBiggerJob: (title: string, points: string[], signal?: AbortSignal) => Promise<boolean>;
};

const TEXT_TYPES = new Set([".txt", ".md", ".csv", ".html", ".htm", ".json"]);
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_READ_CHARS = 60_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function kindOf(name: string): FileKind {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".docx") return "brief";
  if (ext === ".pdf") return "pdf";
  if (ext === ".xlsx" || ext === ".csv") return "tabelle";
  if (ext === ".html" || ext === ".htm") return "webseite";
  if (ext in IMAGE_TYPES || ext === ".bmp") return "bild";
  if (ext === ".txt" || ext === ".md") return "text";
  return "andere";
}

export type FileEntry = { name: string; size: number; modifiedAt: number; kind: FileKind };

export function listFiles(jail: Jail): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === HISTORY_DIR || entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        const stat = statSync(absolute);
        const name = jail.relative(absolute);
        out.push({ name, size: stat.size, modifiedAt: stat.mtimeMs, kind: kindOf(name) });
      }
      if (out.length >= 1000) return;
    }
  };
  walk(jail.root, 0);
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** "Brief.docx" → "Brief (2).docx" when the name is taken. */
export function freeName(jail: Jail, name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; existsSync(jail.resolve(candidate)); n++) candidate = `${base} (${n})${ext}`;
  return candidate;
}

function requireExtension(name: string, allowed: string[]): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === "") return `${name}${allowed[0]}`;
  if (!allowed.includes(ext)) throw new Error(`Für diese Art Datei sind nur diese Endungen erlaubt: ${allowed.join(", ")}.`);
  return name;
}

function text(value: string, details: ToolDetails = {}) {
  return { content: [{ type: "text" as const, text: value }], details };
}

/** Write a new file, or replace an existing one after saving its old version. */
function store(ctx: ToolContext, requested: string, data: string | Uint8Array, replace: boolean): MadeFile {
  const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
  ctx.budget.checkSize(bytes);
  const exists = existsSync(ctx.jail.resolve(requested));
  let name = requested;
  if (exists && replace) {
    ctx.history.save(requested, "vor einer Änderung durch Pia");
  } else {
    name = exists ? freeName(ctx.jail, requested) : requested;
    ctx.budget.claimFile();
  }
  const absolute = ctx.jail.resolve(name);
  ctx.jail.ensureParent(absolute);
  writeFileSync(absolute, data);
  const made = { name: ctx.jail.relative(absolute), kind: kindOf(name) };
  return made;
}

function madeMessage(made: MadeFile, replaced: boolean): string {
  return `${replaced ? "Geändert" : "Gespeichert"}: "${made.name}". Sie sieht die Datei mit einem Öffnen-Knopf.`;
}

const replaceParam = Type.Optional(
  Type.Boolean({ description: "true only when she wants to change this existing file. The old version is kept and can be restored." }),
);

export function createTools(ctx: ToolContext): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const features = ctx.features();

  tools.push(
    defineTool({
      name: "list_files",
      label: "Dateien ansehen",
      description: "List the files in her Pia folder (newest first). This folder is the only place you can see.",
      parameters: Type.Object({}),
      async execute() {
        const files = listFiles(ctx.jail);
        if (files.length === 0) return text("Der Pia-Ordner ist noch leer.");
        return text(
          files
            .slice(0, 200)
            .map((f) => `${f.name}  (${Math.ceil(f.size / 1024)} KB, ${new Date(f.modifiedAt).toLocaleString("de-DE")})`)
            .join("\n"),
        );
      },
    }),
    defineTool({
      name: "read_file",
      label: "Datei lesen",
      description: "Read a file from her Pia folder: text, CSV, HTML, Word (.docx), Excel (.xlsx) or a picture.",
      parameters: Type.Object({ name: Type.String({ description: "File name inside the Pia folder, e.g. 'Briefe/Brief an Anna.docx'" }) }),
      async execute(_id, { name }) {
        const absolute = ctx.jail.resolve(name);
        if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error("Diese Datei gibt es nicht. Schau mit list_files nach.");
        const ext = path.extname(absolute).toLowerCase();
        const data = readFileSync(absolute);
        if (IMAGE_TYPES[ext]) {
          if (data.byteLength > MAX_IMAGE_BYTES) throw new Error("Das Bild ist zu groß zum Ansehen.");
          return {
            content: [{ type: "image" as const, data: data.toString("base64"), mimeType: IMAGE_TYPES[ext] }],
            details: {},
          };
        }
        let body: string;
        if (ext === ".docx") body = await docxText(data);
        else if (ext === ".xlsx") body = await xlsxText(data);
        else if (TEXT_TYPES.has(ext)) body = data.toString("utf8").replace(/^﻿/, "");
        else throw new Error("Diese Art Datei kann ich nicht lesen.");
        return text(body.length > MAX_READ_CHARS ? `${body.slice(0, MAX_READ_CHARS)}\n[… gekürzt]` : body);
      },
    }),
    defineTool({
      name: "write_text_file",
      label: "Notiz schreiben",
      description: "Save a plain text note (.txt or .md) in her Pia folder.",
      parameters: Type.Object({
        name: Type.String({ description: "File name, e.g. 'Einkaufsliste.txt'" }),
        content: Type.String(),
        replace_existing: replaceParam,
      }),
      async execute(_id, { name, content, replace_existing }) {
        const made = store(ctx, requireExtension(name, [".txt", ".md"]), content, Boolean(replace_existing));
        return text(madeMessage(made, Boolean(replace_existing)), { made });
      },
    }),
    defineTool({
      name: "edit_file",
      label: "Datei ändern",
      description:
        "Change part of an existing text, CSV or HTML file by replacing one exact piece of text. The old version is kept and can be restored. For Word, PDF or Excel files, read them and create them again with replace_existing.",
      parameters: Type.Object({
        name: Type.String(),
        old_text: Type.String({ description: "Exact text currently in the file; must appear exactly once." }),
        new_text: Type.String(),
      }),
      async execute(_id, { name, old_text, new_text }) {
        const absolute = ctx.jail.resolve(name);
        if (!TEXT_TYPES.has(path.extname(absolute).toLowerCase())) throw new Error("Nur Text-, CSV- und Webseiten-Dateien lassen sich so ändern.");
        if (!existsSync(absolute)) throw new Error("Diese Datei gibt es nicht.");
        const current = readFileSync(absolute, "utf8");
        const count = old_text === "" ? 0 : current.split(old_text).length - 1;
        if (count !== 1) throw new Error(count === 0 ? "Der alte Text wurde nicht gefunden." : "Der alte Text kommt mehrmals vor. Nimm ein längeres Stück.");
        const updated = current.replace(old_text, () => new_text);
        const made = store(ctx, ctx.jail.relative(absolute), updated, true);
        return text(madeMessage(made, true), { made });
      },
    }),
  );

  if (features.documents) {
    tools.push(
      defineTool({
        name: "create_document",
        label: "Brief schreiben",
        description:
          "Create a Word (.docx) or PDF document from simple Markdown (# headings, paragraphs, - lists, **bold**, *italic*). Use this for letters and documents she wants to print or send.",
        parameters: Type.Object({
          name: Type.String({ description: "File name with .docx or .pdf, e.g. 'Brief an die Krankenkasse.docx'" }),
          markdown: Type.String(),
          replace_existing: replaceParam,
        }),
        async execute(_id, { name, markdown, replace_existing }) {
          const fileName = requireExtension(name, [".docx", ".pdf"]);
          const data =
            path.extname(fileName).toLowerCase() === ".pdf"
              ? await markdownToPdf(markdown, path.basename(fileName, ".pdf"))
              : await markdownToDocx(markdown);
          const made = store(ctx, fileName, data, Boolean(replace_existing));
          return text(madeMessage(made, Boolean(replace_existing)), { made });
        },
      }),
    );
  }

  if (features.spreadsheets) {
    const cell = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
    tools.push(
      defineTool({
        name: "create_spreadsheet",
        label: "Tabelle machen",
        description:
          "Create an Excel (.xlsx) or CSV spreadsheet. The first row is the header. In .xlsx, simple formulas like '=SUM(B2:B10)' are allowed (SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS). CSV supports one sheet.",
        parameters: Type.Object({
          name: Type.String({ description: "File name with .xlsx or .csv" }),
          sheets: Type.Array(Type.Object({ name: Type.String(), rows: Type.Array(Type.Array(cell)) }), { minItems: 1, maxItems: 10 }),
          replace_existing: replaceParam,
        }),
        async execute(_id, { name, sheets, replace_existing }) {
          const fileName = requireExtension(name, [".xlsx", ".csv"]);
          const data =
            path.extname(fileName).toLowerCase() === ".csv"
              ? sheetToCsv(sheets[0] as Sheet)
              : await sheetsToXlsx(sheets as Sheet[]);
          const made = store(ctx, fileName, data, Boolean(replace_existing));
          return text(madeMessage(made, Boolean(replace_existing)), { made });
        },
      }),
    );
  }

  if (features.webpages) {
    tools.push(
      defineTool({
        name: "create_webpage",
        label: "Webseite bauen",
        description:
          "Create one small self-contained .html page (inline CSS and JavaScript only; no external scripts, styles, fonts, frames or forms that send data). Use large readable text.",
        parameters: Type.Object({
          name: Type.String({ description: "File name with .html" }),
          html: Type.String(),
          replace_existing: replaceParam,
        }),
        async execute(_id, { name, html, replace_existing }) {
          const problem = webpageProblem(html);
          if (problem) throw new Error(problem);
          const made = store(ctx, requireExtension(name, [".html"]), html, Boolean(replace_existing));
          return text(madeMessage(made, Boolean(replace_existing)), { made });
        },
      }),
    );
  }

  tools.push(
    defineTool({
      name: "open_file",
      label: "Datei öffnen",
      description: "Open a file from her Pia folder in its usual program (Word, PDF viewer, Excel, browser, pictures).",
      parameters: Type.Object({ name: Type.String() }),
      async execute(_id, { name }) {
        const absolute = ctx.jail.resolve(name);
        if (!existsSync(absolute)) throw new Error("Diese Datei gibt es nicht.");
        if (!canOpen(absolute)) throw new Error("Diese Art Datei darf Pia nicht öffnen.");
        openPath(absolute);
        return text("Die Datei wird geöffnet.");
      },
    }),
    defineTool({
      name: "list_older_versions",
      label: "Ältere Versionen ansehen",
      description: "List older saved versions of her files (every change keeps the previous version).",
      parameters: Type.Object({ name: Type.Optional(Type.String({ description: "Only versions of this file" })) }),
      async execute(_id, { name }) {
        const versions = ctx.history.list().filter((v) => !name || v.name === name).slice(0, 30);
        if (versions.length === 0) return text("Es gibt keine älteren Versionen.");
        return text(versions.map((v) => `${v.id}: ${v.name}, ${new Date(v.savedAt).toLocaleString("de-DE")} (${v.why})`).join("\n"));
      },
    }),
    defineTool({
      name: "restore_older_version",
      label: "Ältere Version zurückholen",
      description: "Bring back an older version of a file. The current version is kept too, so this can be undone.",
      parameters: Type.Object({ version_id: Type.String() }),
      async execute(_id, { version_id }) {
        const version = ctx.history.restore(version_id);
        const made = { name: version.name, kind: kindOf(version.name) };
        return text(`Die ältere Version von "${version.name}" ist wieder da.`, { made });
      },
    }),
  );

  if (features.settingsHelp) {
    const pages = Object.keys(SETTINGS_PAGES) as SettingsPage[];
    tools.push(
      defineTool({
        name: "open_settings_page",
        label: "Einstellungen öffnen",
        description: `Open a Windows settings page so she can change something herself while you explain each step. You cannot change settings yourself. Pages: ${pages
          .map((p) => `${p} (${SETTINGS_PAGES[p].label})`)
          .join(", ")}.`,
        parameters: Type.Object({ page: Type.Union(pages.map((p) => Type.Literal(p))) }),
        async execute(_id, { page }) {
          openSettings(page as SettingsPage);
          return text(`Die Seite "${SETTINGS_PAGES[page as SettingsPage].label}" wird geöffnet. Erkläre ihr jetzt Schritt für Schritt, was sie dort sieht und anklicken soll.`);
        },
      }),
      defineTool({
        name: "computer_info",
        label: "Computer ansehen",
        description: "Read basic facts about her computer: Windows version, free disk space, Wi-Fi connection, default printer. Read-only.",
        parameters: Type.Object({}),
        async execute() {
          const info = await pcInfo(ctx.jail.root);
          return text(
            [
              `System: ${info.system}`,
              `Freier Speicher: ${info.freeSpace} von ${info.totalSpace}`,
              info.wifi && `WLAN: ${info.wifi}`,
              info.defaultPrinter && `Standard-Drucker: ${info.defaultPrinter}`,
            ]
              .filter(Boolean)
              .join("\n"),
          );
        },
      }),
    );
  }

  tools.push(
    defineTool({
      name: ASK_TOOL,
      label: "Nachfragen",
      description:
        "Ask her before a bigger job (more files or more work than a normal request allows). Explain in very simple German what you will make. She answers with a Yes or No button. Only after Yes are higher limits allowed for this request.",
      parameters: Type.Object({
        title: Type.String({ description: "Short simple question, e.g. 'Soll ich eine Webseite mit 5 Seiten für deine Rezepte bauen?'" }),
        points: Type.Array(Type.String(), { description: "2 to 5 short plain points: what will be made, roughly how many files, how long it may take.", maxItems: 6 }),
      }),
      async execute(_id, { title, points }, signal) {
        const yes = await ctx.askBiggerJob(title, points, signal);
        if (yes) {
          ctx.budget.big = true;
          return text("Sie hat Ja gesagt. Du darfst jetzt mehr machen, aber bleib bei dem, was du beschrieben hast.");
        }
        return text("Sie hat Nein gesagt. Mach es klein und einfach, oder frag, was sie stattdessen möchte.");
      },
    }),
  );

  return tools;
}

/** Why an HTML page is not allowed, or undefined when it is fine. */
export function webpageProblem(html: string): string | undefined {
  const lower = html.toLowerCase();
  if (/<(iframe|frame|object|embed|base)\b/.test(lower)) return "Die Seite darf keine eingebetteten fremden Inhalte haben.";
  if (/<script[^>]*\bsrc\s*=/.test(lower)) return "JavaScript muss direkt in der Seite stehen, nicht von außen geladen werden.";
  if (/<link[^>]*\bhref\s*=\s*["']?\s*(https?:)?\/\//.test(lower)) return "Stile und Schriften müssen direkt in der Seite stehen.";
  if (/@import\s+(url\()?\s*["']?\s*(https?:)?\/\//.test(lower)) return "Stile und Schriften müssen direkt in der Seite stehen.";
  if (/<form[^>]*\baction\s*=\s*["']?\s*(https?:)?\/\//.test(lower)) return "Formulare dürfen nichts ins Internet schicken.";
  if (/\b(fetch|xmlhttprequest|websocket|sendbeacon|eventsource)\b/.test(lower)) return "Die Seite darf nichts ins Internet schicken oder von dort laden.";
  return undefined;
}
