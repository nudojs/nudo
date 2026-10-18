---
"@nudojs/core": patch
---

Transpiler special-case cluster (root-cause class C4) from the differential
bug report: `this.#x++` / `#x--` / `#x ||= v` on private fields transpile
instead of raising `nudo:unsupported` and fail-closing the whole module
(Bug 80); function-declaration bindings passed to `Object.*`/`Reflect.*`/
`in`/`JSON.stringify`/coercing globals are normalized to Abs at the
`$invoke` argument choke point, so `Object.keys(declaredFn)` no longer
crashes the builtin dispatch with an internal TypeError (Bug 85); computed
accessor keys in object literals are evaluated exactly once (Bug 112);
`super.x` in a static field initializer resolves through the parent
constructor's statics instead of the instance prototype chain (Bug 119).
