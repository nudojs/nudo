---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.2.1 |
| `@nudojs/service` | 1.2.1 |
| `nudojs (CLI)` | 1.0.6 |
| `@nudojs/parser` | 1.1.6 |
| `@nudojs/lsp` | 1.1.6 |
| `@nudojs/env` | 0.4.8 |
| `@nudojs/harvester` | 0.2.14 |
| `vite-plugin-nudo` | 0.4.9 |
| `nudo-vscode` | 0.3.13 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.2.1 {#pkg-core}

## 1.2.1

### Patch Changes

- 7b8df37: fix(core): JS semantics — UpdateExpression, optional chain, enumerable, ToPropertyKey, copyWithin, split limit, isPrototypeOf
  
  Seven evaluator/transpile correctness fixes (one commit per class):
  
  - `x++`/`x--` use ToNumeric ± 1 (bigint gets `1n`); postfix caches the old value (IEEE 2^53 safe). `"5"++` is `6`, not `"51"`.
  - Optional chains short-circuit the **remaining** chain (`a?.b.c` ≡ `a == null ? undefined : a.b.c`), including `o?.length` / `o?.[k]` / `g?.()` / `o.m?.()`. RegExp `test`/`exec` inside a chain still rebind `lastIndex`.
  - `for-in` / `Object.assign` honor `enumerable` (shared `enumOwnKeys` / `isEnumerableView` with `Object.keys`).
  - ToPropertyKey stringifies `null`/`undefined`/`boolean` computed keys (`o[null]` ≡ `o["null"]`) for get/set/in/delete.
  - `copyWithin` overlap direction uses the **resolved** window (negative indices no longer flip).
  - `split(undefined, limit)` uses ToUint32 (`0.5`/`±Infinity` → `[]`; `-1` → `2^32-1`).
  - `Object.prototype.isPrototypeOf(Object.prototype)` is `false`.
- af8cb68: fix(core): JS semantics soundness — JSON space, bigint throws, `__proto__` keys
  
  - `JSON.stringify` space goes through to the host (`min(10, ToIntegerOrInfinity)`); `Infinity` / `(0,1)` fractions no longer collapse to compact.
  - Mixed / invalid bigint ops hard-throw `TypeError`/`RangeError` when the other operand is **definitely** non-bigint (number/bool/null/undefined). Abstract operands (`any`/`obj`/string-prim for `+`) no longer fold to `never` — `1n + s` is string concat, `1n + x` (any) is `bigint | string` with soft may-throw.
  - `__proto__` own keys survive (`JSON.parse`, computed literal, method named `__proto__`, spread/assign copy) via `defineProperty`; non-computed `{__proto__: v}` is the ES prototype special form; `Object.setPrototypeOf` missing/`undefined` proto throws.
- ff37d91: fix(core): string-face typing — concat/template with an `any` operand, abstract `.length`
  
  Two gaps that made provably-string expressions come out as `unknown` (and
  raised `nudo:unknown-inference` on real projects):
  
  - `concatString` fell back to `unknown` whenever one side had no
    string-parts view — including `any`/`unknown`. But a string operand
    determines the result type: `"s" + x`, `x + "s"` and `` `${x}` `` are all
    `string` (the ToString-throws-on-Symbol path is not modelled here). This
    contradicted `docs/design/limitations.md`'s mixed-`+` narrowing discipline
    (`number ⊗ obj/unknown → number | string`) — `1 + x` narrowed, `"s" + x` did
    not. Now a definitely-string side yields `string` (`path` conf); all-other
    cases keep the previous `unknown`.
  
  - `$len` had no branch for an abstract string prim (template / concat result /
    abstract `string`), so `` `${x}`.length `` and `String(x).length` fell to the
    trailing `unknown`. String length is always `number`; literal strings still
    fold exactly.
  
  Verified on a real project: `tarballUrl`-shaped templates and
  `printScore` / `printPublishResult`-shaped helpers stop reporting
  `nudo:unknown-inference`.

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.2.1 {#pkg-service}

## 1.2.1

### Patch Changes

- Updated dependencies [5494f67]
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/env@0.4.8
  - @nudojs/core@1.2.1
  - @nudojs/harvester@0.2.14
  - @nudojs/parser@1.1.6

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.6 {#pkg-nudojs}

## 1.0.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1
  - @nudojs/harvester@0.2.14
  - @nudojs/service@1.2.1
  - @nudojs/parser@1.1.6

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.6 {#pkg-parser}

## 1.1.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1

更早版本（16）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.6 {#pkg-lsp}

## 1.1.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1
  - @nudojs/service@1.2.1
  - @nudojs/parser@1.1.6

更早版本（19）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.8 {#pkg-env}

## 0.4.8

### Patch Changes

- 5494f67: fix(env): `Math.min` / `Math.max` / `Math.hypot` are variadic
  
  The ES env declared them as binary (`envFn([prim.num(), prim.num()], num)`), so
  `Math.min(a, b, c)` — the ordinary usage — no longer matched the arity, and the
  call degraded to `unknown`. On a real project this turned an OSA
  Damerau–Levenshtein implementation into `unknown` and failed 8 case assertions
  the moment `nudo.env` was declared.
  
  They now use `envFnVariadic(prim.num(), prim.num(), { apply: numImplVAbs(...) })`:
  any number of literal numeric args fold (`Math.min(3, 1, 2) === 1`), and
  non-literal args yield `number` instead of `unknown`.
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.14 {#pkg-harvester}

## 0.2.14

### Patch Changes

- Updated dependencies [5494f67]
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/env@0.4.8
  - @nudojs/core@1.2.1
  - @nudojs/parser@1.1.6

更早版本（15）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.9 {#pkg-vite-plugin}

## 0.4.9

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1
  - @nudojs/service@1.2.1

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## 0.3.7

- Current published line (Marketplace + Open VS X via release CI).
- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.
- Commands: `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
- Intermediate 0.3.1–0.3.6 were release-CI auto-bumps alongside the monorepo `@nudojs/*` line; see git `Version Packages` commits.

更早版本（2）→ [完整发布历史](./releases-history.md#pkg-vscode)
