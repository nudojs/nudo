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

### P0：差分 oracle 收编（前提，不可跳过）
把差分 harness（transpile 执行 vs `vm.runInNewContext` strict native 对照）
+ 历史语料（batch1–17）收进仓内 vitest suite，作为「双引擎互证」的替代品。
- 产出：`packages/core/src/algebra/__tests__/differential/` 语料 + runner。
- 门禁：语料全零 mismatch；harness 的 concrete() 盲区（open obj/undefined 元素）
  用读层断言补齐。

### P1：模块图 B 化
`evalAbsModuleGraph` 换 per-file transpile+exec 收集导出。
- 必须重实现协议：ESM 环 partial 命名空间、CJS 导出失败 open+path 保守、
  mock-module 替换、harvest（@types→env）合并、seedVars/seedFns 注入。
- 门禁：abs-modules-graph 全测试绿 + module-cycle/depth/missing 诊断不变 +
  real-package 零 FP。

### P2：checkSource 与 instantiate 换引擎
- check.ts 三入口（signatures/violations/drift/L2 throws）→ runTranspiled
  等价面；gold 断言不得改（recall=precision=1.0、assign-mismatch/constraint 金标）。
- generalize.ts instantiate → tryBPathCall 等价面（α-替换语义对齐）。
- 门禁：check-gold/check-recall-gold/check-real-packages 全绿；
  check-interface-drift 两端口径（执行态调用记录）对齐。

### P3：derivation 与 LSP
- derivation 节点打点：B-path 无等价物——两条路：(a) transpile 节点级
  instrument 注入；(b) ast-eval 收缩为 derivation session 专用。
- 非 B-hosted 文件的 collectAbsNodeTypes → 注入收集。
- 门禁：interface-derivation/hover-intension 全绿。

### P4：删除或收缩（二选一，见 §5）
- **删除**：删 ast-eval.ts + 迁移 ~60 测试文件（parity describe 改写为
  B-path vs native 差分断言）。
- **收缩（推荐）**：ast-eval 保留为 reference 实现（测试 oracle +
  derivation 打点 + 兜底），生产路径全部切 B。

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
