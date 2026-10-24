---
"@nudojs/core": patch
---

`nudo check` now compares `@nudo:case` witnesses against **field-level and
shape** contracts, and splits multi-line or escaped case arguments the same
way the shared single source does. Violating witnesses used to be dropped
silently, so a check run could pass with zero diagnostics while the witness
contradicted the contract.

- **Field-level / shape contracts were skipped as a whole.** A contract with
  a `fields` shape was skipped by the witness scan, so the case face carried
  no obligation at all for it. A witness that contradicted the shape — a
  field of the wrong type, or a missing field — was never reported.
- **Non-literal arguments were normalised to `unknown` and then skipped.**
  Object and array literals are now parsed into real abstract values, so a
  witness such as `{ a: "x" }` is compared with the contract instead of
  being dropped. A missing field is reported as `missing field <path>` and a
  field whose type does not match as `typeof <path> = "<prim>"`, matching the
  wording of the call-site face.
- **Multi-line case arguments were never checked.** The argument text handed
  over by the shared directive scanner still carries the JSDoc continuation
  prefix (` * `), so the arguments could not be parsed and the whole witness
  was skipped — the same witness written on a single line was reported
  correctly. The prefix is now stripped before the arguments are split.
- **The check face split arguments differently from the shared single
  source.** Its private splitter treated `\` as an escape character, so
  `"a\", -1` produced one argument instead of two and the violating witness
  on the second argument did not exist — the L2 witness gate passed on a
  contract violation, while `nudo test` saw a different argument list. The
  check face now uses the same splitting rules as the parser.
- **An argument that cannot be parsed is no longer skipped silently.** When
  an argument on a contract slot cannot be parsed, or when the case supplies
  no argument for that slot at all, the scan now reports a visible
  `nudo:directive-syntax` warning instead of dropping the obligation.
