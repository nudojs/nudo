---
"@nudojs/core": patch
"@nudojs/service": patch
---

Fix bug-report category 01 (predicate algebra / arithmetic / constraint・leq / postcondition).

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
