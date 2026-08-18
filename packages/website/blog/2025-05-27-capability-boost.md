---
slug: capability-boost
title: "Nudo Capability Boost: Smarter Narrowing, AI Integration, and Runtime Validators"
authors: [default]
tags: [nudo, type-inference, ai, mcp]
---

Nudo infers types for JavaScript by executing your code with symbolic type values instead of concrete ones. No TypeScript annotations, no `.d.ts` files -- just plain JS with lightweight `@nudo:` directives and runtime-based type inference that understands what your code actually does.

This release is the biggest capability jump since Nudo's initial launch. We are shipping smarter control flow narrowing, a full-featured LSP server, an MCP server for AI agent integration, and a runtime type generation pipeline. Together, these changes make Nudo viable for real-world codebases and AI-assisted development workflows.

Let's walk through what's new.

## Control Flow Narrowing

The evaluator now tracks how types change as code flows through branches, guards, and operators. When you test a value with a condition, Nudo narrows the type in the branch where the condition is true and keeps the complement in the false branch. This works across seven patterns. You can watch each one by feeding a union through `@nudo:case` and running `nudo infer` -- every output block below is a real run of the code above it.

### Truthiness Narrowing

When a value appears in a boolean context, Nudo removes falsy types (`null`, `undefined`, `false`, `""`, `0`) from the true branch.

```js
/**
 * @nudo:case "nullable name" (T.union(T.string, T.null, T.undefined))
 */
function greet(name) {
  if (name) {
    // name is string -- null and undefined removed
    return name.toUpperCase();
  }
  // name is null | undefined
  return "unknown";
}
```

**Before:** Nudo treated `name` as `string | null | undefined` in both branches. You would get a type error on `.toUpperCase()` even though the guard makes it safe.

**After:** The true branch knows `name` is `string`. The false branch knows it is `null | undefined`. No false positives. `nudo infer` confirms:

```text
=== greet ===

Case "nullable name": (string | null | undefined) => string | "unknown"
```

### Optional Chaining (`?.`)

Optional chaining now short-circuits correctly. When the receiver evaluates to `null` or `undefined`, the chain yields `undefined`; when the receiver is non-nullish, the property resolves like a plain access.

```js
/**
 * @nudo:case "object present" (T.object({ length: T.number }))
 * @nudo:case "null" (T.null)
 */
function getLength(maybeBox) {
  return maybeBox?.length ?? 0;
}
```

**Before:** The nullish short-circuit path was lost, so a `?.` access behaved like a plain access regardless of the receiver.

**After:** With the object present, `maybeBox?.length` resolves to `number` and the fallback never fires. With `null`, the chain short-circuits to `undefined` and `?? 0` produces the literal `0`:

```text
=== getLength ===

Case "object present": ({ length: number }) => number
Case "null": (null) => 0

Combined: number | 0
```

### Nullish Coalescing (`??`)

The `??` operator now removes `null` and `undefined` from the left operand's type. The result is the non-nullable left type or the right operand's type.

```js
/**
 * @nudo:case "config object" (T.object({ port: T.union(T.number, T.null, T.undefined) }))
 */
function getPort(config) {
  const port = config.port ?? 3000;
  // port is number
  return port;
}
```

**Before:** `config.port ?? 3000` was typed as `number | null | undefined | 3000`. The nullish coalescing semantics were not applied.

**After:** `config.port` is narrowed to `number` (null and undefined removed), and the result is `number`:

```text
=== getPort ===

Case "config object": ({ port: number | null | undefined }) => number
```

### Discriminated Union Narrowing

When you compare a property against a string literal, Nudo filters the union to keep only the members whose discriminating property matches.

```js
/**
 * @nudo:case "shape" (T.union(T.object({ kind: T.literal("circle"), radius: T.number }), T.object({ kind: T.literal("square"), side: T.number })))
 */
function area(shape) {
  if (shape.kind === "circle") {
    // shape: { kind: "circle", radius: number }
    return shape.radius * 3.14159;
  }
  // shape: { kind: "square", side: number }
  return shape.side * shape.side;
}
```

