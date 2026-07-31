import { describe, expect, it } from "vitest";
import {
  calculateExtensionAp,
  EXPOSURE_ACCRUAL_ASSUMPTION,
  ExtensionApResult
} from "./extensionAp";

// Structural suite. These tests pin result SHAPE, null propagation, and the no-rounding
// rule — not dollar accuracy. Nothing here is tied to a real endorsement, so a green run
// is not evidence the AP math is right.

// The two AP paths are algebraically identical but not bit-identical: pro-rata takes 2
// roundings (P/T, x D), exposure-rated takes 6, and 1000 = 2^3 * 5^3 is not a power of
// two, so fl(x/1000) and fl(y*1000) each round and do not cancel.
//
// Measured, not guessed: 2,000,000 randomized fixtures (premium 1e-2..1e6, exposure
// 1e-2..1e12, term 1..4000 days, extension 0..term) — 1,996,034 usable, of which 47.17%
// were bit-exact. Worst observed relative error 6.1138e-16 = 2.75 x Number.EPSILON
// (4 ULP). Tolerance is set at 8 x EPSILON for ~2.9x headroom over that worst case.
// Re-run the sweep before changing this number; a real formula error diverges by percent,
// not by ULPs, so loosening it buys nothing and tightening it buys flakiness.
//
// Note this cites the RELATIVE error (2.75 x EPSILON), not the ULP count (4). Different
// metrics — the assertion below is relative, so reason about it in EPSILON units.
const CONVERGENCE_TOLERANCE = 8 * Number.EPSILON;

function expectConverges(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Number.isFinite(expected)).toBe(true);

  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  const relativeError = scale === 0 ? 0 : Math.abs(actual - expected) / scale;

  expect(relativeError).toBeLessThan(CONVERGENCE_TOLERANCE);
}

// Unlike expectSaneMoney in the cancellation suite, this does NOT require every field to
// be finite: impliedOriginalRate, exposureRatedAp, and divergence are legitimately null.
// What it does require is that they are null or finite — never NaN, never Infinity.
function expectStructurallySound(result: ExtensionApResult): void {
  expect(Number.isSafeInteger(result.originalTermDays)).toBe(true);
  expect(result.originalTermDays).toBeGreaterThan(0);
  expect(Number.isSafeInteger(result.additionalDays)).toBe(true);
  expect(result.additionalDays).toBeGreaterThanOrEqual(0);

  const alwaysFinite = [
    result.dailyPremium,
    result.dailyExposure,
    result.incrementalExposure,
    result.proRataAp
  ];
  for (const value of alwaysFinite) {
    expect(Number.isFinite(value)).toBe(true);
  }

  const nullable = [result.impliedOriginalRate, result.exposureRatedAp, result.divergence];
  for (const value of nullable) {
    expect(value === null || Number.isFinite(value)).toBe(true);
  }

  expect(result.exposureAccrualBasis).toBe("straightLine");
}

