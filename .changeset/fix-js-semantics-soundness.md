---
"@nudojs/core": patch
"@nudojs/parser": patch
---

fix(core): JS semantics soundness — ToString args, compare undefined, NaN identity, JSON.stringify

B-path Abs folding corrections so concrete results match native JS:

- string/parse methods (`startsWith`/`endsWith`/`includes`/`split`/`replace`/
  `indexOf`/`parseInt`/`parseFloat`) honor ToString and missing-arg defaults;
  `split` keeps the ES special case that an **undefined** separator returns
  `[ToString(O)]` without splitting
- relational compare of `lit(undefined)` folds via ToNumber (all relations false)
- same-var `===` is not exact `true` when the value may be NaN
- `JSON.stringify` of top-level function/symbol returns the JS `undefined` value
- NaN literal identity uses SameValue (assignment/`leq`), not `===`
- drop unsound `x*0=0` / `x+0=x` algebra identities (NaN/`-0`/string domain)
- `n % 0` folds to NaN; `x % k` bounds only for finite dividends
- `0n` is falsy; `Number.is*` fold non-number lits to false; global `isNaN` coerces
- string index methods (`charAt`/`slice`/…) honor ToNumber and default args
- unary minus and `parseInt`/`parseFloat` honor ToNumber/ToInt32
- Math.* folds ToNumber lits (own numeric methods only — no `constructor`/`toString`)
- tuple index reads use canonical array index (`a["0"] === a[0]`)
- call-spread placeholder is `unknown`, not `undefined` lit

`fix(parser)`: directive scanners (`splitTopLevelArgs` / colon / arrow / balanced
parens) respect string literals.

Review follow-ups folded in: `split(undefined)` special case, `indexOf` returns
number shape on abstract receivers, Math method allowlist.
