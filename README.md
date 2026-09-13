# Nudo

A type inference engine for JavaScript powered by **abstract interpretation** — execute your code with symbolic type values instead of concrete values, and get precise type information without TypeScript.

## Why Nudo?

| | TypeScript | Nudo |
|---|---|---|
| Type annotations | Required everywhere | Optional — `@nudo:case` directives add precision; all functions inferred from call sites without any directives |
| Separate type system | Yes (structural) | No — types derived from execution |
| Build step | `tsc` compilation | None — works on plain `.js` |
| Type accuracy | Depends on annotations | Follows actual runtime semantics |

Nudo infers types by **running your functions** with symbolic inputs like `T.number` or `T.string`, tracking how values flow through branches, operators, and calls.

## Quick Start

```bash
npm install -g @nudojs/cli
```

Add directives to your JavaScript functions:

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}
```

Run inference:

```bash
nudo infer math.js
```

Output:

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

Output blocks show the **case headers and `Combined:` lines** — the per-call-site ground truth. A full run also prints `intension:` / `abs:` lines per case; those re-evaluate the function with `unknown` parameters (a generalized signature), and for multi-branch functions they show only the fallback path — which is why they are omitted here.

### Whole-program inference (no directives needed)

Functions without `@nudo:case` directives are inferred from their call sites — every call with inferable arguments becomes a synthetic case (`call@<line>`). Functions with no call sites get an `entry@` case with unknown parameters.

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

Case "call@L3": (5) => 10

=== helper ===

Case "entry@L2": (unknown) => unknown
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

Case "call@L4": ([1, 2, 3], (x) => ...) => [2, 4, 6]
Case "call@L5": (["a"], (s) => ...) => ["A"]

Combined: [2, 4, 6] | ["A"]
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
| [`website`](./packages/website) | Documentation site (Docusaurus) |

### Dependency Graph

```
core
 └─ parser
     └─ cli
         └─ service
             ├─ lsp
             └─ vite-plugin
```

## Directives

Nudo uses structured JSDoc comments to guide inference:

| Directive | Purpose |
|---|---|
| `@nudo:case` | Define named execution cases with concrete or symbolic arguments |
| `@nudo:refine` | Attach a refinement contract (`@nudo:refine x positive` / `@nudo:refine return delay`) |
| `@nudo:mock` | Provide mock implementations for external dependencies |
| `@nudo:pure` | Mark functions as pure for memoized evaluation |
| `@nudo:skip` | Skip inference and use manually declared types |
| `@nudo:sample` | Control loop iteration sampling |

Refinements live in `*.nudo.js` templates (`number().gt(0)`, `shape({...})`) and enter Abs as Preds — they participate in arithmetic, not just call-site gates.

See [`docs/examples/`](./docs/examples/) for runnable examples.

## How It Works

1. **Parse** — Babel parses your `.js` file and extracts `@nudo:` directives
2. **Execute** — The evaluator runs each `@nudo:case` with abstract interpretation, tracking type values through all code paths
3. **Combine** — Results from multiple cases are merged into a unified type via union simplification
4. **Emit** — Inferred types are displayed or written as `.d.ts` declarations

### Type Values

Nudo represents JavaScript values as symbolic types (`TypeValue` kinds):

| Kind | Represents |
|---|---|
| `literal` | Exactly one concrete value (`42`, `"hello"`, `true`) |
| `primitive` | All values of a primitive type (`T.number`, `T.string`, …) |
| `refined` | Primitive plus a constraint (`x > 0`) that participates in algebra |
| `object` | Object with known property types |
| `array` | Array with a common element type |
| `tuple` | Fixed-length array with per-index types |
| `function` | Function with parameters, body, and closure |
| `promise` | Promise effect over a body type |
| `instance` | Class instance with its property shapes |
| `union` | One of several possible types |
| `never` | Unreachable / impossible |
| `unknown` | Any value (type unknown) |

## Development

### Prerequisites

- To **run the published CLI** (`npm install -g @nudojs/cli`): Node.js >= 23.6（或 22.18 LTS）— packages ship as source `.ts` and run via native type stripping
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