describe("structural invariants — NOT validated against real endorsements", () => {
  const base = {
    policyEffectiveDate: "2026-01-01",
    policyExpirationDate: "2027-01-01",
    extensionEndDate: "2027-03-01",
    originalPremium: 48000,
    originalExposure: 2400000
  };

  it("converges on the pro-rata answer when the tiered rate equals the implied rate", () => {
    const result = calculateExtensionAp({ ...base, tieredRatePer1000: 20 });

    expect(result.impliedOriginalRate).toBe(20); // (48000 / 2400000) * 1000
    expect(result.proRataAp).toBe(7758.904109589042);
    expectConverges(result.exposureRatedAp as number, result.proRataAp);
    expectStructurallySound(result);
  });

  it("converges without being bit-identical, because the paths round differently", () => {
    const result = calculateExtensionAp({ ...base, tieredRatePer1000: 20 });

    // 6 roundings vs 2. This is why the convergence check is a relative tolerance and
    // must never be "simplified" to toBe — that would fail on this exact fixture.
    expect(result.exposureRatedAp).not.toBe(result.proRataAp);
    expect(result.exposureRatedAp).toBe(7758.904109589041); // vs 7758.904109589042
    expect(result.divergence).toBe(-9.094947017729282e-13); // not 0
    expectStructurallySound(result);
  });

  it("diverges by the rate delta when the tiered rate exceeds the implied rate", () => {
    const result = calculateExtensionAp({ ...base, tieredRatePer1000: 26 });

    expect(result.incrementalExposure).toBe(387945.20547945204);
    expect(result.exposureRatedAp).toBe(10086.575342465754);
    expect(result.divergence).toBe(2327.6712328767126);
    expect(result.divergence as number).toBeGreaterThan(0); // exposure rating charges more
    expectStructurallySound(result);
  });

  it("names no winner — exposes both AP paths and no selected method", () => {
    const result = calculateExtensionAp({ ...base, tieredRatePer1000: 26 });

    // Adding a recommendedAp / selectedMethod field must fail this test.
    expect(Object.keys(result).sort()).toEqual([
      "additionalDays",
      "dailyExposure",
      "dailyPremium",
      "divergence",
      "exposureAccrualBasis",
      "exposureRatedAp",
      "impliedOriginalRate",
      "incrementalExposure",
      "originalTermDays",
      "proRataAp"
    ]);
  });

  it("returns zero on both AP paths when the extension ends on the expiration date", () => {
    const result = calculateExtensionAp({
      ...base,
      extensionEndDate: "2027-01-01",
      tieredRatePer1000: 26
    });

    expect(result.additionalDays).toBe(0);
    expect(result.incrementalExposure).toBe(0);
    expect(result.proRataAp).toBe(0);
    expect(result.exposureRatedAp).toBe(0);
    expect(result.divergence).toBe(0);
    expectStructurallySound(result);
  });

  it("rejects an extension end date before the policy expiration date", () => {
    expect(() =>
      calculateExtensionAp({ ...base, extensionEndDate: "2026-12-01", tieredRatePer1000: 26 })
    ).toThrow(/on or after/i);
  });

  it("rejects an extension end date before the policy effective date", () => {
    expect(() =>
      calculateExtensionAp({ ...base, extensionEndDate: "2025-12-01", tieredRatePer1000: 26 })
    ).toThrow(/on or after/i);
  });

  it("returns a null implied rate when exposure is zero, sparing the pro-rata path", () => {
    const result = calculateExtensionAp({
      ...base,
      originalExposure: 0,
      tieredRatePer1000: 26
    });

    expect(result.impliedOriginalRate).toBeNull(); // not Infinity, not 0
    expect(result.incrementalExposure).toBe(0);
    expect(result.exposureRatedAp).toBe(0); // legitimately 0 — zero exposure earns nothing
    expect(result.proRataAp).toBe(7758.904109589042); // unpoisoned by the zero exposure
    expect(result.divergence).toBe(-result.proRataAp);
    expectStructurallySound(result);
  });

  it("returns a null implied rate when both premium and exposure are zero", () => {
    const result = calculateExtensionAp({
      ...base,
      originalPremium: 0,
      originalExposure: 0,
      tieredRatePer1000: 26
    });

    expect(result.impliedOriginalRate).toBeNull(); // the 0/0 shape — not NaN
    expect(result.proRataAp).toBe(0);
    expect(result.exposureRatedAp).toBe(0);
    expect(result.divergence).toBe(0);
    expectStructurallySound(result);
  });

  it("leaves the exposure-rated path null when no tiered rate is supplied", () => {
    const result = calculateExtensionAp(base);

    expect(result.exposureRatedAp).toBeNull();
    expect(result.divergence).toBeNull();
    expectStructurallySound(result);
  });

  it("does not let a missing tiered rate poison the pro-rata path", () => {
    const result = calculateExtensionAp(base);

    // A `?? 0` default would instead have reported exposureRatedAp $0 and divergence
    // -$7,758.90 — both of which read as real answers to a question never asked.
    expect(result.additionalDays).toBe(59);
    expect(result.incrementalExposure).toBe(387945.20547945204);
    expect(result.impliedOriginalRate).toBe(20);
    expect(result.proRataAp).toBe(7758.904109589042);
    expectStructurallySound(result);
  });

  it("rejects an explicitly non-finite or negative tiered rate", () => {
    for (const hostile of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      // NaN is rejected, not treated as "omitted" — a failed upstream parse must fail
      // loudly rather than quietly becoming "no exposure-rated answer."
      expect(() => calculateExtensionAp({ ...base, tieredRatePer1000: hostile })).toThrow(
        /non-negative/i
      );
    }
  });

  it("rejects a non-positive original term", () => {
    expect(() =>
      calculateExtensionAp({ ...base, policyExpirationDate: "2026-01-01" })
    ).toThrow(/must be after/);
    expect(() =>
      calculateExtensionAp({ ...base, policyEffectiveDate: "2027-06-01" })
    ).toThrow(/must be after/);
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => calculateExtensionAp({ ...base, policyEffectiveDate: "2026-1-1" })).toThrow(
      /YYYY-MM-DD/
    );
    expect(() => calculateExtensionAp({ ...base, extensionEndDate: "2027-02-29" })).toThrow(
      /valid calendar date/i
    );
  });

  it("rejects negative and non-finite premium and exposure", () => {
    for (const hostile of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateExtensionAp({ ...base, originalPremium: hostile })).toThrow(
        /non-negative/i
      );
      expect(() => calculateExtensionAp({ ...base, originalExposure: hostile })).toThrow(
        /non-negative/i
      );
    }
  });

  it("counts calendar days across a leap year with exact arithmetic", () => {
    const result = calculateExtensionAp({
      policyEffectiveDate: "2024-01-01",
      policyExpirationDate: "2025-01-01",
      extensionEndDate: "2025-03-01",
      originalPremium: 36600,
      originalExposure: 3660000,
      tieredRatePer1000: 10
    });

    // Every intermediate is exactly representable here, so the two paths agree bit-for-bit.
    // This is an arithmetic accident of the fixture, NOT the general rule — do not promote
    // it into the convergence test.
    expect(result.originalTermDays).toBe(366);
    expect(result.dailyPremium).toBe(100);
    expect(result.dailyExposure).toBe(10000);
    expect(result.incrementalExposure).toBe(590000);
    expect(result.proRataAp).toBe(5900);
    expect(result.exposureRatedAp).toBe(5900);
    expect(result.divergence).toBe(0);
    expectStructurallySound(result);
  });

  it("returns raw floats — nothing rounded, truncated, or snapped to whole dollars", () => {
    const result = calculateExtensionAp({
      policyEffectiveDate: "2024-01-01",
      policyExpirationDate: "2025-01-01",
      extensionEndDate: "2025-01-18",
      originalPremium: 12345.67,
      originalExposure: 987654.32,
      tieredRatePer1000: 12.5
    });

    // Not 573, not 573.43, not 12.5 — the rounding convention for extension endorsements
    // is unknown and this module must not invent one.
    expect(result.proRataAp).toBe(573.4327595628416);
    expect(result.exposureRatedAp).toBe(573.4331775956283);
    expect(result.impliedOriginalRate).toBe(12.49999088749999);
    expect(result.divergence).toBe(0.0004180327866833977);
    expect(Number.isInteger(result.proRataAp)).toBe(false);
    expectStructurallySound(result);
  });

  it("stamps every result with the straight-line exposure accrual basis", () => {
    const result = calculateExtensionAp({ ...base, tieredRatePer1000: 26 });

    expect(result.exposureAccrualBasis).toBe("straightLine");
    expect(EXPOSURE_ACCRUAL_ASSUMPTION).toMatch(/straight-line/i);
    expect(EXPOSURE_ACCRUAL_ASSUMPTION).toMatch(/seasonal/i);
    expectStructurallySound(result);
  });
});
