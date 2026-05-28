# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Nudo

Nudo is a type inference engine for JavaScript powered by abstract interpretation. It executes code with symbolic type values (`T.number`, `T.string`, etc.) instead of concrete values, deriving types from runtime semantics without TypeScript annotations. Users annotate JS files with `@nudo:` directives in JSDoc comments.

## Development Commands

```bash
pnpm install          # Install dependencies (requires pnpm@9.1.0)
pnpm run build        # Build all packages with tsup
pnpm run test         # Run all tests (vitest run)
pnpm run test:watch   # Run tests in watch mode
pnpm run lint         # Type-check all packages (tsc --noEmit -p tsconfig.lint.json)
pnpm run infer <file> # Run inference on a JS file
```

Run a single test file: `pnpm vitest run packages/core/src/__tests__/type-value.test.ts`

## Monorepo Structure

pnpm workspaces monorepo. Dependency graph (arrows mean "depends on"):

```
core → parser → cli → service → lsp
                            → vite-plugin
```

| Package | Purpose |
|---|---|
| `packages/core` | TypeValue discriminated union, `T` factory, ops, environment, refinements |
| `packages/parser` | Babel-based parser, `@nudo:` directive extraction from JSDoc |
| `packages/cli` | Evaluator (abstract interpreter), CLI (`nudo infer`, `nudo watch`) |
| `packages/service` | Analyzer orchestration, dts-generator for IDE integrations |
| `packages/lsp` | LSP server (diagnostics, completions, code lens, inlay hints) |
| `packages/vite-plugin` | Vite plugin for build-time inference |
| `packages/vscode` | VS Code extension (private, launches LSP server) |
| `packages/website` | Docusaurus docs site (private) |

## Architecture

**Type system core** (`core`): `TypeValue` is a discriminated union with kinds: `literal`, `primitive`, `refined`, `object`, `array`, `tuple`, `function`, `promise`, `instance`, `union`, `never`, `unknown`. The `T` factory provides constructors. `Environment` is an immutable scoped binding system. `Ops` dispatches binary/unary operations through refinements.

**Parser** (`parser`): Uses `@babel/parser` with TypeScript+JSX plugins. Extracts `@nudo:` directives: `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:returns`.

**Evaluator** (`cli/src/evaluator.ts`): Walks Babel AST with a large `switch` on `node.type`. Uses signal types (`ReturnSignal`, `BranchSignal`, `ThrowSignal`) with Symbol keys for control flow. Supports loops with widening for convergence, try/catch, destructuring, async/await. `@nudo:pure` functions are memoized. Narrowing logic is in `cli/src/narrowing.ts`.

**Service** (`service`): `analyzer.ts` orchestrates parse → extract directives → evaluate → collect diagnostics. `dts-generator.ts` converts TypeValue to TypeScript declaration strings.

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
