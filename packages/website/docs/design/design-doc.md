---
description: "Nudo by design: Abs = shape × term × pred × conf as the single type system, extensional projection for display, directives, and what executing code computes that a separate type language cannot."
---

# Design Document

> **Nudo** — A type inference engine for JavaScript. The type system is **Abs** (`shape × term × pred × conf`); types are computable values with constraints that participate in algebra. There is no second IR: dts/LSP/serialization consume Abs directly, and the extensional view is a one-way, lossy rendering. Production analysis is Abs-native.

---

## 1. Vision & Core Insight

### 1.1 The Problem

TypeScript's type system is powerful, but it runs in a **separate language** from JavaScript. Complex type-level computation requires "type gymnastics"—conditional types, mapped types, `infer`, template literal types—a programming model entirely different from the value-level JavaScript developers write daily.

```typescript
// What developers write at the value level (intuitive):
function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

// What they must write at the type level (obscure):
type Transform<T> =
  T extends string ? Uppercase<T> :
  T extends number ? number :
  null;
```

These two representations describe **the same logic** yet live in two disconnected worlds. When logic grows complex, keeping them in sync is painful and error-prone.

### 1.2 Core Insight

**What if the value-level code were the type-level computation itself?**

Nudo neither statically analyzes code like TypeScript nor runs code with concrete values like tests. Instead, it **executes code with abstract values (Abs)**—types that carry shape, a symbolic term, and constraints. Execution itself produces types; constraints propagate through arithmetic (`x>0` ⇒ `x+1>1`).

```text
Traditional:   Source code  →  Static analysis  →  Types
Nudo:          Source code  +  Abs  →  Execution  →  Types + constraints
```

This is not "induction from samples" (inferring from finite examples). It is **Abstract Interpretation**—a well-established technique from programming language theory—presented in the familiar mental model of "running code."

### 1.3 Key Distinction: Concrete vs. Symbolic Execution

| Approach | Input | Output | Completeness |
|----------|-------|--------|--------------|
| Unit tests | Concrete values (`1`, `"hello"`) | Concrete result | Only test cases |
| Nudo | Abs (`shape × term × pred`) | Abs (rendered extensionally for display) | All values in the abstract set |
| TypeScript | AST (no execution) | Types | All syntactic paths |

When Nudo executes `transform` on abstract string input, the engine propagates that Abs through the body. At `typeof x === "string"`, the engine knows that branch is taken. At `x.toUpperCase()`, the result stays string-shaped. The result is not a concrete value—it is an **Abs**.

---

## 2. Type System: Abs

### 2.1 Abs — the type system

**Abs** is the only type system: `shape × term × pred × conf`.

| Component | Meaning |
|-----------|---------|
| **shape** | Structural kind: `any` / `unknown` / `prim` / `obj` / `arr` / `tuple` / `fn` / `brand` / `eff` / `sum` / `never` |
| **term** | Symbolic identity of the value: literal, variable, or application (`x+1`) |
| **pred** | Constraint relative to the term: `x>0`, conjunctions, … |
| **conf** | Confidence: `exact` / `path` / `widened` / `partial` / `opaque` |

`any` means "any JS value" (unconstrained parameter). `unknown` means "analysis has no information." They are not the same.

Operations on Abs are algebraic: monotonic arithmetic, comparison, `leq` assignability, predicate implication. `nudo check` is the CI gate over this algebra (recall = precision = 1.0 on gold).

### 2.2 Extensional projection (not a second type system)

There is no second IR. dts (`Case:` JSDoc rows), the LSP hover surface, serialization, and the `*.nudo.js` template constraints all consume **Abs directly** — the extensional view is a rendering (`formatShape` for display, `absToTSType` / `absToSchemaSource` / `projectAbsToSchema` / guard generators for projections). Rendering is lossy by design (`formatShape` drops non-literal terms), but nothing round-trips: analysis never reads a projection back. Production analysis runs Abs natively (B-path transpile+exec, ast-eval fallback).

### 2.3 Design Principles

**Principle 1: Literal preservation.** When all inputs are literals, the result should be a literal.

```javascript
combine(5, 3)   // → 8  #exact, not number
"ab" + "c"      // → "abc"  #exact
```

**Principle 2: Widen when abstract.** When any input is abstract (non-literal), the result widens to the corresponding domain — but preserves structure where the algebra can (template strings keep the known prefix as pred metadata).

