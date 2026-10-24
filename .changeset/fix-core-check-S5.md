---
"@nudojs/core": patch
"nudojs": patch
---

`nudo check` now sees assignments inside function bodies, judges generated
segments against cross-file call sites, and points diagnostics at the
offending directive.

- `nudo:assign-mismatch` only covered module top-level assignments: the
  assignment recorder was installed around the top-level evaluation, but
  function bodies had already been evaluated (by the generalizer) before
  that, so every `$assignRecord` from a function body was dropped. Real
  code assigns mostly inside functions, so the check reported "OK" on
  functions that assign a string to a number. The recorder is now installed
  before the function loop, and repeated evaluations of the same assignment
  site are folded into one diagnostic.
- `nudo:interface-drift` never fired when the call site lived in another
  file: the "today" evidence came only from evaluating the checked file
  itself, so a generated segment written with `--from` could not be judged
  stale. `CheckOptions.from` now carries cross-file call-site records into
  the same judgment; records are attributed to the checked file, so a
  same-named function in another module cannot pollute the verdict.
- `nudo:assume-invalid`, `nudo:invariant-invalid`, `nudo:contract-syntax`
  and `nudo:interface-conflict` carried no position: the LSP drew the red
  squiggle at line 1 column 1 and `nudo check --json` reported
  `issues[].line: null`, even when the offending directive was on line 7.
  All four codes now report the line and column of the directive that
  caused them.
