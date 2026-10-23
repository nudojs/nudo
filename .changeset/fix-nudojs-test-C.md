---
"@nudojs/service": patch
---

Two `nudo test` case-reporting defects are fixed in the shared service analysis
layer; the CLI report faces (`nudo test`, `nudo test --json`) inherit both fixes
because they consume the same judgement function.

- **A throwing case could never fail its declared expectation.** The observed
  value of a case that throws is `never`, and `never` is the bottom element of
  the type lattice (`never ⊑ anything` always holds), so the structural check
  passed for *every* declared expectation. `@nudo:case "t" (1) => 42` on a
  function that throws used to be reported as `✓ 1 passed` with zero
  diagnostics. The judgement now carries a precondition: an observed `never`
  can never satisfy an expectation, so the case is reported as failed and
  `nudo:case-expected` is raised. The expectation text shown to the user is
  unchanged — a predicate expectation still renders as `number (> 0)`.
- **The case-level `nudo:may-throw` warning ignored a declared, intentional
  throw.** A throw declared with `@nudo:case "t" (1) !! throws TypeError`,
  `@nudo:throws TypeError`, or a sidecar `fn(…, { throws: "TypeError" })` was
  accepted by `nudo check` (zero errors) but still reported by `nudo test`, so
  the two verbs returned opposite verdicts for the same file. The case-level
  warning now uses the same mouth as the check face: a declared throw is not
  reported. Undeclared throws are still reported, and the remediation text now
  points at the mechanisms the user is already using
  (`@nudo:throws <Kind>` / `@nudo:case … !! throws <Kind>`) instead of only
  listing try-catch and `@nudo:contract`.
