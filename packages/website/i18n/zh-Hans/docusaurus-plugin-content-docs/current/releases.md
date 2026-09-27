---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.1.4 |
| `@nudojs/service` | 1.1.4 |
| `nudojs (CLI)` | 1.0.4 |
| `@nudojs/parser` | 1.1.4 |
| `@nudojs/lsp` | 1.1.4 |
| `@nudojs/env` | 0.4.6 |
| `@nudojs/harvester` | 0.2.12 |
| `vite-plugin-nudo` | 0.4.7 |
| `nudo-vscode` | 0.3.11 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.1.4 {#pkg-core}

## 1.1.4

### Patch Changes

- 634932f: fix(core): Array.prototype method reads no longer hijack `$invoke`
  
  `$get` returned `absFunction([], { body: noBody })` for Array.prototype
  methods (`concat`/`sort`/…). `$invoke` treated that hollow impl as an object
  method and `$call`ed it, folding `a.concat(b)` to exact `undefined` and
  `arr.sort()` to `never`/TypeError — false precision vs the previous
  conservative `unknown` (benchmark gate: `array-03` / `complex-01` regressed
  `unknown → mismatch`).
  
  First-class reads still expose a function-shaped Abs (`typeof a.push ===
  "function"`), but without a callable impl so method calls fall through to
  `invokeArrMethod` / conservative `unknown`.

更早版本（14）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.1.4 {#pkg-service}

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/env@0.4.6
  - @nudojs/harvester@0.2.12
  - @nudojs/parser@1.1.4

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.4 {#pkg-nudojs}

## 1.0.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/harvester@0.2.12
  - @nudojs/parser@1.1.4
  - @nudojs/service@1.1.4

更早版本（13）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.4 {#pkg-parser}

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4

更早版本（14）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.4 {#pkg-lsp}

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/parser@1.1.4
  - @nudojs/service@1.1.4

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.6 {#pkg-env}

## 0.4.6

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4

更早版本（13）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.12 {#pkg-harvester}

## 0.2.12

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/env@0.4.6
  - @nudojs/parser@1.1.4

更早版本（13）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.7 {#pkg-vite-plugin}

## 0.4.7

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/service@1.1.4

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.11 {#pkg-vscode}

## Unreleased

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
