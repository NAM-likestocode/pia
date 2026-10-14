import { describe, expect, it } from "vitest";
import {
  compareVersions,
  countdownWords,
  dateWords,
  kindLabel,
  percent,
  resumeWords,
  sizeWords,
} from "../ui/src/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Local times, so the tests do not depend on the machine's time zone.
const at = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

describe("countdownWords", () => {
  const now = at(2026, 10, 14, 14, 30);

  it("says hours and minutes", () => {
    expect(countdownWords(now + 2 * HOUR + 15 * MINUTE, now)).toBe("Noch 2 Stunden und 15 Minuten");
    expect(countdownWords(now + 2 * HOUR + 15 * MINUTE - 1000, now)).toBe("Noch 2 Stunden und 14 Minuten");
  });

  it("uses singular forms", () => {
    expect(countdownWords(now + HOUR + MINUTE, now)).toBe("Noch 1 Stunde und 1 Minute");
    expect(countdownWords(now + MINUTE, now)).toBe("Noch 1 Minute");
  });

  it("leaves out zero parts", () => {
    expect(countdownWords(now + 3 * HOUR, now)).toBe("Noch 3 Stunden");
    expect(countdownWords(now + 5 * MINUTE + 20_000, now)).toBe("Noch 5 Minuten");
  });

  it("says less than a minute near the end", () => {
    expect(countdownWords(now + 59_000, now)).toBe("Noch weniger als eine Minute");
    expect(countdownWords(now + 1, now)).toBe("Noch weniger als eine Minute");
  });

  it("returns null when the pause is over", () => {
    expect(countdownWords(now, now)).toBeNull();
    expect(countdownWords(now - 1000, now)).toBeNull();
  });

  it("counts days for long pauses", () => {
    expect(countdownWords(now + 2 * DAY + 3 * HOUR + 10 * MINUTE, now)).toBe("Noch 2 Tage und 3 Stunden");
    expect(countdownWords(now + DAY, now)).toBe("Noch 1 Tag");
  });
});

describe("dateWords", () => {
  const now = at(2026, 10, 14, 16, 0);

  it("says today with the time", () => {
    expect(dateWords(at(2026, 10, 14, 14, 5), now)).toBe("heute, 14:05");
    expect(dateWords(at(2026, 10, 14, 9, 7), now)).toBe("heute, 9:07");
    expect(dateWords(at(2026, 10, 14, 0, 0), now)).toBe("heute, 0:00");
  });

  it("says yesterday", () => {
    expect(dateWords(at(2026, 10, 13, 23, 59), now)).toBe("gestern");
    expect(dateWords(at(2026, 10, 13, 0, 1), now)).toBe("gestern");
  });

  it("uses day and month name for older dates", () => {
    expect(dateWords(at(2026, 3, 12), now)).toBe("12. März");
    expect(dateWords(at(2026, 10, 12), now)).toBe("12. Oktober");
  });

  it("adds the year for other years", () => {
    expect(dateWords(at(2025, 12, 24), now)).toBe("24. Dezember 2025");
  });

  it("handles yesterday across a month boundary", () => {
    expect(dateWords(at(2026, 2, 28, 18), at(2026, 3, 1, 8))).toBe("gestern");
  });
});

describe("resumeWords", () => {
  it("reads as a sentence in the pause card", async () => {
    const { T } = await import("../ui/src/strings");
    expect(T.pause.resumeAt("heute um 16:45 Uhr")).toBe("Heute um 16:45 Uhr geht es weiter.");
  });
  const now = at(2026, 10, 14, 14, 30);
  it("says today, tomorrow or a date", () => {
    expect(resumeWords(at(2026, 10, 14, 16, 45), now)).toBe("heute um 16:45 Uhr");
    expect(resumeWords(at(2026, 10, 15, 9, 30), now)).toBe("morgen um 9:30 Uhr");
    expect(resumeWords(at(2026, 10, 20, 8, 0), now)).toBe("am 20. Oktober um 8:00 Uhr");
  });
});

describe("sizeWords", () => {
  it("calls small files small", () => {
    expect(sizeWords(0)).toBe("klein");
    expect(sizeWords(24_800)).toBe("klein");
  });
  it("calls medium files medium", () => {
    expect(sizeWords(320_000)).toBe("mittelgroß");
  });
  it("uses megabytes with a German comma", () => {
    expect(sizeWords(1.2 * 1024 * 1024)).toBe("1,2 MB");
    expect(sizeWords(1024 * 1024)).toBe("1,0 MB");
    expect(sizeWords(25 * 1024 * 1024)).toBe("25 MB");
  });
});

describe("compareVersions", () => {
  it("compares numbers part by part", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });
  it("treats missing parts as zero and ignores a v prefix", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v1.3.0", "1.2.9")).toBe(1);
  });
  it("puts pre-releases before the release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
  it("ignores build metadata", () => {
    expect(compareVersions("1.0.0+abc", "1.0.0+def")).toBe(0);
  });
});

describe("kindLabel and percent", () => {
  it("gives friendly kind labels", () => {
    expect(kindLabel("brief")).toBe("Brief");
    expect(kindLabel("tabelle")).toBe("Tabelle");
    expect(kindLabel("webseite")).toBe("Webseite");
    expect(kindLabel("something-new")).toBe("Datei");
  });
  it("computes download percent", () => {
    expect(percent(40, 100)).toBe(40);
    expect(percent(5, undefined)).toBeNull();
    expect(percent(150, 100)).toBe(100);
  });
});
