---
"@nudojs/core": patch
---

Computed-key member calls keep their receiver: `obj[key]()` where the key
is a non-literal expression (a variable, `Symbol.iterator`, any runtime
value) used to fall through transpile to `$call($idx(obj, key), …)`,
which has no receiver channel — the method body's `this` read failed and
builtin brand checks assumed a throw, folding exact `never` (native: the
real result). New `$invokeKey` / `$optionalInvokeKey` runtime helpers
fold the key (ToPropertyKey literal + well-known symbol → `@@name` slot)
and re-enter the full `$invoke` dispatch with the receiver bound;
optional chains (`obj?.[key]()`, `obj[key]?.()`, mid-chain hops) route
through a new `invokeKey` chain hop instead of the receiver-less `call`
hop. Bonus precision: static `"ab"[Symbol.iterator]().next().value`
folds `"a"` (iterator face reuses the `values` single source of truth),
and generator `it[Symbol.iterator]() === it` folds `true`.
