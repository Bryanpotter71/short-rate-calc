// Extension-endorsement Additional Premium for exposure-rated GL.
//
// UNVALIDATED. This module ties to no real endorsement. It exists to expose the gap
// between two defensible ways to price an extension — straight pro-rata on time, and
// exposure-rated on the incremental exposure the extra days generate — and it
// deliberately picks no winner between them.
//
// NO ROUNDING is applied anywhere: no truncation to 3 decimals, no round-to-dollar, no
// currency formatting (formatting is itself a rounding decision). The rounding convention
// for extension endorsements is unknown, and this module must not invent one. The only
// Math.round in this file is the day-count guard, which is a DST/leap no-op — see
// differenceInDays.
//
// The date/money helpers below duplicate calculations.ts on purpose. The two modules are
// intentionally uncoupled so that this unvalidated math can never drift into the
// validated cancellation engine. Do not "DRY it up" by importing across them.

// How exposure is assumed to accrue across the original term. Single-member on purpose:
// adding a second basis forces every exhaustive switch to be revisited, so the assumption
// breaks loudly instead of becoming one quiet case among many.
export type ExposureAccrualBasis = "straightLine";

export interface ExtensionApInput {
  policyEffectiveDate: string; // YYYY-MM-DD
  policyExpirationDate: string; // YYYY-MM-DD — the expiration the endorsement extends past
  extensionEndDate: string; // YYYY-MM-DD — new expiration under the endorsement
  originalPremium: number; // premium for the ORIGINAL term only — not annualized
  originalExposure: number; // rated exposure base for the original term — see the assumption
  tieredRatePer1000?: number; // rate per $1,000 of exposure; absent = no exposure-rated answer
}

export interface ExtensionApResult {
  originalTermDays: number; // expiration - effective; guaranteed > 0
  additionalDays: number; // extensionEndDate - expiration; >= 0 (negative throws)
  dailyPremium: number; // originalPremium / originalTermDays — raw
  dailyExposure: number; // originalExposure / originalTermDays — the straight-line assumption
  incrementalExposure: number; // dailyExposure * additionalDays
  impliedOriginalRate: number | null; // (premium / exposure) * 1000; null when exposure is 0
  proRataAp: number; // dailyPremium * additionalDays — the time-based answer
  exposureRatedAp: number | null; // (incrementalExposure / 1000) * rate; null when no rate
  divergence: number | null; // exposureRatedAp - proRataAp; positive = exposure rating charges more
  exposureAccrualBasis: ExposureAccrualBasis; // always "straightLine" — the assumption, stamped
}

// Single source for the caveat any UI must render alongside these numbers. Kept here so
// the sentence cannot drift away from the math it describes.
export const EXPOSURE_ACCRUAL_ASSUMPTION =
  "Exposure is assumed to accrue straight-line across the original term: the extension is " +
  "charged the original term's average daily exposure. Seasonal or campaign-driven " +
  "operations violate this assumption.";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPOSURE_RATE_UNIT = 1000; // rates are quoted per $1,000 of exposure

export function calculateExtensionAp(input: ExtensionApInput): ExtensionApResult {
  const policyEffective = parseDateOnly(input.policyEffectiveDate, "Policy effective date");
  const policyExpiration = parseDateOnly(input.policyExpirationDate, "Policy expiration date");
  const extensionEnd = parseDateOnly(input.extensionEndDate, "Extension end date");

  const originalTermDays = differenceInDays(policyEffective, policyExpiration);

  if (originalTermDays <= 0) {
    throw new Error("Policy expiration date must be after the policy effective date.");
  }

  // A backdated extension end date is rejected rather than reported as a negative AP. An
  // endorsement that shortens the term is a return-premium problem, not this calculation.
  const additionalDays = differenceInDays(policyExpiration, extensionEnd);

  if (additionalDays < 0) {
    throw new Error("Extension end date must be on or after the policy expiration date.");
  }

  const originalPremium = normalizeMoney(input.originalPremium, "Original premium");
  const originalExposure = normalizeMoney(input.originalExposure, "Original exposure");
  const tieredRatePer1000 = normalizeOptionalRate(
    input.tieredRatePer1000,
    "Tiered rate per $1,000"
  );

  // THE ASSUMPTION: exposure accrues straight-line across the original term. Dividing the
  // term's exposure by its days and charging that constant daily figure across the
  // extension is only right if operations are level. Seasonal work — construction,
  // events, snow removal, campaign-driven sales — accrues exposure in bursts, and for
  // those risks this figure is wrong in a direction this module has no way to know.
  const dailyPremium = originalPremium / originalTermDays;
  const dailyExposure = originalExposure / originalTermDays;
  const incrementalExposure = dailyExposure * additionalDays;

  // Zero exposure makes the implied rate unknowable, not zero: premium > 0 would divide
  // to Infinity and premium === 0 would give NaN. Both are reported as null so no caller
  // can mistake a non-finite artifact for a rate anyone charged.
  const impliedOriginalRate =
    originalExposure === 0 ? null : (originalPremium / originalExposure) * EXPOSURE_RATE_UNIT;

  // Both answers are returned. Which one is correct for a given endorsement is exactly
  // what this module cannot know, so it does not choose — the caller sees the divergence.
  const proRataAp = dailyPremium * additionalDays;
  const exposureRatedAp =
    tieredRatePer1000 === null
      ? null
      : (incrementalExposure / EXPOSURE_RATE_UNIT) * tieredRatePer1000;
  const divergence = exposureRatedAp === null ? null : exposureRatedAp - proRataAp;

  return {
    originalTermDays,
    additionalDays,
    dailyPremium,
    dailyExposure,
    incrementalExposure,
    impliedOriginalRate,
    proRataAp,
    exposureRatedAp,
    divergence,
    exposureAccrualBasis: "straightLine"
  };
}

// Math.round here absorbs DST and leap-second drift on UTC date-only values — it is a
// no-op guard on exact day boundaries, NOT a rounding convention. It is the only rounding
// call this module is permitted to make.
function differenceInDays(startDate: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);
}

function parseDateOnly(dateValue: string, label: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);

  if (!match) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be a valid calendar date.`);
  }

  return parsed;
}

function normalizeMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return value;
}

// Absent means "no exposure-rated answer exists" and yields null. An explicitly supplied
// NaN is rejected instead of being treated as absent — a failed upstream parse must fail
// loudly, never quietly become "no answer."
function normalizeOptionalRate(value: number | undefined, label: string): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return value;
}
