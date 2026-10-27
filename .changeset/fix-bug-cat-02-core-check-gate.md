---
"@nudojs/core": patch
---

Fix bug-report category 02 (core check gate / L1 + L2) — 11 of 13 defects.

- BUG-023: call records are split into a top-level phase and a function-body phase, so a
  call inside a sibling function body is no longer invisible to `nudo:interface-drift`
  (the "unexecuted sibling body is not today's domain" rule is preserved). `inner.js` now
  reports the same three drifts as `top.js`.
- BUG-029: drift comparison normalises union spellings recursively before `leqAbs`, so a
  nested-literal union and its flat spelling stop producing a false drift (and `health`
  stops exiting 1).
- BUG-030: a contract conflict between two disjoint finite literal sets is an **error**
  that short-circuits the undecidable path, so `@nudo:assume` bounds no longer produce a
  contradictory "not computable" warning alongside a green gate.
- BUG-084: `@nudo:invariant` attribution is driven by a consumption ledger, so
  `nudo:invariant-relied` is emitted only for invariants actually consumed.
- BUG-128: the `nudo:entry-may-throw` suggestion lists the gate's full remaining kind set
  (folding the Error family to `Error`, else a comma list) instead of an arbitrary first
  kind, so acting on the suggestion clears the diagnostic.
- BUG-137: a `sum` containing a true `unknown` member is reported as inference failure,
  so `nudo:unknown-inference` is no longer missed inside a union.
- BUG-138: a `ReferenceError` suggestion names the real unbound local / re-exported
  identifier in the file, or says the identifier is not bound at all.
- BUG-210: declared throws are the union of `declaredThrowsForEntry` and
  `effectiveInterface().throws.kinds` (`*` wins), so a sidecar's `throws` is no longer lost
  when the source carries `@nudo:throws`.
- BUG-223: `interfaceTierOf` classifies only real top-level function bindings (same
  criterion as the LSP's `topLevelFunctionSlots`), so an export alias is no longer given
  its own tier.
- BUG-251: the generated segment is reported layer-agnostically, so drift candidates are
  found even when a source-level `@nudo:contract` exists (a persisted `@generated`
  section is no longer a dead artifact).
- BUG-261: the return-position contract parse uses the same "is a valid constraint name"
  test as the parameter side, so an invalid return segment yields
  `nudo:contract-syntax` instead of silently evaporating.

Regression tests: `core-bug-{023,029,030,084,128,137,138,210,223,251,261}-*`
(11 files / 35 tests).

Known follow-ups NOT covered here: BUG-099 (needs
`service/src/analyzer-orchestrate-uncached-cases.ts` or `nudojs/src/commands/test.ts` —
`nudo test` never calls `checkSource`, so `nudo:recursion-truncated` cannot reach it);
BUG-247 (needs axiom seeding in `core/algebra/generalize.ts` or the LSP `hover.ts` /
`inlay.ts` callers).

## 追加：drift 与写盘面的域口径对齐（BUG-199 的 core 侧根因）

`nudo:interface-drift` 的「今日重算」与 `contract --emit` 的写盘面此前不是同一
域口径 ⇒ `--emit` 把单点观测写成 `number()` 之后，`nudo health` 立刻报 2 条永久
漂移（永不收敛、每次 refresh 后复发）。现两侧共用
`core/src/algebra/widen-observation.ts`：

- `widenObservationAbs` —— 点观测 Abs 剥到基类型（从 service emit 移入 core，
  经 `@nudojs/core/internal` 单点导出，杜绝两份实现分叉）；
- `isPointConstraint` —— 「观测集只覆盖一个点」判据（无析取成员）。多值观测域
  （`union(lit(1), lit(-2))`）**不**拓宽：它是真实观测域，被 `number()` 吸收是
  真漂移（既有回归钉住的正是这一点）；
- 每个槽位的新鲜判据 = 「固化段 == 今日原始域」**或**「固化段 == 今日点拓宽域」，
  即「`--emit` 会不会改写这一位」。既有 drift 套件（25 例，含 BUG-023/029/251/366）
  语义不变、零改动通过。

### 追加：BUG-211 / BUG-197 已修（长度链构造期门禁 + 契约可省性进入元数面）

- **BUG-211（`min` / `max` / `length` 用在数值 prim 上无法执法 / 两通道互斥）**：① 构造期门禁
  `lengthChain(method)`（与 `gt/ge/lt/le`、`.int()` 同口径）：`fields` / `members` / `fn` / `lazy`
  直接抛；`prim !== undefined && prim !== "string"` 抛；允许 `string()`、`array(...)`（`element`
  在场、无 prim）与 `any()`。`lengthBound` 的顺序是 `finiteBoundArg` → `lengthChain` → 负界校验
  （保住既有「有限数值界」提示的优先级，`check-assume-directive-152` 的断言不变）。②
  `decideLitCmp` 按**左项**分派：`length(t)` 走长度语义（字符串字面量取 `.length`；数字等 ⇒
  不可判定），非 `var` 左项 ⇒ 不可判定，纯 `var` ⇒ 原数值比较。③ `scan/literal-shapes.ts` 的
  `checkReqs` 数值界分支跳过 `app(length, …)` —— 长度谓词只由 length 通道裁决，`argLen` 不可判时
  不再当数值比较（修掉 `0 >= 1` 假红与 `3 >= 1` 假绿）。残留（诚实边界）：数字 prim + **手写裸
  pred** 在返回位仍判 violated —— 该形态已无法经构建器构造。
- **BUG-197（`nudo:arg-count` 不认契约 `.optional()`）**：`checkOneCall`（本地）与
  `checkExternalCall`（跨文件）都在取 `effectiveInterface` **之前**调 `checkCallSite()` ⇒
  `arityFace` 只看实现签名，契约级 `constraint.isOptional` 从未进入元数面，而产物面把契约级当
  可选性权威 ⇒「产物说可省、check 说必填」。修：`arityFace(g, contractOptional?)` 让契约可选位
  **优先**；`checkCallSite` 透传；`scan-literal-calls.ts` 新增
  `contractOptionalIndexes(ei, paramNames, formals)`（位次映射与 `interfaceToIndexed` 同一套，
  §3.3 只对 `handwritten` 生效），本地与跨文件路径都先算 `ei` 再走同一 helper ⇒ 两面同口径。
  公共 API `checkCall` 语义不变。

回归：`core-bug-211-min-max-prim-gate.test.ts`（14 例，含手写纯数据约束与返回位同结论）、
`core-bug-197-arity-contract-optional.test.ts`（5 例，本地 / 跨文件 + 真缺必填对照）；mutation
反向验证（删掉那一行 / 退回旧调用 ⇒ 恰好对应断言失败）。相关面 363 通过 + 1 expected fail。
