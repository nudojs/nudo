---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.8 |
| `@nudojs/service` | 1.6.8 |
| `nudojs (CLI)` | 1.3.9 |
| `@nudojs/parser` | 1.4.5 |
| `@nudojs/lsp` | 1.4.6 |
| `@nudojs/env` | 0.4.23 |
| `@nudojs/harvester` | 0.3.9 |
| `vite-plugin-nudo` | 0.4.24 |
| `nudo-vscode` | 0.3.28 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.8 {#pkg-core}

## 1.7.8

### Patch Changes

- 58b7938: fix(core): class extends Error 的 super(message) 不再静默 no-op——基类构造槽落地（#110）
  
  `constructClass` 对无注册 spec 的基类（env/宿主内建构造器）此前原样返回 thisVal，`super(message)` 的 args 被丢弃：派生实例 `e.message` 折假精确 `undefined #exact`（原生为 message 字符串）、`e.name` 同为 `undefined #exact`（原生经原型链为 `"Error"`）。#106 恢复 `class extends Error` 定义期干净后暴露面增大。
  
  修复：`!spec` 分支对 Error 家族（isErrorCtorName）按 errorBrandAbs 落 name/message 槽——与 `new Error(...)` 完全同口径：
  
  - lit message 保精确、ToString 折叠（number → "5"、缺省 → ""）、AggregateError errors/message/cause 实参序、options.cause 透传；
  - any message 构造记录 message-ToString may-throw（`new Error(Symbol())` 原生抛 TypeError，L2 同 `new Error(anyMsg)`）；
  - brand 名保持被构造实例（B extends A extends Error 中间用户类链不换名、方法派发不断链）；name 槽是基类名（原生 Error.prototype.name 经原型链可见），子类自有 name 字段/赋值源序在 super 后照常覆盖；
  - 用户同名类优先（getEvalClass 命中即不走内建分支）；其余内建基类（Promise/Date/…）维持原样。

更早版本（31）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.8 {#pkg-service}

## 1.6.8

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/harvester@0.3.9
  - @nudojs/parser@1.4.5

更早版本（33）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.9 {#pkg-nudojs}

## 1.3.9

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/harvester@0.3.9
  - @nudojs/parser@1.4.5
  - @nudojs/service@1.6.8

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.5 {#pkg-parser}

## 1.4.5

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.6 {#pkg-lsp}

## 1.4.6

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/parser@1.4.5
  - @nudojs/service@1.6.8

更早版本（34）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.23 {#pkg-env}

## 0.4.23

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.9 {#pkg-harvester}

## 0.3.9

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/parser@1.4.5

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.24 {#pkg-vite-plugin}

## 0.4.24

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/service@1.6.8

更早版本（33）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
