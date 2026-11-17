# CLAUDE.md

<!-- CLI semantics: docs/design/cli-semantics.md — primary verbs check/test/contract/export/health. migrate = one-way TypeScript retirement gate (status|strip|verify|retire), not a primary verb. Harvest is not a product verb. -->

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Nudo

Nudo is a type inference engine for JavaScript powered by abstract interpretation. The **type system is Abs** (`shape × term × pred × conf`) — types are computable values with constraints that participate in algebra (`x>0` ⇒ `x+1>1`). There is no second IR: production analysis is **Abs-native**, and dts/LSP/serialization consume Abs directly through one-way, lossy extensional rendering (`formatShape`, `absToTSType`, `absToSchemaSource` / `projectAbsToSchema`).

Users annotate JS with `@nudo:` directives. Source-level contracts use `@nudo:contract` + `*.nudo.js` templates (constraint-builder grammar: `number()`, `lit()`, `shape()`, `union()`, …). `@nudo:case` is debug / `nudo test` / LSP scenario only — not the contract product. Case args use concrete values or constraint builders.

Product CLI face (`docs/design/cli-semantics.md`): primary verbs are `check` / `test` / `contract` / `export` / `health` — Day0 = `check` + `test`; Day1 = `contract` + `check`; ecosystem = `export`. `migrate` is a one-way TypeScript retirement gate (`status|strip|verify|retire`), not a primary verb. Observation is check signatures + test case reports + IDE. Entry unconstrained params display as **`any`**; true **`unknown`** means inference failure.

## Development Commands

```bash
pnpm install            # Install dependencies (requires pnpm@11.28.0, see packageManager)
pnpm run build          # Build all packages with tsup
pnpm run test           # Run all tests (vitest run)
pnpm run test:local     # Lanes: --changed (inner) / --fast (no e2e/oracle) / --e2e / --oracle / full
pnpm run test:watch     # Run tests in watch mode
pnpm run lint           # Type-check all packages (tsc --noEmit -p tsconfig.lint.json)
pnpm run check:diff-face  # 加法成本门禁（净增/新增源码或测试文件 → 任务书理由；默认 base origin/main）
pnpm run check <file>   # gate + signatures (Day 0 / CI)
pnpm run test:cli <file>  # case reports (call@/entry@ + debug witnesses)
pnpm run nudo -- <args>  # full CLI (contract / export / health / migrate / …)
pnpm run docs:dev       # Docs dev (en) — http://localhost:3000/nudo/
pnpm run docs:dev:zh    # Docs dev (zh-Hans) — http://localhost:3000/nudo/zh-Hans/
pnpm run docs:build     # Docs production build (en + zh-Hans)
pnpm run docs:serve     # Serve production build (both locales)
```

> **Build before test.** Always `pnpm run build` before `pnpm run test` (CI does the same). Vitest aliases packages to `src`, but `@nudo:env` dynamic imports resolve `@nudojs/*` through package.json `exports` to `dist/` — without a build those imports fail.
>
> `pnpm run test` is **vitest** (package tests), not the CLI case reporter — that is `test:cli`. Product CLI surface: `check` / `test:cli` / `nudo -- contract|export|health|migrate`.
>
> Docusaurus `start` serves **one locale per process**. Default `docs:dev` is English only, so `/nudo/zh-Hans/` will 404 until you run `docs:dev:zh` (or `docs:build` + `docs:serve`).
>
> **`scripts/` 与 npm 入口纪律**（索引 `scripts/README.md`）：一次性分析/实验/迁移脚本**不提交**（`/tmp` 里跑，结论落 `docs/` 或测试）；入库脚本必须有常驻触发方并在索引登记一行；`package.json#scripts` 只收 CI 调用 / `docs/examples` 矩阵 / 高频主入口，其余用 `node scripts/…` 直调，同义别名一律合并。

Run a single test file: `pnpm vitest run packages/core/src/algebra/__tests__/check-gold.test.ts`

## Monorepo Structure

pnpm workspaces monorepo. Dependency graph (arrows mean "depends on"):

```
parser ──────┐
env ─────────┼→ core
harvester ───┘

service → core, parser, env, harvester
nudojs  → core, parser, service, harvester   (product CLI, bin `nudo`)
lsp     → service, core, parser
vite-plugin → core, service
```

