---
"@nudojs/core": patch
---

fix(core): Array.prototype method reads no longer hijack `$invoke`

`$get` returned `absFunction([], { body: noBody })` for Array.prototype
methods (`concat`/`sort`/…). `$invoke` treated that hollow impl as an object
method and `$call`ed it, folding `a.concat(b)` to exact `undefined` and
`arr.sort()` to `never`/TypeError — false precision vs the previous
conservative `unknown` (benchmark gate: `array-03` / `complex-01` regressed
`unknown → mismatch`).

First-class reads still expose a function-shaped Abs (`typeof a.push ===
"function"`), but without a callable impl so method calls fall through to
`invokeArrMethod` / conservative `unknown`.
