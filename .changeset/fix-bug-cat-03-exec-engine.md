---
"@nudojs/core": patch
"@nudojs/service": patch
---

Fix bug-report category 03 (evaluation engine) — verified subset.

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
