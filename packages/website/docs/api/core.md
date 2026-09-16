---
sidebar_position: 1
description: "@nudojs/core API — the TypeValue system, T factory (including T.fnSig), union/precision utilities, operator semantics, mock helpers, and Environment."
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
| `refined` | Subset of a base type with metadata and custom operation rules |
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
T.fnSig(paramTypes, returnType, throwsType?, impl?)  // signature-only function (see below)
T.refine(base, refinement)   // base: TypeValue, refinement: Refinement
```

### Signature-Only Functions

`T.fn` describes a real function value (parameter **names**, body AST, closure). `T.fnSig` describes only a **signature** — it is how env files and the harvester express "a function that takes these types and returns that type" without a body:

```typescript
T.fnSig(paramTypes: TypeValue[], returnType: TypeValue,
        throwsType: TypeValue = T.never, impl?: SigImpl): TypeValue

type SigImpl = (args: TypeValue[], thisVal?: TypeValue) => TypeValue | undefined;
```

When `impl` is provided, calling the function evaluates it against the argument TypeValues (this is how harvested `join` actually concatenates template strings); without `impl`, the call returns the declared `returnType`. Test with [`isFnSig`](#utility-functions) / read back with `getFnSig`, which returns the `{ paramTypes, returnType, throwsType, impl }` record.

```typescript
T.fnSig([T.array(T.string)], T.string)
// a function (string[]) => string
```

### Refinement Type

`T.refine` is the **TypeValue-IR primitive** for refined subsets (template strings, numeric ranges). Source-level contracts use `@nudo:refine` + `*.nudo.js` templates instead — see [Directives](../concepts/directives.md#nudorefine--refinement-contract).

```typescript
type Refinement = {
  name: string;                    // readable name for toString/toTSType
  meta: Record<string, unknown>;   // metadata (e.g. template parts, range bounds)
  check?: (value: unknown) => boolean;  // test if a concrete value belongs to this type
  ops?: Record<string, (self: TypeValue, other: TypeValue) => TypeValue | undefined>;
  methods?: Record<string, (self: TypeValue, args: TypeValue[]) => TypeValue | undefined>;
  properties?: Record<string, (self: TypeValue) => TypeValue | undefined>;
};
```

Returning `undefined` from any handler falls back to the base type's behavior.

---

## Utility Functions

| Function | Description |
|----------|-------------|
| `typeValueEquals(a, b)` | Deep equality for two TypeValues. |
| `simplifyUnion(members)` | Flatten nested unions, deduplicate, remove `never`, and absorb literals into a co-present base (`3 \| number` → `number`). Returns `T.never` if empty, single member if one, `T.unknown` if any member is unknown. |
| `widenLiteral(tv)` | Convert a literal to its primitive: `T.literal(1)` → `T.number`, etc. Non-literals pass through unchanged. |
| `collapseLiteralUnion(tv, maxLiterals)` | Collapse a union of same-primitive literals when it exceeds `maxLiterals` (`1 \| 2 \| … \| 20` → `number`). Heterogeneous unions and unions small enough to keep are returned as-is. |
| `isSubtypeOf(a, b)` | Check if `a` is a subtype of `b`. |
| `typeValueToString(tv)` | Human-readable string representation (e.g. `"number"`, `"string \| number"`). |
| `narrowType(tv, predicate)` | Filter union members by predicate (then `simplifyUnion`); for non-unions, keep the value if the predicate passes, else `T.never`. |
| `subtractType(tv, predicate)` | Keep members where predicate is false (`narrowType` with the inverted predicate). |
| `getPrimitiveTypeOf(tv)` | Return `typeof` string: `"number"`, `"string"`, `"object"`, `"function"`, or `undefined`. |
| `deepCloneTypeValue(tv, idMap?)` | Deep clone; optional `idMap` preserves object identity across clones. |
| `getRefinedBase(tv)` | Recursively unwrap refined types to get the innermost non-refined base. |
| `mergeObjectProperties(a, b)` | Merge two object TypeValues; overlapping keys become unions. |
| `isFnSig(tv)` | Whether `tv` is a signature-only function (created by `T.fnSig`). |
| `getFnSig(tv)` | Read back the `FunctionSignature` of a `T.fnSig` value, or `undefined` for plain functions. |

---

## Operator Semantics (Abs-native)

Operators are algebraic on Abs — there is no `Ops` layer. Arithmetic, comparison, unary, and spread live in:

| Where | What |
|-------|------|
| `core/src/algebra/surface.ts` | `typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs` (unary ops + strict equality) |
| `core/src/algebra/arithmetic.ts` | Binary arithmetic (`+` `-` `*` `/` `%`) and comparison |
| `service/src/evaluator/abs-route.ts` | `tryAbsBinary` / `tryAbsUnary` / `tryAbsObjectSpread` — TypeValue ⇄ Abs routing (union member-wise) |

The `T` factory and `Environment` below are the remaining TypeValue-level APIs; production analysis runs on Abs and bridges to TypeValue only for display.

---

## Built-in Refinements

### Template String

```typescript
createTemplate(parts: TypeValue[]): TypeValue   // e.g. [T.literal("0x"), T.string]
isTemplate(tv: TypeValue): boolean
getTemplateParts(tv: TypeValue): TypeValue[] | undefined
concatTemplates(left: TypeValue, right: TypeValue): TypeValue
```

Template strings are automatically created when concatenating a literal string with an abstract string. They support `startsWith`, `endsWith`, `includes` methods and `length` property.

### Numeric Range

```typescript
createRange(opts: { min?: number; max?: number; integer?: boolean }): TypeValue
isRange(tv: TypeValue): boolean
getRangeMeta(tv: TypeValue): { min?: number; max?: number; integer?: boolean } | undefined
```

Ranges are created by comparison narrowing (e.g. `x >= 0`). They support `>=`, `>`, `<=`, `<` comparison operators with deterministic results when bounds are known.

---

## Mock Helpers

Type-safe mock builders shared by `@nudo:mock` expressions and env files — a `MockHelper` is a plain record whose value fields are **Abs** (the source of truth after the TypeValue eviction). `@nudojs/parser` builds it from the `@nudo:mock` expression via `parseNudoMockExpr`; `@nudojs/service`'s `mockDirectivesToAbsSeeds` turns it into Abs mock seeds:

```typescript
type MockHelper = {
  kind: "mock-helper";
  returnValue?: Abs;        // stub().returns(v)
  resolvedValue?: Abs;      // stub().resolves(v) — call returns Promise<v>
  rejectedValue?: Abs;      // stub().rejects(v) — call throws/rejects with v
  onFirstCallValue?: Abs;   // stub().onFirstCall(v)
  onSecondCallValue?: Abs;  // stub().onSecondCall(v)
  withArgsCases?: { args: Abs[]; returnValue: Abs }[];  // stub().withArgs(...)
  callsFakeImpl?: { params: string[]; body: Node; async?: boolean };  // stub().callsFake(fn) — call executes fn
};

