---
sidebar_position: 2
description: Learn how Nudo executes code with symbolic type values — the abstract interpretation model behind its evaluation engine, narrowing, and merging.
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

```text
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                        │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (AST Walker) │ │
│  └───────────┘   └────────────┘   └──────┬───────┘ │
│                                          │         │
│                  ┌───────────────────────┐│         │
│                  │  algebra surface /   ││         │
│                  │  arithmetic / route  │◀         │
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
| **Evaluator** | B-path transpile+exec (ast-eval fallback): evaluate each node with Abs |
| **surface / arithmetic / abs-route** | Operator semantics on Abs for arithmetic, comparison, unary, spread |
| **Environment** | Manage variable scopes and bindings (name → Abs) |
| **Branch Executor** | Handle conditional branches: fork, narrow, evaluate, merge |
| **Type Emitter** | Serialize final Abs results (optionally to TypeScript types) |

---

## Evaluation Rules

The evaluator executes the function body with **Abs** values. On the primary B path the source is transpiled and run with Abs operands; the ast-eval fallback walks the AST directly with the same Abs rules. For each AST node type there is a corresponding evaluation rule.

### Literals

```text
eval(NumericLiteral { value: 42 })   →  numLit(42)
eval(StringLiteral { value: "hi" })  →  strLit("hi")
eval(BooleanLiteral { value: true }) →  boolLit(true)
eval(NullLiteral)                    →  null Abs
```

### Variables

```text
eval(Identifier { name: "x" })  →  env.vars.get("x")
```

### Binary Expressions

```text
eval(BinaryExpression { left, op, right })  →  tryAbsBinary(op, eval(left), eval(right))
```

### Assignment

```text
eval(AssignmentExpression { left: "x", right: expr })
  →  env = withVar(env, "x", eval(expr))
```

### Conditional (if-else)

This is where the engine differs fundamentally from a normal interpreter. Instead of choosing one branch, it may **evaluate both branches** with narrowed Abs values:

```text
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)

  // Case 1: condition is a known literal
  if isDefinitelyTrue(condition)   → eval(consequent)
  if isDefinitelyFalse(condition)  → eval(alternate)

  // Case 2: condition is abstract → fork both branches
  [envTrue, envFalse] = narrow(env, test)
  resultTrue  = eval(consequent, envTrue)
  resultFalse = eval(alternate, envFalse)
  return joinAbs(resultTrue, resultFalse)
```

### Function Declaration

```text
eval(FunctionDeclaration { id: "foo", params, body })
  →  env.fns.set("foo", absFunction(params, { body, closure: env }))
```

### Function Call

```text
eval(CallExpression { callee: "foo", args })
  →  fn = env.fns.get("foo")
     argValues = args.map(eval)
     fnEnv = fn.closure.extend(zip(fn.params, argValues))
     eval(fn.body, fnEnv)
```

---

## Narrowing Rules

Narrowing refines values based on conditions. The engine supports these patterns:

| Pattern | True branch | False branch |
|---------|-------------|--------------|
| `typeof x === "string"` | `x ∩ string` | `x - string` |
| `typeof x === "number"` | `x ∩ number` | `x - number` |
| `x === null` | `x ∩ null` | `x - null` |
| `x === undefined` | `x ∩ undefined` | `x - undefined` |
| `x === <literal>` | `x ∩ lit(v)` | `x - lit(v)` |
| `Array.isArray(x)` | `x ∩ array` | `x - array` |
| `x` (truthiness) | `x - null - undefined - lit(0) - lit("") - lit(false)` | complement |
| `x instanceof C` | `x ∩ instance(C)` | `x - instance(C)` |
| `"key" in x` | union members with `key` property | union members without `key` |
| `x?.prop` | normal member access (short-circuits to `undefined` for nullish) | — |
| `a ?? b` | `a` with null/undefined removed | — |
| `switch(x) { case v: ... }` | `x ∩ lit(v)` per case | remaining after all cases |
| `x.kind === "a"` (discriminated union) | union members where `kind` matches literal | union members where `kind` differs |

Where `∩` is type intersection and `-` is type subtraction.

---

## Advanced Behaviors

### Loops (Bounded Unrolling)

When the loop bound is concrete, the engine unrolls the loop that many times. When the bound is abstract, the condition is never *definitely false*, so the engine unrolls up to a bounded cap (`DEFAULT_MAX_LOOP_ITERS = 8`) — a termination guard for abstract conditions, not a fixed-point join. Within the cap, the loop exits early when the test becomes definitely false, or when two adjacent loop states stop changing (`leqAbs`).

### Closures and Higher-Order Functions

Functions are first-class Abs values (`fn` shape). When a function is passed as an argument, the engine evaluates calls through its Abs representation (parameters, body, closure environment):

```javascript
map(number[], (x) => x + 1)
// Engine evaluates: fn(number) → number + lit(1) → number
// Result: number[]
```

### Recursion (Call Budget)

Recursion is bounded by a call budget (`MAX_CALL_DEPTH = 64`), not refined to a fixed point:

1. A recursive call is evaluated with the current arguments.
2. When a signature is re-entered past the budget, the call is truncated.
3. The truncated result is widened to `unknown`, reported as `nudo:recursion-truncated` (a warning in `nudo check`).

Concrete base cases inside the budget still evaluate to literals; symbolic self-recursion widens to `unknown` rather than diverging.

### Async / Promise

Promises are modeled as an effect shape (`eff`):
- `await expr` unwraps `promise<V>` to `V`
- `async function` wraps the return value in `promise<...>`

### Exception and throws Tracking

Nudo treats exceptions as a first-class property of function types. Every function's inferred type includes both `returns` and `throws`:

```javascript
function divide(a, b) {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
// divide(number, number):
//   returns: number
//   throws: instance(Error)
```

`try-catch` absorbs thrown types. The catch parameter receives the union of all thrown types from the try block. If the function never throws, `throws` is `never`.

### Mutability (Reference Semantics, Copy-on-Write)

Object Abs values use **reference semantics** — assignment copies references, not values. Multiple variables can point to the same object Abs value.

When entering conditional branches, the engine deep-copies modified objects so each branch has its own copy. On merge, overlapping properties become unions. Without branching, mutations are applied in-place with no overhead.