**Before:** Every branch saw the full union type. Accessing `shape.radius` outside the circle check would not error, and inside it would not narrow.

**After:** Each branch sees only the matching union member. The else branch is correctly narrowed to the remaining member:

```text
=== area ===

Case "shape": ({ kind: "circle", radius: number } | { kind: "square", side: number }) => number
```

This is the pattern that makes real-world API response handling safe.

### `in` Operator Narrowing

Using `"key" in obj` in a condition now narrows the object type to include only members that have that property.

```js
/**
 * @nudo:case "value" (T.union(T.object({ toJSON: () => "serialized" }), T.number))
 */
function serialize(value) {
  if ("toJSON" in value) {
    // value narrowed to types with a toJSON property
    return value.toJSON();
  }
  return String(value);
}
```

**Before:** The `in` check was ignored. `value` kept its original type in both branches.

**After:** The true branch narrows `value` to types that have a `toJSON` property. The false branch excludes those types:

```text
=== serialize ===

Case "value": ({ toJSON: () => ... } | number) => "serialized" | string
```

### Switch Statement Narrowing

Nudo now narrows the discriminant per `case` clause. Each case branch gets the type that matches that literal value.

```js
/**
 * @nudo:case "status" (T.union(T.literal("active"), T.literal("paused"), T.literal("stopped")))
 */
function describe(status) {
  switch (status) {
    case "active":
      return "Running";
    case "paused":
      return "On hold";
    case "stopped":
      return "Shut down";
    default:
      return "Unknown";
  }
}
```

**Before:** `status` was `string` in every case branch. The switch was treated as a flat sequence of branches.

**After:** `status` is `"active"` in the first case, `"paused"` in the second, `"stopped"` in the third. The default branch gets the remainder. If the union is fully exhausted, the default branch is typed as `never`:

```text
=== describe ===

Case "status": ("active" | "paused" | "stopped") => "Running" | "On hold" | "Shut down" | "Unknown"
```

### `Array.isArray()` Narrowing

Calling `Array.isArray(value)` in a condition now splits the type into array and non-array branches.

```js
/**
 * @nudo:case "input" (T.union(T.array(T.number), T.string))
 */
function flatten(input) {
  if (Array.isArray(input)) {
    // input: number[]
    return input[0];
  }
  // input: string
  return input;
}
```

**Before:** `Array.isArray` was not recognized as a type guard. Both branches saw the same type.

**After:** The true branch narrows `input` to array types. The false branch gets the non-array types:

```text
=== flatten ===

Case "input": (number[] | string) => number | string
```

### Summary Table

| Pattern | Condition | True Branch | False Branch |
|---|---|---|---|
| Truthiness | `if (x)` | Excludes `null`, `undefined`, `false`, `""`, `0` | Keeps falsy types |
| Optional Chaining | `x?.prop` | Receiver non-nullish: resolves like a plain access | Receiver nullish: result is `undefined` |
| Nullish Coalescing | `x ?? fallback` | Result excludes `null \| undefined` | N/A (expression) |
| Discriminated Union | `x.kind === "lit"` | Keeps matching union member | Keeps remaining members |
| `in` Operator | `"key" in x` | Keeps types with that property | Keeps types without it |
| Switch | `switch (x) { case ... }` | Narrows per case literal | Default gets remainder (`never` if exhausted) |
| `Array.isArray()` | `Array.isArray(x)` | Array types only | Non-array types only |

## Enhanced Editor Experience

The LSP server has been expanded from hover types and completions to a full-featured language server. Here is what the editor can do now.

### Go-to-Definition

Jump to the definition of a function, variable, or class. Place your cursor on an identifier and press `F12`. Nudo resolves the symbol within the current file and lands on its declaration.

```js
function process(data) {
  return transform(data);  // F12 on transform -> jumps to its definition
}
```

### Find References

Find all usages of a symbol across the current file. Press `Shift+F12` to see every location where a function or variable is referenced. This works on inferred symbols, not just annotated ones.

