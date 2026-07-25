import { describe, expect, it } from "vitest";
import {
  CalculationResult,
  calculateReturnPremium,
  differenceInPolicyDays,
  truncateFactor
} from "./calculations";

// Hostile-input suite. Diagnostic only: documents current behavior at the edges.
// Every engine test asserts a correct result or an explicit thrown error — never
// NaN, never Infinity, never a silently wrong dollar figure.

function expectSaneMoney(result: CalculationResult): void {
  const factors = [
    result.proRataFactor,
    result.shortRateFactor,
    result.cancellationReturnFactor,
    result.unearnedFactor
  ];
  for (const factor of factors) {
    expect(Number.isFinite(factor)).toBe(true);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  }

  const dollars = [
    result.grossReturn,
    result.finalReturnPremium,
    result.retainedViaFactor,
    result.retainedViaMinimum,
    result.triaAmount
  ];
  for (const amount of dollars) {
    expect(Number.isFinite(amount)).toBe(true);
    expect(Number.isInteger(amount)).toBe(true);
  }
  expect(result.finalReturnPremium).toBeGreaterThanOrEqual(0);
}

describe("date boundaries", () => {
  const oneYear = {
    policyEffectiveDate: "2026-01-01",
    policyExpirationDate: "2027-01-01",
    depositPremium: 40000,
    cancellationType: "insured" as const
  };

  it("cancellation on the effective date (day 0) returns the short-rate share", () => {
    const result = calculateReturnPremium({
      ...oneYear,
      cancellationEffectiveDate: "2026-01-01"
    });

    expect(result.earnedDays).toBe(0);
    expect(result.unearnedDays).toBe(365);
    expect(result.proRataFactor).toBe(1);
    expect(result.shortRateFactor).toBe(0.9);
    expect(result.finalReturnPremium).toBe(36000);
    expectSaneMoney(result);
  });

  it("day-0 cancellation with 25% MEP still retains the minimum", () => {
    const result = calculateReturnPremium({
      ...oneYear,
      cancellationEffectiveDate: "2026-01-01",
      minimumEarnedPremiumPercent: 25
    });

    // Even with zero days elapsed, the MEP floor keeps 25%: 30000 < 36000 short-rate return.
    expect(result.minimumBinds).toBe(true);
    expect(result.retainedViaMinimum).toBe(10000);
    expect(result.finalReturnPremium).toBe(30000);
    expectSaneMoney(result);
  });

  it("cancellation on the expiration date returns zero, not NaN", () => {
    const result = calculateReturnPremium({
      ...oneYear,
      cancellationEffectiveDate: "2027-01-01"
    });

    expect(result.earnedDays).toBe(365);
    expect(result.unearnedDays).toBe(0);
    expect(result.proRataFactor).toBe(0);
    expect(result.shortRateFactor).toBe(0);
    expect(result.finalReturnPremium).toBe(0);
    expectSaneMoney(result);
  });

  it("cancellation one day past expiration throws", () => {
    expect(() =>
      calculateReturnPremium({ ...oneYear, cancellationEffectiveDate: "2027-01-02" })
    ).toThrow(/expiration/i);
  });

  it("handles a leap day mid-term (366-day year)", () => {
    const result = calculateReturnPremium({
      policyEffectiveDate: "2024-01-01",
      policyExpirationDate: "2025-01-01",
      cancellationEffectiveDate: "2024-02-29",
      depositPremium: 36600,
      cancellationType: "insured"
    });

    expect(result.totalPolicyDays).toBe(366);
    expect(result.earnedDays).toBe(59);
    expect(result.unearnedDays).toBe(307);
    expect(result.proRataFactor).toBe(0.838);
    expect(result.shortRateFactor).toBe(0.754);
    expect(result.finalReturnPremium).toBe(27596);
    expectSaneMoney(result);
  });

  it("handles a leap day as the effective date", () => {
    const result = calculateReturnPremium({
      policyEffectiveDate: "2024-02-29",
      policyExpirationDate: "2025-02-28",
      cancellationEffectiveDate: "2024-08-29",
      depositPremium: 10000,
      cancellationType: "insured"
    });

    expect(result.totalPolicyDays).toBe(365);
    expect(result.earnedDays).toBe(182);
    expect(result.unearnedDays).toBe(183);
    expect(result.proRataFactor).toBe(0.501);
    expect(result.shortRateFactor).toBe(0.451);
    expectSaneMoney(result);
  });

  it("rejects a leap day in a non-leap year", () => {
    expect(() =>
      calculateReturnPremium({ ...oneYear, cancellationEffectiveDate: "2023-02-29" })
    ).toThrow(/valid calendar date/);
  });

  it("rejects a same-day policy (effective = expiration)", () => {
    expect(() => differenceInPolicyDays("2026-01-01", "2026-01-01")).toThrow(
      /must be after/
    );
  });

  it("handles a multi-year term (unearned ratio exactly 2/3)", () => {
    const result = calculateReturnPremium({
      policyEffectiveDate: "2025-01-01",
      policyExpirationDate: "2028-01-01",
      cancellationEffectiveDate: "2026-01-01",
      depositPremium: 30000,
      cancellationType: "insured"
    });

    expect(result.totalPolicyDays).toBe(1095);
    expect(result.earnedDays).toBe(365);
    expect(result.unearnedDays).toBe(730);
    expect(result.proRataFactor).toBe(0.666); // truncated, not 0.667
    expect(result.shortRateFactor).toBe(0.6); // 0.9 * 2/3, float noise cleaned
    expect(result.finalReturnPremium).toBe(18000);
    expectSaneMoney(result);
  });
});