```javascript
1 + number        // → number  #path
"0x" + string     // → string  #path, template metadata tracked internally
```

**Principle 3: Lazy union distribution.** Unions propagate as a whole and are expanded only when an operator **must distinguish** members. This avoids combinatorial explosion from Cartesian products — and preserves correlation (`a + a` keeps one symbolic variable: `(A1 + A1)`, never `A1 + A1'`).

```javascript
function selfAdd(a) { return a + a; }
selfAdd(1);  // → 2  #exact
selfAdd(2);  // → 4  #exact
// Observed: 2 | 4 — never 1+1 | 1+2 | 2+1 | 2+2
```

**Principle 4: Guard narrowing.** Type guards (`typeof`, `instanceof`, truthiness checks) narrow values in branches.

```javascript
function process(x) {          // x: number | string
  if (typeof x === "string") {
    // In this branch, x is narrowed to string
  }
}
```

### 2.4 Abs API

```typescript
// --- Construction (analysis / tests / env modules) ---
numLit(value)                 // Exact number literal
strLit(value)                 // Exact string literal
num() / str() / bool()        // Primitive domains
never / unknown               // Empty set / universal set (constants)
obj({ key: { value, optional? } })  // Object shape
abs(shape, term, pred, conf)  // General constructor
absFunction(params, { body, env, apply })  // Function values

// --- Introspection ---
formatShape(a)                // Extensional rendering: "number", "1 | 2", "string | number"
formatAbs(a)                  // Lossless: shape, = term, where pred, #conf
leqAbs(src, tgt)              // Assignability (the algebra's subtype check)
```

Source-level contracts use `@nudo:refine` + `*.nudo.js` templates (constraint builders), not raw constructors.

### 2.5 Operator Semantics (Abs-native surface)

Arithmetic, comparison, unary, and spread are algebraic on Abs — there is no separate `Ops` layer and no routing to another IR. The language surface lives in three places:

- `core/src/algebra/surface.ts` — `typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs` (unary ops and strict equality, on Abs).
- `core/src/algebra/arithmetic.ts` — binary arithmetic (`add` / `sub` / `mul` / `div` / `mod` / `cmp`): monotonicity + constant folding + constraint propagation, on Abs.
- `service/src/evaluator/abs-route.ts` — object `join` / φ-merge helpers when branches must merge object shapes.

```typescript
// Binary arithmetic routes through the algebra:
add(left, right)    // number + number, string/template concat
cmp("<", left, right)  // numeric/string comparison
```

Refined subsets (template strings, numeric ranges) carry their constraints as Preds on terms, not as override tables; the algebra reads those preds during `+`/comparison.

---

## 3. Evaluation Engine (Nudo Engine)

### 3.1 Architecture Overview

```text
parser ──▶ core
            ├── algebra/     ← type system (Abs / Term / Pred / Φ / check)
            └── format       ← extensional rendering (dts / hover / serialization)
                 │
                 ▼
            service/evaluator    ← Abs-native: B-path (transpile+exec) → ast-eval
                 │
                 ▼
            service / lsp / vite / dts
```

| Component | Responsibility |
|-----------|----------------|
| **Parser** | Parse JS/TS source into AST (Babel) |
| **Directive Extractor** | Extract `@nudo:*` from comments; refine/import parsed in core |
| **algebra (Abs)** | Types as computation: eval, check, leq, generalize |
| **Evaluator (Abs-native)** | B-path transpile+exec; ast-eval fallback for non-B-hosted files |
| **surface / arithmetic / abs-route** | Arithmetic, comparison, unary, spread routed through algebra |
| **Environment** | Variable bindings (name → Abs) |

### 3.2 Evaluation Rules

The evaluator is an AST walker. For each node type, there is a corresponding rule:

**Literals:**
```text
eval(NumericLiteral 42)  →  lit(42)
eval(StringLiteral "hi") →  lit("hi")
eval(NullLiteral)       →  lit(null)
```

**Variables:**
```text
eval(Identifier "x")  →  env.lookup("x")
```

**Binary expressions:**
```text
eval(BinaryExpression { left, op, right })  →  arithmetic(op, eval(left), eval(right))
```

**Conditional (if-else):** The engine may **evaluate both branches** with narrowed values and merge:

```text
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)
  if condition === lit(true)   → eval(consequent)
  if condition === lit(false)  → eval(alternate)
  else:
    [envTrue, envFalse] = narrow(env, test)
    resultTrue  = eval(consequent, envTrue)
    resultFalse = eval(alternate, envFalse)
    return union(resultTrue, resultFalse)
```

