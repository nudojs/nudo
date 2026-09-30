---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.3.1 |
| `@nudojs/service` | 1.2.4 |
| `nudojs (CLI)` | 1.0.9 |
| `@nudojs/parser` | 1.1.9 |
| `@nudojs/lsp` | 1.1.9 |
| `@nudojs/env` | 0.4.11 |
| `@nudojs/harvester` | 0.2.17 |
| `vite-plugin-nudo` | 0.4.12 |
| `nudo-vscode` | 0.3.16 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.3.1 {#pkg-core}

## 1.3.1

### Patch Changes

- 8df9215: fix(contract): array return contracts distribute over sum arms
  
  `assertImplies` distributed **shape** contracts (`constraint.fields`) over the
  members of a `sum` return value, but the **array** branch was reached with the
  sum still intact and rejected it outright:
  
  ```
  return shape sum ⊭ array(...)
  ```
  
  Any function built from the idiomatic "start empty, push conditionally" shape
  therefore reported a false `nudo:constraint-violated`:
  
  ```js
  export function pick(n) {
    const out = [];
    if (n > 0) out.push(n);
    return out;          // [] | [n]  ⊭  array(number().gt(0))
  }
  ```
  
  Each arm is an array on its own (`[]` and `[n]` both satisfy the contract), so
  the sum is too. Array contracts are structural like shape contracts, so they
  now distribute over sum members the same way (`any`-derived members are still
  skipped, keeping the existing gold-FP protection). Non-array arms still report.
  
  Measured on a consumer project (npm-safe): `vetoFindings` / `decide` return
  contracts went from `nudo:constraint-violated` errors to clean, with no other
  diagnostic movement.

更早版本（19）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.2.4 {#pkg-service}

## 1.2.4

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/env@0.4.11
  - @nudojs/harvester@0.2.17
  - @nudojs/parser@1.1.9

更早版本（21）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.9 {#pkg-nudojs}

## 1.0.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/harvester@0.2.17
  - @nudojs/parser@1.1.9
  - @nudojs/service@1.2.4

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.9 {#pkg-parser}

## 1.1.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1

更早版本（19）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.9 {#pkg-lsp}

## 1.1.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/parser@1.1.9
  - @nudojs/service@1.2.4

更早版本（22）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.11 {#pkg-env}

## 0.4.11

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.17 {#pkg-harvester}

## 0.2.17

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/env@0.4.11
  - @nudojs/parser@1.1.9

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.12 {#pkg-vite-plugin}

## 0.4.12

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/service@1.2.4

更早版本（21）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## 0.3.7

- Current published line (Marketplace + Open VS X via release CI).
- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.
- Commands: `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
- Intermediate 0.3.1–0.3.6 were release-CI auto-bumps alongside the monorepo `@nudojs/*` line; see git `Version Packages` commits.

更早版本（2）→ [完整发布历史](./releases-history.md#pkg-vscode)
