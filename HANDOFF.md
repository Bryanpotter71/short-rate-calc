# Short-Rate Calc — Status & Next Steps

A generic E&S cancellation / return-premium calculator. Vite + React + TypeScript.
Kept intentionally generic: no carrier names, insured names, policy numbers, customer
documents, or proprietary rules.

## Current state (verified 2026-07-23)
- `npm run build` ✅ passes · `npm test` ✅ 12/12 passing
- Calculation engine validated to the dollar against regression examples A, B, C, D1, D2.
- App code: `src/App.tsx` (UI), `src/lib/calculations.ts` (math), `src/lib/calculations.test.ts` (tests)

## Run it
```bash
npm install
npm run dev      # local dev server
npm test         # run tests
npm run build    # type-check + production build
```

## Methodology (implemented and test-anchored — do not change without updating regression examples)
- Factors are TRUNCATED (floored) to 3 decimals BEFORE being applied to premium — never
  rounded. This is a business rule, not a formatting choice. See `truncateFactor()` in
  `calculations.ts` and the "factor truncation" test block. Any change that rounds,
  applies full precision, or truncates after multiplication is a regression.
- Pro-rata factor = unearned days / total days.
- Short-rate return factor = 0.9 × pro-rata factor (insured / non-payment cancellations).
- Company cancellation = straight pro-rata.
- Premium base is the IN-FORCE premium at cancellation date, not the inception/binder amount.
- Minimum earned premium is a floor: carrier keeps the greater of earned-via-cancellation
  vs earned-via-MEP.
- TRIA is informational only — it never changes the return premium and is never returned.
- Fees are excluded from the returnable base by default — retained for display, never
  subtracted from or added to the return. Do NOT reintroduce fee subtraction.
- Dollar amounts round to the nearest whole dollar (`roundToDollar`) only at final output.

## Next up
1. **AP / RP endorsement tab** — BLOCKED until a sanitized real endorsement example is
   available to model against. Do not build the calc engine from assumed rules; that
   failure mode has already cost one full revision cycle.
2. **MEP coupling fix** — MEP eligibility must key off cancellation type, not the
   calculation-method preset.
3. **Input sanitizer** — currently silently corrupts pasted values like scientific
   notation; should reject loudly or parse correctly, never mangle silently.
4. **gh-pages hygiene** — a settings file on the public `gh-pages` branch contains an
   identifying domain and local path info; scrub it.
5. **Consolidation** — a separate local prototype (~/Documents/Codex/2026-06-16/
   can-you-recall-the-short-rate) has a review workflow, assumptions panel, copy-summary,
   sample loaders, and an AP/RP UI shell. Evaluate for porting UI patterns only — its calc
   logic was built without validated examples and must not be trusted or merged as-is.

## Rules for agents working in this repo
- The 12 regression tests are the correctness floor. All must pass before any merge.
- If this file conflicts with `calculations.ts` + its passing tests, the code + tests win —
  then fix this file.
- If a referenced file, branch, or example doesn't exist, STOP and report. Do not
  improvise a substitute or proceed on assumptions.

## Notes
- Don't reintroduce a `tsc -b` project reference — build uses a plain `tsc` type-check; Vite bundles.
- Keep this repo OUT of iCloud-synced folders (e.g. ~/Documents) — sync duplicates
  `node_modules` files (`name 2/`) and breaks the TypeScript build. Lives in ~/Projects.