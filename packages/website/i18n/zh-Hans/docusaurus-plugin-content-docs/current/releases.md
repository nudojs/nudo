---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.4 |
| `@nudojs/service` | 1.6.4 |
| `nudojs (CLI)` | 1.3.5 |
| `@nudojs/parser` | 1.4.1 |
| `@nudojs/lsp` | 1.4.2 |
| `@nudojs/env` | 0.4.19 |
| `@nudojs/harvester` | 0.3.5 |
| `vite-plugin-nudo` | 0.4.20 |
| `nudo-vscode` | 0.3.24 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.4 {#pkg-core}

## 1.7.4

### Patch Changes

- 0fd8e1a: fix(core): entry-may-throw 双误报修复（issue #97 / #98）——null 守卫后的对象 union 成员读不再报 may-throw（`p === null` 早退 / 内联三元 / `!p` / `!== null` 正分支 / `?. ??` 五形态；转译层守卫臂影子重绑 `$removeNullish`，`?.` 续体同构剪枝）；循环构建二维数组的嵌套索引读（`d[i-1][j]`）不再折 may-throw / never（非字面量下标键修复、oobUndef 越界标记、widenLoopJoin 循环 widen、`.length` 非负 pred 使 `new Array(n)` 豁免 RangeError note、`fill()` 默认窗口元素整体替换、Math min/max sum 实参逐臂判定）。契约版 levenshtein/DP 全绿；无契约 any 实参保持诚实 may-throw 政策不变。

更早版本（27）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.4 {#pkg-service}

## 1.6.4

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/harvester@0.3.5
  - @nudojs/parser@1.4.1

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.5 {#pkg-nudojs}

## 1.3.5

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/harvester@0.3.5
  - @nudojs/parser@1.4.1
  - @nudojs/service@1.6.4

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.1 {#pkg-parser}

## 1.4.1

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.2 {#pkg-lsp}

## 1.4.2

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/parser@1.4.1
  - @nudojs/service@1.6.4

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.19 {#pkg-env}

## 0.4.19

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.5 {#pkg-harvester}

## 0.3.5

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/parser@1.4.1

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.20 {#pkg-vite-plugin}

## 0.4.20

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/service@1.6.4

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
