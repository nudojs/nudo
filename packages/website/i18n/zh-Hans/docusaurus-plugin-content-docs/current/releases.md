---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.1.3 |
| `@nudojs/service` | 1.1.3 |
| `nudojs (CLI)` | 1.0.3 |
| `@nudojs/parser` | 1.1.3 |
| `@nudojs/lsp` | 1.1.3 |
| `@nudojs/env` | 0.4.5 |
| `@nudojs/harvester` | 0.2.11 |
| `vite-plugin-nudo` | 0.4.6 |
| `nudo-vscode` | 0.3.10 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.1.3 {#pkg-core}

## 1.1.3

### Patch Changes

- 3bf9997: fix(core): JS semantics soundness — ToString args, compare undefined, NaN identity, JSON.stringify
  
  B-path Abs folding corrections so concrete results match native JS:
  
  - string/parse methods (`startsWith`/`endsWith`/`includes`/`split`/`replace`/
    `indexOf`/`parseInt`/`parseFloat`) honor ToString and missing-arg defaults;
    `split` keeps the ES special case that an **undefined** separator returns
    `[ToString(O)]` without splitting
  - relational compare of `lit(undefined)` folds via ToNumber (all relations false)
  - same-var `===` is not exact `true` when the value may be NaN
  - `JSON.stringify` of top-level function/symbol returns the JS `undefined` value
  - NaN literal identity uses SameValue (assignment/`leq`), not `===`
  - drop unsound `x*0=0` / `x+0=x` algebra identities (NaN/`-0`/string domain)
  - `n % 0` folds to NaN; `x % k` bounds only for finite dividends
  - `0n` is falsy; `Number.is*` fold non-number lits to false; global `isNaN` coerces
  - string index methods (`charAt`/`slice`/…) honor ToNumber and default args
  - unary minus and `parseInt`/`parseFloat` honor ToNumber/ToInt32
  - Math.* folds ToNumber lits (own numeric methods only — no `constructor`/`toString`)
  - tuple index reads use canonical array index (`a["0"] === a[0]`)
  - call-spread placeholder is `unknown`, not `undefined` lit
  
  `fix(parser)`: directive scanners (`splitTopLevelArgs` / colon / arrow / balanced
  parens) respect string literals.
  
  Review follow-ups folded in: `split(undefined)` special case, `indexOf` returns
  number shape on abstract receivers, Math method allowlist.

更早版本（13）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.1.3 {#pkg-service}

## 1.1.3

### Patch Changes

- 43fb345: fix(service): honor `package.json#nudo.check.profile` in `checkConfig` (LSP parity)
  
  The CLI resolves `nudo.check.profile` (`adoption` → L2 `warning`, `strict` →
  `error`) but the service `checkConfig` — which the LSP uses for
  `nudo-check` diagnostics — only read `nudo.check.entryThrows`. In a project
  with `"nudo": { "check": { "profile": "adoption" } }`, `nudo check` printed
  `nudo:entry-may-throw` as a **warning** while the IDE showed it as an
  **error**.
  
  `checkConfig` now applies the same preset, with the same precedence as the CLI
  (`entryThrows` → `profile` → default `error`), and `NudoConfig["check"]`
  gains the `profile` field.
- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/env@0.4.5
  - @nudojs/harvester@0.2.11

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.3 {#pkg-nudojs}

## 1.0.3

### Patch Changes

- Updated dependencies [3bf9997]
- Updated dependencies [43fb345]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/service@1.1.3
  - @nudojs/harvester@0.2.11

更早版本（12）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.3 {#pkg-parser}

## 1.1.3

### Patch Changes

- 3bf9997: fix(core): JS semantics soundness — ToString args, compare undefined, NaN identity, JSON.stringify
  
  B-path Abs folding corrections so concrete results match native JS:
  
  - string/parse methods (`startsWith`/`endsWith`/`includes`/`split`/`replace`/
    `indexOf`/`parseInt`/`parseFloat`) honor ToString and missing-arg defaults;
    `split` keeps the ES special case that an **undefined** separator returns
    `[ToString(O)]` without splitting
  - relational compare of `lit(undefined)` folds via ToNumber (all relations false)
  - same-var `===` is not exact `true` when the value may be NaN
  - `JSON.stringify` of top-level function/symbol returns the JS `undefined` value
  - NaN literal identity uses SameValue (assignment/`leq`), not `===`
  - drop unsound `x*0=0` / `x+0=x` algebra identities (NaN/`-0`/string domain)
  - `n % 0` folds to NaN; `x % k` bounds only for finite dividends
  - `0n` is falsy; `Number.is*` fold non-number lits to false; global `isNaN` coerces
  - string index methods (`charAt`/`slice`/…) honor ToNumber and default args
  - unary minus and `parseInt`/`parseFloat` honor ToNumber/ToInt32
  - Math.* folds ToNumber lits (own numeric methods only — no `constructor`/`toString`)
  - tuple index reads use canonical array index (`a["0"] === a[0]`)
  - call-spread placeholder is `unknown`, not `undefined` lit
  
  `fix(parser)`: directive scanners (`splitTopLevelArgs` / colon / arrow / balanced
  parens) respect string literals.
  
  Review follow-ups folded in: `split(undefined)` special case, `indexOf` returns
  number shape on abstract receivers, Math method allowlist.
- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3

更早版本（13）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.3 {#pkg-lsp}

## 1.1.3

### Patch Changes

- Updated dependencies [3bf9997]
- Updated dependencies [43fb345]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/service@1.1.3

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.5 {#pkg-env}

## 0.4.5

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3

更早版本（12）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.11 {#pkg-harvester}

## 0.2.11

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/env@0.4.5

更早版本（12）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.6 {#pkg-vite-plugin}

## 0.4.6

### Patch Changes

- Updated dependencies [3bf9997]
- Updated dependencies [43fb345]
  - @nudojs/core@1.1.3
  - @nudojs/service@1.1.3

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.10 {#pkg-vscode}

## Unreleased

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
