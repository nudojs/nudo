# Nudo

A type inference engine for JavaScript powered by **abstract interpretation** — execute your code with symbolic type values instead of concrete values, and get precise type information without TypeScript.

## Why Nudo?

| | TypeScript | Nudo |
|---|---|---|
| Type annotations | Required everywhere | Only `@nudo:case` directives |
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
subtract:
  Case "positive numbers": (5, 3) => 2
  Case "negative result": (1, 10) => -9
  Case "symbolic": (T.number, T.number) => T.number
  Combined: (number, number) => number
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
| [`@nudojs/lsp`](./packages/lsp) | Language Server Protocol server |
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
| `@nudo:mock` | Provide mock implementations for external dependencies |
| `@nudo:pure` | Mark functions as pure for memoized evaluation |
| `@nudo:skip` | Skip inference and use manually declared types |
| `@nudo:sample` | Control loop iteration sampling |
| `@nudo:returns` | Assert expected return types |

## How It Works

1. **Parse** — Babel parses your `.js` file and extracts `@nudo:` directives
2. **Execute** — The evaluator runs each `@nudo:case` with abstract interpretation, tracking type values through all code paths
3. **Combine** — Results from multiple cases are merged into a unified type via union simplification
4. **Emit** — Inferred types are displayed or written as `.d.ts` declarations

### Type Values

Nudo represents JavaScript values as symbolic types:

| Type Value | Represents |
|---|---|
| `Literal<V>` | Exactly one concrete value (`42`, `"hello"`, `true`) |
| `Primitive<T>` | All values of a primitive type (`T.number`, `T.string`) |
| `ObjectType` | Object with known property types |
| `ArrayType` | Array with a common element type |
| `TupleType` | Fixed-length array with per-index types |
| `FunctionType` | Function with parameters, body, and closure |
| `UnionType` | One of several possible types |
| `NeverType` | Unreachable / impossible |
| `UnknownType` | Any value (type unknown) |

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 9

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

Full documentation is available at the [Nudo docs site](https://nicepkg.github.io/nudo/), with support for English and Chinese.

- [Getting Started](https://nicepkg.github.io/nudo/docs/getting-started/installation)
- [Core Concepts](https://nicepkg.github.io/nudo/docs/concepts/type-values)
- [API Reference](https://nicepkg.github.io/nudo/docs/api/core)
- [Design Document](https://nicepkg.github.io/nudo/docs/design/design-doc)

## License

[MIT](./LICENSE)
