---
sidebar_position: 1
---

# @nudojs/core

The core package provides the type value system, operator semantics, and environment abstraction that power Nudo's abstract interpretation engine.

## TypeValue

`TypeValue` is a discriminated union representing a set of possible JavaScript values at type level. Use the `kind` property to narrow the type.

### Discriminated Union Members

| `kind` | Description |
|--------|-------------|
| `literal` | A single concrete value: `string \| number \| boolean \| null \| undefined` |
| `primitive` | All values of a primitive type: `number`, `string`, `boolean`, `bigint`, `symbol` |
| `object` | Object with known property types; has a unique `id` for reference semantics |
| `array` | Array with a single element type |
| `tuple` | Fixed-length array with per-element types |
| `function` | Function with `params`, `body` (AST), and `closure` (Environment) |
| `promise` | Promise wrapping a TypeValue |
| `instance` | Class instance (e.g. `Error`) with optional properties |
| `union` | Union of multiple TypeValues |
| `never` | Empty set (unreachable) |
| `unknown` | Universal set (any value) |

---

## T Factory

`T` provides static factory functions and constants to construct TypeValues.

### Literals and Primitives

```typescript
T.literal(value)   // value: LiteralValue (string | number | boolean | null | undefined)
T.number
T.string
T.boolean
T.bigint
T.symbol
T.null
T.undefined
T.unknown
T.never
```

### Composite Types

```typescript
T.object(props)           // props: Record<string, TypeValue>
T.array(element)          // element: TypeValue
T.tuple(elements)         // elements: TypeValue[]
T.promise(value)          // value: TypeValue
T.instanceOf(className, properties?)  // className: string, properties?: Record<string, TypeValue>
T.union(...members)       // members: TypeValue[]
T.fn(params, body, closure)  // params: string[], body: Node (Babel AST), closure: Environment
```

---

## Utility Functions

| Function | Description |
|----------|-------------|
| `typeValueEquals(a, b)` | Deep equality for two TypeValues. |
| `simplifyUnion(members)` | Flatten nested unions, deduplicate, remove `never`. Returns `T.never` if empty, single member if one, `T.unknown` if any member is unknown. |
| `widenLiteral(tv)` | Convert a literal to its primitive: `T.literal(1)` → `T.number`, etc. |
| `isSubtypeOf(a, b)` | Check if `a` is a subtype of `b`. |
| `typeValueToString(tv)` | Human-readable string representation (e.g. `"number"`, `"string \| number"`). |
| `narrowType(tv, predicate)` | Filter union members by predicate; returns `T.never` for non-unions that fail. |
| `subtractType(tv, predicate)` | Keep members where predicate is false. |
| `getPrimitiveTypeOf(tv)` | Return `typeof` string: `"number"`, `"string"`, `"object"`, `"function"`, or `undefined`. |
| `deepCloneTypeValue(tv, idMap?)` | Deep clone; optional `idMap` preserves object identity across clones. |
| `mergeObjectProperties(a, b)` | Merge two object TypeValues; overlapping keys become unions. |

---

## Ops (Operator Semantics)

Operators and unary ops on TypeValues. The evaluator uses these instead of real JavaScript operators.

### Binary Ops

| Op | Function | Description |
|----|----------|-------------|
| `+` | `Ops.add(left, right)` | Number addition or string concatenation; literal + literal → literal. |
| `-` | `Ops.sub(left, right)` | Subtraction; number only. |
| `*` | `Ops.mul(left, right)` | Multiplication. |
| `/` | `Ops.div(left, right)` | Division. |
| `%` | `Ops.mod(left, right)` | Modulo. |
| `===` | `Ops.strictEq(left, right)` | Strict equality. |
| `!==` | `Ops.strictNeq(left, right)` | Strict inequality. |
| `>` | `Ops.gt(left, right)` | Greater than. |
| `<` | `Ops.lt(left, right)` | Less than. |
| `>=` | `Ops.gte(left, right)` | Greater or equal. |
| `<=` | `Ops.lte(left, right)` | Less or equal. |

### Unary Ops

| Op | Function | Description |
|----|----------|-------------|
| `typeof` | `Ops.typeof_(operand)` | Returns `T.literal("number")`, `T.literal("string")`, etc. |
| `!` | `Ops.not(operand)` | Logical NOT. |
| `-` | `Ops.neg(operand)` | Numeric negation. |

### Helper

```typescript
applyBinaryOp(op: string, left: TypeValue, right: TypeValue): TypeValue
```

Maps operator strings (`"+"`, `"-"`, etc.) to the corresponding binary Op. Unknown ops return `T.unknown`.

---

## Environment

Environment manages variable bindings (name → TypeValue) with lexical scoping.

```typescript
createEnvironment(parent?, bindings?)
```

- `parent` — Optional parent Environment for scope chain.
- `bindings` — Optional `Map<string, TypeValue>` for initial bindings (default: `new Map()`).

### Environment Methods

| Method | Description |
|--------|-------------|
| `lookup(name)` | Get TypeValue for `name`; walks parent chain; returns `T.undefined` if missing. |
| `bind(name, value)` | Set binding in this env; returns env for chaining. |
| `update(name, value)` | Update existing binding in this env or parent; returns `boolean` success. |
| `extend(bindings)` | Create child env with new bindings. |
| `has(name)` | Check if name is bound (this env or parent). |
| `snapshot()` | Deep copy of env (for branch forking). |
| `getOwnBindings()` | Get `Record<string, TypeValue>` for bindings in this env only. |
