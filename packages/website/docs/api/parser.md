---
sidebar_position: 2
---

# @nudojs/parser

The parser package handles source code parsing and directive extraction. It produces Babel-compatible ASTs and structured directive data for the evaluator.

## parse

```typescript
parse(source: string): File
```

Parses JavaScript/TypeScript source into a Babel `File` AST.

**Options:**
- `sourceType: "module"`
- `plugins: ["typescript", "jsx"]`
- `attachComment: true` (required for directive extraction)

**Returns:** Babel `File` node (root AST).

---

## Directive Types

Directives are extracted from block comments using the `@nudo:` namespace.

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
  expression?: string;   // inline expression
  fromPath?: string;     // path to mock module
}
```

Replaces a binding with a type-value–aware mock implementation.

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

## parseTypeValueExpr

```typescript
parseTypeValueExpr(expr: string): TypeValue
```

Parses a string expression into a TypeValue. Used for directive arguments (e.g. `@nudo:case` args, `@nudo:returns` expected type).

**Supported forms:**
- Primitives: `T.number`, `T.string`, `T.boolean`, `T.unknown`, `T.never`, `T.null`, `T.undefined`
- Literals: `T.literal(...)`, `true`, `false`, `null`, `undefined`, numbers, quoted strings
- Composite: `T.object({...})`, `T.array(...)`, `T.tuple([...])`, `T.union(...)`
- JSON-like: `{ "key": value }`, `[a, b, c]`

**Returns:** Parsed TypeValue, or `T.unknown` for unrecognized expressions.
