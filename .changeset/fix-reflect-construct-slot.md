---
"@nudojs/core": patch
---

`Reflect.construct` argument-slot fix (root-cause class C10): the shared
`enforceArgsList` call indexed `args[2]` for both `apply` and `construct`,
so the valid two-argument `Reflect.construct(A, [])` was analyzed as an
unconditional TypeError while genuinely invalid forms (non-object
argsList, non-constructor newTarget) passed silently. argsList is now
validated at `args[1]` for `construct`, and a present `newTarget` is
checked for constructability (Bug 121).
