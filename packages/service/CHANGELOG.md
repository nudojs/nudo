# @nudojs/service

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

## 1.10.2

### Patch Changes

- d726525: Fix the OSS real-package benchmark regressions (perf) and the `nudo:assign-mismatch` false positive.
  
  **Perf** — the analysis pipeline repeated whole-file work per candidate:
  
  - `localNamedExports` (source → local export-name table) is now memoized per source text and computed **once** per candidate loop instead of once per candidate. It parses with `errorRecovery`, which deliberately bypasses the AST LRU ⇒ a single-file analysis re-parsed the whole file **5 151 times** (451 MB of repeated parsing; the TS strip pass alone 36.6 s). A single `commander/lib/command.js` analysis went from **59.2 s → 4.1 s**.
  - Function-directive scopes (`listFnDirectiveScopes`) are memoized per AST object (the scope walk was repeated per function × per refine site).
  - The source-level lexer scan (`scanSource`) and the file-level directive gate ranges (`bodyGateRanges`) are memoized per source text — the three file-level directive extractors each re-walked the whole AST.
  - The TS strip pass is skipped for JS-mode sources: the `jsx`-only plugin set cannot produce TS-only nodes, so the pass was a structural no-op that still paid two full AST walks per parse.
  - The `@nudo:` directive count inside the strip pass now runs only when the caller asks for a report (it was dead work on every parse).
  
  **Fix** — `nudo:assign-mismatch` no longer fires on **function parameter** reassignment. A JS parameter has no declared type: the analysed "previous value" is the shape of the actual argument at that call site, so normalising a parameter (`global(globals) { globals = [].concat(globals); … }` in yargs) was reported as `arr ⊭ prim string` — a false positive on the OSS corpus. The check keeps its obligation for bindings with a declared value (`let n = 1; n = "str"` still reports).
- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/env@0.5.5
  - @nudojs/harvester@0.4.5
  - @nudojs/parser@1.5.5

## 1.10.1

### Patch Changes

- 0438f10: Fix evaluator correctness and remove duplicated machinery:
  
  - Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, suppress undefined-literal narrowing facts when the name is bound, and honor the same bindings in callee position (`NaN(1)`) and at the expression entry (declarations inside the expression itself).
  - Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
  - Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
  - Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
  - Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
  - Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.
- 6ebf5a4: Evaluator engine correctness, host transpile cutover, and dedupe.
  
  - Fix `Object.assign` second-class calls (`const g = Object.assign; g(target, src)`, `.call`/`.apply`) so obj/tuple targets are mutated in place with native alias visibility; direct and builtin paths now share one `performObjectAssign` core. Frozen targets only reject a real `[[Set]]` (empty/null/undefined sources no longer report a false TypeError; unknown key sets become may-throw), and sealed targets dispatch own accessors through `$set` (setters still run; getter-only still rejects).
  - Fix function-value join/dedupe: branch-dependent expando slots, nested function values, anonymous/named same-shape functions, `optionalParams`/`ctor`/`paramTypes`/`returnType` differences no longer fold to a wrong exact value. `$copy` snapshots fn shapes independently and migrates impl/slot ownership, null-proto, and fresh-instance identity. Alias groups are scoped lexically, so fork snapshots (`$copy`) no longer break `const b = a` alias identity across nested functions or shadowed blocks.
  - Make `renameShape`/`snapshotAbs` structure-preserving: tuple `holes`/`rest`, fn `slots`/`optionalParams`/`ctor`, obj slot `symbolKey`/`internal`/`inherited`, brand/eff metadata.
  - Fix compiled-body lexical scope and strictness: block-scoped `let`/`const`/`for`/`catch`/class/static-block bindings no longer hide enclosing closures; `strict` is threaded from ESM/CJS source through core/service/parser Abs-fn constructors, and class bodies are always strict. An explicit `"use strict"` directive prologue now marks a CJS script source strict, and CJS class-method bodies compile as strict too.
  - Replace the transpile→ESM-text→regex-rewrite round-trip with `transpileModule()` metadata + host-target emission (`__nudoBindImport`/`__nudoExport*`, no runtime import line, no generated-code re-parse). Analyze-mode top-level stripping now happens during emission. Namespace-only `import * as ns` now emits valid ESM.
  - Fix `$set` fail-closed on nullish/non-Abs receivers: the host-write handler now reports hits explicitly instead of using `undefined` as a sentinel, so a write to a non-Abs receiver returns that receiver instead of crashing on `.shape`.
  - Fix `$switch` implicit no-match arm: it no longer contributes an empty yield collector, so single-arm switches keep precise generator element types instead of degrading to `unknown`. The switch-level snapshot/join set is pinned to outer bindings only: arm-local `let`/`const`/`function`/`class` (including nested blocks, `for` heads and `catch` params) never enter it, so an arm-local name can no longer copy/rebind a same-named outer binding and break its alias identity.
  - Fix free-write collection for nested functions: hoisted `var` / function-declaration names of a nested function body now shadow writes inside that body instead of being recorded as free writes of the enclosing unit (previously emitted `$copy(<name>)` for a binding that does not exist there, yielding a false `ReferenceError`/`never` and an error-level `nudo:entry-may-throw`). Block-scoped declaration shadowing is now per statement list rather than a recursive union, so a nested-block `let` no longer drops a legitimate sibling write from the fork set.
  - Module top level is now an alias-group scope boundary: `const b = a` at module scope keeps its alias identity across a top-level fork instead of leaving one name on the pre-fork object.
  - `Object.assign` onto a sealed / non-extensible brand (prototype) target now rejects a new own key with TypeError (native parity) while existing writable keys, own setters and owner-class members still assign.
  - Dedupe shared machinery: fork-arm wrapper, structural Abs keys, dependency-aware memo store + module identities, class-instance bridge, numeric bounds, internal-slot visibility, env-skip derivation from `NAMESPACE_GLOBALS`, proto walk, path projection, sum-arg dispatch, `undefAbs`, RegExp brand predicate, export-call exception skeleton.
  - **BREAKING**: Remove the dead public engine symbols instead of deprecating them: the module-level `phi` stack (`currentPhi`/`pushPhi`/`popPhi`/`resetPhi`/`withPhiConstraint`/`describePhi`), `$while`/`$forIter`/`$asyncReturn`/`$staticInit`/`$thisGet`/`$thisSet`, the HOF promotion helpers (`createHofCollectCtx`/`promoteParamShape`/`tryPromote*`/`HofCollectCtx`/`AstEnv.hofCollect`), the dead relation helpers `alphaOf`/`betaOf`, and `generalizeAll`. `$staticInvoke` also leaves the public surface (previously exported from `.` and `./exec`): it is now engine-internal, still implemented for the `check-may-throw` class bridge. Retire dead internal `language.ts` exports (keep `getClassChain`/`wrapPromise`).
  
    Migration: every removed name was a dead engine internal with no product-surface consumer — drop the imports from `@nudojs/core` / `@nudojs/core/exec`; `$staticInvoke` is no longer reachable from a host.
  - Rename `exec/class-regex.ts` to `exec/regexp-runtime.ts` to match its RegExp-brand role.
- Updated dependencies [f1d4958]
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/env@0.5.4
  - @nudojs/core@1.17.0
  - @nudojs/parser@1.5.4
  - @nudojs/harvester@0.4.4

## 1.10.0

### Minor Changes

- 2d96c29: `@nudojs/service` **新增**公开导出 `absolutizeEnvSpec`（env 规格的绝对化入口）
  ⇒ 纯**增量**（additive）⇒ minor。
  
  fix: 并发 review 收口的 10 条缺陷（闸门假红/假绿 · IDE/CLI 口径分裂 · 机器面谎报）
  
  上一片（并发 review 收口 25 条 + 族 65/1094 两轮）之后又做了一轮**并发
  review**（5 个分片 × 只读审查 + 逐条代码层复核）⇒ 查出 **10 条**该轮改动
  引入或遗留的缺陷，本片一次性收口。核心仍是**闸门可信度**：`nudo check` 是
  CI 闸门，**假红**卡死用户仓库、**假绿**让门禁空转。
  
  本片新增 **7 个回归测试文件**（全部含「修前红 / 修后绿」实测），另补 1 个
  残留洞（指令作用域闸门）。
  
  ---
  
  ### 高危（4 条 · 闸门级）
  
  - **构造器 may-throw 证据被整体丢弃且「归因落点」根本不存在 ⇒ L2 闸门假绿**
    （`core/algebra/check-may-throw.ts` · `core/algebra/scan-top-functions.ts` ·
    `core/algebra/check.ts`）：实例方法桥把构造器跑在独立 may-throw 会话里
    （软效果不进方法域 ⇒ 假红已消除），但**硬抛**（无条件 `throw`）也被
    `catch {}` 吞掉；而注释声称"归因给 `new C()` 入口"——**该入口并不存在**
    （`scan-top-functions.ts` 只登记 `Class.method`，跳过 ctor）⇒
    `export class A { constructor(x){ throw new TypeError("boom"); } }`
    在 check 闸门与 test 见证面**双面零诊断**（0 error / 0 warning / exit 0）。
    修法：新增**类导出入口**普查面 `listClassEntryNames`（`new C()` 是真实入口）
    ⇒ 类入口并入 L2 入口表（`check.ts`），构造器的**硬抛**进 throws 域、报在
    **类声明位置**；构造器的**软效果**（any 补位的强制转换）仍不进 ⇒ 普通类
    不触发 error 级 `nudo:entry-may-throw`（假红不回归）。另：类入口的
    `@nudo:throws` 申报落点 = 构造器 scope（`C.constructor`）⇒ 用户已申报不再被卡
    （`declaredThrowsForEntry`）。
  
  - **同一「裸实例兜底」在值域通道产出自信的错值 ⇒ 方法签名折 `never` + 假红**
    （`core/algebra/generalize.ts`）：兜底实例的内层是**空 obj** ⇒ 构造器写过的
    字段被建模成「确定不存在」⇒ `this.v` 读成**确定的 `undefined`**、
    `this.v + 1` 读成**确定的 `NaN`**；`this.v.toFixed(2)` 在**虚构实例**上抛
    ⇒ 签名 **`never`**（谎称"该方法必抛、恒返回 never"）⇒ 连带 **error 级
    `nudo:entry-may-throw`**。修法：兜底实例内层改 **unknown**（构造器写过的
    字段 = **不可知**，不是"缺槽"）⇒ 不折确定错值、不在虚构实例上抛 ⇒ 签名落
    `unknown`，且方法体照常求值（不退化成整体 opaque）。与上一条同源，两处
    **就地复刻**的孪生实现已互相点名，防止再漂移。
  
  - **Proxy `getOwnPropertyDescriptor` 不变量新增规则的 3 处阈值错误 ⇒ 假红**
    （`core/algebra/builtins/object/descriptor.ts`）：上一片新增的
    `enforceProxyGetOwnPropDescInvariant` 在 Object 面与 Reflect 面同时接线，
    三处口径与 node v26.10.0 不符 ⇒ **native 不抛、引擎抛 TypeError** ⇒
    error 级 `nudo:entry-may-throw` ⇒ 直接卡 CI：
    1. **形态一致性检查未以「靶属性不可配置」为前提** ⇒ ES2024
       `IsCompatiblePropertyDescriptor` 只在 `current.[[Configurable]]` 为 false
       时比对数据/访问器形态，引擎无条件抛 ⇒ **可配置**靶 + 异形态陷阱整类误判；
    2. **`frozen` 被当成 `enumerable:false`** ⇒ `Object.freeze` 只改
       writable/configurable、**不改 enumerable** ⇒ 冻结靶 + 诚实报告描述符的
       Proxy 被判违约（同处注释"frozen ⇒ enumerable 全 false"本身是事实错误）；
    3. **靶侧标志/extState 只查「内层 obj」不查「接收者」** ⇒ `defineProperty` 把
       标志记在接收者上（brand 靶记在 brand）⇒ 取不到 ⇒ 回落 `configurable:true`
       ⇒ **陷阱报告与靶完全一致也被判违约**。
    修法：形态比对收进「靶不可配置」分支；`frozen` 不再改 enumerable；靶侧三标志
    统一复用同文件 `currentPropDesc`（接收者优先、内层兜底）。**不可配置**靶 +
    异形态陷阱仍抛（能力未关）。
  
  - **项目级 env 的「两层基准」只做了一半 ⇒ 分析器通道丢 env 全局 / IDE 与 CLI
    结论相反**（`service/src/analyzer-orchestrate*.ts` · `service/evaluator/env-loader.ts`
    · `lsp/src/validation.ts` · `lsp/src/agent-tools.ts`）：上一片把项目级 env
    改为**按项目根**解析，但只改了**预载**侧；**收集期**仍用原始相对名查表，
    而相对说明符只有唯一候选（按文件目录解析）⇒ 与预载登记的 key 不匹配 ⇒
    **只要被分析文件声明了任何 `@nudo:env`（哪怕是内建名 `node`），项目级 path
    env 就对它完全不可见** ⇒ 返回面退 `never` + 假阳 `nudo:builtin-unknown`；
    同时 LSP 的 `env-unresolved` 诊断按「记录时的 preload 目录」归档 ⇒ 项目级 env
    的失败被**静默吞掉**（IDE 假绿，CLI 同刻仍报）。
    修法：绝对化规则收进 `env-loader.ts` 的**单一 helper**（`absolutizeEnvSpec`），
    预载侧 / 收集期 / 缓存键 / LSP 注入 / LSP 诊断**五处共用**；LSP 诊断按
    `fileEnvBaseDir + projectEnvBaseDir` 双取合并去重。改后 IDE 与 CLI 对同一
    文件结论一致。
  
  ### 中危（4 条）
  
  - **`migrate strip --write` 把「未写盘」的成功行报成 `wrote`**（`nudojs/src/migrate.ts`
    · `nudojs/src/commands/migrate.ts`）：库面在有失败时整批零写盘（原子性）并给
    成功行附注记，命令层却把注记行当普通成功行推入 `results`，人类面用
    `opts.write ? "wrote" : "dry"` **无条件**打 `wrote` ⇒ 同一行既说 "wrote"
    又说 "not written"，而磁盘上根本没有 `.js`；`--json` 侧只有一条自由文本
    `notes` 能区分 ⇒ 机器消费方极易误判已产出。修法：新增机器可判定的
    **`writeStatus`**（`"written"` / `"not-written"` / `"planned"`），人类面按逐行
    状态措辞（`wrote` / `not written` / `dry`）。
  
  - **HOF 元组元素域把**已知**的 null/undefined 压成 `any`**（`core/algebra/hof.ts`）：
    引擎把 `null`/`undefined` 建模成 **`unknown` 形状 + lit 项**，而元素域按
    **shape kind** 判"域是否可知" ⇒ 把**已知**类型误判成"域不可知" ⇒
    `[null]` 的元素域从 `null` 退成 `any`、`[1,null]` 退成 `any`（应为
    `number | null`）；`any` 是"自信的任意值"，参与算术即强制转换 ⇒ 记
    may-throw ⇒ L2 假红面。修法：三分类——已知 nullish（不参与异型判定、只贡献
    可空性，用仓内既有 `makeSum` 表达联合）、真·推断失败（退 **`unknown`**，
    不是 `any`）、其它（同型判定不变，异型仍退 `any`）。
  
  - **文件级指令的作用域闸门未覆盖 `ArrayExpression` / `ObjectPattern` / `ArrayPattern`**
    （`parser/src/directives/file-directives.ts` · `core/algebra/directive-scan.ts`）：
    写在数组字面量 / 解构模式里的 `@nudo:env` 被**静默提升**成整文件生效（零诊断，
    越权）。修法：两侧孪生闸门同步扩到三类嵌套体（两通道 23 组样例逐例一致）。
  
  - **引理账本写入是「死写」**（`core/algebra/check-return.ts`）：Φ 侧的消费在
    证明段里记进账本，而调用方传入的 `consumedAssume` 快照取自**调用之前** ⇒
    Φ 侧的写入永远读不到 ⇒ 账本与归因两套口径（changeset 宣称的"经
    `noteAssumeConsumed` 记进账本 ⇒ 归因可见"实际断在取数时序上）。
    修法：归因集**就地取账本**（读在写之后）⇒ 账本是"消费过"的唯一事实源，
    调用方快照退化为兜底。
  
  ---
  
  ### 验证
  
  - 全仓 `tsc --noEmit`（`pnpm run lint`）**0 错误**；`pnpm run build` exit 0；
  - `pnpm run test` 全量绿（**1757+ 文件 / 14500+ 用例**，exit 0）；
  - 新增 8 个回归测试文件，全部**修前红 / 修后绿**实测（红数由**回滚修复**逐条复核）：
    `core-bug-1095`（Proxy 阈值，22 例 · 修前 12 红）、`core-bug-1096`（构造器
    归因，11 例 · 修前 6 红）、`core-bug-1097`（HOF 元素域，15 例 · 修前 10 红）、
    `core-bug-1102` + `parser-bug-1101`（指令闸门，79 例 · 修前 12 红）、
    `core-bug-1103`（引理账本，5 例 · 修前 1 红）、`service-bug-1098` +
    `lsp-bug-1099` + `lsp-bug-1104`（env 两层基准，11 例 · 修前 6 红）、
    `nudojs-bug-1100`（migrate strip 写盘状态，6 例 · 修前 5 红）—— 合计 **149 例**；
  - 产品 CLI 面逐条复现核对：`nudo check` 对"构造器必抛"报 **error 级
    `nudo:entry-may-throw`（归在类入口）**、对"构造器软 throw"**零 error**；
    Proxy 三场景（可配置靶异形态 / 冻结靶 / brand 靶）**零 error**；
    `migrate strip --write` 失败批输出 **`not written`** 且磁盘**零写盘**、
    `--json` 带 **`writeStatus: "not-written"`**；项目级 env + 文件级 env 并存时
    `nudo check` 得 `f() => 42`（修前为 `never` + 假阳）。
  
  ### 已知边界 / 未闭合
  
  - **Proxy `gOPD` 仍有 3 处漏抛**（靶不可扩展且键不存在时报 `configurable:true`；
    靶不可写+不可配置而陷阱省略 `value`；靶为不可配置访问器且 get/set 身份不同）——
    **基线同样不抛**（非本次回归），新增抛点有制造新假红的风险 ⇒ 已把 node v26.10.0
    实测矩阵写进 `core-bug-1095` 测试文件注释，留待单独立项。
  - **不可配置访问器靶现在也会比对 `enumerable`**（原生确实抛）——属**收紧**，
    若有用例依赖旧的"访问器靶跳过该比对"需按原生重判。
  - **HOF 异型元素仍退 `any`**（`[1,"a"]`）——既有保守口径，本片未窄化成联合。
  - **真·未知 ⇒ `unknown`** 会让该 α 恰为返回类型时多一条 **warning 级**
    `nudo:unknown-inference`（级别 warning，不影响 L2 闸门）。
  - **进程级 `lastEnvBaseDir` 单槽**（同步 `analyzeFile` 路径下的**文件级**相对名）
    与 **Windows 下 `isPathEnvName` 只认 `/`** 均为既有基线，本片未动。
  - **MCP `nudo check` 工具面**（同步、无 path env 预载）与 **`migrate strip --json`
    顶层形态不统一**（成功=裸数组 / 失败=对象信封）仍待单独立项。
- 97f28ed: **BREAKING**: 产物面（dts / zod / standard / case）的**形参位形状**变了 ——
  数组解构形参现在按**元素下标**聚合成**元组**，TS 的 `this: T` 接收者标注不再
  被当成形参。
  
  谁会坏：消费方 `import` 生成产物并按**旧形状**调用的代码 ——
  
  - 数组解构形参（`fn({ a: number() })` 对 `[a, b]`）：dts 面此前给
    `{ a: number }`、zod 面给 `z.object({ a: … })`（与真实形参形态**颠倒**），
    现在给**元组**（`[ a, b ]` / `z.tuple([…])`）⇒ 旧形状的调用点类型不兼容；
  - `this: T` 接收者标注：dts 多一个形参（消费方吃 `TS2554` 假红）、zod 多一个
    字面量槽 `"this"`、standard 多一个幽灵导出 `<fn>_this` ⇒ 这些**幽灵位**现在
    全部消失。
  
  怎么迁移：重新生成产物；数组解构形参按**数组**传参；消费方若引用过
  `<fn>_this` 之类幽灵导出，直接删掉（它们本就不存在）。
  
  fix(service, nudojs): 期望判定严格化、数组解构的产物面按元素下标寻址、`--assume` 的界落到形参前提、`this` 接收者标注不进形参表
  
  - Bug 396（`@nudo:case` 期望判定）：`leqAbs` 的「同 prim 字面量视为可赋」捷径在
    **对象槽**位上连字面量相等性都不比 ⇒ `shape({ a: lit(2) })` 这类期望**永不被
    执法**（case 期望恒 `[ok]`、`nudo:case-expected` 零诊断 ⇒ 假绿），而同一份
    契约在手写侧车面走逐字段约束树能抓到 ⇒ 两面自相矛盾。`caseExpectedSatisfied`
    补一道「期望槽里的字面量按值比较」（含嵌套对象槽），**只**作用于期望判定，
    `leqAbs` 的既有语义一字不动（core 侧那一行不改 —— gold 的 `assign-compatible` /
    `wider` 依赖该口径）。
  - Bug 394（产物面）：**数组解构**形参的字段级侧车契约（`fn({ a: number() })` 对
    `[a, b]` 来说 `a` 是**下标 0 的元素**，不是属性键）此前被摊成**对象槽** ⇒
    dts 给 `{ a: number }`、zod 给 `z.object({ a: … })` ⇒ 产物输入面与真实形参形态
    **完全颠倒**（合法数组调用被判红、非法对象调用被放行）。现在 dts / zod /
    standard 三面都按**元素下标**聚合成**元组**（未契约的元素位留 `any`——无约束，
    不是 unknown），dts 的声明名渲染成数组形态 `[ a, b ]`。
  - Bug 397（产物半）：TS 的 `this: T` 是**接收者标注**、不是运行时形参 ——
    service 侧形参表入口 `extractFormals` 现在**兜底**过滤它并**重排 index**
    （index 是形参表内的位置 ⇒ 实参位靠它对齐）⇒ dts / zod / standard / case
    四个产物面不再多出一槽（dts 多一个形参 ⇒ 消费方吃 TS2554 假红；zod 多一个字面量
    槽 `"this"` ⇒ 对每一个真实调用值报假红；standard 多一个幽灵导出 `<fn>_this`）。
  - Bug 976（CLI 半）：`--assume` 声明的**界**此前被顶成写死的 `x>0` ⇒ 用户写
    `--assume 'x>-5'` 时观察面只给 `"pos"`（`x=-1` 的分支被当成不可达 ⇒ 说谎）。
    现在把**用户声明的界**（按形参名归并、同一形参多条取合取）落进形参自己的前提
    （**替换**写死的默认，不是与它合取），并与 core 半
    （`buildArgsFromAssume` 的 `bounds` 形参）同批接线；契约的义务与用户的界并存
    （契约 pred ∧ 用户界）⇒ 契约不被削弱、用户的界也不被顶掉。
- cc9b638: **BREAKING**: 重复声明 `@nudo:mock-module` 的诊断**码**与**默认严重级**变了 ——
  分析器通道此前把它一律报成 `nudo:module-missing`（**error**，fail-closed），
  现在按**错误种类**还原码：重复声明 ⇒ `nudo:mock-invalid`（**warning**，与 check
  面同码同级）；mock 文件缺失 / 装载失败 / 点名缺失 ⇒ `nudo:module-missing`
  （error，fail-closed）**逐字不变**。
  
  谁会坏：按**诊断码**分流 / 静音 / 快照的下游 —— 重复声明这一路径的码从
  `nudo:module-missing` 变成 `nudo:mock-invalid`，严重级从 error 变成 warning ⇒
  
  - 只静音 `nudo:module-missing` 的规则**不再**静音重复声明（改按
    `nudo:mock-invalid` 静音）；
  - 把 `nudo:module-missing` 当 error 断言的快照 / 闸门**变红→变黄**（重复声明
    不再拦构建）。
  
  怎么迁移：按**新码** `nudo:mock-invalid` 调整静音规则与快照；真正的模块缺失 /
  装载失败仍是 `nudo:module-missing`（error），语义不变。
  
  fix(service): 指令诊断的**码归因**与**文案贯通** —— `@nudo:mock-module` 重复声明不再被说成「模块缺失」（Bug 1062 / 1063 收口）
  
  上一版把两条指令的**本体**修好了（`@nudo:replace` 目标未命中 ⇒ 显式诊断；
  `@nudo:mock-module` 重复声明 ⇒ 显式诊断 + 导出名并集），但**码**在
  `nudo test` / `health` 面上**丢了**：分析器通道把 `composed.mockErrors`
  （**只有 message**）一律映射成固定码 `nudo:module-missing` ⇒「重复声明」被说成
  「模块缺失」（归因错误：码与文案不自洽），且重复声明这种**指令写法歧义**被按
  fail-closed 的 **error** 级上报。
  
  - **码归因**：分析器通道按错误**种类**还原码 —— 重复声明 ⇒ `nudo:mock-invalid`
    （warning，与 check 面同码同级：指令写法有歧义，导出表取并集 ⇒ 分析仍然
    sound）；mock 文件缺失 / 装载失败 / 点名缺失 ⇒ `nudo:module-missing`
    （error，fail-closed）**逐字不变**。
  - **文案贯通**：check 补充通道的 suggestion 按**具体种类**分族 —— 重复声明 ⇒
    「只保留一条声明」；导出名缺失 ⇒ 点名那个**缺失的导出**；表达式解析失败 /
    文件缺失 ⇒ 原句逐字保留。
  - **同族表缺口**：service 侧 body-read 的「接收者无歧义是 string」证据集补
    `trimLeft` / `trimRight`（宿主 `String.prototype` 上真实存在的
    `trimStart` / `trimEnd` 别名；**Array 上不存在**这两个方法 ⇒ 不触发该表刻意
    排除 `includes`/`indexOf` 的那类歧义）⇒ `param.trimLeft()` 能推出
    `param: string()`（补前只是**保守漏证据**，不是假红）。
  
  回归钉 `packages/service/src/__tests__/service-bug-1062-1063-diag-attribution.test.ts`：
  码归因（含「不得再被说成 `nudo:module-missing`」负控）、既有码不被误改、
  suggestion 分族文案、body-read 的 `trimLeft` 推断 + `includes` 负控。