Product CLI lives in `packages/nudojs` (published as `nudojs`, bin `nudo`). The former `@nudojs/cli` forward stub (`packages/cli`) has been removed — do not reintroduce a shell package.

| Package | Purpose |
|---|---|
| `packages/core` | **Type system**: algebra/Abs (term, pred, check, leq, exec/transpile, surface, arithmetic), format (extensional rendering), environment, refinements, contract (sidecar/effectiveContract/projection) |
| `packages/parser` | Babel-based parser; extracts function-scoped `@nudo:` directives from JSDoc |
| `packages/service` | Analysis core: analyzer orchestration, Abs-native evaluator, session caches |
| `packages/service` (…/emit) | Emit products are `@nudojs/service/emit` (contract/dts/schema/guard/case) |
| `packages/nudojs` | The `nudo` CLI (check/test/contract/export/health/migrate), published as `nudojs` |
| `packages/lsp` | IDE surface (hover/completions/semantic tokens) + LSP server |
| `packages/env` | ES / Web / Node API type definitions (`@nudojs/env`) |
| `packages/harvester` | Harvest `@types` → Abs env (env-package authoring + analysis auto-fill; not a CLI verb) |
| `packages/vite-plugin` | Vite plugin for build-time inference |
| `packages/vscode` | VS Code extension (private, launches LSP server) |
| `packages/website` | Docusaurus docs site (private) |

## Architecture

> 2026-11-05：`algebra/` 顶层 93 个平铺 `.ts` 中的 50 个已归入
> `check/ scan/ format/ contract/ diagnostics/ key/` 六个二级子域（一次性 codemod，
> 795 处相对导入机械重写；脚本已随迁移结案移出仓库）。剩余 43 个
> 顶层文件由 `pnpm run lint:hygiene`（`check-core-subdomains`）冻结，新模块一律进已有子域。
> `scripts/aggregate-tests.mjs` 可按族收敛测试入口，但全量试点发现同一聚合
> 入口内 part 共享模块实例会污染全局状态 ⇒ 已回滚；只允许逐族验证后启用。

**Type system core** (`core/src/algebra`): Abs = shape × term × pred × conf. Term is abstract value identity (lit/var/app); Pred is constraint relative to term; conf is exact/path/widened/partial/opaque. Primary entrypoints: `checkSource` (refinement gate), `analyzeFn` / `runTranspiled` (Abs evaluation), `leqAbs` (structural assignability), `generalizeFromAst` (symbolic α). See `docs/design/kernel-merge.md`.

**Extensional rendering** (`core/src/algebra/format.ts`): `formatShape` (display strings), `formatAbs` (lossless). One-way projections: `absToTSType` / `absToSchemaSource` / `projectAbsToSchema` / guard generators consume Abs directly. Nothing reads a projection back.

