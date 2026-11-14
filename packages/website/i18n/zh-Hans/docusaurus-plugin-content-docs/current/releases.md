---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.20.0 |
| `@nudojs/service` | 1.12.2 |
| `nudojs (CLI)` | 1.9.2 |
| `@nudojs/parser` | 1.5.10 |
| `@nudojs/lsp` | 1.10.2 |
| `@nudojs/env` | 0.5.10 |
| `@nudojs/harvester` | 0.6.2 |
| `vite-plugin-nudo` | 0.7.3 |
| `nudo-vscode` | 0.3.58 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.20.0 {#pkg-core}

## 1.20.0

### Minor Changes

- aff6b7c: Add `number().finite()` and sound relation-complement narrowing.
  
  `number()` includes `NaN` and `±Infinity`, so a sequential guard such as
  `if (x < 1) return 0; return x + y;` cannot assume `x >= 1` on the fall-through
  path (`NaN < 1` is false). `number().finite()` adds the missing non-NaN evidence;
  when it (or any numeric bound) is present, the evaluator refines the
  fall-through / else arm with the complement of the relation guard at runtime
  (`$refineRelComplement`, fail-closed without evidence; the arm's Phi and
  `$refineNotNaN` also count as evidence). NaN guards (`Number.isNaN(x)`,
  `x !== x`, `x === x`, `!Number.isNaN(x)`) establish `ne(x, NaN)` on the arm
  where that holds; `Number.isFinite(x)` is one-sided (true arm only). A `const` / `let` /
  `var` alias such as `const ok = Number.isNaN(x); if (!ok) { … }` is resolved in
  the same function body or at module top level (a written alias name or guarded
  variable, loop-header shadowing/assignment, catch parameters and function
  boundaries drop the alias). A user-shadowed `Number` disables the builtin
  guard fact (fail-closed). De Morgan spellings
  (`x < 1 || y < 2`) are complemented per disjunct. The previous unproven results
  for bare `number()` are unchanged.
  
  Literal `NaN` / `±Infinity` arguments (including `0/0`, `Number.NaN`,
  `Number.POSITIVE_INFINITY`) now violate a `finite` precondition instead of
  passing silently; `NaN` and `±Infinity` globals are modeled as literals.
  
  兼容性：新增 builder 方法与非 NaN 证据下的精度收紧；未使用 `.finite()` 的
  既有契约输出逐字节不变。

### Patch Changes

- c93a32d: Cache directive-scope scanning per AST and version facet keys.
  
  `listFnDirectiveScopes` was re-walking the whole AST for every function query
  (`findFnDirectiveScope` is called per function by `checkSource`), i.e.
  O(functions × nodes). A WeakMap keyed by the parsed AST makes it one walk per
  file: `@babel/parser/lib/index.js` (0.49 MB) check
  13,179ms → 4,675ms (-64%). The AST is immutable during analysis and
  `parseSource` returns the same object for the same source, so caching cannot
  change results; a regression test pins the identity.
  
  `facetKey` now carries a `v1:` prefix (`FACET_KEY_VERSION = 1`) so future
  kind/prefix/order semantics changes get a fresh key space; empty facets still
  encode as `""`. Facets are also pinned as observation-only (not part of
  `leqAbs` / `formatShape`) — promoting a slot to value semantics requires the
  Shape migration gate (gold + real-package zero-FP + differential corpus).
  
  兼容性：内部缓存键与性能变化；未使用 facets 的 Abs 键逐字节不变。
- 190761e: Propagate the source filename into parse-mode selection for pure-JS paths.
  
  `parseSource` already skips the strip-types pass for `.js/.mjs/.cjs/.jsx`
  (structurally a no-op there), but service / transpile / module-graph / fingerprint
  / directive-scan call sites omitted the filename, so JS sources were parsed in
  ts mode and paid two extra full-AST walks. Threading `filename` from
  `analyzeFile`, `transpileModule`/`runTranspiled`, the abs module graph, load-deps
  fingerprints, directive extractors and `localNamedExports` drops a 9.14 MB
  self-contained JS file from 20,755ms to 14,594ms (-29.7%); the remaining
  strip-types share in the profile is ~2% (`checkSource` path 1.7%).
  
  兼容性：解析模式由文件扩展名决定（缺省仍为 ts 模式，未知扩展名行为不变）；
  `.js` 里的 TS-only 语法仍是 syntax-error（Bug 114 / Bug 451 口径不变）。

更早版本（61）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.12.2 {#pkg-service}

## 1.12.2

### Patch Changes

- 190761e: Propagate the source filename into parse-mode selection for pure-JS paths.
  
  `parseSource` already skips the strip-types pass for `.js/.mjs/.cjs/.jsx`
  (structurally a no-op there), but service / transpile / module-graph / fingerprint
  / directive-scan call sites omitted the filename, so JS sources were parsed in
  ts mode and paid two extra full-AST walks. Threading `filename` from
  `analyzeFile`, `transpileModule`/`runTranspiled`, the abs module graph, load-deps
  fingerprints, directive extractors and `localNamedExports` drops a 9.14 MB
  self-contained JS file from 20,755ms to 14,594ms (-29.7%); the remaining
  strip-types share in the profile is ~2% (`checkSource` path 1.7%).
  
  兼容性：解析模式由文件扩展名决定（缺省仍为 ts 模式，未知扩展名行为不变）；
  `.js` 里的 TS-only 语法仍是 syntax-error（Bug 114 / Bug 451 口径不变）。
- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0
  - @nudojs/parser@1.5.10
  - @nudojs/env@0.5.10
  - @nudojs/harvester@0.6.2

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.9.2 {#pkg-nudojs}

## 1.9.2

### Patch Changes

- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0
  - @nudojs/parser@1.5.10
  - @nudojs/service@1.12.2
  - @nudojs/env@0.5.10
  - @nudojs/harvester@0.6.2

更早版本（60）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.10 {#pkg-parser}

## 1.5.10

### Patch Changes

- 190761e: Propagate the source filename into parse-mode selection for pure-JS paths.
  
  `parseSource` already skips the strip-types pass for `.js/.mjs/.cjs/.jsx`
  (structurally a no-op there), but service / transpile / module-graph / fingerprint
  / directive-scan call sites omitted the filename, so JS sources were parsed in
  ts mode and paid two extra full-AST walks. Threading `filename` from
  `analyzeFile`, `transpileModule`/`runTranspiled`, the abs module graph, load-deps
  fingerprints, directive extractors and `localNamedExports` drops a 9.14 MB
  self-contained JS file from 20,755ms to 14,594ms (-29.7%); the remaining
  strip-types share in the profile is ~2% (`checkSource` path 1.7%).
  
  兼容性：解析模式由文件扩展名决定（缺省仍为 ts 模式，未知扩展名行为不变）；
  `.js` 里的 TS-only 语法仍是 syntax-error（Bug 114 / Bug 451 口径不变）。
- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0

更早版本（60）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.10.2 {#pkg-lsp}

## 1.10.2

### Patch Changes

- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0
  - @nudojs/parser@1.5.10
  - @nudojs/service@1.12.2

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.10 {#pkg-env}

## 0.5.10

### Patch Changes

- aff6b7c: Add `number().finite()` and sound relation-complement narrowing.
  
  `number()` includes `NaN` and `±Infinity`, so a sequential guard such as
  `if (x < 1) return 0; return x + y;` cannot assume `x >= 1` on the fall-through
  path (`NaN < 1` is false). `number().finite()` adds the missing non-NaN evidence;
  when it (or any numeric bound) is present, the evaluator refines the
  fall-through / else arm with the complement of the relation guard at runtime
  (`$refineRelComplement`, fail-closed without evidence; the arm's Phi and
  `$refineNotNaN` also count as evidence). NaN guards (`Number.isNaN(x)`,
  `x !== x`, `x === x`, `!Number.isNaN(x)`) establish `ne(x, NaN)` on the arm
  where that holds; `Number.isFinite(x)` is one-sided (true arm only). A `const` / `let` /
  `var` alias such as `const ok = Number.isNaN(x); if (!ok) { … }` is resolved in
  the same function body or at module top level (a written alias name or guarded
  variable, loop-header shadowing/assignment, catch parameters and function
  boundaries drop the alias). A user-shadowed `Number` disables the builtin
  guard fact (fail-closed). De Morgan spellings
  (`x < 1 || y < 2`) are complemented per disjunct. The previous unproven results
  for bare `number()` are unchanged.
  
  Literal `NaN` / `±Infinity` arguments (including `0/0`, `Number.NaN`,
  `Number.POSITIVE_INFINITY`) now violate a `finite` precondition instead of
  passing silently; `NaN` and `±Infinity` globals are modeled as literals.
  
  兼容性：新增 builder 方法与非 NaN 证据下的精度收紧；未使用 `.finite()` 的
  既有契约输出逐字节不变。
- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0

更早版本（60）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.6.2 {#pkg-harvester}

## 0.6.2

### Patch Changes

- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0
  - @nudojs/parser@1.5.10
  - @nudojs/env@0.5.10

更早版本（60）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.7.3 {#pkg-vite-plugin}

## 0.7.3

### Patch Changes

- Updated dependencies [c93a32d]
- Updated dependencies [190761e]
- Updated dependencies [aff6b7c]
  - @nudojs/core@1.20.0
  - @nudojs/service@1.12.2

更早版本（63）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
