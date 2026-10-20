---
"@nudojs/core": patch
---

`import { "a-b" as x } from "…"` binds the arbitrary module export name.

ES2022 allows importing an arbitrary module export name. The transpiler
rendered such a specifier with `String(s.imported)`, but `s.imported` is a
`StringLiteral` **node** in that form, so `String(node)` produced
`"[object Object]"`. The generated import statement was therefore invalid
JavaScript, the whole module failed to evaluate, and the imported value
silently degraded to `unknown` — `nudo check` then reported a single
warning and no error, i.e. a false green.

The import side now renders a string export name with its quotes, like the
export side already did, and the binding lookup strips the quotes to get
the actual export name.