describe("minimum earned premium edges", () => {
  const shortRateBase = {
    policyEffectiveDate: "2026-01-01",
    policyExpirationDate: "2027-01-01",
    cancellationEffectiveDate: "2026-07-01",
    depositPremium: 10000,
    cancellationType: "insured" as const
  };

  it("0% MEP is identical to omitting it", () => {
    const withZero = calculateReturnPremium({ ...shortRateBase, minimumEarnedPremiumPercent: 0 });
    const omitted = calculateReturnPremium(shortRateBase);

    expect(withZero).toEqual(omitted);
    expect(withZero.minimumBinds).toBe(false);
    expectSaneMoney(withZero);
  });

  it("100% MEP on the short-rate path returns zero", () => {
    const result = calculateReturnPremium({
      ...shortRateBase,
      minimumEarnedPremiumPercent: 100
    });

    expect(result.minimumApplies).toBe(true);
    expect(result.minimumBinds).toBe(true);
    expect(result.retainedViaMinimum).toBe(10000);
    expect(result.finalReturnPremium).toBe(0);
    expectSaneMoney(result);
  });

  it("MEP has zero effect on a company cancellation (mirrors Example D2 at 100%)", () => {
    const companyBase = {
      policyEffectiveDate: "2025-11-02",
      policyExpirationDate: "2026-11-02",
      cancellationEffectiveDate: "2026-03-13",
      depositPremium: 38805,
      cancellationType: "company" as const,
      preset: "standard" as const
    };
    const withMep = calculateReturnPremium({ ...companyBase, minimumEarnedPremiumPercent: 100 });
    const withoutMep = calculateReturnPremium(companyBase);

    expect(withMep.minimumApplies).toBe(false);
    expect(withMep.minimumBinds).toBe(false);
    expect(withMep.finalReturnPremium).toBe(24874); // Example C's full pro-rata, uncapped
    expect(withMep.finalReturnPremium).toBe(withoutMep.finalReturnPremium);
    expectSaneMoney(withMep);
  });
});

