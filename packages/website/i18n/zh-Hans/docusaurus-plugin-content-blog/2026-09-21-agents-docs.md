---
date: 2026-09-21
slug: agents-docs
title: 面向 coding agent 的 Nudo —— agents.md、agent 集成与稳定诊断码
authors: [default]
tags: [ai, mcp, nudo, agents, launch-series]
---

> **发布系列**（4/5）—— 2026-09-21 同日成套发布。建议按序阅读：
> [Day 0 —— 不改写就观察 JavaScript](/blog/day0-observe) · [契约就是 JS —— Day 1 与侧车 *.nudo.js](/blog/day1-contracts) · [Nudo vs TypeScript —— 何时该选 JS-first 门禁](/blog/vs-typescript) · **面向 coding agent 的 Nudo —— agents.md、agent 集成与稳定诊断码** · [22 个文件被涂抹——调用点归因如何险些把假精度当成真发布](/blog/attribution-gate)

Nudo 的观察输出本来就是结构化的。Agent 还需要一份稳定的产品契约。

读 **[Agents](/docs/reference/agents)**（人类文档）与机器入口 **[agents.md](https://nudojs.github.io/nudo/agents.md)**。策展索引：**[llms.txt](https://nudojs.github.io/nudo/llms.txt)**。

## 一屏 Agent 规则

```text
Primary gate: npx nudojs check <path>
Contracts: *.nudo.js / @nudo:contract
@nudo:case is debug-only — not the contract product
Entry params print as any; unknown = inference failed
check validates; export projects (lossy)
```

<!-- truncate -->

## 工具面

- LSP：`@nudojs/lsp`
- Agent executeCommand / 工具：[API · agent](/docs/api/agent)
- Agent 集成：[Agent 集成指南](/docs/guides/agent-integration)
- JSON 面：`npx nudojs check file.js --json`
- 诊断码：[词典](/docs/reference/diagnostics)

## 为什么重要

2026 年的工具文档，看的是 coding agent 能否**不靠猜产品名词**就完成配置与门禁。Nudo 发布 `agents.md` + `llms.txt`，让「欢迎回到 JavaScript」对机器同样可执行。
