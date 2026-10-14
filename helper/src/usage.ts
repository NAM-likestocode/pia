// Notices when the ChatGPT usage limit is reached and turns the reset time into
// plain German. The provider's error text may hide the reset time, so the
// answer is read directly from the HTTP response.

export type LimitHit = { until: number };

const CHATGPT_HOSTS = /(^|\.)(chatgpt\.com|openai\.com)$/i;

/** Wrap global fetch so 429 answers from ChatGPT report when the limit resets. */
export function watchUsageLimits(onLimit: (hit: LimitHit) => void, now: () => number = Date.now): void {
  const original = globalThis.fetch;
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await original(input, init);
    if (response.status === 429 && isChatGpt(input)) {
      try {
        const until = resetTimeFrom(response.headers, await response.clone().text(), now());
        if (until !== undefined) onLimit({ until });
      } catch {
        // A missing reset time just means the friendly message has no clock.
      }
    }
    return response;
  };
  globalThis.fetch = Object.assign(wrapped, original);
}

function isChatGpt(input: Parameters<typeof fetch>[0]): boolean {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return CHATGPT_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Epoch ms when the limit resets, from the body or the headers. */
export function resetTimeFrom(headers: Headers, body: string, now: number): number | undefined {
  try {
    const error = JSON.parse(body)?.error;
    if (typeof error?.resets_at === "number") return error.resets_at * 1000;
    if (typeof error?.resets_in_seconds === "number") return now + error.resets_in_seconds * 1000;
  } catch {
    // not JSON
  }
  const seconds = [
    headers.get("x-codex-primary-reset-after-seconds"),
    headers.get("x-codex-secondary-reset-after-seconds"),
    headers.get("retry-after"),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (seconds.length > 0) return now + Math.max(...seconds) * 1000;
  return undefined;
}

/** Follows "In …": "2 Stunden und 15 Minuten", "einer Stunde", "einer Minute". Rounded up to whole minutes. */
export function durationWords(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(days === 1 ? "einem Tag" : `${days} Tagen`);
  if (hours > 0) parts.push(hours === 1 ? "einer Stunde" : `${hours} Stunden`);
  if (minutes > 0 && days === 0) parts.push(minutes === 1 ? "einer Minute" : `${minutes} Minuten`);
  return parts.join(" und ");
}

/** The sentence she sees. */
export function pauseText(until: number, now: number = Date.now()): string {
  const clock = new Date(until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const sameDay = new Date(until).toDateString() === new Date(now).toDateString();
  const when = sameDay ? `um ${clock} Uhr` : `${weekday(until)} um ${clock} Uhr`;
  return `Ich brauche eine Pause. In ${durationWords(until - now)} bin ich wieder da (${when}).`;
}

function weekday(ms: number): string {
  return new Date(ms).toLocaleDateString("de-DE", { weekday: "long" });
}
