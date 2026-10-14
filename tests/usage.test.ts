import { describe, expect, it } from "vitest";
import { durationWords, pauseText, resetTimeFrom } from "../helper/src/usage.ts";

const MIN = 60_000;

describe("durationWords", () => {
  it.each([
    [30_000, "einer Minute"],
    [MIN, "einer Minute"],
    [25 * MIN, "25 Minuten"],
    [60 * MIN, "einer Stunde"],
    [61 * MIN, "einer Stunde und einer Minute"],
    [135 * MIN, "2 Stunden und 15 Minuten"],
    [24 * 60 * MIN, "einem Tag"],
    [(3 * 24 * 60 + 125) * MIN, "3 Tagen und 2 Stunden"],
  ])("%d ms → %s", (ms, words) => {
    expect(durationWords(ms)).toBe(words);
  });
});

describe("resetTimeFrom", () => {
  const now = 1_700_000_000_000;
  it("reads resets_at from the body", () => {
    const body = JSON.stringify({ error: { type: "usage_limit_reached", resets_at: 1_700_008_100 } });
    expect(resetTimeFrom(new Headers(), body, now)).toBe(1_700_008_100_000);
  });
  it("reads resets_in_seconds", () => {
    const body = JSON.stringify({ error: { resets_in_seconds: 600 } });
    expect(resetTimeFrom(new Headers(), body, now)).toBe(now + 600_000);
  });
  it("falls back to the codex headers", () => {
    const headers = new Headers({ "x-codex-primary-reset-after-seconds": "120", "x-codex-secondary-reset-after-seconds": "9000" });
    expect(resetTimeFrom(headers, "nope", now)).toBe(now + 9_000_000);
  });
  it("returns undefined without information", () => {
    expect(resetTimeFrom(new Headers(), "{}", now)).toBeUndefined();
  });
});

describe("pauseText", () => {
  it("says how long and at what time", () => {
    const now = new Date(2026, 9, 14, 14, 25).getTime();
    expect(pauseText(now + 135 * MIN, now)).toBe("Ich brauche eine Pause. In 2 Stunden und 15 Minuten bin ich wieder da (um 16:40 Uhr).");
  });
  it("names the weekday when it is not today", () => {
    const now = new Date(2026, 9, 14, 23, 0).getTime();
    expect(pauseText(now + 120 * MIN, now)).toContain("Donnerstag um 01:00 Uhr");
  });
});
