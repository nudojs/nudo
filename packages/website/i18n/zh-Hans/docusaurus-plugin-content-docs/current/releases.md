---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.2.2 |
| `@nudojs/service` | 1.2.2 |
| `nudojs (CLI)` | 1.0.7 |
| `@nudojs/parser` | 1.1.7 |
| `@nudojs/lsp` | 1.1.7 |
| `@nudojs/env` | 0.4.9 |
| `@nudojs/harvester` | 0.2.15 |
| `vite-plugin-nudo` | 0.4.10 |
| `nudo-vscode` | 0.3.14 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.2.2 {#pkg-core}

## 1.2.2

### Patch Changes

- 662aeb5: fix(env): env-declared `Number`/`Array`/`Promise`/`Date` no longer shadow away call/construct
  
  Declaring `nudo.env` (e.g. `"es"`) bound these globals as namespace-only
  `objAbs` objects. Once shadowed, `Number(x)` and `new Array(n)` found nothing
  callable/constructible and degraded to `unknown` — the opposite of the host
  identity path (no env), which folds via `GLOBAL_FNS` / `$new`'s `cls === Array`.
  
  Dual-facet globals now model both faces (issue #58 option 1):
  
  - Abs `fn` may carry static `slots` (`Number.isFinite`, `Array.isArray`, …).
    `$get` / `$in` read them; `typeof` stays `"function"`.
  - `$new` dispatches Abs constructors by name through `evalBuiltinNew`
    (Array/Date/Promise/Number/String/Boolean/Map/Set/Error), instead of only
    the Error/Promise special cases.
  - ES env declares `Number`/`Array`/`Promise`/`Date` as callable `envFn` with
    static slots and a ctor `name`, so call, construct, and statics all keep
    builtin semantics under env shadowing.
  
  `Number(s)` folds to `number`, `new Array(n)` to a holey tuple, and
  `Number.isInteger` / `Array.isArray` stay precise with `nudo.env` declared.

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.2.2 {#pkg-service}

## 1.2.2

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/env@0.4.9
  - @nudojs/harvester@0.2.15
  - @nudojs/parser@1.1.7

更早版本（19）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.7 {#pkg-nudojs}

## 1.0.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/harvester@0.2.15
  - @nudojs/parser@1.1.7
  - @nudojs/service@1.2.2

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.7 {#pkg-parser}

## 1.1.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.7 {#pkg-lsp}

## 1.1.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/parser@1.1.7
  - @nudojs/service@1.2.2

更早版本（20）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.9 {#pkg-env}

## 0.4.9

### Patch Changes

- 662aeb5: fix(env): env-declared `Number`/`Array`/`Promise`/`Date` no longer shadow away call/construct
  
  Declaring `nudo.env` (e.g. `"es"`) bound these globals as namespace-only
  `objAbs` objects. Once shadowed, `Number(x)` and `new Array(n)` found nothing
  callable/constructible and degraded to `unknown` — the opposite of the host
  identity path (no env), which folds via `GLOBAL_FNS` / `$new`'s `cls === Array`.
  
  Dual-facet globals now model both faces (issue #58 option 1):
  
  - Abs `fn` may carry static `slots` (`Number.isFinite`, `Array.isArray`, …).
    `$get` / `$in` read them; `typeof` stays `"function"`.
  - `$new` dispatches Abs constructors by name through `evalBuiltinNew`
    (Array/Date/Promise/Number/String/Boolean/Map/Set/Error), instead of only
    the Error/Promise special cases.
  - ES env declares `Number`/`Array`/`Promise`/`Date` as callable `envFn` with
    static slots and a ctor `name`, so call, construct, and statics all keep
    builtin semantics under env shadowing.
  
  `Number(s)` folds to `number`, `new Array(n)` to a holey tuple, and
  `Number.isInteger` / `Array.isArray` stay precise with `nudo.env` declared.
- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.15 {#pkg-harvester}

## 0.2.15

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/env@0.4.9
  - @nudojs/parser@1.1.7

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.10 {#pkg-vite-plugin}

## 0.4.10

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/service@1.2.2

更早版本（19）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## 0.3.7

- Current published line (Marketplace + Open VS X via release CI).
- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.
- Commands: `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
- Intermediate 0.3.1–0.3.6 were release-CI auto-bumps alongside the monorepo `@nudojs/*` line; see git `Version Packages` commits.

更早版本（2）→ [完整发布历史](./releases-history.md#pkg-vscode)