- b0878e3: **BREAKING**: standard 面的**返回面导出名**从 `<fn>Return` 改名成 `<fn>Output`
  （名字不再随符号来源翻转）。
  
  谁会坏：生成产物后 `import { <fn>Return } from "*.nudo.standard"` 的消费方 ——
  **有返回契约**时导出名此前叫 `<fn>Return`、走观测时叫 `<fn>Output`，现在**恒叫**
  `<fn>Output` ⇒ 旧名 `import` 断（消费方 `tsc --noEmit` 会红）。
  
  怎么迁移：把 `import { <fn>Return }` 改成 `import { <fn>Output }`（内容不变：
  仍按「契约返回优先，否则观测返回」取值）；重新生成产物。
  
  `nudo export` 的 standard / guard 两面不再丢符号名与可选性。
  
  - **standard 面的返回面导出名恒为 `<fn>Output`**（Bug 614）。此前返回面的名字
    与符号来源耦合：有返回契约时叫 `<fn>Return`，走观测时叫 `<fn>Output`，同一
    个函数换个源码状态就换了名字——下游 `import { <fn>Output } from
    "*.nudo.standard"` 直接报错，而同一次导出的 zod 面**恒叫** `<fn>Output`，
    两面同物异名。现在名字与来源解耦，恒叫 `<fn>Output`（内容仍按「契约返回优
    先，否则观测返回」取值）。
  - **standard 面的顶层形参保住可选性**（Bug 627）。顶层形参导出走的是独立值节
    点（不是对象槽），结构上无处挂 `optional`，契约允许的 `undefined` 被运行时
    拒收（`number().optional()` 的形参，`act_x.validate(undefined)` 应当通过）。
    现在契约级可选性（`StandardSchemaFunctionSpec.inputs[].optional`）与声明级
    可选性（默认形参）都被保真：可选位的整参校验器接受 `undefined`
    （`T | undefined`，与 zod 面 `.optional()` 同判据），`<fn>Input` 的对应槽位
    带 `optional`（键可缺席）。
  - **guard 面的导出名可以模块内去重**（Bug 608）。守卫名此前只过字符清洗
    （`A.b` → `isA_bOutput`），两个不同的源函数清洗后同名就会在同一份守卫产物里
    产生两个 `export function isA_bOutput`（node 下 `SyntaxError`，tsc 下
    `TS2323` / `TS2393`）。`generateGuardFunctionFromAbs(name, abs, used?)` 现在
    接受一个**模块级去重集合**（与 zod 面 `safeExportIdent(name, used)` 同一套
    口径：`isA_bOutput` / `isA_bOutput_2`）；不传该集合时行为与旧版一致。
- e6c4586: agent 工具面的载荷**新增**了 `assertions` 段 / `pathErrors[]` 段与新诊断码
  （`nudo:path-not-found` / `nudo:path-not-target`）；`@nudojs/service` **新增**了
  一批公开导出（`mergeCheckIssues` / `directiveDiagIssues` / `mockFromErrorIssues` /
  `envUnresolvedIssues` / `collectCheckSupplementIssues` / `buildTestReport` /
  `pathNotFoundError` / `targetPathError` / `formatPathErrorText` 等）⇒ 纯**增量**
  （additive）⇒ minor。
  
  LSP agent 工具面（`nudo/check` / `nudo/test`）与 CLI 的通道对齐：补回
  check 的补充诊断通道、test 的断言汇总、imported 段、路径错误信封与
  「分析目标」闸门。
  
  - `nudo/check` 此前只跑裸 `checkSource`，CLI 侧并入 check 报告的三条补充
    通道（指令文法 `nudo:directive-syntax`、mock 装载失败
    `nudo:module-missing`、path env 未解析 `nudo:env-unresolved`）一条都没接
    ⇒ 同一文件 CLI / LSP 编辑器面 / agent 面给出三份 issue 集（agent 面把
    「指令写错了」整条吞掉，mock 文件缺失判绿）。并入逻辑下沉到
    `@nudojs/service`（`mergeCheckIssues` / `directiveDiagIssues` /
    `mockFromErrorIssues` / `collectCheckSupplementIssues`），三面共用同一份。
  - `nudo/test` 此前没有 `assertions` 段 ⇒ 消费方分不出「见证通过」与「见证
    失败」。现在并入与 CLI `nudo test --json` 同口径的
    `assertions`（passed / failed / unchecked，service 的 `buildTestReport`）。
  - `nudo/test` 的文本面此前**不渲染** imported（外部）函数 ⇒ CLI 有的
    `(imported)` 段在 IDE 面整段消失，而头部计数仍把外部 case 算进去
    （「3 case」只印 2 条）。现在按来源模块分组渲染，段头
    `--- <mod> (imported) ---`。
  - `nudo/test` 的 `functions` 过滤只重算**本地** case 数 ⇒ `summary.cases`
    与自身 payload 矛盾（summary 说 1、payload 躺着 2）。外部函数不在过滤
    范围内，其 case 仍留在 payload 里 ⇒ 计数改为与 payload 同源。
  - `nudo/check` / `nudo/test` 此前没有「分析目标」闸门 ⇒ 对侧车契约文件报
    「0 fn / 0 error」判绿（CLI 对同一文件 exit 1「Not an analysis
    target」），`nudo/test` 还把契约 DSL 构造器（`fn(...)` / `shape(...)`）
    当成真实调用点报成 case。入口现在复用与 CLI 同一份目标判定
    （`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除），非分析目标返回
    `nudo:path-not-target`。
  - `nudo/check` / `nudo/test` 此前对不存在的文件只返回裸 `ENOENT` 文本
    （`format:"json"` 也不返回 JSON）。现在走结构化路径错误通道
    （`pathErrors[]` + `nudo:path-not-found` + suggestion），与 CLI
    `check --json` / `test --json` 同构。
  - `nudo/test` 的 `functions` 入参此前零校验：传字符串被逐字符建集合（函数
    全被滤掉 ⇒ 全空报告的假空结论），传数字 / 对象时过滤被整体跳过（静默
    失效）。畸形入参现在一律工具错误（`isError: true`）。
- e6c4586: 三个 contract 工具**新增**入参 `from?: string[]`（`--from` 等价通道），`@nudojs/service`
  **新增**公开导出 `collectCallsiteRecords`（+ 类型 `CallsiteRecords`）⇒ 纯**增量**
  （additive）⇒ minor。
  
  fix(lsp,service): 族 25 A2 —— 契约面四条缺陷（762 / 765 / 766 / 994）
  
  - **762** `nudo.contract.emit` 现在与 CLI `nudo contract --emit` **同序同口径**：
    先 `emitDerivedFromRoot`（root 驱动下行推导），再 `emitInterface`（本地侧车）。
    此前工具**从不**调派生步 ⇒ CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面
    永远不产生，且结果文本把「引擎没做的那一步」说成「name-clash」——误导性诊断。
    下游侧车的写盘边界与本地侧车同口径（必须落在 workspace roots 内）。
  - **765** 源文件 open buffer 与磁盘文本不一致时**拒绝写盘**（可诊断错误：
    save or discard before emit）——此前只挡了侧车自己的脏 buffer，源文件的脏
    buffer 会把**未保存**的代码形状写进侧车，磁盘源码却一个字节没变。
  - **766** emit 写盘边界改按**路径分量**判定逃逸（`..` 或 `..` + 分隔符），
    不再误杀 `..dotted.js` / `...triple.js` / `..cfg/x.js` 这类合法路径名；
    root 外的文件与指向 root 外的符号链接**仍然拒绝**。
  - **994** 三个 contract 工具（`nudo/contract` / `nudo/contract.draft` /
    `nudo/contract.emit`）新增 `from?: string[]`（`--from` 等价通道）：跨文件
    调用点证据参与契约求解，接口面/草稿/落盘与 CLI `nudo contract --from` 同口径。
    证据采集下沉到 service：新增导出 `collectCallsiteRecords`（+ 类型
    `CallsiteRecords`）。
- e6c4586: **BREAKING**: LSP **协议契约**变了（`packages/lsp/PUBLIC_API.md` 这份**冻结清单**
  本版本同步更新）——
  
  - 失败面统一成 `{ success: false, error, isError: true }`：
    `nudo/selectCase` / `nudo/selectContract` / `nudo/getActiveCases` 此前对
    非法入参**答 `{"success": true}`**（或幽灵条目），现在答结构化错误信封 ⇒
    客户端按 `success` 分支的代码路径变了；
  - `AGENT_TOOL_SOURCES` 的**值**同步为新的共享数据源（`analyzeFile` →
    `analyzeFileAsync`；`check` → `checkSource + mergeCheckIssues +
    serializeCheckJson`；`test` → `analyzeFileAsync + buildTestReport +
    serializeCaseJson`）⇒ 依赖这张表反推「命令 ↔ 数据源」的客户端读到不同的值。
  
  谁会坏：把 `nudo/selectCase` / `nudo/selectContract` 的**失败**当成功处理的
  客户端（此前恒 `success:true`，现在会拿到 `success:false` + `isError:true`）；
  以及读 `AGENT_TOOL_SOURCES` 做能力判断的客户端。
  
  怎么迁移：客户端按 `{ success: false, error, isError: true }` 分支处理失败
  （`packages/lsp/PUBLIC_API.md` 与两份 API 文档已同步）；不要再按
  `AGENT_TOOL_SOURCES` 的**字面**判能力，改按命令名判断。
  
  `@nudojs/service` 侧**新增**公开导出 `pathEnvPreloadFingerprint` ⇒ 纯**增量**
  （additive）⇒ minor。
  
  族 25 收口接线（6 项）：把跨片耦合的缺口补上，并让文档与工具面说同一件事。
  
  - **`testTool` 改异步入口**（Bug 993）：A4 把 `whatIf` / `suggestCase` / `trace`
    改成了 `analyzeFileAsync`（path 型 env 只能异步预载），但 `testTool` 属另一片
    的函数级边界 ⇒ 冷进程 `nudo/test` 首调仍是 env-less（`"unknown"` + 1 条误导
    诊断）。⇒ 改 `async` + `analyzeFileAsync`（**签名变更**：
    `AgentToolResult` → `Promise<AgentToolResult>`），同步调用点与既有测试。
  - **`AGENT_TOOL_SOURCES` 值同步**：工具面真换了数据源，表与文档要跟着走 ——
    `check` → `checkSource + mergeCheckIssues + serializeCheckJson`、
    `test` → `analyzeFileAsync + buildTestReport + serializeCaseJson`；同步
    `packages/lsp/PUBLIC_API.md` §5、`packages/website/docs/api/agent.md` 与
    `AGENT_TOOL_SOURCES` 的值钉。
  - **`nudo/contract.emit` 转发 `from`**（Bug 994）：三个 contract 工具已支持
    `--from` 等价通道，但协议入口 `makeHandleContractEmit` 只构造
    `{file, functionName, mode, dryRun?}` ⇒ **`from` 到不了 emit 工具** ⇒ 补
    入参类型 + 透传。
  - **CJS 导出的 hover 面**（Bug 998）：`findFunctionNameAtPosition` 没有
    `MemberExpression` property 分支 ⇒ `module.exports.alpha = function () {}`
    的 hover 回退成无名 `(x) => ?`（诊断面认得它、hover 面不认 ⇒ IDE 内部
    自相矛盾）⇒ 补分支（祖父节点走 `path.parentPath.parent` —— Babel 的
    `node.parent` 不存在）。
  - **失败面文档同步**：`selectCase` / `selectContract` / `getActiveCases` 的失败
    面统一为 `{ success: false, error, isError: true }` ⇒ 两份 API 文档的返回面
    记载同步；`nudo/contract.emit` 的 `from?: string[]` 参数也补进文档。
  - **`pathEnvPreloadFingerprint` 的瞬时 ReferenceError**：族内 build 前
    `dist` 落后于 `src` 造成的一次性混用 ⇒ 随本族 build 消失（已连跑 5 次
    复现不出）。
- 3432d8c: CaseJson 的断言面新增了**第三种裁决** `unchecked`（外加可选字段
  `uncheckedReason`）⇒ 机器面新增可选字段属**增量**变更（additive）⇒ minor。
  
  `nudo test` can now tell "the engine could not infer the value" apart from
  "the value does not match the expectation".
  
  - **A failed inference used to be reported as a failed assertion.** When the
    engine cannot infer a witness' result (the observed value is `unknown`, or
    its confidence is `opaque`), the assertion verdict was binary: the case was
    reported as `[FAIL]`, `nudo:case-expected` was raised, and the run exited
    `1`. Writing the honest expectation (`=> number()`) could never fix it,
    because the real cause was the failed inference, not a type mismatch — while
    the very same source was only an `INFO` (`nudo:opaque-result`, exit `0`) on
    the `nudo check` face, i.e. the two faces gave opposite severities for one
    fact.
  - **The opposite expectation passed for the wrong reason.** `=> any()` (the
    top type) satisfied every expectation, including the ones the engine could
    not judge at all, so the assertion reported `[ok]` while nothing had been
    inferred — a hollow pass.
  
  Both assertion report faces — the CLI one (`nudo test`, `nudo test --json`,
  `nudo test --abs`) and the LSP agent tool one (`testTool`) — now use the same
  three-state verdict: a case whose observed value could not be inferred is
  recorded as **unchecked** (it is neither a failure nor a pass), it does not
  turn the run red, and the report says so explicitly ("cannot judge — the
  engine could not infer the actual value") and points at the
  `nudo:opaque-result` remediation path instead of claiming a type mismatch. The
  `unchecked` count in the `assertions` summary and in the `--json` payload now
  includes those cases, and a real mismatch is still reported as `[FAIL]` with
  exit `1`.
- ebe909e: `@nudojs/core` 新增公开可选项 `TranspileOptions.disableAsyncGen`（async 生成器路径的**安全网**开关）、
  `@nudojs/service` 新增公开导出 `analyzeFileWithEvalFailures` / `analyzeFileAsyncWithEvalFailures` /
  `FileEvalFailure` ⇒ 均为纯**增量** ⇒ minor。
  
  `nudojs` 的**闸门口径翻转**（模块级求值失败 ⇒ 不再静默放绿）按 **minor** 发布：
  `nudo check` 以 **error 级 `nudo:internal`** 报出并以**非零码**退出，`nudo health` 的
  `Result` 不再报 `OK`。**这是闸门口径的翻转**（详见下方「BREAKING」）。
  
  > **bump 级别说明**：本项目**尚无外部用户**，本批 1.x 包的破坏性变更统一以 **minor**
  > 发布并保留 `**BREAKING**:` 标注（谁会坏 + 怎么迁移照旧写全）⇒ 不占用 major 跳版，
  > 也不触发发布侧 `gate-major` 的人工确认闸门。一旦有外部用户依赖这些包面，
  > 即刻回到 `docs/versioning.md` 的「1.x + API/schema break ⇒ major」政策。
  
  fix: review 报告 34 条缺陷收口（闸门假红/假绿 · 契约面宽松 · 机器面谎报 · 文档与 changeset 漂移）
  
  本轮把一份 34 条缺陷的 review 报告逐条落地：每条都先在当前代码上**复现**（或判定为
  非缺陷），再修，并**逐条用回滚法自证「修前红 / 修后绿」**。新增 **39 个回归测试文件**。
  
  ---
  
  **BREAKING**: `nudo check` / `nudo health` 现在对**引擎内部回落**（模块求值失败 ⇒ 该文件
  的导出全部丢失）**fail-closed**。此前这类文件**零诊断 + exit 0** ⇒ CI 闸门**假绿**
  （合法代码与违约代码都判绿）。现在：命中内部回落 ⇒ 报 **error 级 `nudo:internal`**
  （消息含文件路径与原因）⇒ `nudo check` **非零退出**；`nudo health` 报
  `Result: FAIL (engine internal fallback found)` 并非零退出。
  
  谁会坏：依赖「坏文件也能过闸」的 CI 流水线（此前引擎自己挂了就当无事发生）。这些文件
  本来就是引擎缺陷的暴露面 —— 现在会**显式**报出来。
  
  怎么迁移：修掉被报出的文件（消息里给了路径与原因）。注意**口径边界**：`unsupported:*`
  （能力边界）与 `nudo:opaque-result`（推断精度）**不**触发该失败路径；只有**引擎内部回落**
  （`internal`）才 fail-closed。
  
  ---
  
  ### 高危（闸门级 · 5 条）
  
  - **`await` 的位置表与转译侧脱节 ⇒ `yield` 落进嵌套箭头 ⇒ 整模块编译失败 ⇒ L2 闸门假绿**
    （`core/algebra/exec/transpile/async-plan.ts` · `core/algebra/exec/run.ts`）：async 体的
    真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射 `yield`）实现 ⇒ `yield` 必须落在
    生成器**体内联**位置；而转译侧把若干操作数包进**宿主 thunk** —— `yield` 落在里面是
    **SyntaxError** ⇒ `new Function` 编译失败 ⇒ **整个模块**的导出全部丢失 ⇒ 闸门看不到任何
    入口 ⇒ **零诊断 + exit 0** ⇒ **CI 闸门假绿**。位置表此前只把「分支臂 / 循环体 / 短路右臂 /
    三元两臂」判为 thunk，漏了：**成员调用的实参**（`o.m(await 1)`）、**成员赋值的接收者/计算键/
    右值**（`o.x = await 1`）、**成员自增的计算键**（`o[await k]++`）、**逻辑赋值的右值**
    （`x ||= await 1`）、**循环判别式与步进式**、**switch 的 case 测试**、**早退守卫之后的后续
    语句**（`if (!c) return null; … await …`）。实测：`export async function load(id){ if(!id)
    return null; const res = await fetch("/x/"+id); return res.json(); }` 修前 ⇒ `nudo check`
    **OK / exit 0 / 签名全 unknown**；修后 ⇒ **error 级 `nudo:entry-may-throw`**（与 main 同结论）。
    修法（两处，缺一不可）：① 位置表补齐（上列位置判 thunk ⇒ 该 async 体回落 `$async` 同步
    路径，产物是**合法 JS**）；② **安全网**：生成器模式编译失败时**关闭 `asyncGen` 重试一次**
    ⇒ 纵有未来新增的脱节位置，模块也**编译得出来** ⇒ 导出可见 ⇒ 闸门照常判定
    （**宁可少精确，不可整模块消失**）。
  
  - **模块级求值失败 ⇒ 闸门假绿**（`service/src/analyzer-orchestrate.ts` ·
    `nudojs/src/commands/{check,check-report,health}.ts`）：见上方 **BREAKING** 段。
    修法：按**文件**收集 `internal` 回落（进程级计数无法定位到文件）⇒ 命中即产出
    **error 级 `nudo:internal`**（复用已注册码 `DIAG.internal`，未新增第二套码表）⇒
    `ok:false` ⇒ 非零退出；分析失败的降级产物**不回写磁盘缓存**（回写 ⇒ 下次命中缓存跳过求值
    ⇒ 静默转绿）。
  
  - **早返回的关系补集默认「x 不是 NaN」⇒ 契约被证成 ⇒ 假绿**
    （`core/algebra/exec/transpile/stmt/{fn-body,statement}.ts`）：`¬(x <= k)` 还含 `x` 为
    **NaN** 的情形（NaN 与任何比较皆假）⇒ 后续路径只该断定 `x > k ∨ x is NaN`；此前直接断言
    `x > k`（排除了 NaN）⇒ `if (x < 0) return 0; return x;` + `return nonNeg` 判**成立**
    （零诊断），而原生 `x=NaN` 时返回 NaN ⇒ **真违规被放过**。且与**三元**写法
    （`x < 0 ? 0 : x`）结论**不一致**（三元判 `unproven-return`）。修法：撤销后续路径的否定界
    窄化 ⇒ 两条路径同口径。
  
  - **Bug 370 把「确定违规」降为 warning**（`core/algebra/postcondition.ts`）：证据面判据
    从「`ret.pred` 有事实」改成「含**界原子**」⇒ `typeof` 级证据（`@nudo:contract x num` 的
    **声明域参数**）被判成「无证据」⇒ 返回义务降级成 `nudo:unproven-return`（**warning**，且
    warning **不改变 exit code** ⇒ 门禁空转）。`if (x === -1 || x === -2) return x;` + `return
    positive` 是**确定违规**（x=0 即违约），此前只出 warning。修法：判据回到「`ret.pred` 有
    事实」⇒ 声明域参数 ⇒ **error 级 `nudo:constraint-violated`**。
  
  - **契约合取的结构型义务被静默丢掉 ⇒ 假绿**（`core/algebra/interface.ts`）：合取遇任一侧
    结构型就直接返回前侧 ⇒ 源码 shape`{id}` ∧ 侧车 shape`{id,name}` 的 **`name` 义务整条蒸发**
    ⇒ 契约面比声明面**宽松** ⇒ 违约代码被放过。修法：改为**字段级合并**（两侧都有的字段递归
    合取、单侧字段保留、`optional` 取交集）；合不了的形态组合按既有口径**不**判 conflict
    （能力边界 ≠ 语义不可满足）但**显式留痕**（新增 `EffectiveInterface.undecidable` ⇒ check 面
    发 **warning** 级 `nudo:interface-conflict`，**不静默宽松**）。
  
  ### 闸门可信度（假红 / 假绿 · 14 条）
  
  - **展开实参被计为 1 个 ⇒ `nudo:arg-count` 假红**（`core/algebra/scan/literal-args.ts`）：
    `impl(...args)` 被计成 1 个实参 ⇒ 报「expects 2 argument(s), got 1」；数组字面量展开的**空洞**
    （`three(...[1,,3])`，原生是 3 个实参）被跳过；幻影槽位破坏 rest 聚合（`few(1, ...more)`
    对 `array(number()).max(1)` 报长度违规）。修法：个数不可判时**让位**元数检查；空洞按
    `undefined` 计入；rest / length 边界在展开处**停止**。
  - **裸名 callee 解析不看作用域 ⇒ 无契约也触发 arity 假红**（`core/algebra/scan-call-graph.ts`）：
    外层函数的**形参 / 局部 const / 嵌套函数 / for-of 绑定 / 解构绑定**同名时，把顶层声明当被调
    方 ⇒ 报「log expects 2 argument(s), got 1」+ 假 may-throw。修法：callee 解析引入**作用域链**。
  - **`memberToFn` 按变量名做键 ⇒ 同名局部/参数互相串味**（`core/algebra/scan-call-graph.ts`）：
    别名与成员绑定改为**按作用域分桶**，重新赋值时失效。
  - **TS `x?: T` 与 JSDoc `[x]` 被当成必需参数 ⇒ arity 假红**（`core/algebra/param-surface.ts`）：
    `h()` 对 `/** @param {number} [x] */ function h(x)` 报「expects 1 argument(s), got 0」。
  - **`or` 契约的「不可判定」成员被当成失败**（`core/algebra/scan/literal-shapes.ts`）：
    `union(number().gt(0), lit("a"))` 对**非字面量 number** 实参误报。修法：三值聚合 ——
    **全部**成员确定假才报；不可判定且域容纳该形态 ⇒ 整条 union 保持未决。
  - **显式 `undefined` 被当成值**（`core/algebra/scan/literal-args.ts`）：`d1(undefined)` 对带默认值
    的形参报约束错误。修法：显式 `undefined` ⇒ 走**默认值**。
  - **默认值填充只在零参时发生 ⇒ 假绿**（`core/algebra/scan-literal-calls.ts`）：
    `e4(1)` 缺失的尾部位不补（运行时 x = -5）⇒ 静默。修法：补齐**所有缺失的尾部位置**。
  - **switch 分组 case 标签的 `hit` 收窄不安全**（`core/algebra/exec/transpile/stmt-predicates.ts`）：
    `const x = null; switch (x) { case null: case "ab": return x.length; }` 原生抛 TypeError，
    引擎按源码推导读 `"ab".length` ⇒ **L2 may-throw 消失**。`case 0:` 还会把 `-0` 重绑成 `+0`
    （原生 `1 / -0` = `-Infinity`，引擎算成 `Infinity` = **自信的错值**）。修法：只有**同体全部
    标签都是原始字面量**才产命中事实；`0` 按**交集细化** `{0, -0}`。
  - **`lit(NaN)` 契约被判自相矛盾 ⇒ 假红**（`core/algebra/interface.ts`）：字面量值比较用
    `!==` ⇒ `NaN !== NaN` ⇒ 同一个 `lit(NaN)` 自比被判成「两个不同字面量」⇒
    `nudo:interface-conflict`。修法：改用既有 helper `termEquals`（`===` + NaN 特例）。
  - **import 别名撞 ambient builder 声明 ⇒ 整个 sidecar 装载失败**
    （`core/algebra/refine.ts`）：`import { number as string } from "@nudojs/core"` 与包装器的
    `const { number, string, … } = __nudoInjects` 同处一个外层作用域 ⇒ SyntaxError ⇒ 侧车整体
    装载失败 ⇒ **契约全丢**。修法：显式 import 的本地名从 ambient builder 名单里排除。
  - **`autoBind:false` 下不可读的 ambient sidecar 仍被报成 error ⇒ 假红**
    （`core/algebra/load-deps-fp.ts` · `core/algebra/check.ts`）：**指纹计算**的推测性读取
    走的是**分析读**通道 ⇒ EACCES 被收口成 error；而那份侧车在 `autoBind:false` 下**根本不会被
    绑定**。修法：推测性读走**未经降级闸**的通道（读失败只让指纹标 `readError`）+ 按 ambient
    绑定资格 gate。
  - **缓存的 sidecar 诊断丢失依赖归属**（`core/algebra/refine.ts`）：root→dep 递归求值共享同一
    diags 数组 ⇒ 依赖侧车的诊断一律记到 **root** 名下。修法：诊断带**来源文件**并纳入去重键。
  - **`lit(1n)` 的大字面量被提前过滤 ⇒ 假绿**（`core/algebra/contract-face.ts`）：bigint 过滤
    发生在 `literalMeetsConstraint` **之前** ⇒ `lit(1n)` 契约下返回 `2n` 的被调函数被判**满足**
    ⇒ 违约被放过。修法：bigint 参与比较（`1n !== 1`，与 number 不混同）。
  
  ### 机器面 / 契约面 / 工具链（8 条）
  
  - **`@nudo:skip` 签名分支输出旧机器面**（`core/algebra/check.ts`）：JSON `display` 带
    `#exact` 而终端显示 `number` ⇒ 机器消费方拿到的是**人类面之外的文本**。修法：与其它路径
    同款（`formatSigCached`）。
  - **内部临时名遮蔽用户标识符**（`core/algebra/exec/transpile/{member-path,expr/assignment,
    expr/call,expr/optional-chain,expr/short-circuit}.ts` · `helpers.ts`）：引擎写死的
    `__nudoMp*` / `__nudoDefR` / `__nudoReArgs` / `__v` 会**遮蔽**用户源码里的同名绑定 ⇒ 自信错值
    或 TDZ **ReferenceError**（⇒ 闸门**假红**）；模块级同名还会撞出重复声明 SyntaxError ⇒
    **整模块 fail-closed** ⇒ 闸门**假绿**。修法：改用既有 `internalTmpName` /
    `internalTmpNameSet`（**无碰撞时基名原样返回 ⇒ 产物逐字不变**）。
  - **CJS 对象字面量导出的普查键必须是成员键**（`core/algebra/export-slot.ts`）：
    `module.exports = { greet: function inner(x){…} }` 的侧车契约**整个不绑定**（只剩
    `unproven-return` 警告、签名退成 `unknown` ⇒ **假绿**），且内层 id 与成员键碰撞时映射串。
    修法：导出槽映射**只用成员键**。
  - **`leq` 的 fn arity 只比较必需参数个数**（`core/algebra/leq.ts`）：`(a = 1, b) => b.toFixed()`
    被接受为单参目标（原生 `g(1)` 抛 TypeError）⇒ 判定比原生松 ⇒ 假绿。修法：按**最后一个必需
    参数的位置**比较。
  - **生成的守卫对 `new Proxy(...)` 抛错**（`core/algebra/denote.ts`）：`x instanceof Proxy` 在
    原生**抛 TypeError**（Proxy 没有 prototype）⇒ 守卫产物一跑就炸。修法：对**无可用 prototype**
    的构造器跳过身份子句。
  - **超参 warning 忽略可选/默认槽位**（`core/algebra/diagnostics.ts`）：`f(a, b = 1)` 被 `f(1, 2)`
    调用时误报「takes 1 argument(s) but 2 were passed」。修法：上界按**非 rest 形参总数**。
  - **多行 `@nudo:case … !! throws` 声明丢失**（`core/algebra/directive-scan.ts`）：case 参数跨行
    时后缀正则匹配不到 ⇒ 申报的 throws 丢失 ⇒ `nudo:entry-may-throw` **假红**。修法：先在完整
    注释里找平衡的 case 参数终点再识别后缀。
  - **`export default C` 的类入口被漏**（`core/algebra/scan-top-functions.ts`）：Babel 的
    `Identifier` 字段是 **`name`**（代码读的是 `d.id?.name` ⇒ `undefined`）⇒ 类入口不在入口表里
    ⇒ 构造器入口闸门看不到它 ⇒ **假绿**。
  
  ### async 运行时（2 条）
  
  - **callee 有 2 个及以上 await 时 caller 提前恢复**（`core/algebra/exec/runtime/async.ts`）：
    队列为 `[callee-resume, caller-resume]` ⇒ callee 的**第二次**续体排在 caller 之后 ⇒ caller
    读到**占位符**。实测 `async function g(){ log.push(1); await null; log.push(2); await null;
    log.push(3) }` 原生 `"1,2,3"` / 修前 `"1,2"` / 修后 `"1,2,3"`；`return await h()` 原生 `7` /
    修前 `unknown` / 修后 `7`。修法：live promise 维护 **pending 态 + waiter 列表**，await 的
    恢复排在 settle **之后**。
  - **`Promise.all` 取调用期快照**（`core/algebra/builtins/promise.ts`）：元素尚未 settle 时取到
    占位符 ⇒ 兑现值被永久冻住；元素**拒绝**通道丢失 ⇒ 拒绝臂成死代码（**假绿**）。修法：组合子
    自身 pending，元素 settle 后重算聚合；任一元素确定拒绝 ⇒ 组合子短路拒绝。
  
  ### 约束构造器（1 条）
  
  - **`.int()` 暴露给非 number builder ⇒ 同一约束两个裁决**（`core/algebra/constraint.ts`）：
    `literalMeetsConstraint("abc", string().int())`（域面）接受 `"abc"`，而 Abs/投影面却带整数
    谓词。修法：非 number builder 上 `.int()` **抛错**（与 `shift()` 同口径）。同批收口：
    `fn()` 缺字段表守卫、`boolean().gt(1)` / `string().length(-3)` 等**恒假**契约（假红）、
    `array(1,2)` 静默丢元素约束（假绿）。
  
  ### 文档 · changeset · 诊断注册表（4 条）
  
  - **自称破坏性的 vite-plugin changeset 声明为 patch**（`.changeset/fix-vite-plugin-s{1,3,4}.md`
    等 32 个）：按 `docs/versioning.md` 逐个复核并**校正 bump 级别**（pre-1.0 的破坏性 ⇒ minor；
    1.x+ 的 JSON 形状变更 / 默认严重级变更本应 ⇒ major，但**本项目尚无外部用户** ⇒ 本批
    统一以 **minor** 发布，见上方「bump 级别说明」），并补 `**BREAKING**:` 与迁移说明。
  - **设计文档引用了被 gitignore 的产物**（`docs/design/generator-laziness.md` ·
    `docs/design/architecture-debt.md`）：`tmp/…` 路径（读者不可达）、`bun` 命令、过时行号、
    `$gen` 发射点数目（3 ⇒ 实为 4）。修法：删交接笔记、引用**符号名**、指向仓内回归钉。
  - **中文 API 文档漂移**（`packages/website/i18n/.../api/{agent,cli-reference,lsp,harvester,
    service}.md`）：手写页与 EN 现状不一致（`--json` 的形态、`force?: boolean`、旧契约…）⇒
    逐页同步；同时**收紧**文档覆盖闸门（`docs-coverage.test.ts`）让手写 api 页也进闸门。
  - **诊断码绕过注册表**（`packages/core/src/algebra/diag-codes.ts` ·
    `packages/nudojs/src/commands/migrate.ts`）：`nudo:migrate-strip-failed` 此前直写字面量 ⇒
    进 `DIAG` 注册表并由 CLI 引用常量。
  
  ### 附带（不改变对外行为）
  
  - `nudo init` 的祖先配置继承口径与加载器对齐（本包已有 `nudo` 键 ⇒ 祖先**不可继承** ⇒ 不再用
    祖先配置当拒绝理由，消除「拒绝 + 不可修复」的死锁）。
  - `contract --help` 的 `--json` 描述、`contract --from-dts` 的拒绝提示（同时给出 `--force` 与
    `NUDO_DRAFT_FORCE=1`；**人工改过的草稿永不被覆盖**这条口径不变）。
  - `nudo:migrate-strip-failed` 进注册表；`interface` 缓存面新增 `undecidable` 透传。
  - 6 条**被放松/空转**的既有测试恢复为**强断言**（`check-regex-capture-narrow-136` ·
    `eval-loop-return-join` · `eval-bug-499` · `core-bug-1064` · `loop-pack-shadow-soundness` ·
    `core-bug-1079`）—— 此前它们在 main 上也通过，钉不住任何回归。
