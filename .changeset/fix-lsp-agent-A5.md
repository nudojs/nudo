---
"@nudojs/lsp": patch
---

The LSP editor commands now tell the truth: a selection that did not happen
is reported as a failure, and the mirrors a selection touches are refreshed
together.

- `nudo.selectCase` validates its arguments before touching the active-case
  table. A `caseIndex` outside the function's `@nudo:case` list used to be
  accepted: `-1` crashed the analysis (`Cannot read properties of undefined
  (reading 'argsAbs')` in the diagnostics) and `99` silently replaced the
  observation slot. A `functionName` that is not a function of the target
  file used to be stored as-is, so `nudo.getActiveCases` reported ghost
  entries such as `{"":0}`. Both now return a structured error and leave the
  table untouched.
- `nudo.selectContract` validates that the target function exists in the
  file. It used to answer `{"success":true}` for a function that was never
  there (and for a call without any arguments at all), so the client could not
  tell a real switch from a no-op.
- A selection refreshes the inlay hints and the pull diagnostics as well as
  the code lenses. Only the code lenses were refreshed, so a client without
  code lens support kept showing the previous case, and a pull-diagnostics
  client never saw the diagnostics of the newly selected case.
- `file` / `uri` arguments must be non-empty strings. A non-string `file` used
  to escape as a bare `TypeError` (`file.startsWith is not a function`), which
  reached the client as a JSON-RPC protocol error instead of a tool error
  carrying `isError: true`; a missing `file` silently fell back to the
  server's working directory.
- An unknown command name on `workspace/executeCommand` now fails with the
  protocol-level `MethodNotFound` error instead of answering with a `null`
  result, which was indistinguishable from "the command ran and produced
  nothing".
