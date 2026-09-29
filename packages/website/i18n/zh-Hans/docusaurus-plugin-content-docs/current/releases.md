---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.3.0 |
| `@nudojs/service` | 1.2.3 |
| `nudojs (CLI)` | 1.0.8 |
| `@nudojs/parser` | 1.1.8 |
| `@nudojs/lsp` | 1.1.8 |
| `@nudojs/env` | 0.4.10 |
| `@nudojs/harvester` | 0.2.16 |
| `vite-plugin-nudo` | 0.4.11 |
| `nudo-vscode` | 0.3.15 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.3.0 {#pkg-core}

## 1.3.0

### Minor Changes

- c717017: fix(dx): sidecar load failure reported once (#64) + contract/DX improvements
  
  1. **Sidecar load failure dedup** (defect): a broken `*.nudo.js` no longer
     reports the same `nudo:interface-load` once per source export. Unrelated
     exports are filtered by the sidecar's export names before exec; module-level
     failures dedup by (path, reason) with one message and `(affects N bindings)`
     — wording no longer says `for 'X'` (reads like X itself is broken).
  
  2. **L2 entry-may-throw actions**: the most honest fix (sidecar `fn({ … })`
     param contract) is now the first suggested action, ahead of `@nudo:throws`.
  
  3. **Destructured param contracts render**: `decide({ grade, findings })` with
     a sidecar field contract shows `{ grade, findings }: { grade: string, … }`
     instead of `decide(_p0: any)`.
  
  4. **`@nudo:budget` function-level budget knob**:
     `@nudo:budget forks=20000` / `calls=… depth=…` raises the call/fork budget
     for that function's evaluation only (restored after). Truncation
     suggestions point at this knob instead of only global `maxForks`.

### Patch Changes

- 6bc08c7: fix(env): env globals no longer shadow the host `undefined` / `NaN` / `Infinity`
  
  `runTranspiled` injects every `@nudo:env` global as a module-scope
  `const <name> = __nudoEnv["<name>"]`, which shadows the host global for the
  whole transpiled body. `@nudojs/env/es` declares `undefined: undef()`, and
  `web` / `node` imply `es` — so any `nudo.env` declaration shadowed `undefined`:
  
  - the transpiler's own bare `undefined` text (`stmt` missing `else` arm,
    implicit return) and `$lit(undefined)` received an **Abs object**;
  - effect: a conditional `return` inside a loop joined to `unknown`, so
    `for (const s of list) { if (s === "high") return "l1"; } return "l0";`
    folded to `unknown` instead of `"l0" | "l1"`;
  - `NaN` bound as `prim.num()` degraded `0 === NaN` from the definite `false`
    of native semantics to `boolean`.
  
  Injection now skips `undefined` / `NaN` / `Infinity`: the transpiler already
  hardcodes those identifiers as `$lit(...)`, so the consts had no upside and
  only shadowed the host.
  
  Measured on a consumer project (npm-safe) with `nudo.env = ["es","node","web"]`:
  `nudo test` went 39/39 → 23 passed / 10 failed; with this fix it is 33 + 6
  planned cases green again, plus `opaque-result` 34 → 28, `unknown-inference`
  9 → 6, `host-effect-blocked` 1 → 0 (env-declared builtins now fold instead of
  failing closed).
- d925692: fix(core): transpile emissions no longer depend on host `undefined` / `NaN` / `Infinity` identifier identity
  
  Follow-up hardening after the env-injection skip fix:
  
  - emit `$lit(void 0)` / `$lit(0/0)` / `$lit(1/0)` instead of `$lit(undefined)` /
    `$lit(NaN)` / `$lit(Infinity)` so generated code never reads those identifiers;
  - omit `$fork`'s third argument when there is no `else` arm (previously emitted a
    bare `undefined` sentinel that broke if the name was shadowed);
  - share one `HOST_INTRINSIC_NAMES` table between transpile folding and the env
    inject skip set, so the two lists cannot drift;
  - free-assignment / fork-binding filters exclude all three intrinsics, not just
    `undefined`.

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.2.3 {#pkg-service}

## 1.2.3

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/env@0.4.10
  - @nudojs/harvester@0.2.16
  - @nudojs/parser@1.1.8

更早版本（20）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.0.8 {#pkg-nudojs}

## 1.0.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/harvester@0.2.16
  - @nudojs/parser@1.1.8
  - @nudojs/service@1.2.3

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.1.8 {#pkg-parser}

## 1.1.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0

更早版本（18）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.1.8 {#pkg-lsp}

## 1.1.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/parser@1.1.8
  - @nudojs/service@1.2.3

更早版本（21）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.10 {#pkg-env}

## 0.4.10

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.2.16 {#pkg-harvester}

## 0.2.16

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/env@0.4.10
  - @nudojs/parser@1.1.8

更早版本（17）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.11 {#pkg-vite-plugin}

## 0.4.11

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/service@1.2.3

更早版本（20）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## 0.3.7

- Current published line (Marketplace + Open VS X via release CI).
- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.
- Commands: `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
- Intermediate 0.3.1–0.3.6 were release-CI auto-bumps alongside the monorepo `@nudojs/*` line; see git `Version Packages` commits.

更早版本（2）→ [完整发布历史](./releases-history.md#pkg-vscode)