- dde4b03: **BREAKING**: standard 面的**导出集**变了 —— 解构形参的字段级校验器
  （`act_a` / `act_b`）**移除**，改为整参校验器 `<fn>Input`（与 zod 面同名同义）。
  
  谁会坏：`import { act_a } from "*.nudo.standard"` 的消费方 —— 这些导出**不再
  存在** ⇒ 消费方 `tsc --noEmit` 会红（此前它们拒收正确入参、收下错误入参，本就
  不可用）。
  
  怎么迁移：改 import `<fn>Input`（一个校验器校验**整个**入参对象）并重新生成
  产物。
  
  `nudo export --format standard` now produces a product that compiles in a
  strict TypeScript project, keeps literal values intact, and exposes one
  input validator with the same name as the zod face.
  
  - The generated module was plain JavaScript with a `.ts` extension, so every
    helper parameter and local was an implicit `any`: `tsc --noEmit --strict`
    reported a dozen `TS7006` / `TS7005` / `TS7034` errors per file and the
    product was unusable in a strict project, while the zod face of the same
    export compiled cleanly. The helpers now carry their types
    (`__nudoTypeOf(v: unknown): string`,
    `__nudoCheck(node: NudoSchemaNode, value: unknown, path: (string | number)[], issues: NudoIssue[]): void`)
    and the module ships the `NudoSchemaNode` / `NudoIssue` type aliases it
    needs.
  - Schema nodes were serialized with `JSON.stringify`, which has no notation
    for non-finite numbers: `Infinity` was silently written as `null`, so the
    exported validator rejected the value the function always returns and
    accepted a value it never returns — the opposite of the zod, guard and
    `nudo check` faces. Nodes are now written as source text, so `Infinity`,
    `-Infinity` and `NaN` survive; a `bigint` literal no longer throws
    `Do not know how to serialize a BigInt`, which used to abort the whole
    `nudo export` run and lose the other dialects' output as well.
  - The input face of a function with a destructured parameter exported the
    contract's field-level entries as if they were whole parameters
    (`act_a`, `act_b`), so `act_a.validate({ a: 1, b: 2 })` rejected the
    correct argument and `act_a.validate(1)` accepted a wrong one. A
    function-level assembler (`absToStandardSchemaFunction`) now emits
    `<fn>Input` — one validator for the whole argument object, named like the
    zod face — keeps `<fn>_<param>` for real parameters, and never lifts a
    destructured field to a top-level parameter validator.
- dde4b03: **BREAKING**: dts 面的**投影形状**变了 —— `.d.ts` 现在按**模块面**装配
  （类作为**类声明**投影、成员在类体内；`export default` 保持默认形态；
  `export * from` / `export { x } from` 的再导出被复现）；standard 面的输入面
  导出名也统一成 `<fn>Input`（解构形参不再导出字段级校验器 `act_a` / `act_b`）。
  
  谁会坏：消费方 `import` 生成 `.d.ts` 的类型并按**旧形状**引用的代码 ——
  
  - 类成员此前被摊成**模块级**声明（源码里并不存在这些顶层符号）⇒ 旧 `.d.ts`
    的形状与新 `.d.ts` 不同 ⇒ 消费方 `tsc --noEmit` 会红；
  - 再导出的符号此前**整个缺失** ⇒ 现在出现（反向：依赖「它不在」的代码会冲突）；
  - standard 面解构形参的 `act_a` / `act_b` 导出**移除**，改为 `<fn>Input`。
  
  怎么迁移：重新生成产物并按新形状引用（类成员走 `Class.member`，再导出符号现在
  可用）；standard 面改 import `<fn>Input`。
  
  Cross-shard wiring for the `service-emit` batch: the CLI now feeds the
  product faces the same information the analyzer holds, and a frozen
  witness no longer takes over a function's published type.
  
  - `nudo export --format standard` builds its module with the service
    assembler (`absToStandardSchemaFunction`) instead of a hand-rolled
    projection, so the standard face has the same input validator as the zod
    face (`<fn>Input`, one validator for the whole argument object) and a
    destructured parameter no longer exports field-level validators
    (`act_a`, `act_b`) that reject the correct argument.
  - The dts face is now assembled from the **module** surface: a class is
    projected once as a class declaration (members inside the class body)
    instead of one flat declaration per member, `export default` keeps its
    default form, and `export * from` / `export { x } from` re-exports are
    reproduced. Before, the class members were emitted as module-level
    declarations that did not exist in the source and a re-exported symbol
    was missing from the `.d.ts` entirely.
  - A contract that declares an optional parameter now reaches the product
    faces: the constraint's `isOptional` is carried explicitly (the entry
    `Abs` does not keep it), so the zod input object renders
    `.optional()` and the dts declaration uses `x?: T`.
  - `nudo contract --emit` renders each diagnostic exactly once. The emit
    summary already renders and consumes the issue list, so the CLI's
    trailing error-only loop printed the same diagnostic a second time on
    the dry-run path.
  - `nudo contract --emit --write` now exits non-zero when it refuses to
    overwrite a hand-edited draft. The file is left untouched (as before),
    but a silent exit `0` told CI that the draft had been regenerated.
  - `nudo check --fix` states explicitly when the fix did not turn the gate
    green but changed the diagnostic instead (for example the old
    `constraint-violated` became a new `entry-may-throw`). The previous
    message ("N residual error(s) remain") read as if the fix had worked.
  - `nudo export` no longer collapses a function's published type to a
    single frozen call site. A `@nudo:case` witness without an assertion
    observes **one point**; it is not a domain claim, so it must not own the
    return face. `nudo test --freeze` writes exactly such a witness, so
    freezing a call used to narrow the zod face to `z.literal(3)` and the
    guard face to `data === 3` — a guard that rejects every legal call —
    while `nudo check` still reported `number | string` for the same
    function. A function whose only evidence is a point witness now keeps
    its inferred domain, and the zod, standard, guard and dts faces agree
    with the check face.
  - `nudo test` classifies a case as synthetic by its **source** instead of
    by its name. A witness written by `--freeze` is named after the call
    site (`call@<file>:<line>`) but is declared in the source, so it was
    reported as synthetic and the run claimed "no declared @nudo:case
    expectations" even though the source now declares one.
  - `nudo contract --emit` removes a generated section whose export no
    longer exists in the source. The stale section kept the name occupied
    in the sidecar, so a hand-written contract for a new function of the
    same name produced an invalid sidecar.
  - A rest parameter is now observed as a **variable-length** argument, and
    the entry fallback observation of it is marked uncertain. Before,
    `xs.length` was observed as the literal `1` of the single placeholder
    argument, and the zod, standard and guard faces projected that
    one-off observation as the output domain (`literal(1)`) — a validator
    that rejects the value the exported function itself returns — while the
    dts face wrote `number`.
- b37321b: env 装载失败现在**报告出来**（`nudo:env-unresolved` 的适用面扩大：未知 env 名、
  `defineEnv()` 契约失败、相对路径 env 的按目录解析、`package.json#nudo.env` 里的
  非字符串元素）⇒ 诊断面**增量**（additive）⇒ minor。
  
  Runtime environments that cannot be applied now say so, instead of leaving
  the affected code to be judged as always throwing.
  
  - `@nudo:env bogus` — an env name that is neither a built-in (`es`, `web`,
    `node`) nor a path — was ignored silently: no diagnostic, and the env never
    applied. It is now reported as `nudo:env-unresolved`.
  - A path env file that does not export a `defineEnv()` function, exports a
    non-function, throws while being evaluated, or returns something other than
    `{ globals }` also went unnoticed, with the same effect. These contract
    failures are reported now, too. A file with a syntax error was already
    reported — the two cases now use the same channel.
  - A relative path env was resolved against a process-wide registry, so the
    first `./env.ts` loaded won every later same-spelled path. Each directory
    now resolves its own.
  - A `package.json#nudo.env` array holding a non-string element crashed the
    loader with `name.includes is not a function`. The element is now rejected
    with a diagnostic.
- b37321b: 新增两个诊断码 `nudo:module-unreadable`（模块**存在但不可读**）与
  `nudo:json-invalid`（JSON 语法非法）⇒ **新诊断码**属增量（additive）⇒ minor。
  
  Modules are resolved the way Node resolves them, and a dependency that
  cannot be loaded is named for what it is.
  
  - `require("./data")` was reported as "module not found" even when
    `data.json` sat right next to it, and `import "./data"` was accepted even
    when only `data.js` existed. The CommonJS and the ESM resolution rules are
    applied separately now: `require` follows the `require` condition and
    resolves extensionless paths, `import` follows the `import` condition and
    requires the extension.
  - A bare package with a conditional `exports` map always resolved to the
    CommonJS build, because the conditions were ordered with `require` first.
    The condition is now chosen by the kind of import.
  - `node_modules` was searched in one directory only. The search now walks up
    the tree the way Node does.
  - A package's own `#imports` mapping was not supported at all and produced
    no diagnostic, so the imported value silently collapsed to `unknown`. It is
    resolved now, and an unresolvable `#` specifier is reported.
  - A dependency that exists but cannot be read (`EACCES` and friends) was
    folded into "file not found" — a statement about the opposite of the fact —
    and, in the check path, escaped as an uncaught error that killed the whole
    run. "Unreadable" and "absent" are separate outcomes now, and an unreadable
    dependency is reported as `nudo:module-unreadable`.
  - A `.json` dependency was loaded as JavaScript, failed, and was dropped
    without a word. Its value is imported now; invalid JSON is reported as
    `nudo:json-invalid` instead of being called a missing module.

### Patch Changes

- 02aa122: fix(core,service): `-0` 保真渲染的**同根因漏点**一并补齐（族 20 · Bug 1065 收口）
  
  Bug 1065 的根因是「用 `String(v)` 渲染数值」⇒ `String(-0) === "0"` ⇒ 负号被抹掉。
  主修只覆盖了 `litToString` / `lengthBound` 两处；收口时按**同一根因**把其余
  漏点一并补齐（**诊断陈述的契约 ≠ 用户写的契约**是同一个错）：
  
  - **core（`packages/core/src/algebra/interface.ts` · `predToChain`）**：其余三处
    常数界渲染 —— `.min(n)` / `.max(n)`（`length` 上的 `ge` / `le` 界）与
    `.<op>(n)`（变量上的常数界）—— 改走保真口径 `litToString` ⇒ `.min(-0)` /
    `.max(-0)` 不再被抹成 `.min(0)` / `.max(0)`；`.length(n)` 的常数界渲染同款。
  - **service（`packages/service/src/emit/standard-schema.ts` · `describeValue`）**：
    `typeof value === "number"` 的渲染改用 `Object.is(value, -0) ? "-0" : String(value)`
    ⇒ 该文件**此前存在两套 `-0` 口径**（另一处已保真、这一处没有）⇒ 同款收敛。
  
  诊断文本、侧车 DSL 回写与 schema 产物现在**全部**走同一套保真口径
  ⇒ `-0` 在所有面上渲染一致，不再出现「一处保真、一处抹零」。
- 7fea13a: Accessors are now projected by what they actually return, repeated keys in
  an object literal follow the last definition, and an early return narrows
  the path that follows it.
  
  - An accessor does not live in a shape slot: the transpiler writes a
    placeholder `undefined` slot to keep the key present and keeps the real
    getter in a side table. The read path consults the side table, so `o.ab`
    reads correctly, but the projection paths read the placeholder slot, so
    every object literal with a getter was projected as
    `{ ab: undefined }` — a confident wrong value, narrower than the truth
    and self-contradictory. The projection paths (shape formatting, guard
    derivation, constraint projection, contract proof) and the `.d.ts`
    generator now take the read domain of the getter: the getter is
    evaluated with the object as receiver, a getter that throws projects to
    `unknown`, and a data property keeps its slot value.
  - A key that appears twice in an object literal kept the *first* accessor
    even when a data property came later, so `{ get x() {}, x: 2 }` was read
    through the getter and writing `o.x = 9` was reported as a definite
    `TypeError`. The last definition now wins, including its kind: a data
    property after an accessor replaces it, and an accessor after a data
    property replaces it too.
  - The facts of an early return did not reach the path that follows it, so
    `if (x <= 0) { return 1; } return x;` violated a contract of
    `number().gt(0)` while the equivalent `if (x > 0) { return x; } else {
    return 1; }` passed. The path after an early return now knows the
    negation of the guard. The fact reaches the code after the early return
    whatever block the early return is written in — a bare block, a `try`
    block, a `catch` block or a `finally` block.
