import { describe, expect, it } from "vitest";
import { ASK_TOOL, Budget, BudgetError, CEILING, clampLimits, DEFAULT_LIMITS } from "../helper/src/budget.ts";

describe("Budget", () => {
  it("refuses steps beyond the normal limit and points to the question", () => {
    const budget = new Budget(() => ({ ...DEFAULT_LIMITS, stepsPerRequest: 2 }));
    expect(budget.step("read_file").ok).toBe(true);
    expect(budget.step("read_file").ok).toBe(true);
    const third = budget.step("read_file");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toContain(ASK_TOOL);
  });

  it("allows more after she says yes, but not unlimited", () => {
    const budget = new Budget(() => ({ ...DEFAULT_LIMITS, stepsPerRequest: 1, bigStepsPerRequest: 3 }));
    budget.step("a");
    expect(budget.step("a").ok).toBe(false);
    budget.big = true;
    expect(budget.step("a").ok).toBe(true);
    expect(budget.step("a").ok).toBe(true);
    expect(budget.step("a").ok).toBe(false);
  });

  it("asks to stop after repeated refusals", () => {
    const budget = new Budget(() => ({ ...DEFAULT_LIMITS, stepsPerRequest: 1 }));
    budget.step("a");
    const verdicts = Array.from({ length: 6 }, () => budget.step("a"));
    expect(verdicts.at(-1)).toMatchObject({ ok: false, stopNow: true });
  });

  it("limits new files and file size", () => {
    const budget = new Budget(() => ({ ...DEFAULT_LIMITS, filesPerRequest: 1, maxFileKB: 1 }));
    budget.claimFile();
    expect(() => budget.claimFile()).toThrow(BudgetError);
    expect(() => budget.checkSize(2048)).toThrow(BudgetError);
    budget.reset();
    expect(() => budget.claimFile()).not.toThrow();
  });

  it("only lets the question be asked twice", () => {
    const budget = new Budget(() => DEFAULT_LIMITS);
    expect(budget.step(ASK_TOOL).ok).toBe(true);
    expect(budget.step(ASK_TOOL).ok).toBe(true);
    expect(budget.step(ASK_TOOL).ok).toBe(false);
  });
});

describe("clampLimits", () => {
  it("never exceeds the ceiling and ignores nonsense", () => {
    const limits = clampLimits({ stepsPerRequest: 9999, filesPerRequest: -3, maxFileKB: Number.NaN });
    expect(limits.stepsPerRequest).toBe(CEILING.stepsPerRequest);
    expect(limits.filesPerRequest).toBe(DEFAULT_LIMITS.filesPerRequest);
    expect(limits.maxFileKB).toBe(DEFAULT_LIMITS.maxFileKB);
  });
});
