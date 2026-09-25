<!-- CLI semantics: docs/design/cli-semantics.md — verbs check/test/contract/export/health. Harvest is not a product verb. -->
# Nudo

> **欢迎重回 JS 世界.** — Nudo 不限制你的 JS 表达，只忠实反映中间量与结果，并提供比类型更精确的契约校验。  
> Welcome back to JavaScript. Your JS stays JS — observe intermediates, enforce contracts sharper than types.

[![Docs](https://img.shields.io/badge/docs-nudojs.github.io%2Fnudo-5b4bd4)](https://nudojs.github.io/nudo/)
[![Playground](https://img.shields.io/badge/playground-try%20online-a29bfe)](https://nudojs.github.io/nudo/playground)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Nudo does not restrict how you write JavaScript. It executes your code on Abs (`shape × term × pred × conf`) so you can **faithfully observe** intermediate values and results — and **validate** them with explicit contracts sharper than ordinary TypeScript types.

TypeScript sources are also accepted: annotations are stripped and the code is analyzed with plain JS semantics. Use `nudo migrate` (`status|strip|verify|retire`) to retire `tsc` one-way — dual-run only during `verify`.

## Why Nudo?

| | TypeScript | Nudo |
|---|---|---|
| Type annotations | Required everywhere | Optional — `*.nudo.js` contracts / `@nudo:contract` when you want obligations; call-site facts otherwise |
| Separate type system | Yes (structural) | No — types derived from execution |
| Build step | `tsc` compilation | None — works on plain `.js` |
| Type accuracy | Depends on annotations | Follows actual runtime semantics |
| Structure without interface | Needs `interface` | Explicit shape contract (`shape({…})`); **no** body-AST slot invention |
| CI gate | `tsc --noEmit` | `nudo check` (prints signatures even on success) |

Beyond what TypeScript can express: `"0x" + id` → `` `0x${string}` ``, `"a,b,c".split(",")` → `["a", "b", "c"]`, loop sums stay literal — same Abs algebra powers `nudo check`.

**Product CLI face**: Day0 = `check` + `test`; Day1 = `contract` + `check`; ecosystem = `export`. Observation is check signatures + test cases + IDE. Entry unconstrained params display as **`any`**; true **`unknown`** means inference failure.

## Quick Start

```bash
npm install -g @nudojs/cli
# or via the thin `nudojs` shell package:
npm install -g nudojs
# or without installing:
npx nudojs check math.js
npx nudojs test math.js
```

Write plain JavaScript. Call sites are evidence:

```javascript
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

### Day 0 — check (gate + signatures) and test (case reports)

```bash
nudo check math.js
nudo test math.js
```

`check` always prints signatures (success is not silent) and is the CI gate — L1 explicit contracts + L2 entry may-throw (`nudo:entry-may-throw`, default error). Unconstrained entry params print as **`any`**.

```text
signatures
  subtract(a: any, b: any) => number
```

`test` prints every inferred case — synthesized `call@`/`entry@` plus `@nudo:case` debug witnesses. Only declared `@nudo:case` rows with expected values enter pass/fail.

```text
=== subtract ===
  call@L6  (5, 3) => 2
  call@L7  (1, 10) => -9

assertions
  — 0 passed · 0 failed · 2 unchecked (no declared @nudo:case expectations)
```

Call-site facts (`call@<line>`) are the ground truth from execution. Optional contracts live in sidecars (`*.nudo.js`) or `@nudo:contract` — that is the interface product. Optional `@nudo:case` witnesses are **debug / `nudo test` only** (concrete args or constraint builders such as `number()` / `lit(42)`).

### Whole-program analysis (no directives needed)

Functions without directives are still analyzed: every call with inferable arguments becomes a synthesized `call@<line>` observation. Exported functions with no call sites get an `entry@` observation; unconstrained params display as **`any`** (not `unknown`). Dangerous operations on entry `any` can surface as L2 `nudo:entry-may-throw`.

```javascript
function double(x) { return x * 2; }
export function helper(x) { return x.name; }
double(5);
```

```bash
nudo test plain.js
nudo check plain.js
```

```text
=== double ===
  call@L3  (5) => 10

=== helper ===
  entry@L2  (any) => any
```

```text
signatures
  helper(x: any) => any  throws TypeError
issues
  [error] helper: entry may throw TypeError  (nudo:entry-may-throw)
```

Callbacks passed at call sites propagate precisely (polyvariant evaluation):

```javascript
function processItems(items, cb) {
  return items.map(cb);
}
processItems([1, 2, 3], (x) => x * 2);
processItems(["a"], (s) => s.toUpperCase());
```

```text
=== processItems ===
  call@L4  ([1, 2, 3], (x) => ?) => [2, 4, 6]
  call@L5  (["a"], (s) => ?) => ["A"]
```

### Day 1 / ecosystem

```bash
nudo contract src/          # print / --draft / --emit sidecar contracts
nudo export math.js --format dts --out dist/   # dts | guard | schema | standard | all
nudo health src/            # analysis errors + contract drift
nudo health                 # analysis errors + drift
nudo check src/ --watch     # watch is a flag, not a verb
```

Ignore specific entry may-throws when intentional:

```bash
nudo check src/ --ignore-throws TypeError
# package.json: "nudo": { "check": { "ignoreThrows": ["TypeError"] } }
```

Try the same ideas in the browser: [Playground](https://nudojs.github.io/nudo/playground).

## Packages

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces).

| Package | Description |
|---|---|
| [`@nudojs/core`](./packages/core) | Abs type system (`shape × term × pred × conf`) |
| [`@nudojs/parser`](./packages/parser) | Babel-based parser and directive extraction |
| [`@nudojs/cli`](./packages/cli) | CLI tool and evaluator API (check / test / contract / export / health) |
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
| `@nudo:contract` | Attach a source contract (`@nudo:contract x positive`) — main path is `*.nudo.js` sidecar binding |
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

Directive type expressions use **constraint builders** (`number()`, `lit(42)`, `shape({...})`, `union(...)`, `array(...)`) or **concrete literals**.

Full directive reference: [Core Concepts → Directives](https://nudojs.github.io/nudo/docs/concepts/directives).

Refinements live in `*.nudo.js` templates (`number().gt(0)`, `shape({...})`) and enter Abs as Preds — they participate in arithmetic, not just call-site gates.

See [`docs/examples/`](./docs/examples/) for runnable examples.

## How It Works

1. **Parse** — Babel parses your `.js` file and extracts `@nudo:` directives
2. **Execute** — The evaluator runs each function with abstract interpretation, tracking **Abs values** through all code paths (production analysis is Abs-native via B-path transpile+exec)
3. **Combine** — Results from multiple cases are merged into a unified type via union simplification
4. **Report** — `nudo check` prints signatures + gate issues; `nudo test` prints case reports; `nudo export` projects dts / guard / schema / standard

### Abs — the type system

Nudo's type system is **Abs** (`shape × term × pred × conf`): types are computable values whose constraints participate in algebra. `nudo check` prints the lossless signature (one-line by default; `--verbose` / `--abs` expands term/pred/conf):

```
scale(x)  number  = (x + 1)  where (x + 1) > 1  #path
    term: (x + 1)       -- the abstract value (lit / var / app)
    pred: (x + 1) > 1   -- constraints relative to the term
    conf: path          -- exact / path / widened / partial / opaque
```

With `@nudo:contract x positive`, `scale` gets the term `(x + 1)` **and** the derived predicate `(x + 1) > 1` — `x > 0` propagates through `x + 1`, not just through call-site gates. Assignability is structural (`leqAbs`); `nudo check` reports implication failures (`actual ⊭ expected`).

### Abs projections

Production analysis is **Abs-native**. Extensional TS/schema/dts projections (`formatShape`, `absToTSType`, `absToSchemaSource`) are one-way lossy views of Abs — nothing reads a projection back. Design: [`docs/design/kernel-merge.md`](./docs/design/kernel-merge.md) and the [docs site Abs page](https://nudojs.github.io/nudo/docs/concepts/type-values).

## Development

### Prerequisites

- To **run the published CLI** (`npm install -g @nudojs/cli`): Node.js >= 20（published packages ship compiled `dist/` ESM）
- To **develop this repo**: Node.js >= 18 and pnpm 9.1.0 (pinned in `packageManager`)

### Setup

```bash
pnpm install
pnpm run build
```

### Scripts

```bash
pnpm run test           # vitest package tests
pnpm run test:watch     # vitest watch mode
pnpm run build          # Build all packages
pnpm run check <file>   # CLI: gate + signatures
pnpm run test:cli <file> # CLI: case reports
pnpm run nudo -- <args> # Full CLI (contract / export / health / …)
pnpm run docs:dev       # Start docs dev server
pnpm run docs:build     # Build docs for production
```

## Documentation

Full documentation is available at the [Nudo docs site](https://nudojs.github.io/nudo/), with support for English and Chinese.

- [Getting Started](https://nudojs.github.io/nudo/docs/intro) — Welcome back to JavaScript
- [Quick Start](https://nudojs.github.io/nudo/docs/getting-started/quick-start)
- [Playground](https://nudojs.github.io/nudo/playground)
- [Core Concepts](https://nudojs.github.io/nudo/docs/concepts/type-values)
- [API Reference](https://nudojs.github.io/nudo/docs/api/core)
- [Design Document](https://nudojs.github.io/nudo/docs/design/design-doc)
- CLI semantics: [`docs/design/cli-semantics.md`](./docs/design/cli-semantics.md)

## License

[MIT](./LICENSE)
