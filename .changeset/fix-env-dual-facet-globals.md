---
"@nudojs/core": patch
"@nudojs/env": patch
---

fix(env): env-declared `Number`/`Array`/`Promise`/`Date` no longer shadow away call/construct

Declaring `nudo.env` (e.g. `"es"`) bound these globals as namespace-only
`objAbs` objects. Once shadowed, `Number(x)` and `new Array(n)` found nothing
callable/constructible and degraded to `unknown` — the opposite of the host
identity path (no env), which folds via `GLOBAL_FNS` / `$new`'s `cls === Array`.

Dual-facet globals now model both faces (issue #58 option 1):

- Abs `fn` may carry static `slots` (`Number.isFinite`, `Array.isArray`, …).
  `$get` / `$in` read them; `typeof` stays `"function"`.
- `$new` dispatches Abs constructors by name through `evalBuiltinNew`
  (Array/Date/Promise/Number/String/Boolean/Map/Set/Error), instead of only
  the Error/Promise special cases.
- ES env declares `Number`/`Array`/`Promise`/`Date` as callable `envFn` with
  static slots and a ctor `name`, so call, construct, and statics all keep
  builtin semantics under env shadowing.

`Number(s)` folds to `number`, `new Array(n)` to a holey tuple, and
`Number.isInteger` / `Array.isArray` stay precise with `nudo.env` declared.
