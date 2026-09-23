---
slug: /reference/agents
description: Nudo for AI coding agents — product rules, Day0 commands, machine-readable diagnostics, MCP/LSP pointers.
---

# Agents

Nudo is designed to be **agent-actionable**: stable verbs, stable diagnostic IDs, and a published machine entrypoint.

- Machine entrypoint: [agents.md](https://nudojs.github.io/nudo/agents.md)
- Curated index: [llms.txt](https://nudojs.github.io/nudo/llms.txt)
- Source markdown: monorepo `packages/website/docs/**` via raw GitHub URLs listed in llms.txt

## Paste-into-agent block

```text
Read https://nudojs.github.io/nudo/agents.md and set up Nudo in this project.
Primary gate: npx nudojs check <path>.
Contracts are *.nudo.js / @nudo:refine (alias @nudo:interface).
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.
Leaving tsc: npx nudojs migrate status|strip|verify|retire (exit is retire).
```


## Product rules (must not violate)

| Rule | Detail |
|------|--------|
| Verbs | `check` \| `test` \| `contract` \| `export` \| `health` \| `migrate` only |
| No `infer` verb | Observation = check signatures + IDE |
| Contracts | Sidecar / `@nudo:refine`; `@nudo:interface` is alias |
| `@nudo:case` | Debug / `nudo test` / LSP only |
| any vs unknown | Entry `any`; `unknown` = inference failed |
| check vs export | check validates; export projects (lossy) |
| L1 / L2 | L1 contracts; L2 entry may-throw; ignoreThrows ≠ L1 |
| No body-AST slot invention | Obligations come from contracts or call-site facts |
| HOF promote ≠ check error | Body-usage promotion is a warning suggestion |
| migrate is one-way | `status` → `strip` → `verify` → `retire` tsc; coexistence is not the end state |

## Day 0 / Day 1 commands

```bash
npx nudojs check <path>
npx nudojs contract <path>
npx nudojs contract --draft <path> [--write]
npx nudojs export <path> --format dts --out dist/types
npx nudojs health <path>
npx nudojs migrate status <pkg>
npx nudojs migrate retire <pkg> --dry-run
```

`nudo test` is optional debug case reporting — not the primary product narrative.

## Config (package.json)

```json
{
  "nudo": {
    "analysis": { "mode": "exports" },
    "check": { "ignoreThrows": ["TypeError"], "entryThrows": "error" },
    "contract": { "autoBind": true }
  }
}
```

Default analysis mode is `"exports"` (export / sidecar / directives); named-path CLI `check` still analyzes that file. Full config surface: [CLI Reference](/docs/api/cli-reference).

## Machine-readable diagnostics

```bash
npx nudojs check file.js --json
```

Human face uses `actual ⊭ expected` on Abs. Stable codes: [Diagnostics glossary](/docs/reference/diagnostics).

## Tooling

| Surface | Docs |
|---------|------|
| LSP package | [`@nudojs/lsp`](/docs/api/lsp) |
| Agent executeCommand | [API · agent](/docs/api/agent) |
| MCP | [Agent integration guide](/docs/guides/agent-integration) |

Do not send server-injected fields (`loadModule`, effective `autoBind`) as JSON-RPC parameters.

## Non-goals for agents

- Do not treat `@nudo:case` as a contract generator
- Do not rewrite JS into TS “for types”
- Do not invent required object slots from body AST
- Do not narrate unconstrained entry params as `unknown`
- Do not present dual `tsc` + `nudo check` as a permanent end state — exit is `migrate retire`

See [Limits](/docs/concepts/limits) · [Glossary](/docs/reference/glossary) · [Recipes](/docs/guides/recipes) · [Migrate from TypeScript](/docs/guides/migrating-from-typescript).

