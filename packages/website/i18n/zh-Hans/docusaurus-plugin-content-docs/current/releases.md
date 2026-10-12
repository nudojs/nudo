---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.11.2 |
| `@nudojs/service` | 1.6.22 |
| `nudojs (CLI)` | 1.3.23 |
| `@nudojs/parser` | 1.4.19 |
| `@nudojs/lsp` | 1.6.5 |
| `@nudojs/env` | 0.4.37 |
| `@nudojs/harvester` | 0.3.23 |
| `vite-plugin-nudo` | 0.4.38 |
| `nudo-vscode` | 0.3.42 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.11.2 {#pkg-core}

## 1.11.2

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.

更早版本（45）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.22 {#pkg-service}

## 1.6.22

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.
- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/env@0.4.37
  - @nudojs/harvester@0.3.23
  - @nudojs/parser@1.4.19

更早版本（47）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.23 {#pkg-nudojs}

## 1.3.23

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.
- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/service@1.6.22
  - @nudojs/env@0.4.37
  - @nudojs/harvester@0.3.23
  - @nudojs/parser@1.4.19

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.19 {#pkg-parser}

## 1.4.19

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.6.5 {#pkg-lsp}

## 1.6.5

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.
- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/service@1.6.22
  - @nudojs/parser@1.4.19

更早版本（48）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.37 {#pkg-env}

## 0.4.37

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.23 {#pkg-harvester}

## 0.3.23

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/env@0.4.37
  - @nudojs/parser@1.4.19

更早版本（44）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.38 {#pkg-vite-plugin}

## 0.4.38

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/service@1.6.22

更早版本（47）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
