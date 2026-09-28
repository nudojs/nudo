---
"@nudojs/core": patch
---

fix(core): JS semantics soundness — JSON space, bigint throws, `__proto__` keys

- `JSON.stringify` space goes through to the host (`min(10, ToIntegerOrInfinity)`); `Infinity` / `(0,1)` fractions no longer collapse to compact.
- Mixed / invalid bigint ops hard-throw `TypeError`/`RangeError` when the other operand is **definitely** non-bigint (number/bool/null/undefined). Abstract operands (`any`/`obj`/string-prim for `+`) no longer fold to `never` — `1n + s` is string concat, `1n + x` (any) is `bigint | string` with soft may-throw.
- `__proto__` own keys survive (`JSON.parse`, computed literal, method named `__proto__`, spread/assign copy) via `defineProperty`; non-computed `{__proto__: v}` is the ES prototype special form; `Object.setPrototypeOf` missing/`undefined` proto throws.
