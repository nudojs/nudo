---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.20.1 |
| `@nudojs/service` | 1.12.3 |
| `nudojs (CLI)` | 1.9.3 |
| `@nudojs/parser` | 1.5.11 |
| `@nudojs/lsp` | 1.10.3 |
| `@nudojs/env` | 0.5.11 |
| `@nudojs/harvester` | 0.6.3 |
| `vite-plugin-nudo` | 0.7.4 |
| `nudo-vscode` | 0.3.59 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.20.1 {#pkg-core}

## 1.20.1

### Patch Changes

- 795e322: Close the 34 bugs from the ABS-15 audit, grouped by root cause rather than patched one at a time.
  
  **`check`** — one judgment per decision, so the faces cannot disagree:
  
  - a `.ts` constructor annotation (including parameter properties) is now the instance field's domain, so `constructor(private size: number)` + `area() { return this.size * this.size }` reports `number` instead of an `any`-arithmetic `nudo:entry-may-throw` error while the dts face already said `number`;
  - definite throws during module initialization are detected: BigInt/Number mixing, division by a BigInt zero, `in` on a primitive right-hand side, and calling a member an object literal does not have;
  - the call-site local binding table records every declaration shape (parameters, `catch`, `for-of`/`in`, `let`/`var`, destructuring) as an explicit "no information" entry, so shadowing no longer reads the module-level `const` (false red) and destructured declarations reach the obligation check (false green);
  - a classic `for (const i = 0; …; i++)` head is a `const` again, so the always-throwing step is reported instead of staying green;
  - `nudo:capability-denied` joins the check-face diagnostic whitelist, so `nudo check` can report the cause of `unknown` like `nudo test` — gated on the report actually showing an inference failure (`nudo:unknown-inference`), so a plain `module.exports = …` file does not grow a warning about the `module` global while the same exports written as `exports.x` report nothing.
  - cross-file evidence from `--from` now resolves the default export name on both sides, so a renamed default import, `import { default as g }` and `ns.default(...)` are no longer silently dropped.
  
  **`nudo export`** — the publish gate is a semantic judgment (`degraded evidence on the published surface AND a declared contract`) instead of a three-code whitelist, with declaration truth taken from `effectiveContract`'s own resolution. Contract-face diagnostics always block; general degradation (`nudo:internal` / `nudo:unknown-inference`) blocks only when it is attributed to an entry that declared a contract (or carries no function, i.e. is module-level). Compatibility: a module whose contract fails to parse (`nudo:contract-syntax`) now blocks the export (exit 1, no artifacts, diagnostics surfaced) instead of publishing an "accepts everything" validator with exit 0; unannotated modules — and unannotated sibling entries — keep publishing and only see the degradation surfaced.
  
  **dts projection** — one resolvability predicate for type names (TS tokens, runtime globals, local classes, mirrored `interface`/`type`, imported names) plus the missing branches it exposed: `export =` for single-value CJS modules, member-wise types for `export default {…}` and arrays, real re-export statements for imported bindings, `extends`/type-parameter clauses on namespace members, and destructured parameters that render as a pattern the source can actually write. Compatibility: `<fn>Input` keys a destructured parameter by its field names rather than the internal `_p0` placeholder, which is not a public name and made the published validator reject the only legal call shape. Two boundaries are pinned: a module that exports a type (`export interface` / `export type`) alongside `module.exports = value` keeps the named-export projection (TS forbids `export =` next to any other exported element, which would make the artifact uncompilable), and an unannotated class getter whose body has more than one `return` projects `unknown` instead of the first return's type (a single-return pick would be narrower than the runtime value).
  
  **LSP** — completion decides the lexical context with a per-character scanner (line and block comments, quotes, templates with `${}` nesting, regex bodies and character classes), so a continuation line inside a multi-line template or comment no longer offers rewrites of the literal; member completion merges the instance/static class member table from core's single class-body scan.
  
  The `check` entry census behind these runs on the semantic binding index (ADR 0001 stage 1), and stage 1 slice 4.3 replaces the publish gate's shadow comparison with the semantic verdict it was measuring. The public `.` export surface is unchanged.
- 161d156: Switch the `check` entry census to the semantic binding index by default (ADR 0001 stage 1, slice 3). This closes the audit's false-green export shapes: destructured exports, default object literals, anonymous default classes, CJS / ESM class expressions are now real entries. Two index-precision fixes land with it: getters / setters are no longer treated as callable entries, and nested function declarations are no longer mistaken for module-level entries (previously produced false `nudo:opaque-result`). The legacy census remains reachable via an internal fallback switch, and the index-face state is part of the check memo and service file/function cache keys so flipping it cannot replay stale results. The public `.` export surface is unchanged. Stage 1 slice 4.1 adds an internal, off-by-default publish-gate shadow comparison between the existing diagnostic-code whitelist and the typed `Evidence` verdict; it only records divergences and does not change any export decision. Stage 1 slice 4.2 switches only the **diagnostic surface**: `nudo export` now prints degraded evidence codes (`nudo:internal`, `nudo:unknown-inference`, …) instead of silently dropping them; blocking and exit codes still follow `EXPORT_BLOCKING_CODES`, so no export decision changes.

更早版本（62）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.12.3 {#pkg-service}

## 1.12.3

### Patch Changes

- 795e322: Close the 34 bugs from the ABS-15 audit, grouped by root cause rather than patched one at a time.
  
  **`check`** — one judgment per decision, so the faces cannot disagree:
  
  - a `.ts` constructor annotation (including parameter properties) is now the instance field's domain, so `constructor(private size: number)` + `area() { return this.size * this.size }` reports `number` instead of an `any`-arithmetic `nudo:entry-may-throw` error while the dts face already said `number`;
  - definite throws during module initialization are detected: BigInt/Number mixing, division by a BigInt zero, `in` on a primitive right-hand side, and calling a member an object literal does not have;
  - the call-site local binding table records every declaration shape (parameters, `catch`, `for-of`/`in`, `let`/`var`, destructuring) as an explicit "no information" entry, so shadowing no longer reads the module-level `const` (false red) and destructured declarations reach the obligation check (false green);
  - a classic `for (const i = 0; …; i++)` head is a `const` again, so the always-throwing step is reported instead of staying green;
  - `nudo:capability-denied` joins the check-face diagnostic whitelist, so `nudo check` can report the cause of `unknown` like `nudo test` — gated on the report actually showing an inference failure (`nudo:unknown-inference`), so a plain `module.exports = …` file does not grow a warning about the `module` global while the same exports written as `exports.x` report nothing.
  - cross-file evidence from `--from` now resolves the default export name on both sides, so a renamed default import, `import { default as g }` and `ns.default(...)` are no longer silently dropped.
  
  **`nudo export`** — the publish gate is a semantic judgment (`degraded evidence on the published surface AND a declared contract`) instead of a three-code whitelist, with declaration truth taken from `effectiveContract`'s own resolution. Contract-face diagnostics always block; general degradation (`nudo:internal` / `nudo:unknown-inference`) blocks only when it is attributed to an entry that declared a contract (or carries no function, i.e. is module-level). Compatibility: a module whose contract fails to parse (`nudo:contract-syntax`) now blocks the export (exit 1, no artifacts, diagnostics surfaced) instead of publishing an "accepts everything" validator with exit 0; unannotated modules — and unannotated sibling entries — keep publishing and only see the degradation surfaced.
  
  **dts projection** — one resolvability predicate for type names (TS tokens, runtime globals, local classes, mirrored `interface`/`type`, imported names) plus the missing branches it exposed: `export =` for single-value CJS modules, member-wise types for `export default {…}` and arrays, real re-export statements for imported bindings, `extends`/type-parameter clauses on namespace members, and destructured parameters that render as a pattern the source can actually write. Compatibility: `<fn>Input` keys a destructured parameter by its field names rather than the internal `_p0` placeholder, which is not a public name and made the published validator reject the only legal call shape. Two boundaries are pinned: a module that exports a type (`export interface` / `export type`) alongside `module.exports = value` keeps the named-export projection (TS forbids `export =` next to any other exported element, which would make the artifact uncompilable), and an unannotated class getter whose body has more than one `return` projects `unknown` instead of the first return's type (a single-return pick would be narrower than the runtime value).
  
  **LSP** — completion decides the lexical context with a per-character scanner (line and block comments, quotes, templates with `${}` nesting, regex bodies and character classes), so a continuation line inside a multi-line template or comment no longer offers rewrites of the literal; member completion merges the instance/static class member table from core's single class-body scan.
  
  The `check` entry census behind these runs on the semantic binding index (ADR 0001 stage 1), and stage 1 slice 4.3 replaces the publish gate's shadow comparison with the semantic verdict it was measuring. The public `.` export surface is unchanged.
- 161d156: Switch the `check` entry census to the semantic binding index by default (ADR 0001 stage 1, slice 3). This closes the audit's false-green export shapes: destructured exports, default object literals, anonymous default classes, CJS / ESM class expressions are now real entries. Two index-precision fixes land with it: getters / setters are no longer treated as callable entries, and nested function declarations are no longer mistaken for module-level entries (previously produced false `nudo:opaque-result`). The legacy census remains reachable via an internal fallback switch, and the index-face state is part of the check memo and service file/function cache keys so flipping it cannot replay stale results. The public `.` export surface is unchanged. Stage 1 slice 4.1 adds an internal, off-by-default publish-gate shadow comparison between the existing diagnostic-code whitelist and the typed `Evidence` verdict; it only records divergences and does not change any export decision. Stage 1 slice 4.2 switches only the **diagnostic surface**: `nudo export` now prints degraded evidence codes (`nudo:internal`, `nudo:unknown-inference`, …) instead of silently dropping them; blocking and exit codes still follow `EXPORT_BLOCKING_CODES`, so no export decision changes.
- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1
  - @nudojs/env@0.5.11
  - @nudojs/harvester@0.6.3
  - @nudojs/parser@1.5.11

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.9.3 {#pkg-nudojs}

## 1.9.3

### Patch Changes

- 795e322: Close the 34 bugs from the ABS-15 audit, grouped by root cause rather than patched one at a time.
  
  **`check`** — one judgment per decision, so the faces cannot disagree:
  
  - a `.ts` constructor annotation (including parameter properties) is now the instance field's domain, so `constructor(private size: number)` + `area() { return this.size * this.size }` reports `number` instead of an `any`-arithmetic `nudo:entry-may-throw` error while the dts face already said `number`;
  - definite throws during module initialization are detected: BigInt/Number mixing, division by a BigInt zero, `in` on a primitive right-hand side, and calling a member an object literal does not have;
  - the call-site local binding table records every declaration shape (parameters, `catch`, `for-of`/`in`, `let`/`var`, destructuring) as an explicit "no information" entry, so shadowing no longer reads the module-level `const` (false red) and destructured declarations reach the obligation check (false green);
  - a classic `for (const i = 0; …; i++)` head is a `const` again, so the always-throwing step is reported instead of staying green;
  - `nudo:capability-denied` joins the check-face diagnostic whitelist, so `nudo check` can report the cause of `unknown` like `nudo test` — gated on the report actually showing an inference failure (`nudo:unknown-inference`), so a plain `module.exports = …` file does not grow a warning about the `module` global while the same exports written as `exports.x` report nothing.
  - cross-file evidence from `--from` now resolves the default export name on both sides, so a renamed default import, `import { default as g }` and `ns.default(...)` are no longer silently dropped.
  
  **`nudo export`** — the publish gate is a semantic judgment (`degraded evidence on the published surface AND a declared contract`) instead of a three-code whitelist, with declaration truth taken from `effectiveContract`'s own resolution. Contract-face diagnostics always block; general degradation (`nudo:internal` / `nudo:unknown-inference`) blocks only when it is attributed to an entry that declared a contract (or carries no function, i.e. is module-level). Compatibility: a module whose contract fails to parse (`nudo:contract-syntax`) now blocks the export (exit 1, no artifacts, diagnostics surfaced) instead of publishing an "accepts everything" validator with exit 0; unannotated modules — and unannotated sibling entries — keep publishing and only see the degradation surfaced.
  
  **dts projection** — one resolvability predicate for type names (TS tokens, runtime globals, local classes, mirrored `interface`/`type`, imported names) plus the missing branches it exposed: `export =` for single-value CJS modules, member-wise types for `export default {…}` and arrays, real re-export statements for imported bindings, `extends`/type-parameter clauses on namespace members, and destructured parameters that render as a pattern the source can actually write. Compatibility: `<fn>Input` keys a destructured parameter by its field names rather than the internal `_p0` placeholder, which is not a public name and made the published validator reject the only legal call shape. Two boundaries are pinned: a module that exports a type (`export interface` / `export type`) alongside `module.exports = value` keeps the named-export projection (TS forbids `export =` next to any other exported element, which would make the artifact uncompilable), and an unannotated class getter whose body has more than one `return` projects `unknown` instead of the first return's type (a single-return pick would be narrower than the runtime value).
  
  **LSP** — completion decides the lexical context with a per-character scanner (line and block comments, quotes, templates with `${}` nesting, regex bodies and character classes), so a continuation line inside a multi-line template or comment no longer offers rewrites of the literal; member completion merges the instance/static class member table from core's single class-body scan.
  
  The `check` entry census behind these runs on the semantic binding index (ADR 0001 stage 1), and stage 1 slice 4.3 replaces the publish gate's shadow comparison with the semantic verdict it was measuring. The public `.` export surface is unchanged.
- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1
  - @nudojs/service@1.12.3
  - @nudojs/env@0.5.11
  - @nudojs/harvester@0.6.3
  - @nudojs/parser@1.5.11

更早版本（61）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.11 {#pkg-parser}

## 1.5.11

### Patch Changes

- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1

更早版本（61）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.10.3 {#pkg-lsp}

## 1.10.3

### Patch Changes

- 795e322: Close the 34 bugs from the ABS-15 audit, grouped by root cause rather than patched one at a time.
  
  **`check`** — one judgment per decision, so the faces cannot disagree:
  
  - a `.ts` constructor annotation (including parameter properties) is now the instance field's domain, so `constructor(private size: number)` + `area() { return this.size * this.size }` reports `number` instead of an `any`-arithmetic `nudo:entry-may-throw` error while the dts face already said `number`;
  - definite throws during module initialization are detected: BigInt/Number mixing, division by a BigInt zero, `in` on a primitive right-hand side, and calling a member an object literal does not have;
  - the call-site local binding table records every declaration shape (parameters, `catch`, `for-of`/`in`, `let`/`var`, destructuring) as an explicit "no information" entry, so shadowing no longer reads the module-level `const` (false red) and destructured declarations reach the obligation check (false green);
  - a classic `for (const i = 0; …; i++)` head is a `const` again, so the always-throwing step is reported instead of staying green;
  - `nudo:capability-denied` joins the check-face diagnostic whitelist, so `nudo check` can report the cause of `unknown` like `nudo test` — gated on the report actually showing an inference failure (`nudo:unknown-inference`), so a plain `module.exports = …` file does not grow a warning about the `module` global while the same exports written as `exports.x` report nothing.
  - cross-file evidence from `--from` now resolves the default export name on both sides, so a renamed default import, `import { default as g }` and `ns.default(...)` are no longer silently dropped.
  
  **`nudo export`** — the publish gate is a semantic judgment (`degraded evidence on the published surface AND a declared contract`) instead of a three-code whitelist, with declaration truth taken from `effectiveContract`'s own resolution. Contract-face diagnostics always block; general degradation (`nudo:internal` / `nudo:unknown-inference`) blocks only when it is attributed to an entry that declared a contract (or carries no function, i.e. is module-level). Compatibility: a module whose contract fails to parse (`nudo:contract-syntax`) now blocks the export (exit 1, no artifacts, diagnostics surfaced) instead of publishing an "accepts everything" validator with exit 0; unannotated modules — and unannotated sibling entries — keep publishing and only see the degradation surfaced.
  
  **dts projection** — one resolvability predicate for type names (TS tokens, runtime globals, local classes, mirrored `interface`/`type`, imported names) plus the missing branches it exposed: `export =` for single-value CJS modules, member-wise types for `export default {…}` and arrays, real re-export statements for imported bindings, `extends`/type-parameter clauses on namespace members, and destructured parameters that render as a pattern the source can actually write. Compatibility: `<fn>Input` keys a destructured parameter by its field names rather than the internal `_p0` placeholder, which is not a public name and made the published validator reject the only legal call shape. Two boundaries are pinned: a module that exports a type (`export interface` / `export type`) alongside `module.exports = value` keeps the named-export projection (TS forbids `export =` next to any other exported element, which would make the artifact uncompilable), and an unannotated class getter whose body has more than one `return` projects `unknown` instead of the first return's type (a single-return pick would be narrower than the runtime value).
  
  **LSP** — completion decides the lexical context with a per-character scanner (line and block comments, quotes, templates with `${}` nesting, regex bodies and character classes), so a continuation line inside a multi-line template or comment no longer offers rewrites of the literal; member completion merges the instance/static class member table from core's single class-body scan.
  
  The `check` entry census behind these runs on the semantic binding index (ADR 0001 stage 1), and stage 1 slice 4.3 replaces the publish gate's shadow comparison with the semantic verdict it was measuring. The public `.` export surface is unchanged.
- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1
  - @nudojs/service@1.12.3
  - @nudojs/parser@1.5.11

更早版本（65）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.11 {#pkg-env}

## 0.5.11

### Patch Changes

- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1

更早版本（61）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.6.3 {#pkg-harvester}

## 0.6.3

### Patch Changes

- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1
  - @nudojs/env@0.5.11
  - @nudojs/parser@1.5.11

更早版本（61）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.7.4 {#pkg-vite-plugin}

## 0.7.4

### Patch Changes

- Updated dependencies [795e322]
- Updated dependencies [161d156]
  - @nudojs/core@1.20.1
  - @nudojs/service@1.12.3

更早版本（64）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