**Parser** (`parser`): Uses `@babel/parser` with TypeScript+JSX plugins. Extracts function/file directives: `@nudo:case` (debug witnesses), `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:env`, `@nudo:mock-module`, `@nudo:as`, `@nudo:replace`. Type expressions parse via `parseCaseArgExpr` only (constraint builders + concrete literals; no `T.*`). File-level `@nudo:import`, function-level `@nudo:contract`, function-level `@nudo:assume <name> <= <name>` (user lemma premises over params or top-level locals, #152 — cross-variable bounds for relational div/sub folding, `nudo:assume-invalid`/`nudo:assume-relied` diagnostics), and function-level `@nudo:invariant <name><path> <rel> <number>` (loop-carried bound lemmas over params or top-level locals, #176 — enforced at loop join/widen on the binding pack, `nudo:invariant-invalid`/`nudo:invariant-relied` diagnostics) are parsed in **core** (`algebra/refine.ts`), not the parser package.

**Evaluator** (`service/src/evaluator`): Abs-native production evaluation. **Single engine** (`service/src/eval-run.ts` + `core/algebra/exec`: transpile → `new Function` with Abs values). Arithmetic/compare/unary/spread route through the algebra (`surface.ts`, `arithmetic.ts`, `objects.ts`). Non-eval sources / eval failure are **fail-closed** (unknown/empty exports). Top-level `this` follows ESM (read → undefined; write → TypeError). `CallRecord` is Abs-only (`resultAbs`/`argsAbs`). Public API: `@nudojs/service/evaluator`.

**Service** (`service`): `analyzer.ts` orchestrates parse → directives → evaluate → diagnostics. Evaluation is **Abs-native, single engine**. Modules via `evalAbsModuleGraph`（named/default/namespace、re-export/`export *`、require、harvest、@nudo:env）。Class bridge: `$class` / `registerEvalClass` → `exec/class-registry` → `$new`。`dts-generator.ts` projects Abs → TypeScript (`Case:` JSDoc rows are debug extensional notes, not the contract product). CLI `test` prints call@/entry@ cases and `debug "name"` witnesses; `check` prints signatures (always, even on success).

**Check product**: `nudo check` is the CI gate — Pred implication on Abs, Nudo-native reports (`actual ⊭ expected`); L1 = explicit contracts (`*.nudo.js` / `@nudo:contract`); L2 = entry may-throw (`nudo:entry-may-throw`, default error; `--ignore-throws` / `package.json#nudo.check.ignoreThrows`). Signatures always printed; unconstrained entry params display as **`any`**, not `unknown`. Gold gates: recall=precision=1.0 and real-package zero-FP tests in `core/src/algebra/__tests__/` (L2 suites need split expectations when ignore is off).

## Code Conventions

- All ESM (`"type": "module"` everywhere)
- Imports use `.ts` extensions (e.g., `import { formatShape } from "./format.ts"`) — enabled by `allowImportingTsExtensions`; source-level imports stay `.ts` even though published output is `.js`
- Package `exports` point to `./dist/*` built output (tsup); `files: ["dist"]` on published packages
- No ESLint/Prettier — linting is type-checking only (`tsc --noEmit`)
- Tests live in `__tests__/` dirs alongside source, named `*.test.ts`
- Test harness is shared per package — don't re-inline copies in test files: core `__tests__/eval-helpers.ts` (call/isNever/throwsError/effects) + `nudo-constraints.ts` (l2Count/sigOf/issuesOf/makeFiles/sidecarOpts), service `__tests__/tmp-project.ts` + `emit/__tests__/fixtures.ts`, nudojs `__tests__/helpers/run-cli.ts`, lsp `__tests__/helpers.ts`, core `__tests__/differential/all-batches.ts`
- Test files use `describe`/`it`/`expect` from vitest
- Versioning via @changesets/cli with public access, base branch `main`

## Test Design (product modules, not bug ledgers)

Tests are the executable spec of a **product module/face**, not a ledger of historical bugs.

- **Ownership**: one suite per module/face; file name describes the module/face, never a bug or plan code. Defect IDs belong only in `it` titles, commits, changesets.
- **Matrix first**: encode the contract as a table of `(axis combination → observable)`: input/Abs shape × operation × expected value / diagnostic / exit / guard / runtime acceptance. Every row asserts a concrete observable, never just “no throw”.
- **Oracle anchoring**: use real runtime / `tsc` / CLI output as the oracle where possible. Exact product surfaces (signatures, diagnostics, exit codes, dts text) are contracts; internal helper names are not, unless explicitly a cache/determinism contract.
- **Bug intake**: before adding a case, answer “why didn’t the existing matrix catch it?” — missing axis → add rows/dimension; fixture-shape gap → extend the fixture space; old assertion wrong → replace/delete it; gate/path not executed → fix the gate. If the case only restates an existing row, do not add it.
- **Merge, then delete**: when a matrix row absorbs a bug-specific case (same invariant, same or stronger assertions), delete the old case in the same change. Keep a standalone case only for a distinct contract face that cannot be tabulated (brand/exotic objects, `tsc` compile gates, process/fs layout, native oracles with incompatible harnesses).
- **Deletion discipline**: delete only exact duplicates or assertions of wrong behavior; record evidence in the commit message (`dup:` / `incorrect:` + commit). No silent deletion and no assertion weakening.
- **No bug-only suites**: provenance may stay in `it` titles, but the structure must be module contract; new bug-number/plan-code file names are rejected by `scripts/check-test-names.mjs`.
- **Axis growth, not prose growth**: extend tables by adding an axis or boundary value, not by re-stating the same invariant in new prose. Suites that are entirely one-off narratives should be collapsed into `it.each`.
- **The matrix is the map, not the deliverable**: it locates coverage; deletion evidence lives in commits. Product tests are the deliverable. A module is not “audited” by adding keep rows only.
- **Verification**: targeted suite + `pnpm run lint:tests`; per batch run full `pnpm exec vitest run --maxWorkers=4` and `pnpm run test:baseline -- <log>`.

## Diff 面纪律（加法成本）

加法默认免费会累积成臃肿。本仓把「多」变成需要书面解释的动作——不判质量，只强制写下来。

- **任务书 = PR 模板**（`.github/PULL_REQUEST_TEMPLATE.md`）：现有实现证据 / 新增文件理由 / 删除清单 / 不做清单。**动手前**填（写进 issue、计划或 PR 草稿皆可）；删除清单确无删除也写「无」，不允许留空。模板的二级标题是门禁解析契约，改名即改门禁行为。
- **门禁**：`pnpm run check:diff-face --base <ref>`（无 `--base` 时用 `origin/main` 的 PR 语义）。触发线 = `scripts/check-diff-face.mjs` 的 `BUDGET` 常量（默认：源码净增 250 行、新增源码文件 2 个、新增测试文件 0 个）。触发后必须给理由：`--reason "<≥40 字符>"` / `DIFF_FACE_REASON`，或 PR body 填满模板全部小节（HTML 注释不计正文）。
- **新增测试文件默认零容忍**：先尝试并入既有矩阵文件（新行/新轴）；确实不行，书面回答「为何不能并入」或「吸收/替换了哪个旧条目」。「合并即删」的删除与新增在同一 diff 内完成，不留给以后清理。
- **答不上来 = 删东西**，不是加一行解释。阈值是解释线不是上限：调阈值 = 改脚本里的 `BUDGET`（一次显式代码 diff），不是绕过门禁的默认路径。
- CI 在 PR 的 lint job 用 `base.sha` + PR body 跑；push 不跑（合并后重算已无「本批改动」语义）。

## TypeScript Config

- `tsconfig.base.json`: ES2022 target, ESNext module, bundler resolution, strict, noEmit
- `tsconfig.json`: extends `tsconfig.base.json` + generated `tsconfig.paths.json`; project references for core, parser, nudojs, service. Path aliases are NOT restated here — single source is `scripts/workspace-aliases.mjs` (drift gate: `pnpm run lint:hygiene`; `node scripts/check-aliases.mjs --write` 重新生成)
- `tsconfig.lint.json`: Includes all packages (excludes tests) for CI type-checking
- Each package has its own `tsconfig.json` extending base with project references

## CI

- **CI** (`.github/workflows/ci.yml`): build once, dist shared via `nudo-dist` artifact + `actions/cache` (src-hash keyed); CLI e2e uses `NUDO_TEST_CLI=dist` (node + built dist, no per-case tsx spawn). Matrix: push main → lint/build/test (2 shards, full run − `*.e2e.test.ts`/`*.oracle.test.ts` — no `--changed`) + benchmark; push dev|ci → lint/build/test (2 shards, `vitest --changed <before>` − e2e/oracle + narrowed forceRerunTriggers, vitest.config.ts; `test:fs-input` runs unconditionally on incremental paths because fs reads are invisible to the module graph; tsc and verify:* skipped when their inputs unchanged); PRs → lint/build/test-pr (2 shards, `vitest run --changed <base.sha>` − e2e/oracle, no coverage) — that run **is** the PR's test gate; nightly schedule → test-coverage (2 shards, blob reports, full incl. `*.e2e.test.ts`/`*.oracle.test.ts`) + coverage-merge (`vitest --merge-reports`, hard thresholds) + codecov + benchmark + node-matrix (Node engine-version smoke: bin + verify:examples on the lowest advertised Node — engines-drift red tracker). Slow lanes (process-level e2e `*.e2e.test.ts`, 58 files; external oracles `*.oracle.test.ts`, real npm packages / @types corpora) run only on nightly/dispatch and locally via `pnpm run test:local --e2e|--oracle [-- --changed]`; a release that touched CLI/process surfaces or real-package precision must run them manually. CI's same-SHA green conclusion is the publish/deploy gate for Release & Docs-deploy (explicit polling, fail-closed — no duplicate inline lint/test).
- **Release** (`.github/workflows/release.yml`): two routes — pending changesets → version-only Version PR (no build/test); no changesets + unpublished versions → same-SHA CI gate + `nudo-dist` reuse → publish → package VS Code extension → publish to Marketplace/Open VSX. Docs deploy is decoupled (`.github/workflows/docs-deploy.yml`: same-SHA CI gate + dist reuse → GitHub Pages).
