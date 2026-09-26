---
date: 2026-09-21
slug: day0-observe
title: Day 0 —— 不改写就观察 JavaScript
authors: [default]
tags: [nudo, type-inference, check, launch-series]
---

> **发布系列**（1/5）—— 2026-09-21 同日成套发布。建议按序阅读：
> **Day 0 —— 不改写就观察 JavaScript** · [契约就是 JS —— Day 1 与侧车 *.nudo.js](/blog/day1-contracts) · [Nudo vs TypeScript —— 何时该选 JS-first 门禁](/blog/vs-typescript) · [面向 coding agent 的 Nudo —— agents.md、agent 集成与稳定诊断码](/blog/agents-docs) · [22 个文件被涂抹——调用点归因如何险些把假精度当成真发布](/blog/attribution-gate)

欢迎回到 JavaScript。Nudo 不要求你在看到类型、门禁义务之前，先把 JS 包改写成另一种语言表面。

**Day 0 产品面：** `nudo check` 成功与失败都会打印 signatures。调用点就是证据。无约束入口参数显示为 **`any`**——不是 `unknown`。可选的 `nudo test` 报告调试用例；它不是 CI 门禁。

```bash
npx nudojs check src/
```

```text
signatures
  subtract(a: any, b: any) => number
```

即使没有侧车契约，导出函数也携带 L2 运行时边界：入口函数未消化的 may-throw 是 error（`nudo:entry-may-throw`），迁移期间可过滤。

在 [Playground](/playground) 里试，或读 [Quick Start](/docs/getting-started/quick-start)。

<!-- truncate -->

## 为什么 Day 0 重要

TypeScript 的默认叙事是「先标注」。Nudo 的默认叙事是**先观察**：在 Abs 上跑抽象解释器，打印执行计算出的东西，再决定要把哪些义务写下来。

这正合 JavaScript-first 的代码库——工具 CLI、脚本层、插件宿主——改写成 `.ts` 不是它们的产品路径。

## 下一步

Day 1 是契约：`*.nudo.js` / `@nudo:contract`，然后是 `nudo check` 的 L1 门禁（`actual ⊭ expected`）。见 [nudo contract](/docs/guides/contract)。
