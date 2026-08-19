---
sidebar_position: 7
description: Generate Zod schemas, zero-dependency type guards, and TypeScript declarations from Nudo's inferred types with `nudo generate`.
---

# Runtime Type Generation

Nudo's type inference doesn't stop at static analysis. You can generate runtime validators directly from inferred types, creating a seamless bridge between development-time inference and production-time validation.

```text
JS code → Nudo infers types → Generate validators → Runtime validation
```

This means you write plain JavaScript, let Nudo figure out the types, and then produce fully typed runtime checks -- no hand-written validators, no duplicate type definitions.

All generated output is printed to stdout. Pipe or paste it into your project's files wherever they belong.

## The `nudo generate` Command

```bash
nudo generate <file> [options]
```

| Option | Description |
|---|---|
| `--format <format>` | Output format: `zod`, `guard`, `dts`, `all` (default: `all`) |
| `--output <dir>` | Declared but **not implemented yet** -- output always goes to stdout. Redirect with your shell instead. |

Running `nudo generate` reads the inferred types from a source file and prints validators in the requested format.

### Basic Usage

```bash
# Print all formats (zod, guard, dts)
nudo generate src/api/users.js

# Print only Zod schemas
nudo generate src/api/users.js --format zod

# Capture stdout into a file yourself
nudo generate src/api/users.js --format zod > users.schema.txt
```

## Example Source

All examples on this page use the file below. Note the real directive syntax: `@nudo:case "<name>" (<type expression>)` -- the case name is quoted and the type expression is wrapped in parentheses, using `T.*` constructors.

```js
// src/api/users.js

// @nudo:case "input" (T.object({ name: T.string, age: T.number }))
function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}
```

## Zod Schema Generation

