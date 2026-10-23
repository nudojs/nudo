---
"nudojs": patch
"@nudojs/service": patch
---

`nudo test` can now tell "the engine could not infer the value" apart from
"the value does not match the expectation".

- **A failed inference used to be reported as a failed assertion.** When the
  engine cannot infer a witness' result (the observed value is `unknown`, or
  its confidence is `opaque`), the assertion verdict was binary: the case was
  reported as `[FAIL]`, `nudo:case-expected` was raised, and the run exited
  `1`. Writing the honest expectation (`=> number()`) could never fix it,
  because the real cause was the failed inference, not a type mismatch — while
  the very same source was only an `INFO` (`nudo:opaque-result`, exit `0`) on
  the `nudo check` face, i.e. the two faces gave opposite severities for one
  fact.
- **The opposite expectation passed for the wrong reason.** `=> any()` (the
  top type) satisfied every expectation, including the ones the engine could
  not judge at all, so the assertion reported `[ok]` while nothing had been
  inferred — a hollow pass.

Both assertion report faces — the CLI one (`nudo test`, `nudo test --json`,
`nudo test --abs`) and the LSP agent tool one (`testTool`) — now use the same
three-state verdict: a case whose observed value could not be inferred is
recorded as **unchecked** (it is neither a failure nor a pass), it does not
turn the run red, and the report says so explicitly ("cannot judge — the
engine could not infer the actual value") and points at the
`nudo:opaque-result` remediation path instead of claiming a type mismatch. The
`unchecked` count in the `assertions` summary and in the `--json` payload now
includes those cases, and a real mismatch is still reported as `[FAIL]` with
exit `1`.
