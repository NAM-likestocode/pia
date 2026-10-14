import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  docxText,
  isSafeFormula,
  markdownToDocx,
  markdownToPdf,
  parseInline,
  parseMarkdown,
  sheetsToXlsx,
  sheetToCsv,
  xlsxText,
} from "../helper/src/documents.ts";

const LETTER = `# Kündigung

Sehr geehrte Damen und Herren,

hiermit kündige ich **fristgerecht** meinen Vertrag.
Bitte bestätigen Sie mir das *schriftlich*.

- Kundennummer: 12345
- Datum: 14.10.2026

1. Erstens
2. Zweitens

Mit freundlichen Grüßen
Jutta Müller`;

describe("markdown", () => {
  it("parses blocks", () => {
    const kinds = parseMarkdown(LETTER).map((b) => b.kind);
    expect(kinds).toContain("heading");
    expect(kinds.filter((k) => k === "bullet")).toHaveLength(2);
    expect(kinds.filter((k) => k === "numbered")).toHaveLength(2);
  });
  it("parses bold and italic", () => {
    expect(parseInline("a **b** *c*")).toEqual([
      { text: "a ", bold: false, italic: false },
      { text: "b", bold: true, italic: false },
      { text: " ", bold: false, italic: false },
      { text: "c", bold: false, italic: true },
    ]);
  });
});

describe("documents", () => {
  it("writes a Word file that reads back", async () => {
    const text = await docxText(await markdownToDocx(LETTER));
    expect(text).toContain("Sehr geehrte Damen und Herren");
    expect(text).toContain("fristgerecht");
    expect(text).toContain("Jutta Müller");
  });

  it("writes a PDF with umlauts and odd characters", async () => {
    const pdf = await markdownToPdf(`${LETTER}\n\nÄÖÜäöüß € „Zitat“ – 😀 ${"lang ".repeat(800)}`, "Kündigung");
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1500);
  });

  it("writes Excel with safe formulas only", async () => {
    const data = await sheetsToXlsx([
      { name: "Haushalt", rows: [["Was", "Betrag"], ["Miete", 700], ["Strom", 80.5], ["Summe", "=SUM(B2:B3)"], ["Böse", '=HYPERLINK("http://x")']] },
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(data as unknown as ArrayBuffer);
    const sheet = book.getWorksheet("Haushalt")!;
    expect(sheet.getCell("B4").value).toMatchObject({ formula: "SUM(B2:B3)" });
    expect(sheet.getCell("B5").value).toBe(`'=HYPERLINK("http://x")`);
    expect(await xlsxText(data)).toContain("Miete;700");
  });

  it("recognises safe formulas", () => {
    expect(isSafeFormula("=SUM(B2:B10)")).toBe(true);
    expect(isSafeFormula("=ROUND(AVERAGE(C2:C9);2)")).toBe(true);
    expect(isSafeFormula("=B2*1.19")).toBe(true);
    expect(isSafeFormula("=WEBSERVICE(A1)")).toBe(false);
    expect(isSafeFormula('=cmd|"/c calc"!A1')).toBe(false);
  });

  it("writes German CSV and defuses formulas", () => {
    const csv = sheetToCsv({ name: "x", rows: [["Name", "Wert"], ["=1+1", "a;b"], ["Ä", 3]] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=1+1;\"a;b\"");
    expect(csv).toContain("Ä;3");
  });
});
