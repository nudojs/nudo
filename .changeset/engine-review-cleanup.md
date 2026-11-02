---
"@nudojs/core": patch
---

Refactor: engine review clean-up batch — consolidate duplicated logic and add drift guards, zero behavior change.

- runtime: route `$for` exit-join through the shared `applyLoopExitJoin` entry (container-widen hook parameterized); extract `arrayFamilyElementDomain` as the single source for the #156 element-domain convention (4 call sites); drop a dead rethrow arm in `$for`'s catch chain; delete the hooks setter re-export relays (`containers/member.ts`, `runtime/state.ts`, `runtime/containers.ts`) so the "registrants must import hooks.ts directly" invariant is structural.
- transpile: unify the five guard arm-shadow-binding emitters in `stmt/predicates.ts` onto one parameterized skeleton; split `stmt/statement.ts` (2619 lines) into module-stmt / loop-stmt / switch-stmt / try-stmt domain files; converge the `emitMemberTargetAssign` fallback arm onto a `member-path.ts` planning function.
- class: extract `resolveChainSpec` cursor primitive (replaces 6 hand-copied BUG-172 chain walks); table-drive the Number/BigInt prototype radix/precision domains; split `class/invoke.ts` (2283 lines) into `prim-methods.ts` + `proto-borrow.ts`; drop the dead no-`hasExtends` legacy arm of `$class`.
- guards: new `nudo-injection-names` drift gate pinning the 12 `__nudo*` host injection names against emitted code; new `invoke-arr-method-parity` test pinning the Array.prototype generic-borrow path against `invokeArrMethod`.
- docs: kernel-merge.md collector-scope table — move yieldStack / genPathSensitive / genJoinOverride to the scoped row (matches `createScopedSlot` reality).