- 0f67015: fix: 并发 review 收口的 25 条缺陷 + 4 条跨文件尾巴（CI 闸门假红/假绿 · 自相信值 · 机器面口径漂移）
  
  本片是一次**并发 review**（8 个分片）收口的结果：25 条缺陷全部修复，另补
  4 条 worker 报告的跨文件尾巴。核心是**闸门可信度**——`nudo check` 是 CI
  闸门，假红会卡死用户仓库、假绿会让门禁空转。
  
  ### 高危（5 条 · 闸门级）
  
  - **L2 实例方法桥把**构造器**的 throws 归因给方法**（`core/algebra/check-may-throw.ts`）：
    实例桥用 `ctorAnyArgs`（全 `any`）跑构造器 ⇒ 构造器里的强制转换 TypeError
    被算进**方法**的 throws 域 ⇒ 普通类即触发 error 级 `nudo:entry-may-throw`。
    修法：构造器改在**独立 may-throw 会话**里跑（证据隔离、副作用保留）⇒
    构造器的 throws 归因给 `new C()` 入口而非方法；构造器抛时退**裸实例**
    继续求值方法体 ⇒ 方法自身的证据照常收集（闸门不整体关掉）。
  - **`async function*` **声明**体的 `await` 发射成裸 `yield`**
    （`core/algebra/exec/transpile/stmt/statement.ts`）：缺 `stmt.generator !== true`
    守卫 ⇒ 产物是非法 JS ⇒ **整模块 fail-closed** ⇒ 全部导出退 unknown/opaque ⇒
    error 级 `nudo:entry-may-throw` 降成 INFO `nudo:opaque-result`（门禁假绿）。
    修法：与函数表达式 / 对象方法 / 类方法三条兄弟路径对齐。
  - **Proxy `getOwnPropertyDescriptor` 陷阱违反 [[GetOwnProperty]] 不变量**
    （`core/algebra/builtins/object/descriptor.ts`）：引擎照抄陷阱的值 ⇒ 自信的
    错值。修法：以 **node v26.10.0 实测矩阵**（82 例零偏差）反推完整谓词 ⇒
    补齐「靶无该自有键」「可配置性不一致」「不可配置属性的 writable /
    enumerable / value 冻结」「数据 / 访问器描述符不得混报」四档。
  - **`Object.getOwnPropertyDescriptors` 丢 symbol 键自有属性**
    （`core/algebra/builtins/object/methods.ts`）：原生走 `[[OwnPropertyKeys]]`
    **含** symbol 键 ⇒ 结果对象少一个自有属性。附带修正 `builtins/invariants.ts`
    把 gOPDs 列进「只枚举字符串键」的**事实错误**注释。
  - **`Uint8ClampedArray` 元素先截断再钳位**（`core/algebra/builtins/error/binary.ts`）：
    `ToUint8Clamp` 是就近偶数取整、**不**向零截断 ⇒ 改传未截断值。
  
  ### 中危（9 条）
  
  - **`strip-types` 把构造器参数属性赋值插到 `super()` 之前**
    （`core/src/strip-types.ts`）：派生类产物在 `new C()` 时抛 ReferenceError ⇒
    `migrate` 是一程闸门（无回退）且 `node --check` 只验语法 ⇒ 静默写出坏代码。
    修法：按 tsc emit 口径插到 `super(...)` **之后**；找不到顶层 `super(...)` 时
    保持源自身的失败形态并产出一条 note（`nudojs/src/migrate.ts` 侧透出）。
  - **`Object.setPrototypeOf(Object.prototype, null)` 过拒绝**
    （`core/algebra/builtins/object/methods.ts` · `objects.ts`）：按 ES2024
    10.4.1.2（`[[SetPrototypeOf]]` 只在 V **非 null** 时抛）+ node v26 实测
    **放行 null**、仍拒非 null ⇒ 不再与原生/规范冲突（无需登记架构债）。
  - **`Reflect.ownKeys` 的 symbol 键排在字符串键之前**（`core/algebra/builtins/reflect.ts`）：
    按 ES2024 `OrdinaryOwnPropertyKeys` 改两段排列。
  - **`arr` 形参 × `tuple` 实参的 α 绑定只取首元素**（`core/algebra/hof.ts`）：
    异构数组字面量 `[1,"a"]` ⇒ `T := number` ⇒ 返回 `number[]`（**窄于**真实类型）
    ⇒ 把「不知道」升级成「知道」。修法：元素域取全部元素的同型 join，异构退 `any`。
  - **项目级 path env 按「被分析文件目录」解析**（`service/src/check-issues.ts` ·
    `service/src/analyzer-orchestrate.ts` · `lsp/src/validation.ts`）：假阳（报
    不存在的路径）+ 假阴（项目级 env 真实失败被静默丢弃）⇒ 改两层基准
    （项目级按项目根 / 文件级按文件目录），与 CLI 同口径。
  - **`check --json --watch` / `test --json --watch` 的路径错误早退分支打 pretty
    JSON**（`nudojs/src/commands/check-command.ts` · `test.ts`）：破坏 watch 面
    「stdout = JSON Lines」契约（机器消费者第一行即炸）⇒ 三动词统一一行一份 JSON。
  - **`migrate strip --json` 的 `pathErrors[].path` 混用目录 / 文件量纲，且同目标内
    成功文件的逐文件结果被整条丢弃**（`nudojs/src/commands/migrate.ts`）⇒
    逐文件隔离在 CLI 面等于没生效 ⇒ 失败条目改用文件路径、成功行进 `results`。
  - **vite-plugin：工程根含软链时全部源文件被判为「依赖」**
    （`vite-plugin/src/scope.ts` · `index.ts`）：`resolve()`（不解析软链）对比
    `realpathSync()`（解析软链）⇒ 整工程被 skip 且**零日志**（静默空转）⇒
    两侧都取 realpath 再比；root 改为按插件实例持有（同进程第二个 Vite config
    不再覆盖第一个的 root）。
  - **zh-Hans 镜像未跟随 en 更新**（5 个页面）：输出块按真机重抄 + 缺段补齐，并
    **新增机械闸门**（`website/tests/docs-coverage.test.ts` 规则 21：blocks /
    machine / tokens / rows / paras 五档 en↔zh 比对）⇒ 漂移不再静默过 CI。
  
  ### 低危（11 条）
  
  `__nudoLv{N}` 循环槽名改走 `internalTmpName`（`core/algebra/exec/transpile/stmt/statement.ts`）；
  后置条件证据面的 Φ 侧改**同项**判定（`core/algebra/postcondition.ts` · `check-return.ts`）
  ——无关 Φ 不再把「证不出」误判为 `disproved`；
  standard-schema 内联 `__nudoDescribe` 与库函数副本的 `-0` 口径统一
  （`service/src/emit/standard-schema.ts`）；整文件缓存键的「项目级 path env 内容」
  维度按项目根解析（`service/src/analyzer-cache.ts`）；两条新诊断码改用 core 的
  `DIAG` 注册表（`service/src/analyzer-orchestrate-uncached.ts`）；用法错误码三动词
  统一为 `nudo:usage-error`（`nudojs/src/commands/test.ts`）；vite-plugin 无 `line`
  的 issue 不再伪造成 `:1:0`（`vite-plugin/src/check-assembly.ts`）；parser 的文件级
  指令位置闸门补 class / 对象字面量体（`parser/src/directives/file-directives.ts`）；
  LSP 语义 token 降级路径复用 core 的真 lexer 遮罩（`lsp/src/semantic-tokens.ts`）；
  架构债台账条目数 9→10（3 处索引）；`walkAbs` 的 brand 解包补空值守卫
  （`scripts/env-coverage-baseline.ts`）。
  
  ### 跨文件尾巴（4 条 · worker 报告的同源缺口，本片一并收口）
  
  - **core 文本路径的同类位置闸门洞**（`core/algebra/directive-scan.ts`）：
    parser 侧修了 class / 对象体，core 的文本路径是孪生路径、同样漏了 ⇒ 按同口径
    补上（`nestedBodyRanges`）。
  - **`generalize.ts` 的类方法桥**（值域通道）：构造器抛 ⇒ 异常逃出 ⇒ 方法签名退
    unknown + 误导的 INFO `nudo:opaque-result`。`check-may-throw.ts` 反向 import
    `generalize.ts` ⇒ 跨模块复用会成包环 ⇒ 按仓库既有「就地复刻」惯例本地实现
    裸实例兜底。
  - **`nudojs/src/migrate.ts` 透出 `ctorParamPropsSuperMissing` note**：core 已置位
    但用户看不到 ⇒ 补提示。
  - **LSP / service 的项目级 env 预载基准**（见上「中危」条）。
  
  ### 验证
  
  全仓 `tsc --noEmit`（**含测试文件**）0 错误；`pnpm run test` **1756 文件 /
  14515 用例全绿**（exit 0）；`pnpm run build` exit 0；`verify-doc-examples.sh`
  278 checks passed / 0 failed；`coverage:env -- --check` exit 0。25 条缺陷各配
  一条「**修前红 / 修后绿**」的回归测试（新增 24 个测试文件），高危项另在
  **产品 CLI 面**逐条复现核对（与原生 node v26.10.0 逐值一致）。
- e424592: `@nudo:mock-module` now fails closed when the mock file does not export a name
  you listed, instead of silently falling back to the original module.
  
  - The local (named) form of the directive lists the exports to replace. A name
    the mock file does not provide was skipped without a word, so the original
    module's export of the same name survived the overlay: the analysis ran on a
    **half-mocked program** (one export from the mock, the other from the real
    module), and the directive was still reported as applied. Signatures,
    contracts, `.d.ts` and schema products were then computed for a program that
    exists neither in the source nor in the mock.
  - Such a name is now reported through the existing module-loading error channel
    as `nudo:module-missing` (error) — one diagnostic per missing name — and the
    directive is **not applied**: the original module is left untouched rather
    than half-overlaid. Exports the mock does provide keep working, and names you
    did not list still fall through to the original module as documented.
- 0366b6d: Family 04 (core execution / entry), shard E — fixes for bugs 990, 1031 and 286.
  
  - **Bug 1031 (core)**: an `export { … };` specifier statement placed **before** a
    class declaration made every method of that class collapse to `unknown`.
    `ctorParamCountOf` treated the specifier statement as a declaration and
    dereferenced `declaration.type` on a `null` declaration, raising a
    `TypeError` inside the class-method bridge. The bridge swallowed the error
    in an empty `catch {}`, so the method signature silently degraded to
    `unknown` and picked up a misleading `nudo:opaque-result` diagnostic. Worst
    of all, a violated return-type contract on such a method was downgraded from
    an **error** to a **warning**, so `nudo check` exited `0` and let the
    violation through. The null declaration is now skipped explicitly, and the
    bridge distinguishes an internal failure from a failed evaluation run
    instead of swallowing it silently. The behaviour no longer depends on the
    order of the `export { … };` statement.
  - **Bug 990 (core)**: `collectAbsExports` decided between the re-export branch
    and the local-export branch by testing whether a module table was supplied at
    all. With no module table, `export { a } from "./m.js"` was handled as a
    local export and invented a named export, and `export { default } from
    "./m.js"` invented a `default` export — the very existence of a `default`
    slot is protocol-level information, so consumers were told the module has a
    default export it does not have. The branch now only looks at whether the
    statement has a source: an unreachable source yields no export slots at all,
    matching the "module table present but module missing" case. `bindImports`
    also resolves `import { default as d } from "./m.js"` through `mod.default`,
    so it now matches `import d from "./m.js"` instead of binding `unknown`.
  - **Bug 286 (service)**: call records for namespace member calls
    (`ns.helper(…)`, both ESM `import * as ns` and CJS `require`) only carried the
    member name, never the receiver. The attribution side splits the callee name
    on a dot, so the split never happened: `targetModule` / `targetExport` stayed
    empty, the record was dropped by the matching side, and the **error-level**
    `nudo:interface-domain-exceeds` gate never fired for out-of-domain calls
    across a namespace import. Such records now carry the receiver's local
    binding name (`ns.helper`), the same shape class member calls already use
    (`Brand.method`), and a CJS `require` binding is registered as a namespace
    import. Ordinary calls (local functions, named imports, host globals) keep
    their existing record names.
- 0366b6d: Family 04 (core execution / entry), shard F — the service-side remainder of
  bug 274.
  
  - **Bug 274 (service)**: `@nudo:mock Math` / `JSON` / `Date` / `Number` … were
    silently ignored on the **call-value** channel (`nudo test` case values,
    `nudo export` dts, the LSP hover surface). The core side already separates
    the two injection tables — the "do not shadow host intrinsics" skip list
    (`ENV_SHADOW_SKIP`) applies to **env globals only**, because a mock value is
    an `Abs` with no host object identity to preserve (shadowing the host global
    is exactly what a mock is for). But two service call sites merged the mock
    table into `envGlobals` before handing it to the engine, so the engine could
    no longer tell mocks from env globals and the skip list swallowed the mocks
    on that list — the user believed the mock was in effect while the host
    intrinsic answered. Both call sites now pass the two tables separately
    (`mocks` through its own parameter, `envGlobals` carrying env globals only):
    - `eval-run.ts` (`tryRunEval`) — the call-value / case-evaluation channel,
    - `abs-modules-graph.ts` (`collectAbsBindingsFromGraph`) — the module-graph
      binding surface.
  
    The precedence is unchanged: the engine reads the merged table as
    `{ ...envGlobals, ...mocks }`, so a mock still **overrides** an env global of
    the same name, exactly as before when the mock was merged in last.
- 0366b6d: Importing an environment module by its default name now infers the same type
  as importing it as a namespace.
  
  - `import fs from "node:fs"` bound to nothing, because the environment module
    table only carried the named exports and had no `default` slot. The import
    folded to `unknown`, every exported function of that file degraded to
    `unknown`, and the check reported a misleading `nudo:unknown-inference`
    warning (the binding was never connected; nothing failed to infer) while
    still exiting 0. Importing the very same module as `import * as fs from
    "node:fs"` was judged normally, so one import semantics produced two gate
    verdicts.
  - Environment modules are CommonJS interoperability modules: Node's default
    export for `node:fs` is the module object itself, with the named exports on
    it. The environment module table now carries that `default` slot (the
    namespace of the module) and marks the module as an interoperability
    module, and the default-import binding has a single source of truth: the
    `default` slot when present, the namespace for an interoperability module
    that has no `default` slot, `unknown` otherwise.
  - Ordinary user modules are untouched: a module table without a `default`
    slot still binds a default import to `unknown` rather than falling back to
    the namespace.
- e59c991: String unions are now concatenated member by member, and generated line
  comments no longer carry a block-comment escape.
  
  - A value that is one of several string literals was concatenated as if the
    literals were one piece of text. `("a" | "b") + "!"` was reported as the
    single string `"ab!"` — a value no call can produce, because the real
    answers are `"a!"` and `"b!"`. The same happened to `` `v=${x}` ``, which
    was reported as `"v=ab"`. A union now keeps its members apart while it is
    converted to text, and the two sides are combined member by member, so the
    result is the union `"a!" | "b!"`.
  - The comment cleaner escaped the end of a block comment everywhere it was
    used, including inside `//` line comments, where it has no meaning. The
    contract draft printed by `nudo contract --draft` — the text a user is
    asked to copy into the sidecar — showed `/* no evidence — tighten *\/`
    instead of `/* no evidence — tighten */`. Line comments now keep the text as
    it is; a line break inside a comment is still flattened, so a comment can
    never spill out of its line. Block comments (the JSDoc in the emitted
    `.d.ts`) still escape it, because there the escape is what keeps the
    comment from ending early.
  
  - **Member results are combined with the engine's existing "same primitive"
    rule** (`joinValues`), not as a raw union. Two *literal* members still form an
    enumeration (`"a!" | "b!"`), but a literal combined with a same-primitive arm
    that carries no narrowing evidence collapses to that primitive — the same
    rule the rest of the algebra uses. Without it, a union member whose rendering
    is already `string` would sit next to a literal and print as
    `"NaN days" | "NaN day" | string | …`: harder to read than the type it
    describes, and inconsistent with the signature the same function has
    everywhere else (`formatAge(durationMs: number) => string`).
- da4fbfc: Sidecar sections are now recognised by nudo's own marker and nudo's own
  boundaries, and a class's static and instance methods no longer share one name.
  
  - A sidecar comment that merely **mentions** `@generated` (for example
    `// handwritten contract: this mentions @generated`) was treated as nudo's
    own section header. The whole handwritten contract then lost its
    obligations — a call site that violated the contract was not reported at
    all and `nudo check` exited 0 — and `nudo contract --emit --all` replaced
    the handwritten contract with the observed values. A header now counts only
    when the comment starts with `@generated` and names nudo, and a section
    boundary stops at a `const` that the export does not reference. The
    legitimate generated shapes (the alias section, the composite downstream
    section with its prelude `const`, a multi-step prelude, a header directly
    above the export) are still recognised.
  - A static method and an instance method with the same name were both listed
    as `C.m`, so the two records replaced each other in the tables indexed by
    name and the signature mixed parts of both methods. The instance method
    now takes the name on its own, and the generated TypeScript declaration no
    longer repeats the member.
  - `get` and `set` members of a CommonJS object literal were collected as
    exported functions, which invented an entry point and a spurious "may
    throw" error. They are not callable entries and are no longer collected.
  - A CommonJS member assignment whose value is a named function expression was
    named after the function's own inner id instead of the export slot, so the
    sidecar contract never bound and the exported symbol was missing from the
    signature table. The export slot name wins now.
