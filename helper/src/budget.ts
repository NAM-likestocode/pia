// Limits for one request. They are enforced here, in code, not only asked for
// in the instructions: when a limit is reached the tool call is refused.

export type Limits = {
  filesPerRequest: number;
  stepsPerRequest: number;
  bigFilesPerRequest: number;
  bigStepsPerRequest: number;
  maxFileKB: number;
};

export const DEFAULT_LIMITS: Limits = {
  filesPerRequest: 3,
  stepsPerRequest: 15,
  bigFilesPerRequest: 15,
  bigStepsPerRequest: 60,
  maxFileKB: 512,
};

// Absolute ceilings that even the helper settings cannot exceed.
export const CEILING: Limits = {
  filesPerRequest: 10,
  stepsPerRequest: 40,
  bigFilesPerRequest: 40,
  bigStepsPerRequest: 150,
  maxFileKB: 4096,
};

export const ASK_TOOL = "ask_for_bigger_job";
const MAX_ASKS = 2;
const MAX_REFUSALS = 4;

export function clampLimits(input: Partial<Limits> | undefined): Limits {
  const out = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
    const value = Number(input?.[key]);
    if (Number.isFinite(value) && value >= 1) out[key] = Math.min(Math.floor(value), CEILING[key]);
  }
  out.bigFilesPerRequest = Math.max(out.bigFilesPerRequest, out.filesPerRequest);
  out.bigStepsPerRequest = Math.max(out.bigStepsPerRequest, out.stepsPerRequest);
  return out;
}

export type StepVerdict = { ok: true } | { ok: false; reason: string; stopNow: boolean };

export class Budget {
  big = false;
  private steps = 0;
  private files = 0;
  private asks = 0;
  private refusals = 0;

  constructor(private limits: () => Limits) {}

  /** Call when she sends a new message. */
  reset(): void {
    this.big = false;
    this.steps = 0;
    this.files = 0;
    this.asks = 0;
    this.refusals = 0;
  }

  get maxBytes(): number {
    return this.limits().maxFileKB * 1024;
  }

  /** Every tool call passes here before it runs. */
  step(toolName: string): StepVerdict {
    const limits = this.limits();
    if (toolName === ASK_TOOL) {
      if (this.big || this.asks >= MAX_ASKS) {
        return this.refuse("Du hast schon gefragt. Frag nicht noch einmal, sondern arbeite mit dem, was erlaubt ist.");
      }
      this.asks++;
      return { ok: true };
    }
    const max = this.big ? limits.bigStepsPerRequest : limits.stepsPerRequest;
    if (this.steps >= max) {
      return this.refuse(
        this.big
          ? "Die Höchstgrenze für diese Aufgabe ist erreicht. Hör jetzt auf und sag ihr in einfachen Worten, was fertig ist und was noch fehlt."
          : `Die normale Grenze für eine Anfrage ist erreicht. Wenn die Aufgabe wirklich größer sein muss, nutze ${ASK_TOOL}. Sonst hör auf und sag ihr, was fertig ist.`,
      );
    }
    this.steps++;
    return { ok: true };
  }

  /** Creating a new file costs one file slot. Throws a plain sentence when none is left. */
  claimFile(): void {
    const limits = this.limits();
    const max = this.big ? limits.bigFilesPerRequest : limits.filesPerRequest;
    if (this.files >= max) {
      throw new BudgetError(
        this.big
          ? "Für diese Aufgabe wurden schon so viele Dateien gemacht wie erlaubt. Mach keine weiteren."
          : `Pro Anfrage dürfen nur ${max} neue Dateien entstehen. Wenn wirklich mehr nötig sind, nutze ${ASK_TOOL}.`,
      );
    }
    this.files++;
  }

  checkSize(bytes: number): void {
    if (bytes > this.maxBytes) {
      throw new BudgetError(
        `Das wäre zu groß (${Math.ceil(bytes / 1024)} KB, erlaubt sind ${this.limits().maxFileKB} KB). Mach es kürzer oder teile es auf.`,
      );
    }
  }

  private refuse(reason: string): StepVerdict {
    this.refusals++;
    return { ok: false, reason, stopNow: this.refusals > MAX_REFUSALS };
  }
}

export class BudgetError extends Error {}
