---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.17.2 |
| `@nudojs/service` | 1.10.3 |
| `nudojs (CLI)` | 1.7.3 |
| `@nudojs/parser` | 1.5.6 |
| `@nudojs/lsp` | 1.8.3 |
| `@nudojs/env` | 0.5.6 |
| `@nudojs/harvester` | 0.4.6 |
| `vite-plugin-nudo` | 0.6.3 |
| `nudo-vscode` | 0.3.54 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.17.2 {#pkg-core}

## 1.17.2

### Patch Changes

- 51e69f8: Fix bug-report category 01 (predicate algebra / arithmetic / constraint・leq / postcondition).
  
  - BUG-001: a same-prim literal union used as a **return** contract is no longer reported
    violated when the value's predicate already proves membership — the union branch now
    tries the aggregate (arm ⇒ merged-disjunction) implication before falling back to
    per-member checks.
  - BUG-002: `number().int()`'s return obligation is enforced for non-literal returns;
    failure is reported as `nudo:unproven-return` instead of silently staying green.
  - BUG-027: `export --format dts` no longer widens a non-same-prim literal union to its
    base type, so the published `.d.ts` matches the enforced contract.
  - BUG-088: `.optional()`'s omittable / may-be-undefined semantics survive the
    contract ⇒ entry-Abs projection; call-site and return positions agree, and the check
    signature and `.d.ts` now express the same optionality.
  - BUG-208: sidecar `fn()`'s `throws` slot splits separators like `@nudo:throws`, so
    `throws: "TypeError, RangeError"` no longer silently becomes one unknown kind.
  - BUG-209: `pick()` / `omit()` / `partial()` preserve the `optional` flag, so legal
    calls are no longer judged violating and `dts` keeps the `?`.
  
  Regression tests: `core-bug-001-*`, `core-bug-002-*`, `core-bug-088-*`,
  `core-bug-208-*`, `core-bug-209-*`, `service-bug-027-*`.
  
  ### 追加：BUG-077 / 083 / 106 / 200 已修（IEEE 舍入不再是实数环）+ 4 处授权重钉
  
  根因族：线性区间层把 `+ - *` 当**实数环**运算、比较归一精确抵消常量 ⇒ 舍入（吸收 / ties-to-even）
  被抹掉 ⇒ 假证。修法是统一机制，不是逐例特判：
  
  - `pred.ts` 的 `Lin` 新增 `rounds`（舍入运算次数）与 `addConstMag`（参与舍入的加性常量最大量级）；
    `applyCmp` 把界按**舍入前像区间**外扩 `slack = rounds × ½ulp(max(|k|, addConstMag))`，方向保持
    （`gt → lo−`、`lt → hi+`、`eq → 两侧`）；`rounds === 0`（纯 var/lit、2 的幂缩放、`x+x` 精确加倍）
    仍是精确点反解（BUG-077，取 section 方案 B：保真且不丢信息）。
  - `proveInCtx` 在 `linInterval` 后按同一 slack 把端点外移（`nextDown` / `nextUp` 各再退一格），
    strict 语义保留 ⇒ `x>0 ⊬ x+1>1`，而 `x>0 ⊨ x+1>=1`（直接比较路径）与 `x>1 ⊨ x+1>1` 仍可证
    （BUG-083）。
  - `linInterval` 按 atom key **稳定排序**后累加 ⇒ `x+y` 与 `y+x` 同结论（BUG-200 的独立根因，
    `Map` 插入序曾让同一加法换序得出相反结论）；`linFormsEqual` 要求**两形都精确**
    （`rounds === 0`）⇒ `x*6` 与 `x+x+x+x+x+x` 不再判「同值」（BUG-106，此前把 IEEE 加法当结合律 /
    分配律，抛臂被消 ⇒ L2 假绿）。
  - 「有限证据 ⇒ 环语义」闸门：`atomsFinite(ctx, lin)`（所有原子有 `assumeFinite`，或
    `typeof=number ∧ 双侧有限界自动导出`）成立时 slack 归零、`linFormsEqual` 的 `ringOk` 放行 ——
    与 `linOf` 既有的 `ieeeOk` 口径一致（`@nudo:assume-finite` 的环消去 / 分配律契约不变）。
  
  **重钉 4 处（依据 section 声明，不是放宽断言）**：
  
  | 文件 | 原断言 | 新断言 | 依据 |
  |---|---|---|---|
  | `pred-linof-ieee.test.ts` `y>1 ⊢ y+1>2` | `true` | `false` | BUG-200:136 触发形态；`(1+2**-52)+1 === 2`（ties-to-even） |
  | `pred-assume-finite.test.ts` 同款 | `true` | `false` | 同上 |
  | `arithmetic.test.ts` `x>0 ⊢ x+1>1` | `true` | `false` | BUG-200:14-16,27,30；反例 `Number.MIN_VALUE` |
  | `example0.test.ts` `cmp("gt", x+1, 1)` | `{ok:true,value:true}` | `{ok:false}`（另新增 `ge` ⇒ `{ok:true,value:true}`、`lt` ⇒ `{ok:true,value:false}` 对照） | 同上；`{ok:false}` 是**真·不可判定**（Φ 内既有 `x=MIN_VALUE` 的 false 也有 `x=1` 的 true），「确定 false 可判定」的口径由新增 `lt` 断言单独钉住 |
  
  回归：`core-bug-077-rounding-preimage` / `core-bug-083-goal-const-cancel` /
  `core-bug-106-linforms-eq-ieee` / `core-bug-200-strict-endpoint-const-cancel`（45 例）。
  全量 `packages/core/src/algebra/__tests__`：967 文件 / 10 368 测试 / 0 失败。
  
  未改动：`arithmetic/cmp.ts:88` 的造值点本身无错 —— 假事实消除后它自然不再折 `true`。
  遗留提示（docs 面，本轮未改）：`docs/design/cli-semantics.md:347`、`docs/examples/README.md:29`、
  `docs/examples/constraints/README.md:4` 仍把 `x>0 ⇒ x+1>1` 当示例口径。
  
  ### 追加：BUG-005 / 006 / 224 / 225 / 010 已修（返回通道漏评 + 端点见证步进 + 项化简域守卫）
  
  - **BUG-005（`array(...)` 的长度界在返回位不执法 ⇒ 假绿）**：`assertImpliesSingle` 的 `element`
    分支只对账元素域就 `proved()`；`array(...)` / `shape(...)` 无 `prim` ⇒ 约束自身的 `preds`
    （`ge(length(self), n)`）永远走不到 `assertScalar`。修：新增 `assertStructuralPreds` —— 结构对账
    通过后**只**实例化约束自身的 `preds`（摘掉 `fields/element/members/prim/fn`，否则
    `instantiateOnTerm` 的 fields 分支会把 preds 丢掉），把 `length(<返回项>)` 用**已知结构长度**
    （tuple 元素数 / obj 自有非 internal/symbol/inherited 键数）接地后三值判定：真 ⇒ proved、
    假 ⇒ disproved、接地不了 ⇒ unprovable（不再伪装 proved）。
  - **BUG-006（`lit(null)` / `lit(undefined)` 成员的 union 无法证违结构化返回值 ⇒ 只 warning）**：
    `prim` 缺失让值相等义务落到「无证据」兜底，而 union 的「任一成员 unprovable ⇒ 整体 unprovable」
    把已证伪的 `number()` 成员掩盖。修：`isBoundedEvidenceMissing` **只对带界原子**
    （`gt/ge/lt/le`）保留「证据缺失」语义；新增 `valueEqualityDecidable` —— `eq` 义务的字面量域与
    返回项形状域**不相交**（结构形状 vs 任何字面量；prim vs 域外字面量 / nullish）即可判定 ⇒
    不蕴含即 `disproved`。只认 `eq`（`ne` 在域不相交时是**成立**，纳入会造假红）；同域 `eq` 仍是
    unprovable（护栏有测试钉住）。
  - **BUG-224（端点合成丢「最紧可达值」⇒ `(x+x)/2` 假红）**：`Endpoint` 增加 `attain?`，
    `synthEndpoint` 用 `a.attain ?? nextUp(...)`；新增 `attainEndpoint` 只对**可精确反解**的缩放形态
    给可达下界（`t + t` ⇒ `2·nextUp(E/2)`；`t × 2^k` ⇒ `k·nextUp(E/k)`，上侧对偶），在 mul/div
    两端点调用点接入（`addsub.ts` 未改：`x+x` 的 attain 由调用点从分子结构与分子自身 strict 界反解）。
  - **BUG-225（`roundingAbs` 丢 strict 见证步进 ⇒ `Math.ceil` 假红）**：strict 端点做见证步进
    `impl(nextUp(lo))` / `impl(nextDown(hi))`，结果记「可达」（不透传 strict，否则会宣称
    `ceil(x) > 1` 造成新的假红）。
  - **BUG-010（`simplifyTerm` 的 `x - 0 = x` 缺 number 域守卫）**：加与 `surviveMulOne` 同口径的
    守卫 —— 非 number 字面量走 ToNumber（`"abc" → NaN`、`true → 1`、`null → 0`、`"5" → 5`、
    `undefined → NaN`），bigint 混型保留原 app；非字面量项仍走 `x - 0 → x`。
  
  回归：`core-bug-005-*` / `core-bug-006-*` / `core-bug-224-*` / `core-bug-225-*` /
  `core-bug-010-*`（38 例）；gold 面 `check-gold` / `check-recall-gold` / `check-shape-gold` /
  `engine-depth-gold` 全绿（248 通过 + 1 expected fail）。既有测试零改动、零重钉。
  未改：`interface.ts` 的 `formatConstraint` 仍不渲染 array/shape 长度链（违例文案在 postcondition
  侧本地补 `length(return) ≥ n`）。
  
  ### 追加：BUG-245 / BUG-246 已修（union 源不得重跑聚合谓词；可选槽吸收 undefined）
  
  - **BUG-245**：`leqWithPred` 在 `leqShape` 的 sum 源分支**逐成员**跑过
    `leqWithPred(m, tgt, …)`（各自含 `leqPred`）后，又在尾部跑一次**聚合** `leqPred(src = sum, tgt)`；
    而 sum 不带顶层 pred（`makeSum` 与 `constraintToCaseArgAbs` 都不产）⇒ 聚合检查走「源无谓词」
    分支 ⇒ 目标带谓词时即 false ⇒ `union(number().gt(0), number().gt(5)) ⊭ number().gt(0)`
    —— 假红，且两侧渲染成同一文本。修：sum 源且**自身无顶层 pred**
    （`!src.pred || src.pred.op === "true"`）时跳过聚合 `leqPred`。该 pred 守卫是必要的：
    `narrow.ts` 的 `{...a, shape: sum}` 会保留 `a.pred`，真正带顶层 pred 的 sum 仍需聚合检查。
  - **BUG-246（两面根因）**：① `leq.ts` 的 obj 槽分支只对**缺失**槽认 `slot.optional`，
    present-but-`undefined` 直接进 `leqWithPred` ⇒ `undefined ⊭ string`。改为一条**对称**规则：
    目标可选 ⇔ 源侧「缺失**或** undefined」可赋；源槽可选对 required 目标仍失败，纯 `undefined`
    对 required 目标仍失败。② `scan/literal-shapes.ts` 的 `checkShapeAgainstAbs` 才是 `nudo check`
    侧 `nudo:constraint-violated` 的**生产者**（实测：对该夹具 `leqAbs` 调用 **0** 次，而同族的
    BUG-245 夹具 3 次），它同样只对缺失槽认 `field.optional`，随后 prim 门禁报
    `typeof o.a = "string"` —— 与签名面 `a?: string` 自相矛盾。修：同一共享判定。
    共享 helper（`leq.ts` 导出，**不经** `algebra/index.ts` 再导出 ⇒ 无公共 API / 快照变化）：
    `isUndefinedAbs`（本仓 `PrimName` 不含 `undefined`；`undefined` 是
    `shape unknown + term lit(undefined)`）、`mayBeUndefinedAbs`（含 sum 成员递归；`null` 排除，
    对齐 `strictNullChecks`）、`nonUndefinedAbsValues`（剥掉 undefined 臂，`[]` 表示全 undefined）。
    两处都**先剥后执法**，因此 `{a: number | undefined}` 对 optional `string` 仍失败（未放宽）。
  
  回归：`core-bug-245-union-source-leq.test.ts`（7 例）、
  `core-bug-246-optional-slot-undefined.test.ts`（13 例：9 代数 + 4 L1 门禁）；gold 面 331 通过 +
  1 expected fail；`public-api-freeze` 9/9。e2e：optional 夹具 `nudo check` exit 0 且无
  `nudo:constraint-violated`（tsc 亦通过），required 夹具 exit 1 且有该码（tsc TS2322）—— 引擎与 tsc
  结论一致。三面同源：`check-case-scan.ts` 的 `witnessViolations` 字段循环（`@nudo:case` 见证面）
  也改用同一判定；并补真 CLI e2e `cli-bug-246-optional-slot-undefined.test.ts`（optional 夹具 exit 0
  且零 `nudo:constraint-violated`、required 夹具 exit 1 且恰好一条、required + 合法值 exit 0）。
  
  ### 追加：BUG-082 / BUG-058 已修（契约 ∪ 默认值域；`String()` 走 string hint）
  
  - **BUG-082**：契约路径把形参 Abs **整体替换**成 `constraintToEntryAbs(...)`，默认值初始化式从未参与
    ⇒ 形参域被收窄、返回面随之收窄 ⇒ `pick(s = "abc")` 配 `fn({s: number()}, number())` 在被调方
    判绿（`OK`, exit 0），而同一契约在零调用点面正确报红。修（section 方案 1）：契约绑定时把**默认值
    类型并入形参定义域**（契约域 ∪ 默认值类型；默认值落在域内时保持契约域原样 ⇒ 合法形态零变化）。
    实现为 `generalize.ts` 内三个纯函数：`defaultInitAbsOf`（AST 字面量 → Abs）、`fnParamNodesOf`
    （按名取最浅层函数节点的形参 AST）、惰性闭包 `defaultInitAbsOfParam` + `contractDomainOf`
    （`leqAbs(initAbs, entryAbs)` 通过则原样返回，否则 `joinAbs`）。冲突经**既有** L1 返回契约对账
    通道执法，未新增诊断码。局限（如实记录）：只并入**字面量**初始化式，`s = compute()` 这类不猜
    （避免假红）。`.d.ts` 可省性在 HEAD 上已正确（`pick(s?: number)`），本次用测试钉住其上游事实
    （契约路径下 `formals[0]` 仍是 `{kind:"default", optional:true}`）。
  - **BUG-058**：`isNullProtoWithoutCoercer` 是 ToPrimitive 前置闸门的统一调用面，却把 hint 写死
    `"default"`；`String()` 复用它而没传 `"string"` ⇒ 原生**不调** `valueOf` 的路径被调（用户副作用
    凭空多出）。修：`isNullProtoWithoutCoercer(a, hint: CoercionHint = "default")`（默认值保持
    `"default"` ⇒ `+` 面调用点无需改动、语义不变），`builtins/global.ts` 的 `String()` 改传
    `"string"`；`"string"` hint 下**无自有 `toString` 钩子时绝不回退** `valueOf`；用户 `toString`
    返回**非原语**时仍回退 `valueOf` —— 这是 ES `OrdinaryToPrimitive` 的规定（node 实测
    `String({toString:()=>({}), valueOf(){c++;return 1}})` ⇒ `"1"`, c=1），删掉回退反而偏离原生。
  
  回归：`core-bug-082-contract-default-param.test.ts`（7 例）、`core-bug-058-string-hint.test.ts`
  （8 例）。CLI 取证：`viaString() => 10` 变为 `=> 0`（native 0），`only-viaPlus.js` 仍 `=> 10`
  （native 10）。同族仍未改：`methods.ts` 的 `String.prototype.concat` 与**模板插值**的降级点
  （`${o}` 现被降级成 `$add($add($lit(""), o), $lit(""))`，与用户写的 `"" + o` 逐字同形 ⇒ 信息在
  降级处丢失，需专用 `$toStr` op）。
  
  ### 追加：BUG-058 模板插值 / `String.prototype.concat` 面已修（专用 `$toStr` op）
  
  `${o}` 原先被降级成 `$add($add($lit(""), o), $lit(""))`，与用户写的 `"" + o` **逐字同形**；而 `+`
  必须用 default hint（原生 `"" + o` 会调 `valueOf`）、模板插值必须用 **string hint** ⇒ 信息在降级处
  丢失，无法靠调用点区分。修：`exec/runtime/ops.ts` 新增 `$toStr(a)` —— 走
  `isNullProtoWithoutCoercer(a, "string")` + `invokeToPrimitiveHook(a, "string")`；`Symbol` ⇒ 抛
  `TypeError`；字面量 ⇒ 字符串字面量；否则 `string()` 并记 may-throw。
  `exec/transpile/expr/atom.ts` 的 `TemplateLiteral` 插值位包一层 `$toStr`；`exec/index.ts` 导出并
  在 `runtime-import.ts` 的 `RUNTIME_IMPORT_NAMES` 登记。另：`methods.ts` 的
  `String.prototype.concat` 是 ToString 面，也改传 `"string"`。
  
  回归：`core-bug-058-string-hint.test.ts` 扩到含模板插值与 `concat` 的副作用计数；coercion 家族
  （`concat-spreadable`、`eval-arith-coercion-throws`、`core-bug-381`、`core-bug-1121`、
  `core-bug-261/262/402` 等）221 例全绿。
  
  ### 追加：`public-api.snapshot.json` 记录 `./exec` 新增的 `$toStr`
  
  模板插值的 `$toStr` op 是 `./exec` 的导出（`exec/index.ts`），快照面必须同步记录——
  `public-api-freeze` 的 `./exec` 分母因此从 208 变 209。该条目属于**快照正常演进**
  （导出面确实多了一个算子），不是放宽门禁。
- 51b510a: Fix bug-report category 02 (core check gate / L1 + L2) — 11 of 13 defects.
  
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
- aed8e00: Fix bug-report category 03 (evaluation engine) — verified subset.
  
  - BUG-194: `$copy` / `$set` on a host global no longer crash the engine with a bare
    TypeError (`nudo:internal` false red); the fork/copy path handles host objects.
  - BUG-218: Proxy `has` trap gains the ES invariant check, so a trap that violates
    [[HasProperty]] is a definite TypeError instead of a false green, and the engine no
    longer prints a `false` the host can never produce.
  - BUG-219: `delete <host global>.x` / `"x" in <host global>` route through `$del` /
    `$in` correctly instead of raising a bare TypeError.
  - BUG-243: `Array.prototype.indexOf` no longer clamps `fromIndex` to `len - 1`;
    `fromIndex >= length` returns `-1` like the host (the sibling `lastIndexOf` clamp was
    already correct).
  - BUG-244: array-like receivers are no longer mis-reported as may-throw for
    `sort` / `reverse` / `copyWithin` / `fill`, and a comparator returning bigint is
    recorded as `TypeError` (host kind) rather than a generic `Error`.
  - BUG-249: `strictEqAbs`'s "same Abs ⇒ same value" fold now honours the domain-sharing
    gate, so `xs[0] === xs[1]` over a contract-typed array no longer folds to `true`.
  - BUG-254: env-global injection no longer splices names verbatim into `let` bindings, so
    a strict-mode reserved word can no longer produce a `new Function` SyntaxError that
    fails the whole module closed.
  
  Regression tests: `core-bug-194-*`, `core-bug-218-*`, `core-bug-219-*`,
  `core-bug-243-*`, `core-bug-249-*`, `core-bug-254-*`.
  
  Known follow-ups NOT covered here (still reproducing): BUG-072, BUG-073, BUG-078,
  BUG-159, BUG-162, BUG-166, BUG-173, BUG-175, BUG-177.
  
  ### 追加：本轮求值引擎修复
  
  已修复（`tmp/verify-bug.sh` exit 1 的标注为脚本实证；其余为观察型 fixture，证据是 CLI
  签名与回归测试）：
  
  - **BUG-004**：类静态方法走 `$staticInvoke`（`D.s1 => 42`、`D.instance => 7`、`D => D`）。
  - **BUG-020 / BUG-180**：`@nudo:mock` 作用域收回到**声明它的函数**（`scopeSelectedInject`
    按函数自身的 mock 表过滤），依赖包内的函数同理 ⇒ `fa() => { from: "A" }`、
    `fb()` 不再误用 A 的 mock、`callMock() => "mocked"`。既有负控制
    `service-bug-455-mock-scope.test.ts` 原先钉住「非冲突 mock 是文件级」——**与 BUG-020
    声明的正确行为相反**，已改写为按函数作用域可见。
  - **BUG-072**：`definiteModuleThrowOf` 认确定性的装载期抛错（IIFE 抛、顶层调用恒抛的
    本地函数、nullish 成员读取、非法 `JSON.parse` 字面量、类静态块抛）⇒ error 级
    `nudo:module-throw`；`typeof missing` / 条件分支 / 可选访问的负控制保持干净。
    既有 `core-bug-1158-module-throw-failclosed.test.ts` 的负控制原先断言
    `JSON.parse("{")` / null 成员读取**不得**上报——同样与正确行为相反，已改写。
  - **BUG-073**：`evalFallbackOf` 把用户代码的原生异常归类为 `module-throw`（不再是
    `internal`），fallback reason 直接断言。
    连带的口径收口（不是放宽断言）：模块级原生异常此前会让分析器产出一条 error 级
    `nudo:internal`（"analysis failed for … engine internal fallback"），现在它是**可裁决
    的** `nudo:module-throw` error —— `nudo check` 依旧红、`--json` 依旧
    `ok:false` + error issue、IDE 面依旧可见（`lsp-bug-140` 与
    `nudojs-bug-1145` 两个回归用例已改到新码，契约文案随之更新）。`nudo health` 的
    判据是 drift / case drift / path error / **internal 回落**，「代码本身必抛」属于
    check 的职责 ⇒ health 对该 fixture 报 OK（`internal` → FAIL 的反向仍由
    `unsupported:*` 负控制与 CLI 内部路径守住）。
  - **BUG-078 / 159 / 166 / 175 / 177**：`renameAbs` 保留 `optionalParams` / `holes`
    （稀疏元组仍不可赋给稠密元组）；`new Storage()` 不再自信地判成 `Storage` 品牌；
    用户 `URL`/`Error`/`Map`/`Date`/`Promise` 类遮蔽宿主全局；`instanceof` 的
    Proxy/箭头/方法 RHS 产原生 `TypeError`（生成器 RHS 仍是布尔）；派生构造器返回对象
    时 `derivedReturnObj => { q: 1 }` 且无 may-throw。
  - **BUG-160 / 162**：`TextEncoder` 的 `encoding`/`encode`/`encodeInto` 齐备、
    `TextDecoder.encoding => "utf-8"`；web env 保留 `Event`/`CustomEvent`/`Request`，
    node env 诚实报 `never throws TypeError`。
  - **BUG-165**：零 `TypeError` / `entry-may-throw` 噪音；迭代器 symbol 调用产出迭代器面。
  - **BUG-173**：派生构造器 `super()` 前访问 `this` ⇒ 原生 `ReferenceError`
    （`exec/super-access.ts` 的访问门，构造器体执行期登记）。
  - **BUG-215 / 216 / 217**：不可调用的 `@@iterator` 槽确定抛 `TypeError`；可选调用只读
    一次 getter（`1`，不是 `"two"`）；计算键成员读走访问器（`o[k]` → `42`）。
  - **BUG-242 / 248 / 259**：`indexOf(3,5) => -1` / `lastIndexOf(3,5) => 2`；二元自递归
    走解释路径 + L2 α 项剥离（`bin => unknown` + `nudo:recursion-truncated`，快且不 OOM，
    线性对照不受影响）；symbol 键读写（读 `1`、计算写读 `7`、
    `getOwnPropertySymbols().length => 1`）。
  
  ### 追加：BUG-172 / BUG-220 已修
  
  - **BUG-172（同名类跨模块互相覆盖）**：注册表本体仍按裸名键（进程级 `Map`，清理语义不变），
    但**类规格改为随值携带**：`exec/class-registry.ts` 新增
    `classSpecByValue: WeakMap` + `attachClassSpec` / `classSpecOfAbs` / `carryClassSpec`，
    `EvalClassSpec.superSpec` 记录父规格。`exec/class/declare.ts` 去掉私有 `classImpl` 表，
    `$class` 把规格挂到**类值**、`superSpec` 取自**父值身份**（不再按名），`$new` 把规格串进
    构造与实例，`findMethod` 首链**规格优先**；`class/super.ts` 仅在携带规格的 `name` 等于
    当前子类名时使用它（否则派生链会误取最派生规格）；`runtime/members.ts` 新增
    `classChainLinks`（首链规格优先、其后名字链，保留既有 last-wins 语义）；
    `containers/member.ts` 的静态/实例成员与 `ownSpec` 规格优先；`containers/obj.ts` 的 fork
    快照分支携带规格。回归 `core-bug-172-class-registry-scope.test.ts`：3 模块图，两边同名
    `Config` 各读各的（`readA()===1` / `readB()===2`，互不可见，`kindA/kindB` 正确）。
    残留（已在 changeset 声明）：只拿名字、拿不到接收者值的面（`Object.prototype.*`、`Reflect`、
    `JSON`、`denote.ts`）保持既有 last-wins 口径。
  - **BUG-220（无界迭代代表元素 + IteratorClose）**：无界分支的代表元素由
    「第一个具体元素」改为**已收集元素的 join**（`abstractIterItem` +
    `UNBOUNDED_ITEM_JOIN_CAP = 8`；空集/超限 ⇒ `unknown`），且在无界步之前只提升一次 ⇒
    guard 不再被折叠成确定 false，`break` 臂得以探索。`IteratorClose` 经复核**无需改动**
    （`catch` → `isNudoBreak` → `iteratorClose(userIter)` 已可达，`return()` 的写入能到达
    循环出口）。回归 `core-bug-220-unbounded-iterator.test.ts`（5 例：复现改 `"CLOSED"`、
    有界 break/自然耗尽、精度不受损、元素域为 `unknown` 而非字面 `0`、两分支都探索）。
    残留（代码内已注明）：元素域**永不满足** break 条件的无界迭代器仍分析成 `"CLOSED" #exact`；
    要让 `closed` 进循环 pack 需要把写改到循环体内，与验收口径冲突，故不做特例。
  
  ### 追加：回落分类改为「标签 × 来源 × 可见性」三维（BUG-073 收口）
  
  `EvalFallback` 现带 `origin`（`"engine" | "host" | "module"`）与 `gateFatal`（可见性）：
  
  - **标签**（`reason`）：`module` 来源（transpiled 用户代码）⇒ `module-throw`（BUG-073：
    用户代码的原生 ReferenceError / TypeError 是**程序自身抛**，不是「引擎缺陷」）；
    `host`（宿主 `apply` 钩子 / 宿主函数边界）与 `engine`（引擎自身违约：编译体生成失败、
    引擎产出非 Abs 值）⇒ `internal`（DEC-006 canary 保留）。
  - **可见性**（`gateFatal`）：装载期逃逸 ⇒ 闸门无法裁决该文件 ⇒ `true`
    （`tryRunTranspiled` / `tryRunTranspiledDetailed` / 模块求值 catch 标
    `{ loadFailure: true }`）；能力边界 `unsupported:*` 与**建模内**的 `NudoThrow` ⇒ `false`
    （不得假红）；调用期异常 ⇒ `false`（该次调用的 `throws` 面承载）。
  - `runExportCallGuarded` 的 Abs-fn 分支按 `getFnImpl(fn)?.apply ? "host" : "module"` 传来源，
    与 `$callDispatch` 的派发顺序（apply 先于编译体）一致；`body-fn.ts` 的编译失败改记
    `engine`（否则 transpiler 失败会被误贴成用户代码的抛）。
  
  `run-export-guarded` 中一条既有断言钉的是 `internal ×1`，与 BUG-073 直接冲突（编译体自由名
  的原生 ReferenceError 是**用户代码**的抛）⇒ 重钉为 `module-throw ×1`，并改成**两个维度各
  断言一条**（internal 增量 0 / module-throw 增量 1）；可观测面（result unknown +
  throws ReferenceError）不变。
  
  ### 回归修复：`nudo health` 与 `nudo check` 的预算归因必须同源
  
  同一文件在 `nudo check --json` 与 `nudo health` 两面必须给出同一预算归因（既有
  `health-budget-truth` 断言）。
  
  **根因**：自递归「有界试算」`runEvalCallBudgetTrial` 用一次性预算实例跑探针，探针撞
  depth/calls 时结果被丢弃（调用方回落 fail-closed），而「撞了预算」这件事只随探针实例一起
  被丢弃（`withSpeculativeEvalObservability` 还把截断观测静默了）⇒ 宿主预算面上只剩旁证的
  cycle 归因：health 报「call cycle — not a budget limit」，而 check 面（证据域真跑到 64 层）报
  「eval depth 64/64」——两面口径分裂，且把「抬 `@nudo:budget` 有效」的深递归误报成「抬预算也
  解不开的环」。
  
  **修法**：探针截断后把「撞了哪条预算」**重新记账**到宿主预算实例上
  （`CallBudget.noteTruncation`，仅类型成员、**无新增导出名** ⇒ public API 冻结不变）。
  计数/上限取**宿主实例的生效上限**（`@nudo:budget` 覆盖期间取覆盖值）——试算内部阈值
  （depth=5 / calls=512）是实现细节，不上屏。状态机补 calls 截断现场（`callsTruncCalls/Limit`），
  上屏计数必到顶，不出现「3/20000 却标 truncated」。重新记账**只进预算面**（实例 reasons +
  共享原因集），**不**触发诊断 collector —— 诊断归因（cycle vs 预算，#158）仍由真正跑那条求值的
  路径上报，否则会把 `service-bug-099` 钉住的 cycle 归因改写成「抬预算可解」。
  
  **是否有重钉**：无（未改任何测试断言）。
  
  **残留**：① 诊断面措辞仍按各自求值路径分脸（分析器面 cycle / check 面 depth）——HEAD 既有
  差异，本次刻意不动；② 重新记账的 depth 取宿主生效上限而非探针阈值；③ 探针阈值
  （`generalize.ts`，depth=5 / calls=512）未动 ⇒ 收敛半径 6..64 的自递归仍 fail-closed。
- e4190b5: Fix bug-report category 04 (core builtins / collections) — 17 of 26 defects.
  
  - BUG-007: a primitive's prototype method dispatches correctly instead of being
    reported as absent.
  - BUG-008: `Object.getOwnPropertyDescriptor(fn, ...)` models a function's own
    `name` / `length` / `prototype` slots.
  - BUG-009: a regexp literal's flags are canonicalised, so `/a/gi` and `/a/ig` agree.
  - BUG-132: a boxed primitive's internal slot is modelled.
  - BUG-157: `URLSearchParams` `entries()`/`keys()`/`values()` are no longer reported as
    carrying an internal slot.
  - BUG-164: the `Object.prototype` legacy accessor allowlist and the descriptor table are
    now the same source of truth.
  - BUG-176: `Reflect.construct` on a user class is no longer reported as may-throw.
  - BUG-181: `Reflect.set` with a primitive receiver is a definite `TypeError`, not a false
    red.
  - BUG-182: a host function's constructibility facet is decided by IsConstructor, not by
    the presence of a `prototype` property.
  - BUG-230 / BUG-260: `Set` / `Map` cardinality from an abstract iterable is no longer a
    definite value, and `MapTable` carries insertion order so key iteration matches the
    host and `new Set(xs).size` agrees with `Array.from(new Set(xs)).length`.
  - BUG-276: class-instance enumerable flags are correct, so `getOwnPropertyDescriptor` /
    `Object.keys` agree with the host.
  - BUG-277: a builtin brand's user-defined keys are enumerated (`entries` /
    `getOwnPropertyNames` / `getOwnPropertyDescriptors` / `JSON.stringify`).
  - BUG-278: an `Error` subclass's inherited `name` ordering matches the host.
  - BUG-281: `getOwnPropertyDescriptors` on a brand instance matches `keys`/`values`.
  - BUG-282: a nested same-name `@nudo:case` scope resolves to the nearest binding, and
    shape contracts fall back to a prototype-chain `HasProperty` check.
  
  Regression tests: `core-bug-{007,008,009,132,157,164,176,181,182,230,260,276,277,278,281,
  282}-*` (16 files / 106 tests).
  
  Known follow-ups NOT covered here (root cause outside this category's file set):
  BUG-058, BUG-130, BUG-131, BUG-160, BUG-165, BUG-167, BUG-174, BUG-258, BUG-275; and
  BUG-163's `toJSON` half (needs `exec/runtime/members.ts` `BUILTIN_BRAND_METHODS.URL` —
  its `host` half is fixed and tested).
  
  ### 追加：本轮内建面修复
  
  已修复（带新回归测试）：
  
  - **BUG-163（`toJSON` 半边，至此完整）**：`BUILTIN_BRAND_METHODS.URL` 增加
    `toString` / `toJSON`，`BUILTIN_BRAND_ACCESSORS.URL` 补组件访问器 ⇒
    `urlToJsonIsUndef() => false`、`urlToJsonIn() => true`（修复前 `true` / `false`）。
    测试：`core-bug-163-url-tojson-brand-face.test.ts`。
  - **BUG-174**：`TextDecoder` 构造参数按宿主顺序校验（label 的 ToString → options 字典
    → label 查找），抽象 prim / 全 prim 联合的 options 确定抛 `TypeError`，`any` 只记
    may-throw。测试：`core-bug-174-textdecoder-options.test.ts`。
  - **BUG-183**：`btoa` / `atob` 缺参确定抛 `TypeError`（其余 6 个全局函数保持把缺参当
    `undefined`）。测试：`core-bug-183-btoa-atob-missing-arg.test.ts`；
    `tmp/verify-bug.sh BUG-183` → exit 1。
  - **BUG-275**：`Object.create(proto)` 的基对象镜像 proto 自有槽为 `Slot.inherited`
    （只表示存在性，值为 `unknown`），自有键视图（`Object.keys/values/entries`、for-in、
    spread、JSON）排除 `inherited` ⇒ 与原生一致。测试：
    `core-bug-275-object-create-inherited-slot.test.ts`；`verify-bug.sh BUG-275` → exit 1。
  
  ### 追加：BUG-167 已修（构造点对齐 facet + 投影面读域判定）
  
  - **BUG-167**：两个 `$fnVal` 构造点（`ObjectMethod` 简写与方法型 `FunctionExpression`）改为发
    `effectFree` / `closed` facet（`getFnFacets` 静态保守判定，与 `expr/function.ts:366-373` 同口径）
    ⇒ 同一函数体写成方法 vs 写成函数字面量，在 sort 比较器闸门、promise 回调、访问器纯度判定上
    不再得出相反结论。叠加的第二处根因：`Object.defineProperty(o,k,{get})` 装的访问器占位槽是
    `unknown`，而三个投影面（`format.ts`、`denote.ts`、`service/emit/dts-generator.ts#slotAbsOf`）
    会**无条件执行用户 getter**，把分析期末次读值冻结进签名与 guard ⇒ 签名自信错值、
    `data.b === <literal>` 恒假。修法：投影面加**读域不可判**判定（占位槽**无 term** ⇒ 不执行
    getter，presence-only）。判据必须用 `term === undefined` 而**不是** `shape.k === "unknown"`
    —— `$lit(void 0)` 的 `shape.k` 也是 `"unknown"`，按 shape 判会把所有访问器判死（首版即此错）。
    回归 `core-bug-167-side-effect-getter-not-frozen.test.ts`（10 例，含 Bug 191 / 152 的负控制）；
    验收组 11 文件 / 148 例全绿（含 `eval-call-position`、`eval-match-json-view`、
    `exec-join-accessors`、`exec-define-property-accessor`）。
    残留（如实记录）：**对象字面量** `get` 访问器的占位槽必须是 `$lit(void 0)`（Bug 191 的读域投影
    与 Bug 152 的调用点求值序钉住它，换 `$unknown()` 会同时打红两处），彻底修法需在 slot 上引入
    显式「读域不可判」标记（`abs.ts` slot 类型 + `exec/runtime/state.ts` 的 `$set` 选项 +
    `descriptor.ts` 写入）；`projection.ts`（zod / standard-schema 经 `absToConstraint` 取读域）
    同样仍是执行 getter 的老路。BUG-167 section 的验收 repro 是 `Object.defineProperty` 形态，
    本修复已覆盖。
  - **BUG-258（facet 已落地，投影面见 cat-05）**：数组视图信息原先由 `builtins/regexp.ts` 的
    `WeakSet` 侧表（按 Abs 身份）承载，只有 `Array.isArray` / JSON 序列化 / 数组方法派发消费，类型面
    看不见。修：`abs.ts` 的 `{k:"obj"}` 形状增加 `view?: "array"` facet +
    `markArrayView` / `isArrayView`（不导出到公开面 ⇒ 快照零变化；`markArrayView` 是**替换** shape 而
    非就地改共享 shape），`regexp.ts` 删除侧表、`markMatchArrayView` / `isMatchArrayView` 降为薄包装，
    消费面（`array.ts` / `json.ts` / `member.ts` 派发）只读 facet；运行形状仍是 `k:"obj"`（未改 tuple）
    ⇒ `eval-call-position.test.ts:344-350` 的渲染钉不变。回归
    `core-bug-258-array-view-facet.test.ts`。未完成：dts / zod / standard / guard 四个**产物面**尚未按
    `shape.view === "array"` 分支；多 case join 时 `joinObjects` 重建 shape 不带 `view`（需一侧传递）。
