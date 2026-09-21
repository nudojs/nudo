---
title: Abs
description: "Abs — Nudo's only type system (shape × term × pred × conf): computable values with constraints that participate in algebra; projections are one-way and lossy."
---

# Abs — the type system

Abs values are symbolic sets of possible JavaScript values — instead of holding a single concrete value like `42` or `"hello"`, an Abs represents *all* values that share certain characteristics (e.g., "any number" or "the literal 1").

**Abs** (`shape × term × pred × conf`) is the *only* type system: a computable value whose constraints participate in algebra (`x > 0` ⇒ `x + 1 > 1`). Analysis, display, and projections (`.d.ts` / zod / guards) all consume Abs directly; there is no separate IR. Production analysis is Abs-native — nothing reads a projection back.

## The Four Components

- **shape** — the extensional carrier: what the value looks like. Kinds: `prim` (with a `lit` term for exact values), `obj`, `arr`, `tuple`, `fn`, `eff` (`promise<…>` / `generator<…>`), `brand` (nominal instances), `sum` (unions), `never`, `any` (unconstrained), `unknown` (inference failed — see [any vs unknown](#any-vs-unknown)).
- **term** — abstract value identity: `lit` (concrete), `var` (symbolic α like `A1`), or `app` (an application like `(x + 2)`).
- **pred** — constraints relative to the term: `(x + 2) > 3`.
- **conf** — how exact the abstraction is: `exact` / `path` / `widened` / `mock` / `partial` / `opaque`.

See the [core API](../api/core.md) for constructors (`num()`, `strLit(…)`, `obj({…})`, …) and the core functions (`leqAbs`, `formatAbs`, `checkSource`, …).

### Literals

A `prim` shape with a `lit` term represents exactly one concrete value — what the engine produces from a literal in code or a concrete `@nudo:case` argument:

```text
25  #exact            // the number 25, precisely
"localhost"  #exact   // one specific string
```

### Primitives

A `prim` shape without a `lit` term is the whole domain — the value is known to be of that type but not a specific value:

```text
number   // any number
string   // any string
boolean  // true or false
```

### Objects, Arrays, Tuples

`obj` carries known slots (`{ value, optional? }` per key), `arr` one element type, `tuple` a fixed-length per-element list:

```text
{ host: "localhost", port: 8080, debug: false }
[2, 4, 6]           // tuple of literals — arr when elements are abstract
number[]            // abstract element
```

### Functions and Promises

`fn` carries parameter names (or a `paramTypes`/`returnType` signature); `eff` wraps async effects and renders lowercase:

```text
load: (id) => ?                      // function value, result not yet precise
promise<{ id: 7, name: "u7" }>       // async result
```

### Unions

`sum` is the union of member Abs — a value that could be any of its members:

```text
25 | 9                // two exact numbers (from two call sites)
number | string       // heterogeneous union
```

`never` is the empty set (unreachable).

### any vs unknown

These are **not** the same product concept and must never be collapsed in docs or CLI output:

| | `any` | `unknown` |
|---|-------|-----------|
| Meaning | Unconstrained: the union of JS values; **developer** refines | **Inference failed** / engine has no information; **Nudo** must fix |
| Source | Unannotated entry params, explicit `any()`, refine parse fallback | Evaluation failure, unmodeled native, truncation, leak, opaque |
| Operations | Real JS union semantics; not “analysis failed” | Must not pretend to be a legal contract; trigger engine-debt diagnostics |
| Narrowing | Conditionals can narrow (`typeof` / `===` / `Array.isArray` / `switch` / truthiness / discriminant) | User conditions cannot “legalize” it; fix inference or add env/mock/refine |
| Display | `any` (optionally with a type-var like `A1`) | `unknown` + conf annotation |
| Product story | “No written contract ⇒ default constraint is `any` + JS runtime effects” | “Nudo hit a case it cannot handle” |

**Rule:** unconstrained entry parameters display as **`any`**, never as `unknown`. CLI/`check` signatures follow this contract.

---

## Type Expressions in Directives

`@nudo:case` / `@nudo:mock` / `@nudo:refine` arguments are written in the **constraint-expression grammar** — the same builders as `*.nudo.js` templates:

| Expression | Meaning | Example |
|-----|-------------|-------------|
| `number()` / `string()` / `boolean()` | primitive domain | `@nudo:case "symbolic" (number())` |
| `lit(v)` | literal domain | `lit(42)` / `lit("ada")` / `lit(true)` |
| `union(…)` | union of members | `union(lit(1), lit(2))` |
| `shape({ … })` | object shape (fields recursive) | `shape({ id: number().gt(0) })` |
| `array(…)` | array element constraint | `array(number())` |
| `fn({ … }, …)` | function relation | `fn({ x: number().gt(0) }, number())` |
| builders | `.gt/.gte/.lt/.lte/.shift/.int…` | `number().gt(0).int()` |
| bare literals | parsed directly | `42`, `"abc"`, `true`, `[1, 2]` |

Directive type expressions use the constraint builders above plus concrete literals. Inside `@nudo:mock` bodies write plain JavaScript values and closures — not builder calls as return payloads.

```javascript
/**
 * @nudo:case "concrete" (5, 3)
 * @nudo:case "symbolic" (number(), number())
 * @nudo:case "mixed" (lit(0), string())
 */
function combine(a, b) {
  return a + b;
}
```

---

## Design Principles

Nudo's type value system follows four core principles that govern how operations and inference behave.

### 1. Literal Preservation

When all inputs are literals, the output is also a literal. The engine computes the concrete result.

```javascript
combine(5, 3)   // → 8  #exact, not number
"ab" + "c"      // → "abc"  #exact
```

This keeps inferred types precise when enough information is available.

### 2. Widening on Abstraction

When any input is abstract (non-literal), the result widens to the appropriate domain — but Nudo preserves as much structure as possible.

```javascript
1 + number        // → number  #path   (displayed as the domain)
"xy" + string     // → string  #path   (displayed as the domain)
string + string   // → string          (no structure to preserve)
```

When string concatenation involves at least one literal, Nudo tracks a **template string** internally — the known prefix/suffix is preserved, which is what makes `("user-" + x).startsWith("user-")` fold to `true #exact` even for a symbolic `x`.

### 3. Lazy Union Distribution

Unions propagate as-is. An operation over a symbolic value stays symbolic — it is not eagerly expanded into a cross product of members. This avoids combinatorial explosion and preserves correlation:

```javascript
function selfAdd(a) {
  return a + a;   // intension: (A1 + A1) — one symbolic variable, not A1 + A1'
}

selfAdd(1);       // → 2  #exact  (per call site)
selfAdd(2);       // → 4  #exact
// Observed: 2 | 4 — correlation kept, never 1+1 | 1+2 | 2+1 | 2+2
```

With abstract arguments the result widens to the domain the algebra determines (`2 + x` with `x: number | string` → `number | string`; `selfAdd(number)` → `number #widened`) — member-wise expansion only happens when an operator or method *must* distinguish members.

### 4. Guard Narrowing

Type guards narrow values in branches. When you check `typeof x === "string"` or `x === null`, the engine narrows `x` in the `if` branch and excludes those values in the `else` branch.

```javascript
function process(x) {
  if (typeof x === "string") {
    // x is string here
    return x.length;  // → number
  }
  if (x === null) {
    // x is null here
    return 0;
  }
  // x is narrowed (e.g. number if input was string | number | null)
  return x;
}
```

Narrowing rules support `typeof`, `===`, `!==`, `instanceof`, `Array.isArray`, and truthiness checks.