- da4fbfc: Regression pins for three call-site contract enforcement reports whose
  symptoms are already gone. No behaviour changes: these bugs were fixed
  earlier (by the `lit(null)` / `lit(undefined)` literal fix, by the
  `export default` dts export-name fix, and by resolving a callee's
  `@nudo:import` sidecar against the callee's own directory). The pins
  exist so the fixed behaviour cannot silently regress.
  
  - A parameter whose contract is exactly `lit(null)` or `lit(undefined)`
    now has a pin that spells out both directions: the one allowed value
    passes with no diagnostic, and every other value is reported as a
    violation. `null` and `undefined` are two distinct domains, so
    `lit(null)` rejects `undefined` and `lit(undefined)` rejects `null`.
    The pin also records that a bare literal contract (one `eq` atom) and
    a `union` / `nullable` contract (nullish as a *member*) are different
    shapes handled by different channels; only the bare literal shape is
    pinned here.
  - The dts projection now has a pin for all four `export default` shapes
    — named function, class, anonymous function and arrow — and asserts
    that the emitted export name is `default` in each case, so a default
    export can no longer be projected as a named export that does not exist
    at runtime.
  - A cross-file call now has a pin that the callee's sidecar is resolved
    against the callee's directory, not the caller's: the sidecar next to
    the callee loads without an `nudo:interface-load` or
    `nudo:contract-syntax` diagnostic, and the call site still reports the
    real precondition violation.
- 2688251: fix(service): 指令**未命中**不再静默失效 —— `@nudo:replace` 目标不存在 / `@nudo:mock-module` 重复声明各有显式诊断（Bug 1062 / Bug 1063）
  
  两条是**同一根因**：指令的**语义前提**被违反时，引擎**静默失效、零诊断**
  ⇒ 唯一的信号是**归因错误**的 `nudo:unknown-inference`（把「你的指令没生效」
  说成「推断精度不够」）⇒ 假红 / 假绿。
  
  - **`@nudo:replace` 的目标文本在源码里不存在**（Bug 1062）：收集面此前把
    「目标文本在承载语句的作用域内无对应节点」降级成一条**无作用域**登记项
    ⇒ 转译面恒跳过 ⇒ 声明的类型覆盖**静默蒸发**；「目标写错一个字母」与
    「根本没写这条指令」的输出**逐字相同**。现在收集面发一条**点名目标文本**
    的 `nudo:directive-syntax`（warning）⇒ 两种情况**可区分**；目标写对时
    **零**该诊断。
  - **`@nudo:mock-module` 对同一模块重复声明**（Bug 1063）：叠加面此前对同一
    specifier **逐条整块覆写**（后者胜出、无比较、无告警）⇒ 先声明者独有的
    导出名**静默消失** ⇒ 该导出名的调用点退化成 `unknown`（wrong-exact）。
    现在重复声明发一条**点名两条来源**的 `nudo:mock-invalid`（warning），且
    导出表取**并集**（同名后者胜出）⇒ 导出名不再静默消失。
  
  诊断码**复用既有注册码**（`nudo:directive-syntax` / `nudo:mock-invalid`）⇒
  不新增诊断码；两条诊断都不挡门禁 exit（warning 级）。
- 1caec28: fix(service): `@nudo:env` 多名合并取**并集**（顺序无关）——Bug 1045
  
  `@nudo:env node, web` 与 `@nudo:env web, node` 此前得到**两张不同的全局表**
  （`packages/service/src/evaluator/env-loader.ts` · `applyEnvDefinition` 对同名
  全局做**整块替换**，后一个 env 赢）⇒ **同一份源码**只因 env 名书写顺序不同，
  签名不同、门禁结论相反（`OK` vs `FAILED`：`performance.toJSON` 在 web 有、
  node 无 ⇒ 顺序换成 node 赢时 `pf()` 被判「必抛 TypeError」）——与文档承诺的
  「env 名之间是 union」相悖。
  
  合并改为并集：
  
  - **obj ⊕ obj** ⇒ 逐槽并集（同名槽的值域再并集，不折「后者赢」）；
  - **brand ⊕ brand**（同名同 tag）⇒ 内层并集，保留品牌名；
  - **其余形态**（fn ⊕ fn / obj ⊕ brand / prim ⊕ prim …）⇒ 值域并集（sum）；
  - **模块侧**同名导出名同样取并集，不再 last-wins；
  - `globalEnv.bind` 绑**合并后**的值（全局表与 globalEnv 不再分叉）。
  
  并集满足三条纪律，缺一条就会退回「顺序敏感」：**可交换**（sum 成员按结构键
  排序——core 的 `makeSum` 按入参顺序排成员）、**可结合**（值域并集是「成员集合
  的并」而非两两折叠）、**不丢实现**（fn 的 relation / apply 挂在 Abs 对象上，
  并集成员保留原对象，不复制不重建）。
  
  单 env（只写 `@nudo:env web` / `node`）行为**逐字不变**：同名声明若结构同构
  则直接取同一份对象 ⇒ 全局表与 env 自身声明逐字相同。
- 69e67d3: 族 29 修复 S5：Bug 861 · 864 · 865 —— es env 的 console 成员表补全（`timeStamp` / `dirxml` / `profile` / `profileEnd` 等缺槽读出 exact undefined ⇒ `console.timeStamp()` 假红「may throw TypeError」）、URI 族改走 core 的 `evalGlobalFn` 建模（`decodeURI("%")` 的 `URIError` 不再被吞 ⇒ L2 假绿修复，抽象实参回落声明域 + may-throw URIError）、es env 补齐 ES 规范全局声明 + service 的「已被覆盖」判定改为按 core 真实建模能力推导（`BigInt` / TypedArray 全家 / `ArrayBuffer` / `DataView` / `AggregateError` / `Function` / `escape` 等不再被报「未被 Nudo 覆盖」，与同一份报告里的精确签名自洽）。
- 69e67d3: 族 29 主 agent 收口：跨分片组合出来的 4 个缺口。
  
  - **Bug 884（web 侧）**：`web.ts` 的 `structuredClone` 声明已删（node 侧同款
    修法在 `node.ts`）⇒ 回落宿主内建 ⇒ 不可克隆值的 throws 面（宿主
    `DOMException` / `DataCloneError`）不再被 env 声明整段吃掉 ⇒ L2 门禁恢复。
  - **`enforceArgs` 的并集实参过严**（S3 越界发现，主 agent 修正）：实参是**并集**
    （如 `string | undefined`）时，`leqAbs(sum, pt)` 整体判 false ⇒ 旧实现把它
    当「确定不符 ⇒ 必抛 TypeError」，而原生只在 `undefined` 分支抛 ⇒ 可能假红。
    现在**逐成员**判定：只有**全部分支**都不兼容才判必抛，部分分支不兼容判
    may-throw ⇒ 与原生同口径。
  - **Bug 886 / 889 的组合缺口**（S1 删声明 + S5 覆盖推导撞出来的）：web env 的
    `TextDecoder` 声明已删（宿主才有精确的 `RangeError` 与「类不可裸调」语义），
    但 core 的**构造面** `evalBuiltinNew` 不认 `TextDecoder` ⇒
    ① `nudo test` 报「Built-in API "TextDecoder" is not covered by Nudo's type
    inference」（假阳）；② Abs 面与 `$new` 宿主面口径分裂。现在
    `evalBuiltinNew` 补 `case "TextDecoder"` ⇒ 两侧同 builder
    （`makeTextDecoderAbs`），假阳消失。
  - **「已被覆盖」判定里的手写例外已删**（族 29 Bug 865 的根因收口）：core 其实
    已精确建模 `WeakRef`（`evalBuiltinNew` 的 `case "WeakRef"`），但三条既有
    service 契约把 `WeakRef` 当作「未被覆盖的全局」样例钉住，于是判定里留了
    一张手写例外表——那正是 Bug 865 要消灭的「手写白名单」换了个地方继续写。
    现在例外表删除，三条契约的**样例全局**换成真正未被建模的宿主全局
    `Atomics`（core 无 `Atomics` 建模面；它是 `globalThis` 里的数据属性 ⇒
    不触发访问器副作用），契约的**意图**（未建模全局要报 `builtin-unknown`、
    且不与 `unknown-global` 双报）完全保留。
- e6c4586: **BREAKING**: 既有 `nudo/…` 请求的**响应信封**变了。
  
  - `nudo/trace` / `nudo/suggestCase` 的失败路径此前**不带** `isError: true`
    （失败被当成成功，客户端只能从正文分辨）⇒ 现在失败路径返回 `isError: true`
    （MCP 风格）⇒ 按「有没有 `isError`」分支的客户端行为变了；
  - `nudo/hover` 现在**校验**位置参数：非整数 `line` / `column` 此前被原样回显
    且所有分析字段为 `null`（与「此处无 hover」不可区分），现在答**工具错误**；
    `column` 缺省为 `0` ⇒ `{ file, line, column, … }` 的载荷形状恒成立。
  
  谁会坏：把失败响应当成功处理的客户端（`nudo/trace` / `nudo/suggestCase` 的失败
  现在带 `isError: true`）；以及用非整数 `column` 调 `nudo/hover` 探测「此处有没有
  东西」的客户端（现在拿到的是工具错误而不是一个全 `null` 的载荷）。
  
  怎么迁移：客户端按 `isError` 分支处理失败；`nudo/hover` 只传整数 `line` /
  `column`（`column` 缺省即 0）。
  
  Fix agent-tool (LSP) defects found by the族 25 audit:
  
  - **767** — `nudo/trace` / `nudo/suggestCase` failure paths now return `isError: true` (MCP-style), so a failed call is distinguishable from a successful one at the protocol level instead of only in the text.
  - **768** — `nudo/hover` validates its position arguments: a non-integer `line` / `column` is a tool error (previously the value was echoed back with every analysis field `null`, so "no hover here" and "my argument was the wrong type" were indistinguishable), and `column` now defaults to `0` so the documented `{ file, line, column, … }` payload shape always holds.
  - **961** — `nudo/whatIf` validates its arguments: a missing `target` is a tool error (previously a fake success reporting `Type of "undefined": unknown`), a non-array `bindings` is a diagnosable tool error (previously a raw `bindings.map is not a function`), and a binding without `name` is rejected instead of silently doing nothing. `injectBindings` in `@nudojs/service` gained the matching shape guard and names the offending entry (`<missing name>`).
  - **993** — the observing agent tools (`nudo/whatIf`, `nudo/suggestCase`, `nudo/trace`) now analyse through the asynchronous entry point, which preloads path-based `@nudo:env` modules. Their output no longer depends on whether the file happens to be open in the editor (previously the same file and tool could answer `never`/`unknown` or `99` depending on call order, together with a misleading "Built-in API is not covered" diagnostic). The analysis caches additionally key on the env **preload state** so a synchronous analysis taken before the preload can no longer feed a stale "no env" result to later calls.
  - **955 (shared entry)** — `normalizeFilePath` now rejects a non-string / empty / missing `file` with a diagnosable `file is required …` tool error instead of leaking a raw `file.startsWith is not a function` TypeError (or silently falling back to the server's working directory). Every agent tool goes through this shared entry point.
- 27a795e: 族 22 修复 D4：Bug 698 700 701 708 717 721 723 —— 补全面与语义 token 面对齐真实语义。
  
  - 尾随点号时补全整面清零：用户刚敲下 `obj.` 的那一刻 buffer 文本语法非法，
    而解析不容错 ⇒ 分析直接抛 ⇒ 补全返回空并在 console 报错——恰在最需要补全的
    时刻失效。分析输入与绑定解析输入现在共用同一个消毒器（把尾随 `x.` 改写成
    `x._ `），尾随点号与已敲出部分成员名给出同样的成员列表。缓存键仍按真实源码
    计算：消毒文本只喂给一次性分析，不写回分析缓存，缓存与真实源码不会串味。
  - 指令补全在乘号之后也弹 `@nudo:` 指令：判定是「前面出现过 `*` 或 `nudo`」的
    子串匹配（`@?n?u?d?o?:?` 整段可选），于是 `x * ` 之后、字符串字面量里的
    `@nudo:` 都算命中。指令面现在先算光标的**词法上下文**（注释 / 字符串 / 代码），
    只在光标确实落在注释里时才出；注释里（含跨行 JSDoc）照旧出。
  - `@nudo:sample` 的补全项吹着「Control loop iteration sampling」，但该指令只被
    解析、不被消费；而且插入文本缺 count，接受补全就产生诊断。说明改成如实描述
    （reserved / no-op），插入文本带上 count 占位。
  - 模块级函数的补全项被标成「方法」：顶层 `function` / 箭头函数绑定不是任何对象
    的成员，IDE 会把它渲染成方法。补全项新增 `function` 档（成员函数仍是
    `method`，非函数绑定仍是 `variable`）。
  - 语义 token 面漏标：类名、类方法、类字段、方法形参、数组解构元素全部不上色，
    对象解构的绑定被上成属性。类名 → class 档（图例末尾追加，老索引不变）、类
    方法键 → method、类字段键 → property、方法形参 → parameter、解构绑定 →
    variable。
  - 对象字面量里的简写 `{ x }` 是对变量的**引用**，却被当成属性定义（property 档
    且带 declaration 标记）。简写现在是 variable 档且不带 declaration 标记。
  - 标识符 token 的长度按解码后的名字算：`const abc = 1` 里名字是 `abc`（3），
    但源码写法是转义序列（8）⇒ token 只盖住转义序列前半截，客户端高亮错位。长度
    改用源码跨度（位置口径仍是 UTF-16 code unit）。
- 169ed52: The disk cache, the LSP and the Vite plugin now agree with the CLI about
  environments, budgets and injected modules.
  
  - The cache key did not contain the effective fork budget, so changing
    `NUDO_MAX_FORKS` still served the previous run's result. The effective
    value (environment variable, then `package.json`, then the default) is now
    part of the key.
  - An invalid `nudo.check.entryThrows` value was reported once per checked
    file. The warning is now printed once per distinct invalid value.
  - `@nudo:as` did not apply to an exported binding, so the tool still reported
    "bindings applied" while the type stayed unchanged. The override now
    matches the exported declaration as well.
  - `--what-if` attached an assumption to the wrong variable when a line ended
    with a comment, and it reported a made-up reason when two declarations
    shared a line. Assumptions are now anchored by statement identity.
  - The LSP and the Vite plugin never applied `@nudo:mock`, so a project that
    checked cleanly in the CLI reported a spurious "may throw" in the editor and
    in the build. Both now assemble the same injection channel the CLI uses.
- 02aa122: fix(nudojs): `nudo contract --draft` 的 dry-run 面（打 unified diff）+ `--json`/`--write` 显式互斥 + 项目根判据按路径分量
  
  族 20 · 片 B（660 / 663 / 665）。
  
  - **Bug 660 —— `--draft --write --dry-run` 不打 unified diff**（只打一行
    「[dry-run] would write → …」），而 CLI Reference 承诺 `--dry-run` =
    "Print a unified diff instead of writing"。同一个 `--dry-run` 旗标在
    `--emit` 与 `--draft` 两条分支上语义不同。现在 `--draft` 分支**复用
    `--emit` 分支的同一个 diff 生成器**（`unifiedDiff`，已在
    `@nudojs/service/emit` ⇒ 零新增导出），对照面是**既有草稿文件**的磁盘内容
    （与 `--draft --json` 审阅面同款口径），diff 头与 `--emit --dry-run` 同形
    （`--- a/<path>` / `+++ b/<path>`）；dry-run 仍然**不写盘**。
  - **Bug 663 —— `--draft --json --write` 静默丢弃 `--write`**（`--json` 分支
    早退 ⇒ 写盘分支不可达）⇒ 草稿根本没落盘、exit 0、零提示 ⇒ **假绿 + 静默
    数据丢失**。现在 `--json` 与 `--write` **显式互斥**：
    `error: --write cannot be combined with --json` + **exit 1**，机器面仍给出
    一份合法 JSON 载荷（`{file, errors:[{code:"nudo:usage-error"}]}`，由命令层的
    跨文件聚合层收进恒定数组外壳）。
  - **Bug 665 —— 项目根边界用 `rel.startsWith("..")` 判逃逸** ⇒ 项目根下的
    **合法目录名**（`..data/` / `...cfg/`）与**合法文件名**（`..data.js`）被误判
    成「越出项目根」⇒ 草稿**拒写**（exit 1），而同一项目里的普通文件正常写出。
    判据改成**按路径分量**：「整段等于 `..`」或「以 `..` + 路径分隔符开头」或
    「跨盘（绝对路径）」——CLI 半（`nudo contract --draft --write`）与 service 半
    （`writeInterfaceDraft` 的写盘守卫）**逐字同款**；真正越出项目根的路径**仍被
    拒**。
- 02aa122: fix(core,service): 侧车契约与 zod 产物不再把 `-0` 渲染成 `0`（族 20 · 片 D · Bug 1065）
  
  `-0` 与 `0` 身份不同（`Object.is` / `1/x` 可观察），而 `String(-0) === "0"`
  ⇒ 负号被抹掉 ⇒ 同一个值在三处被渲染成**另一条契约**。
  
  - **core（`packages/core/src/algebra/interface.ts`）**：`litToString` 的 number
    分支改用仓库既有的保真口径 `litKeyString`（`./term.ts`：`Object.is(v, -0) ⇒ "-0"`，
    与 `format.ts` 的 `formatLitValue` 同款判据）；`lengthBound` 的常数界渲染
    （`.length(n)`）同款口径一并改。⇒ 侧车写的 `lit(-0)` 现在**如实**渲染成
    `lit(-0)`：`nudo contract` 回显、`nudo check` 诊断的 `expected:` / `suggestion:`、
    以及侧车 DSL 回写（`nudo contract --emit`）都不再抹掉负号。
    ⇒ **零新增公开导出**（`litKeyString` 是同包相对 import，core 冻结面未动）。
  - **service（`packages/service/src/emit/schema-generator.ts`）**：`case "lit"` 的
    数字分支**保真**写 `z.literal(-0)`（改前是 `z.literal(0)`）⇒ 产物不再
    **比门禁宽**（门禁按 `lit(-0)` 判红、产物却放行 `0` ⇒ 假绿）。
    ⚠ zod 的 literal 走 `===` 口径 ⇒ `-0` 与 `0` 在运行时**不可区分** ⇒ 该处
    **已知有损** ⇒ 产物就地加注释标明（消费方看得见），**不许静默放宽**。
    （zod 的运行时行为本次**未独立复现**——环境无 zod 依赖。）
  
  诊断文本与 zod 产物是**同一个渲染上游**（`formatConstraint` ⇒ `litToString`）
  ⇒ 一处修，两面同时保真。
- 3432d8c: Two `nudo test` case-reporting defects are fixed in the shared service analysis
  layer; the CLI report faces (`nudo test`, `nudo test --json`) inherit both fixes
  because they consume the same judgement function.
  
  - **A throwing case could never fail its declared expectation.** The observed
    value of a case that throws is `never`, and `never` is the bottom element of
    the type lattice (`never ⊑ anything` always holds), so the structural check
    passed for *every* declared expectation. `@nudo:case "t" (1) => 42` on a
    function that throws used to be reported as `✓ 1 passed` with zero
    diagnostics. The judgement now carries a precondition: an observed `never`
    can never satisfy an expectation, so the case is reported as failed and
    `nudo:case-expected` is raised. The expectation text shown to the user is
    unchanged — a predicate expectation still renders as `number (> 0)`.
  - **The case-level `nudo:may-throw` warning ignored a declared, intentional
    throw.** A throw declared with `@nudo:case "t" (1) !! throws TypeError`,
    `@nudo:throws TypeError`, or a sidecar `fn(…, { throws: "TypeError" })` was
    accepted by `nudo check` (zero errors) but still reported by `nudo test`, so
    the two verbs returned opposite verdicts for the same file. The case-level
    warning now uses the same mouth as the check face: a declared throw is not
    reported. Undeclared throws are still reported, and the remediation text now
    points at the mechanisms the user is already using
    (`@nudo:throws <Kind>` / `@nudo:case … !! throws <Kind>`) instead of only
    listing try-catch and `@nudo:contract`.
- 27cc16a: The directive grammar now has a single enforcement face: the case-argument
  grammar of the check product, the case emitter, the function census and the
  diagnostic positions are aligned with the parser.
  
  - The check product parses a case witness with its own literal grammar (a
    decimal regular expression, and a string sliced off its first and last
    character). A witness written as `1e3` or `"a\tb"` therefore did not denote
    the value the user wrote, and the contract gate reported
    `witness ⊭ contract` for a witness that was in fact correct — while the
    same file, read by the parser, held a different value. The check product
    now uses the same literal grammar as the parser: JavaScript number
    semantics (exponent, hex, binary, octal, separators) and JavaScript string
    semantics (escapes), and a text that is not a single literal is no longer
    folded into a confident wrong value.
  - The case emitter wrote a string value into the directive text verbatim, so a
    value containing a backslash or the quote character produced a directive
    that no longer re-parsed to the same value — `nudo test --freeze` wrote out
    a case that failed on the next run. The emitter now escapes what the
    grammar requires. Non-finite numbers (`NaN`, `Infinity`) and bigint
    literals were dropped from the emitted case entirely (the whole case was
    abandoned); they are now expressible.
  - A static class method was visible in the signature surface of `nudo check`
    but invisible in the function census of `nudo test` / `nudo health` /
    `nudo contract`, because the census only collected instance methods. The
    census now collects static methods as well, matching the check product.
  - A directive diagnostic carried no position, so every occurrence of the same
    problem was reported at the same place and the product surfaces could not
    point at the offending directive. Diagnostics now carry the position of the
    offending directive.
  - The union splitter of the what-if surface did not treat a backslash as an
    escape inside a string, so a type expression containing `\"` was split in
    the wrong place.
- aa23265: fix(service): 产物面（dts / schema / standard）2 条——internal 槽不再外泄，用户类 brand 不再产出未声明的类型名（族 55 · W5）
  
  产物面有**两面**：dts（类型声明）与 schema / standard（运行时校验器）。本次两条
  都落在**同一个语义缺口**上——产物把 **Abs 内部实现细节**当**用户可见的公开面**
  直出。
  
  **1) Bug 240：产物面仍发布 internal 槽**
  
  internal 槽（`Slot.internal`）不是自有可枚举属性——私有字段（`#x`）与生成器协议
  槽（`next` / `return` / `throw` / `constructor` / `@@iterator`）都属此类。core 侧
  早已统一判据（`format.ts` 投影面 / `projection.ts` 约束面 / `denote.ts` guard 面
  同款 `isHiddenInternalSlot`：`internal` 且键**不是**规范数组下标 ⇒ 该槽对属性
  introspection 不可见 ⇒ 不进产物），但 service 的产物面没跟上：
  
  - **dts 形参位**：`widenParamAbs` 造新槽时丢了 `internal` / `symbolKey` 标记 ⇒
    内部槽被"提权"成用户可见字段——改前
    `export declare function f(x: { a: number; "#priv": number; "@@iterator": number }): number;`
    （私有字段与 **symbol 键**协议槽按字符串键直出）。
  - **dts 类体**：私有字段进 `declare class` 的字段列表。
  - **schema 形状兜底路径**（约束不可表达时，如 open 对象）：内部槽进 zod / standard
    产物。
  
  现在 service 产物面**复用 core 的同一判据**（`packages/service/src/emit/internal-slot.ts`
  的 `isHiddenInternalSlot`，判据逐字同款，不另造）：内部槽不进 dts / schema /
  standard 产物。**规范数组下标槽是例外**（族 01 口径：生成器的数字下标槽承载
  **元素域**，不是内部实现细节）——该例外与 core 三面、约束面、schema 面前后一致。
  
  **2) Bug 233：dts 面把用户类 brand 渲染成从未声明的类型名**
  
  `absToTSType(brand("Counter"))` = `Counter` ⇒ 产物里那个类名**从未声明** ⇒ 消费方
  tsc 报 **TS2304**（"Cannot find name 'Counter'"）。修法按**模块面**口径（产物是
  一个**模块**，类名必须在模块里可解析）：
  
  - **本地声明**的类 ⇒ 保留类名 + `declare class`（Bug 517 既有口径**逐字不变**）；
  - **import 进来**的类 ⇒ 保留类名 + 补 `import type { C } from "…";`——族 15 S11 的
    zod 白名单口径「**补 import 的类名不能被误杀**」：不能把未声明的类型名一律降级，
    已 import 的类名要保留（模块面新增导入面扫描：`DtsModuleSurface.imports`）；
  - **两边都没有**的类名 ⇒ **降级为 `unknown`**（不再产出未声明的类型名 ⇒ 不再
    TS2304），并在产物头部留**降级台账**（`// nudo:unresolved-class …`）⇒ 降级
    **可诊断**（台账点名被降级的类名）。
  - **TS 全局类型名**（Date / RegExp / Error / URL …）与 **zod 白名单同名单**
    （`RUNTIME_GLOBAL_CTOR_NAMES`，族 15 S11 同源）⇒ 原样保留，无需声明。
  
  纯投影面（`absToTSType` 单值投影，无模块面 ⇒ 无声明面可判）保持既有口径**逐字
  不变**（`absToTSType(brand("User"))` 仍是 `"User"`，见既有钉 `emit-bug-521`）。
  
  **四面口径**：dts / schema / standard / guard 对 **internal 槽**现已同款（guard /
  约束面此前已由 core 修好，本次补齐 service 侧）；对 **brand 类名**，schema /
  standard 仍按族 15 S11 的 zod 白名单口径（用户类降级 `z.unknown()` + dropped
  台账——zod 产物只 import zod，不能引用用户类），dts 面则因**类型面**可以补
  `import type` 而保留已 import 的类名——这是**产物形态的固有差异**，不是口径分叉。
- e3b8791: The generated products and the named imports of a module now agree with
  each other.
  
  - The schema product rendered the brand of a generator as
    `z.instanceof(GeneratorFunction)`, which made the generated module fail
    to load with a `ReferenceError`. The brands that are not globals are
    downgraded to `z.unknown()` and the loss is recorded, so the product can
    always be loaded.
  - A named import of a function from an environment module wrapped the
    declared function in a JavaScript arrow function, which dropped the
    declared parameter and return types: the signature showed an invalid
    placeholder and the generated declaration file disagreed with it. The
    named import now yields the declared function itself, so both import
    forms report the same type. The function is still callable: a call and a
    `new` both dispatch to it.
- b37321b: The analysis service finds the functions, the call sites and the evidence the
  way the source describes them.
  
  - A function declared as `export const f = () => {}` was invisible to
    `nudo test`, `nudo export` and `nudo contract`, although `nudo check` saw
    it. Every product now sees the same set of functions.
  - `module.exports = { f: fn }` was invisible for the same reason.
  - `export default function f() {}` was looked up under its local name, while
    an ESM default export lives under `default` — the lookup missed, the
    signature degraded to `unknown`, and a misleading `nudo:opaque-result` was
    reported.
  - A call site inside an exported function body produced no `call@` case at
    all, so the call-site domain of that function was lost and the export was
    reported as entry-only. Call sites are now collected while the function
    body is evaluated.
  - A case name taken from the line number in the *calling* file collided
    between two call sites, pointed at an unrelated line, and made a second
    freeze drop the new witnesses. The name now carries the file it refers to
    when the call site is elsewhere, and the emitter compares witnesses by
    identity.
  - An expectation written as a predicate — `number().gt(0)` — was compared
    structurally and therefore always failed. The value is now checked against
    the predicate, and the report says so when a predicate is not satisfied.
  - A `@nudo:case` on a class method was never evaluated, so the witness was
    always `unknown` and every expectation failed. Class methods are evaluated
    now.
  - The value reported for a synthesized call-site witness was re-evaluated in
    the target's context and could disagree with the actual call. The
    observed value is reported now.
  - A sidecar that failed to load was reported as "no contract root", which
    sends the reader to write a contract that already exists. The load failure
    is reported as `nudo:interface-load` now.
  - A line-level directive (`@nudo:as`, `@nudo:replace`) inside a loop body, a
    `try` block, a `switch` case, a labeled statement, an arrow function body
    or a class method body was dropped without a word. Those positions are
    collected now, and a directive that cannot be applied anywhere is reported
    as `nudo:directive-syntax`.
  - A dependency module's own `@nudo:as` / `@nudo:replace` directives were
    ignored, so the same file analyzed as a root and as a dependency got
    different types.
  - A live import binding was frozen into a snapshot when the module graph was
    merged, so a change inside the dependency was invisible to the importer.
  - The synthetic `entry@` cases shared one module instance, so module-level
    state leaked from one case into the next.
  - A project-level path env file's *content* was not part of the analysis
    cache key, so a changed env file reused the previous result within the same
    process.
  - Two functions declaring a `@nudo:mock` of the same name: the one declared
    last won the whole file, and the first function was given the wrong type.
    The mock is now chosen by scope.
  - An inline `@nudo:mock` lost the fact that it can or cannot be constructed,
    so `new` on it did not throw where it should have.
  - A `@nudo:mock` in its `rejects` form was modelled as returning `never`,
    which made any return contract vacuously true and wrote `f(): never` into
    the generated declaration file. It is modelled as a promise that never
    fulfills now.
  - A `@nudo:pure` directive never reached the function it marked, so the
    directive did nothing.
  - `nudo:builtin-unknown` reported an imported or exported alias as an
    uncovered built-in, adding a warning next to a type that had already been
    inferred exactly.
  - A `--what-if` binding naming a type Nudo cannot express was silently
    widened to `any`, while the report said the binding had been applied as
    written. It degrades to `unknown` now, and the report says what was
    actually injected.
