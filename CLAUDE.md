# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Nudo

Nudo is a type inference engine for JavaScript powered by abstract interpretation. The **type system is Abs** (`shape × term × pred × conf`) — types are computable values with constraints that participate in algebra (`x>0` ⇒ `x+1>1`). There is no second IR: production analysis is **Abs-native**, and dts/LSP/serialization consume Abs directly through one-way, lossy extensional rendering (`formatShape`, `absToTSType`, `absToZodSchema`).

Users annotate JS with `@nudo:` directives. Source-level contracts use `@nudo:refine` + `*.nudo.js` templates (constraint-builder grammar: `number()`, `lit()`, `shape()`, `union()`, …). **`T.*` directive grammar is removed.** `@nudo:case` is debug / `nudo test` / LSP scenario only — not the interface product.

## Development Commands

```bash
pnpm install          # Install dependencies (requires pnpm@9.1.0)
pnpm run build        # Build all packages with tsup
pnpm run test         # Run all tests (vitest run)
pnpm run test:watch   # Run tests in watch mode
pnpm run lint         # Type-check all packages (tsc --noEmit -p tsconfig.lint.json)
pnpm run infer <file> # Run inference on a JS file
pnpm run docs:dev     # Docs dev (en) — http://localhost:3000/nudo/
pnpm run docs:dev:zh  # Docs dev (zh-Hans) — http://localhost:3000/nudo/zh-Hans/
pnpm run docs:build   # Docs production build (en + zh-Hans)
pnpm run docs:serve   # Serve production build (both locales)
```

> Docusaurus `start` serves **one locale per process**. Default `docs:dev` is English only, so `/nudo/zh-Hans/` will 404 until you run `docs:dev:zh` (or `docs:build` + `docs:serve`).

Run a single test file: `pnpm vitest run packages/core/src/algebra/__tests__/check-gold.test.ts`

## Monorepo Structure

pnpm workspaces monorepo. Dependency graph (arrows mean "depends on"):

```
core → parser → service → cli → nudo (thin shell)
                 │
                 ├→ lsp
                 └→ vite-plugin
```

| Package | Purpose |
|---|---|
| `packages/core` | **Type system**: algebra/Abs (term, pred, check, leq, ast-eval, surface, arithmetic), format (extensional rendering), environment, refinements, interface (sidecar/effectiveInterface/projection) |
| `packages/parser` | Babel-based parser; extracts function-scoped `@nudo:` directives from JSDoc |
| `packages/cli` | CLI commands only (`infer`, `check`, `types`, `watch`, `generate`, `harvest`, `test`, `interface`) |
| `packages/service` | Analyzer orchestration, Abs-native evaluator (B-path + ast-eval), dts-generator, harvest, infer-json, interface emitter/surface/derivation |
| `packages/nudojs` | Thin npm shell `nudojs` (`nudo` bin) that re-exports `@nudojs/cli` |
| `packages/lsp` | LSP server (check diagnostics, completions, code lens, inlay hints, agent tools) |
| `packages/env` | ES / Web / Node API type definitions (`@nudojs/env`) |
| `packages/harvester` | Harvest `@types` → env modules |
| `packages/vite-plugin` | Vite plugin for build-time inference |
| `packages/vscode` | VS Code extension (private, launches LSP server) |
| `packages/website` | Docusaurus docs site (private) |

## Architecture

**Type system core** (`core/src/algebra`): Abs = shape × term × pred × conf. Term is abstract value identity (lit/var/app); Pred is constraint relative to term; conf is exact/path/widened/partial/opaque. Primary entrypoints: `checkSource` (refinement gate), `evalProgramAbs` / `analyzeFn` (native Abs evaluation), `leqAbs` (structural assignability), `generalizeFromAst` (symbolic α). See `docs/design-kernel-merge.md`.

**Extensional rendering** (`core/src/algebra/format.ts`): `formatShape` (display strings), `formatAbs` (lossless). One-way projections: `absToTSType` / `absToZodSchema` / guard generators consume Abs directly. Nothing reads a projection back.

**Parser** (`parser`): Uses `@babel/parser` with TypeScript+JSX plugins. Extracts function/file directives: `@nudo:case` (debug witnesses), `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:env`, `@nudo:mock-module`, `@nudo:as`, `@nudo:replace`. Type expressions parse via `parseCaseArgExpr` only (constraint builders + concrete literals; no `T.*`). File-level `@nudo:import` and function-level `@nudo:refine` are parsed in **core** (`algebra/refine.ts`), not the parser package.

**Evaluator** (`service/src/evaluator`): Abs-native. The TypeValue AST interpreter (`evaluator.ts`, `narrowing.ts`, `eval-binary.ts`, most `builtins/`) was removed — production evaluation runs Abs directly. Primary analysis path is **B-path** (`bpath-run.ts` + `core/algebra/exec`: transpile → `new Function` with Abs values); fallback is `ast-eval`/`evalProgramAbs`. Arithmetic/compare/unary/spread route through the algebra (`surface.ts`, `abs-route.ts`). `CallRecord` is Abs-only (`resultAbs`/`argsAbs`). Public API: `@nudojs/service/evaluator`.

**Service** (`service`): `analyzer.ts` orchestrates parse → directives → evaluate → diagnostics. Evaluation is **Abs-native** — there is no TypeValue `evaluateProgram` fallback. **B-hosted** files (`tryRunBPath` succeeds) use transpile+exec for diagnostics, call@ synthesis, nodeTypeMap, and optional debug-witness evaluation; otherwise `ast-eval`/`evalProgramAbs` evaluate Abs directly. Modules via `evalAbsModuleGraph`（named/default/namespace、re-export/`export *`、require、harvest、@nudo:env）。Class bridge: Abs-eval `registerClassDecl` → `exec/class-registry` → B `$new`. `dts-generator.ts` projects Abs → TypeScript (`Case:` JSDoc rows are debug extensional notes, not the interface product). CLI infer prints call-site facts (`call@L…`) and `debug "name"` witnesses; Combined/Observed is the join.

**Check product**: `nudo check` is the CI gate — Pred implication on Abs, Nudo-native reports (`actual ⊭ expected`). Gold gates: recall=precision=1.0 and real-package zero-FP tests in `core/src/algebra/__tests__/`.

## Code Conventions

- All ESM (`"type": "module"` everywhere)
- Imports use `.ts` extensions (e.g., `import { T } from "./type-value.ts"`) — enabled by `allowImportingTsExtensions`; source-level imports stay `.ts` even though published output is `.js`
- Package `exports` point to `./dist/*` built output (tsup); `files: ["dist"]` on published packages
- No ESLint/Prettier — linting is type-checking only (`tsc --noEmit`)
- Tests live in `__tests__/` dirs alongside source, named `*.test.ts`
- Test files use `describe`/`it`/`expect` from vitest
- Versioning via @changesets/cli with public access, base branch `main`

## TypeScript Config

- `tsconfig.base.json`: ES2022 target, ESNext module, bundler resolution, strict, noEmit
- `tsconfig.json`: Project references for core, parser, cli with path aliases
- `tsconfig.lint.json`: Includes all packages (excludes tests) for CI type-checking
- Each package has its own `tsconfig.json` extending base with project references

## CI

- **CI** (`.github/workflows/ci.yml`): lint → build → test on push to main/develop and PRs
- **Release** (`.github/workflows/release.yml`): changeset version → publish → deploy docs → package VS Code extension → publish to Marketplace/Open VSX
