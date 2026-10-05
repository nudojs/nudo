---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.5 |
| `@nudojs/service` | 1.6.5 |
| `nudojs (CLI)` | 1.3.6 |
| `@nudojs/parser` | 1.4.2 |
| `@nudojs/lsp` | 1.4.3 |
| `@nudojs/env` | 0.4.20 |
| `@nudojs/harvester` | 0.3.6 |
| `vite-plugin-nudo` | 0.4.21 |
| `nudo-vscode` | 0.3.25 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.5 {#pkg-core}

## 1.7.5

### Patch Changes

- 4c3fafd: fix(core): OOB marker 臂不再把返回契约判成 error（issue #102）—— 抽象下标读（循环建表后的 `d[m][n]`）并入的 `oobUndef` marker（conf=partial 合成 undefined）是引擎精度产物而非用户域 undefined；postcondition 对该臂降级 unprovable（`nudo:unproven-return` warning，gate 不再变红），与 widened 污染臂同口径；契约显式承认 nullish（`nullable(...)` / `union(..., lit(null))`）时 marker 臂 discharged（多臂与单臂 proved 口径对称）。真实 nullish 返回臂仍照常 `nudo:constraint-violated` error；其余真实臂证据充分时仍 disproved。DP / 编辑距离 / 备忘录类「循环建表 + 按构造在界内读取 + number() 返回契约」函数恢复绿门（1.3.4 语义）。已知召回权衡：真实无约束下标越界返回（`return a[i]`）从 error 降为 warning——与 #98 oobUndef 按类压制同族，理想收窄需循环上界×下标关系推理。

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.5 {#pkg-service}

## 1.6.5

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/harvester@0.3.6
  - @nudojs/parser@1.4.2

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.6 {#pkg-nudojs}

## 1.3.6

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/harvester@0.3.6
  - @nudojs/parser@1.4.2
  - @nudojs/service@1.6.5

更早版本（27）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.2 {#pkg-parser}

## 1.4.2

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5

更早版本（27）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.3 {#pkg-lsp}

## 1.4.3

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/parser@1.4.2
  - @nudojs/service@1.6.5

更早版本（31）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.20 {#pkg-env}

## 0.4.20

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5

更早版本（27）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.6 {#pkg-harvester}

## 0.3.6

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/parser@1.4.2

更早版本（27）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.21 {#pkg-vite-plugin}

## 0.4.21

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/service@1.6.5

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