describe("premium edges", () => {
  const base = {
    policyEffectiveDate: "2026-01-01",
    policyExpirationDate: "2027-01-01",
    cancellationEffectiveDate: "2026-07-01",
    cancellationType: "insured" as const
  };

  it("zero premium yields zero dollars everywhere, never NaN", () => {
    const result = calculateReturnPremium({ ...base, depositPremium: 0 });

    expect(result.grossReturn).toBe(0);
    expect(result.finalReturnPremium).toBe(0);
    expect(result.retainedViaFactor).toBe(0);
    expect(result.retainedViaMinimum).toBe(0);
    expectSaneMoney(result);
  });

  it("negative premium throws instead of computing", () => {
    expect(() => calculateReturnPremium({ ...base, depositPremium: -1 })).toThrow(
      /non-negative/
    );
  });

  it("NaN and Infinity premiums throw (containment for upstream parse failures)", () => {
    expect(() => calculateReturnPremium({ ...base, depositPremium: NaN })).toThrow(
      /non-negative/
    );
    expect(() => calculateReturnPremium({ ...base, depositPremium: Infinity })).toThrow(
      /non-negative/
    );
  });

  it("sub-cent premium stresses roundToDollar into whole dollars", () => {
    const result = calculateReturnPremium({ ...base, depositPremium: 0.005 });

    expect(result.finalReturnPremium).toBe(0);
    expect(result.grossReturn).toBe(0);
    expectSaneMoney(result);
  });
});

