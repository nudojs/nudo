---
sidebar_position: 1
description: "Nudo by design: Abs = shape × term × pred × conf as the type system, TypeValue as extensional projection, directives, and what executing code computes that a separate type language cannot."
---

# Design Document

> **Nudo** — A type inference engine for JavaScript. The type system is **Abs** (`shape × term × pred × conf`); types are computable values with constraints that participate in algebra. **TypeValue** is the extensional projection IR (dts/LSP/serialization and the `T` factory for `*.nudo.js` templates), not a parallel type system; production analysis is Abs-native. Abs ⇄ TypeValue goes through a lossy bridge.

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
| Nudo | Abs (`shape × term × pred`) | Abs (projected to TypeValue for display) | All values in the abstract set |
| TypeScript | AST (no execution) | Types | All syntactic paths |

When Nudo executes `transform` on abstract string input, the engine propagates that Abs through the body. At `typeof x === "string"`, the engine knows that branch is taken. At `x.toUpperCase()`, the result stays string-shaped. The result is not a concrete value—it is an **Abs**.

---

## 2. Type System: Abs and TypeValue IR

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

### 2.2 TypeValue — extensional projection (not a second type system)

TypeValue is what dts (`Case:` JSDoc rows and the Abs-less fallback), LSP hover surface, serialization, and the `T` factory (`*.nudo.js` templates) consume. It is a **projection** of Abs (`absToTypeValue` / `typeValueToAbs` in `bridge.ts`). The bridge is lossy: non-literal terms and non-encodable preds drop, and confidence must not pretend `exact` when information was lost. There is no TypeValue evaluator — production analysis runs Abs natively (B-path transpile+exec, ast-eval fallback).

```text
TypeValue
├── Literal<V>          — Single concrete value: 1, "hello", true, null, undefined
├── Primitive<T>        — All values of a primitive: number, string, boolean, bigint, symbol
├── RefinedType         — Subset of a base type (IR primitive; source contracts use @nudo:refine)
├── ObjectType          — Object with known property types
├── ArrayType / TupleType
├── FunctionType
├── UnionType
├── NeverType / UnknownType
```

### 2.3 Design Principles

**Principle 1: Literal preservation.** When all inputs are literals, the result should be a literal.

```javascript
T.literal(1) + T.literal(2)  // → T.literal(3), not T.number
```

**Principle 2: Widen when abstract.** When any input is abstract (non-literal), the result widens to the corresponding abstract type — but preserves structure through refined types when possible.

```javascript
T.literal(1) + T.number       // → T.number
T.literal("0x") + T.string    // → `0x${string}` (template refined type)
```

**Principle 3: Lazy union distribution.** Operations on unions are distributed over members, but using **lazy evaluation**—unions propagate as a whole and are expanded only when an operator **must distinguish** members. This avoids combinatorial explosion from Cartesian products.

```javascript
const a = T.union(T.literal(1), T.literal(2));
const b = T.union(T.literal("x"), T.literal("y"));

// No expansion—members need not be distinguished
const arr = [a, b];  // → T.tuple([T.union(1, 2), T.union("x", "y")])

// Expansion—operation requires distinguishing members
const sum = a + b;   // → expanded to 1+"x", 1+"y", etc. → union of literals
```

**Principle 4: Guard narrowing.** Type guards (`typeof`, `instanceof`, truthiness checks) narrow type values in branches.

```javascript
const x = T.union(T.number, T.string);
if (typeof x === "string") {
  // In this branch, x is narrowed to T.string
}
```

### 2.4 TypeValue IR API

```typescript
// --- Construction (IR / tests / env modules) ---
T.literal(value)              // Literal type value
T.number                      // Abstract number
T.string                      // Abstract string
T.boolean                     // Abstract boolean
T.null                        // Literal null
T.undefined                   // Literal undefined
T.unknown                     // unknown type
T.never                       // never type

T.object({ key: TypeValue })  // Object type
T.array(TypeValue)            // Array type
T.tuple([TypeValue, ...])     // Tuple type
T.union(TypeValue, ...)       // Union type
T.fn(params, body, closure)  // Function type
T.refine(base, refinement)   // IR primitive for refined subsets (templates/ranges)

// --- Introspection ---
typeValue.kind                // "literal" | "primitive" | "refined" | "object" | "array" | ...
typeValueToString(tv)         // Human-readable: "number", "1 | 2", "string | number"
isSubtypeOf(a, b)             // Subtype check (extensional; algebra uses leqAbs)
```

