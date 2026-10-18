---
"@nudojs/core": patch
---

Host-record prototype-chain pollution cluster (root-cause class C6) from the
differential bug report: class-spec records (`methods`/`staticMethods`/
`statics`/…) are registered as null-prototype objects and every dispatch
site reads them with own-property semantics, so `Object.prototype` names
(`toString`, `hasOwnProperty`, `constructor`, `__proto__`, …) are no longer
misread as class members — `c.toString()` stops folding `"[object
Undefined]"`, `c.hasOwnProperty(k)`/`c.valueOf()` stop throwing phantom
host TypeErrors, and `c.constructor === C` folds true (Bug 90).
`DataView.prototype` dispatch consults `DATAVIEW_ACCESS_BITS` with
`Object.hasOwn`, so unmodeled methods (`toString`, `valueOf`,
`hasOwnProperty`, …) no longer fold the `number` domain or phantom
RangeErrors (Bug 91). `D.hasOwnProperty("m")` recognizes own static
methods/accessors as non-enumerable own class-value properties
(own-only — ancestor statics answer false).
