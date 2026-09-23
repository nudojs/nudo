# 移除 ast-eval：B-path 单引擎化计划

> **状态**：**已完成**（2026-09-23 P9 ast-eval 删除）。路线：「Φ-native B → 删除 ast-eval」。
> top-level-this 已按 ESM TypeError 托管（见 P7 复核）。
> **真源**：求值架构与集合语义 → evaluator-paths.md；架构 → kernel-merge.md。

## 1. 范围事实（本次会话验证，逐条 grep/实测）

**B-path 语法覆盖**：全语法，`runTranspiled` 可 exec 任意程序 ✓

**ast-eval 的消费面（移除 = 逐面替换）**：

| 面 | 位置 | ast-eval 入口 | B-path 等价物现状 |
|---|---|---|---|
| check 门禁本体 | core/check.ts | analyzeFn(L673)、evalProgramAbs(L712)、analyzeFnFull(L933) | runTranspiled（core 内可用）；tryBPathCallFull（service） |
| 调用点实例化 | core/generalize.ts | PolyFn.instantiate → run → analyzeFn | 无——instantiate 需换引擎 |
| 模块图 | service/abs-modules-graph.ts | evalProgramAbs（每依赖） | **无**——Abs-only 协议 |
| 接口推导 | service/interface-derivation.ts | analyzeFn + derivationChain 打点 | 无——打点在求值内部 tag |
| LSP hover/bindings | service/lsp-surface.ts | collectAbsNodeTypes → evalProgramAbs | B-hosted 已有 nodeTypeMap 注入；非 B-hosted 无 |
| CLI assume | cli/index.ts | algebra.analyzeFn | 可换 tryBPathCall |
| 测试面 | ~60 测试文件 | analyzeFn/evalProgramAbs 直调 | 需成批迁移 |

**generalizeFromAst 本体不是执行**：AST 语法归纳（symbolic scheme 合成），
不依赖 ast-eval，保留。

## 2. 阶段

### P0：差分 oracle 收编（前提，不可跳过）✅ 已完成（2026-09-22，commit 见 git log）
- 产出：`packages/core/src/algebra/__tests__/differential/`——
  `harness.ts`（diff3 同源：B-path vs vm.runInNewContext strict native）、
  `corpus/batch1-17`（24 个语料文件，~5200 条）、`batch18-readprobes`
  （concrete() 盲区读层金丝雀）、3 个门禁测试文件（basic/edge/recent，
  每段零 mismatch + total compared 下限哨兵）。
- 验证：155 测试全绿（3.3s）；**oracle 敏感性实测**——临时删除 COMPOUND_OPS
  的 `**=` 映射，recent 门禁精确报出 3 条 `x **= 3` 假精确 MISMATCH，恢复后清零。
- 门禁：全语料零 mismatch + compared 下限（basic>150 / edge>200 / recent>300）。

### P1：模块图 B 化 ✅ 已完成（2026-09-22，P1-a ed3486d + P1-b 6ec148a）
- **P1-a（前置，ed3486d）**：transpile 导出面补齐——export default 全形态
  （函数/类/表达式/匿名合成名字）、`export { a, b as c }`、
  `export { x } from "mod"`、`export * from "mod"` 保留合法 ESM 形态，
  run.ts 后处理改写为 __nudoExport/__nudoExportStar（modules 表注入绑定），
  返回对象合并动态导出 + 静态声明名（显式导出压过 export *，与
  collectAbsExports 顺序口径一致）。此前 default 全形态 SyntaxError、
  specifier/star 静默丢失——B-path 对带默认导出/重导出的模块完全不可用。
  测试先行 10 红→绿（bpath-export-surface.test.ts）。
- **P1-b（6ec148a）**：evalDep 求值步换 runTranspiled（B 优先），JS 函数
  导出经 absFunction(apply) 桥接成 Abs fn（apply 优先派发）；失败回落旧
  Abs 路径（顶层 this 等 B 不可托管源覆盖面不变）。桥接预算键坑：
  fingerprint ?? anon#N 会让所有导出共享 anon#1，嵌套跨模块调用撞
  _activeCallKeys 递归守卫误截断——按 `bpath:模块#导出` 唯一化。
  新增测试：default 过图、barrel（export * + default 重导出）过图。
