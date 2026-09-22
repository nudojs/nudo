---
description: Learn how Nudo executes code on Abs (symbolic values) — the abstract interpretation model behind evaluation, narrowing, and merging.
---

# Abstract Interpretation

Abstract interpretation is the theoretical foundation of Nudo. Instead of running code with concrete values (like a test) or analyzing code without running it (like TypeScript), Nudo **executes code on Abs** (symbolic shape × term × pred × conf values) — and the execution itself produces types.

## Three Approaches Compared

| Approach | Input | Output | Completeness |
|----------|-------|--------|--------------|
| Unit tests | Concrete values (`1`, `"hello"`) | Concrete result | Only test cases |
| Nudo | Type values (`number()`, `string()`) | Type values | All values in the type set |
| TypeScript | AST (no execution) | Types | All syntactic paths |

When Nudo executes `transform(string())`, the engine propagates `string()` through the function body. At `typeof x === "string"`, the engine knows that branch is taken. At `x.toUpperCase()`, the engine knows the result is `string()`. The result is not a concrete value — it is a **type**.

---

## Evaluation Engine Architecture

```text
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                        │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (B-path/Abs) │ │
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

This is where the engine differs fundamentally from a normal interpreter. Instead of always choosing one branch, it forks when the test is not decidable — but note: it does **not** narrow abstract values. Both arms run with the **same** bindings:

```text
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)

  // Case 1: condition is definitely true/false
  if isDefinitelyTrue(condition)   → eval(consequent)
  if isDefinitelyFalse(condition)  → eval(alternate)

  // Case 2: condition is abstract → run both branches with the same env
  resultTrue  = eval(consequent, env)
  resultFalse = eval(alternate, env)
  return joinAbs(resultTrue, resultFalse)
```

`isDefinitelyTrue/False` is what makes per-call-site narrowing possible: a concrete argument often makes the test fold to a literal, so only one branch runs for that call. An abstract argument cannot fold the test — both branches run and their results join.

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

Narrowing happens **per call site**: a branch runs when the condition is *definitely* true or false for the **concrete argument of that call**. Each `call@L…` case is evaluated with that call's exact argument, so the matching branch runs and the other is eliminated. With **abstract** arguments (`number()`, `union(...)`) the condition cannot be decided — both branches run with the same value and their results join. There is no intersection/subtraction of abstract types.

| Pattern | Concrete call (per call site) | Abstract / symbolic argument |
|---------|-------------------------------|------------------------------|
| `typeof x === "string"` | string call takes the branch; `x.length` folds | branches join |
| `x === null` / `x === <literal>` | matching call forks; the other falls through | branches join |
| `Array.isArray(x)` | array call forks; `x.length` / `x[0]` resolve | branches join |
| truthiness (`x`) | literal arguments fork | branches join |
| discriminated object (`x.kind === "a"`) | the matching shape's branch runs for that call | members are **not** filtered; branches join |
| `switch(x) { case v: … }` | a concrete discriminant picks its clause | branches join |
| `in` / `?.` / `??` | partial: see the table below | partial |

Other guards (`instanceof`, custom predicates) fork only when the test folds to a definite boolean for the call's argument — they are not in the verified set above. The verified per-pattern walkthrough with real `nudo test` output: [Control Flow Narrowing](./control-flow-narrowing.md).

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
