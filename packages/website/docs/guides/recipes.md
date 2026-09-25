---
slug: /guides/recipes
description: Task recipes — CI gate, gradual contracts, monorepo, export, agents.
---

# Recipes

Task-shaped how-tos. Pattern: **Goal → Steps → Verify → Pitfalls**.

## 1. Gate CI on `nudo check`

**Goal:** Fail the pipeline when contracts or entry throws break.

```yaml
# .github/workflows/nudo.yml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g nudojs
      - run: npx nudojs check src/
```

**Verify:** `npx nudojs check src/` exits `0` on a clean tree; `1` on L1/L2 errors.

**Pitfalls:** `--ignore-throws` only filters L2. Prefer fixing contracts over muting L1. Full flags: [check](./check.md) · [CLI reference](../api/cli-reference.md).

## 2. Gradual contracts on an existing package

**Goal:** Day 0 observation → draft → handwritten sidecar → CI.

```bash
npx nudojs check src/                 # signatures + L2
npx nudojs contract --draft src/lib.js
npx nudojs contract --draft --write src/lib.js --fn importantFn
# review lib.nudo.draft.js → copy into lib.nudo.js
npx nudojs check src/lib.js
```

**Pitfalls:** drafts are not ambient-loaded; handwritten wins over `@generated`. Guide: [contract](./contract.md) · [migrating-js](./migrating-js.md).

## 3. Monorepo: scope analysis next to tsserver

```json
{
  "nudo": {
    "analysis": {
      "mode": "exports",
      "include": ["packages/js-lib/src/**"],
      "exclude": ["**/*.test.ts", "packages/ts-lib/**"]
    }
  }
}
```

JS packages → Nudo LSP + `nudo check`. TS packages → `tsc`. Details: [coexistence](./coexistence.md).

## 4. Export types for TS consumers

```bash
npx nudojs export src/api.js --format dts --out dist/types
npx nudojs export src/api.js --format schema --dialect zod --out dist/schema
```

Projections are **lossy**; Abs + `nudo check` remain the truth. Guide: [runtime generation](./runtime-generation.md).

## 5. Mock boundaries + env

```javascript
/// @nudo:env node
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

Package-shaped APIs from `@types` are auto-filled at analysis time. Env is not a mock substitute. See [Dependency types](./env-harvest.md) · [Limits](../concepts/limits.md).

## 6. Teaching an AI agent this repo

Paste block for coding agents:

```text
Read https://nudojs.github.io/nudo/docs/reference/agents
Then: npx nudojs check src/
Contracts are *.nudo.js / @nudo:contract. Do not invent body-AST obligations.
@nudo:case is debug-only.
```

More: [Agents](../reference/agents.md) · [Agent integration](./agent-integration.md) · [API · agent](../api/agent.md).

## 7. IDE inlay + CodeLens

Install **nudo-vscode** (or Zed extension). Default analysis mode `"exports"`. See [VS Code](./vscode.md) · [LSP clients](./lsp-clients.md).

## 8. Read check output quickly

```text
signatures
  getName(user: any) => any  throws TypeError
issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
```

`any` = unconstrained entry. `throws` = L2 domain. `L1` in the header is the **line number** (`getName` is declared on line 1 here) — the layer is L2. Codes: [Diagnostics](../reference/diagnostics.md).

---

## Next

- [Quick Start](../getting-started/quick-start.md)
- [nudo check](./check.md)
- [nudo contract](./contract.md)
- [Glossary](../reference/glossary.md)