- 门禁达成：abs-modules-graph/abs-module-cache/bpath-module-diags/
  harvest-to-abs 全绿；环/深度/缺失诊断语义不变（原测试全过）；
  lint 绿；差分 suite 155 绿。

### P2：checkSource 与 instantiate 换引擎 🔶 部分完成（2026-09-22，29a1b7e + d09c777）
- **前置 bug 修复（29a1b7e）**：B-path try/catch rethrow 丢软 may-throw
  （`catch (e) { throw e; }` 正常路径 digest 吞掉假想 soft throw）——
  catchMayRethrow 静态判定 + `$tryReleaseSoftCatch` 上浮。测试先行 2 红→7 绿。
- **P2-a（d09c777）**：`collectEntryMayThrows` 换 `runTranspiled` +
  `callTranspiledExportFull`（按 source memo）。**验证发现的范围修正**：
  - HOF 提升语义仅在 ast-eval——any/unknown 实参的数组方法调用被提升建模
    且不记 may-throw（mini-repo gold 钉此口径），B-path `$invoke` 对 any
    记 TypeError 假 L2。→ any/unknown 入口 + 类方法回落 ast-eval，约束
    入口才走 B。gold 全绿。
- **P2 剩余（降级为 P3 一起决策）**：
  - L673/L740 analyzeFn（签名重跑/漂移返回位）——记录通道与 emit 同源，
    换引擎需 B 侧 assign/call 记录 instrumentation；
  - **PolyFn.instantiate 不换**——symbolic/instantiate 与 phi 线程 + HOF
    收集耦合（推导域核心），执行级替换等价于重写泛化器。按「收缩」路线
    保留 ast-eval 为推导引擎。

### P3：derivation 与 LSP ✅ 已换引擎（2026-09-22，58b395d）
**验证推翻原计划**：derivation 打点本就在共享代数层（arithmetic.add 的
noteDerivationAdd 挂 shift、joinAbs 的 noteDerivationJoin 挂 join）——
B 执行的 `$add`/`$join` 走同一代数，session 包裹下自动打点，**无需
transpile 节点注入**。deriveOneRoot 求值引擎换 runTranspiled +
callTranspiledExportFull（类方法与 B 失败回落），调用记录改
setBCallCollector 映射。LSP hover/bindings（collectAbsNodeTypes）为
B 不可托管文件兜底，保持 ast-eval（收缩面）。

### P3.5：四个迁移件 ✅ 全部完成（2026-09-22）

1. **提升前置化**（4d8c670）：promote-scan.ts 静态扫描替代求值期 8 处
   挂载点——generalize symbolic/instantiate 共用扫描决策，B 吃预提升
   实参即获同等精度；for-of 循环变量→元素 term 数据流作用域化追踪。
2. **记录通道**（ff840a4 + 292379a）：`$recordBinding`/`$assignRecord`
   运行时插桩（calls.ts 模块级 sink）+ checkSource 三通道换
   runTranspiled（BCallRecord→AbsCallRecord 映射）；顺带修
   stripEffectfulTopLevel 的 `$for(` 括号计数预存 bug。
3. **derivation**（58b395d）：见上——打点在代数层，换引擎而非注入。
4. **body 转译**（49783e4）：`$call` 对自包含 body 编译执行
   （free-identifier 扫描门：闭包/兄弟函数/递归回落解释路径保预算；
   apply 钩子优先；NudoThrow→never 契约不变）。

### P3.6：instantiate→B 换引擎实验 ❌ 已回退（2026-09-22，实验结论存档·已修正）
实验：generalize 的 run()（symbolic/instantiate 共用）phi===pTrue 面走
runTranspiled + callTranspiledExportFull（提升形状预绑定到实参）。

**修正后阻塞清单**（初版记录把两条实现缺陷误报为结构性阻塞，已复核）：

1. **phi 分支收窄缺失（结构性，唯一真阻塞）**——同源码同实参实测：
   ```
   源码:    function f(x){ if (x>0) return x; return 0; }   // @nudo:refine x positive
   转译:    return $fork($gt(x, $lit(0)), () => x, () => $lit(0));
   ①ast-eval（Φ=x>0）: number  = x  where x > 0  #path   ← term/pred 保留
   ②B-path（同实参，无 Φ 入口）: number  #path            ← 两臂 join 丢 term
   ```
   机制：`$gt(x-with-pred, $lit(0))` 实测返回 `boolean #partial`——比较不
   消费操作数 pred；收窄来自 evalNode 的 Φ∧test 推理（refineAbsForRelTrue），
   B 的 $fork 只吃三值测试 → 双臂 join。check 签名 verbose 的 term/pred
   （D2 测试）即由此丢失。