- b37321b: Project configuration is normalized once, and every product reads the same
  normalized value.
  
  - A `nudo` key whose value is not an object — `"nudo": true` — was ignored
    without a word, and it also suppressed the "this project has no Nudo
    configuration yet" hint. The key now stops the search for an ancestor
    configuration (the documented rule is "the nearest `package.json` that
    contains a `nudo` key"), the package is treated as having no Nudo
    configuration, and a note on stderr says so.
  - A `nudo` key holding a falsy value (`false` / `null` / `0` / `""`) did not
    stop the search either, so a sub-package silently inherited the root
    package's `check.ignoreThrows` and `nudo.env`. Presence now stops the
    search, whatever the value is.
  - `nudo.contract.autoBind` was passed through verbatim. A non-boolean value
    made `check` and `contract`/`export` disagree — one side treated it as
    "off", the other as "on" — and the disk cache could not tell the values
    apart, so a wrong conclusion was cached. The value is normalized to a
    boolean once, and a non-boolean falls back to `true` with a note.
  - `nudo.check.entryThrows` with an invalid value printed "using error" while
    the gate actually used the value the `profile` preset selects. The note now
    names the value in effect.
  - `nudo.cache: ""` did not override `NUDO_CACHE_DIR`; an explicit empty
    string now means "off", like `false` does.
  - `NUDO_MAX_FORKS` with an invalid value fell through to
    `nudo.analysis.maxForks`, so the run quietly used a budget the user had
    not asked for. An invalid value now falls back to the default and says so.
  - `nudo.analysis.maxForks` and the session cache limit are per-project
    settings, but they were written into process-wide slots only when the
    project configuration was looked up for the first time. Two projects
    analyzed in a different order got different results. They are now applied
    on every lookup, so the same project and configuration always give the same
    answer.
  - A `package.json#nudo.env` entry that is not an array, or an array with a
    non-string element, is reported instead of crashing the loader.
- dde4b03: The `.d.ts` product now projects the module's export surface: export names,
  classes and re-exports.
  
  - `export default function (…)`, `export default (…) => …`, `exports.compute = …`
    and `const f = …; export { f }` were dropped from the `.d.ts` product even
    though the export face advertised them. They are now declared.
  - A declaration is named after the **export name**, not after the local
    binding: `export { internal as publicName }` is declared as
    `publicName`, and `export default function addOne` is declared as
    `export default function addOne`. The local binding name is never
    mistaken for the export name.
  - A class is projected as a class: `export class C { … }` becomes
    `export declare class C { … }` with the constructor and the static
    methods inside it. The instance methods are no longer flattened into a
    module-level `C_m` export, which never existed in the source and merged
    with a real export of the same name into a fake overload.
  - A class instance type (`User`) referenced by a declaration is declared as
    well, so the `.d.ts` no longer fails to compile with `TS2304: Cannot find
    name 'User'`.
  - `export * from "…"` and `export { x } from "…"` are re-emitted, so the
    product's export surface matches the source module's.
- dde4b03: `nudo test --freeze` now writes into the source file **without disturbing the
  file's byte shape**, and the diff it prints can be applied by `git apply`.
  
  - **A UTF-8 BOM used to move into the middle of the file.** The freeze writes
    the new `@nudo:case` block *above* the declaration, so the first line moved
    down one line — and the BOM, which lived on that first line, moved with it:
    the file stopped being "UTF-8 with BOM" and became a UTF-8 text with a
    zero-width `U+FEFF` sitting in front of the `export`. The BOM is now kept
    aside while the body is edited and put back at the very front of the file.
    The same holds when already-generated directives are stripped (the first
    line may be dropped there, and the BOM used to go with it).
  - **A CRLF file stayed CRLF.** The newly inserted lines now follow the file's
    dominant line ending, so `file(1)` keeps reporting "with CRLF line
    terminators" instead of switching to "with CRLF, LF line terminators", and
    the lines that were already in the file keep the endings they had.
  - **The printed diff of a file without a final newline could not be
    applied.** `git apply --check` rejected it, because the diff did not say
    that the last line has no newline. The diff now follows the same line model
    as `diff -u` / `git diff`: the last line without a terminator is marked with
    `\ No newline at end of file`, and whether the file ends with a newline is
    treated as part of the content (as native tools do). Diffs for files with a
    final newline are unchanged.
  - **The diff no longer hides byte changes.** The BOM stays in the first line
    of the diff (the same shape native `git diff` produces), so a patch against
    a BOM file still applies, and a real byte change — a BOM being dropped by a
    writer, say — is shown instead of being reported as "no change".
- dde4b03: `nudo contract` no longer loses recursive contracts, crashes on bigint
  literals, or prints the contract's parameter names as the function's
  formal parameter list.
  
  - The contract surface cached constraints with
    `JSON.parse(JSON.stringify(c))`. A `lazy()` slot is a thunk (a
    function), and `JSON.stringify` silently drops function-valued
    properties, so a recursive constraint collapsed into an empty optional
    slot: the first run printed the expanded recursive shape, every later
    run printed `any().optional()`, and the cached surface was weaker than
    the `nudo check` gate for the same file. Constraints are now encoded
    with a dedicated codec: literals keep their type (`bigint`,
    `±Infinity`, `NaN`, `-0`, `undefined`), and a `lazy()` slot is stored
    as an index into a node table that is rebuilt into a thunk on read-back,
    so a cold run and a cache-hit run print the same thing.
  - `JSON.stringify` cannot represent a `bigint`, so a contract with a
    bigint literal made the whole `nudo contract` command fail with a bare
    `Do not know how to serialize a BigInt` (exit 1, no file, no diagnostic
    code) while `nudo check`, `nudo health` and `nudo test` stayed green on
    the same file. Bigint literals are now encoded losslessly and the
    command prints the contract normally.
  - The printed effective contract used the parameter names declared by the
    contract, so a contract binding `zzz` printed `(zzz: …)` for a function
    whose parameter is `x`, while `nudo check` printed `scale(x: any)` for
    the same file. The printed parameter list now comes from the declared
    formal parameter list (the same source as the `nudo check` signature),
    and a contract parameter that binds to no formal parameter is listed
    separately and marked `(not a formal parameter)` instead of taking over
    a parameter name.
- dde4b03: Quickfix edits: the `@nudo:throws` annotation now lands on the declaration it
  belongs to, TS sidecars carry their builder import, and the nullish quickfix
  no longer swallows a contract's `throws` obligation.
  
  - **The `@nudo:throws` annotation was written into the wrong place, or into a
    file that no longer parsed.** The quickfix located the declaration by name
    (first line that matched) and then scanned *downwards* for the first line
    containing a JSDoc terminator. A plain block comment (`/* note *\/`) inside
    the function body carries the same terminator, so the bare tag was emitted
    outside of any comment and the file stopped being valid JavaScript. The
    declaration is now resolved through the AST (top-level declaration of that
    name — a same-named local binding inside another function no longer
    matches) and the tag is written inside the JSDoc block actually attached to
    the declaration; when there is none, a complete JSDoc block is inserted
    above the declaration.
  - **Sidecars written for TypeScript sources did not compile.** `nudo check
    --fix --write` emitted the contract DSL (`fn({ x: shape({ toFixed: any() })
    })`) into a `*.nudo.ts` sidecar without any import: `fn` / `shape` were
    undeclared (`TS2304`) and `any()` collided with the TypeScript type keyword
    (`TS2693`), so the product failed `tsc --noEmit --strict`. TS sidecars now
    import the builders they use from `@nudojs/core`, renaming the ones that
    clash with a TypeScript type keyword, and the DSL is rewritten accordingly.
    JavaScript sidecars keep the existing "engine injects the builders" contract.
  - **The nullish quickfix deleted the user's `throws` obligation.** The
    `nullable(...)` wrapper was applied to everything between the first top-level
    comma and the closing parenthesis of `fn(...)`, which swallowed the third
    argument (`{ throws: "Error" }`). The gate then reported a *different* error
    (`entry-may-throw` instead of `constraint-violated`) — a "fix" that traded
    one red for another. Only the return slot is wrapped now; the remaining
    arguments are preserved verbatim, and the edit is downgraded to a review
    when the engine cannot prove that the gate turns green.
- dde4b03: `nudo contract --emit` no longer writes a derived contract twice for the same
  downstream export, no longer lets one root overwrite another root's contract,
  and no longer keeps the generated section of an export the source no longer
  has.
  
  - Two handwritten contracts in the **same** root file that call the same
    downstream export produced two derived rows for one export name, so the
    target sidecar got two `@generated` sections exporting the same name. That
    file is not valid ESM (`SyntaxError: Duplicate export of 'add2'`), so the
    sidecar never loaded and the derived contract silently degraded to a
    no-op (`add2(x: any)`). The roots are now aggregated per downstream export
    into a single derived row whose parameter domain is the **union** of the
    roots' domains (the widest one), and the sidecar is checked for duplicate
    export names before it is written — Babel does not report them, so the
    check is explicit now.
  - When **different** root files derive the same downstream export, the last
    writer simply replaced the previous section, so the snapshot covered only
    the call sites of one root and the result depended on the order in which
    the commands were run. The write now merges the new derivation with the
    existing section (again the widest domain) and records every contributing
    root in the section header, so the same source tree produces the same
    snapshot whatever the order is.
  - A generated section whose export no longer exists in the target source was
    never removed: it stayed in the sidecar as an export that does not exist at
    runtime and permanently held on the name, so a hand-written contract for a
    new function of the same name made the whole sidecar fail to load. The
    derived path now drops those stale sections and no longer derives a
    contract for an export the target does not have.
  
  The update path of the derived emitter also stopped appending the sections it
  did not rewrite a second time — they are already in place, so the sidecar
  used to end up with the same section twice (and an invalid export name).
- dde4b03: Derived contracts now name the parameter the implementation actually returns,
  and the same function derives the same contract no matter how many call sites
  the root has.
  
  - The return slot of a derived contract was anchored to a parameter by the
    derivation root node id alone. Every parameter derived from the same
    upstream variable shares that id, so `helper(a, b) { return b; }` called as
    `helper(x + 5, x + 1)` anchored the return to the **first** parameter and
    wrote `fn({ a, b }, a)` — a return constraint of `number().gt(5)` for an
    implementation that only guarantees `number().gt(1)`. The contract was
    stronger than the code, and `nudo contract` displayed it as authoritative.
    The anchor is now resolved against the parameter it actually describes:
    when several parameters share a root, they are told apart by the
    constraint value, and when that is still ambiguous the relative anchor is
    refused instead of guessed, so the return slot falls back to the direct
    chain projection.
  - A derived contract for one function could change shape when the root
    called it once or twice. The derivation tags were read after the call-site
    values had been joined, and joining two equal values returns one of them,
    so the join tag replaced the shift chain of the first call site and the
    compositional projection was never reached. The tags are now read before
    the join, and the return slot of a multi-call-site root is projected call
    site by call site. `add2(x) => x + 2` called once or twice now derives the
    same `fn({ x }, x.shift(2))`, instead of the second form degrading to a
    literal bound one ULP away (`number().gt(0.9999999999999999)`), which
    accepted a boundary value the exact form rejects.
  - When the call sites of one root do not derive the same chain, the derived
    section falls back to the expanded form; it no longer emits two `const`
    declarations of the same name with different values, which is not valid
    JavaScript.
- dde4b03: `nudo export --format dts` now derives its parameter table from the declared
  formals instead of from the observed call arity, and renders optionality the
  way TypeScript means it.
  
  - The parameter table used to be cut to the number of arguments seen at call
    sites, so a rest parameter produced `export declare function sum(...xs:
    number): number;` — not valid TypeScript (`TS2370`) — and a second call
    shape appended `arg1` / `arg2` after the rest parameter (`TS1014`). The
    table now follows the declared formals: a rest parameter absorbs the
    trailing arguments and is always last, and its type is promoted to an
    array.
  - A parameter declared by a contract but never exercised by a case used to
    disappear from the `.d.ts` (`addAll(a: number)` for a two-parameter
    contract), while `nudo check`, the zod face and the standard face all kept
    it. The declaration is now authoritative for the table's length; cases only
    contribute types.
  - A parameter with a default value was rendered as required, so consumers
    calling `def()` or `optNoEvidence(1)` — both legal in the implementation —
    hit `TS2554`. Optionality now comes from the contract, then from the
    declared default, then from the shortest observed call.
  - A contract that marks a top-level parameter optional
    (`number().optional()`) lost that marker in the `.d.ts` and rejected calls
    the contract allows (`TS2345`). The contract face now carries the
    optionality flag and the declaration renders `x?: number`.
  - A destructured parameter lost the whole handwritten contract and was
    declared `act(_p0: unknown)`, leaving TypeScript consumers with no type
    checking at all. The contract's field-level entries are now projected into
    the parameter's shape and the declaration uses the binding-pattern name
    (`act({ a, b }: { a: number; b: number })`).
  - Optional object slots were rendered as `k: T | undefined`, which in
    TypeScript still requires the key — the projection was *stricter* than the
    contract, the zod face, the standard face and `nudo check`, and rejected
    values those four accept (`TS2345` / `TS2741`). They are now rendered as
    the optional property `k?: T`, matching the `?` already used for top-level
    parameters.
- dde4b03: dts 投影面：Abs → TS 类型渲染与导出绑定名清洗的 6 处修正
  
  - **520**：手写契约的返回域保形——`lit(42)` 渲染成 `42`（与 zod / standard /
    `nudo check` 三面同口径）；旧口径把契约返回 widen 成 `number`（字面量住在
    Abs 的 **pred** 里、不在 term 里，widen 路径看不到它）。
  - **521**：内建**泛型** brand 补类型实参——`Map<unknown, unknown>` /
    `Set<unknown>` / `WeakMap<object, unknown>` / `WeakSet<object>`；旧口径直出
    裸名 ⇒ 产出的 `.d.ts` 吃 **TS2314**、编译不过。
  - **544**：Abs 的 `any`（未受约束）与 `unknown`（推断失败）**分面**——前者渲染
    成 TS `any`、后者才是 `unknown`（`abs.md:100` 明文规则）；旧口径两者合并成
    `unknown` ⇒ 消费方吃 **TS2571** 假红，而 zod / standard / guard 三面都宽松。
  - **552**：导出绑定名过保留字清洗（core 的 `toJsBindingIdent` 口径，`default` /
    `class` 等加 `_` 前缀）；旧口径直出 ⇒ 整份 `.d.ts` 吃 **TS1359 + TS1005**。
  - **554**：生成器 / 迭代器形态识别——带 `next` 槽的对象渲染成 `Generator<T>` /
    `AsyncGenerator<T>` / `IterableIterator<T>`（元素类型取数字下标元素槽），
    内部槽不进结构字段；旧口径把内部协议槽当普通字段直出 ⇒ 返回类型里没有
    `[Symbol.iterator]()` ⇒ 消费方 `for…of` 吃 **TS2488**。
  - **565**：零成员对象渲染成 `Record<string, never>`（不是 TS 的 `{}`＝任意非
    nullish 值）——属性读不再吃 **TS2339** 假红，且在联合类型里不再吸收
    `{ a: number }`（契约义务不再被静默作废）。
- dde4b03: The Standard Schema face now enforces what its own type says, and its
  `validate` never throws.
  
  - A fixed-length tuple was only checked element by element, so
    `pairOutput.validate([1, "two", 3])` passed even though the exported type
    is the 2-tuple `[1, "two"]` — the engine (`leqAbs`) and the zod face
    (`z.tuple`) both reject it. The tuple arm now requires the array length
    to match the element count, unless the tuple has a `rest` slot.
  - The two copies of the validator disagreed: the library version walked
    arrays with `forEach` (which skips holes) while the generated module used
    an index loop (which reads a hole as `undefined`), so the same schema and
    the same sparse array got opposite verdicts. Both copies now use the
    index loop, matching the zod face and the engine, which both read a hole
    as `undefined`.
  - A `brand` node was accepted unconditionally, so `mkDateOutput.validate({})`
    passed while the zod face of the same export (`z.instanceof(Date)`)
    rejected it. A brand whose name is a runtime global constructor is now
    checked with `instanceof` (no import needed, the product stays
    importable); brands with no runtime criterion (user classes) are still
    passed through, and the projection already records them as dropped.
  - A `fn` node was accepted unconditionally, so a function-typed output
    validator passed `42` / `null` / `"str"` / `{}` while the zod face
    (`z.function()`) rejected all of them. A `fn` node now requires the value
    to be a function (the signature is not checked).
  - A required slot was only considered present when it was an *own*
    property, so a value carrying the key on its prototype
    (`Object.create({ c: 1 })`) was reported as missing — stricter than the
    zod face and than the TypeScript structural type, which both accept it.
    Key presence now follows `HasProperty` semantics, minus the
    `Object.prototype` pollution keys (`toString`, `constructor`, …).
  - `~standard.validate` threw a `TypeError` on a `bigint` or a circular
    object, because the issue message was built with `JSON.stringify` on the
    runtime input. Standard Schema v1 requires `validate` to *return* a
    result, so the message is now built with a safe description
    (`1n`, `<unserializable>`) and any error is reported as an issue instead
    of escaping.
  - The issue message no longer loses non-finite numbers: `Infinity` is
    reported as `expected Infinity, got 0` instead of `expected null, got
    null`, matching the zod, guard and `nudo check` faces.
- dde4b03: Emit products: the zod `number` schema now covers the whole JavaScript number
  domain, the type guards are valid TypeScript, and a literal that only came
  from an uncertain observation is no longer projected as the exit domain.
  
  - **The zod schema rejected the very value the exported function returned.**
    An Abs `number` primitive covers every JavaScript number, NaN and
    ±Infinity included, but zod's `z.number()` only accepts finite numbers (its
    parse requires `!Number.isNaN(input) && Number.isFinite(input)`). The
    projection was therefore *narrower* than the type it claims to describe: a
    function returning `0 / 0` was described by a schema that rejected its own
    return value, so consumers validating the result got a false red. The zod
    dialect now widens an unrefined `number` to the full domain
    (`z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))`).
    A `number` that carries a refinement keeps the narrow form, because the
    refinement itself already excludes the non-finite values (`x > 5`,
    `Number.isInteger(x)`). The shared schema node is unchanged, so the
    standard dialect keeps its current (NaN-accepting) number check.
  - **The generated type guards did not compile.** `<file>.nudo.guard.ts` is a
    TypeScript file, but the guard signature carried no type annotation
    (`export function isUserOutput(data) { … }`), so under `tsc --noEmit
    --strict` the parameter was an implicit `any` (`TS7006`) and the product
    could not be used in a strict project. The guards now take `value: unknown`
    and return `boolean`; inside the body the checked value is narrowed to the
    narrowest type that lets the predicate compile — the primitive type for a
    primitive or literal, a dynamic object shape for a structural form, and the
    union of the member types for a union. Only built-in TypeScript type names
    are used, so a product never references a user class name (`TS2304`).
  - **A literal observed once was projected as if it were the exit domain.**
    When the only evidence about a return value is an uncertain observation (a
    join of several call sites, a mock, or a fallback evaluation), its literal
    is not the function's exit domain: a rest parameter observed through the
    fallback evaluation was projected as `literal(1)` by the zod, standard and
    guard dialects, and those products then rejected the exported function's
    own return value. Literals from uncertain observations are now widened to
    their base type in all three dialects, and the widening is recorded in the
    `dropped` ledger. Literals that are certain (`exact` confidence) and
    literals coming from a hand-written contract keep their exact form.
- dde4b03: `nudo contract --emit` now writes sidecars that are valid, compilable and
  byte-faithful, and it no longer contradicts the LSP lens or the check face.
  
  - A value-level template in the sidecar (`export const classify = number()`)
    was treated as a handwritten **function** contract, so the emitter refused
    to persist anything for that name ("handwritten wins — skipping") while the
    code lens showed the function as having *no* contract. The clash set now
    follows the same rule as the tier face (only `fn(…)` bindings are
    contracts); a non-contract binding that occupies the export name is
    replaced in place by the generated section, so the sidecar becomes valid
    and the contract takes effect.
  - A generated section could collide with an **import local binding** of the
    same name, which made the whole sidecar unloadable
    (`Identifier 'x' has already been declared`) and silently dropped every
    contract of that file — while the tool reported success. Import locals are
    now part of the binding allocation, so the section falls back to an alias
    binding (`const _nudo_1 = …; export { _nudo_1 as x };`).
  - `--emit --fn <name>` no longer reorders the existing `@generated` sections:
    the sections are replaced in place, so a refresh produces a content-only
    diff instead of a pure reordering (which made `--exit-on-diff` fail in CI
    on the first run).
  - The sidecar keeps its own byte shape: the generated sections now use the
    sidecar's dominant line ending (a CRLF sidecar no longer becomes a
    mixed CRLF/LF file), and a UTF-8 BOM is preserved instead of being
    silently dropped (a no-op emit no longer reports a change).
  - A sidecar for a **TypeScript** source (`*.nudo.ts`) now declares the
    builders its generated section uses, so the product compiles
    (`tsc --noEmit --strict` reported `Cannot find name 'lit'` / `'fn'`
    before). The declaration is type-only and keeps the runtime behaviour of
    the JavaScript sidecar (builders are injected by the sidecar loader).
  - The `nudo:interface-emit-denied` message now names the **source file**
    that was rejected and states that the allowlist patterns match the source
    file path, so an allowlist copied from the documentation is not refused
    forever.
  - The emit summary is the single place where diagnostics are rendered: a
    diagnostic is printed once, and the CLI and the LSP agent face agree.
- dde4b03: `nudo contract --draft` now writes a draft that can be copied into a sidecar
  as-is: the sidecar key is the module's **export identity**, the file is
  always valid JavaScript, the return obligation never contradicts the
  function's own inferred return domain, and a draft the user has edited is
  never silently overwritten.
  
  - The draft's sidecar key came from the *analysis name*, sanitized into a
    legal identifier. An anonymous `export default` therefore got the
    synthesized key `_default`, while the key that actually binds is
    `default` — copying the draft into `*.nudo.js` left the contract in
    place but **inert**, and `nudo check` stayed green on a call that
    violated it. The key is now the export identity (the same source as
    `nudo contract --emit`), and an unsafe binding name is emitted in the
    alias form `const _nudo_N = …; export { _nudo_N as <identity> };`.
  - The builder `import` and the generated `export const <name>` shared one
    module scope, so a function whose name is a builder name (`number`,
    `lit`, `union`, …) produced `import { number } from "@nudojs/core"` next
    to `export const number = …` — a parse-time `SyntaxError: Identifier
    'number' has already been declared`. The generated file was not valid
    JavaScript, so the "copy the accepted exports into the sidecar" step
    could only produce a broken sidecar. The same collision is fixed in the
    `--from-dts` draft.
  - A rest parameter (`...rest`) was rendered into the constraint DSL
    verbatim (`{ first: number(), ...rest: number() }`), which is neither a
    legal object literal nor legal DSL: copying the draft broke the whole
    sidecar (`nudo:interface-load`), losing every contract in the file.
    Rest-parameter functions are now reported as `not-projectable` and
    skipped, and every draft is assembled once (`execNudoModule`) before it
    is written — a draft that does not load is never handed to the user.
  - The return obligation was derived only from the *observed* call sites,
    which are a subset of the function's real return domain: `opt(flag)`
    returning `1 | null` was drafted as `fn({ flag: boolean() }, number())`,
    so accepting the draft made the function violate its own draft. The
    obligation is now checked against the inferred return domain (the same
    source as the `nudo check` signature) and is not written when it does
    not cover it.
  - `--draft --write` overwrote a hand-edited `*.nudo.draft.js` without a
    word, while the file's own header claims "Handwritten contracts are
    never overwritten". Drafts now carry a content fingerprint; a draft
    whose content no longer matches its fingerprint is kept as-is and the
    command reports that it was not overwritten.
- dde4b03: `nudo test --freeze` now writes call-site witnesses without disturbing the
  source file it writes into: the new `@nudo:case` block lands at the
  declaration's own column, it keeps the file's line-ending convention, and a
  witness that cannot be expressed faithfully is dropped instead of being
  written as a different (wrong) value.
  
  - **The frozen JSDoc block was indented by the `function` keyword's column
    instead of the declaration's.** For `export function greet(u) { … }` the
    function node starts at column 7 (`export default function` at column 15),
    so the whole block was shifted right and no longer lined up with the
    declaration it documents. The block is now indented like the declaration
    line it is inserted above, which keeps nested functions at their own
    indentation.
  - **Writing into a CRLF file produced mixed line endings.** The existing
    lines kept their `\r\n`, but the newly inserted block was written with bare
    `\n`, so `file(1)` started reporting "with CRLF, LF line terminators" and
    the file's line-ending convention was silently rewritten. Newly inserted
    lines now follow the file's dominant line ending, and the existing lines
    keep the endings they already had.
  - **A sparse tuple's holes were frozen as explicit `undefined` elements.**
    The hole of `[1, , 3]` carries the same abstract value as an explicit
    `undefined` element, so the witness could not tell them apart and was
    written as `[1, undefined, 3]`. Reading that back says the array is dense:
    the very same call site flipped from `false` to `true`, i.e. the freeze
    rewrote an observed fact into its opposite. The case-argument grammar has
    no spelling for a hole, so such a witness is now skipped (like a witness
    with a rest slot) instead of being approximated.
- 106ad1d: 族 54 · service 协议面收口（3 条中的 2 条；第 3 条在 nudojs 包，见下）。
  
  **Bug 697（env 模板族扩展名表）** — `isEnvTemplatePath` 的 mock 两支
  （`mock-<name>.<ext>` / `<name>.mock.<ext>`）只认 `js|mjs|ts`，而 `.env.<ext>`
  分支认 `js|mjs|ts|cjs|cts|mts` ⇒ 族内两支各写各的扩展名表 ⇒ `mock-foo.cjs` /
  `fs.mock.cts` / `x.mock.mts` 这类 env 模板**不进 watch 门禁** ⇒ 模板改动
  不触发依赖源文件复分析。改为三支**同表**（`js / mjs / ts / cjs / cts / mts`）；
  mock 前缀支同时锚到 **basename** 起点（相对路径形态 `mock-foo.js` 同样成立）。
  非模板路径判定逐字不变。
  
  **Bug（族 54 / item 2：hover 的 throws 段在两种状态下仍缺）** — hover 只读
  case 台账的 throws 证据（`AnalysisResult.functions[].cases[].throwsAbs`），
  而函数级 throws 域（check 签名行口径 = 入口求值的 hard throw ∪ soft
  may-throw）的唯一载体是 `entry@` 见证 ⇒ 两种状态下证据随见证一起消失 ⇒
  IDE 的 throws 段与 `nudo check` 的签名尾缀分叉：
  
  - **有调用点见证**：`settleEntryOnlyCandidates` 把 `entry@` 见证连同 throws
    证据一起撤掉、改由 `call@` 见证承担调用点域 ⇒ 证据无处安放；
  - **模块级调用点路径**：该路径**从不**产 `entry@` 见证（调用点域直接接管）
    ⇒ 同样无处安放；
  - **选中 case**（LSP selectCase）：被选函数**不生成** `entry@` 见证（域由
    选中的那条 case 声明）⇒ 同样无处安放。
  
  改为：入口域的 throws 证据并进该函数**已有**的见证（并集；见证数不变、
  推断域不变 ⇒ 产物面 / 固化面 / 报告台账的形状都不动）。补证据时只跑**只取
  证据**的入口求值（不产见证 / 不改域 / 不报诊断 / 不并入调用点台账），且只对
  **导出**函数补（入口面口径 = 导出函数，与 hover / check 同源）。
  `nudo test` 的 "all" 模式不在补证据范围内 ⇒ 报告面不变。
  
  **未收口（第 3 条，跨包）** — 台账里的「`migrate verify` 库面整批 abort」
  实测**已不成立**：`migrateVerify`（`packages/nudojs/src/migrate.ts`）早已逐
  文件隔离（同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件照常
  返回）。仍整批 abort 的是同族的 `migrateStrip`（696 的库面半边：
  `planStrip` → `makeStripPlan` 遇解析错即 throw ⇒ 同目标内其它文件的成功结果
  全丢）—— 该文件在 **nudojs** 包（另一分片的范围），本片未改。
- 8542f44: fix(service): 契约申报的 bigint 字面量在 zod 面不再被静默放宽（族 37 · Bug 1046）
  
  **病灶**：契约里申报 bigint 字面量（如侧车 `fn({}, lit(10n))`）时，zod 面的产物
  写的是 `z.unknown()` —— 比门禁**宽**（门禁按 `lit(10n)` 判红、zod 放行 `10` / `42` /
  `"x"` / `null`）⇒ **假绿**；而且**零台账**（产物里没有任何痕迹）。
  
  零台账的根因是**两层都失声**：契约路径的 Abs 把字面量放在 **pred** 里
  （`eq(self, lit(10n))`）⇒ 节点层（`absToSchemaNode`）认为「投影成功」（节点 =
  `{k:"lit", value:10n}`）⇒ 不进 `dropped`；而 zod 渲染臂 `case "lit"` **没有 bigint
  分支** ⇒ 落到兜底 `z.unknown()` ⇒ 与 standard 面（`{"k":"lit","value":10n}` 保真）
  的**接受集自相矛盾**。
  
  **修法**（`packages/service/src/emit/schema-generator.ts`）：
  
  - zod 方言的 `lit` 臂补 bigint 分支 ⇒ `z.literal(10n)`。zod 的 `z.literal`
    **原生支持 bigint**（zod v3/v4 皆可；真 zod v4.6.7 实测 `safeParse(10n)=true`、
    `safeParse(10|42|"x"|null|undefined)=false`）⇒ zod 面的接受集现在**等于**
    standard 面 ⇒ 跨面自相矛盾消失。
  - **方言保真**升为渲染层的**局部不变量**：zod 渲染器改为同时返回**源码 + 自己
    的降级台账**，凡是把可表达的形态降级成 `z.unknown()`（类型外的字面量值、没有
    运行期构造器的 brand）**必须留痕** ⇒ 台账并进**既有** `dropped` 通道 ⇒ 出现在
    产物的 `// dropped preds (not projected into zod):` 块里（用户可见）。
    「静默放宽」从此在渲染层不再可能发生（改前 bigint 契约字面量就是靠这条路漏出去的）。
  
  **已知偏差（core 层，族外，未修）**：guard 面渲染
  `(typeof data === "number") && (data === 10n)` ⇒ `guard(10n) === false`
  （**假红**：拒收契约申报的唯一合法值）。根因在 core：`litC(bigint)` 不给 prim
  （`PrimName` 有 `"bigint"` 但 `litC` 不用）⇒ `constraintOnTermAbs` 落到
  「有界但无 prim ⇒ 按 number 处理」的兜底 ⇒ Abs 的 shape 说 number、pred 说 bigint。
  core 不在本族范围 ⇒ 以 `it.fails` 旗标钉住（core 修好后旗标会翻红，提醒摘掉）。
