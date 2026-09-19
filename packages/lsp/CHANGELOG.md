# @nudojs/lsp

## 1.0.0

### Major Changes

- 69ebbf6: Align product surface with interface-first design: `@nudo:case` is debug / `nudo test` only, and the `T.*` directive grammar is removed.

  - Directive type expressions accept constraint builders (`number()`, `lit()`, `shape()`, `union()`, `array()`, `any()`, …) and concrete literals only. Bare `T.*` parses as unknown; `parseTypeValueExpr` is no longer exported — use `parseCaseArgExpr`.
  - `serializeCaseArg` / `--emit-cases` emit builders (`number()`, `union(…)`) instead of `T.*`.
  - LSP `typeExprToDirective` emits builders (`number()`, `union(…)`, `any()`).
  - CLI `infer` reports call-site facts (`call@L…`) and `debug "name"` witnesses with `Observed:` joins — not `Case "…"` / `Combined:` as the type product. Contracts stay on `*.nudo.js` / `@nudo:refine`.
  - Constraint builders accept concrete nested literals so directive grammar round-trips.

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/parser@1.0.0
  - @nudojs/service@4.0.0
  - @nudojs/core@2.1.0

## 0.8.1

### Patch Changes

- 9731238: **BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This is the documented B8 priority — harvest only fills missing slots — but analysis results on projects that relied on harvest overwriting a handwritten env export will change.

  Migration: remove or update the conflicting handwritten `@nudojs/env` slot if you needed harvest's version; otherwise no code change. Conflicts emit a `nudo:env-harvest-conflict` warning listing overwritten module/export names.

  Also in this service major (additive public surface, riding the required major for the priority change):

  - Public harvest helpers: `mergeHarvestUnderEnv` (optional per-call `onConflict`), `setEnvHarvestConflictCollector` (returns previous; save/restore for nested analysis), `getEnvHarvestConflictCollector`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached. `clearNodeHarvestCache()` also drops `not-found` misses so a later `@types/node` install is visible in-process. `nudo:env-harvest-conflict` warnings point at the conflicting import specifier when found (file-level `line 0` otherwise).
  - `@nudojs/env` (minor): `events` / `stream` / `querystring`; high-frequency `util` slots; **Promise APIs only under `fs.promises` / `node:fs/promises`** (callback-style `fs.readFile` etc. no longer pretend to return Promise). Optional Node params (`path.basename` ext, `url.URL` base) keep typed labels (`ext?: string`) but are **not** required slots — `requiredFnArity` skips `?` / `...`.
  - `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`) as `...name: T` / `name?: T`. `leqAbs` fn arity uses **required** slots only (`requiredFnArity` skips `...rest` / `name?`): src is assignable to tgt iff `src.required ≤ tgt.required` (TS-like — rest src ⊑ required tgt; required src ⊭ rest tgt when src requires args). Pairwise `paramTypes` contravariance is unchanged.
  - `@nudojs/lsp` (patch): freeze inventory in `public-api.ts` (also exported as `@nudojs/lsp/public-api`); agent slash requests register from `NUDO_AGENT_TOOL_NAMES`; `selectCase` / `getActiveCases` are editor executeCommand + slash-only (not dot-form custom requests).

  Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts (empty `{  }` shapes are not leaf-clean) over raw resolved ratios.

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1
  - @nudojs/service@3.0.0
  - @nudojs/parser@0.5.1

## 0.8.0

### Minor Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0
  - @nudojs/service@2.0.0
  - @nudojs/parser@0.5.0

## 0.7.1

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1
  - @nudojs/parser@0.4.2
  - @nudojs/service@1.0.1

## 0.7.0

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudo`（`bin` 委托 `@nudojs/cli`）

### Patch Changes

- a2aac9e: Final review pass on feat/interface Phase 1:

  - **LSP emit bound live**: `handleInterfaceEmit` now passes `agentToolDeps` so `workspaceRoots` reach `assertEmitTargetAllowed` (was dead in production).
  - **Emit fail-closed**: empty `workspaceRoots` rejects; no ancestor-`package.json` authorization fallback; `realpath` blocks symlink escape; refuse writes under `node_modules`.
  - **autoBind kill-switch complete**: threaded through scan `generalizeFromAst` / same-file `eiOpts`; empty `fromFile` no longer ambient-binds `.nudo.js`.
  - **Conflict skip**: conflicted params no longer also emit call-site `constraint-violated`; detect eq/eq and eq/bound unsat.
  - **Return contracts**: string length bounds (`string().min/max`) enforced via domain membership.
  - **Perf/stability**: file-local `effectiveInterface` memo in check; `take*Since` on memo hit/miss (no LSP diag theft); `shift` rejects non-finite offsets; `@generated` marker requires adjacent comment block; add-mode empty targets no longer rewrite trailing whitespace; emit tmp name randomized.

- de47d84: Review fixes on feat/interface Phase 1:

  - **autoBind kill-switch**: analyzer's cross-file `nudo:interface-domain-exceeds` path now reads `package.json#nudo.interface.autoBind` (was silently ambient-loading sidecars when `autoBind: false`).
  - **`nudo check --callsites`**: inject usage-site call records so CI gate can surface `nudo:interface-domain-exceeds` (previously only reachable via analyze/interface paths).
  - **Sidecar auto-bind coverage**: `localNamedExports` accepts local `export { x }` / `export { local as exported }` list form (was declaration-only; silent miss for common style).
  - **Directory targets**: `isNudoTargetPath` excludes `*.nudo.js` / `*.nudo.ts` so check/infer/doctor no longer treat contract modules as source.
  - **VS Code client**: documentSelector includes TypeScript; file watcher covers `**/*.{js,mjs,ts}` (includes `.nudo.ts` sidecars).
  - **LSP emit**: failed `interfaceEmit` no longer claims "sidecar written" and skips the invalidation path.
  - **UX**: first `--emit` with empty default targets prints a `--fn`/`--all` tip; `--fn`/`--all` without `--emit` warn; CodeLens titles use "interface" not "refine"; domain-exceeds message is English (matches other diagnostics).