With `--format zod`, Nudo prints [Zod](https://zod.dev) schema expressions for each case's input and output types. The schemas are emitted as comments -- copy the expressions out of them and assemble your own schema module.

```bash
nudo generate src/api/users.js --format zod
```

Output (stdout):

```js
// === createUser Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), age: z.number() }) }
// Output: z.object({ id: z.literal(123), name: z.string(), age: z.number() })
```

Note `z.literal(123)`: literal values in the source (`id: 123`) are inferred as literal types, so the output schema pins the exact value.

### Assembling a Schema Module

Paste the printed expressions into a module and export them:

```js
// src/api/users.schema.js -- assembled from the output above
import { z } from "zod";

export const createUserInput = z.object({ name: z.string(), age: z.number() });
export const createUserOutput = z.object({ id: z.literal(123), name: z.string(), age: z.number() });
```

### Integration with Frameworks

**React Hook Form** -- use the assembled schema as a form resolver:

```js
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserInput } from "./api/users.schema.js";

const { register, handleSubmit } = useForm({
  resolver: zodResolver(createUserInput),
});
```

**tRPC** -- use the schema for input/output validation in procedures:

```js
import { createUserInput, createUserOutput } from "./api/users.schema.js";

const appRouter = router({
  createUser: publicProcedure
    .input(createUserInput)
    .output(createUserOutput)
    .mutation(({ input }) => createUser(input)),
});
```

**Next.js API Routes** -- validate request bodies:

```js
import { createUserInput } from "./api/users.schema.js";

export async function POST(request) {
  const body = await request.json();
  const parsed = createUserInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues }, { status: 400 });
  }
  const user = createUser(parsed.data);
  return Response.json(user);
}
```

## Native Guard Generation

With `--format guard`, Nudo prints zero-dependency runtime type guard functions. These are plain JavaScript functions with no external imports, making them ideal for libraries, edge functions, or any context where bundle size matters.

Guards are named `is` + function name + case name + `Output` (one guard per case, validating the case's output type):

```bash
nudo generate src/api/users.js --format guard
```

Output (stdout):

```js
// === createUser Type Guards ===
export function iscreateUserInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 123 && typeof data.name === 'string' && typeof data.age === 'number';
}
```

Save the printed function into a module (for example `src/api/users.guard.js`) and import it.

### Performance Advantage

Guard functions execute a sequence of `typeof` checks with no schema interpretation overhead. In benchmarks, hand-written or generated guards consistently outperform schema interpreters (Zod, Yup, io-ts) by 2-10x for validation-heavy workloads. When validating large payloads at high frequency, this difference adds up.

## TypeScript Declarations

With `--format dts`, Nudo prints one widened signature per function — the same output as `nudo infer <file> --dts`. Three things to know:

- Parameter names come from your source (e.g. `input`); positional `arg0`, `arg1` fallbacks only appear when the declaration node has no recoverable name.
- Parameter positions (contravariant) are widened: literal parameters collapse to their base types (`"hello"` → `string`, `[1, 2, 3]` → `number[]`), so callers can pass any compatible value. Return types keep their inferred precision, including nested literals.

```bash
nudo generate src/api/users.js --format dts
```

Output (stdout):

```ts
// === createUser TypeScript Declarations ===
/**
 * @param input - { name: string; age: number }
 * @returns { id: 123; name: string; age: number }
 */
export declare function createUser(input: { name: string; age: number }): { id: 123; name: string; age: number };
```

With multiple `@nudo:case` directives, the signature is still single — parameters union and widen across cases, and each case's precise result is preserved in the JSDoc:

```js
// @nudo:case "string input" ("hello")
// @nudo:case "number input" (42)
function formatValue(value) {
  return String(value);
}
```

```bash
nudo generate src/api/format.js --format dts
```

```ts
// === formatValue TypeScript Declarations ===
/**
 * Case: string input ("hello") => "hello"
 * Case: number input (42) => "42"
 * @param value - string | number
 * @returns string
 */
export declare function formatValue(value: string | number): string;
```

To write a `.d.ts` file next to the source instead of printing it, use `nudo infer <file> --dts`.

## JSON Output

For programmatic consumption and CI/CD integration, use `nudo infer --json` to get machine-readable output.

```bash
nudo infer src/api/users.js --json
```

Output structure:

```json
{
  "functions": [
    {
      "name": "createUser",
      "loc": {
        "start": {
          "line": 4,
          "column": 0
        },
        "end": {
          "line": 6,
          "column": 1
        }
      },
      "cases": [
        {
          "name": "input",
          "args": [
            "{ name: string, age: number }"
          ],
          "result": "{ id: 123, name: string, age: number }",
          "throws": null,
          "source": null
        }
      ],
      "entryOnly": false
    }
  ],
  "diagnostics": []
}
```

Each entry in `functions` contains:

- `name` and `loc` -- the function name and its source location.
- `cases` -- one entry per case. `args` lists the argument types, `result` is the return type, `throws` is the thrown type or `null`. `source` is `null` for `@nudo:case` directives, or `"callsite"` for cases synthesized from whole-program call-site discovery.
- `entryOnly` -- `true` when the function had no call sites anywhere in the program.

### CI/CD Integration

Use JSON output in pipelines to enforce type contracts. `infer` takes file paths, not directories:

```bash
# Fail if any diagnostics are reported
nudo infer src/api/users.js --json | jq '.diagnostics | length == 0'
```

Print validators as part of your build and capture stdout into your project:

```json
{
  "scripts": {
    "generate": "nudo generate src/api/users.js --format zod > src/api/users.schema.txt",
    "build": "npm run generate && tsc && vite build"
  }
}
```

## Complete Workflow

Here is an end-to-end example from source code to runtime validation.

**1. Write plain JavaScript with a Nudo directive:**

```js
// src/api/products.js

// @nudo:case "input" (T.object({ name: T.string, price: T.number, tags: T.array(T.string) }))
function createProduct(input) {
  return {
    id: 456,
    name: input.name,
    price: input.price,
    tags: input.tags,
  };
}
```

**2. Print all validator formats:**

```bash
nudo generate src/api/products.js --format all
```

Output (stdout):

```text
// === createProduct Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), price: z.number(), tags: z.array(z.string()) }) }
// Output: z.object({ id: z.literal(456), name: z.string(), price: z.number(), tags: z.array(z.string()) })

// === createProduct Type Guards ===
export function iscreateProductInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 456 && typeof data.name === 'string' && typeof data.price === 'number' && Array.isArray(data.tags) && data.tags.every(item => typeof item === 'string');
}

// === createProduct TypeScript Declarations ===
/**
 * @param input - { name: string; price: number; tags: string[] }
 * @returns { id: 456; name: string; price: number; tags: string[] }
 */
export declare function createProduct(input: { name: string; price: number; tags: string[] }): { id: 456; name: string; price: number; tags: string[] };
```

**3. Paste the pieces you need into your application:**

```js
// src/api/products.guard.js -- pasted from the stdout above
export function iscreateProductInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 456 && typeof data.name === 'string' && typeof data.price === 'number' && Array.isArray(data.tags) && data.tags.every(item => typeof item === 'string');
}
```

```js
// src/api/products.schema.js -- assembled from the Zod lines above
import { z } from "zod";

export const createProductInput = z.object({ name: z.string(), price: z.number(), tags: z.array(z.string()) });
```

```js
import { iscreateProductInputOutput } from "./api/products.guard.js";
import { createProductInput } from "./api/products.schema.js";

// Fast guard check (zero dependencies)
if (!iscreateProductInputOutput(body)) {
  throw new ValidationError("Invalid product data");
}

// Or use Zod for detailed error messages
const result = createProductInput.safeParse(body);
if (!result.success) {
  return Response.json({ errors: result.error.issues }, { status: 400 });
}
```

**4. Use the declarations for type safety in consuming TypeScript code:**

Paste the declaration line into a `.d.ts` next to your source:

```ts
// src/api/products.d.ts -- pasted from the stdout above
/**
 * @param input - { name: string; price: number; tags: string[] }
 * @returns { id: 456; name: string; price: number; tags: string[] }
 */
export declare function createProduct(input: { name: string; price: number; tags: string[] }): { id: 456; name: string; price: number; tags: string[] };
```

```ts
// Consumer code sees full types without any manual annotations
import { createProduct } from "./api/products.js";

const product = createProduct({ name: "Widget", price: 9.99, tags: ["sale"] });
//    ^? { id: 456; name: string; price: number; tags: string[] }
```

With a single directive line per function, this workflow provides full runtime safety and editor support across the JavaScript/TypeScript boundary.
