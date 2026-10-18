---
"@nudojs/core": patch
---

Throws-domain cluster (root-cause class C1) from the differential bug
report: `Object.setPrototypeOf` on frozen/sealed/non-extensible targets
throws `TypeError` (shared `protoChangeAllowed` with `Reflect`) (Bug 120);
`Object.keys/values/entries/getOwnPropertyNames`, `for..in`, `Object.assign`
and object spread project TypedArray index keys `"0".."n-1"` from the
length slot instead of folding an exact empty view (Bug 125 + residual);
`Object.freeze/seal` on a non-empty TypedArray throws / records may-throw
(Bug 129); `String.raw` misuse throws / records `TypeError` (Bug 97);
`new <TA>(buffer, byteOffset, byteLength)` validates bounds and alignment
(Bug 101); `Array.from({length: 2**32})` hits the `RangeError` ceiling
(Bug 104); literal digits/radix domain checks hoist above the receiver
guard (`Math.random().toFixed(500)` throws) and `toLocaleString` no longer
passes args to the redirected host `toString` (Bug 107); spread/rest copy
enumerable own properties only (Bug 109); private-name access on a closed
plain object throws (Bug 115); module bodies run strict — `new Function`
seam prefixed with `"use strict"` and `arguments.callee` read/write/delete
throw (Bug 116); TypedArray construction and `.from` convert items
(bigint/symbol mismatches throw) (Bug 131). Bugs 5/7/11 were already fixed
at HEAD (verified, no change).
