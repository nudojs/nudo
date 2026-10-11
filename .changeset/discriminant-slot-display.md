---
"@nudojs/core": patch
"@nudojs/lsp": patch
---

Discriminant narrowing visible in slot display; mid-token hover resolution

- `$narrowMemberEq` keep-arm refinement: surviving union members with a compatible discriminant slot now carry the `eq(slotTerm, lit)` fact on that slot (conjoined with any existing pred). `formatShape(showLits)` renders it via `litPredValue`, so the open-tail arm displays `{ type: lit("TemplateLiteral") }` after `node.type === 'TemplateLiteral'` instead of the unrefined `{ type: string }`; `memberEqClass` upgrades those members to `only`, improving chained discriminant narrowing and complement-arm pruning. `any`/`unknown` slots stay untouched (fail-closed markers).
- `litPredValue` now reads `eq(self, lit)` facts through `and`-conjunctions, not only top-level eq preds.
- LSP A0 hover replay resolves mid-token cursor positions: record keys are Babel start positions (`$nodoPos` uses `loc.start`), so a cursor anywhere inside an identifier span now resolves to that identifier's record instead of falling back to the declared-form fold (previously only the first column hit).
