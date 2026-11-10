---
"@nudojs/service": minor
"nudojs": minor
---

ABS-04: test observation face — outermost witnesses survive the budget, and the two paths are discoverable.

- Call-site witness selection now prefers the **outermost** records (concrete arguments) over internal records whose arguments carry free term variables (α names / derived expressions from recursive or higher-order evaluation). A `sumTo(3)`-style top-level witness is no longer pushed out of `callSiteBudget` by internal records.
- When a function has both `@nudo:case` and call-site records, the default run keeps the mutual-exclusion report and prints a `both-paths` hint naming those functions, pointing at `--both-paths` (sources stay labeled: directive vs callsite). `--json` is unaffected; truncation reasons and their next actions keep flowing through the existing `nudo:*-truncated` diagnostics.
