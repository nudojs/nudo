---
"@nudojs/service": minor
"nudojs": minor
---

ABS-03: dts projection completion — contract generics, readable contract notes, overload arms.

- Contract-side type parameters are now derived from binder vars (`bind:<name>`) and emitted only when referenced by a parameter or the return type: the entry-only HOF contract projects as `export declare function processItems<a, b>(items: a[], transform: (x: a) => b): b[];` (element domain and callback parameter share the same variable; unreferenced vars are dropped).
- `.d.ts` JSDoc gains readable `Contract:` rows (sidecar expression text / constraint rendering). They are notes only — the type face still comes from Abs, and `Case:` rows keep their debug-witness role.
- Function Abs with a declared overload set now projects as a TS object type with per-arm call signatures (declaration order = TS resolution order) instead of collapsing to the union face.
- Schema projection already emits numeric `gt/ge/lt/le` bounds; new tests pin bounded output and the honest omission of non-expressible relations (`x > y`).