- 6daa52e: Fix bug-report category 05 (rendering / projection / emit generators) — 11 of 17 defects.
  
  - BUG-025: the standard-schema `promise` node tests `instanceof Promise` in both the
    library and the inlined copy, so a non-promise value is rejected instead of accepted.
  - BUG-031: `litPredValue` became `litPredValues` and recognises
    `or(eq(...arm), ...)`, so a literal-union contract renders as `1 | 2 | 3` in the
    signature face, matching the dts face byte for byte.
  - BUG-087: `showLits` renders the **type** (`3`, `"a"`) instead of leaking the contract
    DSL spelling (`lit(3)`) into signatures and slot displays.
  - BUG-092: `predAsJs` / `termIsValue` emit `Number.isInteger(v)` for a `%1 === 0`
    predicate and compare field items by value, so nested numeric bounds agree across all
    four faces.
  - BUG-095: the `arr` branch uses `Array.from(v).every(...)` (holes filled with
    `undefined`), matching the standard face — `[1, , 3]` is no longer accepted by the
    guard.
  - BUG-097: a slot named like an `Object.prototype` own member is read with bracket
    access, so the guard compiles under `tsc --strict` (TS2367 gone).
  - BUG-098: the `brand` branch drops observed literals deeply, so a brand built from an
    observed `/abc/i` or `new TypeError("boom")` accepts the real value.
  - BUG-145: a same-name slot produces no inlay hint (it previously rendered another
    binding's derivation).
  - BUG-147: inlay hints cover anonymous default exports (arrow, function expression, and
    a `FunctionDeclaration` without an id).
  - BUG-158: an `Arguments` brand no longer emits an `Array.isArray` premise while keeping
    its length/index semantics, so the guard accepts `arguments` at runtime.
  - BUG-250: the guard declares `const data: any` when the contract carries an identity
    clause, so `instanceof` narrowing no longer blocks index reads
    (`tsc --strict` TS7053 gone).
  
  Also updates `core-bug-348-lit-literal-signature.test.ts`, which pinned the
  `f(x: lit(1))` spelling that BUG-087 declares wrong, to the corrected `f(x: 1)`.
  
  Regression tests: `core-bug-{031,087,092,095,097,098,145,147,158}-*`,
  `service-bug-{025,250}-*`.
  
  Known follow-ups NOT covered here (root cause outside this category's file set):
  BUG-091 (needs `lsp/src/lsp-surface/completions.ts`), BUG-096 (needs
  `schema-generator.ts`), BUG-108 / BUG-169 (need `dts-generator.ts` + `schema-generator.ts`),
  BUG-156 (needs `schema-generator.ts`), BUG-191 (needs `dts-generator.ts:1986-1995`).
  
  ### 追加：BUG-096 / BUG-169 / BUG-191 已修 + BUG-258 的 facet 与投影面
  
  - **BUG-096（键存在性三面不一致）**：zod 面原生用 `key in data`（含 `Object.prototype` 成员），
    guard / standard 面减污染键 ⇒ `Object.create({toString:"s"})` 在 zod 面被放行。反向改
    guard/standard 会改 `hasPropertyClause` 的子句文本，而该文本被 `eval-bug-191-accessor-projection`
    与 `eval-bug-240-guard-internal-slots` **逐字钉住** ⇒ 只能把 zod 面补齐：`schema-generator.ts`
    对「**必填**且键名是 `Object.prototype` 自有成员」的槽追加 `.superRefine`（沿用同文件 `__proto__`
    槽的既有模式），子句与 guard **逐字同口径**；非污染键不加码（`z.object` 原生判据已与另两面等价）。
    同时修正三处自述注释（`denote.ts` / `standard-schema.ts` / 产物 `__nudoHasProperty`）为「三面唯一
    规则」。guard / standard 的**代码未变**。回归 `service-bug-096-key-presence-parity.test.ts`。
  - **BUG-169（TS 可选形参 `b?: T` 丢失）**：`?` 在 strip-types 阶段被删（param 节点 `optional`
    为 `undefined`），`formalParamsFromNodes` 的 `kind:"id"` 硬写 `optional:false`；dts 的
    `declaredParams` case `"id"` 硬写 `hasDefault:false`；standard 只认 `kind==="default"`。
    修：`param-surface.ts` 的 `formalParamsFromNodes(params, source?)` 末尾接
    `withOptionalParams(out, tsOptionalParams(params, source))`（**无 source 时集合为空 ⇒ 零行为变化**，
    `generalize.ts` / `exec/transpile` 等未传 source 的调用点不受影响）；`dts-generator.ts` 的
    `case "id"` 改 `hasDefault: f.optional === true`；`standard-schema.ts` 的 `declarationOptional`
    认 `kind === "default"` ∪ (`kind === "id"` && `optional`)。服务面 `extractFormals(node, source?)`
    与 3 处调用点只做 **source 透传**（无语义改动）。回归 `emit-bug-169-ts-optional-params.test.ts`
    （差分口径：三面可省性 ≡ 源码 JS 默认值 ∪ TS `?`）。
  - **BUG-191（`export namespace` 缺失）**：`scan-named-exports.ts` 的 `ExportNamedDeclaration`
    声明分支只认 Function/Class/Variable ⇒ `TSModuleDeclaration` 落 `continue` 被静默丢弃；
    `dts-generator.ts` 同款缺口且从不发射 ⇒ 消费端 TS2305，而求值器确实物化了 `NS`。修：
    `scan-named-exports.ts` 新增 `TSModuleDeclaration` 分支（登记 `NS` + 运行时成员键
    `NS.x` / `NS.f` / 嵌套 `NS.Inner.y`；interface / type 是纯类型**不**登记，`addNamespaceMemberKeys`
    只认 `export` 过的成员）；`dts-generator.ts` 增加 `namespaces` 面并发射
    `export declare namespace NS { … }` + 别名导出（class 发空体；enum/interface/type 镜像原文；
    嵌套递归；`namespace A.B` 认尾段）。回归 `emit-bug-191-export-namespace.test.ts`。
  - **BUG-258（数组视图 facet）**：数组视图信息原由 `builtins/regexp.ts` 的 `WeakSet` 侧表（按 Abs
    身份）承载，只有 `Array.isArray` / JSON 序列化 / 数组方法派发消费，类型面完全看不见 ⇒ 同一个值在
    引擎内两个结论。修：`abs.ts` 的 `{k:"obj"}` 形状增加 `view?: "array"` facet +
    `markArrayView` / `isArrayView`（**不**导出到公开面 ⇒ 快照零变化；`markArrayView` 是**替换** shape，
    不是就地改共享 shape）；`regexp.ts` 删除 WeakSet 侧表，`markMatchArrayView` / `isMatchArrayView`
    保留同名同签名降为 facet 薄包装；消费面（`array.ts` / `json.ts` / `member.ts` 派发）只读 facet。
    运行形状仍是 `k:"obj"`（**未**改 tuple）⇒ `eval-call-position.test.ts:344-350` 的
    `"0":"b"` / `index:1` / `input:"abc"` 仍成立。回归 `core-bug-258-array-view-facet.test.ts`。
    未完成（已定位）：四个产物面（dts / zod / standard / guard 的 obj 分支）尚未按
    `shape.view === "array"` 分支；多 case join 时 `joinObjects` 重建 shape 不带 `view`，需一侧传递。
  
  ### 追加：BUG-258 四产物面 + BUG-169 zod 面
  
  - **BUG-258 产物面**（facet 本体见 cat-04）：**guard 面**（`denote.ts`）obj 分支改判
    `shape.view === "array"` ⇒ `Array.isArray(v)`（取代 `typeof/object` + `!Array.isArray`；槽判据一字
    未动 —— exec 结果的 `0/1/length/index/input/groups` 全是自有属性）；**dts 面**
    （`dts-generator.ts`）数组视图投影成**元组** + 其余自有槽的交集（`length` 由元组隐含），
    `widenParamAbs` 透传 `view` facet（否则形参位会退回对象字面量）；**zod 面**
    （`schema-generator.ts`）`SchemaNode.obj` 增 `arrayView?: boolean`，渲染 `z.tuple(...)`
    （`z.object` 会拒真实数组），非下标槽记台账 `non-index slots not validated by z.tuple`；
    **standard 面**（`standard-schema.ts`）库函数版与产物版都要求 `Array.isArray(value)`，
    `arrayView` 随节点序列化，产物类型别名 `NudoSchemaNode` 补 `arrayView?: boolean`
    —— 这是**修产物类型**，不是放宽 `emit-bug-519-989` 的 strict 编译门禁。
  - **BUG-169 zod 面**：`nudojs/src/commands/export/contract-face.ts` 的 `unifiedParamFace` 常规形参
    分支改为 `formal.optional === true || formal.kind === "default" || formal.index >= minArity`
    —— `FormalParam.optional`（已接通 TS `?`）成为唯一事实源；无 `?` 的声明仍按观测最少实参元数放宽。
    回归用「一键实参」观测把 `minArity` 钉在 1，使下标 1 的可省性只可能来自 TS `?`。
  
  回归：`core-bug-258-array-view-facet.test.ts`（6 例）、
  `service-bug-258-array-view-products.test.ts`（5 例）、`emit-bug-169-ts-optional-params.test.ts`
  （5 例）；`service/src/emit/__tests__` 114 文件 / 798 例、core algebra 973 文件 / 10 431 例、
  service 242 文件 / 1 318 例全绿。残留：多 case join 的 `joinObjects` facet 传递（`objects.ts`）。
- 0650ef0: fix(service): 分析器 / 模块图 / 缓存面（BUG-011/012/070/089/101/127/129/139/152/170/171/205/206/207/238/239/240/241/267/268/269/270/273）
  
  模块解析与缓存：
  
  - BUG-238/240 — 裸包 `import` 的 spec 现在携带 `mode` 并解析到真实文件（而非包名占位），模块图边与调用点记录据此建立。
  - BUG-239 — `exports` 条件键按 package.json **声明顺序**求值；`browser` 仅作兜底，不再无条件优先。
  - BUG-267 — pattern 键按 Node `PATTERN_KEY_COMPARE` 取最具体匹配（`./x/*` vs `./x/*.js`）。
  - BUG-268 — 裸包解析在**最近的已存在** `node_modules` 停止；未命中的 `exports` 不再被上层包无声清空为 `exportsUnresolved=false`。
  - BUG-269 — 歧义 `export *` 名称不再导出；导入方得到 `nudo:missing-export`，与 Node 的「模糊即不存在」一致。
  - BUG-270 — `exports` 数组回退只发生在 target **非法**时；合法但文件缺失是终止态（`ERR_MODULE_NOT_FOUND`）。
  - BUG-273 — `esm` 目录导入不再猜测 `index.*`；`legacy main` 保留该行为。
  - BUG-241 — 磁盘缓存键的入口维度带项目根指纹，依赖维度仍可移植（跨项目不再互相污染）。
  - BUG-012 — 函数缓存 `envKeyFn` 补上 `@nudo:env` 内容指纹，与另外两层缓存口径一致。
  
  调用点与报告：
  
  - BUG-070/170/171 — 同名调用点仅在冲突时加列号（`call@L6C9`）；`--from` 目录与重复调用点在合成前去重（先解析再按站点点位去重）。
  - BUG-089 — 仅当本文件在该行列确实存在调用表达式时才附加 `callSiteFile`。
  - BUG-127 — `dedupeCallRecords` 的键纳入调用点身份，不同站点的同名调用不再互相吞并。
  - BUG-205 — 期望值判定统一走共享 `inferenceFailed`，并检查 `term`：`lit(null)` / `lit(undefined)` 是 exact，不是第三种「推断失败」态。
  - BUG-206 — `never` 期望不再走「满足」短路。
  - BUG-207 — 嵌套槽位谓词（`shape({ n: number().gt(0) })`）参与判定并按递归 `formatExpected` 渲染；CLI 报告面改用 service 的 `formatExpected`。
  - BUG-011 — 空调用记录不再解引用 `deduped[0]`。
  - BUG-101 — `isNudoTargetPath` 接受 `.cjs/.mts/.cts`（排除 `.d.mts/.d.cts`），`migrate retire` 的 `nudo check .` 与 `VERIFY_TARGET_EXTS` 对齐。
  - BUG-129 — 空 `--from` 目录报 `nudo:path-empty-dir`。
  - BUG-139 — 静态成员扫描白名单化节点类型，`ClassProperty` 不再被当作方法。
  - BUG-152 — 匿名 `export default class` 注册到 `default` 槽位。
  
  已更新的既有测试（原断言钉住声明的错误行为）：
  
  - `service/src/__tests__/resolve-npm-exports.test.ts` — 数组回退改为「首个合法 target 即终止（即使文件缺失）」。
  - `service/src/__tests__/disk-cache.test.ts` — 入口缓存键带项目身份，依赖键保持可移植。
  - `service/src/__tests__/target-path.test.ts` — `.cjs` 由拒绝改为接受，新增 `.mts/.cts`。
  
  已知未修（根因在本类文件之外，另行跟踪）：BUG-019（行号重映射在 `emit/case-emitter.ts`）、BUG-022（entry 结算重入语义未定）、BUG-045（CJS `module.exports` 成员导出面）、BUG-069（生成比较在 `emit/case-emitter.ts`）、BUG-085（`withAssumePremises` 未从 core 导出）。
  
  ### 追加：本轮分析器面修复
  
  - **BUG-022**：`settleEntryOnlyCandidates` 不再删除注册表条目；记录增长时先摘掉上次合成的 case
    再按**全量**记录重合成 ⇒ 调用点先出现 `f(3)` 与后出现 `f(3)` 得到同一组见证
    （`3 witnesses，call@L5/8/11`）与**逐字节相同**的 `--emit --dry-run` 契约。
    测试：`service-bug-022-callsite-domain-order.test.ts`。
  - **BUG-045**：`tryEvalCallFull` 走 core 的 cjs-member 语义（对 `exports["default"]` 做
    `$invoke`），并在合成调用记录里过滤无位置记录 ⇒ `obj.js`（`module.exports = {…}`）与
    `dot.js`（逐成员导出）在 dts/schema/guard 三面**逐字节一致**（dts 由 `unknown` →
    `number | string`）。测试：`service-bug-045-cjs-object-export-member`、
    `cli-bug-045-cjs-object-export-face`。
  - **BUG-099（递归 / fork 两臂）**：分析器为**整轮**装截断收集器（串到 `eval-run` 的嵌套
    collector，否则单槽会被静默覆盖），标签映射到 `nudo:recursion-truncated` /
    `nudo:fork-truncated`，文案与 `check` 同口径 ⇒ `nudo test` 与 `--json`
    （`summary.diagnostics`）都可见。测试：`service-bug-099-*`、`cli-bug-099-*`。
    循环臂（`nudo:loop-truncated`）此前缺 core 导出，现已补
    `LOOP_TRUNCATION_LABEL`（`@nudojs/core/internal`），接线待做。
  - **BUG-069** 的发射侧（见证等价按「文件 + 实参载荷」）已由 emit 类修复并回归；
    本条**未修的是 CLI `--freeze` 新增模式的坐标**（见 BUG-019）。
  - **BUG-085** 已修：`runAbsView` 现把 `extractAssumeSegs` 的 `ok` 段折进**前提槽**
    （`withAssumePremises`，不是 `phi`），详见 cat-09 changeset。
  - **BUG-099 循环臂已修**：`truncationDiagnostics` 增加 `label === LOOP_TRUNCATION_LABEL`
    分支，且必须排在 `label.startsWith("#")` 兜底**之前**（兜底会把 `#loop-iterations`
    静默吞掉）。`nudo test` / `--json` 现报 `nudo:loop-truncated`，文案与 `check` 面逐字一致
    （「A loop did not terminate within its iteration budget …」），anchor 为文件起点 1:0
    （事件不带函数归属，check 面同样无位置）。回归：
    `service/src/__tests__/service-bug-099-loop-truncated.test.ts`。
    注：loop 迭代预算不在 `@nudo:budget` 覆盖范围内，故建议文案不提该指令。
  
  ### 追加：可见性判据（`gateFatal`）与 `./internal` 快照
  
  - `analyzer-orchestrate.ts` 的 per-file 失败信号判据改为
    `f.reason === "internal" || f.gateFatal === true`（**标签 ≠ 可见性**）：BUG-073 把装载期
    逃逸改标 `module-throw` 后，原判据（只收 `internal`）会让 `evalFailures` 变空 ⇒ 闸门丢掉
    「模块装载失败 ⇒ 不得判绿」（BUG-072）。三条假红防线（`unsupported:*` / 建模内
    `NudoThrow` / 干净文件）不变。
  - `service/eval-run.ts` 的「引擎产出非 Abs 值」回落改传 `origin: "engine"`（引擎自身违约
    ⇒ `internal`，与该 guard 的既有语义一致）。
  - `packages/core/public-api.snapshot.json` 追加 4 个 `./internal` 导出（引擎机件面，语义上
    允许 minor 变动）：`LOOP_TRUNCATION_LABEL`、`extractAssumeSegs`、`isPointConstraint`、
    `widenObservationAbs`，以及类型 `AssumeSeg`；`public-api-freeze` 测试随之复绿。
- 250f0ba: Fix bug-report category 09 (`nudo check` gate) — 10 of 15 defects.
  
  - BUG-046: a variadic flag no longer silently consumes the following path; a value the
    flag cannot accept that exists on disk is reported as a usage error, so `check
    clean.js --only <code> broken.js` no longer exits 0 with `broken.js` unchecked.
  - BUG-047: `check --fix` advances its plan text outside the `--write` branch, so a second
    hunk is `@@ -1,2 +1,3 @@` instead of a conflicting `@@ -0,0 +1,2 @@`, and dry-run output
    matches `--write`.
  - BUG-048: `--only` values are validated against the diagnostic registry (unknown codes
    are a usage error; valid-but-unmatched codes are reported) instead of silently
    producing `0 edits`.
  - BUG-049: a sidecar write failure is reported (`check --fix cannot write <path>`) instead
    of aborting the whole run with a bare `EACCES`.
  - BUG-066: `--quiet` is evaluated before `--abs`, so `--abs --quiet` prints one line
    instead of the full signature block.
  - BUG-067: `--fix` refuses to write a sidecar that would conflict with a sibling file
    (`.js` / `.mjs`, `.ts` / `.mts`) and names the sibling.
  - BUG-115: the `--json` envelope gains an unambiguous `summary.pathErrors`, so path
    failures are readable from the summary (the green shape is unchanged).
  - BUG-264: `sidecarPathOf` strips `.d` **after** `.nudo`, so a `.d.ts` source yields
    `api.nudo.ts` (and a `.nudo.draft.ts`-style draft) instead of a `.d.` name that
    TypeScript treats as a declaration file.
  - BUG-284: hard errors (input read failures / syntax errors) feed both CI channels, so
    `--gitlab` always emits exactly one parseable array and `--gha` emits `::error`.
  - BUG-285: GHA annotations move to stderr when GitLab owns stdout, so `--gha --gitlab`
    emits its `::error` lines instead of dropping them.
  
  Regression tests: `cli-bug-046-*`, `cli-bug-047-*`, `cli-bug-048-*`, `cli-bug-049-*`,
  `cli-bug-066-*`, `cli-bug-067-*`, `cli-bug-115-*`, `cli-bug-284-*`, `cli-bug-285-*`,
  `core-bug-264-sidecar-dts-name`.
  
  Known follow-ups NOT covered here: BUG-014 (needs `commands/test.ts`), BUG-015 / BUG-114
  (need `migrate.ts`, handed to the migrate category), BUG-262 (needs
  `packages/lsp/src/validation.ts`), BUG-056 (needs per-round module isolation; `check`
  still prints `bump() => 2`).
  
  ### BUG-056 诊断追加（未修复，定位已收窄）
  
  同文件在同一进程被求值两轮时，闸门读到被上一轮写脏的结果（`bump() => 2`，原生 `1`；
  连带 `main() => 11`、`once() => 1`、`nudo:interface-drift` 把干净侧车判成陈旧）。
  
  已排除（逐一实测，均无效）：
  
  - service `evictAbsModuleCacheFiles` / `evictEvalCacheForFiles`：驱逐前后
    `getAbsModuleCacheSize()` 都是 `0`、`getEvalCacheSize()` 由 `1` 归 `0`，闸门仍是 `2`；
  - core `evictGeneralizeMemoForPaths`：仍是 `2`；
  - core `resetNudoModuleExecCache`（侧车模块执行表）：仍是 `2`。
  
  已定位的方向：**`checkSource` 的整文件 memo**（`packages/core/src/algebra/check-memo.ts`）。
  探针（同一进程内先跑分析器再跑闸门）在每次 `checkSource` 前 `resetCheckSourceMemo()`
  后结果稳定为 `1`（不重置则 `2`，且第二次调用仍 `2`）⇒ 陈旧 `CheckReport` 被跨轮复用，
  不是模块实例泄漏。收口方向 = 在 CLI 轮边界按路径驱逐
  `evictCheckSourceMemoForPaths([filePath])`（该 API 已从 `@nudojs/core` 导出，无需动
  public-api 快照）；未落地的原因是上述探针全部跑在**修复前的 `dist/`** 上（`@nudojs/*`
  经 package `exports` 解析到 `dist`），需要在源码构建上复核后再改 —— 否则无法区分
  「memo 陈旧」与「模块实例脏」两种成因。
  
  ### 追加：BUG-056 已修（根因与落法）
  
  根因（实测确认，不是推测）：`packages/core/src/algebra/generalize.ts` 与
  `check-may-throw.ts` 各有一张 `evalRunMemo`，缓存的是**活的 run 表**——模块级 `let` 状态
  **和对象身份**都住在里面；键**只有 source（+ mock scope + inject 指纹）**，没有路径、
  没有轮次。后果：
  
  - 分析器一轮 generalize 与闸门一轮共用同一实例 ⇒ `bump() => 2` / `main() => 11` /
    `once() => 1`（同一文件在同一进程里被读作 1 / 2 / 3，字节相同的两个不同文件也共用）；
  - `contract --emit` 写分析器的干净值、`check` 打印被污染的值 ⇒ `nudo:interface-drift`
    永不收敛（health 永久假红，重跑 `--emit` 无法自愈）。
  
  落法：引入单调**求值轮次**（`collector-scope.ts`），最外层 `runWithCollectorScope` 创建
  作用域时涨轮；两张 run 表的键都带轮次前缀 ⇒ 跨轮不复用活状态；**不做整表作废**（整表
  作废会让轮内的对象身份变化，递归泛化的 term 指纹随之坍缩成 `unknown`）；`resetGeneralizeMemo`
  同时清 run 表。已排除的无效方案（逐条实测）：service `evictAbsModuleCacheFiles` /
  `evictEvalCacheForFiles`、core `evictGeneralizeMemoForPaths`、`resetNudoModuleExecCache`、
  按路径驱逐 `checkSource` 报告 memo —— 全部无法触及这两张表。
  
  回归：`core-bug-056-eval-round-identity.test.ts`（3 例：分析器轮之后闸门仍读 1、字节相同的
  第二个文件各自读 1、同一文件重复分析每次读 1）；CLI 侧 `cli-bug-056-check-single-eval.test.ts`
  钉住 `bump() => 1`、`once() => never throws Error`、无 `nudo:interface-drift`。
  
  ### 追加：BUG-085 已修（`--abs` 观测面吃 `@nudo:assume` 前提）
  
  根因不在 core 的假定折叠，而在 **CLI 观测面没喂前提**：`nudojs/src/commands/shared.ts::
  runAbsView` 直接 `tryEvalCall(...)`，`@nudo:assume d <= max` 从未进入求值。
  
  落法（关键点：喂**前提槽**，不是 `phi`）：每个待观测函数先从
  `extractAssumeSegs(source, fnName)` 取 `ok` 段，折成 `ale(v(lhs), v(rhs))` 后
  `withAssumePremises(phi, () => tryEvalCall(...))`。`div` 的关系折叠只读
  `assumePremiseList(assume)`（`core/algebra/arithmetic/muldiv.ts:141`），而前提槽在调用边界
  会被清空；折进 `phi` 会既拿不到谓词、又把前提泄漏给被调方（不健全）。
  
  回归：`nudojs/src/__tests__/cli-bug-085-abs-assume-premises.test.ts`（3 例）——
  `check --abs` 打印 `pred: /(d, max) ≤ 1`（此前缺失而 `--json` 已给出 `where`，两面不一致）、
  无 assume 行的对照两面都无谓词、`nudo test --abs` 同源同结论。
  
  ### 追加：CLI fail-closed 判据改为「可见性」，诊断按标签分两条通道
  
  `packages/nudojs/src/commands/check.ts`：per-file collector 由「只收 `internal`」改为
  「`internal` **或** `gateFatal === true`」（plain check 与 `--fix` 两处采集点同口径），
  并把诊断拆成两条：
  
  - `internal`（引擎 / 宿主边界违约）⇒ `nudo:internal` + 「报引擎 bug」文案（既有）；
  - 装载期逃逸的**用户代码**异常（标签 `module-throw` 且 `gateFatal === true`）⇒
    `nudo:module-throw` + 指向**用户代码**的文案（BUG-073：不得让用户去报引擎 bug）。
  
  这补上 BUG-072 在 CLI 侧的最后一个缺口：**无句法证据**的装载失败（模块顶层
  `JSON.parse(userInput)`、顶层调用会抛的导入函数）此前零诊断 + exit 0（**假绿**），现在按
  `gateFatal` 判红。`unsupported:*`（能力边界）与建模内 `NudoThrow` 的
  `gateFatal === false` ⇒ 仍不入闸门（假红防线不变，1145 的 unsupported 用例守反向）。
  
  ### 重钉：BUG-264 带来的落点改名（`.d.ts` 源的草稿名不再含 `.d.`）
  
  BUG-264 修了「`.d.ts` 源的侧车 / 草稿名含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ TS1254」，
  把落点从 `api.d.nugo.draft.ts` / `api.d.nugo.ts` 改成 `api.nugo.draft.ts` / `api.nugo.ts`。
  该修复落地时**只更新了 core 侧自己的钉**，漏了 3 个 nudojs 侧的旧断言 ⇒ 它们的期望仍写着旧拼写。
  
  按 BUG-264 的权威规格重钉（**保留旧拼写等于把 BUG-264 重新引回来**）：
  - `cli-bug-659-from-dts-usage-order.test.ts`：`types.d.nudo.draft.ts` → `types.nugo.draft.ts`
    （「CWD 里的同名草稿不存在」那条断言未动）。
  - `cli-bug-944-from-dts-write-path.test.ts`（3 处）：落点、`next` 提示里的侧车名、拒绝覆盖提示里的路径
    全部改成 `types/index.nugo.draft.ts` / `types/index.nugo.ts`（CWD 无同名草稿、既有草稿逐字不变
    等行为断言未动）。
  - `nudojs-bug-1147-contract-cli-text.test.ts`（3 处）：共享的 `draftPathOf` 辅助函数改成新落点
    （拒绝提示双口子 / 人工改过永不被覆盖 / `--force` 覆盖成功三条的语义断言未动）。
  
  新增 `cli-bug-944-from-dts-draft-invariants.test.ts`（7 例）：钉**规则**而不是拼写 —— 落点贴着源
  `.d.ts` 且 basename 不含 `.d.`、「next」侧车名不含 `.d.`（旧名不得出现）、目标已存在 ⇒ 拒绝覆盖
  （exit 1 + `--force` 与 `NUDO_DRAFT_FORCE` 双口子 + 提示含 `hand-edited` + 既有草稿逐字不变 +
  不谎报 `wrote `）、内容未变 ⇒ 不拒绝、`--force` 与 `NUDO_DRAFT_FORCE` 各自可覆盖机器原稿、
  人工改过的草稿 `--force` 也不放行。
  
  **零源码改动**：实现的落点、拒绝、双口子与「人工改过不覆盖」规则本就符合 944/1147 的规格
  （逐条手测复核过），只有断言的**拼写**过时。
  
  **残留**：① `--from-dts --write` 在没有 `package.json` 祖先目录时**无项目根守卫**，
  而 `--draft --write` 在同场景要求 `NUDO_DRAFT_FORCE=1` —— 944/1147 夹具（无 `package.json`）钉住
  前者成功 ⇒ 对齐会与被钉住的行为冲突，故未动；
  ② `--from-dts --write --dry-run` 在既有草稿不同时**拒绝**（exit 1）而非给 diff 预览，
  与 `--draft --write --dry-run` 不一致（未动）。
- d4ab7fb: Fix bug-report category 13 (`nudo migrate` status / strip / verify / retire) — 20 of 21
  bugs, plus two defects that were filed under other categories but live in `migrate.ts`.
  
  - BUG-234: `migrate strip` rewrites an enum's **computed member** references to
    `E["KEY"]` (reference-position aware) instead of leaving the initializer verbatim, so
    the stripped product no longer throws ReferenceError; string-valued computed members
    skip the reverse mapping like tsc. A `enumComputedMemberRewritten` report flag records
    the rewrite.
  - BUG-050: `strip` refuses to write when a TS-only construct survives the stripper
    (`namespace`, `import x = require(...)`) instead of writing a `.js` that fails
    `node --check`/`nudo check` with exit 0.
  - BUG-226: `migrate verify`'s env merge uses `mergeHarvestUnderEnv` (the `check` path), so
    harvest-only exports are no longer dropped ⇒ `verify` no longer reports `unknown` where
    `check` reports a precise type.
  - BUG-064: `migrate verify` resolves project-level env against the project root and
    file-level env against the file's directory, and surfaces env load errors as
    `nudo:env-unresolved`.
  - BUG-061: `migrate verify` installs the eval-fallback collector, so an internal analysis
    failure is an error-level `nudo:internal` (same code/severity as `check`).
  - BUG-114: `migrate verify` runs the strict, extension-aware parse first, so TS-only
    syntax inside a `.js` file is a per-file `syntax-error` instead of `verify` saying
    `nudoOk: true`.
  - BUG-015: `migrate`'s `ignoreThrows` uses the same lenient parser as `check`.
  - BUG-051 / BUG-052 / BUG-103 / BUG-117 / BUG-118: retire batch semantics — a mixed batch
    retries the work-bearing targets and reports the skipped ones; `retire --all` shares
    `retireScope` with the single-target path; a leftover `migrate-retiring.json` is
    recovered; a repeat run reports `already retired` with a zero delta (the ledger no
    longer leaks into this run's result); a multi-root failure reports every bad root.
  - BUG-053 / BUG-112 / BUG-179: JSON/human faces — dry-run results carry `dryRun`; an
    unknown action emits a JSON error envelope instead of empty stdout; the human face
    prints only this run's deltas.
  - BUG-062 / BUG-063 / BUG-065 / BUG-102 / BUG-116: retire/status plumbing — the gate
    script test is command-text based and reports the real `from`; the workflow dedup key
    includes the line so the rewrite count is exact; a corrupt marker fails closed and is
    left byte-identical; `status` and `retire` share the same workflow scope; the product
    specifier is tried verbatim before candidate rewriting.
  - BUG-178: `migrate status` uses retire's gate/compiler split for blockers and reports a
    `preserved` field; `next:` branches on state instead of being unconditional.
  
  Regression tests: `migrate-bug-{015,050,051,052,053,061,062,063,064,065,102,103,112,114,
  116,117,118,178,179,226,234}-*` and `core-bug-234-*`.
  
  Known follow-up NOT covered here: BUG-017 (`--json` top-level shape) is blocked because
  existing tests pin **both** an object envelope for failures and an array for success; a
  single shape breaks at least two of `cli-bug-696-migrate-strip-json-envelope`,
  `migrate-bug-cli-wiring`, `cli-bug-56-cli-face`, `cli-bug-675-migrate-retire-json-shape`,
  `migrate-bug-1028-marker-json-same-shape`. Every failure path now uses the same object
  envelope (including the previously empty-stdout unknown-action path).
  
  ## 追加：BUG-017 `migrate --json` 顶层形状恒为数组
  
  成功路径早已是数组，动作级失败路径却输出对象信封（`{ ok:false, action, targets,
  error }`）⇒ 消费方 `JSON.parse(stdout).map(...)` 在失败路径抛异常。现统一为
  **数组**：失败/正常终止信封一律包成单元素数组（`[ { ok:false, … } ]`），
  `status` / `verify` / `strip` / `retire` 四个 action 与未知 action 分支同口径。
  
  已有测试更新（原先钉住对象信封）：
  
  - `cli-bug-696-migrate-strip-json-envelope.test.ts`（失败面读 `[0]`，并断言
    `Array.isArray`）
  - `migrate-bug-cli-wiring.test.ts`（Bug 1006 失败面同上）
  - `cli-bug-56-cli-face.test.ts`（正常终止信封 `failedTargets` 同上）
  
  成功路径的数组形状（`cli-bug-675` / `migrate-bug-1028`）不变。

更早版本（57）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.10.3 {#pkg-service}

## 1.10.3

### Patch Changes

- 51e69f8: Fix bug-report category 01 (predicate algebra / arithmetic / constraint・leq / postcondition).
  
  - BUG-001: a same-prim literal union used as a **return** contract is no longer reported
    violated when the value's predicate already proves membership — the union branch now
    tries the aggregate (arm ⇒ merged-disjunction) implication before falling back to
    per-member checks.
  - BUG-002: `number().int()`'s return obligation is enforced for non-literal returns;
    failure is reported as `nudo:unproven-return` instead of silently staying green.
  - BUG-027: `export --format dts` no longer widens a non-same-prim literal union to its
    base type, so the published `.d.ts` matches the enforced contract.
  - BUG-088: `.optional()`'s omittable / may-be-undefined semantics survive the
    contract ⇒ entry-Abs projection; call-site and return positions agree, and the check
    signature and `.d.ts` now express the same optionality.
  - BUG-208: sidecar `fn()`'s `throws` slot splits separators like `@nudo:throws`, so
    `throws: "TypeError, RangeError"` no longer silently becomes one unknown kind.
  - BUG-209: `pick()` / `omit()` / `partial()` preserve the `optional` flag, so legal
    calls are no longer judged violating and `dts` keeps the `?`.
  
  Regression tests: `core-bug-001-*`, `core-bug-002-*`, `core-bug-088-*`,
  `core-bug-208-*`, `core-bug-209-*`, `service-bug-027-*`.
  
  ### 追加：BUG-077 / 083 / 106 / 200 已修（IEEE 舍入不再是实数环）+ 4 处授权重钉
  
  根因族：线性区间层把 `+ - *` 当**实数环**运算、比较归一精确抵消常量 ⇒ 舍入（吸收 / ties-to-even）
  被抹掉 ⇒ 假证。修法是统一机制，不是逐例特判：
  
  - `pred.ts` 的 `Lin` 新增 `rounds`（舍入运算次数）与 `addConstMag`（参与舍入的加性常量最大量级）；
    `applyCmp` 把界按**舍入前像区间**外扩 `slack = rounds × ½ulp(max(|k|, addConstMag))`，方向保持
    （`gt → lo−`、`lt → hi+`、`eq → 两侧`）；`rounds === 0`（纯 var/lit、2 的幂缩放、`x+x` 精确加倍）
    仍是精确点反解（BUG-077，取 section 方案 B：保真且不丢信息）。
  - `proveInCtx` 在 `linInterval` 后按同一 slack 把端点外移（`nextDown` / `nextUp` 各再退一格），
    strict 语义保留 ⇒ `x>0 ⊬ x+1>1`，而 `x>0 ⊨ x+1>=1`（直接比较路径）与 `x>1 ⊨ x+1>1` 仍可证
    （BUG-083）。
  - `linInterval` 按 atom key **稳定排序**后累加 ⇒ `x+y` 与 `y+x` 同结论（BUG-200 的独立根因，
    `Map` 插入序曾让同一加法换序得出相反结论）；`linFormsEqual` 要求**两形都精确**
    （`rounds === 0`）⇒ `x*6` 与 `x+x+x+x+x+x` 不再判「同值」（BUG-106，此前把 IEEE 加法当结合律 /
    分配律，抛臂被消 ⇒ L2 假绿）。
  - 「有限证据 ⇒ 环语义」闸门：`atomsFinite(ctx, lin)`（所有原子有 `assumeFinite`，或
    `typeof=number ∧ 双侧有限界自动导出`）成立时 slack 归零、`linFormsEqual` 的 `ringOk` 放行 ——
    与 `linOf` 既有的 `ieeeOk` 口径一致（`@nudo:assume-finite` 的环消去 / 分配律契约不变）。
  
  **重钉 4 处（依据 section 声明，不是放宽断言）**：
  
  | 文件 | 原断言 | 新断言 | 依据 |
  |---|---|---|---|
  | `pred-linof-ieee.test.ts` `y>1 ⊢ y+1>2` | `true` | `false` | BUG-200:136 触发形态；`(1+2**-52)+1 === 2`（ties-to-even） |
  | `pred-assume-finite.test.ts` 同款 | `true` | `false` | 同上 |
  | `arithmetic.test.ts` `x>0 ⊢ x+1>1` | `true` | `false` | BUG-200:14-16,27,30；反例 `Number.MIN_VALUE` |
  | `example0.test.ts` `cmp("gt", x+1, 1)` | `{ok:true,value:true}` | `{ok:false}`（另新增 `ge` ⇒ `{ok:true,value:true}`、`lt` ⇒ `{ok:true,value:false}` 对照） | 同上；`{ok:false}` 是**真·不可判定**（Φ 内既有 `x=MIN_VALUE` 的 false 也有 `x=1` 的 true），「确定 false 可判定」的口径由新增 `lt` 断言单独钉住 |
  
  回归：`core-bug-077-rounding-preimage` / `core-bug-083-goal-const-cancel` /
  `core-bug-106-linforms-eq-ieee` / `core-bug-200-strict-endpoint-const-cancel`（45 例）。
  全量 `packages/core/src/algebra/__tests__`：967 文件 / 10 368 测试 / 0 失败。
  
  未改动：`arithmetic/cmp.ts:88` 的造值点本身无错 —— 假事实消除后它自然不再折 `true`。
  遗留提示（docs 面，本轮未改）：`docs/design/cli-semantics.md:347`、`docs/examples/README.md:29`、
  `docs/examples/constraints/README.md:4` 仍把 `x>0 ⇒ x+1>1` 当示例口径。
  
  ### 追加：BUG-005 / 006 / 224 / 225 / 010 已修（返回通道漏评 + 端点见证步进 + 项化简域守卫）
  
  - **BUG-005（`array(...)` 的长度界在返回位不执法 ⇒ 假绿）**：`assertImpliesSingle` 的 `element`
    分支只对账元素域就 `proved()`；`array(...)` / `shape(...)` 无 `prim` ⇒ 约束自身的 `preds`
    （`ge(length(self), n)`）永远走不到 `assertScalar`。修：新增 `assertStructuralPreds` —— 结构对账
    通过后**只**实例化约束自身的 `preds`（摘掉 `fields/element/members/prim/fn`，否则
    `instantiateOnTerm` 的 fields 分支会把 preds 丢掉），把 `length(<返回项>)` 用**已知结构长度**
    （tuple 元素数 / obj 自有非 internal/symbol/inherited 键数）接地后三值判定：真 ⇒ proved、
    假 ⇒ disproved、接地不了 ⇒ unprovable（不再伪装 proved）。
  - **BUG-006（`lit(null)` / `lit(undefined)` 成员的 union 无法证违结构化返回值 ⇒ 只 warning）**：
    `prim` 缺失让值相等义务落到「无证据」兜底，而 union 的「任一成员 unprovable ⇒ 整体 unprovable」
    把已证伪的 `number()` 成员掩盖。修：`isBoundedEvidenceMissing` **只对带界原子**
    （`gt/ge/lt/le`）保留「证据缺失」语义；新增 `valueEqualityDecidable` —— `eq` 义务的字面量域与
    返回项形状域**不相交**（结构形状 vs 任何字面量；prim vs 域外字面量 / nullish）即可判定 ⇒
    不蕴含即 `disproved`。只认 `eq`（`ne` 在域不相交时是**成立**，纳入会造假红）；同域 `eq` 仍是
    unprovable（护栏有测试钉住）。
  - **BUG-224（端点合成丢「最紧可达值」⇒ `(x+x)/2` 假红）**：`Endpoint` 增加 `attain?`，
    `synthEndpoint` 用 `a.attain ?? nextUp(...)`；新增 `attainEndpoint` 只对**可精确反解**的缩放形态
    给可达下界（`t + t` ⇒ `2·nextUp(E/2)`；`t × 2^k` ⇒ `k·nextUp(E/k)`，上侧对偶），在 mul/div
    两端点调用点接入（`addsub.ts` 未改：`x+x` 的 attain 由调用点从分子结构与分子自身 strict 界反解）。
  - **BUG-225（`roundingAbs` 丢 strict 见证步进 ⇒ `Math.ceil` 假红）**：strict 端点做见证步进
    `impl(nextUp(lo))` / `impl(nextDown(hi))`，结果记「可达」（不透传 strict，否则会宣称
    `ceil(x) > 1` 造成新的假红）。
  - **BUG-010（`simplifyTerm` 的 `x - 0 = x` 缺 number 域守卫）**：加与 `surviveMulOne` 同口径的
    守卫 —— 非 number 字面量走 ToNumber（`"abc" → NaN`、`true → 1`、`null → 0`、`"5" → 5`、
    `undefined → NaN`），bigint 混型保留原 app；非字面量项仍走 `x - 0 → x`。
  
  回归：`core-bug-005-*` / `core-bug-006-*` / `core-bug-224-*` / `core-bug-225-*` /
  `core-bug-010-*`（38 例）；gold 面 `check-gold` / `check-recall-gold` / `check-shape-gold` /
  `engine-depth-gold` 全绿（248 通过 + 1 expected fail）。既有测试零改动、零重钉。
  未改：`interface.ts` 的 `formatConstraint` 仍不渲染 array/shape 长度链（违例文案在 postcondition
  侧本地补 `length(return) ≥ n`）。
  
  ### 追加：BUG-245 / BUG-246 已修（union 源不得重跑聚合谓词；可选槽吸收 undefined）
  
  - **BUG-245**：`leqWithPred` 在 `leqShape` 的 sum 源分支**逐成员**跑过
    `leqWithPred(m, tgt, …)`（各自含 `leqPred`）后，又在尾部跑一次**聚合** `leqPred(src = sum, tgt)`；
    而 sum 不带顶层 pred（`makeSum` 与 `constraintToCaseArgAbs` 都不产）⇒ 聚合检查走「源无谓词」
    分支 ⇒ 目标带谓词时即 false ⇒ `union(number().gt(0), number().gt(5)) ⊭ number().gt(0)`
    —— 假红，且两侧渲染成同一文本。修：sum 源且**自身无顶层 pred**
    （`!src.pred || src.pred.op === "true"`）时跳过聚合 `leqPred`。该 pred 守卫是必要的：
    `narrow.ts` 的 `{...a, shape: sum}` 会保留 `a.pred`，真正带顶层 pred 的 sum 仍需聚合检查。
  - **BUG-246（两面根因）**：① `leq.ts` 的 obj 槽分支只对**缺失**槽认 `slot.optional`，
    present-but-`undefined` 直接进 `leqWithPred` ⇒ `undefined ⊭ string`。改为一条**对称**规则：
    目标可选 ⇔ 源侧「缺失**或** undefined」可赋；源槽可选对 required 目标仍失败，纯 `undefined`
    对 required 目标仍失败。② `scan/literal-shapes.ts` 的 `checkShapeAgainstAbs` 才是 `nudo check`
    侧 `nudo:constraint-violated` 的**生产者**（实测：对该夹具 `leqAbs` 调用 **0** 次，而同族的
    BUG-245 夹具 3 次），它同样只对缺失槽认 `field.optional`，随后 prim 门禁报
    `typeof o.a = "string"` —— 与签名面 `a?: string` 自相矛盾。修：同一共享判定。
    共享 helper（`leq.ts` 导出，**不经** `algebra/index.ts` 再导出 ⇒ 无公共 API / 快照变化）：
    `isUndefinedAbs`（本仓 `PrimName` 不含 `undefined`；`undefined` 是
    `shape unknown + term lit(undefined)`）、`mayBeUndefinedAbs`（含 sum 成员递归；`null` 排除，
    对齐 `strictNullChecks`）、`nonUndefinedAbsValues`（剥掉 undefined 臂，`[]` 表示全 undefined）。
    两处都**先剥后执法**，因此 `{a: number | undefined}` 对 optional `string` 仍失败（未放宽）。
  
  回归：`core-bug-245-union-source-leq.test.ts`（7 例）、
  `core-bug-246-optional-slot-undefined.test.ts`（13 例：9 代数 + 4 L1 门禁）；gold 面 331 通过 +
  1 expected fail；`public-api-freeze` 9/9。e2e：optional 夹具 `nudo check` exit 0 且无
  `nudo:constraint-violated`（tsc 亦通过），required 夹具 exit 1 且有该码（tsc TS2322）—— 引擎与 tsc
  结论一致。三面同源：`check-case-scan.ts` 的 `witnessViolations` 字段循环（`@nudo:case` 见证面）
  也改用同一判定；并补真 CLI e2e `cli-bug-246-optional-slot-undefined.test.ts`（optional 夹具 exit 0
  且零 `nudo:constraint-violated`、required 夹具 exit 1 且恰好一条、required + 合法值 exit 0）。
  
  ### 追加：BUG-082 / BUG-058 已修（契约 ∪ 默认值域；`String()` 走 string hint）
  
  - **BUG-082**：契约路径把形参 Abs **整体替换**成 `constraintToEntryAbs(...)`，默认值初始化式从未参与
    ⇒ 形参域被收窄、返回面随之收窄 ⇒ `pick(s = "abc")` 配 `fn({s: number()}, number())` 在被调方
    判绿（`OK`, exit 0），而同一契约在零调用点面正确报红。修（section 方案 1）：契约绑定时把**默认值
    类型并入形参定义域**（契约域 ∪ 默认值类型；默认值落在域内时保持契约域原样 ⇒ 合法形态零变化）。
    实现为 `generalize.ts` 内三个纯函数：`defaultInitAbsOf`（AST 字面量 → Abs）、`fnParamNodesOf`
    （按名取最浅层函数节点的形参 AST）、惰性闭包 `defaultInitAbsOfParam` + `contractDomainOf`
    （`leqAbs(initAbs, entryAbs)` 通过则原样返回，否则 `joinAbs`）。冲突经**既有** L1 返回契约对账
    通道执法，未新增诊断码。局限（如实记录）：只并入**字面量**初始化式，`s = compute()` 这类不猜
    （避免假红）。`.d.ts` 可省性在 HEAD 上已正确（`pick(s?: number)`），本次用测试钉住其上游事实
    （契约路径下 `formals[0]` 仍是 `{kind:"default", optional:true}`）。
  - **BUG-058**：`isNullProtoWithoutCoercer` 是 ToPrimitive 前置闸门的统一调用面，却把 hint 写死
    `"default"`；`String()` 复用它而没传 `"string"` ⇒ 原生**不调** `valueOf` 的路径被调（用户副作用
    凭空多出）。修：`isNullProtoWithoutCoercer(a, hint: CoercionHint = "default")`（默认值保持
    `"default"` ⇒ `+` 面调用点无需改动、语义不变），`builtins/global.ts` 的 `String()` 改传
    `"string"`；`"string"` hint 下**无自有 `toString` 钩子时绝不回退** `valueOf`；用户 `toString`
    返回**非原语**时仍回退 `valueOf` —— 这是 ES `OrdinaryToPrimitive` 的规定（node 实测
    `String({toString:()=>({}), valueOf(){c++;return 1}})` ⇒ `"1"`, c=1），删掉回退反而偏离原生。
  
  回归：`core-bug-082-contract-default-param.test.ts`（7 例）、`core-bug-058-string-hint.test.ts`
  （8 例）。CLI 取证：`viaString() => 10` 变为 `=> 0`（native 0），`only-viaPlus.js` 仍 `=> 10`
  （native 10）。同族仍未改：`methods.ts` 的 `String.prototype.concat` 与**模板插值**的降级点
  （`${o}` 现被降级成 `$add($add($lit(""), o), $lit(""))`，与用户写的 `"" + o` 逐字同形 ⇒ 信息在
  降级处丢失，需专用 `$toStr` op）。
  
  ### 追加：BUG-058 模板插值 / `String.prototype.concat` 面已修（专用 `$toStr` op）
  
  `${o}` 原先被降级成 `$add($add($lit(""), o), $lit(""))`，与用户写的 `"" + o` **逐字同形**；而 `+`
  必须用 default hint（原生 `"" + o` 会调 `valueOf`）、模板插值必须用 **string hint** ⇒ 信息在降级处
  丢失，无法靠调用点区分。修：`exec/runtime/ops.ts` 新增 `$toStr(a)` —— 走
  `isNullProtoWithoutCoercer(a, "string")` + `invokeToPrimitiveHook(a, "string")`；`Symbol` ⇒ 抛
  `TypeError`；字面量 ⇒ 字符串字面量；否则 `string()` 并记 may-throw。
  `exec/transpile/expr/atom.ts` 的 `TemplateLiteral` 插值位包一层 `$toStr`；`exec/index.ts` 导出并
  在 `runtime-import.ts` 的 `RUNTIME_IMPORT_NAMES` 登记。另：`methods.ts` 的
  `String.prototype.concat` 是 ToString 面，也改传 `"string"`。
  
  回归：`core-bug-058-string-hint.test.ts` 扩到含模板插值与 `concat` 的副作用计数；coercion 家族
  （`concat-spreadable`、`eval-arith-coercion-throws`、`core-bug-381`、`core-bug-1121`、
  `core-bug-261/262/402` 等）221 例全绿。
  
  ### 追加：`public-api.snapshot.json` 记录 `./exec` 新增的 `$toStr`
  
  模板插值的 `$toStr` op 是 `./exec` 的导出（`exec/index.ts`），快照面必须同步记录——
  `public-api-freeze` 的 `./exec` 分母因此从 208 变 209。该条目属于**快照正常演进**
  （导出面确实多了一个算子），不是放宽门禁。
- aed8e00: Fix bug-report category 03 (evaluation engine) — verified subset.
  
  - BUG-194: `$copy` / `$set` on a host global no longer crash the engine with a bare
    TypeError (`nudo:internal` false red); the fork/copy path handles host objects.
  - BUG-218: Proxy `has` trap gains the ES invariant check, so a trap that violates
    [[HasProperty]] is a definite TypeError instead of a false green, and the engine no
    longer prints a `false` the host can never produce.
  - BUG-219: `delete <host global>.x` / `"x" in <host global>` route through `$del` /
    `$in` correctly instead of raising a bare TypeError.
  - BUG-243: `Array.prototype.indexOf` no longer clamps `fromIndex` to `len - 1`;
    `fromIndex >= length` returns `-1` like the host (the sibling `lastIndexOf` clamp was
    already correct).
  - BUG-244: array-like receivers are no longer mis-reported as may-throw for
    `sort` / `reverse` / `copyWithin` / `fill`, and a comparator returning bigint is
    recorded as `TypeError` (host kind) rather than a generic `Error`.
  - BUG-249: `strictEqAbs`'s "same Abs ⇒ same value" fold now honours the domain-sharing
    gate, so `xs[0] === xs[1]` over a contract-typed array no longer folds to `true`.
  - BUG-254: env-global injection no longer splices names verbatim into `let` bindings, so
    a strict-mode reserved word can no longer produce a `new Function` SyntaxError that
    fails the whole module closed.
  
  Regression tests: `core-bug-194-*`, `core-bug-218-*`, `core-bug-219-*`,
  `core-bug-243-*`, `core-bug-249-*`, `core-bug-254-*`.
  
  Known follow-ups NOT covered here (still reproducing): BUG-072, BUG-073, BUG-078,
  BUG-159, BUG-162, BUG-166, BUG-173, BUG-175, BUG-177.
  
  ### 追加：本轮求值引擎修复
  
  已修复（`tmp/verify-bug.sh` exit 1 的标注为脚本实证；其余为观察型 fixture，证据是 CLI
  签名与回归测试）：
  
  - **BUG-004**：类静态方法走 `$staticInvoke`（`D.s1 => 42`、`D.instance => 7`、`D => D`）。
  - **BUG-020 / BUG-180**：`@nudo:mock` 作用域收回到**声明它的函数**（`scopeSelectedInject`
    按函数自身的 mock 表过滤），依赖包内的函数同理 ⇒ `fa() => { from: "A" }`、
    `fb()` 不再误用 A 的 mock、`callMock() => "mocked"`。既有负控制
    `service-bug-455-mock-scope.test.ts` 原先钉住「非冲突 mock 是文件级」——**与 BUG-020
    声明的正确行为相反**，已改写为按函数作用域可见。
  - **BUG-072**：`definiteModuleThrowOf` 认确定性的装载期抛错（IIFE 抛、顶层调用恒抛的
    本地函数、nullish 成员读取、非法 `JSON.parse` 字面量、类静态块抛）⇒ error 级
    `nudo:module-throw`；`typeof missing` / 条件分支 / 可选访问的负控制保持干净。
    既有 `core-bug-1158-module-throw-failclosed.test.ts` 的负控制原先断言
    `JSON.parse("{")` / null 成员读取**不得**上报——同样与正确行为相反，已改写。
  - **BUG-073**：`evalFallbackOf` 把用户代码的原生异常归类为 `module-throw`（不再是
    `internal`），fallback reason 直接断言。
    连带的口径收口（不是放宽断言）：模块级原生异常此前会让分析器产出一条 error 级
    `nudo:internal`（"analysis failed for … engine internal fallback"），现在它是**可裁决
    的** `nudo:module-throw` error —— `nudo check` 依旧红、`--json` 依旧
    `ok:false` + error issue、IDE 面依旧可见（`lsp-bug-140` 与
    `nudojs-bug-1145` 两个回归用例已改到新码，契约文案随之更新）。`nudo health` 的
    判据是 drift / case drift / path error / **internal 回落**，「代码本身必抛」属于
    check 的职责 ⇒ health 对该 fixture 报 OK（`internal` → FAIL 的反向仍由
    `unsupported:*` 负控制与 CLI 内部路径守住）。
  - **BUG-078 / 159 / 166 / 175 / 177**：`renameAbs` 保留 `optionalParams` / `holes`
    （稀疏元组仍不可赋给稠密元组）；`new Storage()` 不再自信地判成 `Storage` 品牌；
    用户 `URL`/`Error`/`Map`/`Date`/`Promise` 类遮蔽宿主全局；`instanceof` 的
    Proxy/箭头/方法 RHS 产原生 `TypeError`（生成器 RHS 仍是布尔）；派生构造器返回对象
    时 `derivedReturnObj => { q: 1 }` 且无 may-throw。
  - **BUG-160 / 162**：`TextEncoder` 的 `encoding`/`encode`/`encodeInto` 齐备、
    `TextDecoder.encoding => "utf-8"`；web env 保留 `Event`/`CustomEvent`/`Request`，
    node env 诚实报 `never throws TypeError`。
  - **BUG-165**：零 `TypeError` / `entry-may-throw` 噪音；迭代器 symbol 调用产出迭代器面。
  - **BUG-173**：派生构造器 `super()` 前访问 `this` ⇒ 原生 `ReferenceError`
    （`exec/super-access.ts` 的访问门，构造器体执行期登记）。
  - **BUG-215 / 216 / 217**：不可调用的 `@@iterator` 槽确定抛 `TypeError`；可选调用只读
    一次 getter（`1`，不是 `"two"`）；计算键成员读走访问器（`o[k]` → `42`）。
  - **BUG-242 / 248 / 259**：`indexOf(3,5) => -1` / `lastIndexOf(3,5) => 2`；二元自递归
    走解释路径 + L2 α 项剥离（`bin => unknown` + `nudo:recursion-truncated`，快且不 OOM，
    线性对照不受影响）；symbol 键读写（读 `1`、计算写读 `7`、
    `getOwnPropertySymbols().length => 1`）。
  
  ### 追加：BUG-172 / BUG-220 已修
  
  - **BUG-172（同名类跨模块互相覆盖）**：注册表本体仍按裸名键（进程级 `Map`，清理语义不变），
    但**类规格改为随值携带**：`exec/class-registry.ts` 新增
    `classSpecByValue: WeakMap` + `attachClassSpec` / `classSpecOfAbs` / `carryClassSpec`，
    `EvalClassSpec.superSpec` 记录父规格。`exec/class/declare.ts` 去掉私有 `classImpl` 表，
    `$class` 把规格挂到**类值**、`superSpec` 取自**父值身份**（不再按名），`$new` 把规格串进
    构造与实例，`findMethod` 首链**规格优先**；`class/super.ts` 仅在携带规格的 `name` 等于
    当前子类名时使用它（否则派生链会误取最派生规格）；`runtime/members.ts` 新增
    `classChainLinks`（首链规格优先、其后名字链，保留既有 last-wins 语义）；
    `containers/member.ts` 的静态/实例成员与 `ownSpec` 规格优先；`containers/obj.ts` 的 fork
    快照分支携带规格。回归 `core-bug-172-class-registry-scope.test.ts`：3 模块图，两边同名
    `Config` 各读各的（`readA()===1` / `readB()===2`，互不可见，`kindA/kindB` 正确）。
    残留（已在 changeset 声明）：只拿名字、拿不到接收者值的面（`Object.prototype.*`、`Reflect`、
    `JSON`、`denote.ts`）保持既有 last-wins 口径。
  - **BUG-220（无界迭代代表元素 + IteratorClose）**：无界分支的代表元素由
    「第一个具体元素」改为**已收集元素的 join**（`abstractIterItem` +
    `UNBOUNDED_ITEM_JOIN_CAP = 8`；空集/超限 ⇒ `unknown`），且在无界步之前只提升一次 ⇒
    guard 不再被折叠成确定 false，`break` 臂得以探索。`IteratorClose` 经复核**无需改动**
    （`catch` → `isNudoBreak` → `iteratorClose(userIter)` 已可达，`return()` 的写入能到达
    循环出口）。回归 `core-bug-220-unbounded-iterator.test.ts`（5 例：复现改 `"CLOSED"`、
    有界 break/自然耗尽、精度不受损、元素域为 `unknown` 而非字面 `0`、两分支都探索）。
    残留（代码内已注明）：元素域**永不满足** break 条件的无界迭代器仍分析成 `"CLOSED" #exact`；
    要让 `closed` 进循环 pack 需要把写改到循环体内，与验收口径冲突，故不做特例。
  
  ### 追加：回落分类改为「标签 × 来源 × 可见性」三维（BUG-073 收口）
  
  `EvalFallback` 现带 `origin`（`"engine" | "host" | "module"`）与 `gateFatal`（可见性）：
  
  - **标签**（`reason`）：`module` 来源（transpiled 用户代码）⇒ `module-throw`（BUG-073：
    用户代码的原生 ReferenceError / TypeError 是**程序自身抛**，不是「引擎缺陷」）；
    `host`（宿主 `apply` 钩子 / 宿主函数边界）与 `engine`（引擎自身违约：编译体生成失败、
    引擎产出非 Abs 值）⇒ `internal`（DEC-006 canary 保留）。
  - **可见性**（`gateFatal`）：装载期逃逸 ⇒ 闸门无法裁决该文件 ⇒ `true`
    （`tryRunTranspiled` / `tryRunTranspiledDetailed` / 模块求值 catch 标
    `{ loadFailure: true }`）；能力边界 `unsupported:*` 与**建模内**的 `NudoThrow` ⇒ `false`
    （不得假红）；调用期异常 ⇒ `false`（该次调用的 `throws` 面承载）。
  - `runExportCallGuarded` 的 Abs-fn 分支按 `getFnImpl(fn)?.apply ? "host" : "module"` 传来源，
    与 `$callDispatch` 的派发顺序（apply 先于编译体）一致；`body-fn.ts` 的编译失败改记
    `engine`（否则 transpiler 失败会被误贴成用户代码的抛）。
  
  `run-export-guarded` 中一条既有断言钉的是 `internal ×1`，与 BUG-073 直接冲突（编译体自由名
  的原生 ReferenceError 是**用户代码**的抛）⇒ 重钉为 `module-throw ×1`，并改成**两个维度各
  断言一条**（internal 增量 0 / module-throw 增量 1）；可观测面（result unknown +
  throws ReferenceError）不变。
  
  ### 回归修复：`nudo health` 与 `nudo check` 的预算归因必须同源
  
  同一文件在 `nudo check --json` 与 `nudo health` 两面必须给出同一预算归因（既有
  `health-budget-truth` 断言）。
  
  **根因**：自递归「有界试算」`runEvalCallBudgetTrial` 用一次性预算实例跑探针，探针撞
  depth/calls 时结果被丢弃（调用方回落 fail-closed），而「撞了预算」这件事只随探针实例一起
  被丢弃（`withSpeculativeEvalObservability` 还把截断观测静默了）⇒ 宿主预算面上只剩旁证的
  cycle 归因：health 报「call cycle — not a budget limit」，而 check 面（证据域真跑到 64 层）报
  「eval depth 64/64」——两面口径分裂，且把「抬 `@nudo:budget` 有效」的深递归误报成「抬预算也
  解不开的环」。
  
  **修法**：探针截断后把「撞了哪条预算」**重新记账**到宿主预算实例上
  （`CallBudget.noteTruncation`，仅类型成员、**无新增导出名** ⇒ public API 冻结不变）。
  计数/上限取**宿主实例的生效上限**（`@nudo:budget` 覆盖期间取覆盖值）——试算内部阈值
  （depth=5 / calls=512）是实现细节，不上屏。状态机补 calls 截断现场（`callsTruncCalls/Limit`），
  上屏计数必到顶，不出现「3/20000 却标 truncated」。重新记账**只进预算面**（实例 reasons +
  共享原因集），**不**触发诊断 collector —— 诊断归因（cycle vs 预算，#158）仍由真正跑那条求值的
  路径上报，否则会把 `service-bug-099` 钉住的 cycle 归因改写成「抬预算可解」。
  
  **是否有重钉**：无（未改任何测试断言）。
  
  **残留**：① 诊断面措辞仍按各自求值路径分脸（分析器面 cycle / check 面 depth）——HEAD 既有
  差异，本次刻意不动；② 重新记账的 depth 取宿主生效上限而非探针阈值；③ 探针阈值
  （`generalize.ts`，depth=5 / calls=512）未动 ⇒ 收敛半径 6..64 的自递归仍 fail-closed。
- e4190b5: Fix bug-report category 04 (core builtins / collections) — 17 of 26 defects.
  
  - BUG-007: a primitive's prototype method dispatches correctly instead of being
    reported as absent.
  - BUG-008: `Object.getOwnPropertyDescriptor(fn, ...)` models a function's own
    `name` / `length` / `prototype` slots.
  - BUG-009: a regexp literal's flags are canonicalised, so `/a/gi` and `/a/ig` agree.
  - BUG-132: a boxed primitive's internal slot is modelled.
  - BUG-157: `URLSearchParams` `entries()`/`keys()`/`values()` are no longer reported as
    carrying an internal slot.
  - BUG-164: the `Object.prototype` legacy accessor allowlist and the descriptor table are
    now the same source of truth.
  - BUG-176: `Reflect.construct` on a user class is no longer reported as may-throw.
  - BUG-181: `Reflect.set` with a primitive receiver is a definite `TypeError`, not a false
    red.
  - BUG-182: a host function's constructibility facet is decided by IsConstructor, not by
    the presence of a `prototype` property.
  - BUG-230 / BUG-260: `Set` / `Map` cardinality from an abstract iterable is no longer a
    definite value, and `MapTable` carries insertion order so key iteration matches the
    host and `new Set(xs).size` agrees with `Array.from(new Set(xs)).length`.
  - BUG-276: class-instance enumerable flags are correct, so `getOwnPropertyDescriptor` /
    `Object.keys` agree with the host.
  - BUG-277: a builtin brand's user-defined keys are enumerated (`entries` /
    `getOwnPropertyNames` / `getOwnPropertyDescriptors` / `JSON.stringify`).
  - BUG-278: an `Error` subclass's inherited `name` ordering matches the host.
  - BUG-281: `getOwnPropertyDescriptors` on a brand instance matches `keys`/`values`.
  - BUG-282: a nested same-name `@nudo:case` scope resolves to the nearest binding, and
    shape contracts fall back to a prototype-chain `HasProperty` check.
  
  Regression tests: `core-bug-{007,008,009,132,157,164,176,181,182,230,260,276,277,278,281,
  282}-*` (16 files / 106 tests).
  
  Known follow-ups NOT covered here (root cause outside this category's file set):
  BUG-058, BUG-130, BUG-131, BUG-160, BUG-165, BUG-167, BUG-174, BUG-258, BUG-275; and
  BUG-163's `toJSON` half (needs `exec/runtime/members.ts` `BUILTIN_BRAND_METHODS.URL` —
  its `host` half is fixed and tested).
  
  ### 追加：本轮内建面修复
  
  已修复（带新回归测试）：
  
  - **BUG-163（`toJSON` 半边，至此完整）**：`BUILTIN_BRAND_METHODS.URL` 增加
    `toString` / `toJSON`，`BUILTIN_BRAND_ACCESSORS.URL` 补组件访问器 ⇒
    `urlToJsonIsUndef() => false`、`urlToJsonIn() => true`（修复前 `true` / `false`）。
    测试：`core-bug-163-url-tojson-brand-face.test.ts`。
  - **BUG-174**：`TextDecoder` 构造参数按宿主顺序校验（label 的 ToString → options 字典
    → label 查找），抽象 prim / 全 prim 联合的 options 确定抛 `TypeError`，`any` 只记
    may-throw。测试：`core-bug-174-textdecoder-options.test.ts`。
  - **BUG-183**：`btoa` / `atob` 缺参确定抛 `TypeError`（其余 6 个全局函数保持把缺参当
    `undefined`）。测试：`core-bug-183-btoa-atob-missing-arg.test.ts`；
    `tmp/verify-bug.sh BUG-183` → exit 1。
  - **BUG-275**：`Object.create(proto)` 的基对象镜像 proto 自有槽为 `Slot.inherited`
    （只表示存在性，值为 `unknown`），自有键视图（`Object.keys/values/entries`、for-in、
    spread、JSON）排除 `inherited` ⇒ 与原生一致。测试：
    `core-bug-275-object-create-inherited-slot.test.ts`；`verify-bug.sh BUG-275` → exit 1。
  
  ### 追加：BUG-167 已修（构造点对齐 facet + 投影面读域判定）
  
  - **BUG-167**：两个 `$fnVal` 构造点（`ObjectMethod` 简写与方法型 `FunctionExpression`）改为发
    `effectFree` / `closed` facet（`getFnFacets` 静态保守判定，与 `expr/function.ts:366-373` 同口径）
    ⇒ 同一函数体写成方法 vs 写成函数字面量，在 sort 比较器闸门、promise 回调、访问器纯度判定上
    不再得出相反结论。叠加的第二处根因：`Object.defineProperty(o,k,{get})` 装的访问器占位槽是
    `unknown`，而三个投影面（`format.ts`、`denote.ts`、`service/emit/dts-generator.ts#slotAbsOf`）
    会**无条件执行用户 getter**，把分析期末次读值冻结进签名与 guard ⇒ 签名自信错值、
    `data.b === <literal>` 恒假。修法：投影面加**读域不可判**判定（占位槽**无 term** ⇒ 不执行
    getter，presence-only）。判据必须用 `term === undefined` 而**不是** `shape.k === "unknown"`
    —— `$lit(void 0)` 的 `shape.k` 也是 `"unknown"`，按 shape 判会把所有访问器判死（首版即此错）。
    回归 `core-bug-167-side-effect-getter-not-frozen.test.ts`（10 例，含 Bug 191 / 152 的负控制）；
    验收组 11 文件 / 148 例全绿（含 `eval-call-position`、`eval-match-json-view`、
    `exec-join-accessors`、`exec-define-property-accessor`）。
    残留（如实记录）：**对象字面量** `get` 访问器的占位槽必须是 `$lit(void 0)`（Bug 191 的读域投影
    与 Bug 152 的调用点求值序钉住它，换 `$unknown()` 会同时打红两处），彻底修法需在 slot 上引入
    显式「读域不可判」标记（`abs.ts` slot 类型 + `exec/runtime/state.ts` 的 `$set` 选项 +
    `descriptor.ts` 写入）；`projection.ts`（zod / standard-schema 经 `absToConstraint` 取读域）
    同样仍是执行 getter 的老路。BUG-167 section 的验收 repro 是 `Object.defineProperty` 形态，
    本修复已覆盖。
  - **BUG-258（facet 已落地，投影面见 cat-05）**：数组视图信息原先由 `builtins/regexp.ts` 的
    `WeakSet` 侧表（按 Abs 身份）承载，只有 `Array.isArray` / JSON 序列化 / 数组方法派发消费，类型面
    看不见。修：`abs.ts` 的 `{k:"obj"}` 形状增加 `view?: "array"` facet +
    `markArrayView` / `isArrayView`（不导出到公开面 ⇒ 快照零变化；`markArrayView` 是**替换** shape 而
    非就地改共享 shape），`regexp.ts` 删除侧表、`markMatchArrayView` / `isMatchArrayView` 降为薄包装，
    消费面（`array.ts` / `json.ts` / `member.ts` 派发）只读 facet；运行形状仍是 `k:"obj"`（未改 tuple）
    ⇒ `eval-call-position.test.ts:344-350` 的渲染钉不变。回归
    `core-bug-258-array-view-facet.test.ts`。未完成：dts / zod / standard / guard 四个**产物面**尚未按
    `shape.view === "array"` 分支；多 case join 时 `joinObjects` 重建 shape 不带 `view`（需一侧传递）。
- 6daa52e: Fix bug-report category 05 (rendering / projection / emit generators) — 11 of 17 defects.
  
  - BUG-025: the standard-schema `promise` node tests `instanceof Promise` in both the
    library and the inlined copy, so a non-promise value is rejected instead of accepted.
  - BUG-031: `litPredValue` became `litPredValues` and recognises
    `or(eq(...arm), ...)`, so a literal-union contract renders as `1 | 2 | 3` in the
    signature face, matching the dts face byte for byte.
  - BUG-087: `showLits` renders the **type** (`3`, `"a"`) instead of leaking the contract
    DSL spelling (`lit(3)`) into signatures and slot displays.
  - BUG-092: `predAsJs` / `termIsValue` emit `Number.isInteger(v)` for a `%1 === 0`
    predicate and compare field items by value, so nested numeric bounds agree across all
    four faces.
  - BUG-095: the `arr` branch uses `Array.from(v).every(...)` (holes filled with
    `undefined`), matching the standard face — `[1, , 3]` is no longer accepted by the
    guard.
  - BUG-097: a slot named like an `Object.prototype` own member is read with bracket
    access, so the guard compiles under `tsc --strict` (TS2367 gone).
  - BUG-098: the `brand` branch drops observed literals deeply, so a brand built from an
    observed `/abc/i` or `new TypeError("boom")` accepts the real value.
  - BUG-145: a same-name slot produces no inlay hint (it previously rendered another
    binding's derivation).
  - BUG-147: inlay hints cover anonymous default exports (arrow, function expression, and
    a `FunctionDeclaration` without an id).
  - BUG-158: an `Arguments` brand no longer emits an `Array.isArray` premise while keeping
    its length/index semantics, so the guard accepts `arguments` at runtime.
  - BUG-250: the guard declares `const data: any` when the contract carries an identity
    clause, so `instanceof` narrowing no longer blocks index reads
    (`tsc --strict` TS7053 gone).
  
  Also updates `core-bug-348-lit-literal-signature.test.ts`, which pinned the
  `f(x: lit(1))` spelling that BUG-087 declares wrong, to the corrected `f(x: 1)`.
  
  Regression tests: `core-bug-{031,087,092,095,097,098,145,147,158}-*`,
  `service-bug-{025,250}-*`.
  
  Known follow-ups NOT covered here (root cause outside this category's file set):
  BUG-091 (needs `lsp/src/lsp-surface/completions.ts`), BUG-096 (needs
  `schema-generator.ts`), BUG-108 / BUG-169 (need `dts-generator.ts` + `schema-generator.ts`),
  BUG-156 (needs `schema-generator.ts`), BUG-191 (needs `dts-generator.ts:1986-1995`).
  
  ### 追加：BUG-096 / BUG-169 / BUG-191 已修 + BUG-258 的 facet 与投影面
  
  - **BUG-096（键存在性三面不一致）**：zod 面原生用 `key in data`（含 `Object.prototype` 成员），
    guard / standard 面减污染键 ⇒ `Object.create({toString:"s"})` 在 zod 面被放行。反向改
    guard/standard 会改 `hasPropertyClause` 的子句文本，而该文本被 `eval-bug-191-accessor-projection`
    与 `eval-bug-240-guard-internal-slots` **逐字钉住** ⇒ 只能把 zod 面补齐：`schema-generator.ts`
    对「**必填**且键名是 `Object.prototype` 自有成员」的槽追加 `.superRefine`（沿用同文件 `__proto__`
    槽的既有模式），子句与 guard **逐字同口径**；非污染键不加码（`z.object` 原生判据已与另两面等价）。
    同时修正三处自述注释（`denote.ts` / `standard-schema.ts` / 产物 `__nudoHasProperty`）为「三面唯一
    规则」。guard / standard 的**代码未变**。回归 `service-bug-096-key-presence-parity.test.ts`。
  - **BUG-169（TS 可选形参 `b?: T` 丢失）**：`?` 在 strip-types 阶段被删（param 节点 `optional`
    为 `undefined`），`formalParamsFromNodes` 的 `kind:"id"` 硬写 `optional:false`；dts 的
    `declaredParams` case `"id"` 硬写 `hasDefault:false`；standard 只认 `kind==="default"`。
    修：`param-surface.ts` 的 `formalParamsFromNodes(params, source?)` 末尾接
    `withOptionalParams(out, tsOptionalParams(params, source))`（**无 source 时集合为空 ⇒ 零行为变化**，
    `generalize.ts` / `exec/transpile` 等未传 source 的调用点不受影响）；`dts-generator.ts` 的
    `case "id"` 改 `hasDefault: f.optional === true`；`standard-schema.ts` 的 `declarationOptional`
    认 `kind === "default"` ∪ (`kind === "id"` && `optional`)。服务面 `extractFormals(node, source?)`
    与 3 处调用点只做 **source 透传**（无语义改动）。回归 `emit-bug-169-ts-optional-params.test.ts`
    （差分口径：三面可省性 ≡ 源码 JS 默认值 ∪ TS `?`）。
  - **BUG-191（`export namespace` 缺失）**：`scan-named-exports.ts` 的 `ExportNamedDeclaration`
    声明分支只认 Function/Class/Variable ⇒ `TSModuleDeclaration` 落 `continue` 被静默丢弃；
    `dts-generator.ts` 同款缺口且从不发射 ⇒ 消费端 TS2305，而求值器确实物化了 `NS`。修：
    `scan-named-exports.ts` 新增 `TSModuleDeclaration` 分支（登记 `NS` + 运行时成员键
    `NS.x` / `NS.f` / 嵌套 `NS.Inner.y`；interface / type 是纯类型**不**登记，`addNamespaceMemberKeys`
    只认 `export` 过的成员）；`dts-generator.ts` 增加 `namespaces` 面并发射
    `export declare namespace NS { … }` + 别名导出（class 发空体；enum/interface/type 镜像原文；
    嵌套递归；`namespace A.B` 认尾段）。回归 `emit-bug-191-export-namespace.test.ts`。
  - **BUG-258（数组视图 facet）**：数组视图信息原由 `builtins/regexp.ts` 的 `WeakSet` 侧表（按 Abs
    身份）承载，只有 `Array.isArray` / JSON 序列化 / 数组方法派发消费，类型面完全看不见 ⇒ 同一个值在
    引擎内两个结论。修：`abs.ts` 的 `{k:"obj"}` 形状增加 `view?: "array"` facet +
    `markArrayView` / `isArrayView`（**不**导出到公开面 ⇒ 快照零变化；`markArrayView` 是**替换** shape，
    不是就地改共享 shape）；`regexp.ts` 删除 WeakSet 侧表，`markMatchArrayView` / `isMatchArrayView`
    保留同名同签名降为 facet 薄包装；消费面（`array.ts` / `json.ts` / `member.ts` 派发）只读 facet。
    运行形状仍是 `k:"obj"`（**未**改 tuple）⇒ `eval-call-position.test.ts:344-350` 的
    `"0":"b"` / `index:1` / `input:"abc"` 仍成立。回归 `core-bug-258-array-view-facet.test.ts`。
    未完成（已定位）：四个产物面（dts / zod / standard / guard 的 obj 分支）尚未按
    `shape.view === "array"` 分支；多 case join 时 `joinObjects` 重建 shape 不带 `view`，需一侧传递。
  
  ### 追加：BUG-258 四产物面 + BUG-169 zod 面
  
  - **BUG-258 产物面**（facet 本体见 cat-04）：**guard 面**（`denote.ts`）obj 分支改判
    `shape.view === "array"` ⇒ `Array.isArray(v)`（取代 `typeof/object` + `!Array.isArray`；槽判据一字
    未动 —— exec 结果的 `0/1/length/index/input/groups` 全是自有属性）；**dts 面**
    （`dts-generator.ts`）数组视图投影成**元组** + 其余自有槽的交集（`length` 由元组隐含），
    `widenParamAbs` 透传 `view` facet（否则形参位会退回对象字面量）；**zod 面**
    （`schema-generator.ts`）`SchemaNode.obj` 增 `arrayView?: boolean`，渲染 `z.tuple(...)`
    （`z.object` 会拒真实数组），非下标槽记台账 `non-index slots not validated by z.tuple`；
    **standard 面**（`standard-schema.ts`）库函数版与产物版都要求 `Array.isArray(value)`，
    `arrayView` 随节点序列化，产物类型别名 `NudoSchemaNode` 补 `arrayView?: boolean`
    —— 这是**修产物类型**，不是放宽 `emit-bug-519-989` 的 strict 编译门禁。
  - **BUG-169 zod 面**：`nudojs/src/commands/export/contract-face.ts` 的 `unifiedParamFace` 常规形参
    分支改为 `formal.optional === true || formal.kind === "default" || formal.index >= minArity`
    —— `FormalParam.optional`（已接通 TS `?`）成为唯一事实源；无 `?` 的声明仍按观测最少实参元数放宽。
    回归用「一键实参」观测把 `minArity` 钉在 1，使下标 1 的可省性只可能来自 TS `?`。
  
  回归：`core-bug-258-array-view-facet.test.ts`（6 例）、
  `service-bug-258-array-view-products.test.ts`（5 例）、`emit-bug-169-ts-optional-params.test.ts`
  （5 例）；`service/src/emit/__tests__` 114 文件 / 798 例、core algebra 973 文件 / 10 431 例、
  service 242 文件 / 1 318 例全绿。残留：多 case join 的 `joinObjects` facet 传递（`objects.ts`）。
- 206713f: Fix bug-report category 06 (directive system) — 5 of 7 defects.
  
  - BUG-013: the scope-boundary guard no longer aborts at the walk root, so a bare-block
    annotated statement is replaced instead of falling through to a false
    "matched no expression" warning; the diagnostic now distinguishes "blocked by a nested
    scope" from "no such expression".
  - BUG-086: orphan diagnostics for inline directives are reported per instruction (with
    the right line/column) instead of being swallowed by a global orphan counter.
  - BUG-184: `@nudo:replace` only matches **value-slot expression** nodes; binding and key
    positions fall through to the "matched no expression" warning instead of being
    transpiled.
  - BUG-195: an in-body `/// @nudo:import` line comment is now reported as misplaced (it
    previously fell into a silent `continue`).
  - BUG-283: `@nudo:skip` (and the `@nudo:pure` sibling) bind to the **shallowest** same-name
    scope instead of the last writer, so an inner function can no longer steal the outer
    one's skip and an inner-only skip can no longer erase the exported function's `throws`
    annotation.
  
  Regression tests: `service-bug-013-*`, `service-bug-086-*`, `service-bug-184-*`,
  `service-bug-283-*`, `parser-bug-195-*`.
  
  Known follow-ups NOT covered here (blocked on core/service call sites outside this
  category's file set): BUG-020 and BUG-180 (`@nudo:mock` scope degrades to file level when
  there is no same-name conflict) need `core/src/algebra/generalize.ts`
  (`scopeSelectedInject` / `hasMocks`), `core/src/algebra/check-may-throw.ts`
  (`evalThrowsOutcome`) and `service/src/abs-modules-graph.ts` (`evalDep`).
  
  ### 追加：BUG-080 已修（`@nudo:as` 在解构声明上被静默丢弃）
  
  根因：`exec/transpile/stmt/statement.ts` 的 `emitVariableDeclaration` 里 `asVar`
  （`matchAsOverride(stmt)` 的结果）**只在 Identifier 分支被消费**，解构分支（`d.id` 非 Identifier）
  从头不读它 ⇒ 覆盖被静默丢弃；而指令本身**采集正常**（`VariableDeclaration` 是语句，
  `isDirectiveCarrier = isStatement`）⇒ `asTargets` 非空 ⇒ 连 orphan 诊断都不触发 ⇒ 彻底静默、零诊断。
  
  修法：解构分支与 Identifier 分支**同口径**消费 `asVar` —— 覆盖值取代 init 的**值**，原 init 仍求值
  （`((initSrc), asVar)` 逗号表达式 ⇒ 副作用与 throws 域保留；`@nudo:as` 是**类型覆盖**不是求值替换）。
  随后 `emitDestructure` 照旧逐项 `$get` / `$idx`，读到的自然是覆盖值 ⇒ 每个绑定按源键（对象模式）/
  位置（数组模式）取自己的槽；改名 / 默认值 / rest / 嵌套模式全部走原生语义，无特判。
  
  回归 `core-bug-080-as-destructure.test.ts`（8 例）：对象 / 数组模式、改名绑定、Identifier 对照不退化、
  无指令与未标注声明的负控制、原 init 的副作用保留、原 init 的 `throws` 域保留；捕获力已实证
  （回退该行 ⇒ 前 3 例失败）。
  
  循环头解构（`for (const {a} of xs)`）上的 `@nudo:as` **没有 initializer**（for-of 头不经
  `emitVariableDeclaration`，而是在 `emitForOfStatement` 内直接调 `emitDestructure`）⇒ 该形态不施加覆盖，
  改为发一条显式 `nudo:directive-syntax`（详见下文「BUG-080 残留收口」）。
  
  ### BUG-080 残留收口：解构子名进绑定表 + 不可用的 `@nudo:as` 载体显式诊断
  
  上一节记录的两处残留已收口：
  
  **残留 A（假绿）—— 解构声明的子名此前不进顶层绑定表**（`$recordBinding` 只在 Identifier 分支登记）⇒
  该名字在别处被当作实参时解析不出类型 ⇒ `checkSource` 的 `varAbs` 查不到 ⇒ **调用点的契约检查被整条跳过**
  ⇒ 同一份值走 Identifier 形态会报 `nudo:constraint-violated`，走解构形态**一声不吭**。
  同一张表还喂 `collectAbsBindingsFromGraph`（hover / IDE 绑定）与 `mock-abs.ts` ⇒ 解构名在那些面上也没有 Abs。
  
  修法（`packages/core/src/algebra/exec/transpile/stmt/statement.ts` 的 `emitVariableDeclaration`）：
  解构分支按 Identifier 分支**同口径**登记绑定名（`$recordBinding(name, name)`，取自
  `collectPatternNames`）—— 只限**顶层 depth 0**；块内 / 形参 / catch / for 头不是顶层绑定（作用域正确）。
  覆盖对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装全部走原生语义，无特判。
  
  **残留 B（静默）—— `@nudo:as` 标注在无适用目标的语句上时被静默忽略**：`matchAsOverride` 只在
  `emitVariableDeclaration` 与 `emitReturnStatement` 被询问，而指令采集接受**任意语句**
  ⇒ 标在 for 头 / for-init / if / 表达式语句 / 函数声明上的 `@nudo:as` 被采集却施加不到任何东西
  ⇒ 类型不变 + **零诊断**（假绿）。
  修法（`packages/service/src/eval-injection.ts`）：目标形态白名单 = `VariableDeclaration` /
  `ReturnStatement` / `ExportNamedDeclaration`（其 `declaration` 是变量声明）；不在白名单 ⇒
  发一条既有的 `nudo:directive-syntax`（warning 级，不制造假红）且**不登记覆盖目标**。
  
  **重钉**：无。
  
  **文档**：`packages/website/docs/concepts/directives.md`（§`@nudo:as`）与 zh-Hans 镜像补两句 ——
  解构声明受支持（覆盖施加在初始化表达式上，每个解构名各自绑定推断类型）；其它语句形态上不再静默，
  而是报 `nudo:directive-syntax`。
  
  **残留**：无。上一版这里写「LSP agent 面采集内联指令时没有诊断通道 ⇒ 新诊断在 IDE 面不可见」——
  **实测不成立**：`nudo:directive-syntax` 经 `check-issues.ts` 的 `collectEvalReplacements(source, { diags })`
  → `directiveDiagIssues()` 进 `CheckIssue`，由 LSP 编辑面（`validation.ts` 的
  `collectCheckSupplementIssues` → `checkIssueToLspDiagnostic`，warning 级、`source: "nudo-check"`）
  与 agent check 工具（`agent-tools.ts` 的 check 工具）**都会发布**；只有
  `buildLspInjection()`（hover / 补全的注入表装配，不是诊断面）不带 diags 汇。新增回归
  `lsp-bug-080-directive-syntax-ide.test.ts` 钉住：非法载体（表达式语句 / 函数声明）在编辑面与
  推送面各恰好 1 条 `nudo:directive-syntax`（warning、不重复），合法载体（变量声明 / `return`）
  0 条（负控制）。
- 0650ef0: fix(service): 分析器 / 模块图 / 缓存面（BUG-011/012/070/089/101/127/129/139/152/170/171/205/206/207/238/239/240/241/267/268/269/270/273）
  
  模块解析与缓存：
  
  - BUG-238/240 — 裸包 `import` 的 spec 现在携带 `mode` 并解析到真实文件（而非包名占位），模块图边与调用点记录据此建立。
  - BUG-239 — `exports` 条件键按 package.json **声明顺序**求值；`browser` 仅作兜底，不再无条件优先。
  - BUG-267 — pattern 键按 Node `PATTERN_KEY_COMPARE` 取最具体匹配（`./x/*` vs `./x/*.js`）。
  - BUG-268 — 裸包解析在**最近的已存在** `node_modules` 停止；未命中的 `exports` 不再被上层包无声清空为 `exportsUnresolved=false`。
  - BUG-269 — 歧义 `export *` 名称不再导出；导入方得到 `nudo:missing-export`，与 Node 的「模糊即不存在」一致。
  - BUG-270 — `exports` 数组回退只发生在 target **非法**时；合法但文件缺失是终止态（`ERR_MODULE_NOT_FOUND`）。
  - BUG-273 — `esm` 目录导入不再猜测 `index.*`；`legacy main` 保留该行为。
  - BUG-241 — 磁盘缓存键的入口维度带项目根指纹，依赖维度仍可移植（跨项目不再互相污染）。
  - BUG-012 — 函数缓存 `envKeyFn` 补上 `@nudo:env` 内容指纹，与另外两层缓存口径一致。
  
  调用点与报告：
  
  - BUG-070/170/171 — 同名调用点仅在冲突时加列号（`call@L6C9`）；`--from` 目录与重复调用点在合成前去重（先解析再按站点点位去重）。
  - BUG-089 — 仅当本文件在该行列确实存在调用表达式时才附加 `callSiteFile`。
  - BUG-127 — `dedupeCallRecords` 的键纳入调用点身份，不同站点的同名调用不再互相吞并。
  - BUG-205 — 期望值判定统一走共享 `inferenceFailed`，并检查 `term`：`lit(null)` / `lit(undefined)` 是 exact，不是第三种「推断失败」态。
  - BUG-206 — `never` 期望不再走「满足」短路。
  - BUG-207 — 嵌套槽位谓词（`shape({ n: number().gt(0) })`）参与判定并按递归 `formatExpected` 渲染；CLI 报告面改用 service 的 `formatExpected`。
  - BUG-011 — 空调用记录不再解引用 `deduped[0]`。
  - BUG-101 — `isNudoTargetPath` 接受 `.cjs/.mts/.cts`（排除 `.d.mts/.d.cts`），`migrate retire` 的 `nudo check .` 与 `VERIFY_TARGET_EXTS` 对齐。
  - BUG-129 — 空 `--from` 目录报 `nudo:path-empty-dir`。
  - BUG-139 — 静态成员扫描白名单化节点类型，`ClassProperty` 不再被当作方法。
  - BUG-152 — 匿名 `export default class` 注册到 `default` 槽位。
  
  已更新的既有测试（原断言钉住声明的错误行为）：
  
  - `service/src/__tests__/resolve-npm-exports.test.ts` — 数组回退改为「首个合法 target 即终止（即使文件缺失）」。
  - `service/src/__tests__/disk-cache.test.ts` — 入口缓存键带项目身份，依赖键保持可移植。
  - `service/src/__tests__/target-path.test.ts` — `.cjs` 由拒绝改为接受，新增 `.mts/.cts`。
  
  已知未修（根因在本类文件之外，另行跟踪）：BUG-019（行号重映射在 `emit/case-emitter.ts`）、BUG-022（entry 结算重入语义未定）、BUG-045（CJS `module.exports` 成员导出面）、BUG-069（生成比较在 `emit/case-emitter.ts`）、BUG-085（`withAssumePremises` 未从 core 导出）。
  
  ### 追加：本轮分析器面修复
  
  - **BUG-022**：`settleEntryOnlyCandidates` 不再删除注册表条目；记录增长时先摘掉上次合成的 case
    再按**全量**记录重合成 ⇒ 调用点先出现 `f(3)` 与后出现 `f(3)` 得到同一组见证
    （`3 witnesses，call@L5/8/11`）与**逐字节相同**的 `--emit --dry-run` 契约。
    测试：`service-bug-022-callsite-domain-order.test.ts`。
  - **BUG-045**：`tryEvalCallFull` 走 core 的 cjs-member 语义（对 `exports["default"]` 做
    `$invoke`），并在合成调用记录里过滤无位置记录 ⇒ `obj.js`（`module.exports = {…}`）与
    `dot.js`（逐成员导出）在 dts/schema/guard 三面**逐字节一致**（dts 由 `unknown` →
    `number | string`）。测试：`service-bug-045-cjs-object-export-member`、
    `cli-bug-045-cjs-object-export-face`。
  - **BUG-099（递归 / fork 两臂）**：分析器为**整轮**装截断收集器（串到 `eval-run` 的嵌套
    collector，否则单槽会被静默覆盖），标签映射到 `nudo:recursion-truncated` /
    `nudo:fork-truncated`，文案与 `check` 同口径 ⇒ `nudo test` 与 `--json`
    （`summary.diagnostics`）都可见。测试：`service-bug-099-*`、`cli-bug-099-*`。
    循环臂（`nudo:loop-truncated`）此前缺 core 导出，现已补
    `LOOP_TRUNCATION_LABEL`（`@nudojs/core/internal`），接线待做。
  - **BUG-069** 的发射侧（见证等价按「文件 + 实参载荷」）已由 emit 类修复并回归；
    本条**未修的是 CLI `--freeze` 新增模式的坐标**（见 BUG-019）。
  - **BUG-085** 已修：`runAbsView` 现把 `extractAssumeSegs` 的 `ok` 段折进**前提槽**
    （`withAssumePremises`，不是 `phi`），详见 cat-09 changeset。
  - **BUG-099 循环臂已修**：`truncationDiagnostics` 增加 `label === LOOP_TRUNCATION_LABEL`
    分支，且必须排在 `label.startsWith("#")` 兜底**之前**（兜底会把 `#loop-iterations`
    静默吞掉）。`nudo test` / `--json` 现报 `nudo:loop-truncated`，文案与 `check` 面逐字一致
    （「A loop did not terminate within its iteration budget …」），anchor 为文件起点 1:0
    （事件不带函数归属，check 面同样无位置）。回归：
    `service/src/__tests__/service-bug-099-loop-truncated.test.ts`。
    注：loop 迭代预算不在 `@nudo:budget` 覆盖范围内，故建议文案不提该指令。
  
  ### 追加：可见性判据（`gateFatal`）与 `./internal` 快照
  
  - `analyzer-orchestrate.ts` 的 per-file 失败信号判据改为
    `f.reason === "internal" || f.gateFatal === true`（**标签 ≠ 可见性**）：BUG-073 把装载期
    逃逸改标 `module-throw` 后，原判据（只收 `internal`）会让 `evalFailures` 变空 ⇒ 闸门丢掉
    「模块装载失败 ⇒ 不得判绿」（BUG-072）。三条假红防线（`unsupported:*` / 建模内
    `NudoThrow` / 干净文件）不变。
  - `service/eval-run.ts` 的「引擎产出非 Abs 值」回落改传 `origin: "engine"`（引擎自身违约
    ⇒ `internal`，与该 guard 的既有语义一致）。
  - `packages/core/public-api.snapshot.json` 追加 4 个 `./internal` 导出（引擎机件面，语义上
    允许 minor 变动）：`LOOP_TRUNCATION_LABEL`、`extractAssumeSegs`、`isPointConstraint`、
    `widenObservationAbs`，以及类型 `AssumeSeg`；`public-api-freeze` 测试随之复绿。
- fe03e18: fix(service): emit / 接口派生面（BUG-003/021/032/040/041/043/079/107/192/203/214/232/233/266/271/272）
  
  - BUG-214 — 仅当全部用例都是 `callsite` 时，主签名对观测返回值做 `widenObservedReturnAbs`；`entry@` / 指令用例保留嵌套精度（既有 Bug-565 引脚不变）。
  - BUG-232 — `export --out` 下相对 specifier 按 outDir 重写（新增可选 `ExportArtifacts.sourcePath`）；`moduleKey` 仍与路径无关，BUG-016 语义不变。
  - BUG-233 — 导出「阻断」判定对齐 `EXPORT_BLOCKING_CODES`，不再只看 `severity === "error"`。
  - BUG-266 — 派生 `.nudo.ts` 侧车写入前补 builder 声明（TS 侧车），复用 `coreExportNameOf`。
  - BUG-271 — 侧车 builder 可用性按 **core 导出名** 比较（`import { lit }` 不再豁免），必要时生成别名 `_nudo_lit` 与 `declare const … litC`。
  - BUG-272 — draft 的 builder import 扫描改为调用位匹配 `(?<![\w$])b\s*\(`，字段名不再误命中。
  - BUG-192 — 类型注解先前丢弃任何含 `/` 或换行的注解；现折叠换行，仅拒绝真正的注释标记（`//`、`/*`）。
  - BUG-203 — Zod `.min()/.max()` 为码点计数，改为 `refine(s => s.length >= n)` 对齐 UTF-16（guard / standard / contract 一致）。
  - BUG-003（部分）— 类构造器 / 静态参数未受约束时输出 `any`（而非 `unknown`），与 `nudo check` 及 CLAUDE.md 口径一致。
  - BUG-021 — 点观测不再直接成为契约：`widenObservationAbs` 后再 `joinThenProject`；不可表达的联合保留原始投影兜底。
  - BUG-032 — `absToSchemaNodeB` 增加 bigint 分支（`z.bigint()`），并去掉「已丢弃」账目。
  - BUG-040 — draft 选择与 `contract-draft.ts` 守卫均按 **导出名** 比较；`--fn totallyMissing` 仍为用法错误（exit 1，不落盘）。
  - BUG-041 — 派生段 label 改为包根相对（回退 basename），并以 `labelKey()` 统一身份，旧拼写去重而非并集。
  - BUG-043 — 侧车解析错误重新抛出时带侧车路径（原带路径分支为死代码）。
  - BUG-079 — `combinedAbs == null` 的跳过分支改为输出 `(...args: unknown[]): any`，不再整条导出消失。
  - BUG-107 — `declaredParams` 的 `pattern` 分支读取 `FormalParam.optional`；`pattern + 默认值` 渲染为 `_p0?: T`，绑定模式名仍必填。
  
  已更新的既有测试（原断言钉住声明的错误行为）：
  
  - `emit/interface-emitter.test.ts`（BUG-021，2 处）
  - `emit/emit-bug-514-…-dts-export-surface.test.ts`（BUG-003：`constructor(v: unknown)` → `any`）
  - `emit/schema-bug-1046-bigint-literal.test.ts`（BUG-032：观测 bigint 由 `unknown` → `prim bigint`）
  - `emit/schema-bound-anchor.test.ts`（2 处）、`emit/schema-generator.test.ts`（1 处）（BUG-203）
  
  未修：
  - BUG-196 —— 本夹具不再复现，但**当时不是真修**：`bar` 因 BUG-041 的 label 身份变化被报为 `not_projected`，双写者未消除。**已由后续轮次收口**：CLI / LSP agent 面的根侧车单写者（`finalContent` + `baseContent` + `skipWrite` + `directSections`）见 cat-11 changeset；LSP **add** 面新建段并溯源行常用的 `directCreatedSections` 见 cat-14 changeset（本文件同属 `@nudojs/service` 的发射面）。
  - BUG-035 —— 排除无断言 `@nudo:case` 见证会改变契约产物；5 个既有 emit 测试钉住「指令用例 → 字面量契约」，属产品决策。
  - BUG-168/189/190 —— 需把 `DtsModuleSurface` 贯穿 `computeMainSignature` / `tsParamAnnotation`，并改造 `dtsExportNameOf` 的返回形状（跨切面）。
  - BUG-055/068/074/076/081/093/094/109/119/135/151/197 —— 未开始；其中 BUG-074 的扁平 `export default function` 形态被 `core-bug-435`、`emit-bug-514`、`export-dts-evidence` 钉住。
  
  ## 追加：观测拓宽改为「点域」判据（BUG-021 的收口）
  
  初版 `projectFunctionDsl()` 对**每个** callsite case 无条件拓宽再 join ⇒ 多值
  观测域也被塌成 `number()`（`area(1); area(-2)` 写不出 `union(lit(1), lit(-2))`），
  与 drift 对账面（`core/src/algebra/check-interface-drift.ts`）的域判据分叉 ⇒
  `--emit` 之后 health 恒报漂移（BUG-199）。
  
  现改为**先 join 后判点**：`isPointConstraint`（core，与 drift 共用）为真才拓宽，
  多值观测域保留字面量并集；带断言的 `@nudo:case` 仍一律不拓宽。`widenObservationAbs`
  随之移入 core（`@nudojs/core/internal`），service 内不再保留副本。
  
  ### 追加：本轮发射面修复（13 条）
  
  - **BUG-168**：dts 不再抄不可解析的类型名（`id(x: any)` / `pair(a: any, b: any)`）；可解析的
    本地类补 `declare class`、导入名补 `import type`、`class Box<T>` 保留形参槽。
  - **BUG-189**：一个绑定挂多个导出名全部落地（`export declare function foo` +
    `export { foo as default }`，类同理）。
  - **BUG-190**：`export declare const/let/enum`（含成员与字面量初始化器）；无绑定值留
    `nudo:unresolved-value` 台账，TS2305 归零。
  - **BUG-151**：`class B extends A`、未导出基类补 `declare class`、实例字段（`this.x=…` /
    类属性）落地、继承字段不重复。
  - **BUG-108 / BUG-109**：入参面可选性 = 契约级 ∪ 声明级默认值；rest 槽**恒可选**且只有
    **一层**数组（zod `.optional()`、dts `...rest: any[]`）。
  - **BUG-069**：见证等价改按「**文件** + 实参载荷」复合键 ⇒ 二次 `--freeze` 输出
    `freeze: no changes.`、文件字节不变。
  - **BUG-081**：冲突面带 `conflict` / `undecidable`、行尾 `[unsatisfiable: n]`、stderr 同码
    error、`--json` 同名字段、exit 1；`nudo:interface-undecidable` 保持 warning（能力边界）。
  - **BUG-068**：nullish 回填在同一次改写里补齐 TS 侧车 builder import（含
    `nullable as nb` 别名；JS 侧车不加）。注：缺陷正文里「`interface-draft.ts` BUILDERS 缺
    `nullable`」是**过期信息**。
  - **BUG-198**：已申报的 `@nudo:throws` / `eff.throws` 原样进草稿 DSL；仅门禁算出的「可能抛」
    写成草稿头可照抄提示（不把「可能抛」变成草稿义务）。
  
  ### 追加：BUG-055 / BUG-119 已修，BUG-197 阻塞点已定位到行
  
  - **BUG-055（`--freeze` 把违约见证搬进被调方）**：`insertGeneratedCaseDirectives()` 原先只筛
    「可序列化 + 非手写」，**从不与被写方自己的有效契约比对** ⇒ 调用方的违约被搬进被调方，随后由
    `check-case-scan` 对着被调方报 error 级 `nudo:case-inconsistency`。修：新增
    `contractGuardOf()` / `witnessViolation()`（`emit/case-emitter.ts`），读
    `effectiveInterface(...)` 且**只执法 `source === "handwritten"`**（与 §3.3 同档）；契约位→实参位
    映射与调用点面同规则（`paramNames.indexOf` → `locateContractParam`）；判据与
    `check-case-scan.ts` 的标量通道**同口径**（eq/union 走 `literalMeetsConstraint`；纯 bounds 先
    `isIntFlag` 再按**实例化后** pred 逐原子判；optional 的 `or` 包裹不执法）；**不可判 ⇒ 放行**
    （非字面量、结构/数组/函数域）。违约见证不写入，skip 记新原因 `contract-violation`，归因留在
    调用现场 `nudo:interface-domain-exceeds`。宿主接线（`filePath` / `loadModule` / `autoBind` /
    `projectDir`）由 `shared.ts` 的 `emitWiringOf()` 供给，与 `contractOf` / `checkSource` 同源。
    回归：`service-bug-055-freeze-contract-guard.test.ts`、`cli-bug-055-freeze-contract-guard.test.ts`。
  - **BUG-119（`--freeze=update` 静默删除活着的见证）**：update 链「剥离 → 重算 → 回写」的两层
    缺陷：① `stripGeneratedCaseDirectives` **无条件**剥离 `call@`；② 回写沿用 add 模式的**函数级**
    「有手写 case ⇒ 整函数跳过」⇒ 跨文件见证无法从当前证据重算时（无契约时分析器不合成跨文件
    case）就是净删除且不可恢复，汇总只数「新写出」⇒ 谎报「0 directive(s)」。修：**块级守门**
    （含手写 case 的 JSDoc 块不剥离生成态见证，往返闭合）+ `InsertCaseOptions.rebuildGenerated`
    （重建阶段按**见证身份**逐条重建，手写 case 只挡同名，载荷等价只判生成态之间）+
    `reemitUpdate` 返回 `removedWitnesses`（`netRemovedWitnesses` 按身份配对，行号漂移不算删除），
    CLI 汇总印 `(N directive(s) …, K removed)` 与逐条 `- call@…`。
    回归：`service-bug-119-freeze-update-rebuild.test.ts`、
    `cli-bug-119-freeze-update-keeps-live-witness.test.ts`。
  - **BUG-135 已修**：实际改动在 LSP 侧（`a6-relax.ts` / `server-code-actions.ts`），见 cat-14
    changeset（relax 改「真写推断面」+ 落盘后验证门；CLI 文案在行为修好后为真，未改口径）。
  
  仍未修 / 阻塞（根因在禁改文件或需产品裁决）：
  
  - **BUG-035**：`projectFunctionDsl()` 把 `@nudo:case` 调试见证投影成契约；emit 测试目录里 5 处
    pin 了当前行为，改口径必须重钉 ⇒ 需产品裁决。
  - **BUG-197 已修**：见 cat-02 changeset —— `arityFace` 接受契约可选位，本地与跨文件共用
    `contractOptionalIndexes` 映射（位次与 `interfaceToIndexed` 同一套，只对 `handwritten` 生效），
    `nudo:arg-count` 不再对契约 `.optional()` 的省略实参报红，且不会出现「同文件绿 / 跨文件红」。
  - **BUG-076**：`any` 是既定口径（`docs/concepts/abs.md`、CLAUDE.md），真问题是文档表述
    （`docs/**` 本轮未改）。
  
  ### 追加：6 处 schema 期望按 BUG-093 重钉（不是放宽）
  
  BUG-093 的声明正确行为 = 数值谓词面必须接受 `±Infinity`（`schema-generator.ts:704-705`
  「`satisfies(Infinity)` ⇒ `.or(z.literal(Infinity))`」，`-Infinity` 同理），否则导出的 zod
  schema 会拒绝 Abs 域里合法的值。`schema-generator.test.ts`（5 处）与
  `schema-bound-anchor.test.ts`（1 处）钉的是加臂之前的字符串：
  
  - `gt(0)` / `gte(0)` → `….or(z.literal(Infinity))`（含对象槽内与默认 dialect / module 面）
  - `lte(100)` / `lt(5)` → `….or(z.literal(-Infinity))`
  
  行为断言（`WIDE_NUMBER` 的 NaN/±Infinity 三臂、`int().gte(0)` 等）原样保留。
  
  ### BUG-035：`@nudo:case` 的调试见证不再被写成契约（`nudo contract --emit`）
  
  **根因**：`packages/service/src/emit/interface-emitter.ts` 的 `projectFunctionDsl()` 把
  `source === "directive"` 的指令 case 与 `source === "callsite"` 的调用点证据**平权**
  当域来源 / 返回义务来源 ⇒ 纯点观测见证被投影成契约（`fn({ x: lit(5) }, lit(6))`），
  与 `nudo check` 的 `f(x: any) => number | string` 自相矛盾：用户为调试加一条
  `@nudo:case` 就把函数固化成「只接受那个点、只返回那个值」。
  
  **修法**：指令来源**内部**再分档（新增 `emit/domain-cases.ts` 的
  `isDomainDeclarationCase()` / `isPointObservationArgs()`，判据与 analyzer 侧
  `isPointObservationArgs` 同源）——
  - **域声明**：实参是约束构建器（`number()` / `shape()` / `union()` … 的域形状）**或**
    带断言（`=> expected`）⇒ 可作域来源与返回义务来源；
  - **纯点观测见证**（实参全是字面量且无断言）⇒ **不生成域、不生成返回义务**。
  
  **口径变化**：`directive` 纯见证不再产出契约（改前：`fn({ x: lit(5) }, lit(6))`；
  改后：无证据 ⇒ `skipped … (not-projectable)`，不写侧车）。`callsite` 优先、
  BUG-021 观测拓宽、域形状 `number()` 的 `not-projectable` 口径**均不变**；
  `domainEvidenceCases()`（dts / zod / standard / guard 面）语义不变。
  
  **重钉清单**（原断言钉住「指令用例 → 字面量契约」的错误行为；夹具改为**带断言的域声明**，
  断言文本未动）：`emit-bug-523-section-order.test.ts`（2 处）、
  `emit-bug-532-value-template-clash.test.ts`（1 处）、`emit-bug-540-crlf-byte-fidelity.test.ts`
  （1 处）、`emit-bug-548-import-name-clash.test.ts`（1 处）。
  新增回归：`emit/__tests__/emit-bug-035-case-witness-not-contract.test.ts`（三种 case 形态 +
  「有调用点证据时见证不得污染返回义务」+ 分档判据）。
  
  **残留边界**：既有侧车里由见证生成的旧生成段，在 update 模式下按「证据消失 ⇒ 删除该生成段」
  处理（见下文「BUG-035 残留收口」）；宽域 / `derived-from:` 段 / `@nudo:skip` 段仍按原策略保留。
  `contract --draft` 面本就不投影见证的返回义务（`projected: false`），无需改动。
  
  ### BUG-076：`nudo export --format dts` 的「无证据参数」口径统一为 `any`（文档侧修正 + 回归锁定）
  
  **判定**：`BUG-076` 的 section 结论 —— 代码侧「未取证参数渲染 `any`」是**有意为之**的产品口径
  （`docs/concepts/abs.md`：入口无约束 = `any`，不因缺证据改用 `unknown`），真正错的是仍在承诺
  「`unknown` + stderr 点名提示」的两处文档。故本条按**文档侧**收口，零行为变更。
  
  **改动**：
  - `docs/design/cli-semantics.md` §2「已记录例外（export 投影面）」改为 `any` 口径，并说明只有
    真正推导失败才出现 `unknown`（由 `nudo:unknown-inference` 之类引擎债诊断标注）。
  - `packages/website/docs/guides/export-ecosystem.md:114/185` 与 zh-Hans 镜像同步改为 `any`，
    删除「`export --format dts` 会打 stderr 提示」的承诺。
  - 新增 `cli-bug-076-unevidenced-any.test.ts`（3 例）：主路径无证据形参 ⇒ `any` 且 stderr 无提示；
    契约只覆盖部分形参 ⇒ 未覆盖位仍 `any`；窄路径（`@nudo:skip` + 手写契约未覆盖位）⇒
    `unknown` + `note: <fn>.<param> rendered as unknown …`（两条路径都实测可达 ⇒
    `reportUnevidencedParams` **不是**死代码，只是只在窄路径出现）。
  - `helpers/run-cli.ts` 新增 `writeSrcTsconfig()`：CLI 子进程按 cwd 找 tsconfig，否则会落到共享
    `dist/` 旧构建（测试钉源码语义的前提）。
  
  ### 重钉：BUG-021（调用点点观测拓宽）
  
  调用点**点观测**不再直接成为字面量契约 —— 先 `widenObservationAbs` 再 `joinThenProject`
  ⇒ 一次 `alpha({ x: 5 })` 折出 `shape({ x: number() })`、返回 `5` 折出 `number()`。据此重钉：
  
  - `packages/nudojs/src/__tests__/cli-bug-657-emit-fn-unmatched.test.ts`
    「对照组：名字正确 ⇒ 只改那一个」的断言由
    `toContain("+export const alpha = fn({ p: shape({ x: lit(5) }) }, lit(5));")` 改为
    `toContain("+export const alpha = fn({ p: shape({ x: number() }) }, number());")`。
    「只改 alpha、beta 不出现 `-`/`+`」与同文件「全部未命中 ⇒ 用法错误 + 侧车逐字不变」
    「连 dry-run 预览都不给」「部分命中 ⇒ `skipped nope (not-an-export)`」三组断言**未改动**。
  
  ### BUG-035 残留收口：证据消失 ⇒ 旧生成段被删（不再「保留原段」）
  
  **根因**：`emitInterface` 的 update 分支把「**不可投影**」一律当成「今天没有证据 ⇒ 把落盘的段原样保留」。
  BUG-035 之后 `@nudo:case` 见证不再进契约 ⇒ 由见证写出的旧段（`fn({ x: lit(5) }, lit(6))`）却因此
  **永久留在侧车里**，与 `nudo check` 的结论（`f(x: any) => number | string`）长期矛盾。
  
  **修法**（`packages/service/src/emit/section-provenance.ts` 新增，`interface-emitter.ts` 接线）：
  落盘的 `@generated` 段在**两个条件同时成立**时被删除 ——
  ① 当前投影**确实无证据**（无调用点、无域声明 case、无 entry 推断、且非 `@nudo:skip`；
     「有证据但表达不出来」不算无证据 ⇒ 保留）；
  ② 该段的证据**可证明来自本文件**（无 `// derived-from:` 标签，且某个顶层槽钉住了单个字面量 ——
     今天的发射器会把调用点点观测拓宽（BUG-021），故单字面量域只可能来自本文件的域声明 / `entry@`）。
  删除沿用既有「死段」路径（整段 + 尾随换行），填充 `EmitInterfaceResult.removed`，
  发一条 info `nudo:interface-not-projectable`（「evidence disappeared — dropping its generated section…」），
  人类面 `formatEmitSummary` 增一行 `removed: <names>`，机器面（`nudo contract --emit --json`）
  增 `removed` 字段。
  
  **重钉**：无（既有断言一条未动；`interface-emitter.test.ts` 的「update 无证据保留原段」用例
  其段是宽域 ⇒ 不满足「可证明来自本文件」⇒ 原样通过）。
  
  **残留**：① 宽域且来自本文件调用点的段，调用点消失后仍保留 —— **已收口**（见下
     「BUG-035 证据范围收口」：生成段记 `// evidence: local|external`，宽域段也能判定）；
     ② BUG-021 之前的旧侧车，点字面量 `--from` 段与见证段不可区分，可能被删
     （`--dry-run` 可先预览）；③ 只看顶层槽 ⇒ `shape({ x: lit(1) })` 形态的**旧**段保守保留
     （现格式下由 `// evidence:` 判定，不再受此限）；④ 带 `// derived-from:` 标签的段保留。
  
  ### 追加：BUG-035 证据范围收口 —— 生成段记录 `// evidence:`，宽域段也能判定刷新
  
  **症状（上一轮收口后仍留的最后一条边界）**：删除陈旧段的判据只能「证明」**单点字面量**域的
  证据在文件内（今天的发射模型把调用点观测拓宽，单点字面量只可能来自文件内 case/entry）。
  **调用点来源的宽域段**（`fn({ x: number() }, number())`）与「`--from` 采集的使用现场记录来源段」
  **逐字同形** ⇒ 调用点被删后宽域段只能保守留存（侧车继续承诺今天已不存在的域，与 `nudo check`
  签名面矛盾）；反过来盲删又会丢掉 `--from` 段的用户契约。
  
  **修法（侧车格式变更）**：
  - `FunctionAnalysis.externalEvidence`（`analyzer-orchestrate-uncached.ts` 的合成路径）：本函数的
    callsite 证据是否混入 `--from` 外部记录。判据取**去重前**的匹配集 ⇒ 保守方向永远是「少删」；
    该字段是纯增量（`cloneFunctionAnalysis` 走浅展开，缓存回放不丢）。
  - 生成段由三行变**四行**：`@generated` / `// source:` / `// evidence: local|external` / export
    （`interface-emitter.ts` 的 `sectionText`；`roundTrip` 自检同文本，故自检与写盘同源）。
  - `section-provenance.ts`：新增 `sectionEvidenceScope()`；`sectionEvidenceIsInFile()` 改为
    「无 `derived-from` 标签 **且**（`local` 标记 **或** 旧侧车无标记时的单点字面量启发式）」。
    ⇒ `local` 宽域段在「今天没有证据」时可证「证据没了」⇒ 删段；`external` 段与旧侧车宽域段
    继续保留。旧侧车（无 `// evidence:` 行）行为**完全不变**；旧段在因内容变化被重写时自动带上标记。
  - 标记是**确定性函数**（证据范围只取决于本轮是否用了外部记录）⇒ 二次发射逐字节相同。
  
  **重钉（2 处，均为「当轮格式」更新，断言文本一条未动）**：
  - `service/src/emit/__tests__/emit-bug-523-section-order.test.ts` 的 `SIDECAR` 夹具
    （注释即「首次 emit 生成的形态」）补 `// evidence: local` —— 该文件钉的是**段序不重排 /
    无改动**，不是段的行数。
  - `lsp/src/__tests__/lsp-bug-196-single-writer-sidecar.test.ts` 的 `SIDECAR_CONVERGED`
    补 `// evidence: local` —— 该文件钉的是 add/update **逐字节收敛**，格式变更后收敛态随之更新。
  
  **新回归**：`emit/__tests__/emit-bug-035-evidence-scope.test.ts`（7 例）—— ① 宽域 `local` 段
  在调用点消失后被删（+ `removed` 台账 + info 诊断）；② `--from` 外部记录来源段带 `external`
  标记、证据缺失时留存且逐字节不变；③ 旧侧车宽域段留存（迁移期零回归）；④ 旧侧车单点字面量段
  仍按旧启发式删除；⑤ `derived-from` 段即使带 `local` 标记也留存；⑥ 标记确定性/幂等；
  ⑦ 本地与外部记录混合 ⇒ `external`（保守方向）。
  
  **文档**：`packages/website/docs/guides/contract.md` 与 zh-Hans 镜像的侧车示例与 dry-run diff
  示例补 `// evidence: local`（该行是两版之间的**上下文行**，hunk 头不变）。
- 9ff1709: Fix bug-report category 14 (LSP IDE surface) — BUG-140.
  
  - BUG-140: `nudo:internal` (analysis failed ⇒ the gate cannot decide the file) is now
    published on the LSP diagnostic face too, so the IDE no longer shows a file that the
    CLI rejects with exit 1 as completely clean. The diagnostic is emitted from the shared
    analysis path, so every consumer (CLI, LSP, vite-plugin) sees the same source, and the
    CLI's own `nudo:internal` output is unchanged (no duplicate).
  
  The service-side emit of the diagnostic landed with the vite-plugin category commit
  (`packages/service/src/analyzer-orchestrate.ts`); this changeset covers the LSP-facing
  behaviour and its regression test.
  
  Regression test: `lsp-bug-140-internal-diagnostic.test.ts`.
  
  ### 追加：本轮 IDE / CLI 面修复
  
  `tmp/verify-bug.sh` 直接验证（exit 1 = 不再复现）：BUG-185、BUG-186、BUG-187、BUG-188、
  BUG-201、BUG-202、BUG-227、BUG-235、BUG-236、BUG-237、BUG-262、BUG-263、BUG-274。
  带新回归测试：BUG-024、BUG-034、BUG-071、BUG-090、BUG-091、BUG-104、BUG-105、BUG-133、
  BUG-134、BUG-136、BUG-146、BUG-014、BUG-019、BUG-044、BUG-074（16 个新测试文件 / 44 例）。
  
  口径变更（不是放宽断言）：
  
  - **BUG-133**：数值 case 只改 `u` 自己的槽位并能清掉诊断；**shape 形参**那组 fixture
    改为**撤回**该 action —— 唯一可用的文本改写会命中返回槽，且可证明无法清除诊断，
    与其改错槽位，不如不给这个 action。
  - **BUG-019 残留（语义未变）**：首次 `--freeze`（新增模式）写出的见证名仍是插入前
    坐标；`--freeze=update` 是修复路径（现已按最终文件坐标重算、保留已正确项、幂等）。
  
  未修复（同一子系统，已定位）：
  
  - **BUG-247 inlay 侧**：`packages/core/src/algebra/inlay.ts:304` 的 `generalizeFromAst`
    跑在 invariant 公理播种之外，`@nudo:invariant` 对 inlay 文本无效（公理与对照都打印
    `: number`）。播种入口 `invariantSpecsOf` / `assumePremisesPhiOf` 私有于
    `core/algebra/check.ts:672,831`，`withInvariantSpecs` 在
    `core/algebra/exec/runtime/state.ts:134` 且未从 `core/index.ts` / `core/internal.ts`
    导出。hover 侧已修（`=> 0 | number`）。
  - **BUG-140 回归测试重基线**：`const x = undefinedGlobalAtTopLevel` 在 BUG-073 之后归
    类为 `module-throw`（不再走 `internal` 回落），测试改为断言「错误级诊断必须发布」
    的同一契约（细节见 cat-03 追加）。
  
  既有测试更新（均为口径跟随，未删断言）：`lsp-bug-463-484-signature-param-names`
  （detail 改为 BUG-091 声明的格式、签名标签解析出真实返回类型）、
  `lsp-bug-711-nested-call-signature`（标签 `unknown` → 推断出的真实返回）、
  `cli-bug-63b-path-errors-face`（干净 `test --json` 基线新增 BUG-014 要求的
  `"errors": 0` / `"ok": true`）。
  
  ### 追加：三条回归的收口（env 诊断去重、调用点插入位、两条负控重钉）
  
  - `validation.ts`：`checkToLspDiagnostics` 里 `collectCheckSupplementIssues` 会把 service 的
    `envUnresolvedIssues` 也发一遍，而 editor 面**已有**专属 env 通道（`validateText` 与 pull
    两处显式调 `envUnresolvedDiags`）⇒ 同一事实两条通道各发一次（**重复诊断** 1 → 2 条）；
    且 check 通道那份对「按名字记录」的条目（`e.path` 是名字本身、非绝对路径）**不按本文件
    env 名单过滤** ⇒ 同目录别的文件的无 path 诊断被**误吸**。修：check 通道跳过
    `DIAG.envUnresolved`，事实归属交给 live 通道（它按本文件 env 名单/路径双向收窄，且缓存
    命中轮仍发布）。解锁 `env-unresolved-diag`（4 条）与 `lsp-bug-470-937` 第 2 条。
  - `server-code-actions.ts`：BUG-263 的形参身份把「形参位实参不是对象字面量」一律判为不可
    插入，而该实参若是**原始值字面量**（string/number/bool/null/bigint/template），运行时**不
    可能**是对象 ⇒ 形参身份自相矛盾、回落「唯一对象字面量实参」口径（多个仍不猜；表达式仍
    不下发，保住「绝不猜位置」）。解锁 `lsp-bug-737`（2 条）。
  - 两条 signatureHelp **负控**钉的 `(a: any, b: any) => unknown` 正是 **BUG-104** 判红的症状
    （声明空壳 label 与同面 hover / CLI 互斥）；空壳不采纳后给精确签名
    `(a: any, b: any) => number | string`（`a + b` 两侧 `any` ⇒ JS `+` 的 ToPrimitive 并集）
    ⇒ 按 BUG-104 声明的正确行为重钉 label，`parameters` 长度/参数名断言原样保留。
  
  ### 追加：BUG-135 与 BUG-247 收口（relax 真写推断面；inlay 内部 id 不外泄）
  
  - **BUG-135**：动作标题与 CLI 机器面都承诺「放宽到**推断面**」，但唯一实现只做
    `stripNumericPreds` ⇒ 落盘 `number()`（基类型），既不是推断面、也**消不掉**诊断
    （`any ⊭ number()`），且没有落盘后验证门。修：`lsp/src/a6-relax.ts` 新增
    `relaxSidecarReturnToSurface()`（把 `fn(…, <返回槽>)` 的**第二个顶层实参**整体改写为给定推断面
    文本，含括号 / 字符串 / 注释感知的实参切分）；`server-code-actions.ts` 取 **check 同源**推断面
    （`checkSource` → `NudoSig.abs`，与 CLI 签名行 / hover 同源）渲染为侧车文本（精确投影 ⇒
    `lit(0)` / `number().gt(40)` / `union(lit…)`；`any` ⇒ `any()`；widened/partial prim ⇒ 基类型），
    并加**落盘后验证门**（`sidecarRelaxClearsTarget` 增 `codes` 参数，重跑 check；诊断残留或界面
    装载失败 ⇒ **不下发**，与 BUG-134「不给消不掉诊断的假修复」同例）。
  - **BUG-247（inlay 侧）**：`entrySeedsOfFn` 的播种本身是对的（inlay 已随 `@nudo:invariant` 变
    `0 | number`）；残留真缺陷在**渲染**——`invariant-apply.ts` 铸造的内部 id `inv#N` 只在成员
    顶层 `var` 处被拦，循环值参与算术时（`inv#2 + 1` 是 **app** 项）漏网 ⇒ IDE 印
    `: inv#2 + 1 | NaN`，而 check / hover 印 `number | NaN`（内部 id 上屏 + 两面互斥）。修：
    `core/algebra/inlay.ts` 新增 `hasInternalInvId()` 走**整棵 term 树**，命中即退形状
    （`formatShape`），与 check 面同一位置渲染同源。回归含**真 LSP server** 的 hover / inlay 逐字对拍。
  
  ### 追加：BUG-196（add 面）—— add 模式新建的直写段也要带 `// derived-from:` 溯源行
  
  **症状**：`nudo.contract.emit` 的 **add** 模式下，本轮直写分支新建的段**永远不带**溯源行。
  根因是两步顺序的合成：① 直写分支（dry-run）把新段追加进基底 D；② 派生分支以 D 为基底时
  `findGeneratedSectionText` 在 D 里找到了这个**刚建的**段 ⇒ 命中 add 面「既有段不可动 ⇒
  `no-change`」跳过 ⇒ 标签行被丢弃。后果：add 面与 update 面对同一份输入收敛出不同字节，
  且下游「靠 `derived-from` 反查根」失去锚点。
  
  **修法**（不改 add 面「既有内容不动」的契约，只区分「本轮新建」与「此前既有」）：
  - `packages/service/src/emit/interface-derivation-emit.ts`：`emitDerivedFromRoot` 新增可选
    `directCreatedSections`（= **本轮**直写分支新建的段名）。add 面只在
    「直写负责（`directSections`）+ 本轮新建（`directCreatedSections`）」时允许把标签行并进去；
    此前既有的段仍走原 `no-change` 跳过。合并后与既有段逐字相同 ⇒ 仍按 `no-change`（不空转 rewrite）。
  - 组装面：这类段**已在基底里** ⇒ add 面必须**就地替换**（新增 `replaceSectionsInPlace()`，
    段边界同 `collectGeneratedSectionsRaw`：`@generated` 头 → export 语句末，段外字节与段序逐字保留）；
    旧实现只做「追加」，会把同一导出名写成两段（非法 ESM ⇒ 整份侧车装载失败）。既有新段的追加路径不变。
  - `packages/lsp/src/agent-tools.ts`：`serializedEmit` 在 `mode === "add"` 时传
    `directCreatedSections: new Set(direct.written)`（add 面 `written` 恰好 = 本轮新建段；update 面
    无此语义，不传）。CLI 不受影响（`contract-emit.ts` 的派生分支恒为 `mode: "update"`）。
  
  **回归**：`lsp-bug-196-single-writer-sidecar.test.ts` 的 add 用例扩为断言
  「直写正文 + `// derived-from: lib.js:tag` + 同一段只有一份 + 收敛态逐字节（与 update 面相同）+
  根侧车只写一次」；新增 add 幂等用例（第二跑逐字不变、不写盘、不报 `Updated`）。
- 37e9aa0: Fix bug-report category 17 (vite-plugin gate surface).
  
  - BUG-110: the plugin's report face and gate face agree on `ignoreThrows`, so the same
    project no longer yields contradictory verdicts between the two faces.
  - BUG-111: project-level env is resolved from the project root rather than the importing
    file's directory, and env-module exports are merged with `mergeHarvestUnderEnv` instead
    of object spread — so adding an unrelated `@nudo:env` line no longer flips the gate from
    green to red, and harvest-only exports are no longer dropped.
  - BUG-221: project-level env resolves against the project base dir, so the plugin gate
    matches the evaluator.
  - BUG-222: a project-level env load failure is no longer silent in the plugin; it reports
    `nudo:env-unresolved` like the CLI and LSP instead of a false green.
  
  Regression tests: `vite-bug-110-*`, `vite-bug-111-*`, `vite-bug-221-*`, `vite-bug-222-*`.
  
  Note: BUG-140 (listed in this category file but whose defect is the LSP diagnostic face
  missing `nudo:internal`) is NOT covered here; it belongs to category 14.
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [206713f]
- Updated dependencies [0650ef0]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
- Updated dependencies [afd7c36]
- Updated dependencies [7231e87]
  - @nudojs/core@1.17.2
  - @nudojs/parser@1.5.6
  - @nudojs/env@0.5.6
  - @nudojs/harvester@0.4.6

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.7.3 {#pkg-nudojs}

## 1.7.3

### Patch Changes

- 0650ef0: fix(service): 分析器 / 模块图 / 缓存面（BUG-011/012/070/089/101/127/129/139/152/170/171/205/206/207/238/239/240/241/267/268/269/270/273）
  
  模块解析与缓存：
  
  - BUG-238/240 — 裸包 `import` 的 spec 现在携带 `mode` 并解析到真实文件（而非包名占位），模块图边与调用点记录据此建立。
  - BUG-239 — `exports` 条件键按 package.json **声明顺序**求值；`browser` 仅作兜底，不再无条件优先。
  - BUG-267 — pattern 键按 Node `PATTERN_KEY_COMPARE` 取最具体匹配（`./x/*` vs `./x/*.js`）。
  - BUG-268 — 裸包解析在**最近的已存在** `node_modules` 停止；未命中的 `exports` 不再被上层包无声清空为 `exportsUnresolved=false`。
  - BUG-269 — 歧义 `export *` 名称不再导出；导入方得到 `nudo:missing-export`，与 Node 的「模糊即不存在」一致。
  - BUG-270 — `exports` 数组回退只发生在 target **非法**时；合法但文件缺失是终止态（`ERR_MODULE_NOT_FOUND`）。
  - BUG-273 — `esm` 目录导入不再猜测 `index.*`；`legacy main` 保留该行为。
  - BUG-241 — 磁盘缓存键的入口维度带项目根指纹，依赖维度仍可移植（跨项目不再互相污染）。
  - BUG-012 — 函数缓存 `envKeyFn` 补上 `@nudo:env` 内容指纹，与另外两层缓存口径一致。
  
  调用点与报告：
  
  - BUG-070/170/171 — 同名调用点仅在冲突时加列号（`call@L6C9`）；`--from` 目录与重复调用点在合成前去重（先解析再按站点点位去重）。
  - BUG-089 — 仅当本文件在该行列确实存在调用表达式时才附加 `callSiteFile`。
  - BUG-127 — `dedupeCallRecords` 的键纳入调用点身份，不同站点的同名调用不再互相吞并。
  - BUG-205 — 期望值判定统一走共享 `inferenceFailed`，并检查 `term`：`lit(null)` / `lit(undefined)` 是 exact，不是第三种「推断失败」态。
  - BUG-206 — `never` 期望不再走「满足」短路。
  - BUG-207 — 嵌套槽位谓词（`shape({ n: number().gt(0) })`）参与判定并按递归 `formatExpected` 渲染；CLI 报告面改用 service 的 `formatExpected`。
  - BUG-011 — 空调用记录不再解引用 `deduped[0]`。
  - BUG-101 — `isNudoTargetPath` 接受 `.cjs/.mts/.cts`（排除 `.d.mts/.d.cts`），`migrate retire` 的 `nudo check .` 与 `VERIFY_TARGET_EXTS` 对齐。
  - BUG-129 — 空 `--from` 目录报 `nudo:path-empty-dir`。
  - BUG-139 — 静态成员扫描白名单化节点类型，`ClassProperty` 不再被当作方法。
  - BUG-152 — 匿名 `export default class` 注册到 `default` 槽位。
  
  已更新的既有测试（原断言钉住声明的错误行为）：
  
  - `service/src/__tests__/resolve-npm-exports.test.ts` — 数组回退改为「首个合法 target 即终止（即使文件缺失）」。
  - `service/src/__tests__/disk-cache.test.ts` — 入口缓存键带项目身份，依赖键保持可移植。
  - `service/src/__tests__/target-path.test.ts` — `.cjs` 由拒绝改为接受，新增 `.mts/.cts`。
  
  已知未修（根因在本类文件之外，另行跟踪）：BUG-019（行号重映射在 `emit/case-emitter.ts`）、BUG-022（entry 结算重入语义未定）、BUG-045（CJS `module.exports` 成员导出面）、BUG-069（生成比较在 `emit/case-emitter.ts`）、BUG-085（`withAssumePremises` 未从 core 导出）。
  
  ### 追加：本轮分析器面修复
  
  - **BUG-022**：`settleEntryOnlyCandidates` 不再删除注册表条目；记录增长时先摘掉上次合成的 case
    再按**全量**记录重合成 ⇒ 调用点先出现 `f(3)` 与后出现 `f(3)` 得到同一组见证
    （`3 witnesses，call@L5/8/11`）与**逐字节相同**的 `--emit --dry-run` 契约。
    测试：`service-bug-022-callsite-domain-order.test.ts`。
  - **BUG-045**：`tryEvalCallFull` 走 core 的 cjs-member 语义（对 `exports["default"]` 做
    `$invoke`），并在合成调用记录里过滤无位置记录 ⇒ `obj.js`（`module.exports = {…}`）与
    `dot.js`（逐成员导出）在 dts/schema/guard 三面**逐字节一致**（dts 由 `unknown` →
    `number | string`）。测试：`service-bug-045-cjs-object-export-member`、
    `cli-bug-045-cjs-object-export-face`。
  - **BUG-099（递归 / fork 两臂）**：分析器为**整轮**装截断收集器（串到 `eval-run` 的嵌套
    collector，否则单槽会被静默覆盖），标签映射到 `nudo:recursion-truncated` /
    `nudo:fork-truncated`，文案与 `check` 同口径 ⇒ `nudo test` 与 `--json`
    （`summary.diagnostics`）都可见。测试：`service-bug-099-*`、`cli-bug-099-*`。
    循环臂（`nudo:loop-truncated`）此前缺 core 导出，现已补
    `LOOP_TRUNCATION_LABEL`（`@nudojs/core/internal`），接线待做。
  - **BUG-069** 的发射侧（见证等价按「文件 + 实参载荷」）已由 emit 类修复并回归；
    本条**未修的是 CLI `--freeze` 新增模式的坐标**（见 BUG-019）。
  - **BUG-085** 已修：`runAbsView` 现把 `extractAssumeSegs` 的 `ok` 段折进**前提槽**
    （`withAssumePremises`，不是 `phi`），详见 cat-09 changeset。
  - **BUG-099 循环臂已修**：`truncationDiagnostics` 增加 `label === LOOP_TRUNCATION_LABEL`
    分支，且必须排在 `label.startsWith("#")` 兜底**之前**（兜底会把 `#loop-iterations`
    静默吞掉）。`nudo test` / `--json` 现报 `nudo:loop-truncated`，文案与 `check` 面逐字一致
    （「A loop did not terminate within its iteration budget …」），anchor 为文件起点 1:0
    （事件不带函数归属，check 面同样无位置）。回归：
    `service/src/__tests__/service-bug-099-loop-truncated.test.ts`。
    注：loop 迭代预算不在 `@nudo:budget` 覆盖范围内，故建议文案不提该指令。
  
  ### 追加：可见性判据（`gateFatal`）与 `./internal` 快照
  
  - `analyzer-orchestrate.ts` 的 per-file 失败信号判据改为
    `f.reason === "internal" || f.gateFatal === true`（**标签 ≠ 可见性**）：BUG-073 把装载期
    逃逸改标 `module-throw` 后，原判据（只收 `internal`）会让 `evalFailures` 变空 ⇒ 闸门丢掉
    「模块装载失败 ⇒ 不得判绿」（BUG-072）。三条假红防线（`unsupported:*` / 建模内
    `NudoThrow` / 干净文件）不变。
  - `service/eval-run.ts` 的「引擎产出非 Abs 值」回落改传 `origin: "engine"`（引擎自身违约
    ⇒ `internal`，与该 guard 的既有语义一致）。
  - `packages/core/public-api.snapshot.json` 追加 4 个 `./internal` 导出（引擎机件面，语义上
    允许 minor 变动）：`LOOP_TRUNCATION_LABEL`、`extractAssumeSegs`、`isPointConstraint`、
    `widenObservationAbs`，以及类型 `AssumeSeg`；`public-api-freeze` 测试随之复绿。
- fe03e18: fix(service): emit / 接口派生面（BUG-003/021/032/040/041/043/079/107/192/203/214/232/233/266/271/272）
  
  - BUG-214 — 仅当全部用例都是 `callsite` 时，主签名对观测返回值做 `widenObservedReturnAbs`；`entry@` / 指令用例保留嵌套精度（既有 Bug-565 引脚不变）。
  - BUG-232 — `export --out` 下相对 specifier 按 outDir 重写（新增可选 `ExportArtifacts.sourcePath`）；`moduleKey` 仍与路径无关，BUG-016 语义不变。
  - BUG-233 — 导出「阻断」判定对齐 `EXPORT_BLOCKING_CODES`，不再只看 `severity === "error"`。
  - BUG-266 — 派生 `.nudo.ts` 侧车写入前补 builder 声明（TS 侧车），复用 `coreExportNameOf`。
  - BUG-271 — 侧车 builder 可用性按 **core 导出名** 比较（`import { lit }` 不再豁免），必要时生成别名 `_nudo_lit` 与 `declare const … litC`。
  - BUG-272 — draft 的 builder import 扫描改为调用位匹配 `(?<![\w$])b\s*\(`，字段名不再误命中。
  - BUG-192 — 类型注解先前丢弃任何含 `/` 或换行的注解；现折叠换行，仅拒绝真正的注释标记（`//`、`/*`）。
  - BUG-203 — Zod `.min()/.max()` 为码点计数，改为 `refine(s => s.length >= n)` 对齐 UTF-16（guard / standard / contract 一致）。
  - BUG-003（部分）— 类构造器 / 静态参数未受约束时输出 `any`（而非 `unknown`），与 `nudo check` 及 CLAUDE.md 口径一致。
  - BUG-021 — 点观测不再直接成为契约：`widenObservationAbs` 后再 `joinThenProject`；不可表达的联合保留原始投影兜底。
  - BUG-032 — `absToSchemaNodeB` 增加 bigint 分支（`z.bigint()`），并去掉「已丢弃」账目。
  - BUG-040 — draft 选择与 `contract-draft.ts` 守卫均按 **导出名** 比较；`--fn totallyMissing` 仍为用法错误（exit 1，不落盘）。
  - BUG-041 — 派生段 label 改为包根相对（回退 basename），并以 `labelKey()` 统一身份，旧拼写去重而非并集。
  - BUG-043 — 侧车解析错误重新抛出时带侧车路径（原带路径分支为死代码）。
  - BUG-079 — `combinedAbs == null` 的跳过分支改为输出 `(...args: unknown[]): any`，不再整条导出消失。
  - BUG-107 — `declaredParams` 的 `pattern` 分支读取 `FormalParam.optional`；`pattern + 默认值` 渲染为 `_p0?: T`，绑定模式名仍必填。
  
  已更新的既有测试（原断言钉住声明的错误行为）：
  
  - `emit/interface-emitter.test.ts`（BUG-021，2 处）
  - `emit/emit-bug-514-…-dts-export-surface.test.ts`（BUG-003：`constructor(v: unknown)` → `any`）
  - `emit/schema-bug-1046-bigint-literal.test.ts`（BUG-032：观测 bigint 由 `unknown` → `prim bigint`）
  - `emit/schema-bound-anchor.test.ts`（2 处）、`emit/schema-generator.test.ts`（1 处）（BUG-203）
  
  未修：
  - BUG-196 —— 本夹具不再复现，但**当时不是真修**：`bar` 因 BUG-041 的 label 身份变化被报为 `not_projected`，双写者未消除。**已由后续轮次收口**：CLI / LSP agent 面的根侧车单写者（`finalContent` + `baseContent` + `skipWrite` + `directSections`）见 cat-11 changeset；LSP **add** 面新建段并溯源行常用的 `directCreatedSections` 见 cat-14 changeset（本文件同属 `@nudojs/service` 的发射面）。
  - BUG-035 —— 排除无断言 `@nudo:case` 见证会改变契约产物；5 个既有 emit 测试钉住「指令用例 → 字面量契约」，属产品决策。
  - BUG-168/189/190 —— 需把 `DtsModuleSurface` 贯穿 `computeMainSignature` / `tsParamAnnotation`，并改造 `dtsExportNameOf` 的返回形状（跨切面）。
  - BUG-055/068/074/076/081/093/094/109/119/135/151/197 —— 未开始；其中 BUG-074 的扁平 `export default function` 形态被 `core-bug-435`、`emit-bug-514`、`export-dts-evidence` 钉住。
  
  ## 追加：观测拓宽改为「点域」判据（BUG-021 的收口）
  
  初版 `projectFunctionDsl()` 对**每个** callsite case 无条件拓宽再 join ⇒ 多值
  观测域也被塌成 `number()`（`area(1); area(-2)` 写不出 `union(lit(1), lit(-2))`），
  与 drift 对账面（`core/src/algebra/check-interface-drift.ts`）的域判据分叉 ⇒
  `--emit` 之后 health 恒报漂移（BUG-199）。
  
  现改为**先 join 后判点**：`isPointConstraint`（core，与 drift 共用）为真才拓宽，
  多值观测域保留字面量并集；带断言的 `@nudo:case` 仍一律不拓宽。`widenObservationAbs`
  随之移入 core（`@nudojs/core/internal`），service 内不再保留副本。
  
  ### 追加：本轮发射面修复（13 条）
  
  - **BUG-168**：dts 不再抄不可解析的类型名（`id(x: any)` / `pair(a: any, b: any)`）；可解析的
    本地类补 `declare class`、导入名补 `import type`、`class Box<T>` 保留形参槽。
  - **BUG-189**：一个绑定挂多个导出名全部落地（`export declare function foo` +
    `export { foo as default }`，类同理）。
  - **BUG-190**：`export declare const/let/enum`（含成员与字面量初始化器）；无绑定值留
    `nudo:unresolved-value` 台账，TS2305 归零。
  - **BUG-151**：`class B extends A`、未导出基类补 `declare class`、实例字段（`this.x=…` /
    类属性）落地、继承字段不重复。
  - **BUG-108 / BUG-109**：入参面可选性 = 契约级 ∪ 声明级默认值；rest 槽**恒可选**且只有
    **一层**数组（zod `.optional()`、dts `...rest: any[]`）。
  - **BUG-069**：见证等价改按「**文件** + 实参载荷」复合键 ⇒ 二次 `--freeze` 输出
    `freeze: no changes.`、文件字节不变。
  - **BUG-081**：冲突面带 `conflict` / `undecidable`、行尾 `[unsatisfiable: n]`、stderr 同码
    error、`--json` 同名字段、exit 1；`nudo:interface-undecidable` 保持 warning（能力边界）。
  - **BUG-068**：nullish 回填在同一次改写里补齐 TS 侧车 builder import（含
    `nullable as nb` 别名；JS 侧车不加）。注：缺陷正文里「`interface-draft.ts` BUILDERS 缺
    `nullable`」是**过期信息**。
  - **BUG-198**：已申报的 `@nudo:throws` / `eff.throws` 原样进草稿 DSL；仅门禁算出的「可能抛」
    写成草稿头可照抄提示（不把「可能抛」变成草稿义务）。
  
  ### 追加：BUG-055 / BUG-119 已修，BUG-197 阻塞点已定位到行
  
  - **BUG-055（`--freeze` 把违约见证搬进被调方）**：`insertGeneratedCaseDirectives()` 原先只筛
    「可序列化 + 非手写」，**从不与被写方自己的有效契约比对** ⇒ 调用方的违约被搬进被调方，随后由
    `check-case-scan` 对着被调方报 error 级 `nudo:case-inconsistency`。修：新增
    `contractGuardOf()` / `witnessViolation()`（`emit/case-emitter.ts`），读
    `effectiveInterface(...)` 且**只执法 `source === "handwritten"`**（与 §3.3 同档）；契约位→实参位
    映射与调用点面同规则（`paramNames.indexOf` → `locateContractParam`）；判据与
    `check-case-scan.ts` 的标量通道**同口径**（eq/union 走 `literalMeetsConstraint`；纯 bounds 先
    `isIntFlag` 再按**实例化后** pred 逐原子判；optional 的 `or` 包裹不执法）；**不可判 ⇒ 放行**
    （非字面量、结构/数组/函数域）。违约见证不写入，skip 记新原因 `contract-violation`，归因留在
    调用现场 `nudo:interface-domain-exceeds`。宿主接线（`filePath` / `loadModule` / `autoBind` /
    `projectDir`）由 `shared.ts` 的 `emitWiringOf()` 供给，与 `contractOf` / `checkSource` 同源。
    回归：`service-bug-055-freeze-contract-guard.test.ts`、`cli-bug-055-freeze-contract-guard.test.ts`。
  - **BUG-119（`--freeze=update` 静默删除活着的见证）**：update 链「剥离 → 重算 → 回写」的两层
    缺陷：① `stripGeneratedCaseDirectives` **无条件**剥离 `call@`；② 回写沿用 add 模式的**函数级**
    「有手写 case ⇒ 整函数跳过」⇒ 跨文件见证无法从当前证据重算时（无契约时分析器不合成跨文件
    case）就是净删除且不可恢复，汇总只数「新写出」⇒ 谎报「0 directive(s)」。修：**块级守门**
    （含手写 case 的 JSDoc 块不剥离生成态见证，往返闭合）+ `InsertCaseOptions.rebuildGenerated`
    （重建阶段按**见证身份**逐条重建，手写 case 只挡同名，载荷等价只判生成态之间）+
    `reemitUpdate` 返回 `removedWitnesses`（`netRemovedWitnesses` 按身份配对，行号漂移不算删除），
    CLI 汇总印 `(N directive(s) …, K removed)` 与逐条 `- call@…`。
    回归：`service-bug-119-freeze-update-rebuild.test.ts`、
    `cli-bug-119-freeze-update-keeps-live-witness.test.ts`。
  - **BUG-135 已修**：实际改动在 LSP 侧（`a6-relax.ts` / `server-code-actions.ts`），见 cat-14
    changeset（relax 改「真写推断面」+ 落盘后验证门；CLI 文案在行为修好后为真，未改口径）。
  
  仍未修 / 阻塞（根因在禁改文件或需产品裁决）：
  
  - **BUG-035**：`projectFunctionDsl()` 把 `@nudo:case` 调试见证投影成契约；emit 测试目录里 5 处
    pin 了当前行为，改口径必须重钉 ⇒ 需产品裁决。
  - **BUG-197 已修**：见 cat-02 changeset —— `arityFace` 接受契约可选位，本地与跨文件共用
    `contractOptionalIndexes` 映射（位次与 `interfaceToIndexed` 同一套，只对 `handwritten` 生效），
    `nudo:arg-count` 不再对契约 `.optional()` 的省略实参报红，且不会出现「同文件绿 / 跨文件红」。
  - **BUG-076**：`any` 是既定口径（`docs/concepts/abs.md`、CLAUDE.md），真问题是文档表述
    （`docs/**` 本轮未改）。
  
  ### 追加：6 处 schema 期望按 BUG-093 重钉（不是放宽）
  
  BUG-093 的声明正确行为 = 数值谓词面必须接受 `±Infinity`（`schema-generator.ts:704-705`
  「`satisfies(Infinity)` ⇒ `.or(z.literal(Infinity))`」，`-Infinity` 同理），否则导出的 zod
  schema 会拒绝 Abs 域里合法的值。`schema-generator.test.ts`（5 处）与
  `schema-bound-anchor.test.ts`（1 处）钉的是加臂之前的字符串：
  
  - `gt(0)` / `gte(0)` → `….or(z.literal(Infinity))`（含对象槽内与默认 dialect / module 面）
  - `lte(100)` / `lt(5)` → `….or(z.literal(-Infinity))`
  
  行为断言（`WIDE_NUMBER` 的 NaN/±Infinity 三臂、`int().gte(0)` 等）原样保留。
  
  ### BUG-035：`@nudo:case` 的调试见证不再被写成契约（`nudo contract --emit`）
  
  **根因**：`packages/service/src/emit/interface-emitter.ts` 的 `projectFunctionDsl()` 把
  `source === "directive"` 的指令 case 与 `source === "callsite"` 的调用点证据**平权**
  当域来源 / 返回义务来源 ⇒ 纯点观测见证被投影成契约（`fn({ x: lit(5) }, lit(6))`），
  与 `nudo check` 的 `f(x: any) => number | string` 自相矛盾：用户为调试加一条
  `@nudo:case` 就把函数固化成「只接受那个点、只返回那个值」。
  
  **修法**：指令来源**内部**再分档（新增 `emit/domain-cases.ts` 的
  `isDomainDeclarationCase()` / `isPointObservationArgs()`，判据与 analyzer 侧
  `isPointObservationArgs` 同源）——
  - **域声明**：实参是约束构建器（`number()` / `shape()` / `union()` … 的域形状）**或**
    带断言（`=> expected`）⇒ 可作域来源与返回义务来源；
  - **纯点观测见证**（实参全是字面量且无断言）⇒ **不生成域、不生成返回义务**。
  
  **口径变化**：`directive` 纯见证不再产出契约（改前：`fn({ x: lit(5) }, lit(6))`；
  改后：无证据 ⇒ `skipped … (not-projectable)`，不写侧车）。`callsite` 优先、
  BUG-021 观测拓宽、域形状 `number()` 的 `not-projectable` 口径**均不变**；
  `domainEvidenceCases()`（dts / zod / standard / guard 面）语义不变。
  
  **重钉清单**（原断言钉住「指令用例 → 字面量契约」的错误行为；夹具改为**带断言的域声明**，
  断言文本未动）：`emit-bug-523-section-order.test.ts`（2 处）、
  `emit-bug-532-value-template-clash.test.ts`（1 处）、`emit-bug-540-crlf-byte-fidelity.test.ts`
  （1 处）、`emit-bug-548-import-name-clash.test.ts`（1 处）。
  新增回归：`emit/__tests__/emit-bug-035-case-witness-not-contract.test.ts`（三种 case 形态 +
  「有调用点证据时见证不得污染返回义务」+ 分档判据）。
  
  **残留边界**：既有侧车里由见证生成的旧生成段，在 update 模式下按「证据消失 ⇒ 删除该生成段」
  处理（见下文「BUG-035 残留收口」）；宽域 / `derived-from:` 段 / `@nudo:skip` 段仍按原策略保留。
  `contract --draft` 面本就不投影见证的返回义务（`projected: false`），无需改动。
  
  ### BUG-076：`nudo export --format dts` 的「无证据参数」口径统一为 `any`（文档侧修正 + 回归锁定）
  
  **判定**：`BUG-076` 的 section 结论 —— 代码侧「未取证参数渲染 `any`」是**有意为之**的产品口径
  （`docs/concepts/abs.md`：入口无约束 = `any`，不因缺证据改用 `unknown`），真正错的是仍在承诺
  「`unknown` + stderr 点名提示」的两处文档。故本条按**文档侧**收口，零行为变更。
  
  **改动**：
  - `docs/design/cli-semantics.md` §2「已记录例外（export 投影面）」改为 `any` 口径，并说明只有
    真正推导失败才出现 `unknown`（由 `nudo:unknown-inference` 之类引擎债诊断标注）。
  - `packages/website/docs/guides/export-ecosystem.md:114/185` 与 zh-Hans 镜像同步改为 `any`，
    删除「`export --format dts` 会打 stderr 提示」的承诺。
  - 新增 `cli-bug-076-unevidenced-any.test.ts`（3 例）：主路径无证据形参 ⇒ `any` 且 stderr 无提示；
    契约只覆盖部分形参 ⇒ 未覆盖位仍 `any`；窄路径（`@nudo:skip` + 手写契约未覆盖位）⇒
    `unknown` + `note: <fn>.<param> rendered as unknown …`（两条路径都实测可达 ⇒
    `reportUnevidencedParams` **不是**死代码，只是只在窄路径出现）。
  - `helpers/run-cli.ts` 新增 `writeSrcTsconfig()`：CLI 子进程按 cwd 找 tsconfig，否则会落到共享
    `dist/` 旧构建（测试钉源码语义的前提）。
  
  ### 重钉：BUG-021（调用点点观测拓宽）
  
  调用点**点观测**不再直接成为字面量契约 —— 先 `widenObservationAbs` 再 `joinThenProject`
  ⇒ 一次 `alpha({ x: 5 })` 折出 `shape({ x: number() })`、返回 `5` 折出 `number()`。据此重钉：
  
  - `packages/nudojs/src/__tests__/cli-bug-657-emit-fn-unmatched.test.ts`
    「对照组：名字正确 ⇒ 只改那一个」的断言由
    `toContain("+export const alpha = fn({ p: shape({ x: lit(5) }) }, lit(5));")` 改为
    `toContain("+export const alpha = fn({ p: shape({ x: number() }) }, number());")`。
    「只改 alpha、beta 不出现 `-`/`+`」与同文件「全部未命中 ⇒ 用法错误 + 侧车逐字不变」
    「连 dry-run 预览都不给」「部分命中 ⇒ `skipped nope (not-an-export)`」三组断言**未改动**。
  
  ### BUG-035 残留收口：证据消失 ⇒ 旧生成段被删（不再「保留原段」）
  
  **根因**：`emitInterface` 的 update 分支把「**不可投影**」一律当成「今天没有证据 ⇒ 把落盘的段原样保留」。
  BUG-035 之后 `@nudo:case` 见证不再进契约 ⇒ 由见证写出的旧段（`fn({ x: lit(5) }, lit(6))`）却因此
  **永久留在侧车里**，与 `nudo check` 的结论（`f(x: any) => number | string`）长期矛盾。
  
  **修法**（`packages/service/src/emit/section-provenance.ts` 新增，`interface-emitter.ts` 接线）：
  落盘的 `@generated` 段在**两个条件同时成立**时被删除 ——
  ① 当前投影**确实无证据**（无调用点、无域声明 case、无 entry 推断、且非 `@nudo:skip`；
     「有证据但表达不出来」不算无证据 ⇒ 保留）；
  ② 该段的证据**可证明来自本文件**（无 `// derived-from:` 标签，且某个顶层槽钉住了单个字面量 ——
     今天的发射器会把调用点点观测拓宽（BUG-021），故单字面量域只可能来自本文件的域声明 / `entry@`）。
  删除沿用既有「死段」路径（整段 + 尾随换行），填充 `EmitInterfaceResult.removed`，
  发一条 info `nudo:interface-not-projectable`（「evidence disappeared — dropping its generated section…」），
  人类面 `formatEmitSummary` 增一行 `removed: <names>`，机器面（`nudo contract --emit --json`）
  增 `removed` 字段。
  
  **重钉**：无（既有断言一条未动；`interface-emitter.test.ts` 的「update 无证据保留原段」用例
  其段是宽域 ⇒ 不满足「可证明来自本文件」⇒ 原样通过）。
  
  **残留**：① 宽域且来自本文件调用点的段，调用点消失后仍保留 —— **已收口**（见下
     「BUG-035 证据范围收口」：生成段记 `// evidence: local|external`，宽域段也能判定）；
     ② BUG-021 之前的旧侧车，点字面量 `--from` 段与见证段不可区分，可能被删
     （`--dry-run` 可先预览）；③ 只看顶层槽 ⇒ `shape({ x: lit(1) })` 形态的**旧**段保守保留
     （现格式下由 `// evidence:` 判定，不再受此限）；④ 带 `// derived-from:` 标签的段保留。
  
  ### 追加：BUG-035 证据范围收口 —— 生成段记录 `// evidence:`，宽域段也能判定刷新
  
  **症状（上一轮收口后仍留的最后一条边界）**：删除陈旧段的判据只能「证明」**单点字面量**域的
  证据在文件内（今天的发射模型把调用点观测拓宽，单点字面量只可能来自文件内 case/entry）。
  **调用点来源的宽域段**（`fn({ x: number() }, number())`）与「`--from` 采集的使用现场记录来源段」
  **逐字同形** ⇒ 调用点被删后宽域段只能保守留存（侧车继续承诺今天已不存在的域，与 `nudo check`
  签名面矛盾）；反过来盲删又会丢掉 `--from` 段的用户契约。
  
  **修法（侧车格式变更）**：
  - `FunctionAnalysis.externalEvidence`（`analyzer-orchestrate-uncached.ts` 的合成路径）：本函数的
    callsite 证据是否混入 `--from` 外部记录。判据取**去重前**的匹配集 ⇒ 保守方向永远是「少删」；
    该字段是纯增量（`cloneFunctionAnalysis` 走浅展开，缓存回放不丢）。
  - 生成段由三行变**四行**：`@generated` / `// source:` / `// evidence: local|external` / export
    （`interface-emitter.ts` 的 `sectionText`；`roundTrip` 自检同文本，故自检与写盘同源）。
  - `section-provenance.ts`：新增 `sectionEvidenceScope()`；`sectionEvidenceIsInFile()` 改为
    「无 `derived-from` 标签 **且**（`local` 标记 **或** 旧侧车无标记时的单点字面量启发式）」。
    ⇒ `local` 宽域段在「今天没有证据」时可证「证据没了」⇒ 删段；`external` 段与旧侧车宽域段
    继续保留。旧侧车（无 `// evidence:` 行）行为**完全不变**；旧段在因内容变化被重写时自动带上标记。
  - 标记是**确定性函数**（证据范围只取决于本轮是否用了外部记录）⇒ 二次发射逐字节相同。
  
  **重钉（2 处，均为「当轮格式」更新，断言文本一条未动）**：
  - `service/src/emit/__tests__/emit-bug-523-section-order.test.ts` 的 `SIDECAR` 夹具
    （注释即「首次 emit 生成的形态」）补 `// evidence: local` —— 该文件钉的是**段序不重排 /
    无改动**，不是段的行数。
  - `lsp/src/__tests__/lsp-bug-196-single-writer-sidecar.test.ts` 的 `SIDECAR_CONVERGED`
    补 `// evidence: local` —— 该文件钉的是 add/update **逐字节收敛**，格式变更后收敛态随之更新。
  
  **新回归**：`emit/__tests__/emit-bug-035-evidence-scope.test.ts`（7 例）—— ① 宽域 `local` 段
  在调用点消失后被删（+ `removed` 台账 + info 诊断）；② `--from` 外部记录来源段带 `external`
  标记、证据缺失时留存且逐字节不变；③ 旧侧车宽域段留存（迁移期零回归）；④ 旧侧车单点字面量段
  仍按旧启发式删除；⑤ `derived-from` 段即使带 `local` 标记也留存；⑥ 标记确定性/幂等；
  ⑦ 本地与外部记录混合 ⇒ `external`（保守方向）。
  
  **文档**：`packages/website/docs/guides/contract.md` 与 zh-Hans 镜像的侧车示例与 dry-run diff
  示例补 `// evidence: local`（该行是两版之间的**上下文行**，hunk 头不变）。
- 250f0ba: Fix bug-report category 09 (`nudo check` gate) — 10 of 15 defects.
  
  - BUG-046: a variadic flag no longer silently consumes the following path; a value the
    flag cannot accept that exists on disk is reported as a usage error, so `check
    clean.js --only <code> broken.js` no longer exits 0 with `broken.js` unchecked.
  - BUG-047: `check --fix` advances its plan text outside the `--write` branch, so a second
    hunk is `@@ -1,2 +1,3 @@` instead of a conflicting `@@ -0,0 +1,2 @@`, and dry-run output
    matches `--write`.
  - BUG-048: `--only` values are validated against the diagnostic registry (unknown codes
    are a usage error; valid-but-unmatched codes are reported) instead of silently
    producing `0 edits`.
  - BUG-049: a sidecar write failure is reported (`check --fix cannot write <path>`) instead
    of aborting the whole run with a bare `EACCES`.
  - BUG-066: `--quiet` is evaluated before `--abs`, so `--abs --quiet` prints one line
    instead of the full signature block.
  - BUG-067: `--fix` refuses to write a sidecar that would conflict with a sibling file
    (`.js` / `.mjs`, `.ts` / `.mts`) and names the sibling.
  - BUG-115: the `--json` envelope gains an unambiguous `summary.pathErrors`, so path
    failures are readable from the summary (the green shape is unchanged).
  - BUG-264: `sidecarPathOf` strips `.d` **after** `.nudo`, so a `.d.ts` source yields
    `api.nudo.ts` (and a `.nudo.draft.ts`-style draft) instead of a `.d.` name that
    TypeScript treats as a declaration file.
  - BUG-284: hard errors (input read failures / syntax errors) feed both CI channels, so
    `--gitlab` always emits exactly one parseable array and `--gha` emits `::error`.
  - BUG-285: GHA annotations move to stderr when GitLab owns stdout, so `--gha --gitlab`
    emits its `::error` lines instead of dropping them.
  
  Regression tests: `cli-bug-046-*`, `cli-bug-047-*`, `cli-bug-048-*`, `cli-bug-049-*`,
  `cli-bug-066-*`, `cli-bug-067-*`, `cli-bug-115-*`, `cli-bug-284-*`, `cli-bug-285-*`,
  `core-bug-264-sidecar-dts-name`.
  
  Known follow-ups NOT covered here: BUG-014 (needs `commands/test.ts`), BUG-015 / BUG-114
  (need `migrate.ts`, handed to the migrate category), BUG-262 (needs
  `packages/lsp/src/validation.ts`), BUG-056 (needs per-round module isolation; `check`
  still prints `bump() => 2`).
  
  ### BUG-056 诊断追加（未修复，定位已收窄）
  
  同文件在同一进程被求值两轮时，闸门读到被上一轮写脏的结果（`bump() => 2`，原生 `1`；
  连带 `main() => 11`、`once() => 1`、`nudo:interface-drift` 把干净侧车判成陈旧）。
  
  已排除（逐一实测，均无效）：
  
  - service `evictAbsModuleCacheFiles` / `evictEvalCacheForFiles`：驱逐前后
    `getAbsModuleCacheSize()` 都是 `0`、`getEvalCacheSize()` 由 `1` 归 `0`，闸门仍是 `2`；
  - core `evictGeneralizeMemoForPaths`：仍是 `2`；
  - core `resetNudoModuleExecCache`（侧车模块执行表）：仍是 `2`。
  
  已定位的方向：**`checkSource` 的整文件 memo**（`packages/core/src/algebra/check-memo.ts`）。
  探针（同一进程内先跑分析器再跑闸门）在每次 `checkSource` 前 `resetCheckSourceMemo()`
  后结果稳定为 `1`（不重置则 `2`，且第二次调用仍 `2`）⇒ 陈旧 `CheckReport` 被跨轮复用，
  不是模块实例泄漏。收口方向 = 在 CLI 轮边界按路径驱逐
  `evictCheckSourceMemoForPaths([filePath])`（该 API 已从 `@nudojs/core` 导出，无需动
  public-api 快照）；未落地的原因是上述探针全部跑在**修复前的 `dist/`** 上（`@nudojs/*`
  经 package `exports` 解析到 `dist`），需要在源码构建上复核后再改 —— 否则无法区分
  「memo 陈旧」与「模块实例脏」两种成因。
  
  ### 追加：BUG-056 已修（根因与落法）
  
  根因（实测确认，不是推测）：`packages/core/src/algebra/generalize.ts` 与
  `check-may-throw.ts` 各有一张 `evalRunMemo`，缓存的是**活的 run 表**——模块级 `let` 状态
  **和对象身份**都住在里面；键**只有 source（+ mock scope + inject 指纹）**，没有路径、
  没有轮次。后果：
  
  - 分析器一轮 generalize 与闸门一轮共用同一实例 ⇒ `bump() => 2` / `main() => 11` /
    `once() => 1`（同一文件在同一进程里被读作 1 / 2 / 3，字节相同的两个不同文件也共用）；
  - `contract --emit` 写分析器的干净值、`check` 打印被污染的值 ⇒ `nudo:interface-drift`
    永不收敛（health 永久假红，重跑 `--emit` 无法自愈）。
  
  落法：引入单调**求值轮次**（`collector-scope.ts`），最外层 `runWithCollectorScope` 创建
  作用域时涨轮；两张 run 表的键都带轮次前缀 ⇒ 跨轮不复用活状态；**不做整表作废**（整表
  作废会让轮内的对象身份变化，递归泛化的 term 指纹随之坍缩成 `unknown`）；`resetGeneralizeMemo`
  同时清 run 表。已排除的无效方案（逐条实测）：service `evictAbsModuleCacheFiles` /
  `evictEvalCacheForFiles`、core `evictGeneralizeMemoForPaths`、`resetNudoModuleExecCache`、
  按路径驱逐 `checkSource` 报告 memo —— 全部无法触及这两张表。
  
  回归：`core-bug-056-eval-round-identity.test.ts`（3 例：分析器轮之后闸门仍读 1、字节相同的
  第二个文件各自读 1、同一文件重复分析每次读 1）；CLI 侧 `cli-bug-056-check-single-eval.test.ts`
  钉住 `bump() => 1`、`once() => never throws Error`、无 `nudo:interface-drift`。
  
  ### 追加：BUG-085 已修（`--abs` 观测面吃 `@nudo:assume` 前提）
  
  根因不在 core 的假定折叠，而在 **CLI 观测面没喂前提**：`nudojs/src/commands/shared.ts::
  runAbsView` 直接 `tryEvalCall(...)`，`@nudo:assume d <= max` 从未进入求值。
  
  落法（关键点：喂**前提槽**，不是 `phi`）：每个待观测函数先从
  `extractAssumeSegs(source, fnName)` 取 `ok` 段，折成 `ale(v(lhs), v(rhs))` 后
  `withAssumePremises(phi, () => tryEvalCall(...))`。`div` 的关系折叠只读
  `assumePremiseList(assume)`（`core/algebra/arithmetic/muldiv.ts:141`），而前提槽在调用边界
  会被清空；折进 `phi` 会既拿不到谓词、又把前提泄漏给被调方（不健全）。
  
  回归：`nudojs/src/__tests__/cli-bug-085-abs-assume-premises.test.ts`（3 例）——
  `check --abs` 打印 `pred: /(d, max) ≤ 1`（此前缺失而 `--json` 已给出 `where`，两面不一致）、
  无 assume 行的对照两面都无谓词、`nudo test --abs` 同源同结论。
  
  ### 追加：CLI fail-closed 判据改为「可见性」，诊断按标签分两条通道
  
  `packages/nudojs/src/commands/check.ts`：per-file collector 由「只收 `internal`」改为
  「`internal` **或** `gateFatal === true`」（plain check 与 `--fix` 两处采集点同口径），
  并把诊断拆成两条：
  
  - `internal`（引擎 / 宿主边界违约）⇒ `nudo:internal` + 「报引擎 bug」文案（既有）；
  - 装载期逃逸的**用户代码**异常（标签 `module-throw` 且 `gateFatal === true`）⇒
    `nudo:module-throw` + 指向**用户代码**的文案（BUG-073：不得让用户去报引擎 bug）。
  
  这补上 BUG-072 在 CLI 侧的最后一个缺口：**无句法证据**的装载失败（模块顶层
  `JSON.parse(userInput)`、顶层调用会抛的导入函数）此前零诊断 + exit 0（**假绿**），现在按
  `gateFatal` 判红。`unsupported:*`（能力边界）与建模内 `NudoThrow` 的
  `gateFatal === false` ⇒ 仍不入闸门（假红防线不变，1145 的 unsupported 用例守反向）。
  
  ### 重钉：BUG-264 带来的落点改名（`.d.ts` 源的草稿名不再含 `.d.`）
  
  BUG-264 修了「`.d.ts` 源的侧车 / 草稿名含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ TS1254」，
  把落点从 `api.d.nugo.draft.ts` / `api.d.nugo.ts` 改成 `api.nugo.draft.ts` / `api.nugo.ts`。
  该修复落地时**只更新了 core 侧自己的钉**，漏了 3 个 nudojs 侧的旧断言 ⇒ 它们的期望仍写着旧拼写。
  
  按 BUG-264 的权威规格重钉（**保留旧拼写等于把 BUG-264 重新引回来**）：
  - `cli-bug-659-from-dts-usage-order.test.ts`：`types.d.nudo.draft.ts` → `types.nugo.draft.ts`
    （「CWD 里的同名草稿不存在」那条断言未动）。
  - `cli-bug-944-from-dts-write-path.test.ts`（3 处）：落点、`next` 提示里的侧车名、拒绝覆盖提示里的路径
    全部改成 `types/index.nugo.draft.ts` / `types/index.nugo.ts`（CWD 无同名草稿、既有草稿逐字不变
    等行为断言未动）。
  - `nudojs-bug-1147-contract-cli-text.test.ts`（3 处）：共享的 `draftPathOf` 辅助函数改成新落点
    （拒绝提示双口子 / 人工改过永不被覆盖 / `--force` 覆盖成功三条的语义断言未动）。
  
  新增 `cli-bug-944-from-dts-draft-invariants.test.ts`（7 例）：钉**规则**而不是拼写 —— 落点贴着源
  `.d.ts` 且 basename 不含 `.d.`、「next」侧车名不含 `.d.`（旧名不得出现）、目标已存在 ⇒ 拒绝覆盖
  （exit 1 + `--force` 与 `NUDO_DRAFT_FORCE` 双口子 + 提示含 `hand-edited` + 既有草稿逐字不变 +
  不谎报 `wrote `）、内容未变 ⇒ 不拒绝、`--force` 与 `NUDO_DRAFT_FORCE` 各自可覆盖机器原稿、
  人工改过的草稿 `--force` 也不放行。
  
  **零源码改动**：实现的落点、拒绝、双口子与「人工改过不覆盖」规则本就符合 944/1147 的规格
  （逐条手测复核过），只有断言的**拼写**过时。
  
  **残留**：① `--from-dts --write` 在没有 `package.json` 祖先目录时**无项目根守卫**，
  而 `--draft --write` 在同场景要求 `NUDO_DRAFT_FORCE=1` —— 944/1147 夹具（无 `package.json`）钉住
  前者成功 ⇒ 对齐会与被钉住的行为冲突，故未动；
  ② `--from-dts --write --dry-run` 在既有草稿不同时**拒绝**（exit 1）而非给 diff 预览，
  与 `--draft --write --dry-run` 不一致（未动）。
- 6fe6452: Fix bug-report category 10 (`nudo test` / `nudo health` / `nudo init`) — 10 of 11 defects.
  
  - BUG-018: `nudo test --freeze <path>` treats the value as a path unless it is a known
    mode, so a path is no longer swallowed with `Usage error: needs at least one path`.
  - BUG-036: witness identity keeps the call-site prefix, so deleting one of two call sites
    is reported as drift instead of `0 case drift / OK / exit 0`.
  - BUG-037: a never-frozen file no longer reports case drift (`frozenWitnesses > 0` is
    required before comparing).
  - BUG-038: a missing path now lands in `pathErrors` / `targetErrors` with
    `summary.errors` = 1 instead of being silently skipped.
  - BUG-039: contract drift counts `@generated` slots (Σ `interfaceDrift`) instead of files,
    so detail, summary and `--json` agree.
  - BUG-054: health honours `--from` (same `externalAbsCallRecords` source as `check`), so
    drift is no longer invisible when `--from` is used.
  - BUG-113: `health --json` emits a JSON error envelope on a usage error instead of
    printing 0 bytes.
  - BUG-199: health's drift criterion now includes whole-section text drift
    (`emitInterface(mode: "update", dryRun: true)`), so `health` and
    `contract --emit --exit-on-diff` agree on the same sidecar.
  - BUG-228: file-level `@nudo:env` is resolved with the two-baseDir layering that `check`
    uses, so `check`'s `nudo:interface-drift` and health's "0 contract drift" no longer
    contradict each other.
  - BUG-229: `nudo init` rewrites the **effective** (last) `"nudo"` member and removes
    earlier duplicates, so the reported baseline is the one the loader actually reads.
  
  Regression tests: `cli-bug-018-*`, `cli-bug-036-*`, `cli-bug-037-*`, `cli-bug-038-*`,
  `cli-bug-039-*`, `cli-bug-054-*`, `cli-bug-113-*`, `cli-bug-199-*`, `cli-bug-228-*`,
  `cli-bug-229-*`.
  
  Known follow-up NOT covered here: BUG-136 (CLI `nudo test` witness line and the LSP
  `agent-tools.ts` `observationTitle` disagree on indentation/spacing) needs
  `packages/lsp/src/agent-tools.ts`, which is outside this category's file set; aligning
  `run-test.ts#formatCaseLine` alone would break `test-entry-contract-note.test.ts`.
- d5b189d: Fix bug-report category 11 (`nudo contract` command layer).
  
  - BUG-042: `contract --draft --fn <name>` for a non-existent export is no longer a
    silent no-op (exit 0 with an empty draft); it now mirrors `--emit` and exits 1 with a
    usage error listing the available exports.
  - BUG-100: `contract --from-dts` no longer silently swallows `--emit` / `--fn` / `--all` /
    `--dry-run` / `--exit-on-diff`; the flags are honoured, so the drift gate is no longer
    permanently green.
  - BUG-122: `contract --emit`'s derived branch and main branch no longer write the same
    sidecar with divergent formats, so `--dry-run` diffs match what is actually written and
    `--exit-on-diff` no longer exits 1 forever.
  
  Regression tests: `cli-bug-042-*`, `cli-bug-100-*`, `cli-bug-122-*`.
  
  ### BUG-196：`nudo contract --emit` 的根侧车改为**单写者 + 同源判定**
  
  **根因**：`emitDerivedFromRoot(...)`（派生分支，段文本 4 行含 `// derived-from:`）与
  `emitInterface(...)`（直写分支，段文本 3 行）在同一次运行里写**同一个侧车的同一段**；后写的直写
  分支把溯源行整段抹掉 ⇒ 净变化为零却报 `Updated`；而 dry-run 比对按「未抹掉的版本」算 ⇒ 预览
  要求加那行、真实写盘从不产生 ⇒ `--exit-on-diff` 恒 exit 1（漂移门禁永不收敛）。
  
  **修法**（先让「最终文本」成为结构上的事实，再让判定 / 预览 / 落盘都用它）：
  - `interface-emitter.ts`：`EmitInterfaceResult` 增 `finalContent`（含 BOM，与真实落盘逐字节相同）
    —— 调用方不再需要从 `diff` 反解自身产物（CLI 里原先的 `applyUnifiedDiff` 已删除，约 110 行）。
  - 直写分支一律 `dryRun: true`（只算，不写）；派生分支以直写分支的 `finalContent` 为
    `baseContent`，对**直写分支负责的段**（`directSections`）只并 `// derived-from:` 标签行、
    不整段覆盖；根侧车由 CLI **一次原子写入**（派生分支 `skipWrite`）。
  - `changed` / `Updated` / dry-run 预览 / 落盘全部用同一份最终文本（逐字比较）⇒ 幂等。
  
  **口径变化（重钉）**：`cli-bug-122-emit-net-effect.test.ts` 原先钉的是缺陷行为（首跑侧车不含
  `// derived-from:`、干净夹具 dry-run exit 0），现按 section 改为：首跑落盘含溯源行、内容真变才报
  `Updated`、干净夹具首跑 dry-run 正确报漂移（exit 1）而真写一次后 exit 0。
  
  **残留**：LSP agent 面（`packages/lsp/src/agent-tools.ts`）的旧「派生 → 直写」双路顺序已收口
  （见下文「BUG-196 残留收口」）。`packages/service/dist` 需 `pnpm run build` 后才有新语义
  （`writeSrcTsconfig` 的测试钉源码）。
  
  ### BUG-196 残留收口：LSP agent 面改单写者（同源组合，CLI 口径一致）
  
  上一节记录的残留（LSP agent 面仍是「派生 → 直写」双路顺序）已收口，改动全部在 `packages/lsp/src/**`。
  
  **根因**：`packages/lsp/src/agent-tools.ts` 的 `serializedEmit()` 沿用旧顺序 ——
  先 `emitDerivedFromRoot`（**写盘**，派生段 4 行含 `// derived-from:`），后 `emitInterface`
  （**重写同一段**，3 行、无溯源行）⇒ 溯源行被抹掉、净变化为零却报 `Updated`；预览与真实写盘相反。
  
  **修法**（与 CLI `runContractEmit` 同构）：直写分支**恒 `dryRun: true`**，其 `finalContent` 作合并基底；
  派生分支以它为 `baseContent`、`skipWrite: [根侧车]`、`directSections: 直写分支负责的段`
  ⇒ 只把 `// derived-from:` 标签行并进直写段（正文以直写为准），下游侧车仍由派生分支拥有；
  根侧车文本 M = 派生结果 ?? 直写结果（BOM 守卫）⇒ **一次原子写**（tmp + rename）；
  `changed` / `written` / `diff` 全部由 M 与写前字节比较得出（直写 `written` ∪ 根侧车派生的 `writtenNames`），
  根侧车的派生条目不再重复报「Updated」。
  
  **重钉**：无。新增回归 `lsp-bug-196-single-writer-sidecar.test.ts`（4 例）：update 模式保留直写正文 +
  保留 `// derived-from: lib.js:tag` + 收敛后内容逐字节一致 + **只写一次**（统计 `renameSync` 次数）；
  第二跑无写盘、无「Updated」；dry-run 预览与真实写盘逐字相同；add 模式保留直写正文且只写一次。
  
  **残留（已收口）**：LSP **add** 模式下，service 的「既有段不可动」规则使 `// derived-from:` 标签并不进
  本轮刚追加的段 —— 基底（= 直写分支产物）里已经有该段，派生分支把它当成「既有段」跳过。
  现由 `emitDerivedFromRoot` 的 `directCreatedSections` 判据区分「本轮直写分支新建」与「此前既有」
  （详见 cat-14 changeset「BUG-196（add 面）」）：add 面只对本轮新建且直写负责的段**就地**并入溯源行，
  既有段仍原样不动（不强制 update ⇒ 不会顺带刷新下游侧车的既有派生段）；收敛后 add 与 update 写出的
  根侧车逐字节相同。
- 8a22296: Fix bug-report category 12 (`nudo export`) — 11 defects.
  
  - BUG-016: the module identity used by `--out` is path-free (package-relative path, or
    `<stem>|<export names>` outside a package root), so exporting the same module from two
    directories produces one byte-identical artifact instead of accumulating
    contradictory stale copies.
  - BUG-026 / BUG-279: an `entry@` witness contributes its **element** to a rest parameter,
    so the published type is one array rather than an array of arrays.
  - BUG-028: the `--format all` stdout flattener pre-reserves the dts segment's (user API)
    identifiers, so user exports keep their names and the flattened dts matches `--out`.
  - BUG-033: a barrel module's dts surface is assembled before the early return, so
    re-exports are no longer dropped when the module has no functions.
  - BUG-044: `nudo export` publishes with `caseMode: "none"`, i.e. the same domain as the
    `check` / `health` / `migrate` gate, instead of leaking `@nudo:case` debug witnesses
    into the shipped dts/schema.
  - BUG-075: the stdout flattener registers all top-level identifiers (exports, locals,
    import bindings), so the flattened output passes `tsc --strict`.
  - BUG-120 / BUG-121: object-destructured parameters collapse to one slot keyed by the
    formal name, and the constraint-disproof `fields` branch handles `sum` shapes
    symmetrically with `prim`.
  - BUG-204: identifier renaming in the stdout flattener is lexer-aware (skips strings,
    templates, comments, property keys and object keys), so slot-key **data** is no longer
    rewritten.
  - BUG-231: the unique-name fallback in `--out` honours `isSameModule`, so re-exporting
    the same module overwrites in place rather than writing a `.2` copy that diverges.
  
  Regression tests: `cli-bug-016-*`, `cli-bug-026-*`, `cli-bug-028-*`, `cli-bug-033-*`,
  `cli-bug-044-*`, `cli-bug-075-*`, `cli-bug-120-*`, `cli-bug-121-*`, `cli-bug-204-*`,
  `cli-bug-231-*`, `cli-bug-279-*`.
  
  Known follow-up: BUG-044's **contract print** face still consumes
  `packages/service/src/emit/interface-surface.ts` with the default `caseMode: "all"`, so
  `nudo contract`'s printed interface can still include `@nudo:case` witnesses. The export
  products (dts/schema/guard) are now gate-consistent.
  
  ### 追加：两处既有期望按 BUG-109 重钉（不是放宽）
  
  BUG-109 声明正确行为 = rest 槽**恒可选**且只有**一层**数组，而两个既有用例钉的是修复前
  的「必填」形状，与之相反 ⇒ 按声明正确行为重钉 expected 子串，**行为断言原样保留**
  （一层数组、`not.toContain("z.array(z.array(")`、错误形状仍被拒）：
  
  - `cli-bug-026-rest-param-single-array.test.ts`：standard 面槽 →
    `{"key":"rest","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}`。
  - `cli-bug-279-rest-entry-witness-slot.test.ts`：zod →
    `z.object({ args: z.array(z.unknown()).optional() })`；standard 槽带 `"optional":true`。
  
  ### 重钉：BUG-044（`@nudo:case` 见证不进发布面）+ 文档口径修正
  
  `@nudo:case` 是**调试见证**、不是契约产品 ⇒ `nudo export` 以 `caseMode: "none"` 调分析器，
  发布面（dts / schema / guard / standard）不消费见证。据此：
  
  - `docs/design/cli-semantics.md` §2 的「已记录例外（export 投影面）」把签名数据源写清：
    **契约 / 调用点证据 / `entry@` 兜底**，并明写「`@nudo:case` 调试见证不进导出面」。
  - `packages/website/docs/guides/export-ecosystem.md:114/185` 与 zh-Hans 镜像同步：
    删除「`@nudo:case` 见证喂导出签名」的表述，改为「`nudo export` 与门禁一样以
    `caseMode: "none"` 分析；见证不进发布面」。
  - 重钉 3 处旧断言（原断言钉住「见证拓宽形参 / 产出 `Case:` 行 / 进 `Output` 校验器」）：
    - `export-dts-evidence.test.ts`：用例改名「调试见证不进导出面（BUG-044）」；
      `toContain("export declare function greet3(u: { name: string }): string;")` +
      `toContain('Case: named …')` ⇒ `toContain("export declare function greet3(u: any): any;")` +
      `not.toContain("Case:")`。
    - `cli-bug-619-skip-multi-witness-output.test.ts`：zod 面
      `toContain("twiceOutput")` + `toContain("z.literal(4)/6")` ⇒
      `toContain("twiceInput")` + `not.toContain("twiceOutput")` + `not.toContain("z.literal(4)")` +
      `not.toContain("z.literal(6)")`；standard 面 `toContain("twiceOutput")` ⇒
      `toContain("twiceInput")` + `not.toContain("twiceOutput")`。
      只带 case、无契约的 skip 函数发布面无 `Output` 校验器（域证据为空 ⇒ 返回面无种子）是
      该口径的**结果**而非缺陷；「函数仍出现在产物里 + exit 0」仍被钉住。
  - 附带（BUG-189 形态统一）：`export-dts-evidence` 的「export default 函数进导出面」由
    `toContain("export default function makeGreeting")` 改为
    `toContain("makeGreeting")` + `toContain("as default")`；
    `not.toContain("export declare function makeGreeting")`（Bug 515：局部名不得成为具名导出）保留。
- d4ab7fb: Fix bug-report category 13 (`nudo migrate` status / strip / verify / retire) — 20 of 21
  bugs, plus two defects that were filed under other categories but live in `migrate.ts`.
  
  - BUG-234: `migrate strip` rewrites an enum's **computed member** references to
    `E["KEY"]` (reference-position aware) instead of leaving the initializer verbatim, so
    the stripped product no longer throws ReferenceError; string-valued computed members
    skip the reverse mapping like tsc. A `enumComputedMemberRewritten` report flag records
    the rewrite.
  - BUG-050: `strip` refuses to write when a TS-only construct survives the stripper
    (`namespace`, `import x = require(...)`) instead of writing a `.js` that fails
    `node --check`/`nudo check` with exit 0.
  - BUG-226: `migrate verify`'s env merge uses `mergeHarvestUnderEnv` (the `check` path), so
    harvest-only exports are no longer dropped ⇒ `verify` no longer reports `unknown` where
    `check` reports a precise type.
  - BUG-064: `migrate verify` resolves project-level env against the project root and
    file-level env against the file's directory, and surfaces env load errors as
    `nudo:env-unresolved`.
  - BUG-061: `migrate verify` installs the eval-fallback collector, so an internal analysis
    failure is an error-level `nudo:internal` (same code/severity as `check`).
  - BUG-114: `migrate verify` runs the strict, extension-aware parse first, so TS-only
    syntax inside a `.js` file is a per-file `syntax-error` instead of `verify` saying
    `nudoOk: true`.
  - BUG-015: `migrate`'s `ignoreThrows` uses the same lenient parser as `check`.
  - BUG-051 / BUG-052 / BUG-103 / BUG-117 / BUG-118: retire batch semantics — a mixed batch
    retries the work-bearing targets and reports the skipped ones; `retire --all` shares
    `retireScope` with the single-target path; a leftover `migrate-retiring.json` is
    recovered; a repeat run reports `already retired` with a zero delta (the ledger no
    longer leaks into this run's result); a multi-root failure reports every bad root.
  - BUG-053 / BUG-112 / BUG-179: JSON/human faces — dry-run results carry `dryRun`; an
    unknown action emits a JSON error envelope instead of empty stdout; the human face
    prints only this run's deltas.
  - BUG-062 / BUG-063 / BUG-065 / BUG-102 / BUG-116: retire/status plumbing — the gate
    script test is command-text based and reports the real `from`; the workflow dedup key
    includes the line so the rewrite count is exact; a corrupt marker fails closed and is
    left byte-identical; `status` and `retire` share the same workflow scope; the product
    specifier is tried verbatim before candidate rewriting.
  - BUG-178: `migrate status` uses retire's gate/compiler split for blockers and reports a
    `preserved` field; `next:` branches on state instead of being unconditional.
  
  Regression tests: `migrate-bug-{015,050,051,052,053,061,062,063,064,065,102,103,112,114,
  116,117,118,178,179,226,234}-*` and `core-bug-234-*`.
  
  Known follow-up NOT covered here: BUG-017 (`--json` top-level shape) is blocked because
  existing tests pin **both** an object envelope for failures and an array for success; a
  single shape breaks at least two of `cli-bug-696-migrate-strip-json-envelope`,
  `migrate-bug-cli-wiring`, `cli-bug-56-cli-face`, `cli-bug-675-migrate-retire-json-shape`,
  `migrate-bug-1028-marker-json-same-shape`. Every failure path now uses the same object
  envelope (including the previously empty-stdout unknown-action path).
  
  ## 追加：BUG-017 `migrate --json` 顶层形状恒为数组
  
  成功路径早已是数组，动作级失败路径却输出对象信封（`{ ok:false, action, targets,
  error }`）⇒ 消费方 `JSON.parse(stdout).map(...)` 在失败路径抛异常。现统一为
  **数组**：失败/正常终止信封一律包成单元素数组（`[ { ok:false, … } ]`），
  `status` / `verify` / `strip` / `retire` 四个 action 与未知 action 分支同口径。
  
  已有测试更新（原先钉住对象信封）：
  
  - `cli-bug-696-migrate-strip-json-envelope.test.ts`（失败面读 `[0]`，并断言
    `Array.isArray`）
  - `migrate-bug-cli-wiring.test.ts`（Bug 1006 失败面同上）
  - `cli-bug-56-cli-face.test.ts`（正常终止信封 `failedTargets` 同上）
  
  成功路径的数组形状（`cli-bug-675` / `migrate-bug-1028`）不变。
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [206713f]
- Updated dependencies [0650ef0]
- Updated dependencies [fe03e18]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
- Updated dependencies [9ff1709]
- Updated dependencies [afd7c36]
- Updated dependencies [7231e87]
- Updated dependencies [37e9aa0]
  - @nudojs/core@1.17.2
  - @nudojs/service@1.10.3
  - @nudojs/parser@1.5.6
  - @nudojs/env@0.5.6
  - @nudojs/harvester@0.4.6

更早版本（56）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.6 {#pkg-parser}

## 1.5.6

### Patch Changes

- 206713f: Fix bug-report category 06 (directive system) — 5 of 7 defects.
  
  - BUG-013: the scope-boundary guard no longer aborts at the walk root, so a bare-block
    annotated statement is replaced instead of falling through to a false
    "matched no expression" warning; the diagnostic now distinguishes "blocked by a nested
    scope" from "no such expression".
  - BUG-086: orphan diagnostics for inline directives are reported per instruction (with
    the right line/column) instead of being swallowed by a global orphan counter.
  - BUG-184: `@nudo:replace` only matches **value-slot expression** nodes; binding and key
    positions fall through to the "matched no expression" warning instead of being
    transpiled.
  - BUG-195: an in-body `/// @nudo:import` line comment is now reported as misplaced (it
    previously fell into a silent `continue`).
  - BUG-283: `@nudo:skip` (and the `@nudo:pure` sibling) bind to the **shallowest** same-name
    scope instead of the last writer, so an inner function can no longer steal the outer
    one's skip and an inner-only skip can no longer erase the exported function's `throws`
    annotation.
  
  Regression tests: `service-bug-013-*`, `service-bug-086-*`, `service-bug-184-*`,
  `service-bug-283-*`, `parser-bug-195-*`.
  
  Known follow-ups NOT covered here (blocked on core/service call sites outside this
  category's file set): BUG-020 and BUG-180 (`@nudo:mock` scope degrades to file level when
  there is no same-name conflict) need `core/src/algebra/generalize.ts`
  (`scopeSelectedInject` / `hasMocks`), `core/src/algebra/check-may-throw.ts`
  (`evalThrowsOutcome`) and `service/src/abs-modules-graph.ts` (`evalDep`).
  
  ### 追加：BUG-080 已修（`@nudo:as` 在解构声明上被静默丢弃）
  
  根因：`exec/transpile/stmt/statement.ts` 的 `emitVariableDeclaration` 里 `asVar`
  （`matchAsOverride(stmt)` 的结果）**只在 Identifier 分支被消费**，解构分支（`d.id` 非 Identifier）
  从头不读它 ⇒ 覆盖被静默丢弃；而指令本身**采集正常**（`VariableDeclaration` 是语句，
  `isDirectiveCarrier = isStatement`）⇒ `asTargets` 非空 ⇒ 连 orphan 诊断都不触发 ⇒ 彻底静默、零诊断。
  
  修法：解构分支与 Identifier 分支**同口径**消费 `asVar` —— 覆盖值取代 init 的**值**，原 init 仍求值
  （`((initSrc), asVar)` 逗号表达式 ⇒ 副作用与 throws 域保留；`@nudo:as` 是**类型覆盖**不是求值替换）。
  随后 `emitDestructure` 照旧逐项 `$get` / `$idx`，读到的自然是覆盖值 ⇒ 每个绑定按源键（对象模式）/
  位置（数组模式）取自己的槽；改名 / 默认值 / rest / 嵌套模式全部走原生语义，无特判。
  
  回归 `core-bug-080-as-destructure.test.ts`（8 例）：对象 / 数组模式、改名绑定、Identifier 对照不退化、
  无指令与未标注声明的负控制、原 init 的副作用保留、原 init 的 `throws` 域保留；捕获力已实证
  （回退该行 ⇒ 前 3 例失败）。
  
  循环头解构（`for (const {a} of xs)`）上的 `@nudo:as` **没有 initializer**（for-of 头不经
  `emitVariableDeclaration`，而是在 `emitForOfStatement` 内直接调 `emitDestructure`）⇒ 该形态不施加覆盖，
  改为发一条显式 `nudo:directive-syntax`（详见下文「BUG-080 残留收口」）。
  
  ### BUG-080 残留收口：解构子名进绑定表 + 不可用的 `@nudo:as` 载体显式诊断
  
  上一节记录的两处残留已收口：
  
  **残留 A（假绿）—— 解构声明的子名此前不进顶层绑定表**（`$recordBinding` 只在 Identifier 分支登记）⇒
  该名字在别处被当作实参时解析不出类型 ⇒ `checkSource` 的 `varAbs` 查不到 ⇒ **调用点的契约检查被整条跳过**
  ⇒ 同一份值走 Identifier 形态会报 `nudo:constraint-violated`，走解构形态**一声不吭**。
  同一张表还喂 `collectAbsBindingsFromGraph`（hover / IDE 绑定）与 `mock-abs.ts` ⇒ 解构名在那些面上也没有 Abs。
  
  修法（`packages/core/src/algebra/exec/transpile/stmt/statement.ts` 的 `emitVariableDeclaration`）：
  解构分支按 Identifier 分支**同口径**登记绑定名（`$recordBinding(name, name)`，取自
  `collectPatternNames`）—— 只限**顶层 depth 0**；块内 / 形参 / catch / for 头不是顶层绑定（作用域正确）。
  覆盖对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装全部走原生语义，无特判。
  
  **残留 B（静默）—— `@nudo:as` 标注在无适用目标的语句上时被静默忽略**：`matchAsOverride` 只在
  `emitVariableDeclaration` 与 `emitReturnStatement` 被询问，而指令采集接受**任意语句**
  ⇒ 标在 for 头 / for-init / if / 表达式语句 / 函数声明上的 `@nudo:as` 被采集却施加不到任何东西
  ⇒ 类型不变 + **零诊断**（假绿）。
  修法（`packages/service/src/eval-injection.ts`）：目标形态白名单 = `VariableDeclaration` /
  `ReturnStatement` / `ExportNamedDeclaration`（其 `declaration` 是变量声明）；不在白名单 ⇒
  发一条既有的 `nudo:directive-syntax`（warning 级，不制造假红）且**不登记覆盖目标**。
  
  **重钉**：无。
  
  **文档**：`packages/website/docs/concepts/directives.md`（§`@nudo:as`）与 zh-Hans 镜像补两句 ——
  解构声明受支持（覆盖施加在初始化表达式上，每个解构名各自绑定推断类型）；其它语句形态上不再静默，
  而是报 `nudo:directive-syntax`。
  
  **残留**：无。上一版这里写「LSP agent 面采集内联指令时没有诊断通道 ⇒ 新诊断在 IDE 面不可见」——
  **实测不成立**：`nudo:directive-syntax` 经 `check-issues.ts` 的 `collectEvalReplacements(source, { diags })`
  → `directiveDiagIssues()` 进 `CheckIssue`，由 LSP 编辑面（`validation.ts` 的
  `collectCheckSupplementIssues` → `checkIssueToLspDiagnostic`，warning 级、`source: "nudo-check"`）
  与 agent check 工具（`agent-tools.ts` 的 check 工具）**都会发布**；只有
  `buildLspInjection()`（hover / 补全的注入表装配，不是诊断面）不带 diags 汇。新增回归
  `lsp-bug-080-directive-syntax-ide.test.ts` 钉住：非法载体（表达式语句 / 函数声明）在编辑面与
  推送面各恰好 1 条 `nudo:directive-syntax`（warning、不重复），合法载体（变量声明 / `return`）
  0 条（负控制）。
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [0650ef0]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
  - @nudojs/core@1.17.2

更早版本（56）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.8.3 {#pkg-lsp}

## 1.8.3

### Patch Changes

- 9ff1709: Fix bug-report category 14 (LSP IDE surface) — BUG-140.
  
  - BUG-140: `nudo:internal` (analysis failed ⇒ the gate cannot decide the file) is now
    published on the LSP diagnostic face too, so the IDE no longer shows a file that the
    CLI rejects with exit 1 as completely clean. The diagnostic is emitted from the shared
    analysis path, so every consumer (CLI, LSP, vite-plugin) sees the same source, and the
    CLI's own `nudo:internal` output is unchanged (no duplicate).
  
  The service-side emit of the diagnostic landed with the vite-plugin category commit
  (`packages/service/src/analyzer-orchestrate.ts`); this changeset covers the LSP-facing
  behaviour and its regression test.
  
  Regression test: `lsp-bug-140-internal-diagnostic.test.ts`.
  
  ### 追加：本轮 IDE / CLI 面修复
  
  `tmp/verify-bug.sh` 直接验证（exit 1 = 不再复现）：BUG-185、BUG-186、BUG-187、BUG-188、
  BUG-201、BUG-202、BUG-227、BUG-235、BUG-236、BUG-237、BUG-262、BUG-263、BUG-274。
  带新回归测试：BUG-024、BUG-034、BUG-071、BUG-090、BUG-091、BUG-104、BUG-105、BUG-133、
  BUG-134、BUG-136、BUG-146、BUG-014、BUG-019、BUG-044、BUG-074（16 个新测试文件 / 44 例）。
  
  口径变更（不是放宽断言）：
  
  - **BUG-133**：数值 case 只改 `u` 自己的槽位并能清掉诊断；**shape 形参**那组 fixture
    改为**撤回**该 action —— 唯一可用的文本改写会命中返回槽，且可证明无法清除诊断，
    与其改错槽位，不如不给这个 action。
  - **BUG-019 残留（语义未变）**：首次 `--freeze`（新增模式）写出的见证名仍是插入前
    坐标；`--freeze=update` 是修复路径（现已按最终文件坐标重算、保留已正确项、幂等）。
  
  未修复（同一子系统，已定位）：
  
  - **BUG-247 inlay 侧**：`packages/core/src/algebra/inlay.ts:304` 的 `generalizeFromAst`
    跑在 invariant 公理播种之外，`@nudo:invariant` 对 inlay 文本无效（公理与对照都打印
    `: number`）。播种入口 `invariantSpecsOf` / `assumePremisesPhiOf` 私有于
    `core/algebra/check.ts:672,831`，`withInvariantSpecs` 在
    `core/algebra/exec/runtime/state.ts:134` 且未从 `core/index.ts` / `core/internal.ts`
    导出。hover 侧已修（`=> 0 | number`）。
  - **BUG-140 回归测试重基线**：`const x = undefinedGlobalAtTopLevel` 在 BUG-073 之后归
    类为 `module-throw`（不再走 `internal` 回落），测试改为断言「错误级诊断必须发布」
    的同一契约（细节见 cat-03 追加）。
  
  既有测试更新（均为口径跟随，未删断言）：`lsp-bug-463-484-signature-param-names`
  （detail 改为 BUG-091 声明的格式、签名标签解析出真实返回类型）、
  `lsp-bug-711-nested-call-signature`（标签 `unknown` → 推断出的真实返回）、
  `cli-bug-63b-path-errors-face`（干净 `test --json` 基线新增 BUG-014 要求的
  `"errors": 0` / `"ok": true`）。
  
  ### 追加：三条回归的收口（env 诊断去重、调用点插入位、两条负控重钉）
  
  - `validation.ts`：`checkToLspDiagnostics` 里 `collectCheckSupplementIssues` 会把 service 的
    `envUnresolvedIssues` 也发一遍，而 editor 面**已有**专属 env 通道（`validateText` 与 pull
    两处显式调 `envUnresolvedDiags`）⇒ 同一事实两条通道各发一次（**重复诊断** 1 → 2 条）；
    且 check 通道那份对「按名字记录」的条目（`e.path` 是名字本身、非绝对路径）**不按本文件
    env 名单过滤** ⇒ 同目录别的文件的无 path 诊断被**误吸**。修：check 通道跳过
    `DIAG.envUnresolved`，事实归属交给 live 通道（它按本文件 env 名单/路径双向收窄，且缓存
    命中轮仍发布）。解锁 `env-unresolved-diag`（4 条）与 `lsp-bug-470-937` 第 2 条。
  - `server-code-actions.ts`：BUG-263 的形参身份把「形参位实参不是对象字面量」一律判为不可
    插入，而该实参若是**原始值字面量**（string/number/bool/null/bigint/template），运行时**不
    可能**是对象 ⇒ 形参身份自相矛盾、回落「唯一对象字面量实参」口径（多个仍不猜；表达式仍
    不下发，保住「绝不猜位置」）。解锁 `lsp-bug-737`（2 条）。
  - 两条 signatureHelp **负控**钉的 `(a: any, b: any) => unknown` 正是 **BUG-104** 判红的症状
    （声明空壳 label 与同面 hover / CLI 互斥）；空壳不采纳后给精确签名
    `(a: any, b: any) => number | string`（`a + b` 两侧 `any` ⇒ JS `+` 的 ToPrimitive 并集）
    ⇒ 按 BUG-104 声明的正确行为重钉 label，`parameters` 长度/参数名断言原样保留。
  
  ### 追加：BUG-135 与 BUG-247 收口（relax 真写推断面；inlay 内部 id 不外泄）
  
  - **BUG-135**：动作标题与 CLI 机器面都承诺「放宽到**推断面**」，但唯一实现只做
    `stripNumericPreds` ⇒ 落盘 `number()`（基类型），既不是推断面、也**消不掉**诊断
    （`any ⊭ number()`），且没有落盘后验证门。修：`lsp/src/a6-relax.ts` 新增
    `relaxSidecarReturnToSurface()`（把 `fn(…, <返回槽>)` 的**第二个顶层实参**整体改写为给定推断面
    文本，含括号 / 字符串 / 注释感知的实参切分）；`server-code-actions.ts` 取 **check 同源**推断面
    （`checkSource` → `NudoSig.abs`，与 CLI 签名行 / hover 同源）渲染为侧车文本（精确投影 ⇒
    `lit(0)` / `number().gt(40)` / `union(lit…)`；`any` ⇒ `any()`；widened/partial prim ⇒ 基类型），
    并加**落盘后验证门**（`sidecarRelaxClearsTarget` 增 `codes` 参数，重跑 check；诊断残留或界面
    装载失败 ⇒ **不下发**，与 BUG-134「不给消不掉诊断的假修复」同例）。
  - **BUG-247（inlay 侧）**：`entrySeedsOfFn` 的播种本身是对的（inlay 已随 `@nudo:invariant` 变
    `0 | number`）；残留真缺陷在**渲染**——`invariant-apply.ts` 铸造的内部 id `inv#N` 只在成员
    顶层 `var` 处被拦，循环值参与算术时（`inv#2 + 1` 是 **app** 项）漏网 ⇒ IDE 印
    `: inv#2 + 1 | NaN`，而 check / hover 印 `number | NaN`（内部 id 上屏 + 两面互斥）。修：
    `core/algebra/inlay.ts` 新增 `hasInternalInvId()` 走**整棵 term 树**，命中即退形状
    （`formatShape`），与 check 面同一位置渲染同源。回归含**真 LSP server** 的 hover / inlay 逐字对拍。
  
  ### 追加：BUG-196（add 面）—— add 模式新建的直写段也要带 `// derived-from:` 溯源行
  
  **症状**：`nudo.contract.emit` 的 **add** 模式下，本轮直写分支新建的段**永远不带**溯源行。
  根因是两步顺序的合成：① 直写分支（dry-run）把新段追加进基底 D；② 派生分支以 D 为基底时
  `findGeneratedSectionText` 在 D 里找到了这个**刚建的**段 ⇒ 命中 add 面「既有段不可动 ⇒
  `no-change`」跳过 ⇒ 标签行被丢弃。后果：add 面与 update 面对同一份输入收敛出不同字节，
  且下游「靠 `derived-from` 反查根」失去锚点。
  
  **修法**（不改 add 面「既有内容不动」的契约，只区分「本轮新建」与「此前既有」）：
  - `packages/service/src/emit/interface-derivation-emit.ts`：`emitDerivedFromRoot` 新增可选
    `directCreatedSections`（= **本轮**直写分支新建的段名）。add 面只在
    「直写负责（`directSections`）+ 本轮新建（`directCreatedSections`）」时允许把标签行并进去；
    此前既有的段仍走原 `no-change` 跳过。合并后与既有段逐字相同 ⇒ 仍按 `no-change`（不空转 rewrite）。
  - 组装面：这类段**已在基底里** ⇒ add 面必须**就地替换**（新增 `replaceSectionsInPlace()`，
    段边界同 `collectGeneratedSectionsRaw`：`@generated` 头 → export 语句末，段外字节与段序逐字保留）；
    旧实现只做「追加」，会把同一导出名写成两段（非法 ESM ⇒ 整份侧车装载失败）。既有新段的追加路径不变。
  - `packages/lsp/src/agent-tools.ts`：`serializedEmit` 在 `mode === "add"` 时传
    `directCreatedSections: new Set(direct.written)`（add 面 `written` 恰好 = 本轮新建段；update 面
    无此语义，不传）。CLI 不受影响（`contract-emit.ts` 的派生分支恒为 `mode: "update"`）。
  
  **回归**：`lsp-bug-196-single-writer-sidecar.test.ts` 的 add 用例扩为断言
  「直写正文 + `// derived-from: lib.js:tag` + 同一段只有一份 + 收敛态逐字节（与 update 面相同）+
  根侧车只写一次」；新增 add 幂等用例（第二跑逐字不变、不写盘、不报 `Updated`）。
- 37e9aa0: Fix bug-report category 17 (vite-plugin gate surface).
  
  - BUG-110: the plugin's report face and gate face agree on `ignoreThrows`, so the same
    project no longer yields contradictory verdicts between the two faces.
  - BUG-111: project-level env is resolved from the project root rather than the importing
    file's directory, and env-module exports are merged with `mergeHarvestUnderEnv` instead
    of object spread — so adding an unrelated `@nudo:env` line no longer flips the gate from
    green to red, and harvest-only exports are no longer dropped.
  - BUG-221: project-level env resolves against the project base dir, so the plugin gate
    matches the evaluator.
  - BUG-222: a project-level env load failure is no longer silent in the plugin; it reports
    `nudo:env-unresolved` like the CLI and LSP instead of a false green.
  
  Regression tests: `vite-bug-110-*`, `vite-bug-111-*`, `vite-bug-221-*`, `vite-bug-222-*`.
  
  Note: BUG-140 (listed in this category file but whose defect is the LSP diagnostic face
  missing `nudo:internal`) is NOT covered here; it belongs to category 14.
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [206713f]
- Updated dependencies [0650ef0]
- Updated dependencies [fe03e18]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
- Updated dependencies [9ff1709]
- Updated dependencies [37e9aa0]
  - @nudojs/core@1.17.2
  - @nudojs/service@1.10.3
  - @nudojs/parser@1.5.6

更早版本（60）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.6 {#pkg-env}

## 0.5.6

### Patch Changes

- afd7c36: Fix bug-report category 15 (node / web host environment modeling) — 12 defects.
  
  - BUG-125: `crypto.getRandomValues` (and the `crypto.webcrypto` / `Crypto` / global
    `crypto` faces) now accept the integer TypedArray domain and reject plain Arrays,
    float views and primitives with a definite `TypeError` instead of returning `unknown`.
  - BUG-148: host objects that model slots as `unknown` (web `Response.body`,
    `Headers.getSetCookie`, `document.location`; node `Event` / `CustomEvent` / `Request`)
    now carry their real slot types.
  - BUG-149: `performance.mark` / `performance.measure` return `PerformanceMark` /
    `PerformanceMeasure` brands instead of throwing.
  - BUG-150: `crypto.subtle` call sites widen the rejection reason to
    `OperationError ∪ TypeError` (the static reason stays `OperationError`).
  - BUG-153: 13 undeclared browser globals are now modeled (`FormData`, `Blob`,
    `BroadcastChannel`, `DisposableStack`, `AsyncDisposableStack`, `PerformanceMark`,
    `PerformanceObserver`, `ReadableStream`, `ReadableStreamBYOBReader`,
    `ReadableStreamDefaultReader`, `URLPattern`, `WritableStream`,
    `WritableStreamDefaultWriter`).
  - BUG-154: `keys` / `values` / `entries` of the iterable families (node `Headers` /
    `FormData`; web `Headers` / `FormData` / `URLSearchParams`) are modeled as total
    iterators instead of degrading to `unknown`.
  - BUG-155: `AbortSignal.any` is function-valued, and the 10 `WebAssembly.*` /
    `Temporal.*` members are modeled as constructors.
  - BUG-161: the web constructor instance faces keep their brand (12 faces), so
    `instanceof` matches the runtime instead of reporting `Object` / `false`.
  - BUG-193: `Buffer`'s static table no longer carries members the host does not have, and
    the `node:buffer` module face is modeled.
  - BUG-255: `path.posix` / `path.win32` expose `parse` / `format` from one shared source
    of truth with `path`.
  - BUG-256: `process.title` is a string slot (it previously folded to `undefined`).
  - BUG-257: `util.types` models all 43 host predicates (35 were missing).
  
  Regression tests: `env-bug-125-*` … `env-bug-257-*` (12 files).
  
  ### 追加：`env-bug-64` 负控重钉（依据 BUG-160）
  
  `env-bug-64` 的负控钉的是「删掉 env 声明、回落宿主 ⇒ `TextEncoder.encoding` 退成
  `undefined`（**确定的错值**）」，其前提是宿主路**没有**实例面建模。BUG-160 要求的正确行为是
  `TextEncoder` 实例面 = `encoding`（只读访问器，恒 `"utf-8"`）+ `encode` / `encodeInto`，且
  **成员读不得折 `undefined`** ⇒ 负控改为断言宿主路真值 `'"utf-8"'`（宿主实测同值）；env 声明
  面仍是放宽的 `string`，上一行断言未动。
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [0650ef0]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
  - @nudojs/core@1.17.2

更早版本（56）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.4.6 {#pkg-harvester}

## 0.4.6

### Patch Changes

- 7231e87: Fix bug-report category 16 (harvester) — all 13 defects.
  
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
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [206713f]
- Updated dependencies [0650ef0]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
- Updated dependencies [afd7c36]
  - @nudojs/core@1.17.2
  - @nudojs/parser@1.5.6
  - @nudojs/env@0.5.6

更早版本（56）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.6.3 {#pkg-vite-plugin}

## 0.6.3

### Patch Changes

- 37e9aa0: Fix bug-report category 17 (vite-plugin gate surface).
  
  - BUG-110: the plugin's report face and gate face agree on `ignoreThrows`, so the same
    project no longer yields contradictory verdicts between the two faces.
  - BUG-111: project-level env is resolved from the project root rather than the importing
    file's directory, and env-module exports are merged with `mergeHarvestUnderEnv` instead
    of object spread — so adding an unrelated `@nudo:env` line no longer flips the gate from
    green to red, and harvest-only exports are no longer dropped.
  - BUG-221: project-level env resolves against the project base dir, so the plugin gate
    matches the evaluator.
  - BUG-222: a project-level env load failure is no longer silent in the plugin; it reports
    `nudo:env-unresolved` like the CLI and LSP instead of a false green.
  
  Regression tests: `vite-bug-110-*`, `vite-bug-111-*`, `vite-bug-221-*`, `vite-bug-222-*`.
  
  Note: BUG-140 (listed in this category file but whose defect is the LSP diagnostic face
  missing `nudo:internal`) is NOT covered here; it belongs to category 14.
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [206713f]
- Updated dependencies [0650ef0]
- Updated dependencies [fe03e18]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
- Updated dependencies [9ff1709]
- Updated dependencies [37e9aa0]
  - @nudojs/core@1.17.2
  - @nudojs/service@1.10.3

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
