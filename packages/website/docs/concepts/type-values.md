---
sidebar_position: 1
---

# Type Values

Type values are the foundational abstraction in Nudo. They are **symbolic representations of sets of possible JavaScript values** — instead of holding a single concrete value like `42` or `"hello"`, a type value represents *all* values that share certain characteristics (e.g., "any number" or "the literal 1"). When Nudo executes your code, it uses type values instead of concrete values, and the result of execution is itself a type value — the inferred type.

## TypeValue Hierarchy

Nudo's type system is built around a discriminated union of type value kinds:

```
TypeValue
├── Literal<V>      — single concrete value: 1, "hello", true, null, undefined
├── Primitive<T>    — all possible values of a primitive: number, string, boolean, bigint, symbol
├── RefinedType     — a subset of a base type with metadata and custom operation rules
├── ObjectType      — object with known property types
├── ArrayType       — array with element type
├── TupleType       — fixed-length array
├── FunctionType    — function with params, body, closure
├── UnionType       — union of type values
├── NeverType       — empty set (unreachable)
└── UnknownType     — universal set (any value)
```

### Literal\<V\>

Represents exactly one concrete value. Used when the engine knows the precise value, e.g. from a literal in code or from a concrete `@nudo:case` argument.

```javascript
T.literal(1)       // the number 1
T.literal("hello") // the string "hello"
T.literal(true)   // the boolean true
```

### Primitive\<T\>

Represents all possible values of a JavaScript primitive type: `number`, `string`, `boolean`, `bigint`, or `symbol`. Used when the value is known to be of that type but not a specific value.

```javascript
T.number   // any number
T.string   // any string
T.boolean  // true or false
```

### ObjectType

Represents an object with a known shape — each property has an associated type value.

```javascript
T.object({ id: T.number, name: T.string })
T.object({ x: T.literal(1), y: T.literal(2) })
```

### ArrayType

Represents an array whose elements share a common type.

```javascript
T.array(T.number)           // number[]
T.array(T.union(T.string, T.number))  // (string | number)[]
```

### TupleType

Represents a fixed-length array with a specific type for each index.

```javascript
T.tuple([T.literal(1), T.string, T.boolean])
```

### FunctionType

Represents a function with its parameter names, body AST, and closure (environment). This is used internally when functions are first-class values.

### UnionType

Represents the union of multiple type values — a value that could be any of its members.

```javascript
T.union(T.literal(1), T.literal(2), T.literal(3))
T.union(T.string, T.number)
```

### NeverType

The empty set. Represents unreachable code or impossible types (e.g. the result of narrowing that excludes all possibilities).

### UnknownType

The universal set. Represents "any value" when the type cannot be determined.

### RefinedType

Represents a **subset of a base type** with attached metadata and optional custom operation rules. Refined types are the unified mechanism behind template strings, numeric ranges, and user-defined type constraints.

```javascript
// Built-in: template string (created automatically by string concatenation)
T.literal("0x") + T.string   // → refined(T.string, template { parts: ["0x", T.string] })

// Built-in: numeric range (created by narrowing)
// if (x >= 0) → x is refined(T.number, range { min: 0 })

// User-defined:
T.refine(T.number, {
  name: "odd",
  check: (v) => Number.isInteger(v) && v % 2 !== 0,
  ops: {
    "%"(self, other) {
      if (other.kind === "literal" && other.value === 2) return T.literal(1);
      return undefined; // fall back to base type behavior
    },
  },
})
```

A refined type is always a subtype of its base. When an operation is not handled by the refinement's custom rules (or returns `undefined`), the engine falls back to the base type's behavior, recursively until a primitive type is reached.

---

## T Factory API

In directives and when defining type values in code, you use the `T` factory:

| API | Description |
|-----|-------------|
| `T.literal(value)` | Single concrete value: `1`, `"hello"`, `true`, `null`, `undefined` |
| `T.number` | All numbers |
| `T.string` | All strings |
| `T.boolean` | All booleans |
| `T.bigint` | All bigints |
| `T.symbol` | All symbols |
| `T.null` | The value `null` |
| `T.undefined` | The value `undefined` |
| `T.unknown` | Any value |
| `T.never` | Empty set (unreachable) |
| `T.object({ key: TypeValue })` | Object with known property types |
| `T.array(element)` | Array with element type |
| `T.tuple([...])` | Fixed-length array |
| `T.union(...)` | Union of type values |
| `T.fn(params, body, closure)` | Function type (used internally) |
| `T.refine(base, refinement)` | Refined subset of base type with custom rules |

### Examples in Directives

```javascript
/**
 * @nudo:case "concrete" (5, 3)
 * @nudo:case "symbolic" (T.number, T.number)
 * @nudo:case "mixed" (T.literal(0), T.string)
 */
function combine(a, b) {
  return a + b;
}
```

```javascript
// In @nudo:case or @nudo:mock expressions:
T.union(T.string, T.number)
T.object({ id: T.number, name: T.string })
T.array(T.object({ x: T.number, y: T.number }))
T.tuple([T.literal(1), T.literal(2), T.literal(3)])
```

---

## Design Principles

Nudo's type value system follows four core principles that govern how operations and inference behave.

### 1. Literal Preservation

When all inputs are literals, the output is also a literal. The engine computes the concrete result.

```javascript
T.literal(1) + T.literal(2)   // → T.literal(3), not T.number
T.literal("a") + T.literal("b") // → T.literal("ab"), not T.string
```

This keeps inferred types precise when enough information is available.

### 2. Widening on Abstraction

When any input is abstract (non-literal), the result widens to the appropriate abstract type — but Nudo preserves as much structure as possible through refined types.

```javascript
T.literal(1) + T.number       // → T.number
T.literal("xy") + T.string    // → `xy${string}` (template refined type, not just T.string)
T.string + T.literal("!")     // → `${string}!`
T.string + T.string           // → T.string (no structure to preserve)
```

When string concatenation involves at least one literal, Nudo produces a **template string** refined type that preserves the known prefix/suffix. This enables precise inference for methods like `startsWith` and `endsWith`.

### 3. Lazy Union Distribution

Unions propagate as-is through the function. They are only expanded when an operator or method *must* distinguish between members. This avoids combinatorial explosion.

```javascript
const a = T.union(T.literal(1), T.literal(2));
const b = T.union(T.literal("x"), T.literal("y"));

// Not expanded — members don't need to be distinguished
const arr = [a, b];  // → T.tuple([T.union(1, 2), T.union("x", "y")])

// Expanded — operator must distinguish members
const sum = a + b;   // → T.union("1x", "1y", "2x", "2y")
```

Lazy distribution preserves correlation: `a + a` is correctly `T.union(2, 4)`, not `1+1, 1+2, 2+1, 2+2`.

### 4. Guard Narrowing

Type guards narrow type values in branches. When you check `typeof x === "string"` or `x === null`, the engine narrows `x` in the `if` branch and excludes those types in the `else` branch.

```javascript
function process(x) {
  if (typeof x === "string") {
    // x is T.string here
    return x.length;  // → T.number
  }
  if (x === null) {
    // x is T.null here
    return 0;
  }
  // x is narrowed (e.g. T.number if input was T.union(T.string, T.number, T.null))
  return x;
}
```

Narrowing rules support `typeof`, `===`, `!==`, `instanceof`, and truthiness checks.
