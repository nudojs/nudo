---
"nudojs": patch
---

`nudo test`: one failure channel for the machine face, one conclusion for
"this file has no functions", and the flags the help text promises are now
actually accepted.

- **Bug 650 — a syntax error was reported as a bare message with no file
  name, and `--json` printed nothing at all.** The Babel parse error
  escaped `runTest` up to the top-level catch, which printed only
  `err.message` (no path, no `line:column`, no source excerpt), and the
  `--json` serialization point sat *after* the throw ⇒ stdout was 0 bytes
  and `JSON.parse(stdout)` threw. `nudo test` now reuses the syntax-error
  branch of `nudo check`: the human face gets a tsc-style block (path +
  `line:column` + source excerpt + `^` caret) and the `--json` face gets
  the same CaseJson envelope as every other failure, with
  `pathErrors[{code:"syntax-error"}]`.
- **Bug 652 — `nudo test --abs` exited 1 on a file that declares no
  function, while the same command without `--abs` exited 0.** The `--abs`
  face borrowed `runAbsView`, which treats "this file has no functions" as
  a usage error (`Function not found` + exit 1) — that is the *intended*
  behaviour of `nudo check --abs` (Bug 669) and is left untouched. Inside
  `nudo test` the observation face is now skipped when the file declares no
  function, so both faces print the same report and exit with the same
  code.
- **Bug 653 — `--exit-on-diff` was silently ignored without `--freeze`.**
  The precondition check lived *inside* the `if (opts.freeze !== undefined)`
  branch ⇒ without `--freeze` the flag was swallowed and the command
  exited 0, which turns a CI gate into a no-op. The check now runs before
  the branch, so `--exit-on-diff` without `--freeze` is a usage error
  (exit 1) — the same stance `nudo contract --exit-on-diff` takes.
- **Bug 654 / Bug 656 — `--help` promised `--freeze` modes `update | add`,
  but `--freeze=add` was rejected with exit 1.** The help text and the flag
  parser had each been written on their own. The parser now accepts
  `--freeze=add` (identical to omitting the value), and the error message
  for an invalid value lists the same set of legal values as the help.
- **Bug 919 — `nudo test --abs` swallowed the whole diagnostics section.**
  The predicate that decides whether diagnostics are printed excluded the
  `--abs` face ⇒ a wrong expectation (`=> 42x`) produced *zero* hints on
  screen while the assertion failed. `--abs` no longer excludes
  diagnostics, so the default, `--json` and `--abs` faces report the same
  number of diagnostics for the same file. `nudo check --abs` keeps its
  existing shape.
- **Bug 957 — `--json` usage errors produced an empty stdout plus a
  non-zero exit.** Every usage-error branch of `nudo test` (missing path,
  `--json` + `--abs`, `--json` with several files, `--freeze` + `--json`,
  the variadic `--from` swallow) wrote to stderr and returned before the
  machine face could be produced, while the *path* failures of the very
  same verb did produce a proper envelope ⇒ two failure channels, two
  machine shapes. Usage errors now go through the same CaseJson envelope
  (`pathErrors[{code:"usage-error"}]` + exit 1); the human-readable text of
  the non-`--json` face is unchanged.
