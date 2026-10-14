---
"@nudojs/core": patch
---

Class-surface diagnostics: static-on-instance calls and class-body self-name writes fold exact (P4).

Static-only member on an instance receiver (`class C { static m() {} } new C().m()`):

- native throws `TypeError` (`c.m` is `undefined` — statics live on the constructor, not `X.prototype`); the engine previously degraded to `unknown` (N2 sound stop-gap)
- now exact: when the class registry proves the member static-only (registered `staticMethods`/`staticAccessors`/`statics`/class-value slots anywhere on the chain) and the instance face provably lacks it (no method/accessor/builtin-brand member on the chain, no same-name instance field, no own receiver slot, no chain hole, not an `Object.prototype` name), `$invoke` throws a definite `TypeError`
- guards keep everything else unchanged: `c instanceof C` → true, instance-method calls, member reads (`typeof c.m` → `"undefined"`), optional calls (`c.m?.()` short-circuits to `undefined`), ctor-assigned own fn slots, same-name instance fields/getters, prototype-chain instance methods shadowing statics, class-value static dispatch

Class-body self-name binding is immutable (native `CreateImmutableBinding`):

- `C = v` / `C++` inside methods, accessors, static blocks, and field initializers now folds definite `TypeError` (was: silent rebind — N4's documented sound over-approximation); routed through the existing const-assignment channel (`constNames` on class-body member opts)
- the outer binding stays mutable on purpose: native `class C {}; C = 5` is legal (ClassDeclaration `IsConstantDeclaration` is false — verified on Node 26: no-throw, `C` becomes a number); the engine's outer-`let` emission already matched native and is unchanged, as are `let D = class {}; D = 5` and function-scope classes
- member writes on the class name (`C.q = v`, compound/update/logical-assign) still rebind through the internal root-rebind path — unaffected

Binding-shadow fixes required by the above (wrong-definite throws, pre-existing for module `const` too):

- function-boundary params are subtracted from inherited const bindings: `const K = 1; function f(K) { K = 5; }` no longer folds `TypeError` (writes the param binding — native no-throw); covers declarations, expressions, arrows (incl. expression bodies), and class methods
- catch params likewise: `try { … } catch (K) { K = 5; }` with an outer `const K`/class-body name no longer falsely throws
