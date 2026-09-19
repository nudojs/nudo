# Nudo

A type inference engine for JavaScript powered by **abstract interpretation** — execute your code with abstract type values (`Abs` = shape × term × pred × conf) instead of concrete values, and get precise type information without TypeScript.

## Why Nudo?

| | TypeScript | Nudo |
|---|---|---|
| Type annotations | Required everywhere | Optional — `*.nudo.js` contracts / `@nudo:refine` when you want obligations; call-site facts otherwise |
| Separate type system | Yes (structural) | No — types derived from execution |
| Build step | `tsc` compilation | None — works on plain `.js` |
| Type accuracy | Depends on annotations | Follows actual runtime semantics |
| Structure without interface | Needs `interface` | Explicit shape contract (`shape({…})`); **no** body-AST slot invention |

Nudo infers types by **running your functions** with abstract Abs values (number/string/shape constraints), tracking how values flow through branches, operators, and calls.

## Quick Start

```bash
npm install -g @nudojs/cli
# or via the thin `nudojs` shell package: npm install -g nudojs / npx nudojs
```

Write plain JavaScript. Call sites are evidence:

```javascript
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

Run inference:

```bash
nudo infer math.js
```

Output:

```
=== subtract ===

call@L7: (5, 3) => 2
call@L8: (1, 10) => -9
```

Output shows **observed call-site facts** (`call@<line>`) and, when several sites exist, an `Observed:` join — the ground truth from execution. A full run also prints `intension:` / `abs:` lines that re-evaluate with `unknown` parameters (a generalized signature).

Optional contracts live in sidecars (`*.nudo.js`) or `@nudo:refine` — that is the interface product. Optional `@nudo:case` witnesses are **debug / `nudo test` only** (concrete args or constraint builders such as `number()` / `lit(42)`; **`T.*` is gone**).

### Whole-program inference (no directives needed)

Functions without any directives are inferred from their call sites — every call with inferable arguments becomes a synthesized `call@<line>` observation. Functions with no call sites get an `entry@` observation with unknown parameters.

```javascript
function double(x) { return x * 2; }
function helper(x) { return String(x); }
double(5);
```

```bash
nudo infer plain.js
```

```
=== double ===

call@L3: (5) => 10

=== helper ===

entry@L2: (unknown) => unknown
# no call sites found; parameters default to unknown
```

Even with no call sites, the generalized signature is still computed (`helper: (x: A1) => string`).

Callbacks passed at call sites propagate precisely (polyvariant evaluation):

```javascript
function processItems(items, cb) {
  return items.map(cb);
}
processItems([1, 2, 3], (x) => x * 2);
processItems(["a"], (s) => s.toUpperCase());
```

```
=== processItems ===

call@L4: ([1, 2, 3], (x) => ...) => [2, 4, 6]
call@L5: (["a"], (s) => ...) => ["A"]

Observed: [2, 4, 6] | ["A"]
```

Generate TypeScript declarations:

```bash
nudo infer math.js --dts
# Creates math.d.ts
```

Watch mode:

```bash
nudo watch src/ --dts
```

## Packages

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces).

| Package | Description |
|---|---|
| [`@nudojs/core`](./packages/core) | Type value primitives and type system core |
| [`@nudojs/parser`](./packages/parser) | Babel-based parser and directive extraction |
| [`@nudojs/cli`](./packages/cli) | CLI tool and evaluator API |
| [`@nudojs/service`](./packages/service) | Shared inference service for IDE integrations |
| [`@nudojs/lsp`](./packages/lsp) | Language Server Protocol server, with AI-agent `executeCommand` support |
| [`@nudojs/env`](./packages/env) | Built-in API environments (ES globals, Node, Web) loaded by `@nudo:env` |
| [`@nudojs/harvester`](./packages/harvester) | Harvests `.d.ts` declarations into Nudo env modules |
| [`vite-plugin-nudo`](./packages/vite-plugin) | Vite plugin for build-time inference |
| [`nudo-vscode`](./packages/vscode) | VS Code / Cursor extension |
| [nudo-zed](https://github.com/nudojs/nudo-zed) | Zed extension (standalone repo; secondary language server) |
| [`website`](./packages/website) | Documentation site (Docusaurus) |

### Dependency Graph

```
core → parser → service → cli → nudojs
                 │
                 ├→ lsp
                 └→ vite-plugin