### Rename Symbol

Safely rename a symbol and all its references. Press `F2` and type the new name. Nudo validates that the new name does not conflict with existing symbols and updates every reference in the file.

### Signature Help

When typing inside a function call's parentheses, Nudo shows parameter hints based on the inferred signature. This activates automatically when you type `(` or `,`.

```js
/**
 * @nudo:case "test" (T.string, T.number)
 */
function createUser(name, age) { ... }

createUser(  // signature help shows: (name: string, age: number)
```

### Code Actions

When Nudo reports diagnostics, quick fix suggestions are available. Click the lightbulb icon or press `Cmd+.` / `Ctrl+.` to see available fixes:

- **Remove unreachable code** -- for code after `return` or `throw`
- **Update `@nudo:returns`** -- when the assertion does not match the inferred type

### Semantic Tokens

Nudo provides syntax highlighting based on inferred types. Functions, variables, and dead code are highlighted differently from standard syntax coloring. Dead code after a `return` statement is dimmed. Variables that are refined by narrowing get distinct coloring.

### What This Means

If you are using the VS Code extension, the editor experience now feels like working with a typed language. You get hover information, jump-to-definition, rename refactoring, and signature help -- all inferred from plain JavaScript with no annotations beyond `@nudo:` directives.

## AI Agent Integration

