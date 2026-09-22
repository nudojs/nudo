# 移除 ast-eval：B-path 单引擎化计划

> **状态**：草案（2026-09-22 讨论沉淀）。**未批准执行**——验证发现的范围事实见 §1，
> 推荐路径是「收缩」而非「删除」（§5 风险点名）。
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

### P4：收缩 ✅ 定案（2026-09-22，替代「删除」）

**收缩契约（生产分工，四件迁移后）**：

| 引擎 | 生产职责（收缩后） |
|---|---|
| B-path | 模块图（P1）、checkSource L2 throws + 记录通道（P2/P3.5-2）、derivation 求值（P3.5-3）、自包含 body 编译执行（P3.5-4）、B-hosted 诊断/nodeTypeMap、CJS 调用点发现、差分 oracle 对照物 |
| ast-eval（收缩后） | ① generalize symbolic/instantiate（phi 线程 + α-rename memo——推导域核心）② 回调 body 解释（applyCallbackAbs，含闭包/递归）③ LSP 非 B-hosted hover 兜底 ④ 模块图 B 失败回落 ⑤ CLI assume ⑥ 差分 oracle 对照物 |

**收缩边界判据**（求值域可换 / 推导域保留——已全部验证落地）：
- 求值域（实参直传、无 phi 收窄、无闭包）：全部切 B ✓（模块图/L2/记录/
  derivation/自包含 body）
- 推导域（symbolic scheme + phi 收窄 + HOF 提升 + α-rename memo + 闭包
  回调解释）：保留 ast-eval——phi 线程收窄与回调闭包是解释语义。

**目标达成判定**：单引擎主路径兑现——生产热点（模块加载、诊断、L2、
记录、derivation、自包含 body 执行）全 B 化；ast-eval 剩余面 = 推导域
（泛化/phi/闭包回调）+ 兜底。差分 oracle 永久保留（P0）。

## 3. 阶段门禁（每阶段共通）

- core 全量 + service/cli/parser 全量绿
- 差分 suite 零 mismatch
- gold gates：recall=precision=1.0；real-package 零 FP（L2 split 期望）
- lint 绿；无新增 conservative 降级掩盖假精确

## 4. 决策点（每阶段完成时评估）

- P1 环语义重实现是否等价（这是模块图协议最脆弱处）
- P2 性能回归：checkSource 从解释换成编译+执行，冷启动/缓存面需重测
- P3 打点注入的代码膨胀与可维护性 vs 保留 ast-eval 子集

## 5. 风险点名（执行前必须知情）

1. **check 门禁是产品红线**：checkSource 是 CI gate，当前**主实现**在
   ast-eval。P2 是整个计划风险最高的阶段——任何签名/violation/drift 的
   行为漂移都会直接漏报或误报给用户。gold 全绿只是必要非充分条件。
2. **oracle 消失的顺序问题**：P4 删除之前，P0 的差分 suite 必须已被证明
   能独立发现 B-path bug（以历史 18 批 bug 语料回归为准）；否则删除 =
   单实现自证。
3. **derivation 打点无 B 等价物**：若 P3 选择注入方案，transpile 输出将
   为每个节点插入收集调用——膨胀与正确性风险未知；选择 (b) 则「移除」
   降级为「收缩」，P4 删除不可行。
4. **测试面 churn**：~60 文件的 parity describe 是当前差分方法论在仓内的
   具体形态；批量改写本身会引入新测试 bug。
5. **性能**：checkSource 现路径大量 memo（generalize PolyFn L0/L1、checkReport
   memo）依赖 ast-eval 的确定性；换引擎需保 memo 键语义，否则缓存失效
   性回归。

## 6. 推荐

按 P0→P1→P2→P3 执行（每阶段独立合入、独立验证），P4 选**收缩**：
生产主路径 B 化（用户提议的价值全部兑现——快、单引擎），ast-eval 保留为
reference + derivation 打点 + 兜底，作为永久差分基准。若坚持删除，
以 P0 语料收编 + P3 注入方案验证通过为前置条件。
