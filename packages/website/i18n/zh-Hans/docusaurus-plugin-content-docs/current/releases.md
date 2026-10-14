---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.11.3 |
| `@nudojs/service` | 1.6.23 |
| `nudojs (CLI)` | 1.3.24 |
| `@nudojs/parser` | 1.4.20 |
| `@nudojs/lsp` | 1.6.6 |
| `@nudojs/env` | 0.4.38 |
| `@nudojs/harvester` | 0.3.24 |
| `vite-plugin-nudo` | 0.4.39 |
| `nudo-vscode` | 0.3.43 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.11.3 {#pkg-core}

## 1.11.3

### Patch Changes

- 08d7a55: Fix five exec-surface wrong-concrete bugs (80–84) found by differential testing:
  
  - **`#x in obj`** (private-field `in` operator): the left `PrivateName` operand fell through `isExpression` and compiled to `$lit(void 0)`, so the presence test always returned `false`. The `in` arm now emits the mangled `"#x"` key via the shared `privateNameKeySrc` helper (also deduped into member read/assign).
  - **`this.#x += 1`** (private-field compound assignment): the root-non-rebindable branch emitted a simple assignment using the RHS directly, dropping the operation (`+=1` assigned `1`). It now applies `compoundFn` to the current `$get` value, mirroring the member-path branch.
  - **`o + "x"` with a `Symbol.toPrimitive` hook**: `coerceToStringParts` folded hook-only objects to the default `"[object Object]"` tag (wrong concrete string). The fold guard now also checks for an own `"@@toPrimitive"` slot — hook presence blocks the fold and yields a sound abstract string domain.
  - **`Array.prototype.concat` ignores `Symbol.isConcatSpreadable`**: spreadable objects are now spread as array-likes (`ToLength(o.length)` elements), `lit false` suppresses spreading, abstract flags degrade to `arr` (sound).
  - **Private fields leak as enumerable own properties**: private slots are now flagged `internal` at instance-field registration (not by `#` name prefix — public string keys like `{"#x":1}` share the key space and stay visible). `for-in`, `Object.keys/values/entries`, `hasOwnProperty`, `getOwnPropertyNames/Descriptors`, spread, `Object.assign`, and `JSON.stringify` exclude internal slots; direct `this.#x` access and `#x in obj` slot-presence semantics are unchanged. Class-instance spread/assign now also includes public fields (previously dropped), and Error-family own slots (`name`/`message`/`stack`) are non-enumerable per native semantics.
  - **Class-instance precision follow-ups**: `Object.getOwnPropertyDescriptor(new A(), key)` now folds exact data/accessor descriptors for public fields (runtime `defineProperty` flags and dynamic getters included) instead of the conservative `descriptor|undefined` domain; `JSON.stringify` folds class instances with prototype getters exactly (`{"pub":2}` — prototype accessors are not own properties, native never invokes them during stringify; only `toJSON` methods keep the conservative fold).

更早版本（46）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.23 {#pkg-service}

## 1.6.23

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/env@0.4.38
  - @nudojs/harvester@0.3.24
  - @nudojs/parser@1.4.20

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.24 {#pkg-nudojs}

## 1.3.24

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/env@0.4.38
  - @nudojs/harvester@0.3.24
  - @nudojs/parser@1.4.20
  - @nudojs/service@1.6.23

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.20 {#pkg-parser}

## 1.4.20

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.6 {#pkg-lsp}

## 1.6.6

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/parser@1.4.20
  - @nudojs/service@1.6.23

更早版本（49）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.38 {#pkg-env}

## 0.4.38

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.24 {#pkg-harvester}

## 0.3.24

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/env@0.4.38
  - @nudojs/parser@1.4.20

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.39 {#pkg-vite-plugin}

## 0.4.39

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/service@1.6.23

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