Source-level contracts use `@nudo:refine` + `*.nudo.js` templates, not `T.refine` in user code.

### 2.5 Operator Semantics (Abs-native surface)

Arithmetic, comparison, unary, and spread are algebraic on Abs — there is no separate `Ops` layer. The language surface lives in three places:

- `core/src/algebra/surface.ts` — `typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs` (unary ops and strict equality, on Abs).
- `core/src/algebra/arithmetic.ts` — binary arithmetic (`+` `-` `*` `/` `%`) and comparison, on Abs.
- `service/src/evaluator/abs-route.ts` — `tryAbsBinary` / `tryAbsUnary` / `tryAbsObjectSpread`: the TypeValue ⇄ Abs routing that bridges the projection layer back into the algebra (union members routed member-wise, constraints preserved via term/pred).

```typescript
// Binary arithmetic routes through the algebra:
tryAbsBinary("+", left, right)   // number + number, string/template concat
tryAbsBinary("<", left, right)   // numeric/string comparison
```

Refined subsets (template strings, numeric ranges) carry their constraints as Preds on terms, not as override tables; the algebra reads those preds during `+`/comparison.

---

## 3. Evaluation Engine (Nudo Engine)

### 3.1 Architecture Overview

```text
parser ──▶ core
            ├── algebra/     ← type system (Abs / Term / Pred / Φ / check)
            ├── type-value   ← extensional projection (T factory / dts / serialization)
            └── bridge       ← Abs ⇄ TypeValue (lossy)
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
| **surface / abs-route** | Arithmetic, comparison, unary, spread routed through algebra |
| **bridge** | Abs → TypeValue for dts/LSP/serialization |
| **Environment** | Variable bindings (name → TypeValue or Abs seed) |

### 3.2 Evaluation Rules

The evaluator is an AST walker. For each node type, there is a corresponding rule:

**Literals:**
```text
eval(NumericLiteral 42)  →  T.literal(42)
eval(StringLiteral "hi") →  T.literal("hi")
eval(NullLiteral)       →  T.null
```

**Variables:**
```text
eval(Identifier "x")  →  env.lookup("x")
```

**Binary expressions:**
```text
eval(BinaryExpression { left, op, right })  →  tryAbsBinary(op, eval(left), eval(right))
```

**Conditional (if-else):** The engine may **evaluate both branches** with narrowed type values and merge:

```text
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)
  if condition === T.literal(true)  → eval(consequent)
  if condition === T.literal(false) → eval(alternate)
  else:
    [envTrue, envFalse] = narrow(env, test)
    resultTrue  = eval(consequent, envTrue)
    resultFalse = eval(alternate, envFalse)
    return T.union(resultTrue, resultFalse)