:::note Update
The standalone MCP server described below was later retired. Agent integration now lives in `@nudojs/lsp` — the same five capabilities are exposed as `workspace/executeCommand` commands (`nudo.whatIf` and friends) on the language server. See the [Agent Integration Guide](https://nudojs.github.io/nudo/docs/guides/mcp-server).
:::

This is the feature we are most excited about. Nudo now ships an MCP (Model Context Protocol) server that exposes five tools to AI assistants. This means an AI agent can query Nudo's type inference engine in real time while reading or writing code.

### The Five Tools

**`nudo-what-if`** -- The killer feature. Set type assumptions and observe inferred types at other positions. An AI agent can ask "what type does this variable end up with?" and get a concrete answer without running the code.

```
Input:  file="src/config.js", bindings=[{name: "config", type: "{ retries: number, label: string }"}], target="config"
Output: Type of "config": { retries: 3, label: "fast" }
```

This is powerful for code review, bug hunting, and refactoring. The agent can query the precise inferred type of any binding -- the same thing a human developer does mentally, but with precision. (In this release the returned type comes from the file's own analysis; the `bindings` assumptions do not override it yet.)

**`nudo-trace`** -- Trace how a type transforms from input to output in a function. The agent gets one line per `@nudo:case` showing the argument types and the result type, making it possible to understand complex data pipelines without reading every line.

```
Input:  file="src/greet.js", functionName="greet"
Output: Input: ("Ada") => Output: "Hello, Ada"
        Input: ("") => Output: "Hello, "
```

**`nudo-check`** -- Check a file for type errors and diagnostics. The agent gets one line per diagnostic (`Line 3: <message>`) or `No type errors found`, in machine-readable form.

**`nudo-type-at`** -- Get the inferred type at a specific position in a file. The agent can point at any line (1-based) and column (0-based) and get the exact type Nudo infers there.

**`nudo-suggest-case`** -- Check a function's `@nudo:case` coverage. If the function already has cases, the agent learns how many; if it has none, the tool reminds the agent to add a `@nudo:case` directive.

### Why This Matters

AI agents are good at generating code but bad at verifying it. They produce plausible-looking output that often has subtle type errors -- accessing properties that might be `undefined`, calling methods that do not exist on the actual type, or passing arguments in the wrong order.

With the MCP server, an agent can validate its own output. It can generate code, run `nudo-check` to find type errors, use `nudo-what-if` to explore edge cases, and fix the issues before presenting the result. This closes the loop between generation and verification.

### Setup

Connect the MCP server to any MCP-compatible client:

```json
{
  "mcpServers": {
    "nudo": {
      "command": "npx",
      "args": ["@nudojs/mcp"]
    }
  }
}
```

The server starts on stdio and exposes all five tools. No configuration needed.

## Runtime Type Generation

Nudo's type inference does not stop at static analysis. You can now generate runtime validators directly from inferred types, creating a bridge between development-time inference and production-time validation.

The workflow: JS code -> Nudo infers types -> Generate validators -> Runtime validation.

### The `nudo generate` Command

```bash
nudo generate src/api/users.js --format all
```

This reads the inferred types from a source file and emits validators in one or more formats. Output goes to stdout -- redirect it to a file to save it (`--output` is declared but not implemented in this release).

### Zod Schema Generation

With `--format zod`, Nudo produces Zod schema strings derived from inferred types.

Given this source file:

```js
/**
 * @nudo:case "input" (T.object({ name: T.string, age: T.number }))
 */
function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}
```

Running `nudo generate src/api/users.js --format zod` prints:

```text
// === createUser Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), age: z.number() }) }
// Output: z.object({ id: z.literal(123), name: z.string(), age: z.number() })
```

The schema is emitted as a comment block, one per case, with the inferred literal `123` pinned via `z.literal`. Paste it into a `.ts` file to use it directly with React Hook Form, tRPC, Next.js API routes, and any framework that accepts Zod schemas.

### Native Type Guards

With `--format guard`, Nudo generates zero-dependency runtime type guard functions. These are plain JavaScript functions with no external imports, making them ideal for libraries, edge functions, or any context where bundle size matters.

```text
// === createUser Type Guards ===
export function iscreateUserInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 123 && typeof data.name === 'string' && typeof data.age === 'number';
}
```

Each case gets one guard, named `is<function><case>Output`. Guard functions execute a sequence of `typeof` and literal-equality checks with no schema interpretation overhead. In benchmarks, generated guards outperform schema interpreters (Zod, Yup, io-ts) by 2-10x for validation-heavy workloads.

### TypeScript Declarations

With `--format dts`, Nudo generates `.d.ts` declarations from the inferred signature. Parameters are positional (`arg0`, `arg1`) and the return type is the inferred result, with inferred literals preserved:

```text
// === createUser TypeScript Declarations ===
export declare function createUser(arg0: { name: string; age: number }): { id: 123; name: string; age: number };
```

Consuming TypeScript code gets type safety without any manual annotations.

### End-to-End Workflow

1. Write plain JavaScript with `@nudo:` directives
2. Run `nudo generate --format all` to print Zod schemas, type guards, and `.d.ts` declarations (redirect stdout to save them as files)
3. Use Zod schemas for form validation and API input checking
4. Use type guards for fast runtime checks in hot paths
5. Use `.d.ts` files for TypeScript consumers of your library

You write plain JavaScript. Nudo infers the types. The generated validators keep your runtime safe. The generated declarations keep your TypeScript consumers happy. No duplication, no drift.

## What's Next

This release covers the core infrastructure. Here is what is coming next:

- **Cross-file inference** -- Follow imports and infer types across module boundaries. Right now Nudo analyzes one file at a time. Cross-file support will unlock analysis of real codebases without manual `@nudo:case` on every entry point.
- **Wider narrowing patterns** -- `typeof` guards with else-branch narrowing, `instanceof` checks, and custom type guard function recognition.
- **MCP tool expansion** -- Refactoring suggestions, test case generation, and automated `@nudo:case` annotation from existing test suites.
- **Performance optimizations** -- Caching and incremental analysis for large files and watch mode.

Nudo is built on the idea that types should be derived from behavior, not declared by hand. Every feature in this release moves toward that goal: the narrowing engine understands your control flow, the LSP brings types into your editor, the MCP server brings types to your AI tools, and the generator brings types to your runtime.

Install the latest version and try it on your codebase:

```bash
pnpm add -D @nudojs/cli @nudojs/lsp
nudo infer src/
```

If you find a case Nudo gets wrong, open an issue. That is how the narrowing engine gets better.