function stub(): MockHelper;
function spy(): MockHelper;
function mock(): MockHelper;
```

`stub`, `spy`, and `mock` all return the same base helper and differ only in intent; behavior comes from the **static builders attached to `stub`/`spy`** — each returns a complete `MockHelper` (there is no instance chaining):

```typescript
stub.returns(v: Abs): MockHelper
stub.resolves(v: Abs): MockHelper       // call returns Promise<v>
stub.rejects(v: Abs): MockHelper        // call rejects with v
stub.onFirstCall(v: Abs): MockHelper
stub.onSecondCall(v: Abs): MockHelper
stub.withArgs(...args: Abs[]): MockHelper
stub.callsFake(fn: { params: string[]; body: Node; async?: boolean }): MockHelper
spy.returns(v: Abs): MockHelper
```

In `@nudo:mock` expressions you write the sinon-style chain `stub().…` — the parser pattern-matches the whole chain and builds the equivalent `MockHelper` (the `stub()` call itself never runs):

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true })
 * @nudo:mock parse = stub().withArgs(T.string).returns(T.number)
 */
```

`withArgs` matches arguments positionally (a conservative approximation of sinon's deep match) and takes precedence over the global `returnValue` in a longer chain; `callsFake(fn)` resolves to the fake function value itself so calls execute it with the real arguments — the same mechanism as an inline arrow-function mock.

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
| `extend(bindings)` | Create child env with new bindings (plain `Record<string, TypeValue>`). |
| `fork()` | Create an empty child env sharing this scope chain — used for branch forking. |
| `has(name)` | Check if name is bound (this env or parent). |
| `snapshot()` | Deep copy of env (for branch forking). |
| `getOwnBindings()` | Get `Record<string, TypeValue>` for bindings in this env only. |