- Updated dependencies [02aa122]
- Updated dependencies [6ec8afc]
- Updated dependencies [7fea13a]
- Updated dependencies [bb8e201]
- Updated dependencies [5c750f2]
- Updated dependencies [e3b8791]
- Updated dependencies [8a5bf7e]
- Updated dependencies [8542f44]
- Updated dependencies [f11510a]
- Updated dependencies [5c750f2]
- Updated dependencies [29d766d]
- Updated dependencies [e3b8791]
- Updated dependencies [e3b8791]
- Updated dependencies [6e5344a]
- Updated dependencies [f896290]
- Updated dependencies [a069994]
- Updated dependencies [7fea13a]
- Updated dependencies [8bf3fd0]
- Updated dependencies [5749924]
- Updated dependencies [0f67015]
- Updated dependencies [2d96c29]
- Updated dependencies [e3b8791]
- Updated dependencies [f6538a2]
- Updated dependencies [e3b8791]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [ec0a9e4]
- Updated dependencies [c325a10]
- Updated dependencies [c325a10]
- Updated dependencies [b37321b]
- Updated dependencies [e2880fd]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [3d79864]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [5dd89ca]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [e2880fd]
- Updated dependencies [5c750f2]
- Updated dependencies [4d1a249]
- Updated dependencies [af09752]
- Updated dependencies [fcaa9e9]
- Updated dependencies [7fea13a]
- Updated dependencies [9ccffb3]
- Updated dependencies [e9fdaa7]
- Updated dependencies [7fea13a]
- Updated dependencies [a1c093f]
- Updated dependencies [9f26414]
- Updated dependencies [67abd92]
- Updated dependencies [3d66f5a]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [b0878e3]
- Updated dependencies [a069994]
- Updated dependencies [493b8c2]
- Updated dependencies [d7ae28a]
- Updated dependencies [edc7590]
- Updated dependencies [5c750f2]
- Updated dependencies [ed4d259]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [1b08a18]
- Updated dependencies [b4768ca]
- Updated dependencies [5fd3cbb]
- Updated dependencies [5fb8a51]
- Updated dependencies [e20c128]
- Updated dependencies [abff33b]
- Updated dependencies [e3b8791]
- Updated dependencies [5c750f2]
- Updated dependencies [c80456a]
- Updated dependencies [e6c4586]
- Updated dependencies [f87c9f9]
- Updated dependencies [5c750f2]
- Updated dependencies [a3c95a4]
- Updated dependencies [e3b8791]
- Updated dependencies [7fea13a]
- Updated dependencies [d56cbd7]
- Updated dependencies [e5b3f38]
- Updated dependencies [089d4ec]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [02aa122]
- Updated dependencies [f47fd50]
- Updated dependencies [5c750f2]
- Updated dependencies [d2cf3cf]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [fbca6fb]
- Updated dependencies [535adcd]
- Updated dependencies [5c750f2]
- Updated dependencies [535adcd]
- Updated dependencies [e3b8791]
- Updated dependencies [b6abab4]
- Updated dependencies [356172a]
- Updated dependencies [ebe909e]
- Updated dependencies [e3b8791]
- Updated dependencies [a069994]
- Updated dependencies [dde4b03]
- Updated dependencies [369a42d]
- Updated dependencies [29d766d]
- Updated dependencies [7fea13a]
- Updated dependencies [56f308e]
- Updated dependencies [5c750f2]
- Updated dependencies [7fd7468]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [ae69b28]
- Updated dependencies [5c750f2]
  - @nudojs/core@1.16.0
  - @nudojs/env@0.5.3
  - @nudojs/parser@1.5.3
  - @nudojs/harvester@0.4.3

## 1.9.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/env@0.5.2
  - @nudojs/harvester@0.4.2
  - @nudojs/parser@1.5.2

## 1.9.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/env@0.5.1
  - @nudojs/harvester@0.4.1
  - @nudojs/parser@1.5.1

## 1.9.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- aae0f96: Fix stale-cache windows in cache keys and session eviction. `nodeHarvestCacheKey`
  floored `mtimeMs` to whole seconds (same-second, same-size rewrites of
  `@types/node` reused a stale harvest — now uses the raw float mtime, matching
  the repo-wide `mtimeMs+size` strict-equality contract). The path-env cache
  key/validation only compared `mtimeMs` (coarse-mtime filesystems could keep
  serving a stale `defineEnv` factory and re-register it, self-perpetuating — now
  `mtimeMs+size`, and the direct-import URL query carries `size` so the ESM
  module cache can't replay old content). The path-env fallback copy filename
  hashed only `path:mtime` — rewritten content now hashes into the filename so a
  changed file gets a new URL and the ESM cache invalidates naturally. Harvest
  caches (`harvestCache`, node not-found cache) had no production eviction —
  `clearAnalysisSessionCaches()` now clears both, so `pnpm install` / watcher
  rounds see upgraded or newly installed `@types` without a process restart.
  `checkMemoKey` now normalizes `filePath` via `stablePathKey` (same file no
  longer occupies two entries under different path shapes).
- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/harvester@0.4.0
  - @nudojs/parser@1.5.0
  - @nudojs/env@0.5.0

## 1.8.0

### Minor Changes

- c19bd48: Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).
  
  - parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
  - service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
  - vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/env@0.4.42
  - @nudojs/harvester@0.3.28

## 1.7.0

### Minor Changes

