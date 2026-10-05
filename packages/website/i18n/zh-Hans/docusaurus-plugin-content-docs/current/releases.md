---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.6 |
| `@nudojs/service` | 1.6.6 |
| `nudojs (CLI)` | 1.3.7 |
| `@nudojs/parser` | 1.4.3 |
| `@nudojs/lsp` | 1.4.4 |
| `@nudojs/env` | 0.4.21 |
| `@nudojs/harvester` | 0.3.7 |
| `vite-plugin-nudo` | 0.4.22 |
| `nudo-vscode` | 0.3.26 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.6 {#pkg-core}

## 1.7.6

### Patch Changes

- 856d8bf: fix(core): SequenceExpression 发射统一括号包裹 —— 逗号序列裸发射 `a, b` 在任何嵌套位都会撕裂宿主结构：对象字面量属性值/类计算键里后续项被解析成新属性的键 → `new Function` SyntaxError → 整文件 eval-incapable；数组元素位一项静默变多项（长度翻倍）。TS 降级 `#private` 产物 `[(_A = new WeakMap(), …, "k")]` 计算键正是该形态：yargs 全量命中 → 模块图逐依赖求值失败重试（失败不缓存）→ OSS bench yargs hub-edit 4.4x / check-all 2x 回归，CI OSS baseline gate 5 连红。括号在语句位/实参位均合法，统一包裹后语义不变（序列值 = 末项）。

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.6 {#pkg-service}

## 1.6.6

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/harvester@0.3.7
  - @nudojs/parser@1.4.3

更早版本（31）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.7 {#pkg-nudojs}

## 1.3.7

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/harvester@0.3.7
  - @nudojs/parser@1.4.3
  - @nudojs/service@1.6.6

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.3 {#pkg-parser}

## 1.4.3

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.4 {#pkg-lsp}

## 1.4.4

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/parser@1.4.3
  - @nudojs/service@1.6.6

更早版本（32）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.21 {#pkg-env}

## 0.4.21

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.7 {#pkg-harvester}

## 0.3.7

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/parser@1.4.3

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.22 {#pkg-vite-plugin}

## 0.4.22

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/service@1.6.6

更早版本（31）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