```

## Directives

Nudo uses structured JSDoc comments to guide analysis. Contracts are the product surface; cases are debug/test only.

| Directive | Purpose |
|---|---|
| `@nudo:refine` | Attach a refinement / interface contract (`@nudo:refine x positive`) — main path is `*.nudo.js` sidecar binding |
| `@nudo:as` | Override the next statement's inferred type (`// @nudo:as shape({ port: number() })`) |
| `@nudo:replace` | Replace a sub-expression's type (`// @nudo:replace JSON.parse(x) shape({ id: number() })`) |
| `@nudo:mock` | Provide mock implementations for external dependencies (plain JS / `stub().returns(...)` / constraint builders) |
| `@nudo:case` | **Debug witnesses only** — named inputs for `nudo test` / LSP scenarios; not the interface product |
| `@nudo:pure` | Mark functions as pure for memoized evaluation |
| `@nudo:skip` | Skip inference and use manually declared types (`@nudo:skip number()`) |
| `@nudo:sample` | Control loop iteration sampling |
| `@nudo:import` | Import constraint templates from `*.nudo.js` (`/// @nudo:import { positive } from "./shapes.nudo.js"`) |
| `@nudo:env` | Declare runtime environment APIs (`/// @nudo:env web` — built-in `es` / `web` / `node`) |
| `@nudo:mock-module` | Replace a whole imported module with mocks (`/// @nudo:mock-module "pkg" from "./mock.js"`) |

Directive type expressions use **constraint builders** (`number()`, `lit(42)`, `shape({...})`, `union(...)`, `array(...)`) or **concrete literals**. The legacy `T.*` grammar has been removed.

Full directive reference: [Core Concepts → Directives](https://nudojs.github.io/nudo/docs/concepts/directives).

Refinements live in `*.nudo.js` templates (`number().gt(0)`, `shape({...})`) and enter Abs as Preds — they participate in arithmetic, not just call-site gates.

See [`docs/examples/`](./docs/examples/) for runnable examples.

## How It Works

1. **Parse** — Babel parses your `.js` file and extracts `@nudo:` directives
2. **Execute** — The evaluator runs each function with abstract interpretation, tracking **Abs values** through all code paths (production analysis is Abs-native via B-path transpile+exec / ast-eval; there is no separate TypeValue evaluator)
3. **Combine** — Results from multiple cases are merged into a unified type via union simplification
4. **Emit** — Inferred types are displayed or written as `.d.ts` declarations

### Abs — the type system

Nudo's type system is **Abs** (`shape × term × pred × conf`): types are computable values whose constraints participate in algebra. `nudo check` prints the lossless signature:

```
scale(x)  number  = (x + 1)  where (x + 1) > 1  #path
    term: (x + 1)       -- the abstract value (lit / var / app)
    pred: (x + 1) > 1   -- constraints relative to the term
    conf: path          -- exact / path / widened / partial / opaque
```

With `@nudo:refine x positive`, `scale` gets the term `(x + 1)` **and** the derived predicate `(x + 1) > 1` — `x > 0` propagates through `x + 1`, not just through call-site gates. Assignability is structural (`leqAbs`); `nudo check` reports implication failures (`actual ⊭ expected`).

### Type system notes

Production analysis is Abs-native. Extensional TS/Zod/dts projections (`formatShape`, `absToTSType`, `absToZodSchema`) are one-way lossy views of Abs — nothing reads them back. The legacy TypeValue IR and the `T.*` directive grammar have been removed.

| Abs shape | Represents |
|---|---|
| lit / prim | Concrete literals (`42`, `"hello"`) or primitive domains (`number`, `string`) |
| sum | Union of Abs members |
| obj / arr / tuple | Structural shapes |
| fn / eff | Function / async effect |
| unknown / never | Uninformed / unreachable |

Constraint builders (`number().gt(0)`, `shape({...})`) produce Preds that enter Abs and participate in algebra.

## Development

### Prerequisites

- To **run the published CLI** (`npm install -g @nudojs/cli`): Node.js >= 20（packages ship as source `.ts` and run via native type stripping on supported Node）
- To **develop this repo**: Node.js >= 18 and pnpm 9.1.0 (pinned in `packageManager`)

### Setup

```bash
pnpm install
pnpm run build
```

### Scripts

```bash
pnpm run test          # Run tests
pnpm run test:watch    # Run tests in watch mode
pnpm run build         # Build all packages
pnpm run docs:dev      # Start docs dev server
pnpm run docs:build    # Build docs for production
```

### Quick Inference

```bash
pnpm run infer <file.js>
```

## Documentation

Full documentation is available at the [Nudo docs site](https://nudojs.github.io/nudo/), with support for English and Chinese.

- [Getting Started](https://nudojs.github.io/nudo/docs/getting-started/installation)
- [Core Concepts](https://nudojs.github.io/nudo/docs/concepts/type-values)
- [API Reference](https://nudojs.github.io/nudo/docs/api/core)
- [Design Document](https://nudojs.github.io/nudo/docs/design/design-doc)

## License

[MIT](./LICENSE)
