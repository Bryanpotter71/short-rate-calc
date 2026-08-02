import { useMemo, useState } from "react";
import ExtensionApTab from "./ExtensionApTab";
import {
  buildCalculationNote,
  calculateReturnPremium,
  formatCurrency
} from "./lib/calculations";
import type {
  CancellationType,
  CalculationPreset,
  CalculationResult,
  TriaTier
} from "./lib/calculations";

const DISCLAIMER =
  "For estimate and audit support only. Final premium return depends on policy wording, endorsements, fees, taxes, filings, billing rules, and applicable law.";

export interface FormState {
  policyEffectiveDate: string;
  policyExpirationDate: string;
  cancellationEffectiveDate: string;
  depositPremium: string;
  minimumEarnedPremiumPercent: string;
  cancellationType: CancellationType;
  fullyEarnedCharges: string;
  preset: CalculationPreset;
  triaTier: TriaTier;
}

export const initialFormState: FormState = {
  policyEffectiveDate: "2026-01-01",
  policyExpirationDate: "2027-01-01",
  cancellationEffectiveDate: "2026-07-01",
  depositPremium: "10000",
  minimumEarnedPremiumPercent: "25",
  cancellationType: "insured",
  fullyEarnedCharges: "0",
  preset: "minimumPremiumEndorsement",
  triaTier: "none"
};

type FieldErrors = Partial<Record<keyof FormState, string>>;
type CopyTarget = "summary" | "note";
type TabId = "cancellation" | "extensionAp";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Unambiguous FORMATTING: a currency symbol, thousands separators, and surrounding
// whitespace carry no magnitude and no sign, so a value has exactly one honest
// reading with them removed. Commas are also our own output — formatNumberInput
// re-inserts them and the browser returns them on the next keystroke.
const FORMATTING_NOISE = /[$,]/g;

// Digits with at most one decimal point. Anything else — "e"/"E", letters, signs,
// a second ".", interior spaces — creates VALUE AMBIGUITY. Ambiguity must interrupt
// the user, never be guessed at: stripping the "e" from a pasted "1e5" silently
// turned $100,000 into $15.
const NUMERIC_TEXT = /^\d*\.?\d*$/;

export function isNumericText(value: string): boolean {
  return NUMERIC_TEXT.test(value);
}

export const PREMIUM_CHARACTER_ERROR =
  "Risk premium must be plain digits — e.g. 100000 or 1234.56. Scientific notation, signs, and letters aren't accepted.";

export function validateForm(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const eff = form.policyEffectiveDate;
  const exp = form.policyExpirationDate;
  const can = form.cancellationEffectiveDate;

  const validDate = (value: string) => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

  if (!validDate(eff)) errors.policyEffectiveDate = "Enter a valid policy effective date.";
  if (!validDate(exp)) errors.policyExpirationDate = "Enter a valid policy expiration date.";
  if (!validDate(can)) errors.cancellationEffectiveDate = "Enter a valid cancellation effective date.";

  if (!errors.policyEffectiveDate && !errors.policyExpirationDate && exp <= eff) {
    errors.policyExpirationDate = "Expiration must be after the effective date.";
  }
  if (!errors.policyEffectiveDate && !errors.cancellationEffectiveDate && can < eff) {
    errors.cancellationEffectiveDate = "Cancellation can't be before the effective date.";
  }
  if (
    !errors.policyEffectiveDate &&
    !errors.policyExpirationDate &&
    !errors.cancellationEffectiveDate &&
    can > exp
  ) {
    errors.cancellationEffectiveDate = "Cancellation can't be after the expiration date.";
  }

  const premium = form.depositPremium.trim();
  if (premium === "") {
    errors.depositPremium = "Enter the risk premium.";
  } else if (!isNumericText(premium)) {
    errors.depositPremium = PREMIUM_CHARACTER_ERROR;
  } else if (!Number.isFinite(Number(premium)) || Number(premium) < 0) {
    errors.depositPremium = "Risk premium must be a non-negative number.";
  }

  const mep = form.minimumEarnedPremiumPercent.trim();
  if (mep !== "") {
    const value = Number(mep);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors.minimumEarnedPremiumPercent = "Use a percentage between 0 and 100.";
    }
  }

  const charges = form.fullyEarnedCharges.trim();
  if (charges !== "") {
    const value = Number(charges);
    if (!Number.isFinite(value) || value < 0) {
      errors.fullyEarnedCharges = "Fees must be a non-negative number.";
    }
  }

  return errors;
}

