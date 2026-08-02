// Extension-endorsement Additional Premium — proof-of-concept UI.
//
// Renders the two candidate methods extensionAp.ts computes, at equal weight, and the
// divergence between them. It selects no method, because the module deliberately
// doesn't either. All 2-decimal formatting lives HERE, in the UI layer: formatting is a
// rounding decision, and extensionAp.ts must keep returning raw floats.
import { useMemo, useState } from "react";
import { calculateExtensionAp, EXPOSURE_ACCRUAL_ASSUMPTION } from "./lib/extensionAp";
import type { ExtensionApResult } from "./lib/extensionAp";
import { formatCurrency } from "./lib/calculations";
// App.tsx imports this file for the tab shell, so this import closes a cycle. It is safe
// and deliberate: every binding below is read inside the component body or inside a
// function called from it — i.e. at render time, after both modules have finished
// evaluating. Do not move any of these reads to module scope.
import {
  Field,
  Step,
  formatNumberInput,
  isNumericText,
  parseAmount,
  PREMIUM_CHARACTER_ERROR,
  sanitizeNumericInput
} from "./App";

const POC_BANNER =
  "Proof of concept. Computes two candidate methods side by side, applies no rounding " +
  "convention, and selects no method. Not validated against real endorsements — not for quoting.";

// Same format guard App.validateForm uses. Re-declared rather than exported from App:
// it is a one-line format check, and widening App's export surface past the four input
// primitives buys nothing.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Parallel to PREMIUM_CHARACTER_ERROR, which is imported and used verbatim on the premium
// field. Same gate (isNumericText), same error UI — only the noun changes, because a field
// labelled "Original exposure" must not report an error about risk premium.
const EXPOSURE_CHARACTER_ERROR =
  "Original exposure must be plain digits — e.g. 100000 or 1234.56. Scientific notation, signs, and letters aren't accepted.";

const RATE_CHARACTER_ERROR =
  "Tiered rate must be plain digits — e.g. 6 or 5.25. Scientific notation, signs, and letters aren't accepted.";

export interface ExtensionApFormState {
  policyEffectiveDate: string;
  policyExpirationDate: string;
  extensionEndDate: string;
  originalPremium: string;
  originalExposure: string;
  tieredRatePer1000: string;
}

// Seeded so first paint tells the whole story: implied rate $5.00 against a tiered rate
// of 6 puts both cards on screen with a positive divergence, which is what this tab
// exists to show. The null case (blank rate -> "—") is one keystroke away.
export const initialExtensionApFormState: ExtensionApFormState = {
  policyEffectiveDate: "2026-01-01",
  policyExpirationDate: "2027-01-01",
  extensionEndDate: "2027-02-01",
  originalPremium: "10000",
  originalExposure: "2000000",
  tieredRatePer1000: "6"
};

type ExtensionApFieldErrors = Partial<Record<keyof ExtensionApFormState, string>>;

export function validateExtensionApForm(form: ExtensionApFormState): ExtensionApFieldErrors {
  const errors: ExtensionApFieldErrors = {};
  const eff = form.policyEffectiveDate;
  const exp = form.policyExpirationDate;
  const end = form.extensionEndDate;

  const validDate = (value: string) => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

  if (!validDate(eff)) errors.policyEffectiveDate = "Enter a valid policy effective date.";
  if (!validDate(exp)) errors.policyExpirationDate = "Enter a valid policy expiration date.";
  if (!validDate(end)) errors.extensionEndDate = "Enter a valid extension end date.";

  if (!errors.policyEffectiveDate && !errors.policyExpirationDate && exp <= eff) {
    errors.policyExpirationDate = "Expiration must be after the effective date.";
  }
  if (!errors.policyExpirationDate && !errors.extensionEndDate && end < exp) {
    errors.extensionEndDate = "Extension end can't be before the expiration date.";
  }

  const premium = form.originalPremium.trim();
  if (premium === "") {
    errors.originalPremium = "Enter the original premium.";
  } else if (!isNumericText(premium)) {
    errors.originalPremium = PREMIUM_CHARACTER_ERROR;
  } else if (!Number.isFinite(Number(premium)) || Number(premium) < 0) {
    errors.originalPremium = "Original premium must be a non-negative number.";
  }

  const exposure = form.originalExposure.trim();
  if (exposure === "") {
    errors.originalExposure = "Enter the original exposure.";
  } else if (!isNumericText(exposure)) {
    errors.originalExposure = EXPOSURE_CHARACTER_ERROR;
  } else if (!Number.isFinite(Number(exposure)) || Number(exposure) < 0) {
    errors.originalExposure = "Original exposure must be a non-negative number.";
  }

  // Optional. Blank is legal and means "no exposure-rated answer exists". Anything
  // present runs the same character gate as the money fields — a pasted "1e5" rate has
  // to be refused here too, not silently read as 15.
  const rate = form.tieredRatePer1000.trim();
  if (rate !== "") {
    if (!isNumericText(rate)) {
      errors.tieredRatePer1000 = RATE_CHARACTER_ERROR;
    } else if (!Number.isFinite(Number(rate)) || Number(rate) < 0) {
      errors.tieredRatePer1000 = "Tiered rate must be a non-negative number.";
    }
  }

  return errors;
}

