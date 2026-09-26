# Agent 评测基线（AI5）

> 内部基线，**不是 CI 门禁**。运行：`pnpm run agent-eval` · `node scripts/agent-eval.mjs --json`

## 测什么

固定 **10 题改红任务**：已知红 → 按 `actions[]` / few-shot 文档路径修 → 再 `check`。

| 指标 | 目标 |
|------|------|
| **go-rate** | **100%**（文档路径必须 1 轮闭环） |
| **avgRounds** | 1（文档路径不靠猜） |
| **avgTimeToGreen** | 参考量级 ~2s（本地 tsx） |

## 题表

| # | 任务 | 文档动作 | 期望红 |
|---|------|----------|--------|
| 01 | 改调用点 `setDelay(0)→(250)` | callsite | `constraint-violated` |
| 02 | 放宽契约 `gt(0)→ge(0)` | relax | 同上 |
| 03 | 入口 shape 补齐 | relax | `entry-may-throw` |
| 04 | `--ignore-throws` 迁移开关 | ignore-throws | 同上 |
| 05 | 赋值补回 `port` | callsite | `assign-mismatch` |
| 06 | 返回精化 `return 0→1` | callsite | `constraint-violated` |
| 07 | 长度界 `tag("")→("ok")` | callsite | 同上 |
| 08 | 可计算函数体（禁假 `@returns`） | callsite | `unknown-inference` |
| 09 | shape 补字段 | callsite | `constraint-violated` |
| 10 | 双违例一起修 | draft | 同上 |

## TS 对照

题 01 同逻辑改写成 `ms: number` + `setDelay(0)` 时 **tsc 沉默（假绿）** —— Nudo 报 `constraint-violated`。

## 最近一次（2026-09-23）

```
go-rate: 100% (10/10)  avgRounds=1  avgTTG≈1.7s
01-callsite: [tsc SILENT=green on number]
```

## 评测挖出的产品洞（已回写 few-shot）

- `@nudo:mock` 对**自由全局**（如 `fetch`）在 `check` 路径会调真函数并可能 **崩进程**——few-shot 已改为「可计算函数体 / 真实证据」；mock 标注为「导入模块面」。
- `unknown-inference` 是 **warning**（exit 0）——评测红判据是「出现该码」，不是 exit 1。

## 与 dx-metrics 的分工

| 脚本 | 问 |
|------|----|
| `dx-metrics` | 2 条路径的 fix-rate / TTG |
| `agent-eval` | **10 题覆盖多诊断面** + TS 假绿对照 |
