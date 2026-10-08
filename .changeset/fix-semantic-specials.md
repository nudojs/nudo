---
"@nudojs/core": patch
---

Fix class-D semantic-special-case bugs (13/14/17/18/20/25/30/33/34/36/37/40/42/44/60).

False may-throws eliminated: `s.split(/re/)` no longer treats a RegExp separator as a ToString operand (`@@split` delegation never stringifies it); `JSON.stringify` on closed builtin brands (Date/RegExp/Map/Set/Error family/URL/ArrayBuffer family — folded exactly: `"{}"` / href / ISO string), closed objects with primitive slots, and abstract arrays with non-bigint elements no longer record the BigInt/circular/toJSON may-throw; `Reflect.apply(f, thisArg, argsList)` replays the call through the `$invoke` apply path (`Math.max` → `2` exact) and no longer flags fn targets as maybe-uncallable.

Arithmetic on builtin brands (Bug 25): `-` `*` `/` `%` `**` unary `-` `<` `>` `Number()` now fold known-brand operands through ToPrimitive — Date → time value (`new Date(0) - 1` → `-1` exact, `+` → string per the Date default-hint rule), boxed `new Number(5)` → the wrapped primitive, RegExp/Map/Set/Error/URL → toString → numeric coercion (abstract-string operands coerce to `number`, was `unknown`).

Promise rejection channel (Bugs 36+37): the promise eff shape carries a `rejected` reason — `Promise.reject(v)` and executor `reject(v)` produce `promise<never>` (definite rejection), `.catch`/two-arg `.then` receive the actual reason (`Promise.reject(1).catch(e => e)` → `promise<1>`, no phantom unknown arm), and nullish handlers are Identity (`p.then(null)` passes the settle value through, `p.catch(null)` passes rejection through).

L1 return-contract element enforcement (Bug 30): array contracts now check elements — `return [-1]` against `array(number().gt(0))` reports `array element [0] ⊭ …` (precise index) instead of silently proving; abstract elements degrade to `unproven-return`, empty tuples stay vacuously proved.

Expression-position `splice`/`copyWithin` fold exactly (`[1,2,3].splice(1,1,9)` → `[2]`); arr-of-union signatures render with parens (`(3 | 1 | 2)[]`, was the ambiguous `3 | 1 | 2[]`); `BigInt(x)` on abstract number/string operands records the native `RangeError`/`SyntaxError` may-throw; `new URL(...).toJSON()` folds href (was `unknown`); rest parameters in signature symbolic execution bind an open array (`sigLen(...r) => number`, was the fixed-1-tuple error `1`); `delete o?.a` short-circuits nullish receivers to `true` (was an engine throw — the differential knownFalseThrows canary is removed).
