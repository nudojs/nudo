---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.10.2 |
| `@nudojs/service` | 1.6.19 |
| `nudojs (CLI)` | 1.3.20 |
| `@nudojs/parser` | 1.4.16 |
| `@nudojs/lsp` | 1.6.2 |
| `@nudojs/env` | 0.4.34 |
| `@nudojs/harvester` | 0.3.20 |
| `vite-plugin-nudo` | 0.4.35 |
| `nudo-vscode` | 0.3.39 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.10.2 {#pkg-core}

## 1.10.2

### Patch Changes

- 8806e93: Fix env-brand iteration false warnings and env-global slot writes poisoning whole-function evaluation (issues #147/#148):
  
  - `iterabilityKind`/`asyncIterabilityKind` now treat a `brand` shape as a nominal label delegating to its inner structural face: a brand wrapping an array/tuple/string/`@@iterator` object is **total** (no more `may throw TypeError — iteration over possibly non-iterable` on `for…of`/spread over env `Array<T>` brands such as `fs.readdirSync`). Non-total inner faces stay **may** and never degrade to **definite** (TypedArray/Buffer brands wrap an empty object whose prototype `@@iterator` is not modeled). Element domains delegate the same way (`elemsOf`/`$concat`): the `for…of` loop variable and spread elements now fold to the inner array element (`string | Dirent`) instead of `unknown`, and a brand wrapping a tuple keeps the precise tuple shape when spread (`[...t, ...brandT]` stays a tuple, not `T[]`).
  - Env-global injection in `runTranspiled` binds globals with `let` instead of `const`: a member write like `process.exitCode = 1` compiles to a root-rebinding write-back chain (`process = $set(process, …)`), which against a `const` binding threw a native TypeError and poisoned the whole eval (return folded to `unknown` + `nudo:unknown-inference` + `nudo:entry-may-throw`). Env globals are writable `globalThis` properties natively; writes now fold and a later read in the same program run observes the written value.

更早版本（42）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.19 {#pkg-service}

## 1.6.19

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/env@0.4.34
  - @nudojs/harvester@0.3.20
  - @nudojs/parser@1.4.16

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.20 {#pkg-nudojs}

## 1.3.20

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/env@0.4.34
  - @nudojs/harvester@0.3.20
  - @nudojs/parser@1.4.16
  - @nudojs/service@1.6.19

更早版本（41）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.16 {#pkg-parser}

## 1.4.16

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2

更早版本（41）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.2 {#pkg-lsp}

## 1.6.2

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/parser@1.4.16
  - @nudojs/service@1.6.19

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.34 {#pkg-env}

## 0.4.34

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2

更早版本（41）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.20 {#pkg-harvester}

## 0.3.20

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/env@0.4.34
  - @nudojs/parser@1.4.16

更早版本（41）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.35 {#pkg-vite-plugin}

## 0.4.35

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/service@1.6.19

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
