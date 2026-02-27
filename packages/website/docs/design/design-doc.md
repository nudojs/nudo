---
sidebar_position: 1
---

# Design Document

> **Nudo** — A type inference engine for JavaScript that derives precise types by executing code with symbolic type values (abstract interpretation).

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

Nudo neither statically analyzes code like TypeScript nor runs code with concrete values like tests. Instead, it **executes code with symbolic "type values"**—special objects representing sets of possible values. Execution itself produces types.

```
Traditional:   Source code  →  Static analysis  →  Types
Nudo:          Source code  +  Type values  →  Execution  →  Types
```

This is not "induction from samples" (inferring from finite examples). It is **Abstract Interpretation**—a well-established technique from programming language theory—presented in the familiar mental model of "running code."

### 1.3 Key Distinction: Concrete vs. Symbolic Execution

| Approach | Input | Output | Completeness |
|----------|-------|--------|--------------|
| Unit tests | Concrete values (`1`, `"hello"`) | Concrete result | Only test cases |
| Nudo | Type values (`T.number`, `T.string`) | Type values | All values in the type set |
| TypeScript | AST (no execution) | Types | All syntactic paths |

When Nudo executes `transform(T.string)`, the engine propagates `T.string` through the function body. At `typeof x === "string"`, the engine knows that branch is taken. At `x.toUpperCase()`, the engine knows the result is `T.string`. The result is not a concrete value—it is a **type**.

---

## 2. Type Value System

**Type Values** are the foundational abstraction. A type value represents a set of possible JavaScript values and knows how to participate in JS operations.

### 2.1 Type Value Hierarchy

```
TypeValue
├── Literal<V>          — Single concrete value: 1, "hello", true, null, undefined
├── Primitive<T>        — All values of a primitive: number, string, boolean, bigint, symbol
├── RefinedType         — Subset of a base type with metadata and custom operation rules
├── ObjectType          — Object with known property types: { id: number, name: Literal<"Alice"> }
├── ArrayType           — Array with element type: Array<number>
├── TupleType           — Fixed-length array: [Literal<1>, Primitive<string>]
├── FunctionType        — Function with params, body, closure
├── UnionType           — Union of type values: Literal<1> | Literal<2> | Primitive<string>
├── NeverType           — Empty set (unreachable)
└── UnknownType         — Universal set (any value)
```

### 2.2 Design Principles

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

### 2.3 Type Value API

```typescript
// --- Construction ---
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
T.refine(base, refinement)   // Refined subset of base type with custom rules

// --- Introspection ---
typeValue.kind                // "literal" | "primitive" | "refined" | "object" | "array" | ...
typeValueToString(tv)         // Human-readable: "number", "1 | 2", "string | number"
isSubtypeOf(a, b)             // Subtype check
```

### 2.4 Operator Semantics on Type Values

Because JavaScript does not support operator overloading, the engine **interprets the AST** and dispatches through a semantic layer:

```typescript
// The engine converts `a + b` to:
Ops.add(a, b)

// Ops.add knows how to handle type values:
// - Both literals → compute concrete result
// - String involved → result is string
// - Both numbers → result is number
// - Fallback → T.union(T.number, T.string)
```

Each JS operator and built-in method has a corresponding type-value semantic rule in Ops.

For **refined types**, the engine uses a dispatch fallback chain: it first tries the refined type's custom `ops`/`methods`/`properties` handlers; if they return `undefined`, it unwraps to the base type and recurses until a primitive type's default rule is reached.

---