2. ~~对象字面量构造精度分叉~~ **实为实现缺陷**：隔离复现（类实例/箭头/
   纯字面量三变体）两侧结果完全一致；真实差异来自 generalize 的裸
   runTranspiled **没注入模块表**——ast-eval 把 `export { MemoryStore }`
   的导出名做成名字桩解析，B run 无注入 → `$new(undefined)` → unknown。
   修复前提 = 给 generalize 的 B run 线程 modules（analyzer 侧已有）。
3. ~~async 执行崩溃~~ **实为实现缺陷（且为文档化行为）**：f-async-eff
   示例头注释自己写明「@nudo:mock 必填——B 路径会执行真实 fetch，拿 Abs
   当 URL 直接 ERR_INVALID_URL 崩溃」；swap 的裸 runTranspiled 无 mock
   注入 → 命中该文档化失败模式。修复前提 = 线程 mock replacements。

**结论**：回退成立，但理由收窄为 ①（phi 收窄——refine 约束入口是 check
产品的核心用例，B 结构性缺失）；②③ 是可修的注入工程（若未来要做
phi-free 切片，需先给 generalize 线程 modules+mocks）。

### P4：路线改判——收缩 → **删除**（2026-09-22 用户裁决，替代原「收缩」定案）

**改判依据（实证）**：ast-eval 模型本身不健全——函数式 env（callee 写不传播）
+ Φ 事实永不失效（term 未变）+ `implies(Φ,pred)` 剪枝，三者组合在「调用变更
字段后重测」时剪掉可达路径。三案例实测（同源码同实参）：

| 案例 | 原生 | ast-eval | B-path |
|---|---|---|---|
| `clear(a){a.length=0}` 后重测 `a.length>0` | 2 | **1 ❌** | 2 ✓ |
| `c.reset()` 后重测 `c.n>0` | 2 \| 3 | **1 \| 3 ❌** | 2 \| 3 ✓ |
| `change(o){o.n=-1}` 后重测 `o.n>0` | 2 \| 3 | **1 \| 3 ❌** | 2 \| 3 ✓ |

根因是**结构性**的：跨切不变量（每个事实在每次写后失效）在双世界模型里是
程序性纪律，必然有泄漏点；B-path 的引用语义 + term 引用事实使失效自动化。
**终局目标**：把 Φ 路径条件机制做进 B（Φ-native B），随后删除 ast-eval。
差分盲区教训：oracle 只测 B-vs-native，ast-eval 从未入差分网——该 bug 因
此长期存活于 check refine/符号路径。

### P5：Φ-native B ✅ 落地（2026-09-22，7a0162e + 5eea6f4）

**关键发现**：runtime 的 Φ 脚手架早已存在但是死代码——`phi` 模块变量 +
`withExecPhi`/`currentExecPhi` + `$gt`/`$add` 等运算符已把 phi 传给 algebra
（`cmp` 的 `implies(phi,pred)` prover 直接可用）。唯一缺口：`$fork` 不把
`Φ∧test` 压进臂作用域。

- **7a0162e**：`$fork` Φ-aware——真臂 `withExecPhi(Φ∧test.pred)`、假臂
  `Φ∧¬test.pred`（`falseConstraint` 否定）、definite 早退带 Φ。效果：嵌套
  同测试折叠（`1|3`）、兄弟分支否定剪枝（`1|4`）、refine 契约剪枝且保
  term/pred。健全性：变更案例引用语义自失效保持正确。
- **5eea6f4**：`callTranspiledExportFull` 加 `opts.phi`（入口 Φ 种子）；
  generalize 去 `phi===pTrue` 门 + import 门收窄为「body 引用导入名」。
  **P3.6 阻塞 ① 解除**：refine 约束入口走 B，D2 形态符号
  `number = x where x > 0` 保 term/pred 与 ast-eval 对齐；refine 约束的
  变更案例输出 `2|3`（健全性 bug 产品级修复）。

### P6：回调闭包编译注入 ✅（2026-09-22，883380c，件 C）

