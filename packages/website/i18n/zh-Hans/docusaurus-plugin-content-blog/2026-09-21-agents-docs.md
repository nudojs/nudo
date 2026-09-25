---
title: 面向 coding agent 的 Nudo —— agents.md、agent 集成与稳定诊断码
authors: [default]
tags: [ai, mcp, nudo, agents]
---

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
