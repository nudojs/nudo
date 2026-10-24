---
"nudojs": patch
---

`nudo check <callee> --from <caller>` now closes the loop on call sites that
live inside a function body, arrow function, or method body.

The `--from` usage-site files were handed to the checker only as executed call
records. A call site that had never been executed — for example one wrapped in a
function body — produced no record at all, so the callee's gate stayed green
while checking the caller alone reported the very same violation. The usage-site
file paths now reach the checker as well, and the call-site obligation is
re-checked with the same criterion the single-file channel uses, so both
channels report the same code for the same fact.

- `nudo check <callee> --from <caller>` now exits 1 with exactly one
  `nudo:interface-domain-exceeds` for a call site wrapped in a function body;
  before this change the same command exited 0.
- Checking the caller directly is unchanged: it still reports exactly one
  `nudo:constraint-violated`.
- A call site that is reported by both channels is still reported only once.
