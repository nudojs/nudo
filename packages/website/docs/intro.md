---
sidebar_position: 1
slug: /intro
description: Discover Nudo, a type inference engine that derives JavaScript types by executing code with symbolic type values — no annotations required.
---

# Introduction

**Nudo** is a type inference engine for JavaScript that uses **abstract interpretation** — executing your code with symbolic "type values" instead of concrete values to derive types. No annotations required, no build step. Just plain JavaScript and runtime-based type inference. TypeScript sources are also accepted: type annotations are stripped and the code is inferred with plain JS semantics.

## How It Works

Instead of static analysis or type annotations, Nudo actually *executes* your functions — but with symbolic inputs like `T.number` or `T.string`. The engine tracks how values flow through branches, operators, and calls, and produces the inferred return type. This makes it possible to infer types for complex logic that static analyzers struggle with.

## Nudo vs TypeScript

| TypeScript | Nudo |
|------------|------|
| Declare types up front; compiler checks usage | Write plain JavaScript; engine infers types by executing it |
| Requires `.ts` files or JSDoc annotations | Optional comment directives like `@nudo:case` — in `.js` or `.ts` files |
| Types describe intent | Types are derived from actual behavior |

**Example: a function with branching logic**

```javascript
/**
 * @nudo:case "strings" (T.string)
 * @nudo:case "numbers" (T.number)
 */
function process(x) {
  if (typeof x === "string") return x.length;
  return x * 2;
}
```

With `@nudo:case` directives, you tell Nudo which inputs to "execute" with. For `"strings"`, it runs with `T.string` → infers `number`. For `"numbers"`, it runs with `T.number` → infers `number`. Nudo can combine these to produce a final type.

**With TypeScript**, you would typically annotate `x: string | number` and `: number` yourself. Nudo infers both from execution.

## Beyond TypeScript

Nudo can infer types that TypeScript's type system cannot express:

```javascript
// String concatenation preserves structure
"0x" + T.string                // → `0x${string}` (TS: string)

// String methods compute precise results on literals
"hello".toUpperCase()          // → "HELLO" (TS: string)
"a,b,c".split(",")            // → ["a", "b", "c"] (TS: string[])

// Loops evaluate at type level
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// sum → 10 (TS: number)
```

Users can also define custom refined types with domain-specific operation rules via `T.refine`. See [Examples](./guides/examples.md) for more.

## What's Next

- **[Installation](./getting-started/installation.md)** — Install the CLI, VS Code extension, and Vite plugin
- **[Quick Start](./getting-started/quick-start.md)** — Run `nudo infer` on your first file
- **[Core Concepts](./concepts/type-values.md)** — Type values, directives, and abstract interpretation
- **[Call-Site Discovery](./guides/callsite-discovery.md)** — Let Nudo mine your tests for real call shapes instead of writing cases by hand
- **[Language Semantics](./guides/semantics.md)** — The JavaScript behaviors Nudo models precisely, from `this` binding to promise resolution
