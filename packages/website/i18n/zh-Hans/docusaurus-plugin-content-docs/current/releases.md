---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.17.1 |
| `@nudojs/service` | 1.10.2 |
| `nudojs (CLI)` | 1.7.2 |
| `@nudojs/parser` | 1.5.5 |
| `@nudojs/lsp` | 1.8.2 |
| `@nudojs/env` | 0.5.5 |
| `@nudojs/harvester` | 0.4.5 |
| `vite-plugin-nudo` | 0.6.2 |
| `nudo-vscode` | 0.3.53 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.17.1 {#pkg-core}

## 1.17.1

### Patch Changes

- d726525: Fix the OSS real-package benchmark regressions (perf) and the `nudo:assign-mismatch` false positive.
  
  **Perf** — the analysis pipeline repeated whole-file work per candidate:
  
  - `localNamedExports` (source → local export-name table) is now memoized per source text and computed **once** per candidate loop instead of once per candidate. It parses with `errorRecovery`, which deliberately bypasses the AST LRU ⇒ a single-file analysis re-parsed the whole file **5 151 times** (451 MB of repeated parsing; the TS strip pass alone 36.6 s). A single `commander/lib/command.js` analysis went from **59.2 s → 4.1 s**.
  - Function-directive scopes (`listFnDirectiveScopes`) are memoized per AST object (the scope walk was repeated per function × per refine site).
  - The source-level lexer scan (`scanSource`) and the file-level directive gate ranges (`bodyGateRanges`) are memoized per source text — the three file-level directive extractors each re-walked the whole AST.
  - The TS strip pass is skipped for JS-mode sources: the `jsx`-only plugin set cannot produce TS-only nodes, so the pass was a structural no-op that still paid two full AST walks per parse.
  - The `@nudo:` directive count inside the strip pass now runs only when the caller asks for a report (it was dead work on every parse).
  
  **Fix** — `nudo:assign-mismatch` no longer fires on **function parameter** reassignment. A JS parameter has no declared type: the analysed "previous value" is the shape of the actual argument at that call site, so normalising a parameter (`global(globals) { globals = [].concat(globals); … }` in yargs) was reported as `arr ⊭ prim string` — a false positive on the OSS corpus. The check keeps its obligation for bindings with a declared value (`let n = 1; n = "str"` still reports).

更早版本（56）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.10.2 {#pkg-service}

## 1.10.2

### Patch Changes

- d726525: Fix the OSS real-package benchmark regressions (perf) and the `nudo:assign-mismatch` false positive.
  
  **Perf** — the analysis pipeline repeated whole-file work per candidate:
  
  - `localNamedExports` (source → local export-name table) is now memoized per source text and computed **once** per candidate loop instead of once per candidate. It parses with `errorRecovery`, which deliberately bypasses the AST LRU ⇒ a single-file analysis re-parsed the whole file **5 151 times** (451 MB of repeated parsing; the TS strip pass alone 36.6 s). A single `commander/lib/command.js` analysis went from **59.2 s → 4.1 s**.
  - Function-directive scopes (`listFnDirectiveScopes`) are memoized per AST object (the scope walk was repeated per function × per refine site).
  - The source-level lexer scan (`scanSource`) and the file-level directive gate ranges (`bodyGateRanges`) are memoized per source text — the three file-level directive extractors each re-walked the whole AST.
  - The TS strip pass is skipped for JS-mode sources: the `jsx`-only plugin set cannot produce TS-only nodes, so the pass was a structural no-op that still paid two full AST walks per parse.
  - The `@nudo:` directive count inside the strip pass now runs only when the caller asks for a report (it was dead work on every parse).
  
  **Fix** — `nudo:assign-mismatch` no longer fires on **function parameter** reassignment. A JS parameter has no declared type: the analysed "previous value" is the shape of the actual argument at that call site, so normalising a parameter (`global(globals) { globals = [].concat(globals); … }` in yargs) was reported as `arr ⊭ prim string` — a false positive on the OSS corpus. The check keeps its obligation for bindings with a declared value (`let n = 1; n = "str"` still reports).
- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/env@0.5.5
  - @nudojs/harvester@0.4.5
  - @nudojs/parser@1.5.5

更早版本（58）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.7.2 {#pkg-nudojs}

## 1.7.2

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/service@1.10.2
  - @nudojs/env@0.5.5
  - @nudojs/harvester@0.4.5
  - @nudojs/parser@1.5.5

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.5 {#pkg-parser}

## 1.5.5

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.8.2 {#pkg-lsp}

## 1.8.2

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/service@1.10.2
  - @nudojs/parser@1.5.5

更早版本（59）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.5 {#pkg-env}

## 0.5.5

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.4.5 {#pkg-harvester}

## 0.4.5

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/env@0.5.5
  - @nudojs/parser@1.5.5

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.6.2 {#pkg-vite-plugin}

## 0.6.2

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/service@1.10.2

更早版本（58）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
