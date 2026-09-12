# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Nudo

Nudo is a type inference engine for JavaScript powered by abstract interpretation. The **type system is Abs** (`shape × term × pred × conf`) — types are computable values with constraints that participate in algebra (`x>0` ⇒ `x+1>1`). **TypeValue is the evaluation IR** (environment bindings, dts/LSP/serialization), not a parallel type system; Abs ⇄ TypeValue goes through a lossy bridge.

Users annotate JS with `@nudo:` directives. Source-level contracts use `@nudo:refine` + `*.nudo.js` templates (not `T.refine` in source).

## Development Commands

```bash
pnpm install          # Install dependencies (requires pnpm@9.1.0)
pnpm run build        # Build all packages with tsup
pnpm run test         # Run all tests (vitest run)
pnpm run test:watch   # Run tests in watch mode
pnpm run lint         # Type-check all packages (tsc --noEmit -p tsconfig.lint.json)
pnpm run infer <file> # Run inference on a JS file
```

Run a single test file: `pnpm vitest run packages/core/src/algebra/__tests__/check-gold.test.ts`

## Monorepo Structure

pnpm workspaces monorepo. Dependency graph (arrows mean "depends on"):

```
core → parser → cli → service → lsp
                            → vite-plugin
```

| Package | Purpose |
|---|---|
| `packages/core` | **Type system**: algebra/Abs (term, pred, check, leq, ast-eval), TypeValue IR, `T` factory, ops residual, environment, refinements |
| `packages/parser` | Babel-based parser; extracts function-scoped `@nudo:` directives from JSDoc |
| `packages/cli` | TypeValue evaluator (abstract interpreter) + CLI (`infer`, `check`, `types`, `watch`, `generate`, `harvest`, `test`) |
| `packages/service` | Analyzer orchestration, Abs program path for self-contained sources, dts-generator, harvest, infer-json |
| `packages/lsp` | LSP server (check diagnostics, completions, code lens, inlay hints, agent tools) |
| `packages/env` | ES / Web / Node API type definitions (`@nudojs/env`) |
| `packages/harvester` | Harvest `@types` → env modules |
| `packages/vite-plugin` | Vite plugin for build-time inference |
| `packages/vscode` | VS Code extension (private, launches LSP server) |
| `packages/website` | Docusaurus docs site (private) |

## Architecture

**Type system core** (`core/src/algebra`): Abs = shape × term × pred × conf. Term is abstract value identity (lit/var/app); Pred is constraint relative to term; conf is exact/path/widened/partial/opaque. Primary entrypoints: `checkSource` (refinement gate), `evalProgramAbs` / `analyzeFn` (native Abs evaluation), `leqAbs` (structural assignability), `generalizeFromAst` (symbolic α). See `docs/design-kernel-merge.md`.

**TypeValue IR** (`core/src/type-value.ts`): discriminated union (`literal`/`primitive`/`refined`/`object`/`array`/`tuple`/`function`/`promise`/`instance`/`union`/`never`/`unknown`). Used by TypeValue evaluator, env bindings, dts, LSP hover extensional side. Residual ops live in `core/src/ops.ts`.

**Parser** (`parser`): Uses `@babel/parser` with TypeScript+JSX plugins. Extracts function/file directives: `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:env`, `@nudo:mock-module`, `@nudo:as`, `@nudo:replace`. File-level `@nudo:import` and function-level `@nudo:refine` are parsed in **core** (`algebra/refine.ts`), not the parser package.

**Evaluator** (`cli/src/evaluator.ts`): TypeValue AST abstract interpreter (fallback). Arithmetic/compare/unary/spread route to Abs first via `abs-route.ts` / `eval-binary.ts`; residual Ops catch mixed/unknown cases. Primary analysis path for capable files is B-path transpile/exec (`core/src/algebra/exec`). Control-flow signals (`ReturnSignal`, `BranchSignal`, `ThrowSignal`) use Symbol keys. Narrowing is in `cli/src/narrowing.ts`.

**Service** (`service`): `analyzer.ts` orchestrates parse → directives → evaluate → diagnostics. Capable sources use **B path** (`core/algebra/exec`: transpile → `new Function` with Abs values) as primary case/entry/call@ evaluation; TypeValue evaluator is fallback + diagnostics host. Modules via `evalAbsModuleGraph` (relative import, require, harvest, @nudo:env). `dts-generator.ts` projects TypeValue to TypeScript declarations.

**Check product**: `nudo check` is the CI gate — Pred implication on Abs, Nudo-native reports (`actual ⊭ expected`). Gold gates: recall=precision=1.0 and real-package zero-FP tests in `core/src/algebra/__tests__/`.

## Code Conventions

- All ESM (`"type": "module"` everywhere)
- Imports use `.ts` extensions (e.g., `import { T } from "./type-value.ts"`) — enabled by `allowImportingTsExtensions`
- Package `exports` point to `./src/index.ts` source, not built output
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