- 78f6752: Fix hover, case switching, and NaN folding in Zed-style clients.

  - `const n = double(21)` reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - Relational compare folds mixed concrete lits (`"a" > 3` → false), so `if (x > 3)` does not join both branches for NaN inputs.
  - `joinValues` uses `Object.is` so `join(NaN, NaN)` stays `NaN` (`NaN === NaN` is false).
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`).
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes.
  - Param inlay no longer invents `where x > 3` from `if (x > 3) return x` — only explicit `@nudo:refine` contracts show as preconditions.
  - Return inlay is a path summary with source param names: `x + 1`, `x | x * 2` (not the refined `number where x>3 | string | …` dump).
  - Number range narrowing uses exclusive bounds (`> 3`, not integer-style `>= 4`).
  - Concrete `if` tests no longer narrow the tested value into a range (`44 > 3` keeps `x` as `44`).
  - True branch of `x > k` on unknown refines to `number>… | string` (JS ToNumber space).
  - `flattenSum` keys prim members by term/pred so `number=A1>3` and `number=A1*2` stay distinct paths.

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0
  - @nudojs/service@1.0.0
  - @nudojs/parser@0.4.1

## 0.6.0

### Minor Changes

- 1d6bb01: - dist 产物自包含（同 cli：@nudojs/\* 源码进 bundle、splitting:false、banner 补齐）
  - 自定义请求别名同时注册 `nudo/<tool>` 与 `nudo.<tool>` 两种拼写（后者与 executeCommand 命令名一致，供 MCP 桥接客户端复用）
  - 跨文件 definition：本地声明与 import 绑定都未命中时，新增工作区导出回退扫描（同名导出定义，≤200 文件 + 会话已知文件），修复解构注入参数（`computeScorecard({…})` 形参）无法跳转的问题；rename 刻意不接此回退（重命名必须绑定真实绑定点）
  - 附带回归测试：export 形式 refine、跨文件定义回退、早返回折叠

### Patch Changes

- 1d233a7: Fix hover and CodeLens case switching in Zed-style clients, and fold JS ToNumber for `- * / %`.

  - `const n = double(21)` now reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`), not only the agent object form.
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes, so selecting a case actually changes the shown types.

- Updated dependencies [1d6bb01]
- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0
  - @nudojs/parser@0.4.0
  - @nudojs/service@0.3.2

## 0.5.0

### Minor Changes

- 4a43e10: Add a `nudo-lsp` bin (shebang on `dist/server.js`) and default to stdio when the host did not pass a transport flag (`--stdio` / `--node-ipc` / `--socket=`). Editors and agent bridges can launch the server as a bare command (`nudo-lsp`, `node dist/server.js`) instead of `tsx` + `src/server.ts`. The [Zed extension](https://github.com/nudojs/nudo-zed) uses this path.

## 0.4.1

### Patch Changes

- 34b246c: Implement textDocument/documentSymbol and workspace/symbol; make definition, references, and rename follow relative imports across files so go-to-definition on an imported symbol lands in the defining module and rename/references include importer call sites.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/service@0.3.1
  - @nudojs/parser@0.3.1

## 0.4.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0
  - @nudojs/parser@0.3.0

## 0.3.0

### Minor Changes

- 0fd0718: Merge the three environment packages into one: `@nudojs/env-es`, `@nudojs/env-web`, `@nudojs/env-node` are replaced by a single `@nudojs/env` package with subpath exports `@nudojs/env/es`, `@nudojs/env/web`, `@nudojs/env/node`.

  Move agent-facing tools from the standalone MCP server into the language server: `@nudojs/mcp` is removed. `@nudojs/lsp` now exposes `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.selectCase`, and `nudo.getActiveCases` via `workspace/executeCommand` (custom-request aliases `nudo/whatIf` etc. included), adds pull-mode diagnostics, and works on files that are not open in the editor (disk fallback). `nudo.whatIf` now actually applies the given type bindings — previously they were ignored. AI agents connect through any LSP↔MCP bridge (cclsp, mcpls, agent-lsp) or a native LSP client; an installable agent skill ships at `packages/lsp/agent-skill/SKILL.md`.

### Patch Changes

- @nudojs/service@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/core@0.2.0
  - @nudojs/service@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
  - @nudojs/service@0.1.0
