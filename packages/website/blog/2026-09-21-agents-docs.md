---
date: 2026-09-21
slug: agents-docs
title: Nudo for coding agents — agents.md, agent integration, stable diagnostics
authors: [default]
tags: [ai, mcp, nudo, agents, launch-series]
---

> **Launch series** (4/5) — published together on 2026-09-21. Read in order:
> [Day 0 — observe JavaScript without rewriting it](/blog/day0-observe) · [Contracts are JS — Day 1 with sidecar *.nudo.js](/blog/day1-contracts) · [Nudo vs TypeScript — when a JS-first gate is the right tool](/blog/vs-typescript) · **Nudo for coding agents — agents.md, agent integration, stable diagnostics** · [The 22-file smear: how call-site attribution almost shipped fake precision](/blog/attribution-gate)

Nudo’s observation output is already structured. Agents need a stable product contract too.

Read **[Agents](/docs/reference/agents)** (human docs) and the machine entrypoint **[agents.md](https://nudojs.github.io/nudo/agents.md)**. Curated index: **[llms.txt](https://nudojs.github.io/nudo/llms.txt)**.

## Agent rules in one screen

```text
Primary gate: npx nudojs check <path>
Contracts: *.nudo.js / @nudo:contract
@nudo:case is debug-only — not the contract product
Entry params print as any; unknown = inference failed
check validates; export projects (lossy)
```

<!-- truncate -->

## Tooling surface

- LSP: `@nudojs/lsp`
- Agent executeCommand / tools: [API · agent](/docs/api/agent)
- Agent integration: [Agent integration guide](/docs/guides/agent-integration)
- JSON face: `npx nudojs check file.js --json`
- Diagnostic IDs: [glossary](/docs/reference/diagnostics)

## Why this matters

2026 tooling docs are judged by whether a coding agent can **set up and gate** a project without guessing product nouns. Nudo publishes `agents.md` + `llms.txt` so “welcome back to JavaScript” is also machine-actionable.