// null is "not computable" and must never look like an answer. Zero IS an answer.
export function formatMoney(value: number | null): string {
  return value === null ? "—" : formatCurrency(value);
}

// The sign is decided from the FORMATTED magnitude, not the raw float. Setting the
// tiered rate equal to the implied rate converges the two methods to within a few
// float ulps, not to exact zero — divergence lands around -1e-13. Signing off the raw
// value renders that as "-$0.00", which reads as "slightly under" when the true
// statement is "these two methods agree". Anything that rounds to zero at the
// displayed precision therefore renders unsigned. Raw floats are still shown
// unrounded in the breakdown, so no precision is hidden, only mis-signed.
export function formatSignedMoney(value: number | null): string {
  if (value === null) return "—";
  const magnitude = formatCurrency(Math.abs(value));
  if (magnitude === formatCurrency(0)) return magnitude;
  return value > 0 ? `+${magnitude}` : `−${magnitude}`;
}

function ExtensionApTab() {
  const [form, setForm] = useState<ExtensionApFormState>(initialExtensionApFormState);

  const errors = useMemo(() => validateExtensionApForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const calculation = useMemo(() => {
    if (hasErrors) {
      return { result: null as ExtensionApResult | null, error: null as string | null };
    }

    try {
      const rate = form.tieredRatePer1000.trim();
      const result = calculateExtensionAp({
        policyEffectiveDate: form.policyEffectiveDate,
        policyExpirationDate: form.policyExpirationDate,
        extensionEndDate: form.extensionEndDate,
        originalPremium: parseAmount(form.originalPremium),
        originalExposure: parseAmount(form.originalExposure),
        // "" must become undefined, NOT 0. undefined means "no exposure-rated answer
        // exists" and renders as "—"; 0 is a real rate that yields a real $0.00 answer.
        tieredRatePer1000: rate === "" ? undefined : Number(rate)
      });

      return { result, error: null as string | null };
    } catch (error) {
      // The module throws on backdated extension ends, non-positive terms, malformed
      // dates, and negative/non-finite inputs. Every one of those renders through the
      // existing error UI below — a throw must never blank the page.
      return {
        result: null as ExtensionApResult | null,
        error: error instanceof Error ? error.message : "Unable to calculate extension AP."
      };
    }
  }, [form, hasErrors]);

  const setField = <K extends keyof ExtensionApFormState>(
    field: K,
    value: ExtensionApFormState[K]
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const result = calculation.result;

  return (
    <section className="workspace" aria-label="Extension additional premium">
      <form className="calculator-panel" onSubmit={(event) => event.preventDefault()} noValidate>
        <div className="panel-heading">
          <h2>Extension Inputs</h2>
          <p>Original term, the endorsement's new end date, and the original rating basis.</p>
        </div>

        <div className="field-grid">
          <Field
            label="Policy effective date"
            htmlFor="ap-policy-effective-date"
            error={errors.policyEffectiveDate}
          >
            <input
              id="ap-policy-effective-date"
              type="date"
              aria-invalid={Boolean(errors.policyEffectiveDate)}
              value={form.policyEffectiveDate}
              onChange={(event) => setField("policyEffectiveDate", event.target.value)}
            />
          </Field>

          <Field
            label="Policy expiration date"
            htmlFor="ap-policy-expiration-date"
            error={errors.policyExpirationDate}
            hint="The expiration the endorsement extends past."
          >
            <input
              id="ap-policy-expiration-date"
              type="date"
              aria-invalid={Boolean(errors.policyExpirationDate)}
              value={form.policyExpirationDate}
              onChange={(event) => setField("policyExpirationDate", event.target.value)}
            />
          </Field>

          <Field
            label="Extension end date"
            htmlFor="ap-extension-end-date"
            error={errors.extensionEndDate}
            hint="New expiration under the endorsement."
          >
            <input
              id="ap-extension-end-date"
              type="date"
              aria-invalid={Boolean(errors.extensionEndDate)}
              value={form.extensionEndDate}
              onChange={(event) => setField("extensionEndDate", event.target.value)}
            />
          </Field>

          <Field
            label="Original premium"
            htmlFor="ap-original-premium"
            error={errors.originalPremium}
            hint="Premium for the original term only — not annualized."
          >
            <input
              id="ap-original-premium"
              type="text"
              inputMode="decimal"
              aria-invalid={Boolean(errors.originalPremium)}
              value={formatNumberInput(form.originalPremium)}
              onChange={(event) =>
                setField("originalPremium", sanitizeNumericInput(event.target.value))
              }
            />
          </Field>

          <Field
            label="Original exposure"
            htmlFor="ap-original-exposure"
            error={errors.originalExposure}
            hint="Rated exposure base for the original term."
          >
            <input
              id="ap-original-exposure"
              type="text"
              inputMode="decimal"
              aria-invalid={Boolean(errors.originalExposure)}
              value={formatNumberInput(form.originalExposure)}
              onChange={(event) =>
                setField("originalExposure", sanitizeNumericInput(event.target.value))
              }
            />
          </Field>

          <Field
            label="Tiered rate per $1,000 (optional)"
            htmlFor="ap-tiered-rate"
            error={errors.tieredRatePer1000}
            hint="Leave blank for no exposure-rated answer."
          >
            <input
              id="ap-tiered-rate"
              type="text"
              inputMode="decimal"
              aria-invalid={Boolean(errors.tieredRatePer1000)}
              value={formatNumberInput(form.tieredRatePer1000)}
              onChange={(event) =>
                setField("tieredRatePer1000", sanitizeNumericInput(event.target.value))
              }
            />
          </Field>

          <div className="implied-rate">
            <span>Implied original rate</span>
            <strong>{formatMoney(result ? result.impliedOriginalRate : null)}</strong>
            <em>
              per $1,000 — original premium ÷ original exposure. Rate above it and you're
              rating the extension up; match it and divergence goes to ~0.
            </em>
          </div>
        </div>
      </form>

      <aside className="results-panel" aria-label="Extension AP results">
        <div className="panel-heading">
          <h2>Candidate Methods</h2>
          <p>Two defensible answers, side by side. This tool picks neither.</p>
        </div>

        <div className="poc-banner" role="note">
          {POC_BANNER}
        </div>

        {hasErrors ? (
          <div className="results-placeholder" role="status">
            Complete the highlighted fields to see the calculation.
          </div>
        ) : calculation.error ? (
          <div className="error-message" role="alert">
            {calculation.error}
          </div>
        ) : result ? (
          <>
            <div className="ap-card-grid">
              <div className="ap-card">
                <span>Pro-rata AP</span>
                <strong>{formatMoney(result.proRataAp)}</strong>
                <em>time-based — daily premium × additional days</em>
              </div>
              <div className="ap-card">
                <span>Exposure-rated AP</span>
                <strong>{formatMoney(result.exposureRatedAp)}</strong>
                <em>incremental exposure ÷ 1,000 × tiered rate</em>
              </div>
            </div>

            <div className="divergence-row">
              <span>Exposure-rated − pro-rata</span>
              <strong>{formatSignedMoney(result.divergence)}</strong>
            </div>

            <div className="breakdown">
              <h3>Breakdown</h3>
              <ol className="breakdown-steps">
                <Step
                  label="Original term"
                  value={`${result.originalTermDays} days`}
                  note={`${form.policyEffectiveDate} → ${form.policyExpirationDate}`}
                />
                <Step
                  label="Additional days"
                  value={`${result.additionalDays} days`}
                  note={`${form.policyExpirationDate} → ${form.extensionEndDate}`}
                />
                <Step label="Daily premium" value={String(result.dailyPremium)} />
                <Step
                  label="Daily exposure"
                  value={String(result.dailyExposure)}
                  note="straight-line across the original term"
                />
                <Step label="Incremental exposure" value={String(result.incrementalExposure)} />
                <Step
                  label="Pro-rata AP (raw)"
                  value={String(result.proRataAp)}
                  note="raw — no rounding convention applied"
                />
                <Step
                  label="Exposure-rated AP (raw)"
                  value={result.exposureRatedAp === null ? "—" : String(result.exposureRatedAp)}
                  note="raw — no rounding convention applied"
                />
                <Step
                  label="Exposure accrual basis"
                  value={result.exposureAccrualBasis}
                  isFinal
                />
              </ol>
            </div>

            <p className="assumption-caveat">{EXPOSURE_ACCRUAL_ASSUMPTION}</p>
          </>
        ) : null}
      </aside>
    </section>
  );
}

export default ExtensionApTab;
