---
"@nudojs/harvester": patch
---

Fix bug-report category 16 (harvester) — all 13 defects.

- BUG-123: promoted interface members are tagged and excluded from `declare module`
  records, the package-root merge and the unresolved fallback, so a member is no longer
  published as a phantom package export (nudo no longer accepts an import TypeScript
  rejects).
- BUG-124: `emitAbs`'s object case emits `index` / `open` (and slot
  `optional` / `readonly`) via `objOf(slots, opts)`, so the `interface` and `type` alias
  forms harvest identically.
- BUG-126: `signatureToFnSig` computes `optionalParams` (question / rest) and projects it,
  so optional parameters and arity survive harvesting.
- BUG-141: namespace + namespace merges members (declaration merging) instead of counting
  a skip.
- BUG-142: overload returns are unioned and a generic α is kept only when the merged
  parameters can bind it, so no dangling α or pool replacement is produced.
- BUG-143: an identifier-named `ModuleDeclaration` falls through to the generic export
  path; only string-named ambient modules are skipped.
- BUG-144: enums are modeled as member→literal objects (numeric auto-increment, string,
  const), matching the draft DSL.
- BUG-212: `nsSlotsByName.get` uses the same `\0` separator as `set` (all four sites
  aligned), so a function declaration is no longer dropped when a namespace is declared
  first.
- BUG-213: the union join is guarded by a bounded path-cost DFS with a directly-built sum
  fallback, and bounded fingerprints replace core's `absKey`-based
  `relationFingerprint` — an optional-member DAG no longer explodes
  (17.4 s + RangeError → ~1 ms).
- BUG-252: `inferFrom` / `condFallback` are emitted into `relationFn` options, so the
  persisted env module no longer degrades a conditional type to `any` (and the L1 gate
  stops being falsely green).
- BUG-253: `emitEnvModule` no longer writes promoted interface members into the env's
  globals / module records.
- BUG-265: a new `private` bag (module-private top-level declarations) is subtracted in
  the "public surface unknown" fallback, with exported names winning.
- BUG-280: declared literals round-trip with `conf: "exact"` instead of `mock` (so
  `widenUncertainLiteral` stops widening them), and the harvest JSON ABI is bumped
  v11 → v13 with the promoted-member provenance persisted — a cold and a hot
  `nudo export` are now byte-identical.

Regression tests: `harvester-bug-{123,124,126,141,142,143,144,212,213,252,253,265,280}-*`
and the ABI literal in `harvest-bug-803-disk-facet-roundtrip.test.ts` bumped to `v13`
(required by the documented "bump ABI when harvest semantics change" rule).

Known follow-ups NOT covered here:
- BUG-253 is fixed at the emit boundary only; `env.globals` still carries promoted members
  because `harvest-bug-807-method-two-paths` and `harvest-bug-808-promoted-optional-member`
  assert exactly that shape.
- `harvest-disk.ts` still swallows harvest failures (`catch { h = null }`);
  `PackageHarvest` has no diagnostic channel.
- Core-side residual risk: `absKey` remains exponential on shared DAGs, so
  `absFingerprint` (generic instantiations) and other core callers still pay it.

## 追加：BUG-253 完整修法（源头消除幽灵全局）

上一版只在**出口**（`emitEnvModule`）过滤提升出来的成员——收割面的 `env.globals`
仍留着幽灵名字。现按条目「修复方向」在源头消除：

- `harvest-dts.ts` 的 `materialize` 只对**模块作用域**的值位置声明提升成员
  （`p.scope.moduleName !== undefined`）；顶层 `export declare const o: Opts;`
  的 `p.scope` 是全局作用域 ⇒ 不提升，成员只在接口内部 / brand 面可见。
  这正是 `@types/lodash` 泄漏 60 个方法名（`clone` / `isEqual` / `now` …）的形态。
- 提升路径本身不受削弱：模块作用域形态（`@types/node` 24 `path`、lodash
  `LoDashStatic` 的 `declare module` 形态）照旧提升。

已有测试更新（原先钉住的是**顶层提升**这一错误行为，已按条目口径改为模块作用域）：

- `harvest-bug-807-method-two-paths.test.ts`（fixture 包进 `declare module`；
  断言改 `env.modules.*`）
- `harvest-bug-808-promoted-optional-member.test.ts`（同上）
- `harvest-bug-977-optional-method-member.test.ts`（同上）
- `harvest.test.ts` 的「interface augmentation merge (lodash LoDashStatic)」
  （合并仍生效，但成员落在模块面；新增「不得成为裸全局」断言）
- `harvester-bug-253-promoted-not-emitted-globals.test.ts`（由「收割面仍保留、
  出口过滤」改为「收割面即不产生」）

新增回归：`harvester-bug-253-ghost-globals.test.ts`（顶层不提升 / 模块作用域提升 /
接口单声明基线三向对照）。`tmp/verify-bug.sh BUG-253` → exit 1。