function App() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  // Tab one's form state lives here, not inside the panel, so switching tabs and back
  // preserves everything the user typed.
  const [activeTab, setActiveTab] = useState<TabId>("cancellation");

  const errors = useMemo(() => validateForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const calculation = useMemo(() => {
    if (hasErrors) {
      return { result: null as CalculationResult | null, note: "", error: null as string | null };
    }

    try {
      const result = calculateReturnPremium({
        policyEffectiveDate: form.policyEffectiveDate,
        policyExpirationDate: form.policyExpirationDate,
        cancellationEffectiveDate: form.cancellationEffectiveDate,
        depositPremium: parseAmount(form.depositPremium),
        minimumEarnedPremiumPercent: parseAmount(form.minimumEarnedPremiumPercent),
        cancellationType: form.cancellationType,
        fullyEarnedCharges: parseAmount(form.fullyEarnedCharges),
        preset: form.preset,
        triaTier: form.triaTier
      });

      return { result, note: buildCalculationNote(result), error: null as string | null };
    } catch (error) {
      return {
        result: null as CalculationResult | null,
        note: "",
        error: error instanceof Error ? error.message : "Unable to calculate return premium."
      };
    }
  }, [form, hasErrors]);

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setCopied(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const result = calculation.result;
  const summaryText = result ? buildSummaryText(form, result) : "";

  const copyText = async (text: string, target: CopyTarget) => {
    if (!text || !navigator.clipboard?.writeText) {
      setCopied(null);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
    } catch {
      setCopied(null);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">Cancellation Toolkit</span>
          <h1>E&amp;S Return Premium Calculator</h1>
          <p>Estimate short-rate and pro-rata return premium on cancelled excess &amp; surplus lines policies.</p>
        </div>
      </header>

      <div className="tablist" role="tablist" aria-label="Calculators">
        <button
          type="button"
          role="tab"
          id="tab-cancellation"
          aria-selected={activeTab === "cancellation"}
          aria-controls="panel-cancellation"
          className={`tab${activeTab === "cancellation" ? " is-active" : ""}`}
          onClick={() => setActiveTab("cancellation")}
        >
          Return premium
        </button>
        <button
          type="button"
          role="tab"
          id="tab-extension-ap"
          aria-selected={activeTab === "extensionAp"}
          aria-controls="panel-extension-ap"
          className={`tab${activeTab === "extensionAp" ? " is-active" : ""}`}
          onClick={() => setActiveTab("extensionAp")}
        >
          Extension AP
        </button>
      </div>

      {activeTab === "cancellation" ? (
        <div role="tabpanel" id="panel-cancellation" aria-labelledby="tab-cancellation">
          <section className="workspace" aria-label="Return premium calculator">
            <form className="calculator-panel" onSubmit={(event) => event.preventDefault()} noValidate>
              <div className="panel-heading">
                <h2>Policy Inputs</h2>
                <p>Use sanitized values for estimation and audit review.</p>
              </div>

              <div className="field-grid">
                <Field
                  label="Policy effective date"
                  htmlFor="policy-effective-date"
                  error={errors.policyEffectiveDate}
                >
                  <input
                    id="policy-effective-date"
                    type="date"
                    aria-invalid={Boolean(errors.policyEffectiveDate)}
                    value={form.policyEffectiveDate}
                    onChange={(event) => setField("policyEffectiveDate", event.target.value)}
                  />
                </Field>

                <Field
                  label="Policy expiration date"
                  htmlFor="policy-expiration-date"
                  error={errors.policyExpirationDate}
                >
                  <input
                    id="policy-expiration-date"
                    type="date"
                    aria-invalid={Boolean(errors.policyExpirationDate)}
                    value={form.policyExpirationDate}
                    onChange={(event) => setField("policyExpirationDate", event.target.value)}
                  />
                </Field>

                <Field
                  label="Cancellation effective date"
                  htmlFor="cancellation-effective-date"
                  error={errors.cancellationEffectiveDate}
                >
                  <input
                    id="cancellation-effective-date"
                    type="date"
                    aria-invalid={Boolean(errors.cancellationEffectiveDate)}
                    value={form.cancellationEffectiveDate}
                    onChange={(event) => setField("cancellationEffectiveDate", event.target.value)}
                  />
                </Field>

                <Field
                  label="Risk premium"
                  htmlFor="risk-premium"
                  error={errors.depositPremium}
                  hint="Use in-force risk premium at the cancellation date."
                >
                  <input
                    id="risk-premium"
                    type="text"
                    inputMode="decimal"
                    aria-invalid={Boolean(errors.depositPremium)}
                    value={formatNumberInput(form.depositPremium)}
                    onChange={(event) =>
                      setField("depositPremium", sanitizeNumericInput(event.target.value))
                    }
                  />
                </Field>

                <Field label="Cancellation type" htmlFor="cancellation-type">
                  <select
                    id="cancellation-type"
                    value={form.cancellationType}
                    onChange={(event) => {
                      const nextType = event.target.value as CancellationType;
                      setCopied(null);
                      setForm((current) => ({
                        ...current,
                        cancellationType: nextType,
                        // Auto-switch the method per the rules: carrier = pro-rata, insured/non-pay = short rate.
                        preset: nextType === "company" ? "standard" : "minimumPremiumEndorsement"
                      }));
                    }}
                  >
                    <option value="insured">Insured cancellation</option>
                    <option value="nonPayment">Non-payment</option>
                    <option value="company">Company cancellation</option>
                  </select>
                </Field>

                <Field
                  label="Calculation preset"
                  htmlFor="calculation-preset"
                  hint="Auto-set from cancellation type — override if needed."
                >
                  <select
                    id="calculation-preset"
                    value={form.preset}
                    onChange={(event) => setField("preset", event.target.value as CalculationPreset)}
                  >
                    <option value="minimumPremiumEndorsement">Short rate (0.9 × pro rata)</option>
                    <option value="standard">Straight pro rata</option>
                  </select>
                </Field>

                <Field
                  label="Minimum earned premium %"
                  htmlFor="minimum-earned-premium"
                  error={errors.minimumEarnedPremiumPercent}
                >
                  <input
                    id="minimum-earned-premium"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    inputMode="decimal"
                    aria-invalid={Boolean(errors.minimumEarnedPremiumPercent)}
                    value={form.minimumEarnedPremiumPercent}
                    onChange={(event) => setField("minimumEarnedPremiumPercent", event.target.value)}
                  />
                </Field>

                <Field label="TRIA (terrorism) tier" htmlFor="tria-tier" hint="Display only — not part of the return.">
                  <select
                    id="tria-tier"
                    value={form.triaTier}
                    onChange={(event) => setField("triaTier", event.target.value as TriaTier)}
                  >
                    <option value="none">No TRIA</option>
                    <option value="tier1">Tier 1 — 10%</option>
                    <option value="tier2">Tier 2 — 5%</option>
                    <option value="tier3">Tier 3 — 3%</option>
                  </select>
                </Field>

                <Field
                  label="Fees (optional)"
                  htmlFor="fees"
                  error={errors.fullyEarnedCharges}
                  hint="Excluded from the return unless enabled."
                >
                  <input
                    id="fees"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    aria-invalid={Boolean(errors.fullyEarnedCharges)}
                    value={form.fullyEarnedCharges}
                    onChange={(event) => setField("fullyEarnedCharges", event.target.value)}
                  />
                </Field>
              </div>
            </form>

            <aside className="results-panel" aria-label="Results">
              <div className="panel-heading">
                <h2>Results</h2>
                <p>Calculated from the current policy inputs.</p>
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
                  <dl className="inputs-recap">
                    <div>
                      <dt>Policy term</dt>
                      <dd>
                        {form.policyEffectiveDate} → {form.policyExpirationDate}
                      </dd>
                    </div>
                    <div>
                      <dt>Cancellation</dt>
                      <dd>{form.cancellationEffectiveDate}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{cancellationTypeLabel(result.cancellationType)}</dd>
                    </div>
                    <div>
                      <dt>Risk premium</dt>
                      <dd>{formatCurrency(result.depositPremium)}</dd>
                    </div>
                    <div>
                      <dt>Minimum earned</dt>
                      <dd>{result.minimumEarnedPremiumPercent}%</dd>
                    </div>
                    {result.triaAmount > 0 ? (
                      <div>
                        <dt>TRIA ({triaTierLabel(result.triaTier)})</dt>
                        <dd>{formatCurrency(result.triaAmount)} (excl.)</dd>
                      </div>
                    ) : null}
                    {result.fullyEarnedChargesRetained > 0 ? (
                      <div>
                        <dt>Fees</dt>
                        <dd>{formatCurrency(result.fullyEarnedChargesRetained)} (excl.)</dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="result-summary">
                    <span className={`method-badge ${result.appliesShortRate ? "shortrate" : "prorata"}`}>
                      {result.appliesShortRate ? "Short Rate" : "Pro Rata"}
                    </span>
                    <p className="result-sentence">
                      {capitalize(cancellationTypeLabel(result.cancellationType))}, {result.earnedDays} of{" "}
                      {result.totalPolicyDays} days earned — estimated return premium{" "}
                      <strong>{formatCurrency(result.finalReturnPremium)}</strong> (
                      {result.appliesShortRate ? "short rate" : "straight pro rata"}, {controlsLabel(result)}
                      ).
                    </p>
                  </div>

                  <div className="summary-total">
                    <span>Estimated return premium</span>
                    <strong>{formatCurrency(result.finalReturnPremium)}</strong>
                  </div>

                  <div className="breakdown">
                    <h3>How this was calculated</h3>
                    <ol className="breakdown-steps">
                      <Step
                        label="Policy term"
                        value={`${result.totalPolicyDays} days`}
                        note={`${form.policyEffectiveDate} → ${form.policyExpirationDate}`}
                      />
                      <Step
                        label="Earned / unearned"
                        value={`${result.earnedDays} / ${result.unearnedDays} days`}
                      />
                      <Step
                        label="Risk / base premium"
                        value={formatCurrency(result.depositPremium)}
                        note="in-force at cancellation"
                      />
                      <Step
                        label="Method"
                        value={result.appliesShortRate ? "Short rate (0.9 × pro rata)" : "Straight pro rata"}
                        note={cancellationTypeLabel(result.cancellationType)}
                      />
                      <Step
                        label="Applicable factor"
                        value={String(result.cancellationReturnFactor)}
                        note={
                          result.appliesShortRate
                            ? "truncated 0.9 × pro rata (3 dp)"
                            : "truncated pro rata (3 dp)"
                        }
                      />
                      <Step
                        label="Gross return (base × factor)"
                        value={formatCurrency(result.grossReturn)}
                      />
                      {result.minimumApplies ? (
                        <>
                          <Step
                            label="Retained via factor"
                            value={formatCurrency(result.retainedViaFactor)}
                          />
                          <Step
                            label={`Retained via minimum (${result.minimumEarnedPremiumPercent}%)`}
                            value={formatCurrency(result.retainedViaMinimum)}
                          />
                          <Step
                            label="Controls"
                            value={result.minimumBinds ? "Minimum earned" : "Cancellation factor"}
                            note={
                              result.minimumBinds
                                ? "minimum earned premium retains more"
                                : "cancellation factor retains more"
                            }
                            highlight
                          />
                        </>
                      ) : (
                        <Step
                          label="Minimum earned"
                          value="Not applied"
                          note="full pro-rata — no cap on a carrier cancellation"
                        />
                      )}
                      {result.triaAmount > 0 ? (
                        <Step
                          label={`TRIA retained (${triaTierLabel(result.triaTier)})`}
                          value={formatCurrency(result.triaAmount)}
                          note="display only — not in the return"
                        />
                      ) : null}
                      {result.fullyEarnedChargesRetained > 0 ? (
                        <Step
                          label="Fees retained"
                          value={formatCurrency(result.fullyEarnedChargesRetained)}
                          note="excluded from the return"
                        />
                      ) : null}
                      <Step
                        label="Estimated return premium"
                        value={formatCurrency(result.finalReturnPremium)}
                        isFinal
                      />
                    </ol>
                  </div>

                  <div className="results-actions">
                    <button type="button" className="btn-primary" onClick={() => window.print()}>
                      Print / Save PDF
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => copyText(summaryText, "summary")}
                    >
                      {copied === "summary" ? "Copied" : "Copy summary"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => copyText(calculation.note, "note")}
                    >
                      {copied === "note" ? "Copied" : "Copy note"}
                    </button>
                  </div>

                  <details className="note-block">
                    <summary>Calculation note</summary>
                    <textarea readOnly value={calculation.note} aria-label="Calculation note" />
                  </details>
                </>
              ) : null}
            </aside>
          </section>
        </div>
      ) : (
        <div role="tabpanel" id="panel-extension-ap" aria-labelledby="tab-extension-ap">
          <ExtensionApTab />
        </div>
      )}

      <p className="disclaimer">{DISCLAIMER}</p>
    </main>
  );
}

interface FieldProps {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
  error?: string;
  hint?: string;
}

export function Field({ children, htmlFor, label, error, hint }: FieldProps) {
  return (
    <label className={`field${error ? " has-error" : ""}`} htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {error ? (
        <small className="field-message" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field-hint">{hint}</small>
      ) : null}
    </label>
  );
}

interface StepProps {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
  isFinal?: boolean;
}

export function Step({ label, value, note, highlight, isFinal }: StepProps) {
  return (
    <li
      className={`breakdown-step${highlight ? " is-highlight" : ""}${isFinal ? " is-final" : ""}`}
    >
      <div className="breakdown-step-main">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      {note ? <em>{note}</em> : null}
    </li>
  );
}

function cancellationTypeLabel(type: CancellationType): string {
  if (type === "insured") return "insured cancellation";
  if (type === "nonPayment") return "non-payment cancellation";
  return "company cancellation";
}

function controlsLabel(result: CalculationResult): string {
  if (!result.minimumApplies) return "full pro-rata, no minimum earned";
  return result.minimumBinds ? "minimum earned controls" : "cancellation factor controls";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function triaTierLabel(tier: TriaTier): string {
  if (tier === "tier1") return "Tier 1, 10%";
  if (tier === "tier2") return "Tier 2, 5%";
  if (tier === "tier3") return "Tier 3, 3%";
  return "none";
}

function buildSummaryText(form: FormState, result: CalculationResult): string {
  const lines = [
    "E&S Return Premium — Summary",
    "",
    `${capitalize(cancellationTypeLabel(result.cancellationType))}, ${result.earnedDays} of ${result.totalPolicyDays} days earned.`,
    `Method: ${result.appliesShortRate ? "Short rate (0.9 × pro rata)" : "Straight pro rata"} — ${controlsLabel(result)}.`,
    "",
    `Policy term: ${form.policyEffectiveDate} to ${form.policyExpirationDate}`,
    `Cancellation effective: ${form.cancellationEffectiveDate}`,
    `Risk premium (in-force at cancellation): ${formatCurrency(result.depositPremium)}`,
    `Applicable factor (truncated 3 dp): ${result.cancellationReturnFactor}`,
    `Gross return (base × factor): ${formatCurrency(result.grossReturn)}`
  ];

  if (result.minimumApplies) {
    lines.push(
      `Minimum earned premium: ${result.minimumEarnedPremiumPercent}%`,
      `Retained via factor: ${formatCurrency(result.retainedViaFactor)}`,
      `Retained via minimum: ${formatCurrency(result.retainedViaMinimum)}`
    );
  } else {
    lines.push("Minimum earned premium: not applied (full pro-rata)");
  }

  if (result.triaAmount > 0) {
    lines.push(`TRIA retained (display only, excluded): ${formatCurrency(result.triaAmount)}`);
  }
  if (result.fullyEarnedChargesRetained > 0) {
    lines.push(`Fees retained (excluded): ${formatCurrency(result.fullyEarnedChargesRetained)}`);
  }

  lines.push("", `Estimated return premium: ${formatCurrency(result.finalReturnPremium)}`);
  return lines.join("\n");
}

export function parseAmount(value: string): number {
  if (value.trim() === "") {
    return 0;
  }

  return Number(value);
}

// Strip unambiguous formatting and NOTHING else. Anything left that isn't
// digits-and-one-dot is preserved verbatim so validateForm can reject it with a
// visible message — stripping it and proceeding is what turned "1e5" into 15.
export function sanitizeNumericInput(value: string): string {
  return value.trim().replace(FORMATTING_NOISE, "");
}

// Display the stored numeric string with thousands separators. Text that failed
// validation is echoed back verbatim — grouping it would rewrite the user's own
// input (e.g. "1e5000" -> "1e5,000"), mutating the very text we refused to mutate.
export function formatNumberInput(raw: string): string {
  if (!isNumericText(raw)) {
    return raw;
  }
  const [intPart, ...rest] = raw.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${grouped}.${rest.join("")}` : grouped;
}

export default App;
