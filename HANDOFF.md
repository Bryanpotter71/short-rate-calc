# Short-Rate Calc — Status & Next Steps

A generic E&S cancellation / return-premium calculator. Vite + React + TypeScript.
Kept intentionally generic: no carrier names, insured names, policy numbers, customer
documents, or proprietary rules.

## Current state (verified 2026-07-30)
- `npm run build` ✅ passes · `npm test` ✅ 64/64 passing
  - 46 validated (12 engine regression + 34 adversarial)
  - 18 structural (extensionAp — unvalidated, ties to no real endorsement)
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
   - `src/lib/extensionAp.ts` exists as UNVALIDATED structural scaffolding and does NOT
     unblock this item. It models extension AP two ways — straight pro-rata on time and
     exposure-rated on incremental exposure — returns both plus their divergence, and
     deliberately selects no method. It applies NO rounding, because the rounding
     convention is unknown. It assumes exposure accrues straight-line across the term
     (see `EXPOSURE_ACCRUAL_ASSUMPTION`), which is wrong for seasonal risks. Not to be
     used for quoting until a real example validates it.
   - **Wired to the UI 2026-08-01** as a second tab (`src/ExtensionApTab.tsx`), behind a
     visible proof-of-concept banner. This changed the WIRING, not the VALIDATION — the
     item stays BLOCKED. The tab renders both candidate methods at equal weight plus
     their divergence, selects no method, applies no rounding convention, and is not a
     quoting surface. It does not substitute for the sanitized real endorsement example
     this item is blocked on.
   - The tab has NO automated coverage: `environment: "node"` with no jsdom and no
     `@testing-library/*`, so nothing renders `ExtensionApTab.tsx` in CI. Changes to it
     must be verified by hand — a green `npm test` says nothing about that file.
2. **MEP coupling fix** — MEP eligibility must key off cancellation type, not the
   calculation-method preset.
3. ~~**Input sanitizer**~~ **CLOSED (124199f)** — previously silently corrupted pasted
   values like scientific notation; now rejects value-ambiguous input loudly via
   `isNumericText`/`validateForm` in `App.tsx` instead of mangling it.
4. ~~**gh-pages hygiene**~~ **RESOLVED 2026-07-28** — The `gh-pages` branch no longer
   exists on origin (`git ls-remote --heads origin` returns only `refs/heads/main`).
   Deployment runs GitHub Actions → Pages artifact; no branch is served. The settings
   file that exposed an identifying domain and local paths was deleted with the branch.
   Live site verified serving the current build — sanitizer rejection renders for `1e5`
   on the deployed URL, 2026-07-28. No further action.
5. ~~**Consolidation**~~ **CLOSED (2026-07-26)** — codex-aprp-prototype (36bf0f7): 6 commits
   recovered from the Codex working copy (5 original + 1 adding previously-untracked
   docs/config; `.claude/settings.local.json` gitignored, not committed — contained local
   machine paths). Grepped clean of carrier name/domain, insured, and credential references.
   Has a review workflow, assumptions panel, copy-summary, sample loaders, and an AP/RP UI
   shell. Evaluate for porting UI patterns only — calc logic (`apRp.ts`, `reviewWorkflow.ts`)
   remains UNVALIDATED and must never be merged as-is. Documents copy deleted.

## Rules for agents working in this repo
- The validated suite — 46 tests (12 engine regression + 34 adversarial input/integration) —
  is the correctness floor. All must pass before any merge.
- The 18 `extensionAp` structural tests are NOT part of that floor. They pin result shape,
  null propagation, and the no-rounding rule — not dollar accuracy. A green extensionAp run
  is not evidence the AP math is right; only a sanitized real endorsement example can
  establish that.
- If this file conflicts with `calculations.ts` + its passing tests, the code + tests win —
  then fix this file.
- If a referenced file, branch, or example doesn't exist, STOP and report. Do not
  improvise a substitute or proceed on assumptions.

## Notes
- Pre-124199f suite tested mirrored copies of the functions, not the exports; green runs
  before this commit validated duplicates.
- Don't reintroduce a `tsc -b` project reference — build uses a plain `tsc` type-check; Vite bundles.
- Keep this repo OUT of iCloud-synced folders (e.g. ~/Documents) — sync duplicates
  `node_modules` files (`name 2/`) and breaks the TypeScript build. Lives in ~/Projects.
- `vite.config.ts` base is conditional: `process.env.GITHUB_ACTIONS ? "/short-rate-calc/" : "/"`.
  Pages (Actions) needs the subpath; Vercel serves from root. Do not collapse to a static
  value — it breaks whichever deploy target isn't the one you tested.