```

### 3.3 Narrowing Rules

| Pattern | True branch | False branch |
|---------|-------------|--------------|
| `typeof x === "string"` | `x ∩ T.string` | `x - T.string` |
| `typeof x === "number"` | `x ∩ T.number` | `x - T.number` |
| `x === null` | `x ∩ T.null` | `x - T.null` |
| `x === <literal>` | `x ∩ T.literal(v)` | `x - T.literal(v)` |
| `Array.isArray(x)` | `x ∩ T.array(T.unknown)` | `x - T.array(T.unknown)` |
| `x` (truthiness) | `x - T.null - T.undefined - falsy` | complement |
| `x instanceof C` | `x ∩ T.instanceOf(C)` | `x - T.instanceOf(C)` |

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

Functions are first-class type values. When a function is passed as an argument, the engine evaluates calls using the function's type-value representation.

### 4.3 Recursion

Recursion is bounded by a **call budget** (`MAX_CALL_DEPTH = 64`). A recursive call that re-enters a signature past the budget is truncated and its result widened to `unknown`, reported as `nudo:recursion-truncated` — there is no fixed-point refinement. Concrete base cases inside the budget still evaluate to literals.

### 4.4 Async / Promise

Promises are modeled as wrapped type values. `await` unwraps the Promise type; `async function` wraps the return value in `T.promise(...)`.

### 4.5 Exception and throws Tracking

Nudo tracks exceptions as a first-class part of function types. Each function has not only `returns` but also `throws`—a capability TypeScript's type system lacks. Try-catch removes thrown types from the function's `throws`; the catch parameter receives the union of thrown types.

### 4.6 Mutability (Reference Semantics, Copy-on-Write)

Object type values use **reference semantics**. Assignment copies references. When entering branches, modified objects are deep-copied so each branch has its own copy; merging unions the properties.

---

## 5. Directive System

Directives are structured comments that guide the engine. They use the `@nudo:` namespace.

| Directive | Purpose |
|-----------|---------|
| `@nudo:case` | Provide named execution cases (concrete or symbolic inputs) |
| `@nudo:mock` | Mock external dependencies with type-value implementations |
| `@nudo:pure` | Mark function as pure for memoization |
| `@nudo:skip` | Skip evaluation; an optional type expression declares the return type (e.g. `@nudo:skip T.number`) |
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

For libraries with JS source, Nudo can execute the code to derive types. For native or opaque dependencies, `@nudo:mock` provides type-value–aware stubs.

### 6.4 Dependent Types

Nudo naturally produces dependent types (types that depend on values) without special syntax:

```javascript
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
// clamp(5, 0, 10) → T.literal(5)
// clamp(T.number, 0, 10) → T.number
```

### 6.5 Precise String Concatenation

Nudo preserves string structure through concatenation, producing template string types:

```javascript
const url = "https://api.example.com" + T.string;
// Nudo: `https://api.example.com${string}`
// TypeScript: string (loses the known prefix)

url.startsWith("https://")  // Nudo: true | TypeScript: boolean
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

User-facing contracts are declared with `@nudo:refine` and `*.nudo.js` templates — not `interface` / `type`, and not `T.refine` in source:

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

The Pred enters Abs and participates in algebra (`x>0` ⇒ `x+1>1`). `T.refine` is the TypeValue-IR primitive these templates lower to — not the source-level API.

---

## 7. End-to-End Example: calc

**Source:**

```javascript
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}
```

**Case "concrete" — `calc(T.literal(1), T.literal(2))`:**
1. Bind: `a = T.literal(1)`, `b = T.literal(2)`
2. Condition: `a > b` → `T.literal(false)`
3. Take alternate: `a + b` → `T.literal(3)`
4. Result: `T.literal(3)`

**Case "symbolic" — `calc(T.number, T.number)`:**
1. Bind: `a = T.number`, `b = T.number`
2. Condition: `a > b` → `T.boolean` (abstract)
3. Fork both branches:
   - True: `a - b` → `T.number`
   - False: `a + b` → `T.number`
4. Merge: `T.number`

**Combined:** `((1, 2) => 3) & ((number, number) => number)`

---

## 8. Implementation Roadmap

### Done
- **Evaluator MVP** — Babel, TypeValue IR, ops, narrowing, `@nudo:case`, CLI `infer`.
- **Objects/arrays** — objects, arrays, tuples, Array methods, `@nudo:mock`.
- **Advanced language** — closures, recursion budget, async/Promise, try-catch, classes.
- **Tooling** — LSP, watch, `.d.ts`, Vite plugin, VS Code extension.
- **Refined IR** — template/range refinements; source contracts via `@nudo:refine`.
- **Abs algebra (single-track)** — Term/Pred/Abs, arithmetic kernel, `leqAbs`, generalize, `nudo check` / `nudo types` / `nudo test`, CheckJson, gold gates (recall = precision = 1.0).
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
| `+` (numeric) | `T.literal(a + b)` | `T.number` | `T.number` |
| `+` (string) | `T.literal(a + b)` | `T.string` | `T.string` |
| `-`, `*`, `/`, `%` | `T.literal(op(a,b))` | `T.number` | `T.number` |
| `===`, `!==` | `T.literal(a === b)` | `T.boolean` | `T.boolean` |
| `>`, `<`, `>=`, `<=` | `T.literal(op(a,b))` | `T.boolean` | `T.boolean` |
| `typeof` | `T.literal("...")` | `T.literal("...")` | `T.string` |
| `!` | `T.literal(!a)` | `T.boolean` | `T.boolean` |
