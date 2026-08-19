---
sidebar_position: 2
description: "@nudojs/parser API — parse() with TypeScript stripping, stripTypes, function/file/inline directive extraction, and directive type definitions."
---

# @nudojs/parser

The parser package handles source code parsing and directive extraction. It produces Babel-compatible ASTs and structured directive data for the evaluator.

## parse

```typescript
parse(source: string, opts?: { errorRecovery?: boolean }): File
```

Parses JavaScript/TypeScript source into a Babel `File` AST, then runs [`stripTypes`](#striptypes) on it — the returned AST contains no TS-only nodes, which is why `.ts` inputs work in every downstream consumer (evaluator, analyzer, LSP) without per-caller wiring.

Fixed Babel options: `sourceType: "module"`, `plugins: ["typescript", "jsx"]`, `attachComment: true` (required for directive extraction).

`opts.errorRecovery` enables Babel error recovery for best-effort passes (e.g. `collectCallRecords` over legacy CJS usage-site files); the default `false` fails fast on syntax errors.

**Returns:** Babel `File` node (root AST), with TS-only syntax stripped in place.

---

## stripTypes

```typescript
stripTypes<T extends Node>(ast: T): T
```

Strips TS-only syntax from a Babel AST **in place** and returns the same tree — no `loc`/`start`/`end` is rewritten and sibling order is preserved (`@nudo:case` comments align by comment loc). `parse()` runs this pass unconditionally, so you only need it directly when you parsed with `@babel/parser` yourself.

What it removes or unwraps: type assertions (`as`, `satisfies`, `<T>x`, `x!`) are unwrapped to their expression; interfaces, type aliases, `declare` statements, TS enums, and type-only imports/exports are deleted; parameter/return type annotations and type parameter lists are dropped. Enum references degrade to `unknown`-global diagnostics — the evaluator has no enum semantics. Non-`declare` namespaces and `import x = require(...)` are left in place and evaluate as `unknown`.

---

## Directive Types

Directives are extracted from comments using the `@nudo:` namespace. Function-level directives come from leading **block** comments of top-level statements; file-level and inline directives come from **line** comments (see [`extractFileDirectives`](#extractfiledirectives) / [`extractInlineDirectives`](#extractinlinedirectives)).

The `Directive` union covers the six function-level kinds:

```typescript
type Directive =
  | CaseDirective
  | MockDirective
  | PureDirective
  | SkipDirective
  | SampleDirective
  | ReturnsDirective;
```

### CaseDirective

```typescript
type CaseDirective = {
  kind: "case";
  name: string;
  args: TypeValue[];
  expected?: TypeValue;
  commentLine?: number;
}
```

Named execution case with input arguments. Optional `expected` for return type validation.

### MockDirective

```typescript
type MockDirective = {
  kind: "mock";
  name: string;
  expression?: string;   // inline expression (raw text)
  fromPath?: string;     // path to mock module
  arrowFn?: { params: string[]; body: Node; paramPatterns: Node[] }; // parsed inline arrow function
  sinonExpr?: SinonExpression;  // stub()/spy()/mock() expression
  nudoMock?: MockHelper;        // parsed mock-helper form (from @nudojs/core)
}
```

Replaces a binding with a type-value–aware mock implementation. An inline arrow function (`@nudo:mock fetch = (url) => ({ ok: true })`) is parsed into `arrowFn`; sinon-style and `stub()`-style expressions are normalized into `nudoMock` (a `MockHelper` from `@nudojs/core`).

### SinonExpression

```typescript
type SinonExpression = {
  type: "stub" | "spy" | "mock";
  returnValue?: TypeValue;
  resolvedValue?: TypeValue;
  rejectedValue?: TypeValue;
}
```

The sinon-flavored form of `@nudo:mock` (`@nudo:mock fetch = sinon.stub().resolves({...})`), normalized from the `stub()`/`spy()`/`mock()` prefix.

### PureDirective

```typescript
type PureDirective = { kind: "pure" }
```

Marks the function as pure for memoization.

### SkipDirective

```typescript
type SkipDirective = {
  kind: "skip";
  returns?: TypeValue;
}
```

Skips evaluation; uses `returns` or existing type annotations.

### SampleDirective

```typescript
type SampleDirective = {
  kind: "sample";
  count: number;
}
```

Number of loop iterations to evaluate before fixed-point analysis.

### ReturnsDirective

```typescript
type ReturnsDirective = {
  kind: "returns";
  expected: TypeValue;
}
```

Asserts that inferred return type is a subtype of `expected`.

### FileDirective

Line comments at the top of the file (before any statement), shared by every function in it:

```typescript
type FileDirective = EnvDirective | MockModuleDirective;

type EnvDirective = {
  kind: "env";
  envs: string[];          // named or path-based envs, comma-separated
}

type MockModuleDirective = {
  kind: "mock-module";
  source: string;          // import specifier to replace
  fromPath: string;        // file providing the mock module
  names?: string[];        // partial form: only these exports are mocked
}
```

### InlineDirective

Line comments attached to an inner statement or expression:

```typescript
type InlineDirective = AsDirective | ReplaceDirective;

type AsDirective = {
  kind: "as";
  typeExpr: TypeValue;     // assumed type: // @nudo:as T.string
}

type ReplaceDirective = {
  kind: "replace";
  targetSource: string;    // expression text to override
  typeExpr: TypeValue;     // replacement type
}
```

---

## FunctionWithDirectives

```typescript
type FunctionWithDirectives = {
  node: Node;        // Babel AST node (function declaration/expression)
  name: string;     // function name
  directives: Directive[];
}
```

A top-level function with its associated directives.

---

## extractDirectives

```typescript
extractDirectives(ast: Node): FunctionWithDirectives[]
```

Extracts `@nudo:*` directives from leading block comments of top-level statements. Only statements with at least one directive are included. Supports:

- `FunctionDeclaration`
- `ExportDefaultDeclaration` (with FunctionDeclaration)
- `VariableDeclaration` (first declaration)

**Returns:** Array of functions with their directives, one entry per annotated statement.

---

## extractFileDirectives

```typescript
extractFileDirectives(ast: Node): FileDirective[]
```

Extracts file-level directives from the AST's top-level **line comments**: `/// @nudo:env` (one or more comma-separated envs) and `/// @nudo:mock-module "source" from "path"` (optionally with a `{ a, b }` names list for partial mocking). Non-`File` nodes return an empty array.

**Example:**
```javascript
/// @nudo:env node, ./nudo-harvest-node.ts
```

---

## extractInlineDirectives

```typescript
extractInlineDirectives(node: Node): InlineDirective[]
```

Extracts `@nudo:as` and `@nudo:replace` directives from the **line comments** attached to a single node — the mechanism behind agent-side type assumptions (`nudo.whatIf` injects `// @nudo:as <type>` lines this way). The comment must sit on its own line above the statement (a same-line trailing comment is not a leading comment of the node); other comment types are ignored.

**Example:**
```javascript
// @nudo:as T.string
const y = f(x);
```

---

## parseTypeValueExpr

```typescript
parseTypeValueExpr(expr: string): TypeValue
```

Parses a string expression into a TypeValue. Used for directive arguments (e.g. `@nudo:case` args, `@nudo:returns` expected type).

**Supported forms:**
- Primitives: `T.number`, `T.string`, `T.boolean`, `T.unknown`, `T.never`, `T.null`, `T.undefined`
- Literals: `T.literal(...)`, `true`, `false`, `null`, `undefined`, numbers, quoted strings
- Composite: `T.object({...})`, `T.array(...)`, `T.tuple([...])`, `T.union(...)`
- Functions: arrow expressions (`(x) => x + 1`) and `function(x) { ... }` — parsed into a real `T.fn` value
- JSON-like: `{ "key": value }`, `[a, b, c]`

**Returns:** Parsed TypeValue, or `T.unknown` for unrecognized expressions.