## 3. Evaluation Engine (Nudo Engine)

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                       │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (AST Walker)  │ │
│  └───────────┘   └────────────┘   └──────┬───────┘ │
│                                          │         │
│                  ┌───────────────────────┐│         │
│                  │    Ops (Operator &    ││         │
│                  │  Built-in Semantics) │◀         │
│                  └───────────────────────┘          │
│                                                     │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Environment  │  │   Branch    │  │   Type    │  │
│  │   (Scope)    │  │  Executor   │  │  Emitter  │  │
│  └──────────────┘  └─────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────┘
```

| Component | Responsibility |
|-----------|----------------|
| **Parser** | Parse JS/TS source into AST (Babel) |
| **Directive Extractor** | Extract `@nudo:*` directives from comments |
| **Evaluator** | Traverse AST, evaluate each node with type values |
| **Ops** | Define type-value semantics for operators and built-ins |
| **Environment** | Variable bindings (name → TypeValue) |
| **Branch Executor** | Fork on conditions, narrow, evaluate, merge |
| **Type Emitter** | Serialize final TypeValue (e.g. to TypeScript) |

### 3.2 Evaluation Rules

The evaluator is an AST walker. For each node type, there is a corresponding rule:

**Literals:**
```
eval(NumericLiteral 42)  →  T.literal(42)
eval(StringLiteral "hi") →  T.literal("hi")
eval(NullLiteral)       →  T.null
```

**Variables:**
```
eval(Identifier "x")  →  env.lookup("x")
```

**Binary expressions:**
```
eval(BinaryExpression { left, op, right })  →  Ops[op](eval(left), eval(right))
```

**Conditional (if-else):** The engine may **evaluate both branches** with narrowed type values and merge:

```
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

When loop count depends on type values, the engine uses **fixed-point iteration**:

```javascript
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
```

Strategy: if `arr` is abstract, execute the loop body with `arr[i]` as the element type and iterate until `sum`'s type reaches a fixed point (e.g. `T.literal(0)` → `T.number`).

### 4.2 Closures and Higher-Order Functions

Functions are first-class type values. When a function is passed as an argument, the engine evaluates calls using the function's type-value representation.

### 4.3 Recursion

Recursion is handled via **memoization + widening**: recursive calls with the same signature return a placeholder, then the result is refined until it reaches a fixed point.

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
| `@nudo:skip` | Skip evaluation; use type annotations or `@nudo:returns` |
| `@nudo:sample` | Number of loop iterations before fixed-point |
| `@nudo:returns` | Assert expected return type |

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
"a,b,c".split(",")      // Nudo: ["a","b","c"]| TS: string[]
"hello".indexOf("l")    // Nudo: 2            | TS: number
```

### 6.7 Type-Level Loop Evaluation

Nudo evaluates loops with concrete bounds, computing exact results:

```javascript
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// Nudo: sum → 10 | TS: number
```

### 6.8 User-Extensible Type Refinements

Users can define custom refined types with domain-specific operation rules via `T.refine`:

```javascript
const Odd = T.refine(T.number, {
  name: "odd",
  check: (v) => Number.isInteger(v) && v % 2 !== 0,
  ops: { "%"(self, other) {
    if (other.kind === "literal" && other.value === 2) return T.literal(1);
    return undefined; // fall back to T.number behavior
  }},
});
// Odd % 2 → 1 (custom rule)
// Odd + 1 → number (falls back to base)
```

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

### Phase 1: Minimal Viable Evaluator (done)
- Babel parser, TypeValue core, basic ops, evaluator, narrowing, `@nudo:case`, CLI.

### Phase 2: Objects and Arrays (done)
- ObjectType, ArrayType, TupleType, property access, `Array.prototype` methods, `@nudo:mock`.

### Phase 3: Advanced Features (done)
- Closures, recursion, async/Promise, try-catch, instanceof, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`.

### Phase 4: Tooling (done)
- LSP, watch mode, `.d.ts` export, Vite plugin, VS Code extension.

### Phase 5: Refined TypeValues (done)
- `RefinedType` kind with `Refinement` interface (name, meta, check, ops, methods, properties).
- Built-in template string refinement (parts, concatenation, startsWith/endsWith/includes, length).
- Built-in numeric range refinement (min, max, integer, comparison operators).
- User-defined refined types via `T.refine`.
- Dispatch fallback chain: refined → base → primitive.

### Phase 6: Evaluator Completion (done)
- Full string method semantics (20+ methods, literal and abstract).
- Loop evaluation with fixed-point iteration (for, while, do-while).
- `@nudo:sample` directive for loop sampling control.
- Comparison narrowing to range types.

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
