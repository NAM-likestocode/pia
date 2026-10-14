// Turns simple Markdown into Word and PDF files, and rows into spreadsheets.
// Deliberately small: headings, paragraphs, lists, bold and italic.

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument, type PDFFont, StandardFonts, rgb } from "pdf-lib";

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "numbered"; number: number; text: string }
  | { kind: "gap" };

export type Run = { text: string; bold: boolean; italic: boolean };

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
    } else if (bullet) {
      flush();
      blocks.push({ kind: "bullet", text: bullet[1] });
    } else if (numbered) {
      flush();
      blocks.push({ kind: "numbered", number: Number(numbered[1]), text: numbered[2] });
    } else if (line.trim() === "") {
      flush();
      if (blocks.length > 0 && blocks[blocks.length - 1].kind !== "gap") blocks.push({ kind: "gap" });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  while (blocks[blocks.length - 1]?.kind === "gap") blocks.pop();
  return blocks;
}

/** Split "**fett** und *kursiv*" into runs. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), bold: false, italic: false });
    const bold = match[2] ?? match[4];
    const italic = match[3] ?? match[5];
    runs.push({ text: bold ?? italic ?? "", bold: bold !== undefined, italic: italic !== undefined });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false, italic: false });
  return runs.filter((r) => r.text !== "");
}

export async function markdownToDocx(markdown: string): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === "gap") continue;
    const lines = block.text.split("\n");
    const runs = lines.flatMap((line, i) =>
      parseInline(line).map(
        (run, j) => new TextRun({ text: run.text, bold: run.bold, italics: run.italic, break: i > 0 && j === 0 ? 1 : 0 }),
      ),
    );
    if (block.kind === "heading") {
      const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][block.level - 1];
      children.push(new Paragraph({ heading, children: runs, spacing: { after: 160 } }));
    } else if (block.kind === "bullet") {
      children.push(new Paragraph({ bullet: { level: 0 }, children: runs }));
    } else if (block.kind === "numbered") {
      children.push(new Paragraph({ children: [new TextRun(`${block.number}. `), ...runs], indent: { left: 360 } }));
    } else {
      children.push(new Paragraph({ children: runs, spacing: { after: 200 } }));
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 24 } } } },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export async function markdownToPdf(markdown: string, title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const pickFont = (run: Run) =>
    run.bold && run.italic ? fonts.boldItalic : run.bold ? fonts.bold : run.italic ? fonts.italic : fonts.regular;

  const [width, height, margin] = [595.28, 841.89, 64];
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const newLineSpace = (needed: number) => {
    if (y - needed < margin) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
  };

  const writeRuns = (runs: Run[], size: number, indent: number, prefix?: string) => {
    const lineHeight = size * 1.4;
    const words: { text: string; font: PDFFont }[] = [];
    for (const run of runs) {
      for (const piece of run.text.split(/(\s+)/)) {
        if (piece !== "") words.push({ text: safeText(piece, pickFont(run)), font: pickFont(run) });
      }
    }
    let x = margin + indent;
    newLineSpace(lineHeight);
    if (prefix) page.drawText(prefix, { x: margin + indent - 14, y, size, font: fonts.regular });
    for (const word of words) {
      if (word.text === "\n") continue;
      const w = word.font.widthOfTextAtSize(word.text, size);
      if (/^\s+$/.test(word.text)) {
        if (x > margin + indent) x += w;
        continue;
      }
      if (x + w > width - margin && x > margin + indent) {
        y -= lineHeight;
        newLineSpace(lineHeight);
        x = margin + indent;
      }
      page.drawText(word.text, { x, y, size, font: word.font, color: rgb(0.1, 0.1, 0.1) });
      x += w;
    }
    y -= lineHeight;
  };

  for (const block of parseMarkdown(markdown)) {
    if (block.kind === "gap") {
      y -= 8;
      continue;
    }
    const lines = block.text.split("\n");
    if (block.kind === "heading") {
      const size = [20, 16, 13][block.level - 1];
      y -= 6;
      writeRuns(parseInline(block.text).map((r) => ({ ...r, bold: true })), size, 0);
      y -= 4;
    } else if (block.kind === "bullet") {
      writeRuns(parseInline(block.text), 12, 18, "•");
    } else if (block.kind === "numbered") {
      writeRuns(parseInline(block.text), 12, 22, `${block.number}.`);
    } else {
      for (const line of lines) writeRuns(parseInline(line), 12, 0);
      y -= 6;
    }
  }
  return pdf.save();
}

/** Standard PDF fonts only know Western characters; replace anything else. */
function safeText(text: string, font: PDFFont): string {
  let out = "";
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += replacements[char] ?? "";
    }
  }
  return out;
}
const replacements: Record<string, string> = { "‑": "-", "−": "-", " ": " ", " ": " ", "→": "->" };

export type Cell = string | number | boolean | null;
export type Sheet = { name: string; rows: Cell[][] };

// Simple, harmless formulas only: arithmetic, cell ranges and a few functions.
const SAFE_FORMULA = /^=([A-Z]{1,3}[0-9]{1,5}|[0-9.,]+|[-+*/():;, ]|SUM|AVERAGE|MIN|MAX|COUNT|ROUND|ABS)+$/i;

export function isSafeFormula(value: string): boolean {
  return SAFE_FORMULA.test(value.replace(/\$/g, ""));
}

export async function sheetsToXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = "Pia";
  for (const sheet of sheets) {
    const ws = book.addWorksheet(sheet.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " ") || "Tabelle");
    sheet.rows.forEach((row, index) => {
      const added = ws.addRow(
        row.map((cell) => {
          if (typeof cell === "string" && cell.startsWith("=")) {
            return isSafeFormula(cell) ? { formula: cell.slice(1) } : `'${cell}`;
          }
          return cell;
        }),
      );
      if (index === 0) added.font = { bold: true };
    });
    ws.columns.forEach((column) => {
      let widest = 8;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        widest = Math.max(widest, String(cell.value ?? "").length + 2);
      });
      column.width = Math.min(widest, 60);
    });
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** German Excel opens ";"-separated UTF-8 with BOM correctly. Formula-like cells are defused. */
export function sheetToCsv(sheet: Sheet): string {
  const escape = (cell: Cell) => {
    let text = cell === null ? "" : String(cell);
    if (/^[=+\-@\t\r]/.test(text) && typeof cell === "string") text = `'${text}`;
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${sheet.rows.map((row) => row.map(escape).join(";")).join("\r\n")}\r\n`;
}

/** Plain text of a Word file, paragraph by paragraph. */
export async function docxText(data: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

/** Each sheet as ";"-separated lines. */
export async function xlsxText(data: Uint8Array): Promise<string> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(data as unknown as ArrayBuffer);
  const out: string[] = [];
  book.eachSheet((ws) => {
    out.push(`## ${ws.name}`);
    ws.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      out.push(values.join(";"));
    });
  });
  return out.join("\n");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const v = value as { formula?: string; result?: unknown; text?: string; richText?: { text: string }[] };
    if (v.formula) return `=${v.formula}`;
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text) return v.text;
    if (value instanceof Date) return value.toLocaleDateString("de-DE");
  }
  return String(value);
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