`compiledBodyOf` 不再对自由标识符整体回落：逐个从 `impl.env` 解析注入——
`vars` → Abs 值；`fns` → `absFunction` 包装（调用走 `$callNamed` →
`applyAbsFn`，解释语义/递归预算保留）；任一不可解析（全局名/自递归名）→
整体回落解释路径。trace 实测：sibling-const 注入编译；不可解析名无注入。

### P7：B 回落面收缩（件 D）✅ 语义已裁决（2026-09-23 复核）

- **3491fe2**：`import.meta` / 动态 `import()` 从抛 unsupported 改为
  `$unknown()` 保守 lowering（与 ast-eval 同类表达式处理对齐；动态 import
  原生返回 Promise，静默折 `$lit(undefined) #exact` 是假精确）——含
  import.meta 的现代 ESM 依赖不再整体回落。
- **top-level-this 语义裁决 ✅（ESM TypeError，已落地）**：B 按原生 ESM
  建模——顶层 `this` 读 → `$lit(undefined)`；`this.x = 1` 经 strict 写路径
  硬抛 TypeError（模块装载失败，catch 可吸收）。`isBPathCapable` 恒 true，
  顶层 this 不再关整文件 B 路径。测试：`bpath-topthis.test.ts`。
- **残余 unsupported 清单**（transpile throw 实测）：`statement:*`/
  `expression:*` default（实测不可达：with 被 parser strict 拒绝、嵌套类/
  标签块/全解构形态含 rest/计算键/默认值/成员目标全部已 lower——**JSX 是
  唯一实际可达**）；`assign-target`×2（实测不可达，防御性）。
- **评估结论**：模块图兜底在 P9 已删（fail-closed）。JSX 仍 B-incapable →
  显式无信息（空导出），属诚实能力边界，非回落路径。

### P9：ast-eval 删除完成（2026-09-23）

**`ast-eval.ts` 已整文件删除**（commit 2d217e6）。保留面拆分：
- `ast-env.ts`：AstEnv 类型 + emptyEnv/withVar
- `ast-records.ts`：AbsCallRecord/AbsAssignRecord 类型（B 通道同形投影）
- `call-budget.ts`：调用预算/截断观测（MAX_CALL_DEPTH/MAX_TOTAL_CALLS/
  enterCall/exitCall/truncatedAbs + **MAX_B_TOTAL_FORKS=5000** fork 预算）

**fail-closed 语义**（用户批准）：B-incapable/求值失败 → 显式无信息
（unknown/空表），不再有解释兜底。涉及面：check 探针/绑定表、scan 表达式
求值（换 B 编译执行 evalExprAbs）、generalize 解释分支、模块图 evalDep、
LSP 节点表/case 重放、analyzer 记录通道（B 唯一源）、CLI assume。

**删除暴露的两个隐藏耦合**（均已修）：
1. **ast-eval 模块级 `setApplyCallbackHost` 注册**（数组回调解释宿主）随
   文件消失 → forEach 回调不执行（副作用全丢，差分 7 mismatch）——
   注册迁 `exec/call.ts`（B 宿主 = $call：Abs 编译/apply/关系面）。
2. **分支爆炸性能回归**：Φ-native 的 Φ 逐层 and 累积（lodash
   _baseFlatten 实测 50+ 项，每层 term 不同去重失效）→ implies 爆炸
   （卡死 60s+，main 31ms）。修：boundedPhi 上限 24 + 调用预算 200k→20k
   + fork 预算 5000 → 665ms；**core 全量从 830s+ 降到 12.85s**。

**测试面**：执行器本体测试整删 11 文件 + parity 段 13 文件 + 行为测试
换工具 13 文件（子代理批量）；契约更新（fail-closed 面）。

**终局验证**：core 160 文件 1823 测试 12.85s 全绿；service/cli/parser/
lsp/vite-plugin 全绿（2026-09-23 曾记 853/854 + `agent-interface-draft`
长期 baseline，**后续已绿**，复核 855/855 · 全仓 2718/2718 · 该文件 5 连跑）；
差分 155、gold 150、real-packages 10（3.17s）、examples 149、lint 全绿。

**架构终态**：单引擎（B-path）——转译 + new Function 执行 + 代数层
（Abs/term/pred/conf）；差分 oracle（B-vs-native）为独立 bug 发现器保留。
