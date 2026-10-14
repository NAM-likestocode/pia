// Small pure helpers that turn numbers and times into plain German words.
// No DOM access here, so they can be tested in Node.

import { T } from "./strings";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Noch 2 Stunden und 14 Minuten", "Noch 5 Minuten", "Noch weniger als eine Minute". */
export function countdownWords(until: number, now: number): string | null {
  const left = until - now;
  if (left <= 0) return null;
  if (left < MINUTE) return T.pause.lessThanMinute;
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  return T.pause.remaining(days, hours, minutes);
}

/** "14:05", "9:30". */
export function timeWords(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between two moments in local time (positive when `a` is later). */
function dayDifference(a: Date, b: Date): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY);
}

function dayMonthWords(date: Date, now: Date): string {
  const month = T.dates.months[date.getMonth()] ?? "";
  return date.getFullYear() === now.getFullYear()
    ? T.dates.dayMonth(date.getDate(), month)
    : T.dates.dayMonthYear(date.getDate(), month, date.getFullYear());
}

/** "heute, 14:05", "gestern", "12. März", "12. März 2025". */
export function dateWords(when: number, now: number): string {
  const date = new Date(when);
  const today = new Date(now);
  const diff = dayDifference(today, date);
  if (diff === 0) return T.dates.today(timeWords(date));
  if (diff === 1) return T.dates.yesterday;
  return dayMonthWords(date, today);
}

/** For the pause card: "heute um 16:45 Uhr", "morgen um 9:30 Uhr", "am 12. März um 8:00 Uhr". */
export function resumeWords(until: number, now: number): string {
  const date = new Date(until);
  const today = new Date(now);
  const diff = dayDifference(date, today);
  const time = timeWords(date);
  if (diff <= 0) return T.dates.todayAt(time);
  if (diff === 1) return T.dates.tomorrowAt(time);
  return T.dates.dateAt(dayMonthWords(date, today), time);
}

/** "klein", "mittelgroß" or "1,2 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 100 * 1024) return T.sizes.small;
  if (bytes < 1024 * 1024) return T.sizes.medium;
  const mb = bytes / (1024 * 1024);
  const text = (mb < 10 ? mb.toFixed(1) : Math.round(mb).toString()).replace(".", ",");
  return T.sizes.megabytes(text);
}

/** Friendly label for a file kind from the helper. */
export function kindLabel(kind: string): string {
  return T.files.kinds[kind] ?? T.files.kinds.andere ?? kind;
}

type ParsedVersion = { core: number[]; pre: string[] };

function parseVersion(version: string): ParsedVersion {
  const clean = version.trim().replace(/^v/i, "").split("+")[0] ?? "";
  const dash = clean.indexOf("-");
  const corePart = dash === -1 ? clean : clean.slice(0, dash);
  const prePart = dash === -1 ? "" : clean.slice(dash + 1);
  const core = corePart.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (core.length < 3) core.push(0);
  return { core, pre: prePart ? prePart.split(".") : [] };
}

/** Semver compare: -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.core.length, vb.core.length);
  for (let i = 0; i < len; i++) {
    const x = va.core[i] ?? 0;
    const y = vb.core[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // A pre-release (1.0.0-beta) is lower than the release (1.0.0).
  if (va.pre.length === 0 && vb.pre.length === 0) return 0;
  if (va.pre.length === 0) return 1;
  if (vb.pre.length === 0) return -1;
  const preLen = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < preLen; i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) return nx < ny ? -1 : 1;
    if (nx !== null) return -1;
    if (ny !== null) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Percentage 0..100 for download progress, or null when the total is unknown. */
export function percent(done: number, total: number | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}
