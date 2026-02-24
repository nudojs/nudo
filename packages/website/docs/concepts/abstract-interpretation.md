---
sidebar_position: 2
---

# Abstract Interpretation

Abstract interpretation is the theoretical foundation of Nudo. Instead of running code with concrete values (like a test) or analyzing code without running it (like TypeScript), Nudo **executes code with symbolic type values** — and the execution itself produces types.

## Three Approaches Compared

| Approach | Input | Output | Completeness |
|----------|-------|--------|--------------|
| Unit tests | Concrete values (`1`, `"hello"`) | Concrete result | Only test cases |
| Nudo | Type values (`T.number`, `T.string`) | Type values | All values in the type set |
| TypeScript | AST (no execution) | Types | All syntactic paths |

When Nudo executes `transform(T.string)`, the engine propagates `T.string` through the function body. At `typeof x === "string"`, the engine knows that branch is taken. At `x.toUpperCase()`, the engine knows the result is `T.string`. The result is not a concrete value — it is a **type**.

---

## Evaluation Engine Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                        │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (AST Walker) │ │
│  └───────────┘   └────────────┘   └──────┬───────┘ │
│                                          │         │
│                  ┌───────────────────────┐│         │
│                  │    Ops (Operator &    ││         │
│                  │  Built-in Semantics)  │◀         │
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
| **Parser** | Parse JS/TS source into AST (delegates to Babel) |
| **Directive Extractor** | Extract `@nudo:*` directives from comments |
| **Evaluator** | Traverse AST, evaluate each node with type values |
| **Ops** | Define type-value semantics for all JS operators and built-in methods |
| **Environment** | Manage variable scopes and bindings (name → TypeValue) |
| **Branch Executor** | Handle conditional branches: fork, narrow, evaluate, merge |
| **Type Emitter** | Serialize final TypeValue results (optionally to TypeScript types) |

---

## Evaluation Rules

The evaluator is an AST walker. For each AST node type, there is a corresponding evaluation rule.

### Literals

```
eval(NumericLiteral { value: 42 })   →  T.literal(42)
eval(StringLiteral { value: "hi" })  →  T.literal("hi")
eval(BooleanLiteral { value: true }) →  T.literal(true)
eval(NullLiteral)                    →  T.null
```

### Variables

```
eval(Identifier { name: "x" })  →  env.lookup("x")
```

### Binary Expressions

```
eval(BinaryExpression { left, op, right })  →  Ops[op](eval(left), eval(right))
```

### Assignment

```
eval(AssignmentExpression { left: "x", right: expr })
  →  env.bind("x", eval(expr))
```

### Conditional (if-else)

This is where the engine differs fundamentally from a normal interpreter. Instead of choosing one branch, it may **evaluate both branches** with narrowed type values:

```
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)

  // Case 1: condition is a known literal
  if condition === T.literal(true)  → eval(consequent)
  if condition === T.literal(false) → eval(alternate)

  // Case 2: condition is abstract → fork both branches
  [envTrue, envFalse] = narrow(env, test)
  resultTrue  = eval(consequent, envTrue)
  resultFalse = eval(alternate, envFalse)
  return T.union(resultTrue, resultFalse)
```

### Function Declaration

```
eval(FunctionDeclaration { id: "foo", params, body })
  →  env.bind("foo", TypeValueFunction { params, body, closure: env })
```

### Function Call

```
eval(CallExpression { callee: "foo", args })
  →  fn = env.lookup("foo")
     argValues = args.map(eval)
     fnEnv = fn.closure.extend(zip(fn.params, argValues))
     eval(fn.body, fnEnv)
```

---

## Narrowing Rules

Narrowing refines type values based on conditions. The engine supports these patterns:

| Pattern | True branch | False branch |
|---------|-------------|--------------|
| `typeof x === "string"` | `x ∩ T.string` | `x - T.string` |
| `typeof x === "number"` | `x ∩ T.number` | `x - T.number` |
| `x === null` | `x ∩ T.null` | `x - T.null` |
| `x === undefined` | `x ∩ T.undefined` | `x - T.undefined` |
| `x === <literal>` | `x ∩ T.literal(v)` | `x - T.literal(v)` |
| `Array.isArray(x)` | `x ∩ T.array(T.unknown)` | `x - T.array(T.unknown)` |
| `x` (truthiness) | `x - T.null - T.undefined - T.literal(0) - T.literal("") - T.literal(false)` | complement |
| `x instanceof C` | `x ∩ T.instanceOf(C)` | `x - T.instanceOf(C)` |

Where `∩` is type intersection and `-` is type subtraction.

---

## Advanced Behaviors

### Loops (Fixed-Point Iteration)

When loop count depends on type values, the engine uses fixed-point iteration:

1. If the array is a concrete tuple, unroll the loop.
2. If the array is abstract, execute the loop body once with the element type and iterate until variable types stabilize:
   - Iteration 0: `sum = T.literal(0)`
   - Iteration 1: `sum = T.union(T.literal(0), T.number)` → `T.number`
   - Iteration 2: `sum = T.number` (fixed point reached, stop)

### Closures and Higher-Order Functions

Functions are first-class type values. When a function is passed as an argument, the engine evaluates calls using the function's type-value representation:

```javascript
map(T.array(T.number), (x) => x + 1)
// Engine evaluates: fn(T.number) → T.number + T.literal(1) → T.number
// Result: T.array(T.number)
```

### Recursion (Memoization + Widening)

1. First call with a given type-value signature: record and start evaluation.
2. If the same signature is encountered again (recursive call): return a placeholder (`T.unknown`).
3. After first evaluation completes, re-evaluate with the known return type.
4. Repeat until the return type reaches a fixed point.

### Async / Promise

Promises are modeled as wrapped type values:
- `await expr` unwraps `T.promise(V)` to `V`
- `async function` wraps the return value in `T.promise(...)`

### Exception and throws Tracking

Nudo treats exceptions as a first-class property of function types. Every function's inferred type includes both `returns` and `throws`:

```javascript
function divide(a, b) {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
// divide(T.number, T.number):
//   returns: T.number
//   throws: T.instanceOf(Error)
```

`try-catch` absorbs thrown types. The catch parameter receives the union of all thrown types from the try block. If the function never throws, `throws` is `T.never`.

### Mutability (Reference Semantics, Copy-on-Write)

Object type values use **reference semantics** — assignment copies references, not values. Multiple variables can point to the same object type value.

When entering conditional branches, the engine deep-copies modified objects so each branch has its own copy. On merge, overlapping properties become unions. Without branching, mutations are applied in-place with no overhead.
