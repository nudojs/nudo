---
"@nudojs/service": patch
"@nudojs/harvester": patch
---

`nudo contract --draft` now writes a draft that can be copied into a sidecar
as-is: the sidecar key is the module's **export identity**, the file is
always valid JavaScript, the return obligation never contradicts the
function's own inferred return domain, and a draft the user has edited is
never silently overwritten.

- The draft's sidecar key came from the *analysis name*, sanitized into a
  legal identifier. An anonymous `export default` therefore got the
  synthesized key `_default`, while the key that actually binds is
  `default` — copying the draft into `*.nudo.js` left the contract in
  place but **inert**, and `nudo check` stayed green on a call that
  violated it. The key is now the export identity (the same source as
  `nudo contract --emit`), and an unsafe binding name is emitted in the
  alias form `const _nudo_N = …; export { _nudo_N as <identity> };`.
- The builder `import` and the generated `export const <name>` shared one
  module scope, so a function whose name is a builder name (`number`,
  `lit`, `union`, …) produced `import { number } from "@nudojs/core"` next
  to `export const number = …` — a parse-time `SyntaxError: Identifier
  'number' has already been declared`. The generated file was not valid
  JavaScript, so the "copy the accepted exports into the sidecar" step
  could only produce a broken sidecar. The same collision is fixed in the
  `--from-dts` draft.
- A rest parameter (`...rest`) was rendered into the constraint DSL
  verbatim (`{ first: number(), ...rest: number() }`), which is neither a
  legal object literal nor legal DSL: copying the draft broke the whole
  sidecar (`nudo:interface-load`), losing every contract in the file.
  Rest-parameter functions are now reported as `not-projectable` and
  skipped, and every draft is assembled once (`execNudoModule`) before it
  is written — a draft that does not load is never handed to the user.
- The return obligation was derived only from the *observed* call sites,
  which are a subset of the function's real return domain: `opt(flag)`
  returning `1 | null` was drafted as `fn({ flag: boolean() }, number())`,
  so accepting the draft made the function violate its own draft. The
  obligation is now checked against the inferred return domain (the same
  source as the `nudo check` signature) and is not written when it does
  not cover it.
- `--draft --write` overwrote a hand-edited `*.nudo.draft.js` without a
  word, while the file's own header claims "Handwritten contracts are
  never overwritten". Drafts now carry a content fingerprint; a draft
  whose content no longer matches its fingerprint is kept as-is and the
  command reports that it was not overwritten.
