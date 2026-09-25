---
"@nudojs/core": major
"@nudojs/service": major
"@nudojs/lsp": major
"@nudojs/cli": major
"nudojs": major
---

feat!: source contract directive is `@nudo:contract` only

`@nudo:refine` and `@nudo:interface` are deleted with no alias layer. The product word is **contract** end to end (sidecar `*.nudo.js`, `@nudo:contract`, `nudo contract`, `package.json#nudo.contract.*`).

- **BREAKING:** replace every `@nudo:refine` / `@nudo:interface` with `@nudo:contract` (including `@nudo:contract return <constraint>`). Grammar is unchanged: `@nudo:contract <param> <constraint>`.
- Constraints still enter Abs as Preds and participate in algebra (`x>0` ⇒ `x+1>1`) — this is not a call-site validation gate.
- Diagnostic codes `nudo:interface-*` are unchanged in this release.
- Chinese product copy uses 契约, not 精化.