- 0d9e7de: `@nudo:skip` no longer kills `@nudo:case` evaluation (#176) — the declared face and runtime ground truth are no longer a trade-off.
  
  - A skipped function keeps `combinedAbs` from its declared return face (dts/sidecar/draft consumers unchanged), while declared `@nudo:case` directives are evaluated and asserted as usual; `nudo test` prints the skip note and the case assertions in the same block (previously the cases vanished entirely: "no declared @nudo:case expectations")
  - `nudo check` behavior is byte-identical (caseMode none — no case evaluation, no synthesized entry@ for skipped functions)

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/env@0.4.41
  - @nudojs/harvester@0.3.27
  - @nudojs/parser@1.4.23

## 1.6.25

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/env@0.4.40
  - @nudojs/harvester@0.3.26
  - @nudojs/parser@1.4.22

## 1.6.24

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0
  - @nudojs/env@0.4.39
  - @nudojs/harvester@0.3.25
  - @nudojs/parser@1.4.21

## 1.6.23

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/env@0.4.38
  - @nudojs/harvester@0.3.24
  - @nudojs/parser@1.4.20

## 1.6.22

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.
- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/env@0.4.37
  - @nudojs/harvester@0.3.23
  - @nudojs/parser@1.4.19

## 1.6.21

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1
  - @nudojs/env@0.4.36
  - @nudojs/harvester@0.3.22
  - @nudojs/parser@1.4.18

## 1.6.20

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/env@0.4.35
  - @nudojs/harvester@0.3.21
  - @nudojs/parser@1.4.17

## 1.6.19

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/env@0.4.34
  - @nudojs/harvester@0.3.20
  - @nudojs/parser@1.4.16

## 1.6.18

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/env@0.4.33
  - @nudojs/harvester@0.3.19
  - @nudojs/parser@1.4.15

## 1.6.17

### Patch Changes

- fa52735: 参数契约 inlay hints（形参后 `where …`）默认关闭：显式契约（递归 AST 节点联合等）行内展开可达数万字符。新增 `nudo.inlayHints.parameters`（boolean，默认 `false`）三级配置——项目 `package.json#nudo.inlayHints.parameters` 显式值赢，宿主设置（VS Code `nudo.inlayHints.parameters` / Zed `language-servers.nudo.initialization_options.inlayHints.parameters`）只在项目未设置时作默认；`workspace/didChangeConfiguration` 实时生效并触发 `inlayHint/refresh`。返回类型 inlay（`: …`）、case hints 与 interface 档 inlay 不受影响；hover 仍展示完整契约。
- 35ce944: Fix recursive-fn local hover poisoning and arity-only fn hover display
  
  - `$nodoPos` position records and call/assign records now carry the caller-frame depth; hover replay surfaces (`absNodeAtPosition`, `collectEnclosingFnLocals`) only read outermost-frame records. Recursive functions on self-referential contracts (`lazy(() => astNode)`) no longer bind cycle-truncated `opaque unknown` into local-variable hovers (`obj` now shows the computed `null | string | undefined`).
  - `const x = <non-call init>` declarations record the bound Abs at the declarator-id position during hover replay (`recordPositions` only) — ternary/optional-chain/literal-initialized locals are hoverable (`prop`, `q`).
  - `callTranspiledExportFullInner` refines the called fn Abs `returnType` slot after a successful call (same policy as class method slots, display-only).
  - LSP hover: an arity-only fn Abs (empty `returnType` slot) no longer preempts the generalize intension face; fn-name/callee hovers show the full contract signature `(node: nullable(astNode)) => null | string | undefined` instead of `(arg0) => ?`.
- 5e275df: fix: review hardening — Map.groupBy empty-reduce crash, Bug 1 early-exit relational narrowing, fs-error graph-edge degradation, agent tool module graph, brand presence for URLSearchParams/TextDecoder/Intl, generator side-table $copy migration
  
  - `Map.groupBy` / `Object.groupBy`: shadow-domain join no longer bare-`reduce`s an empty unkeyed list (raw host `TypeError: Reduce of empty array with no initial value` escaped module evaluation → fail-closed unknown exports when the callback folds a literal key over arr/abstract-string-prim items); empty fold degrades to `unknown`.
  - Early-exit lift path (if-return followed by non-tail statements) now applies the same relational-arm narrowing as the regular IfStatement path (`narrowRelArmThunk`), fixing false positives like `if (x >= 0) return x; console.log(x); return 1;` under `@nudo:contract return nonNeg`.
  - `extractImportEdges` skips import edges whose target resolution throws `ModuleReadError` (EACCES/ESTALE, #135) instead of crashing module-graph construction (CLI watch start, incremental rebuild false-green rounds, LSP validation).
  - `new Function(...)` / `new Function("a", "b", ...)` validate every argument for the L2 may-throw gate, not just the first.
  - Brand presence tables: URLSearchParams (methods + `size`), TextDecoder (`decode` + accessors), Intl.NumberFormat/DateTimeFormat (`format`/`formatRange`/parts/`resolvedOptions`); URLSearchParams joins ITERABLE_BRANDS (@@iterator → function).
  - `$copy` snapshots migrate generator/match side tables (genDeferred throws, genIter/matchAll elements), so fork/switch-arm rebinding no longer silently drops deferred generator throws.
  - LSP agent tools (check/hover) build the module graph like the CLI and LSP validation do, fixing cross-module unknown collapse (E5 parity).
- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0
  - @nudojs/env@0.4.32
  - @nudojs/harvester@0.3.18
  - @nudojs/parser@1.4.14

## 1.6.16

### Patch Changes

- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4
  - @nudojs/env@0.4.31
  - @nudojs/harvester@0.3.17
  - @nudojs/parser@1.4.13

## 1.6.15

### Patch Changes

- b6495c6: fix(service): check 结果对瞬时/持久 fs 故障确定性化（#135 少集模式）
  
  - `resolveModuleFile` 改单次 statSync（消灭 existsSync+statSync TOCTOU 双调用）：ENOENT/ENOTDIR/EISDIR 按候选 miss；其余 errno（EACCES/EIO/ESTALE/EMFILE…）抛 ModuleReadError，不再被 existsSync 吞成「无此文件」。
  - 持久 fs 故障：侧车 ambient 绑定显式报 error 级 `nudo:interface-load`（带路径+errno）且 check exit 1——修复前同一故障静默丢整族契约诊断（constraint-violated/unproven-return 整体消失、无任何诊断、exit 0 假绿，且跨版本逐字节相同）。
  - 瞬态故障自愈：checkSource per-call loadModule 缓存对「抛错」不缓存、下一探测重试——单次 stat 抖动不再钉死整场 miss。
  - `LoadDepsFingerprint.readError`（`readerr:` 前缀，`trunc:` 优先）：读错误轮指纹键不可信，check 整文件 memo / generalize L0 / evaluator memo / analysisFileCacheKey / LSP 校验指纹一律 fail-closed 不读不写，杜绝错误轮与 miss 轮互为跨次陈旧命中。
  - `findProjectConfig` stat 错误分类：非 ENOENT 的 package.json stat 故障 stderr 告警 + 子树 fail-closed（不静默继承/丢失 profile、env 名单），修复 severity 漂移（adoption 丢失导致 entry-may-throw error↔warning 摆动）。
- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3
  - @nudojs/env@0.4.30
  - @nudojs/harvester@0.3.16
  - @nudojs/parser@1.4.12

## 1.6.14

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/env@0.4.29
  - @nudojs/harvester@0.3.15
  - @nudojs/parser@1.4.11

## 1.6.13

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/harvester@0.3.14
  - @nudojs/parser@1.4.10

## 1.6.12

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/harvester@0.3.13
  - @nudojs/parser@1.4.9

## 1.6.11

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0
  - @nudojs/env@0.4.26
  - @nudojs/harvester@0.3.12
  - @nudojs/parser@1.4.8

## 1.6.10

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10
  - @nudojs/env@0.4.25
  - @nudojs/harvester@0.3.11
  - @nudojs/parser@1.4.7

## 1.6.9

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9
  - @nudojs/env@0.4.24
  - @nudojs/harvester@0.3.10
  - @nudojs/parser@1.4.6

## 1.6.8

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/harvester@0.3.9
  - @nudojs/parser@1.4.5

## 1.6.7

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/harvester@0.3.8
  - @nudojs/parser@1.4.4

## 1.6.6

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/harvester@0.3.7
  - @nudojs/parser@1.4.3

## 1.6.5

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/harvester@0.3.6
  - @nudojs/parser@1.4.2

## 1.6.4

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/harvester@0.3.5
  - @nudojs/parser@1.4.1

## 1.6.3

### Patch Changes

- 50e50f1: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 50e50f1: fix(service): evaluator run 缓存键补齐维度与宿主 loader 透传。`tryRunEval` 缓存条目加入 `lenientGlobals` / `maxLoopIters` 命中维度，并按「入口文件 × mode」分槽——同 source 不同 lenient/迭代预算不再互命中陈旧结果，`collectCallRecords` 的 exec 采集不再踢掉同文件的 analyze 条目（`evictEvalCacheForFiles` 一并清两种 mode 槽）。宿主 `loadModule`（LSP 虚拟 FS / 侧车）现透传到模块图组装与 depKey：analyzer 一次分析内求值不再回落 `defaultLoadModule`，`tryEvalCall` / `tryEvalCallFull` 同口径接受 loader 与宿主预计算 `depKey`（复用 analyzer 一次 BFS，避免 per-fn 线性放大）。模块图组装序列（evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv → applyMockModule*）收敛为 `composeEvalModules` 单一入口（analyzer 与 evaluator 共用，消除一次分析内的重复 parse/eval 与两处漂移）。删除恒真死代码 `isEvalCapable`（公共导出一并移除；能力判定由转译点 fail-closed 承担）与 analyzer 中永不填充的 `unreachableRanges`/不可达 else 分支；`setEvalCallCollector` 恢复改为显式 `undefined` 判定；`defaultAbsLoadModule`/`resolveRel` 候选遍历收敛为单一 `readFirstRel`。
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18
  - @nudojs/harvester@0.3.4

## 1.6.2

### Patch Changes

- a00bccc: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 446914f: fix(service): evaluator run 缓存键补齐维度与宿主 loader 透传。`tryRunEval` 缓存条目加入 `lenientGlobals` / `maxLoopIters` 命中维度，并按「入口文件 × mode」分槽——同 source 不同 lenient/迭代预算不再互命中陈旧结果，`collectCallRecords` 的 exec 采集不再踢掉同文件的 analyze 条目（`evictEvalCacheForFiles` 一并清两种 mode 槽）。宿主 `loadModule`（LSP 虚拟 FS / 侧车）现透传到模块图组装与 depKey：analyzer 一次分析内求值不再回落 `defaultLoadModule`，`tryEvalCall` / `tryEvalCallFull` 同口径接受 loader 与宿主预计算 `depKey`（复用 analyzer 一次 BFS，避免 per-fn 线性放大）。模块图组装序列（evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv → applyMockModule*）收敛为 `composeEvalModules` 单一入口（analyzer 与 evaluator 共用，消除一次分析内的重复 parse/eval 与两处漂移）。删除恒真死代码 `isEvalCapable`（公共导出一并移除；能力判定由转译点 fail-closed 承担）与 analyzer 中永不填充的 `unreachableRanges`/不可达 else 分支；`setEvalCallCollector` 恢复改为显式 `undefined` 判定；`defaultAbsLoadModule`/`resolveRel` 候选遍历收敛为单一 `readFirstRel`。
- 89358f2: fix(service): `absModuleCache` 命中校验不再对宿主 custom loader 磁盘盲。loader 接管的依赖模块（磁盘存在 + loader 覆写内容，LSP 未保存 buffer 的典型形态）自身命中条件从「stat mtime+size 严格相等」改为「loader 当前内容 hash == 插入时实际求值源码 hash」——buffer 内容 A→B 而磁盘未动时不再陈旧返回 A 的旧导出；loader 不接手该路径（undefined）回落 stat，loader 抛错按 miss 重装载（宁冷勿陈旧）；默认 loader（未传 `opts.loadModule`）行为零变更，stat 快路径保留。命中校验取过的 loader 内容在 miss 重装载时复用（同参不二次调用）。当时记录的传递依赖残余（子树指纹仍按磁盘复核）由紧随的 loader 感知子树指纹修复 changeset 补齐。
- 89358f2: fix(service): `absModuleCache` 子树内容指纹不再对宿主 custom loader 磁盘盲——补齐 loader-aware 命中修复（上一条 changeset）记录的传递依赖残余。依赖指纹条目从只存 `path` 扩展为携带装载询问证据 `via = { spec, fromFile }`（无条件记录：该对恒已知，条目不存 loader 引用）：带 loader 复核时按原询问对重问**当前** loader 比对内容 hash——loader 覆写**传递**依赖（LSP 未保存 buffer）的两个方向都不再陈旧：编辑方向（buffer A→B 磁盘未动）与接管方向（首轮磁盘装载、loader 新近接手）；loader 不接手（undefined）回落磁盘内容比对（该依赖此刻本就从磁盘装载），loader 抛错 / 依赖被删按 miss 重装载（宁冷勿陈旧）；loader 虚拟内容与磁盘不一致但稳定时，子树从「永久 miss」转为正常命中（复核按 loader 当前内容）。默认 loader（未传 `opts.loadModule`）行为与性能零变更：无 loader 时子树复核纯磁盘读取，stat 快路径保留（既有计数护栏钉住）。公共类型 `AbsModuleDepFingerprint` 新增可选字段 `via`（向后兼容，不构成 minor）。
- 89358f2: fix(service): `absModuleCache` 自身命中的 loader 弃管方向不再陈旧——custom loader 曾覆写某路径（LSP 未保存 buffer）、随后不再接管该路径（buffer 未保存即关闭回退磁盘）时，回落分支此前只比磁盘 `mtimeMs+size`，条目里的 buffer 版导出会在磁盘 stat 未动时被陈旧命中。现在 `opts.loadModule` 在场且 loader 不接手的路径在 stat 相等后再补「磁盘内容 hash == 插入时求值源码 hash」复核（读出的磁盘内容进 preloaded，miss 重装载复用不二次读盘）；默认 loader（未传 `opts.loadModule`）保持纯 stat 快路径零退化。回归：buffer 覆写 v=2 → loader 弃管 → 必回磁盘真值 v=1（修复前红：陈旧返回 2）。
- 446914f: fix(service): `findProjectConfig` 增加目录链 memo——条目记录向上查找访问过的每个 package.json 的 mtimeMs+size（无文件记 absent），命中只做链上 stat 比对，不再每次 existsSync + readFileSync + JSON.parse（LSP 每次 getCachedOrAnalyze / validateText 都会调它）。链上任何 package.json 新建/改写/删除（含 absent↔存在翻转）自动 miss 重算；`clearAnalysisSessionCaches` 显式清空（`evictProjectConfigMemo`，项目配置 watch 通道），覆盖「同 size + 同 mtime」极端写入。新增诊断导出 `projectConfigMemoStats`（条目数 / 实际读盘次数）。
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2
  - @nudojs/parser@2.0.0
  - @nudojs/env@0.4.17
  - @nudojs/harvester@0.3.3

## 1.6.1

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/env@0.4.16
  - @nudojs/harvester@0.3.2
  - @nudojs/parser@1.3.2

## 1.6.0

### Minor Changes

- f6ec0e8: fix #76 (quickfix self-defeating `any()` + false-positive call-site errors):
  
  - service/body-read-types: collect full member-read **paths** (`node.loc.start.line`), not just first-level keys. Dereferenced intermediate fields materialize as **nested shapes** (`loc: shape({ start: shape({ line: any() }) })`) instead of `any()` — an `any()` slot value keeps its member reads counted as may-throw, so the generated contract could not clear the L2 it targeted (issue: 1/7 warnings cleared; now the nested-read cases clear too). Method accesses (`.toLowerCase()`) still type the field directly and stop the chain. `BodyReadField` gains optional `fields?: BodyReadField[]`; `shapeDslFromFields` recurses.
  - core/scan: `any` actuals against a shape precondition are no longer `nudo:constraint-violated` errors — no info, don't guess, matching the scalar-pred channel ("any ≤ 任意目标") and the same function's `unknown` handling. Determined non-object and missing-field actuals still violate (controls pinned).

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/env@0.4.15
  - @nudojs/harvester@0.3.1
  - @nudojs/parser@1.3.1

## 1.5.0

### Minor Changes

- 2f9717b: repo-wide correctness batch (fix-10: 19 fixes + 3 design-defect fixes)

  Security & correctness:
  - type-expression AST whitelist blocks @nudo:case/@nudo:as RCE (P0)
  - unified export/binding-name sanitization (reserved words / collisions)
  - slot & export tables read via own-property, blocking Object.prototype members

  Type system:
  - tuple rest slot effective across leq / widen / runtime / schema / dts
  - x++/x-- propagate term/pred/Φ constraints from the same source as +=/-=
  - key-channel literals distinguish -0/0 (litKeyString)
  - projection/format exits unified under ProjectionBudget: cycle & depth truncation observable

  CLI gates & contracts:
  - health --from path errors fold into pathErrors; ok↔exit single source
  - migrate verify/health pass skips, judged same as nudo check
  - malformed JSDoc directives no longer silently dropped / line-swallowed / host-throwing
  - case-arg recursion depth cap 32 (DoS protection)

  Service layer:
  - cache-limit precedence explicit > env > project; env params take effect per call
  - session LRUs aligned with BoundedLruMap (overwrite refreshes position; max=0 read miss)
  - module-cache entries carry subtree content fingerprints; transitive invalidation cohesive (DESIGN-002)
  - sidecar contract identity = export name, binding name aliasable; reserved-word / string exports emitted safely (DESIGN-003)
  - @nudo:import alias lookup uses the original export name; miss reports a diagnostic

  Parsing & diagnostics:
  - eval diagnostics cover rest / default-value / named-expression declarations and computed-key references
  - ambient sidecar lookup includes .nudo.mjs; suffix set single source of truth

  S2/S5/S6 tracking batch (BUG-017–028):
  - type inference: collectPredVars collects assumeFinite constraints; eqLit channel tagged (eq(x, lit(undefined)) projectable); non-finite bounds (NaN/±Infinity) not projected; fn rest non-array types promoted to (T)[]; optional param names keep `?`
  - gates & CLI: check --fix preserves gate semantics (residual errors exit 1; flag combos are usage errors); variadic flags swallowing positional args → targeted usage error + `--` terminator; export on the PathError face (nudo:path-* + nudo:path-io); findProjectConfig parse-failure diagnostic + stop
  - eval engine: injection-table collection exceptions fail-closed (never a half table); same-name class collision epoch detection + fallback observation; EvalCallRecord.threw required + bridge fail-closed (omitted threw → throwsAbs unknown); tryEvalCall explicit isAbsVal guard
  - LSP / error face: validateText document version gate (stale analysis never published); diagnostic / agent error message absolute-path redaction (home→~, root→.); injection setup failure surfaces and blocks exit
  - observation face: standard-schema missing-key vs explicit-undefined distinction; dts projection optional param names, fn rest TS validity

  PR #80 review batches (merge 7e6051ae):
  - own-property reads across sidecar import/export tables and the modules table; emit-identity dedup; quote-aware sidecar binding scan; check injection-failure gate (no fake-green --json exit, no degraded cache write); class-collision epoch scoped to the entry-call phase; LSP error redaction with real workspace roots; health --from requires explicit paths

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/parser@1.3.0
  - @nudojs/harvester@0.3.0
  - @nudojs/env@0.4.14

## 1.4.0

### Minor Changes

- 64ca356: feat: clamp bounds + scalar-over-sum + action-map quickfixes (#68 #69)
  
  ## #68 inference
  
  - `Math.min` / `Math.max` / `Math.round` (and floor/ceil/trunc) propagate
    operand numeric bounds: `max(0, min(100, n))` derives `[0, 100]`.
  - NaN is explicit (option 1): a possibly-NaN operand yields `NaN | number@bounds`,
    so clamp contracts stay honest; `if (Number.isNaN(n)) return …` narrows the
    false arm (`ne(n, NaN)`) and the guarded clamp is provable.
  - Scalar return contracts now distribute over sum arms like shape/array
    (`nullable(c)` + multi-return `null | number` is provable). Gold-FP
    protection kept: any-widened bare-prim arms downgrade siblings to
    `unproven-return` warnings instead of errors.
  
  ## #69 DX
  
  - `actionsForIssue` kinds are materialized as LSP quickfixes with
    `[fix]` / `[silence]` / `[review]` / `[adjust]` / `[scaffold]` titles.
  - `nudo check --fix [--only <code>] [--write]` reuses the same edit layer
    (default dry-run prints unified diffs).
  - Body-read fields auto-fill types from usage (`node.type === "x"` →
    `string()`, arith → `number()`, no evidence → `any()`); never emit empty
    `shape({})`.
  - L2 `entry-may-throw` suggestions include a copyable sidecar clause.

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/env@0.4.13
  - @nudojs/harvester@0.2.19
  - @nudojs/parser@1.2.1

## 1.3.0

### Minor Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions

### Patch Changes

- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0
  - @nudojs/parser@1.2.0
  - @nudojs/env@0.4.12
  - @nudojs/harvester@0.2.18

## 1.2.4

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/env@0.4.11
  - @nudojs/harvester@0.2.17
  - @nudojs/parser@1.1.9

## 1.2.3

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/env@0.4.10
  - @nudojs/harvester@0.2.16
  - @nudojs/parser@1.1.8

## 1.2.2

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/env@0.4.9
  - @nudojs/harvester@0.2.15
  - @nudojs/parser@1.1.7

## 1.2.1

### Patch Changes

- Updated dependencies [5494f67]
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/env@0.4.8
  - @nudojs/core@1.2.1
  - @nudojs/harvester@0.2.14
  - @nudojs/parser@1.1.6

## 1.2.0

### Minor Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
  The AST-walk interpreter is long gone, so the dual-engine campaign name
  "B-path" no longer means anything and forced a glossary entry just to
  explain itself. The single production evaluation engine is now simply
  the **evaluator** (mechanism: transpile → `new Function` on Abs).
  
  Renamed B-path engine to evaluator/eval — see the @nudojs/core table above.

### Patch Changes

- 5ff4202: fix(core): more JS semantics soundness — Array.of / .at() / postfix ++-- / ToPrimitive
  
  - `Array.of` packs arguments into a tuple, not an array of the first element
  - `.at()` honors ToIntegerOrInfinity (string.at + array.at index)
  - postfix `++`/`--` writes back inside the expression
  - `+` honors ToPrimitive/ToString for arrays, objects, undefined
  - drop dead duplicate `case "promise"` in checkNode
- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/env@0.4.7
  - @nudojs/harvester@0.2.13
  - @nudojs/parser@1.1.5

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/env@0.4.6
  - @nudojs/harvester@0.2.12
  - @nudojs/parser@1.1.4

## 1.1.3

### Patch Changes

- 43fb345: fix(service): honor `package.json#nudo.check.profile` in `checkConfig` (LSP parity)
  
  The CLI resolves `nudo.check.profile` (`adoption` → L2 `warning`, `strict` →
  `error`) but the service `checkConfig` — which the LSP uses for
  `nudo-check` diagnostics — only read `nudo.check.entryThrows`. In a project
  with `"nudo": { "check": { "profile": "adoption" } }`, `nudo check` printed
  `nudo:entry-may-throw` as a **warning** while the IDE showed it as an
  **error**.
  
  `checkConfig` now applies the same preset, with the same precedence as the CLI
  (`entryThrows` → `profile` → default `error`), and `NudoConfig["check"]`
  gains the `profile` field.
- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/env@0.4.5
  - @nudojs/harvester@0.2.11

## 1.1.2

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/env@0.4.4
  - @nudojs/harvester@0.2.10
  - @nudojs/parser@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/env@0.4.3
  - @nudojs/harvester@0.2.9
  - @nudojs/parser@1.1.1

## 5.0.0-beta.1

### Major Changes

- 4305674: Split the `@nudojs/service` god package: harvest → `@nudojs/harvester`, IDE surface → `@nudojs/lsp`, emit products consolidated under `@nudojs/service/emit`.
  
  **BREAKING** for `@nudojs/service` subpath consumers:
  
  | Removed subpath | Migrate to |
  |---|---|
  | `@nudojs/service/interface` | `@nudojs/service/emit` |
  | `@nudojs/service/dts` | `@nudojs/service/emit` |
  | `@nudojs/service/case` | `@nudojs/service/emit` |
  | `@nudojs/service/lsp` | `@nudojs/lsp` (library entry — no server side effects) |
  | `@nudojs/service/harvest` | `@nudojs/harvester` |
  
  `@nudojs/service` keeps `.`, `./analysis`, `./evaluator`, `./emit`. The language server moves to `@nudojs/lsp/server` (bin `nudo-lsp` unchanged); `@nudojs/lsp` is now a side-effect-free library entry re-exporting the IDE surface.
  
  No dependency cycles: `lsp → service`, `harvester` stays independent of `service`. Emit is a service subpath (same package). Public function signatures and diagnostic codes are unchanged.

### Patch Changes

- Updated dependencies [4305674]
  - @nudojs/harvester@1.0.0-beta.1

## 5.0.0-beta.0

### Major Changes

- 22baf33: feat!: product CLI face only — remove deprecated verbs/aliases; L2 entry may-throw
  
  - **BREAKING — deleted with no compatibility layer:** verbs `infer` / `types` / `interface` / `refine` / `generate` / `emit` / `guard` / `doctor` / top-level `watch` / `harvest`; flags `--callsites`, `--output`, `--format zod`, `--dts`, `--emit-cases`; API `absToZodSchema`; `InferJson`/`serializeInferJson` → `CaseJson`/`serializeCaseJson`; LSP agent tools `nudo.infer` / `nudo.interface*` and aliases → `nudo.test` / `nudo.contract*`; config key `package.json#nudo.interface.*` → `package.json#nudo.contract.*`. Root scripts `infer`/`types`/`interface` removed.
  - Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`. Observation is check signatures + test case reports + IDE hover. Thin shell `@nudojs/nudojs` follows `@nudojs/cli` majors.
  - L2: undigested may-throw on entry/export functions is `nudo:entry-may-throw` (default **error**). Configure with `--ignore-throws` / `--entry-throws` or `package.json#nudo.check.{ignoreThrows,entryThrows}`.
  - Nested try: soft may-throw from an inner try re-homes to the enclosing try frame. Catch rethrow does not digest soft effects.
  - `check` always prints signatures on success; unconstrained entry params display as **`any`** (true `unknown` = inference failure + `nudo:unknown-inference`).
  - `test` prints every case including synthetic `call@`/`entry@`; only declared `@nudo:case` expectations affect exit. `--freeze[=update]` solidifies witnesses.
  - Flags: `--from`, `export --format dts|guard|schema|standard|all` (`--dialect zod` for schema), `export --out`. `--json` cannot combine with `--abs`.
  - Design docs consolidated: truth sources `design-kernel-merge.md` + `design-cli-semantics.md`; domain designs compressed to status summaries.
  - Breaking for CI scripts that still call old verbs or read old config keys.
- 0e1432a: feat!: source contract directive is `@nudo:contract` only
  
  `@nudo:refine` and `@nudo:interface` are deleted with no alias layer. The product word is **contract** end to end (sidecar `*.nudo.js`, `@nudo:contract`, `nudo contract`, `package.json#nudo.contract.*`).
  
  - **BREAKING:** replace every `@nudo:refine` / `@nudo:interface` with `@nudo:contract` (including `@nudo:contract return <constraint>`). Grammar is unchanged: `@nudo:contract <param> <constraint>`.
  - Constraints still enter Abs as Preds and participate in algebra (`x>0` ⇒ `x+1>1`) — this is not a call-site validation gate.
  - Diagnostic codes `nudo:interface-*` are unchanged in this release.
  - Chinese product copy uses 契约, not 精化.

### Minor Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).
- 279d73a: fix review gaps on the B-path migration (PR #34 follow-up):
  
  - **inject pipeline**: `CheckOptions.inject` is now threaded into generalize, L2 throws, the record channel, and drift recompute (previously CLI computed mocks/env/replacements but only `modules` reached core; `@nudo:mock`/`env`/`replace` sources were fail-closed `unknown#opaque` under `checkSource`). Memo keys use inject **content** fingerprint (stable across CLI's per-call object allocation). `mode: "analyze"` always wins; `modules` prefers `opts.modules` then `inject.modules`.
  - **L2 class / CJS methods**: explicit `throw` on class static methods and CJS object methods is no longer hard-coded as `throws: never` — NudoThrow/ReferenceError map to throws Abs (same as `callTranspiledExportFull`). `$call` records throw exits before returning `never`. L2 evaluation now seeds `phi` from `checkSource`.
  - **`freeIdentifiers`**: lexical scopes (nested params no longer pollute outer free set); non-computed `ObjectMethod`/`ClassMethod` keys are not free refs.
  - **`callBudgetKey`**: single defensive implementation for non-Abs args (B-run JS function args). `$call` compiled-body path now uses `enterCall`/`exitCall` (same budget as apply). Budget keys use fn object identity (`stableCallId`) instead of `anon#N` (false cycles across same-arity functions). `MAX_TOTAL_CALLS` unified at 20k.
  - **method early-return (correctness)**: `ObjectMethod` / `ClassMethod` / property `FunctionExpression` bodies now go through `transpileFnBodyStmts` (early-return lift) + implicit return — previously `if (c) return X; return Y` silently always returned `Y` (false precision vs native).
  - **collectors**: `setBCallCollector` / `setBAssignCollector` / `setMemberDiagCollector` / `setAbsTruncationCollector` return the previous collector; nested call sites save/restore instead of nulling.
  
  User-visible notes:
  
  - Sources with `@nudo:mock` / `@nudo:env` / `@nudo:replace` get real B evaluation under `nudo check` (CLI already built the inject pack).
  - Class static / CJS object methods with explicit throws now report `entry-may-throw` (L2 no longer misses them).
  - Object/class methods with early-return branches now fold the same values as native JS (differential batch19).
  - `interface-derivation` class-method roots stay fail-closed (no call-chain derivation) — intentional after ast-eval removal.
- 5a5e167: **feat(export)+review P0–P2**: dialect-aware schema export, Standard Schema path, CLI/LSP honesty fixes.
  
  Service / schema:
  - `absToSchemaSource` / `projectAbsToSchema` / `absToSchemaNode` — SchemaNode carries refinements and `dropped` notes.
  - Projection prefers core `absToConstraint` (parity for `eq(self,lit)` → `z.literal`, or-literal unions, int/bounds/string length).
  - Schema projection API: `absToSchemaSource` / `projectAbsToSchema` (zod via `{ dialect: "zod" }`).
  - New `absToStandardSchemaModule` / `validateSchemaNode` — Standard Schema v1 modules (`~standard`, vendor `nudo`).
  
  CLI:
  - `nudo export --format schema [--dialect zod]` → `*.nudo.schema.<dialect>.ts`
  - `nudo export --format standard` → `<fn>.nudo.standard.ts` (contract-first domains; joinAbs when no contract)
  - `test --json` stdout is **one** JSON document (cases only); `check --json` stays a separate command
  - `--ignore-throws` now **merges** with `package.json#nudo.check.ignoreThrows` (additive)
  
  LSP:
  - Gate codes (`nudo:entry-may-throw` etc.) keep Error **and Warning** under `analysis.diagnostics=off|errors` so IDE matches CLI when `entryThrows=warning`
  
  Docs/product copy:
  - Day1 sidecar example uses `fn({ params }, returns?)` (not bare `number().gt(0)` on a function export)
  - Help / generated markers use `schema`/`standard` and `nudo contract --emit`

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0
  - @nudojs/parser@1.1.0-beta.0
  - @nudojs/env@0.4.2-beta.0
  - @nudojs/harvester@0.2.8-beta.0

## 4.0.0

### Major Changes

- 69ebbf6: Align product surface with interface-first design: `@nudo:case` is debug / `nudo test` only, and the `T.*` directive grammar is removed.

  - Directive type expressions accept constraint builders (`number()`, `lit()`, `shape()`, `union()`, `array()`, `any()`, …) and concrete literals only. Bare `T.*` parses as unknown; `parseTypeValueExpr` is no longer exported — use `parseCaseArgExpr`.
  - `serializeCaseArg` / `--emit-cases` emit builders (`number()`, `union(…)`) instead of `T.*`.
  - LSP `typeExprToDirective` emits builders (`number()`, `union(…)`, `any()`).
  - CLI `infer` reports call-site facts (`call@L…`) and `debug "name"` witnesses with `Observed:` joins — not `Case "…"` / `Combined:` as the type product. Contracts stay on `*.nudo.js` / `@nudo:refine`.
  - Constraint builders accept concrete nested literals so directive grammar round-trips.

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/parser@1.0.0
  - @nudojs/core@2.1.0
  - @nudojs/env@0.4.1
  - @nudojs/harvester@0.2.7

## 3.0.0

### Major Changes

- 9731238: **BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This is the documented B8 priority — harvest only fills missing slots — but analysis results on projects that relied on harvest overwriting a handwritten env export will change.

  Migration: remove or update the conflicting handwritten `@nudojs/env` slot if you needed harvest's version; otherwise no code change. Conflicts emit a `nudo:env-harvest-conflict` warning listing overwritten module/export names.

  Also in this service major (additive public surface, riding the required major for the priority change):

  - Public harvest helpers: `mergeHarvestUnderEnv` (optional per-call `onConflict`), `setEnvHarvestConflictCollector` (returns previous; save/restore for nested analysis), `getEnvHarvestConflictCollector`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached. `clearNodeHarvestCache()` also drops `not-found` misses so a later `@types/node` install is visible in-process. `nudo:env-harvest-conflict` warnings point at the conflicting import specifier when found (file-level `line 0` otherwise).
  - `@nudojs/env` (minor): `events` / `stream` / `querystring`; high-frequency `util` slots; **Promise APIs only under `fs.promises` / `node:fs/promises`** (callback-style `fs.readFile` etc. no longer pretend to return Promise). Optional Node params (`path.basename` ext, `url.URL` base) keep typed labels (`ext?: string`) but are **not** required slots — `requiredFnArity` skips `?` / `...`.
  - `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`) as `...name: T` / `name?: T`. `leqAbs` fn arity uses **required** slots only (`requiredFnArity` skips `...rest` / `name?`): src is assignable to tgt iff `src.required ≤ tgt.required` (TS-like — rest src ⊑ required tgt; required src ⊭ rest tgt when src requires args). Pairwise `paramTypes` contravariance is unchanged.
  - `@nudojs/lsp` (patch): freeze inventory in `public-api.ts` (also exported as `@nudojs/lsp/public-api`); agent slash requests register from `NUDO_AGENT_TOOL_NAMES`; `selectCase` / `getActiveCases` are editor executeCommand + slash-only (not dot-form custom requests).

  Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts (empty `{  }` shapes are not leaf-clean) over raw resolved ratios.

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1
  - @nudojs/env@0.4.0
  - @nudojs/harvester@0.2.6
  - @nudojs/parser@0.5.1

## 2.0.0

### Major Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0
  - @nudojs/parser@0.5.0
  - @nudojs/env@0.3.0
  - @nudojs/harvester@0.2.5

## 1.0.1

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1
  - @nudojs/env@0.2.5
  - @nudojs/harvester@0.2.4
  - @nudojs/parser@0.4.2

## 1.0.0

### Major Changes

- 0fd253f: **BREAKING**: `@nudojs/cli/evaluator` 子路径已移除。求值器 API 迁至 `@nudojs/service/evaluator`（消除 cli↔service 工作区环）。迁移：`import { … } from "@nudojs/cli/evaluator"` → `import { … } from "@nudojs/service/evaluator"`。

  架构与正确性批次：

  **正确性修复（core）**

  - `slots[key]` 原型链泄漏：`__proto__`/`toString`/`valueOf` 等键命中 Object.prototype 导致引擎崩溃或误报——新增 `getSlot` 守卫并接入 projectBrand / 静态与计算成员访问 / leq / check 五处读取点（eventemitter3 真实包上曾崩溃）
  - `Array.from` 语义修正：与 `Array.of` 混用导致 `Array.from(new Set(arr))` 误报 `Set[]`；现按元素分布（tuple→ 元素 join、string→string[]），未建模可迭代物诚实返回 unknown
  - 模板 `endsWith` 不健全判定修正：误报 false 的分支改为共享的健全 `decideEndsWith`
  - `nudo:assign-mismatch` 精度：分支/循环体内的可变绑定重赋值（特性检测模式）不再误报；无条件标量改型仍报（金标行为保持）
  - `nudo:arg-structure` 精度：`x && x.__esModule && x.default` 守卫后的成员访问不再计为必填 slot

  **结构拆分（无行为变化）**

  - check.ts 2024→748 行：源码级调用图侦察拆至 algebra/scan.ts；AstEnv 类型下沉 ast-env.ts（消 5 处巨石 type-import 环）
  - evaluator.ts 5164→4058 行：内置方法语义迁至 builtins/builtin-methods.ts；analyzer.ts LSP 表面拆至 service/lsp-surface.ts
  - 模板字符串语义归一：refinements/template.ts 七处重复实现改为委托 algebra/template.ts（单一真理源）
  - 容器策略单源：ast-eval 与 B 路径 runtime 共享 containers.ts（>8 元素字面量降级策略一致，B 路径 $concat 修正嵌套近似）
  - 求值器域从 @nudojs/cli 迁至 @nudojs/service/evaluator（消除 cli↔service 工作区环；`@nudojs/cli/evaluator` 子路径移除，改用 `@nudojs/service/evaluator`）
  - 真实包门禁加固：扫描失败/0 文件即红，不再静默 skip；fixture 包显式声明为 core devDependencies

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudo`（`bin` 委托 `@nudojs/cli`）

### Patch Changes

- a2aac9e: Final review pass on feat/interface Phase 1:

  - **LSP emit bound live**: `handleInterfaceEmit` now passes `agentToolDeps` so `workspaceRoots` reach `assertEmitTargetAllowed` (was dead in production).
  - **Emit fail-closed**: empty `workspaceRoots` rejects; no ancestor-`package.json` authorization fallback; `realpath` blocks symlink escape; refuse writes under `node_modules`.
  - **autoBind kill-switch complete**: threaded through scan `generalizeFromAst` / same-file `eiOpts`; empty `fromFile` no longer ambient-binds `.nudo.js`.
  - **Conflict skip**: conflicted params no longer also emit call-site `constraint-violated`; detect eq/eq and eq/bound unsat.
  - **Return contracts**: string length bounds (`string().min/max`) enforced via domain membership.
  - **Perf/stability**: file-local `effectiveInterface` memo in check; `take*Since` on memo hit/miss (no LSP diag theft); `shift` rejects non-finite offsets; `@generated` marker requires adjacent comment block; add-mode empty targets no longer rewrite trailing whitespace; emit tmp name randomized.

- de47d84: Review fixes on feat/interface Phase 1:

  - **autoBind kill-switch**: analyzer's cross-file `nudo:interface-domain-exceeds` path now reads `package.json#nudo.interface.autoBind` (was silently ambient-loading sidecars when `autoBind: false`).
  - **`nudo check --callsites`**: inject usage-site call records so CI gate can surface `nudo:interface-domain-exceeds` (previously only reachable via analyze/interface paths).
  - **Sidecar auto-bind coverage**: `localNamedExports` accepts local `export { x }` / `export { local as exported }` list form (was declaration-only; silent miss for common style).
  - **Directory targets**: `isNudoTargetPath` excludes `*.nudo.js` / `*.nudo.ts` so check/infer/doctor no longer treat contract modules as source.
  - **VS Code client**: documentSelector includes TypeScript; file watcher covers `**/*.{js,mjs,ts}` (includes `.nudo.ts` sidecars).
  - **LSP emit**: failed `interfaceEmit` no longer claims "sidecar written" and skips the invalidation path.
  - **UX**: first `--emit` with empty default targets prints a `--fn`/`--all` tip; `--fn`/`--all` without `--emit` warn; CodeLens titles use "interface" not "refine"; domain-exceeds message is English (matches other diagnostics).

- 78f6752: Fix hover, case switching, and NaN folding in Zed-style clients.

  - `const n = double(21)` reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - Relational compare folds mixed concrete lits (`"a" > 3` → false), so `if (x > 3)` does not join both branches for NaN inputs.
  - `joinValues` uses `Object.is` so `join(NaN, NaN)` stays `NaN` (`NaN === NaN` is false).
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`).
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes.
  - Param inlay no longer invents `where x > 3` from `if (x > 3) return x` — only explicit `@nudo:refine` contracts show as preconditions.
  - Return inlay is a path summary with source param names: `x + 1`, `x | x * 2` (not the refined `number where x>3 | string | …` dump).
  - Number range narrowing uses exclusive bounds (`> 3`, not integer-style `>= 4`).
  - Concrete `if` tests no longer narrow the tested value into a range (`44 > 3` keeps `x` as `44`).
  - True branch of `x > k` on unknown refines to `number>… | string` (JS ToNumber space).
  - `flattenSum` keys prim members by term/pred so `number=A1>3` and `number=A1*2` stay distinct paths.

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0
  - @nudojs/env@0.2.4
  - @nudojs/harvester@0.2.3
  - @nudojs/parser@0.4.1

## 0.3.2

### Patch Changes

- 1d233a7: Fix hover and CodeLens case switching in Zed-style clients, and fold JS ToNumber for `- * / %`.

  - `const n = double(21)` now reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`), not only the agent object form.
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes, so selecting a case actually changes the shown types.

- Updated dependencies [1d6bb01]
- Updated dependencies [1d6bb01]
- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/cli@0.4.0
  - @nudojs/core@0.4.0
  - @nudojs/parser@0.4.0
  - @nudojs/harvester@0.2.2

## 0.3.1

### Patch Changes

- df1726c: Make `@nudo:env` actually affect inference: declaration-only fnSigs (readFileSync) now become relationFns instead of unknown-on-call, B-path `$invoke` implements string methods and filters union members, and `collectAbsCallRecords` merges env modules so call@ cases no longer overwrite correct B-path results.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/cli@0.3.1
  - @nudojs/parser@0.3.1
  - @nudojs/harvester@0.2.1

## 0.3.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

- 5786fa5: Speed up repeated analysis with layered memos and tighter cache contracts.

  - Shared parse/AST LRU, `generalizeFromAst` L0–L3 (instantiate, α-equivalence, dep fingerprint + LRU), Abs module cache, and session-wide memos with an incremental after-edit path.
  - Host cache-eviction contract, AST/function-fingerprint memory caps, conservative call-scan depth cap, and fail-open truncated dependency fingerprints.
  - Fix session-memo staleness and identity holes so after-edit results stay correct.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/cli@0.3.0
  - @nudojs/harvester@0.2.0
  - @nudojs/parser@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [0fd0718]
  - @nudojs/cli@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/cli@0.2.0
  - @nudojs/core@0.2.0
  - @nudojs/parser@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - nudo@0.1.0
  - @nudojs/core@0.1.0
  - @nudojs/parser@0.1.0
