---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.0 |
| `@nudojs/service` | 1.6.0 |
| `nudojs (CLI)` | 1.3.1 |
| `@nudojs/parser` | 1.3.1 |
| `@nudojs/lsp` | 1.3.1 |
| `@nudojs/env` | 0.4.15 |
| `@nudojs/harvester` | 0.3.1 |
| `vite-plugin-nudo` | 0.4.16 |
| `nudo-vscode` | 0.3.20 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.0 {#pkg-core}

## 1.7.0

### Minor Changes

- f6ec0e8: fix #76 (quickfix self-defeating `any()` + false-positive call-site errors):
  
  - service/body-read-types: collect full member-read **paths** (`node.loc.start.line`), not just first-level keys. Dereferenced intermediate fields materialize as **nested shapes** (`loc: shape({ start: shape({ line: any() }) })`) instead of `any()` — an `any()` slot value keeps its member reads counted as may-throw, so the generated contract could not clear the L2 it targeted (issue: 1/7 warnings cleared; now the nested-read cases clear too). Method accesses (`.toLowerCase()`) still type the field directly and stop the chain. `BodyReadField` gains optional `fields?: BodyReadField[]`; `shapeDslFromFields` recurses.
  - core/scan: `any` actuals against a shape precondition are no longer `nudo:constraint-violated` errors — no info, don't guess, matching the scalar-pred channel ("any ≤ 任意目标") and the same function's `unknown` handling. Determined non-object and missing-field actuals still violate (controls pinned).

更早版本（23）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.0 {#pkg-service}

## 1.6.0

### Minor Changes

- f6ec0e8: fix #76 (quickfix self-defeating `any()` + false-positive call-site errors):
  
  - service/body-read-types: collect full member-read **paths** (`node.loc.start.line`), not just first-level keys. Dereferenced intermediate fields materialize as **nested shapes** (`loc: shape({ start: shape({ line: any() }) })`) instead of `any()` — an `any()` slot value keeps its member reads counted as may-throw, so the generated contract could not clear the L2 it targeted (issue: 1/7 warnings cleared; now the nested-read cases clear too). Method accesses (`.toLowerCase()`) still type the field directly and stop the chain. `BodyReadField` gains optional `fields?: BodyReadField[]`; `shapeDslFromFields` recurses.
  - core/scan: `any` actuals against a shape precondition are no longer `nudo:constraint-violated` errors — no info, don't guess, matching the scalar-pred channel ("any ≤ 任意目标") and the same function's `unknown` handling. Determined non-object and missing-field actuals still violate (controls pinned).

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/env@0.4.15
  - @nudojs/harvester@0.3.1
  - @nudojs/parser@1.3.1

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.1 {#pkg-nudojs}

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/service@1.6.0
  - @nudojs/harvester@0.3.1
  - @nudojs/parser@1.3.1

更早版本（22）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.3.1 {#pkg-parser}

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0

更早版本（23）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.3.1 {#pkg-lsp}

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/service@1.6.0
  - @nudojs/parser@1.3.1

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.15 {#pkg-env}

## 0.4.15

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0

更早版本（22）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.1 {#pkg-harvester}

## 0.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/env@0.4.15
  - @nudojs/parser@1.3.1

更早版本（22）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.16 {#pkg-vite-plugin}

## 0.4.16

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/service@1.6.0

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## 0.3.7

- Current published line (Marketplace + Open VS X via release CI).
- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.
- Commands: `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
- Intermediate 0.3.1–0.3.6 were release-CI auto-bumps alongside the monorepo `@nudojs/*` line; see git `Version Packages` commits.

更早版本（2）→ [完整发布历史](./releases-history.md#pkg-vscode)