describe("factor boundaries (extends the float-underflow guard)", () => {
  // 1000-day term: 2024-01-01 + 1000 days = 2026-09-27, so unearned-day counts map
  // directly to exact 3-decimal ratios.
  const thousandDayTerm = {
    policyEffectiveDate: "2024-01-01",
    policyExpirationDate: "2026-09-27",
    depositPremium: 100000,
    cancellationType: "insured" as const
  };

  it("ratio landing exactly on a 3-decimal boundary (641/1000)", () => {
    const result = calculateReturnPremium({
      ...thousandDayTerm,
      cancellationEffectiveDate: "2024-12-25"
    });

    expect(result.totalPolicyDays).toBe(1000);
    expect(result.unearnedDays).toBe(641);
    expect(result.proRataFactor).toBe(0.641); // not underflowed to 0.640
    expect(result.shortRateFactor).toBe(0.576); // raw 0.5769000...1 cleaned, then floored
    expect(result.finalReturnPremium).toBe(57600);
    expectSaneMoney(result);
  });

  it("ratio one day below the boundary (640/1000)", () => {
    const result = calculateReturnPremium({
      ...thousandDayTerm,
      cancellationEffectiveDate: "2024-12-26"
    });

    expect(result.unearnedDays).toBe(640);
    expect(result.proRataFactor).toBe(0.64);
    expect(result.finalReturnPremium).toBe(57600); // 0.9 * 0.64 = 0.576 exactly
    expectSaneMoney(result);
  });

  it("short-rate product landing exactly on a boundary (0.9 × 710/1000)", () => {
    const result = calculateReturnPremium({
      ...thousandDayTerm,
      cancellationEffectiveDate: "2024-10-17"
    });

    expect(result.unearnedDays).toBe(710);
    expect(result.proRataFactor).toBe(0.71);
    // Raw float is 0.6389999999999999 — the guard must land on 0.639, not 0.638.
    expect(result.shortRateFactor).toBe(0.639);
    expect(result.finalReturnPremium).toBe(63900);
    expectSaneMoney(result);
  });

  it("truncates day-ratio inputs on and around boundaries", () => {
    expect(truncateFactor(641 / 1000, 3)).toBe(0.641);
    expect(truncateFactor(640 / 1000, 3)).toBe(0.64);
    expect(truncateFactor(1 / 1000, 3)).toBe(0.001);
    expect(truncateFactor(999 / 1000, 3)).toBe(0.999);
    expect(truncateFactor(1 / 3, 3)).toBe(0.333);
    expect(truncateFactor(1, 3)).toBe(1);
    expect(truncateFactor(0.9 * (710 / 1000), 3)).toBe(0.639);
  });

  it("clamps non-positive and non-finite inputs to 0", () => {
    expect(truncateFactor(0, 3)).toBe(0);
    expect(truncateFactor(-0.5, 3)).toBe(0);
    expect(truncateFactor(NaN, 3)).toBe(0);
    expect(truncateFactor(Infinity, 3)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Parse layer. parseAmount and sanitizeNumericInput are private to App.tsx,
// which this diagnostic session must not modify. The copies below are verbatim
// mirrors; the integrity test asserts App.tsx still contains this exact source,
// so any drift fails loudly instead of silently testing a stale copy.
// ---------------------------------------------------------------------------

const PARSE_AMOUNT_SOURCE = `function parseAmount(value: string): number {
  if (value.trim() === "") {
    return 0;
  }

  return Number(value);
}`;

const SANITIZE_SOURCE = `function sanitizeNumericInput(value: string): string {
  const cleaned = value.replace(/[^\\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) {
    return cleaned;
  }
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\\./g, "");
}`;

function parseAmount(value: string): number {
  if (value.trim() === "") {
    return 0;
  }

  return Number(value);
}

function sanitizeNumericInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) {
    return cleaned;
  }
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

// The premium field's exact input path (App.tsx wires sanitizeNumericInput into
// onChange for premium only; MEP and fees fields store raw text).
function uiPremiumPipeline(pasted: string): number {
  return parseAmount(sanitizeNumericInput(pasted));
}

describe("parse layer (mirrored from App.tsx)", () => {
  it("mirrors are verbatim copies of the App.tsx source", async () => {
    // No @types/node in this repo; a computed specifier keeps tsc from trying
    // to resolve the module while vitest's node runtime imports it fine.
    const fs = (await import("node:" + "fs")) as unknown as {
      readFileSync: (path: URL, encoding: "utf8") => string;
    };
    const appSource = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    expect(appSource).toContain(PARSE_AMOUNT_SOURCE);
    expect(appSource).toContain(SANITIZE_SOURCE);
  });

  it("strips commas: \"1,000\" parses to 1000", () => {
    expect(uiPremiumPipeline("1,000")).toBe(1000);
  });

  it("strips currency symbols: \"$1000\" parses to 1000", () => {
    expect(uiPremiumPipeline("$1000")).toBe(1000);
  });

  it("strips surrounding whitespace: \" 1000 \" parses to 1000", () => {
    expect(uiPremiumPipeline(" 1000 ")).toBe(1000);
  });

  it("empty string parses to 0", () => {
    // For premium, App.tsx's validateForm blocks the empty string before this
    // runs; for MEP and fees an empty field legitimately means 0.
    expect(uiPremiumPipeline("")).toBe(0);
  });

  it("documents the scientific-notation corruption: \"1e5\" currently becomes 15", () => {
    // BUG (HANDOFF.md item 3): the sanitizer strips the "e", so a pasted
    // $100,000 silently becomes $15. This test pins today's broken value so the
    // corruption is visible; the it.fails test below asserts the correct one.
    expect(sanitizeNumericInput("1e5")).toBe("15");
    expect(uiPremiumPipeline("1e5")).toBe(15);
  });

  it.fails("\"1e5\" must parse to 100000, never silently corrupt", () => {
    // Correct behavior per HANDOFF.md: parse correctly or reject loudly, never
    // mangle. If the fix rejects instead of parsing, update this assertion.
    expect(uiPremiumPipeline("1e5")).toBe(100000);
  });

  it("Number() was never the problem — raw parseAmount handles \"1e5\"", () => {
    expect(parseAmount("1e5")).toBe(100000);
  });

  it("raw parseAmount yields NaN for \"1,000\", which the engine then rejects", () => {
    // MEP and fees fields skip the sanitizer; a comma there produces NaN, and
    // the engine's normalizeMoney guard throws rather than computing (see the
    // NaN premium test above).
    expect(Number.isNaN(parseAmount("1,000"))).toBe(true);
  });
});
