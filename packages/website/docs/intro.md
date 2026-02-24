---
sidebar_position: 1
slug: /intro
---

# Introduction

**Nudo** is a type inference engine for JavaScript that uses **abstract interpretation** — executing your code with symbolic "type values" instead of concrete values to derive types. No TypeScript, no `.d.ts` files, no build step. Just annotated JavaScript and runtime-based type inference.

## How It Works

Instead of static analysis or type annotations, Nudo actually *executes* your functions — but with symbolic inputs like `T.number` or `T.string`. The engine tracks how values flow through branches, operators, and calls, and produces the inferred return type. This makes it possible to infer types for complex logic that static analyzers struggle with.

## Nudo vs TypeScript

| TypeScript | Nudo |
|------------|------|
| Declare types up front; compiler checks usage | Write plain JavaScript; engine infers types by executing it |
| Requires `.ts` files or JSDoc annotations | Uses comment directives like `@nudo:case` in `.js` files |
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

## What's Next

- **[Installation](/docs/getting-started/installation)** — Install the CLI, VS Code extension, and Vite plugin
- **[Quick Start](/docs/getting-started/quick-start)** — Run `nudo infer` on your first file
- **[Core Concepts](/docs/concepts/type-values)** — Type values, directives, and abstract interpretation
