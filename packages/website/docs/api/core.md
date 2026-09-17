---
sidebar_position: 1
description: "@nudojs/core API — the Abs type system (shape × term × pred × conf), constructors, assignability and formatting, operator semantics, template strings, mock helpers, and Environment."
---

# @nudojs/core

The core package provides the Abs type system, operator semantics, and environment abstraction that power Nudo's abstract interpretation engine. There is a **single type system — Abs**: analysis, display, and projections (`.d.ts` / zod / guards) all consume Abs directly; there is no parallel IR.

## Abs

`Abs` is the type system — a computable value `{ shape, term?, pred?, conf }`:

- **shape** — the extensional carrier: what the value looks like (`prim`, `obj`, `arr`, …).
- **term** — abstract value identity: `lit` (a concrete value), `var` (symbolic α like `A1`), or `app` (an application like `(x + 2)`). This is what makes constraints participate in algebra: `x > 0` ⇒ `x + 1 > 1`.
- **pred** — constraints relative to the term (`(x + 2) > 3`), or `undefined` when vacuously true.
- **conf** — `Confidence`: `"exact" | "path" | "widened" | "mock" | "partial" | "opaque"`.

### Shape Kinds

| `shape.k` | Description |
|-----------|-------------|
| `prim` | Primitive domain (`number`, `string`, `boolean`, `bigint`, `symbol`); a `lit` term makes it a concrete value |
| `obj` | Object with known slots — `{ value: Abs; optional?: boolean }` per key |
| `arr` | Array with one element Abs |
| `tuple` | Fixed length, one Abs per element |
| `fn` | Function value — param names, or `paramTypes`/`returnType` for signature-only functions |
| `eff` | Effect wrapper (`promise` / `generator`) around an inner Abs — rendered `promise<inner>` |
| `brand` | Nominal class instance (e.g. `MemoryStore`, `Error`) |
| `sum` | Union of member Abs |
| `never` | Empty set (unreachable) |
| `unknown` / `any` | Universal set / any value |

---

## Abs Constructors

```typescript
// primitives (domain, no term)
num(): Abs
str(): Abs
bool(): Abs

// literal values (prim shape + lit term)
numLit(value: number): Abs
strLit(value: string): Abs
boolLit(value: boolean): Abs

// objects: slots keyed by property name
obj(slots: Record<string, { value: Abs; optional?: boolean }>): Abs

// symbolic variables (parameters of an intensional signature)
anyVar(id: string, conf?): Abs
numVar(id: string, pred?, conf?): Abs

// constants
never: Abs            // { shape: { k: "never" }, conf: "exact" }
unknown: Abs          // { shape: { k: "unknown" }, conf: "partial" }

// general constructor (pred=true is dropped)
abs(shape: Shape, term: Term | undefined, pred: Pred | undefined, conf: Confidence): Abs

// function values (impl: body AST, closure env, or a direct apply dispatcher)
absFunction(params: string[], impl: { body?: Node; async?: boolean; env?: AstEnv; apply?: (args: Abs[]) => Abs }): Abs
```

Terms and predicates are first-class too: `lit(value)` / `v(id)` build terms, `eq/ne/lt/le/gt/ge`, `ptypeof`, `and/or/not` build preds (`pred.ts`, `term.ts`).

---

## Core Functions

| Function | Description |
|----------|-------------|
| `leqAbs(src, tgt, opts?)` | Assignability: can `src` flow into `tgt`? Returns `{ ok, reason? }` — `reason` is the Nudo-style `actual ⊭ expected` evidence, not TS wording. |
| `formatAbs(a, opts?)` | Human-readable one-liner: shape, `= term`, `where pred`, `#conf`. |
| `formatShape(a)` | Shape-only rendering (`{ host: "localhost", port: 8080 }`, `[2, 4, 6]`, `promise<{…}>`). |
| `formatAbsMultiline(a, label?)` | Multi-line display (CLI inlay). |
| `absToString(a)` / `shapeToString(s)` | Debug rendering including `term=`. |
| `litValue(a)` | Extract the concrete literal value, if the Abs is exact. |
| `confJoin(a, b)` | Join two confidences (the worse one wins). |
| `checkSource(source, opts?)` | The CI gate: refinement/Pred implication over Abs — see [Check](../guides/check.md). |
| `evalProgramAbs(source, opts?)` / `analyzeFn(…)` | Abs-native evaluation entrypoints (AST interpreter path). |
| `generalizeFromAst(…)` | Intensional signature extraction — the `intension:` lines and `A1` parameters. |

---

## Operator Semantics (Abs-native)

Operators are algebraic on Abs. Arithmetic, comparison, unary, and spread live in:

| Where | What |
|-------|------|
| `core/src/algebra/surface.ts` | `typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs` (unary ops + strict equality) |
| `core/src/algebra/arithmetic.ts` | Binary arithmetic (`+` `-` `*` `/` `%`) and comparison |
| `service/src/evaluator/abs-route.ts` | Union member-wise routing of binary/unary ops and object spread |

The B path (`core/algebra/exec`: transpile → `new Function` with Abs values) is the primary evaluation route; `ast-eval`/`evalProgramAbs` is the AST-interpreter fallback.

---

## Template Strings

String concatenation with at least one literal operand produces a **template** Abs — the known prefix/suffix is preserved as pred metadata, enabling precise `startsWith` / `endsWith` / `includes`.

```typescript
createTemplateAbs(parts: Abs[]): Abs   // e.g. [strLit("0x"), str()] — single-part or
                                       // all-literal inputs collapse to the plain Abs
isTemplateLike(a: Abs): boolean
```

Numeric ranges are not a type wrapper in the algebra — a narrowed bound is a **pred** on the term (`x >= 0` stores `ge(x, lit(0))`), which is what `checkSource`'s implication gate reasons over.

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

Environment manages variable bindings (name → Abs) with lexical scoping.

```typescript
createEnvironment(parent?, bindings?)
```

- `parent` — Optional parent Environment for scope chain.
- `bindings` — Optional `Map<string, Abs>` for initial bindings (default: `new Map()`).

### Environment Methods

| Method | Description |
|--------|-------------|
| `lookup(name)` | Get the Abs bound to `name`; walks parent chain; returns the `unknown` Abs if missing. |
| `bind(name, value)` | Set binding in this env; returns env for chaining. |
| `update(name, value)` | Update existing binding in this env or parent; returns `boolean` success. |
| `extend(bindings)` | Create child env with new bindings (plain `Record<string, Abs>`). |
| `fork()` | Create an empty child env sharing this scope chain — used for branch forking. |
| `has(name)` | Check if name is bound (this env or parent). |
| `snapshot()` | Deep copy of env (for branch forking). |
| `getOwnBindings()` | Get `Record<string, Abs>` for bindings in this env only. |
