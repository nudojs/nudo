# Using Nudo with AI coding agents

Welcome back to JavaScript. This file is the bootstrap entrypoint for the Nudo docs site. The **canonical agent-facing rules and command reference live at <https://nudojs.github.io/nudo/docs/reference/agents>** — read that page for the full rule set; this file is the one-line entry.

## One-line setup prompt

```text
Read https://nudojs.github.io/nudo/agents.md and set up Nudo in this project.
Primary gate: npx nudojs check <path>. Contracts are *.nudo.js / @nudo:refine.
Do not invent body-AST obligations. @nudo:case is debug-only.
```

## Paste-into-agent block

```text
Read https://nudojs.github.io/nudo/docs/reference/agents
Primary gate: npx nudojs check <path>
Contracts are *.nudo.js / @nudo:refine (alias @nudo:interface)
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.
```

## Non-negotiable rules (full set on the canonical page)

1. **CLI verbs only:** `check` | `test` | `contract` | `export` | `health`. There is no `infer` verb.
2. **Contracts are the product surface:** sidecar `*.nudo.js` auto-binding + in-source `@nudo:refine` (alias `@nudo:interface`).
3. **`@nudo:case` is debug only** — never present it as the interface product.
4. **`any` vs `unknown`:** unconstrained entry params print as **`any`**; **`unknown` means inference failed**.
5. **`check` validates; `export` projects** one-way lossy dts/zod/guards.
6. **L1** = explicit contracts; **L2** = entry may-throw (`nudo:entry-may-throw`). `--ignore-throws` filters L2 only.
7. **No body-AST slot invention**; HOF promote ≠ check error (warning suggestion).

## Canonical pages

| Need | URL |
|------|-----|
| Agent rules + commands | https://nudojs.github.io/nudo/docs/reference/agents |
| Intro / product face | https://nudojs.github.io/nudo/docs/intro |
| Quick start | https://nudojs.github.io/nudo/docs/getting-started/quick-start |
| CLI reference | https://nudojs.github.io/nudo/docs/api/cli-reference |
| Diagnostics glossary | https://nudojs.github.io/nudo/docs/reference/diagnostics |
| Agent integration (LSP/MCP) | https://nudojs.github.io/nudo/docs/guides/agent-integration |
| LSP agent API | https://nudojs.github.io/nudo/docs/api/agent |
| Limits / non-goals | https://nudojs.github.io/nudo/docs/concepts/limits |
| llms.txt | https://nudojs.github.io/nudo/llms.txt |
