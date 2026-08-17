---
sidebar_position: 7
---

# Runtime Type Generation

Nudo's type inference doesn't stop at static analysis. You can generate runtime validators directly from inferred types, creating a seamless bridge between development-time inference and production-time validation.

```
JS code → Nudo infers types → Generate validators → Runtime validation
```

This means you write plain JavaScript, let Nudo figure out the types, and then produce fully typed runtime checks -- no hand-written validators, no duplicate type definitions.

## The `nudo generate` Command

```bash
nudo generate <file> [options]
```

| Option | Description |
|---|---|
| `--format <format>` | Output format: `zod`, `guard`, `dts`, `all` (default: `all`) |
| `--output <dir>` | Output directory (default: `.`) |

Running `nudo generate` reads the inferred types from a source file and emits validators in one or more formats.

### Basic Usage

```bash
# Generate all formats
nudo generate src/api/users.js

# Generate only Zod schemas
nudo generate src/api/users.js --format zod

# Output to a specific directory
nudo generate src/api/users.js --output generated/
```

## Zod Schema Generation

With `--format zod`, Nudo produces [Zod](https://zod.dev) schema strings derived from inferred types. This is useful when you want to integrate with the broader Zod ecosystem.

### Example

Given this source file:

```js
// src/api/users.js

/**
 * @nudo:case { name: string, age: number }
 * @nudo:returns { id: number, name: string, age: number }
 */
function createUser(input) {
  return { id: Date.now(), name: input.name, age: input.age };
}
```

Running:

```bash
nudo generate src/api/users.js --format zod --output generated/
```

Produces:

```ts
// generated/users.zod.ts
import { z } from "zod";

export const CreateUserInput = z.object({
  name: z.string(),
  age: z.number(),
});

export const CreateUserOutput = z.object({
  id: z.number(),
  name: z.string(),
  age: z.number(),
});
```

### Integration with Frameworks

**React Hook Form** -- use the generated schema as a form resolver:

```js
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateUserInput } from "./generated/users.zod";

const { register, handleSubmit } = useForm({
  resolver: zodResolver(CreateUserInput),
});
```

**tRPC** -- use the schema for input/output validation in procedures:

```js
import { CreateUserInput, CreateUserOutput } from "./generated/users.zod";

const appRouter = router({
  createUser: publicProcedure
    .input(CreateUserInput)
    .output(CreateUserOutput)
    .mutation(({ input }) => createUser(input)),
});
```

**Next.js API Routes** -- validate request bodies:

```js
import { CreateUserInput } from "./generated/users.zod";

export async function POST(request) {
  const body = await request.json();
  const parsed = CreateUserInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues }, { status: 400 });
  }
  const user = createUser(parsed.data);
  return Response.json(user);
}
```

## Native Guard Generation

With `--format guard`, Nudo generates zero-dependency runtime type guard functions. These are plain JavaScript functions with no external imports, making them ideal for libraries, edge functions, or any context where bundle size matters.

### Example

```bash
nudo generate src/api/users.js --format guard --output generated/
```

Produces:

```ts
// generated/users.guard.ts

export function isCreateUserInput(data: unknown): data is {
  name: string;
  age: number;
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.age !== "number") return false;
  return true;
}

export function isCreateUserOutput(data: unknown): data is {
  id: number;
  name: string;
  age: number;
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== "number") return false;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.age !== "number") return false;
  return true;
}
```

### Performance Advantage

Guard functions execute a sequence of `typeof` checks with no schema interpretation overhead. In benchmarks, hand-written or generated guards consistently outperform schema interpreters (Zod, Yup, io-ts) by 2-10x for validation-heavy workloads. When validating large payloads at high frequency, this difference adds up.

## TypeScript Declarations

With `--format dts`, Nudo generates `.d.ts` files with real parameter names extracted from the source, JSDoc comments with `@param` and `@returns` tags, and multiple overloads when multiple `@nudo:case` directives are present.

### Example

```bash
nudo generate src/api/users.js --format dts --output generated/
```

Produces:

```ts
// generated/users.d.ts

/**
 * Creates a new user record.
 *
 * @param input - The user data to create.
 * @param input.name - The user's display name.
 * @param input.age - The user's age in years.
 * @returns The newly created user with an assigned id.
 */
export function createUser(input: {
  name: string;
  age: number;
}): {
  id: number;
  name: string;
  age: number;
};
```

When multiple `@nudo:case` directives are present, the generated declaration includes overloads:

```ts
export function formatValue(value: string): string;
export function formatValue(value: number): string;
export function formatValue(value: boolean): string;
```

## JSON Output

For programmatic consumption and CI/CD integration, use `nudo infer --json` to get machine-readable output.

```bash
nudo infer src/api/users.js --json
```

Output structure:

```json
{
  "functions": {
    "createUser": {
      "cases": [
        {
          "params": [
            {
              "name": "input",
              "type": "{ name: string; age: number }"
            }
          ],
          "return": "{ id: number; name: string; age: number }"
        }
      ]
    }
  },
  "diagnostics": []
}
```

### CI/CD Integration

Use JSON output in pipelines to enforce type contracts:

```bash
# Fail if any diagnostics are reported
nudo infer src/ --json | jq '.diagnostics | length == 0'
```

Generate validators as part of your build:

```json
{
  "scripts": {
    "generate": "nudo generate src/api/ --format all --output generated/",
    "build": "npm run generate && tsc && vite build"
  }
}
```

## Complete Workflow

Here is an end-to-end example from source code to runtime validation.

**1. Write plain JavaScript with Nudo directives:**

```js
// src/api/products.js

/**
 * @nudo:case { name: string, price: number, tags: string[] }
 * @nudo:returns { id: number, name: string, price: number, tags: string[] }
 */
function createProduct(input) {
  return {
    id: Date.now(),
    name: input.name,
    price: input.price,
    tags: input.tags,
  };
}
```

**2. Generate all validator formats:**

```bash
nudo generate src/api/products.js --format all --output src/generated/
```

**3. Use the generated validators in your application:**

```js
import { isCreateProductInput } from "./generated/products.guard";
import { CreateProductInput } from "./generated/products.zod";

// Fast guard check (zero dependencies)
if (!isCreateProductInput(body)) {
  throw new ValidationError("Invalid product data");
}

// Or use Zod for detailed error messages
const result = CreateProductInput.safeParse(body);
if (!result.success) {
  return Response.json({ errors: result.error.issues }, { status: 400 });
}
```

**4. Use the declarations for type safety in consuming TypeScript code:**

```ts
// Consumer code sees full types without any manual annotations
import { createProduct } from "./api/products";

const product = createProduct({ name: "Widget", price: 9.99, tags: ["sale"] });
//    ^? { id: number; name: string; price: number; tags: string[] }
```

This workflow keeps your source code annotation-free while providing full runtime safety and editor support across the boundary.
