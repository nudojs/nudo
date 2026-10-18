---
"@nudojs/core": patch
---

Category-decision & Proxy-model cluster (root-cause class C7) from the
differential bug report: `Object.prototype.toString` tags abstract
bigint prims as `"[object BigInt]"` via an explicit prim-tag map, and
bigint `.toString` routes through `BigInt.prototype.toString` with
literal-radix domain checks (Bug 105); abstract bigint prims are
recognized by arithmetic/bitwise coercion — mixed `bigint ⊗ number`
folds the native TypeError (or records may-throw for abstract sides)
instead of the impossible `number | string`, and `b / 0n` / `b % 0n` /
`b ** -1n` throw RangeError (Bug 106); borrowed builtin-prototype
methods brand-check the receiver (`Number.prototype.valueOf.call("5")`
throws instead of folding `"5"`), with `Object.prototype` /
`Array.prototype` staying generic and Array mutators on primitives now
throwing (Bug 108); `new <proxy>` routes to the proxy's target
[[Construct]] (or `construct` trap with result validation) instead of
re-entering the `Proxy` constructor (Bug 122); `typeof`/`instanceof` on
a proxy see through to the target (`typeof new Proxy(fn, {})` folds
`"function"`, `p instanceof Function` folds true) (Bug 123); the
object-level proxy traps `deleteProperty` / `defineProperty` /
`setPrototypeOf` / `preventExtensions` / `getPrototypeOf` are dispatched
with strict/Reflect throw-vs-boolean semantics (falsy trap results
throw in Object paths) (Bug 124).
