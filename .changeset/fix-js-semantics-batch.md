---
"@nudojs/core": patch
---

fix(core): JS semantics — UpdateExpression, optional chain, enumerable, ToPropertyKey, copyWithin, split limit, isPrototypeOf

Seven evaluator/transpile correctness fixes (one commit per class):

- `x++`/`x--` use ToNumeric ± 1 (bigint gets `1n`); postfix caches the old value (IEEE 2^53 safe). `"5"++` is `6`, not `"51"`.
- Optional chains short-circuit the **remaining** chain (`a?.b.c` ≡ `a == null ? undefined : a.b.c`), including `o?.length` / `o?.[k]` / `g?.()` / `o.m?.()`. RegExp `test`/`exec` inside a chain still rebind `lastIndex`.
- `for-in` / `Object.assign` honor `enumerable` (shared `enumOwnKeys` / `isEnumerableView` with `Object.keys`).
- ToPropertyKey stringifies `null`/`undefined`/`boolean` computed keys (`o[null]` ≡ `o["null"]`) for get/set/in/delete.
- `copyWithin` overlap direction uses the **resolved** window (negative indices no longer flip).
- `split(undefined, limit)` uses ToUint32 (`0.5`/`±Infinity` → `[]`; `-1` → `2^32-1`).
- `Object.prototype.isPrototypeOf(Object.prototype)` is `false`.
