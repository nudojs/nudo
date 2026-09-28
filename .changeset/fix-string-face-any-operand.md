---
"@nudojs/core": patch
---

fix(core): string-face typing — concat/template with an `any` operand, abstract `.length`

Two gaps that made provably-string expressions come out as `unknown` (and
raised `nudo:unknown-inference` on real projects):

- `concatString` fell back to `unknown` whenever one side had no
  string-parts view — including `any`/`unknown`. But a string operand
  determines the result type: `"s" + x`, `x + "s"` and `` `${x}` `` are all
  `string` (the ToString-throws-on-Symbol path is not modelled here). This
  contradicted `docs/design/limitations.md`'s mixed-`+` narrowing discipline
  (`number ⊗ obj/unknown → number | string`) — `1 + x` narrowed, `"s" + x` did
  not. Now a definitely-string side yields `string` (`path` conf); all-other
  cases keep the previous `unknown`.

- `$len` had no branch for an abstract string prim (template / concat result /
  abstract `string`), so `` `${x}`.length `` and `String(x).length` fell to the
  trailing `unknown`. String length is always `number`; literal strings still
  fold exactly.

Verified on a real project: `tarballUrl`-shaped templates and
`printScore` / `printPublishResult`-shaped helpers stop reporting
`nudo:unknown-inference`.