### 3.3 Narrowing Rules

Narrowing refines values based on conditions (`typeof` / `===` / `Array.isArray` / `instanceof` / truthiness / `in` / `?.` / `??` / `switch` / discriminant fields). The full pattern table lives in [Abstract Interpretation](../concepts/abstract-interpretation.md#narrowing-rules); the verified-patterns walkthrough is [Control Flow Narrowing](../concepts/control-flow-narrowing.md).

---

## 4. Complex Structures

### 4.1 Loops

Loops use **bounded unrolling**, not fixed-point iteration. A concrete bound unrolls that many times. An abstract bound — whose test is never *definitely false* — unrolls up to a cap (`DEFAULT_MAX_LOOP_ITERS = 8`), a termination guard for abstract conditions. Within the cap the loop exits early when the test becomes definitely false, or when two adjacent loop states stop changing (`leqAbs`).

```javascript
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
```

A concrete bound accumulates element-wise to a literal. An abstract bound sums the first `0…7` iterations and reports `28 #exact`.

### 4.2 Closures and Higher-Order Functions

Functions are first-class Abs values (`fn` shape). When a function is passed as an argument, the engine evaluates calls through its Abs representation (parameters, body, closure environment).

### 4.3 Recursion

Recursion is bounded by a **call budget** (`MAX_CALL_DEPTH = 64`). A recursive call that re-enters a signature past the budget is truncated and its result widened to `unknown`, reported as `nudo:recursion-truncated` — there is no fixed-point refinement. Concrete base cases inside the budget still evaluate to literals.

### 4.4 Async / Promise

Promises are modeled as an effect shape (`eff`). `await` unwraps the promise; `async function` wraps the return value in `promise<...>`.

### 4.5 Exception and throws Tracking

Nudo tracks exceptions as a first-class part of function types. Each function has not only `returns` but also `throws`—a capability TypeScript's type system lacks. Try-catch removes thrown types from the function's `throws`; the catch parameter receives the union of thrown types.

### 4.6 Mutability (Reference Semantics, Copy-on-Write)

Object Abs values use **reference semantics**. Assignment copies references. When entering branches, modified objects are deep-copied so each branch has its own copy; merging unions the properties.

---

## 5. Directive System

Directives are structured comments that guide the engine. They use the `@nudo:` namespace.

| Directive | Purpose |
|-----------|---------|
| `@nudo:case` | Provide named execution cases (concrete or symbolic inputs) |
| `@nudo:mock` | Mock external dependencies with Abs-valued stubs |
| `@nudo:pure` | Mark function as pure for memoization |
| `@nudo:skip` | Skip evaluation; an optional constraint-builder expression declares the return type (e.g. `@nudo:skip number()`) |
| `@nudo:sample` | Reserved no-op (parsed, not consumed) |
| `@nudo:refine` | Refinement contract: `@nudo:refine param name` / `@nudo:refine return name` (Pred enters Abs) |
| `@nudo:env` | Declare runtime environment APIs (file-level `///` comment) |
| `@nudo:mock-module` | Replace imported modules with mock files (file-level `///` comment) |
| `@nudo:as` | Override the next statement's value type (line comment `//`) |
| `@nudo:replace` | Replace a sub-expression's type in the next statement (line comment `//`) |

Full syntax and constraints for every directive: see the [Directives reference](../concepts/directives.md).

---

## 6. Advantages Over TypeScript

### 6.1 No Separate Type Language

Value-level code is the type computation. No need to learn or maintain a parallel type language.

### 6.2 Computations TypeScript Cannot Express

Arithmetic, regex, and complex string operations are trivial in Nudo's execution model; in TypeScript's type system they are extremely difficult or impossible.

### 6.3 Third-Party JS Libraries

For libraries with JS source, Nudo can execute the code to derive types. For native or opaque dependencies, `@nudo:mock` provides Abs-aware stubs.

### 6.4 Dependent Types

Nudo naturally produces dependent types (types that depend on values) without special syntax:

```javascript
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
// clamp(5, 0, 10) → 5
// clamp(number, 0, 10) → number
```

### 6.5 Precise String Concatenation

Nudo preserves string structure through concatenation, producing template string types:

```javascript
function apiUrl(path) {           // path: string
  return "https://api.example.com" + path;
}
// Nudo: template with known prefix `https://api.example.com${string}`
// TypeScript: string (loses the known prefix)

apiUrl("/x").startsWith("https://")  // Nudo: true | TypeScript: boolean
```

### 6.6 Literal-Level String Method Inference

Nudo evaluates string methods on literals at compile time:

```javascript
"hello".toUpperCase()    // Nudo: "HELLO"     | TS: string
"hello".slice(1, 3)      // Nudo: "el"        | TS: string
"hello".startsWith("he") // Nudo: true        | TS: boolean
"a,b,c".split(",")       // Nudo: ["a","b","c"] | TS: string[]
```

### 6.7 Type-Level Loop Evaluation

Nudo evaluates loops with concrete bounds, computing exact results:

```javascript
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// Nudo: sum → 10 | TS: number
```

### 6.8 Declared Refinements (no type syntax)

User-facing contracts are declared with `@nudo:refine` and `*.nudo.js` templates — not `interface` / `type`:

```javascript
// shapes.nudo.js
export const positive = number().gt(0);
export const user = shape({ id: number().gt(0), name: string() });

// app.js
/// @nudo:import { positive, user } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}
```

The Pred enters Abs and participates in algebra (`x>0` ⇒ `x+1>1`). The template's constraint builders lower directly to term/pred constraints on Abs.

---

## 7. End-to-End Example: calc

**Source:**

```javascript
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (number(), number())
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}
```

**debug "concrete" — `calc(1, 2)`:**
1. Bind: `a = lit(1)`, `b = lit(2)`
2. Condition: `a > b` → `lit(false)`
3. Take alternate: `a + b` → `lit(3)`
4. Result: `lit(3)`

**debug "symbolic" — `calc(number(), number())`:**
1. Bind: `a = number`, `b = number`
2. Condition: `a > b` → `boolean` (abstract)
3. Fork both branches:
   - True: `a - b` → `number`
   - False: `a + b` → `number`
4. Merge: `number`

**Observed: ** `((1, 2) => 3) & ((number, number) => number)`

---

## 8. Implementation Roadmap

### Done
- **Evaluator MVP** — Babel, Abs evaluation, ops, narrowing, call-site observations + debug `@nudo:case`. (The original `infer` CLI verb was removed; observation is now `nudo check` / `nudo test`.)
- **Objects/arrays** — objects, arrays, tuples, Array methods, `@nudo:mock`.
- **Advanced language** — closures, recursion budget, async/Promise, try-catch, classes.
- **Tooling** — LSP, watch, `.d.ts`, Vite plugin, VS Code extension.
- **Refined IR** — template/range refinements; source contracts via `@nudo:refine`.
- **Abs algebra (single-track)** — Term/Pred/Abs, arithmetic kernel, `leqAbs`, generalize, `nudo check` / `nudo test` / `nudo contract` / `nudo export`, CheckJson, gold gates (recall = precision = 1.0).
- **Call budget** — depth/cycle/total guards so recursive check never stack-overflows.

### Open
- emit round-trip through tsc; harvest automation
- esbuild / webpack plugins; source maps for error locations

---

## 9. Appendices

### Related Work Comparison

| System | Approach | Strength | Limitation |
|--------|----------|----------|------------|
| TypeScript | Static analysis, structural types | Fast, mature, large ecosystem | Separate type language, limited computation |
| Flow | Static analysis, nominal types | Good inference | Declining adoption |
| io-ts / zod | Runtime schema validation | Bridges runtime and compile-time | Manual schema, not inference |
| Nudo | Abstract interpretation via execution | Unified value/type model, dependent types | New approach, operator coverage work |

### Operator Semantics Table (Non-Union)

| Operator | Literal × Literal | Literal × Abstract | Abstract × Abstract |
|----------|-------------------|--------------------|---------------------|
| `+` (numeric) | `lit(a + b)` | `number` | `number` |
| `+` (string) | `lit(a + b)` | `string` | `string` |
| `-`, `*`, `/`, `%` | `lit(op(a,b))` | `number` | `number` |
| `===`, `!==` | `lit(a === b)` | `boolean` | `boolean` |
| `>`, `<`, `>=`, `<=` | `lit(op(a,b))` | `boolean` | `boolean` |
| `typeof` | `lit("...")` | `lit("...")` | `string` |
| `!` | `lit(!a)` | `boolean` | `boolean` |
