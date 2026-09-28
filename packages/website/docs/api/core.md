---
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
| `any` | Unconstrained JS value union — default for unannotated entry params; developer refines |
| `unknown` | Inference failed / engine has no information — **not** the same as `any`; Nudo owns the fix |

See [Abs — any vs unknown](../concepts/abs.md#any-vs-unknown).

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
// any / unknown are distinct product concepts:
//   any     — unconstrained (entry default when unannotated)
//   unknown — inference failed (engine debt), conf typically partial/opaque
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
| `runTranspiled` / `callTranspiledExportFull` / `analyzeFn(…)` | Abs-native evaluation entrypoints (evaluator). |
| `generalizeFromAst(…)` | Intensional signature extraction — the `intension:` lines and `A1` parameters. |

---

## Operator Semantics (Abs-native)

Operators are algebraic on Abs. Arithmetic, comparison, unary, and spread live in:

| Where | What |
|-------|------|
| `core/src/algebra/surface.ts` | `typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs` (unary ops + strict equality) |
| `core/src/algebra/arithmetic.ts` | Binary arithmetic (`+` `-` `*` `/` `%`) and comparison |
| `service/src/evaluator/abs-route.ts` | Union member-wise routing of binary/unary ops and object spread |

The single evaluation engine is evaluator (`core/algebra/exec`: transpile → `new Function` with Abs values). eval-incapable sources fail closed to `unknown` / empty exports.

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

Type-safe mock builders shared by `@nudo:mock` expressions and env files — a `MockHelper` is a plain record whose value fields are **Abs** (the sole type system; analysis never reads a projection back). `@nudojs/parser` builds it from the `@nudo:mock` expression via `parseNudoMockExpr`; `@nudojs/service`'s `mockDirectivesToAbsSeeds` turns it into Abs mock seeds:

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
 * @nudo:mock parse = stub().withArgs(string()).returns(number())
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

## Export inventory

<!-- NUDO-API-SKELETON:BEGIN -->
> Generated by `pnpm run docs:gen:api` from package export surfaces (`PUBLIC_API.md` / `src/index.ts`) — do not edit this block. Regenerate with `node scripts/gen-api-docs.mjs`. A `—` summary means the source JSDoc first sentence is not yet English — see the package source. Each row's name carries a stable anchor `#slug` (the lowercased symbol name).

Product-face inventory from `packages/core/PUBLIC_API.md` §2, grouped by subsection: type system core (§2.1) and exec runtime (§2.2, the `$op` family). Remaining non-`$op` names re-exported from `src/index.ts` are folded into the collapsible list below. Host machinery lives on `@nudojs/core/internal` and is intentionally out of scope.

### Type system core (§2.1)

| Name | Kind | Summary | Signature |
|------|------|------|------|
| <a id="abs"></a>`abs` | fn | Abs constructors / faces | `abs( shape: Shape, term: Term \| undefined, pred: Pred \| undefined, conf: Confidence, ): Abs` |
| <a id="abs"></a>`Abs` | type | Abs = shape × term × pred × conf | `Abs = { shape: Shape; term?: Term; pred?: Pred; conf: Confidence; pathNote?: string; }` |
| <a id="abstoschemasource"></a>`absToSchemaSource` | const | one-way projections | — |
| <a id="abstotstype"></a>`absToTSType` | const | one-way projections | — |
| <a id="and"></a>`and` | fn | `@nudo:contract` builder grammar | `and(...preds: Pred[]): Pred` |
| <a id="andc"></a>`andC` | fn | `@nudo:contract` builder grammar | `andC( ...cs: (NudoConstraint \| ConstraintBuilder)[] ): ConstraintBuilder` |
| <a id="any"></a>`any` | fn | Abs constructors / faces | `any(): ConstraintBuilder` |
| <a id="anyabs"></a>`anyAbs` | const | Abs constructors / faces | `const anyAbs` |
| <a id="anyvar"></a>`anyVar` | fn | Abs constructors / faces | `anyVar(id: string, conf: Confidence = "path"): Abs` |
| <a id="app"></a>`app` | const | term / shape builders | `const app` |
| <a id="array"></a>`array` | fn | term / shape builders | `array( item: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined, ): ConstraintBuilder` |
| <a id="bigintlit"></a>`bigintLit` | fn | literal Abs | `bigintLit(value: bigint): Abs` |
| <a id="bool"></a>`bool` | fn | Abs constructors / faces | `bool(): Abs` |
| <a id="boolean"></a>`boolean` | fn | `@nudo:contract` builder grammar | `boolean(): ConstraintBuilder` |
| <a id="boollit"></a>`boolLit` | fn | literal Abs | `boolLit(value: boolean): Abs` |
| <a id="calltranspiledexport"></a>`callTranspiledExport` | fn | evaluator execution (analyze mode) | `callTranspiledExport( exports: Record<string, unknown>, name: string, args: Abs[], ): Abs` |
| <a id="calltranspiledexportfull"></a>`callTranspiledExportFull` | fn | evaluator execution (analyze mode) | `callTranspiledExportFull( exports: Record<string, unknown>, name: string, args: Abs[], opts?: { phi?: Phi }, ): TranspiledCallResult` |
| <a id="checkarg"></a>`checkArg` | fn | contract checking | `checkArg( arg: Abs, expect: Pred \| undefined, phi: Phi = pTrue, ): Diagnostic \| undefined` |
| <a id="checkcall"></a>`checkCall` | fn | contract checking | `checkCall( source: string, fnName: string, args: Abs[], phi: Phi = pTrue, ): Diagnostic[]` |
| <a id="checkjson"></a>`CheckJson` | type | `nudo check` gate | `CheckJson = { version: 1; file: string; ok: boolean; summary: CheckReport["summary"]; signatures: Array<{ name: string; params: string[];...` |
| <a id="checkreport"></a>`CheckReport` | type | `nudo check` gate | `CheckReport = { file: string; issues: CheckIssue[]; ok: boolean; signatures: NudoSig[]; summary: { errors: number; warnings: number; info...` |
| <a id="checksource"></a>`checkSource` | fn | `nudo check` gate | `checkSource( filePath: string, source: string, phi: Phi = pTrue, opts: CheckOptions = {}, ): CheckReport` |
| <a id="confidence"></a>`Confidence` | type | Abs = shape × term × pred × conf | `Confidence = "exact" \| "path" \| "widened" \| "mock" \| "partial" \| "opaque"` |
| <a id="confjoin"></a>`confJoin` | fn | assignability / join | `confJoin(a: Confidence, b: Confidence): Confidence` |
| <a id="constraintbuilder"></a>`ConstraintBuilder` | type | `@nudo:contract` builder grammar | `ConstraintBuilder = NudoConstraint & { gt(n: number): ConstraintBuilder; ge(n: number): ConstraintBuilder; lt(n: number): ConstraintBuild...` |
| <a id="createenvironment"></a>`createEnvironment` | fn | env host surface | `createEnvironment( parent?: Environment, bindings: Map<string, Abs> = new Map(), ): Environment` |
| <a id="effectiveinterface"></a>`effectiveInterface` | fn | interface tiers | `effectiveInterface( source: string, fnName: string, opts: EffectiveInterfaceOpts = {}, ): EffectiveInterface \| undefined` |
| <a id="effectiveinterface"></a>`EffectiveInterface` | type | interface tiers | `EffectiveInterface = { fnName: string; params: Array<{ param: string; constraint: NudoConstraint }>; returns?: { constraint: NudoConstrai...` |
| <a id="environment"></a>`Environment` | type | env host surface | `Environment = { lookup(name: string): Abs; bind(name: string, value: Abs): Environment; update(name: string, value: Abs): boolean; extend...` |
| <a id="evalexprabs"></a>`evalExprAbs` | fn | Abs-native expression eval | `evalExprAbs( expr: import("@babel/types").Expression, bindings: Record<string, Abs> = {}, ): Abs` |
| <a id="extractrefinesfromsource"></a>`extractRefinesFromSource` | fn | refinement gate | `extractRefinesFromSource( source: string, fnName: string, opts: RefineResolveOpts = {}, ): RefineEntry[]` |
| <a id="fn"></a>`fn` | fn | term / shape builders | `fn( params: Record<string, NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined>, returns?: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined, opts?: { throws?: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined }, ): ConstraintBuilder` |
| <a id="fnof"></a>`fnOf` | fn | term / shape builders | `fnOf(params: string[], name?: string): Abs` |
| <a id="formatabs"></a>`formatAbs` | fn | extensional rendering (one-way) | `formatAbs(a: Abs, opts: FormatOptions = {}): string` |
| <a id="formatcheckreport"></a>`formatCheckReport` | fn | extensional rendering (one-way) | `formatCheckReport(r: CheckReport, opts: { verbose?: boolean } = {}): string` |
| <a id="formatconstraint"></a>`formatConstraint` | fn | extensional rendering (one-way) | `formatConstraint(c: NudoConstraint): string` |
| <a id="formatshape"></a>`formatShape` | fn | extensional rendering (one-way) | `formatShape(a: Abs): string` |
| <a id="generalizeall"></a>`generalizeAll` | fn | symbolic α generalization | `generalizeAll( source: string, opts: { budget?: LeakBudget } = {}, ): PolyFn[]` |
| <a id="generalizefromast"></a>`generalizeFromAst` | fn | symbolic α generalization | `generalizeFromAst( fnName: string, source: string, opts: { budget?: LeakBudget; label?: string; refine?: EffectiveInterfaceOpts; file?: ReturnType<typeof babelParse>; depsFp?: LoadDepsFingerprint; sidecarFp?: string; modules?: Record<string, AbsModuleExports \| Record<string, unknown>>; inject?: RunTranspiledOptions; } = {}, ): PolyFn \| undefined` |
| <a id="getparsesourcecachesize"></a>`getParseSourceCacheSize` | fn | Babel parse + memo | `getParseSourceCacheSize(): number` |
| <a id="instantiateconstraint"></a>`instantiateConstraint` | fn | contract checking | `instantiateConstraint( c: NudoConstraint, paramName: string, ): Pred` |
| <a id="interfacetierinfo"></a>`InterfaceTierInfo` | type | interface tiers | `InterfaceTierInfo = { source: InterfaceSource; display?: string; }` |
| <a id="interfacetierof"></a>`interfaceTierOf` | fn | interface tiers | `interfaceTierOf( source: string, fnName: string, fromFile: string, opts: InterfaceTierOpts = {}, ): InterfaceTierInfo \| undefined` |
| <a id="isexactlit"></a>`isExactLit` | fn | literal Abs | `isExactLit(a: Abs): boolean` |
| <a id="joinabs"></a>`joinAbs` | fn | assignability / join | `joinAbs(a: Abs, b: Abs): Abs` |
| <a id="joinvalues"></a>`joinValues` | fn | assignability / join | `joinValues(a: Abs, b: Abs): Abs` |
| <a id="leqabs"></a>`leqAbs` | fn | assignability / join | `leqAbs( src: Abs, tgt: Abs, opts: { phi?: Phi; env?: AstEnv } = {}, ): LeqResult` |
| <a id="lit"></a>`lit` | const | term / shape builders | `const lit` |
| <a id="litc"></a>`litC` | fn | `@nudo:contract` builder grammar | `litC(v: number \| string \| boolean \| null \| undefined): ConstraintBuilder` |
| <a id="litvalue"></a>`litValue` | fn | literal Abs | `litValue(a: Abs): LiteralValue \| undefined` |
| <a id="makesum"></a>`makeSum` | fn | term / shape builders | `makeSum(a: Abs, b: Abs): Abs` |
| <a id="mock"></a>`mock` | fn | test mock helpers | `mock(): MockHelper` |
| <a id="mockhelper"></a>`MockHelper` | type | test mock helpers | `MockHelper = { kind: "mock-helper"; returnValue?: Abs; resolvedValue?: Abs; rejectedValue?: Abs; onFirstCallValue?: Abs; onSecondCallValu...` |
| <a id="never"></a>`never` | const | Abs constructors / faces | `const never` |
| <a id="nudoconstraint"></a>`NudoConstraint` | type | contract checking | `NudoConstraint = { readonly __nudoConstraint: true; readonly prim?: PrimName; readonly preds: Pred[]; readonly fields?: Record<string, Nu...` |
| <a id="num"></a>`num` | fn | Abs constructors / faces | `num(): Abs` |
| <a id="number"></a>`number` | fn | `@nudo:contract` builder grammar | `number(): ConstraintBuilder` |
| <a id="numlit"></a>`numLit` | fn | literal Abs | `numLit(value: number): Abs` |
| <a id="obj"></a>`obj` | fn | term / shape builders | `obj( slots: Record<string, { value: Abs; optional?: boolean }>, ): Abs` |
| <a id="objshape"></a>`ObjShape` | type | Abs = shape × term × pred × conf | `ObjShape = { k: "obj"; slots: Record<string, Slot>; index?: { key: Abs; value: Abs }; open?: boolean; }` |
| <a id="parsesource"></a>`parseSource` | fn | Babel parse + memo | `parseSource( source: string, opts?: { errorRecovery?: boolean; keepTs?: boolean }, ): File` |
| <a id="phi"></a>`Phi` | type | Abs = shape × term × pred × conf | `Phi = Pred` |
| <a id="pred"></a>`Pred` | type | Abs = shape × term × pred × conf | `Pred = \| { op: "true" } \| { op: "false" } \| { op: "eq"; a: Term; b: Term } \| { op: "ne"; a: Term; b: Term } \| { op: "lt"; a: Term; b: Ter...` |
| <a id="projectabstoschema"></a>`projectAbsToSchema` | const | one-way projections | — |
| <a id="refineabsforreltrue"></a>`refineAbsForRelTrue` | fn | refinement gate | `refineAbsForRelTrue( a: Abs, op: "gt" \| "ge" \| "lt" \| "le", k: number, ): Abs` |
| <a id="resetparsesourcecache"></a>`resetParseSourceCache` | fn | Babel parse + memo | `resetParseSourceCache(): void` |
| <a id="runtranspiled"></a>`runTranspiled` | fn | evaluator execution (analyze mode) | `runTranspiled( source: string, opts: RunTranspiledOptions = {}, ): Record<string, unknown>` |
| <a id="serializecheckjson"></a>`serializeCheckJson` | fn | `nudo check` gate | `serializeCheckJson(r: CheckReport): CheckJson` |
| <a id="serializecheckjsonmulti"></a>`serializeCheckJsonMulti` | fn | `nudo check` gate | `serializeCheckJsonMulti(reports: CheckJson[]): CheckJsonMulti` |
| <a id="shape"></a>`shape` | fn | term / shape builders | `shape( fields: Record< string, NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined >, ): ConstraintBuilder` |
| <a id="shape"></a>`Shape` | type | Abs = shape × term × pred × conf | `Shape = \| { k: "never" } \| { k: "any" } \| { k: "unknown" } \| { k: "prim"; type: PrimName } \| { k: "obj"; slots: Record<string, { value: A...` |
| <a id="slot"></a>`Slot` | type | Abs = shape × term × pred × conf | `Slot = { value: Abs; optional?: boolean; readonly?: boolean }` |
| <a id="spy"></a>`spy` | fn | test mock helpers | `spy(): MockHelper` |
| <a id="str"></a>`str` | fn | Abs constructors / faces | `str(): Abs` |
| <a id="string"></a>`string` | fn | `@nudo:contract` builder grammar | `string(): ConstraintBuilder` |
| <a id="striptypes"></a>`stripTypes` | fn | AST TS-stripping helper | `stripTypes<T extends Node>(ast: T): T` |
| <a id="strlit"></a>`strLit` | fn | literal Abs | `strLit(value: string): Abs` |
| <a id="stub"></a>`stub` | fn | test mock helpers | `stub(): MockHelper` |
| <a id="term"></a>`Term` | type | Abs = shape × term × pred × conf | `Term = \| { op: "lit"; value: LiteralValue } \| { op: "var"; id: string } \| { op: "app"; fn: string; args: Term[] }` |
| <a id="transpiledcallresult"></a>`TranspiledCallResult` | type | evaluator execution (analyze mode) | `TranspiledCallResult = { result: Abs; throws: Abs; }` |
| <a id="union"></a>`union` | fn | term / shape builders | `union( ...cs: (NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined)[] ): ConstraintBuilder` |
| <a id="unknown"></a>`unknown` | const | Abs constructors / faces | `const unknown` |
| <a id="v"></a>`v` | const | term / shape builders | `const v` |

### Exec runtime ($op, §2.2)

| Name | Kind | Summary | Signature |
|------|------|------|------|
| <a id="$add"></a>`$add` | fn | operator runtime | `$add(a: Abs, b: Abs): Abs` |
| <a id="$arguments"></a>`$arguments` | fn | array runtime | `$arguments(items: ArrayLike<unknown>): Abs` |
| <a id="$arr"></a>`$arr` | fn | array runtime | `$arr(items: Abs[]): Abs` |
| <a id="$arrmutcontainer"></a>`$arrMutContainer` | fn | array runtime | `$arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs` |
| <a id="$arrrest"></a>`$arrRest` | fn | object / member runtime | `$arrRest(a: Abs, start: number): Abs` |
| <a id="$arrwithholes"></a>`$arrWithHoles` | fn | array runtime | `$arrWithHoles(items: Abs[], holes: number[]): Abs` |
| <a id="$assignrecord"></a>`$assignRecord` | fn | call-site recording for analyze | `$assignRecord( name: string, prev: Abs \| undefined, next: Abs, line: number, column: number, conditional: boolean, ): void` |
| <a id="$async"></a>`$async` | fn | async / generator | `$async(thunk: () => Abs): Abs` |
| <a id="$asyncreturn"></a>`$asyncReturn` | fn | async / generator | `$asyncReturn(v: Abs): Abs` |
| <a id="$await"></a>`$await` | fn | async / generator | `$await(v: Abs): Abs` |
| <a id="$callnamed"></a>`$callNamed` | fn | call-site recording for analyze | `$callNamed( name: string, fn: unknown, args: Abs[], loc?: [number, number], argLocs?: Array<[number, number] \| null \| undefined>, ): Abs` |
| <a id="$catchval"></a>`$catchVal` | fn | control-signal / throw | `$catchVal(e: unknown): Abs` |
| <a id="$classexpr"></a>`$classExpr` | fn | value / class runtime | `$classExpr(): Abs` |
| <a id="$concat"></a>`$concat` | fn | object / member runtime | `$concat(a: Abs, b: Abs): Abs` |
| <a id="$copy"></a>`$copy` | fn | array runtime | `$copy(a: Abs): Abs` |
| <a id="$del"></a>`$del` | fn | object / member runtime | `$del(o: Abs, key: Abs): Abs` |
| <a id="$elems"></a>`$elems` | fn | object / member runtime | `$elems(a: Abs): Abs[]` |
| <a id="$eq"></a>`$eq` | fn | operator runtime | `$eq(a: Abs, b: Abs): Abs` |
| <a id="$fnval"></a>`$fnVal` | fn | value / class runtime | `$fnVal( params: string[], impl: (...args: Abs[]) => Abs, opts?: { bindThis?: boolean }, ): Abs` |
| <a id="$for"></a>`$for` | fn | control-flow lowering | `$for( init: Abs, test: (s: Abs) => Abs, step: (s: Abs) => Abs, body: (s: Abs) => Abs, maxIters: number = DEFAULT_MAX_LOOP_ITERS, opts?: { pack?: () => Abs; unpack?: (s: Abs) => void; label?: string; }, ): Abs` |
| <a id="$foriter"></a>`$forIter` | const | control-flow lowering | — |
| <a id="$fork"></a>`$fork` | fn | control-flow lowering | `$fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs` |
| <a id="$ge"></a>`$ge` | fn | operator runtime | `$ge(a: Abs, b: Abs): Abs` |
| <a id="$gen"></a>`$gen` | fn | async / generator | `$gen(body: () => void): Abs` |
| <a id="$get"></a>`$get` | fn | object / member runtime | `$get( o: Abs, key: string, opts?: { silent?: boolean }, ): Abs` |
| <a id="$idx"></a>`$idx` | fn | array runtime | `$idx(a: Abs, i: Abs): Abs` |
| <a id="$idxset"></a>`$idxSet` | fn | array runtime | `$idxSet(a: Abs, i: Abs, value: Abs): Abs` |
| <a id="$in"></a>`$in` | fn | value / class runtime | `$in(key: Abs, o: Abs): Abs` |
| <a id="$instanceof"></a>`$instanceof` | fn | value / class runtime | `$instanceof(left: Abs, rightName: string, rightVal?: Abs): Abs` |
| <a id="$join"></a>`$join` | fn | operator runtime | `$join(a: Abs, b: Abs): Abs` |
| <a id="$len"></a>`$len` | fn | array runtime | `$len(a: Abs): Abs` |
| <a id="$lit"></a>`$lit` | fn | value / class runtime | `$lit(v: unknown): Abs` |
| <a id="$loopbreak"></a>`$loopBreak` | fn | control-signal / throw | `$loopBreak(label?: string): never` |
| <a id="$loopcontinue"></a>`$loopContinue` | fn | control-signal / throw | `$loopContinue(label?: string): never` |
| <a id="$loopreturn"></a>`$loopReturn` | fn | control-signal / throw | `$loopReturn(v: Abs): never` |
| <a id="$neg"></a>`$neg` | fn | operator runtime | `$neg(a: Abs): Abs` |
| <a id="$not"></a>`$not` | fn | operator runtime | `$not(a: Abs): Abs` |
| <a id="$nullishtest"></a>`$nullishTest` | fn | control-flow lowering | `$nullishTest(v: Abs): Abs` |
| <a id="$obj"></a>`$obj` | fn | object / member runtime | `$obj(slots: Record<string, Abs>): Abs` |
| <a id="$objrest"></a>`$objRest` | fn | object / member runtime | `$objRest(o: Abs, keys: string[]): Abs` |
| <a id="$pow"></a>`$pow` | fn | operator runtime | `$pow(a: Abs, b: Abs): Abs` |
| <a id="$rawthis"></a>`$rawThis` | fn | value / class runtime | `$rawThis(v: unknown): Abs` |
| <a id="$recordbinding"></a>`$recordBinding` | fn | call-site recording for analyze | `$recordBinding(name: string, value: unknown): void` |
| <a id="$set"></a>`$set` | fn | object / member runtime | `$set(o: Abs, key: string, value: Abs): Abs` |
| <a id="$spread"></a>`$spread` | fn | object / member runtime | `$spread(a: Abs, b: Abs): Abs` |
| <a id="$switch"></a>`$switch` | fn | control-flow lowering | `$switch( disc: Abs, cases: Array<{ test: Abs; run: () => Abs }>, dflt?: () => Abs, ): Abs` |
| <a id="$throw"></a>`$throw` | fn | control-signal / throw | `$throw(v: Abs): never` |
| <a id="$typeof"></a>`$typeof` | fn | operator runtime | `$typeof(a: Abs): Abs` |
| <a id="$while"></a>`$while` | fn | control-flow lowering | `$while( init: Abs, test: (s: Abs) => Abs, step: (s: Abs) => Abs, maxIters: number = DEFAULT_MAX_LOOP_ITERS, ): Abs` |
| <a id="$whileseq"></a>`$whileSeq` | fn | control-flow lowering | `$whileSeq( test: () => Abs, body: () => void, maxIters: number = DEFAULT_MAX_LOOP_ITERS, opts?: { pack?: () => Abs; unpack?: (s: Abs) => void; label?: string; }, ): void` |
| <a id="$yield"></a>`$yield` | fn | async / generator | `$yield(v: Abs): Abs` |
| <a id="asabsval"></a>`asAbsVal` | fn | value / class runtime | `asAbsVal(v: unknown): Abs` |
| <a id="evalcallrecord"></a>`EvalCallRecord` | type | call-site recording for analyze | `EvalCallRecord = { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean; }` |
| <a id="filltuple"></a>`fillTuple` | fn | array runtime | `fillTuple( shape: { k: "tuple"; elements: Abs[]; holes?: number[] } \| { k: "arr"; element: Abs }, vals: Abs[], arr: Abs, ): Abs` |
| <a id="foldrequirespecarg"></a>`foldRequireSpecArg` | fn | static folding helpers | `foldRequireSpecArg(arg: unknown): string \| undefined` |
| <a id="foldstaticstringexpr"></a>`foldStaticStringExpr` | fn | static folding helpers | `foldStaticStringExpr(node: unknown): string \| undefined` |
| <a id="isarrmutator"></a>`isArrMutator` | fn | array runtime | `isArrMutator(name: string): boolean` |
| <a id="nudoloopsignal"></a>`NudoLoopSignal` | type | control-signal / throw | `NudoLoopSignal extends Error { readonly kind: "break" \| "continue"; readonly label: string \| undefined; constructor(kind: "break" \| "cont...` |
| <a id="nudoreturn"></a>`NudoReturn` | type | control-signal / throw | `NudoReturn extends Error { readonly absValue: Abs; constructor(absValue: Abs) { super("nudo:return"); this.name = "NudoReturn"; this.absV...` |
| <a id="nudothrow"></a>`NudoThrow` | type | control-signal / throw | — |
| <a id="runtimeimportof"></a>`runtimeImportOf` | fn | JS AST → `$op` program | `runtimeImportOf(runtime: string): string` |
| <a id="setevalcallcollector"></a>`setEvalCallCollector` | fn | call-site recording for analyze | `setEvalCallCollector( collector: ((r: EvalCallRecord) => void) \| null, )` |
| <a id="transpile"></a>`transpile` | fn | JS AST → `$op` program | `transpile(source: string, opts?: TranspileOptions): string` |
| <a id="transpilebodynode"></a>`transpileBodyNode` | fn | JS AST → `$op` program | `transpileBodyNode(node: Node, opts: TranspileOptions): string` |
| <a id="transpileexpression"></a>`transpileExpression` | fn | JS AST → `$op` program | `transpileExpression(expr: Expression, opts: TranspileOptions = {}): string` |
| <a id="transpilefile"></a>`transpileFile` | fn | JS AST → `$op` program | `transpileFile(file: File, opts: TranspileOptions = {}): string` |
| <a id="transpileoptions"></a>`TranspileOptions` | type | JS AST → `$op` program | — |
| <a id="transpilesource"></a>`transpileSource` | fn | JS AST → `$op` program | `transpileSource(source: string, opts: TranspileOptions = {}): string` |

<details>
<summary>Additional exports from src/index.ts (328)</summary>

| Name | Kind | Summary | Signature |
|------|------|------|------|
| <a id="absassignrecord"></a>`AbsAssignRecord` | type | — | `AbsAssignRecord = { name: string; prev?: Abs; next: Abs; line?: number; column?: number; conditional?: boolean; }` |
| <a id="abscallrecord"></a>`AbsCallRecord` | type | — | `AbsCallRecord = { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean; }` |
| <a id="absfnimpl"></a>`AbsFnImpl` | type | — | `AbsFnImpl = { params: string[]; body?: Node; async?: boolean; env?: AstEnv; kind?: string; apply?: (args: Abs[], thisVal?: Abs) => Abs; b...` |
| <a id="absfunction"></a>`absFunction` | fn | — | `absFunction( params: string[], impl: Omit<AbsFnImpl, "params">, ): Abs` |
| <a id="absmoduleexports"></a>`AbsModuleExports` | type | — | `AbsModuleExports = { named: Record<string, Abs>; default?: Abs; }` |
| <a id="absshapekey"></a>`absShapeKey` | fn | — | `absShapeKey(a: Abs, seen: Set<object> = new Set()): string` |
| <a id="abssigimpl"></a>`AbsSigImpl` | type | — | `AbsSigImpl = (args: Abs[], thisVal?: Abs) => Abs \| undefined` |
| <a id="abstoconstraint"></a>`absToConstraint` | fn | — | `absToConstraint(a: Abs): NudoConstraint \| undefined` |
| <a id="abstostring"></a>`absToString` | fn | — | `absToString(a: Abs): string` |
| <a id="actionsforissue"></a>`actionsForIssue` | fn | — | `actionsForIssue(i: { code: string; expected?: string; suggestion?: string; fn?: string; }): CheckAction[]` |
| <a id="add"></a>`add` | fn | — | `add(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="alphaof"></a>`alphaOf` | fn | — | `alphaOf( absOrTerm: Abs \| Term \| undefined, ctx: HofCollectCtx, ): Term` |
| <a id="applycallbackabs"></a>`applyCallbackAbs` | fn | — | `applyCallbackAbs( cb: Abs \| { type: string }, args: Abs[], env: unknown, phi: unknown, budget: unknown, ): Abs` |
| <a id="applycallbackvalue"></a>`applyCallbackValue` | fn | — | `applyCallbackValue( fn: unknown, args: Abs[], env: unknown, phi: unknown, budget: unknown, ): Abs` |
| <a id="asabs"></a>`asAbs` | fn | — | `asAbs(v: unknown): Abs \| undefined` |
| <a id="assignsourceslots"></a>`assignSourceSlots` | fn | — | `assignSourceSlots(src: Abs): Record<string, { value: Abs }> \| undefined` |
| <a id="astenv"></a>`AstEnv` | type | — | — |
| <a id="attachfnimpl"></a>`attachFnImpl` | fn | — | `attachFnImpl(a: Abs, impl: AbsFnImpl): void` |
| <a id="begincollectionfork"></a>`beginCollectionFork` | fn | — | `beginCollectionFork(): void` |
| <a id="betaof"></a>`betaOf` | fn | — | `betaOf(param: string): Term` |
| <a id="bindimports"></a>`bindImports` | fn | — | `bindImports( node: ImportDeclaration, env: AstEnv, modules: Record<string, AbsModuleExports>, ): void` |
| <a id="bindingsof"></a>`bindingsOf` | fn | — | `bindingsOf(run: Record<string, unknown>): Map<string, unknown> \| undefined` |
| <a id="bitandabs"></a>`bitandAbs` | fn | — | `bitandAbs(a: Abs, b: Abs): Abs` |
| <a id="bitnotabs"></a>`bitnotAbs` | fn | — | `bitnotAbs(a: Abs): Abs` |
| <a id="bitorabs"></a>`bitorAbs` | fn | — | `bitorAbs(a: Abs, b: Abs): Abs` |
| <a id="bitxorabs"></a>`bitxorAbs` | fn | — | `bitxorAbs(a: Abs, b: Abs): Abs` |
| <a id="buildargsfromassume"></a>`buildArgsFromAssume` | fn | — | `buildArgsFromAssume( source: string, fnName: string, assumeIds: Set<string>, ): Abs[]` |
| <a id="builtinctorabs"></a>`builtinCtorAbs` | fn | — | `builtinCtorAbs(name: string): Abs` |
| <a id="builtinctornameof"></a>`builtinCtorNameOf` | fn | — | `builtinCtorNameOf(v: unknown): string \| undefined` |
| <a id="callabsmethod"></a>`callAbsMethod` | fn | — | `callAbsMethod( recv: Abs, name: string, args: Abs[], ): Abs \| undefined` |
| <a id="callatfunctionboundary"></a>`callAtFunctionBoundary` | fn | — | `callAtFunctionBoundary<T>(body: () => T): T` |
| <a id="canonicalarrayindex"></a>`canonicalArrayIndex` | fn | — | `canonicalArrayIndex(v: unknown): number \| undefined` |
| <a id="checkaction"></a>`CheckAction` | type | — | `CheckAction = { kind: "draft" \| "relax" \| "callsite" \| "assume" \| "mock" \| "emit" \| "ignore-throws" \| "info"; command?: string; label: st...` |
| <a id="checkissue"></a>`CheckIssue` | type | — | `CheckIssue = Diagnostic & { fn?: string; line?: number; column?: number; actual?: string; expected?: string; actions?: CheckAction[]; }` |
| <a id="checkjsonmulti"></a>`CheckJsonMulti` | type | — | `CheckJsonMulti = { version: 1; kind: "multi"; ok: boolean; summary: CheckReport["summary"] & { files: number; budgetTruncated?: boolean }...` |
| <a id="checkoptions"></a>`CheckOptions` | type | — | — |
| <a id="clearbclasses"></a>`clearBClasses` | fn | — | `clearBClasses(): void` |
| <a id="clearcollectiontables"></a>`clearCollectionTables` | fn | — | `clearCollectionTables(): void` |
| <a id="clearstaletermpred"></a>`clearStaleTermPred` | fn | — | `clearStaleTermPred(v: Abs): void` |
| <a id="cmp"></a>`cmp` | fn | — | `cmp( op: "lt" \| "le" \| "gt" \| "ge" \| "eq" \| "ne", a: Abs, b: Abs, phi: Phi = pTrue, ): Abs` |
| <a id="collectabsexports"></a>`collectAbsExports` | fn | — | `collectAbsExports( file: File, env: AstEnv, modules?: Record<string, AbsModuleExports>, ): AbsModuleExports` |
| <a id="collectabsfreevars"></a>`collectAbsFreeVars` | fn | — | `collectAbsFreeVars(a: Abs): Set<string>` |
| <a id="collectionelementjoin"></a>`collectionElementJoin` | fn | — | `collectionElementJoin(c: Abs): Abs` |
| <a id="collectionexactlen"></a>`collectionExactLen` | fn | — | `collectionExactLen(c: Abs): number \| undefined` |
| <a id="constrainttoentryabs"></a>`constraintToEntryAbs` | fn | — | `constraintToEntryAbs( c: NudoConstraint, paramName: string, ): Abs` |
| <a id="contractparamnameset"></a>`contractParamNameSet` | fn | — | `contractParamNameSet(formals: FormalParam[]): Set<string>` |
| <a id="createhofcollectctx"></a>`createHofCollectCtx` | fn | — | `createHofCollectCtx( paramNames: ReadonlySet<string>, alphaIds: Iterable<string>, ): HofCollectCtx` |
| <a id="ctorargdefinitelyinvalid"></a>`ctorArgDefinitelyInvalid` | fn | — | `ctorArgDefinitelyInvalid( name: "Map" \| "Set", iterable: Abs \| undefined, ): boolean` |
| <a id="ctornameofrecv"></a>`ctorNameOfRecv` | fn | — | `ctorNameOfRecv(recv: Abs): string \| undefined` |
| <a id="currentexecphi"></a>`currentExecPhi` | fn | — | `currentExecPhi(): Phi` |
| <a id="currentphi"></a>`currentPhi` | fn | — | `currentPhi(): Phi` |
| <a id="default_max_loop_iters"></a>`DEFAULT_MAX_LOOP_ITERS` | const | — | `const DEFAULT_MAX_LOOP_ITERS` |
| <a id="definitelynotnullishshape"></a>`definitelyNotNullishShape` | fn | — | `definitelyNotNullishShape(s: Shape): boolean` |
| <a id="describephi"></a>`describePhi` | fn | — | `describePhi(): string` |
| <a id="diagnostic"></a>`Diagnostic` | type | — | `Diagnostic = { severity: "error" \| "warning" \| "info"; code: string; message: string; suggestion?: string; fn?: string; argIndex?: number; }` |
| <a id="div"></a>`div` | fn | — | `div(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="drainpromisemicros"></a>`drainPromiseMicros` | fn | — | `drainPromiseMicros(): void` |
| <a id="effectiveinterfaceopts"></a>`EffectiveInterfaceOpts` | type | — | `EffectiveInterfaceOpts = RefineResolveOpts & { autoBind?: boolean \| ((sidecarPath: string) => boolean); projectDir?: string; }` |
| <a id="emptyenv"></a>`emptyEnv` | fn | — | `emptyEnv(): AstEnv` |
| <a id="emptyphi"></a>`emptyPhi` | const | — | `const emptyPhi` |
| <a id="endcollectionfork"></a>`endCollectionFork` | fn | — | `endCollectionFork(arms: Array<ArmOverlay \| undefined \| null>): void` |
| <a id="enterpromiseexecutorscope"></a>`enterPromiseExecutorScope` | fn | — | `enterPromiseExecutorScope(): void` |
| <a id="eq"></a>`eq` | const | — | `const eq` |
| <a id="errorbrandabs"></a>`errorBrandAbs` | fn | — | `errorBrandAbs(name: string, args: Abs[]): Abs` |
| <a id="evalabsassignrecord"></a>`EvalAbsAssignRecord` | type | — | `EvalAbsAssignRecord = { name: string; prev: Abs \| undefined; next: Abs; line?: number; column?: number; conditional?: boolean; }` |
| <a id="evalarraystatic"></a>`evalArrayStatic` | fn | Array.isArray / Array.from / Array.of | `evalArrayStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalbuiltininstancemethod"></a>`evalBuiltinInstanceMethod` | fn | — | `evalBuiltinInstanceMethod( brandName: string, method: string, recv: Abs, args: Abs[], ): Abs \| undefined` |
| <a id="evalbuiltinnew"></a>`evalBuiltinNew` | fn | new X(...) | `evalBuiltinNew(className: string, args: Abs[]): Abs \| undefined` |
| <a id="evalclassspec"></a>`EvalClassSpec` | type | — | — |
| <a id="evaldatector"></a>`evalDateCtor` | fn | — | `evalDateCtor(args: Abs[]): Abs` |
| <a id="evaldatemethod"></a>`evalDateMethod` | fn | — | `evalDateMethod(name: string, _recv: Abs, _args: Abs[]): Abs \| undefined` |
| <a id="evaldatestatic"></a>`evalDateStatic` | fn | — | `evalDateStatic(name: string, _args: Abs[]): Abs \| undefined` |
| <a id="evalfallback"></a>`EvalFallback` | type | — | `EvalFallback = { reason: string; message: string; loc?: { line: number; column: number }; }` |
| <a id="evalglobalfn"></a>`evalGlobalFn` | fn | — | `evalGlobalFn(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evaljsonmethod"></a>`evalJsonMethod` | fn | — | `evalJsonMethod(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalmathmethod"></a>`evalMathMethod` | fn | — | `evalMathMethod(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalnamespacecall"></a>`evalNamespaceCall` | fn | — | `evalNamespaceCall( ns: string, method: string, args: Abs[], ): Abs \| undefined` |
| <a id="evalnumberstatic"></a>`evalNumberStatic` | fn | — | `evalNumberStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalobjectmethod"></a>`evalObjectMethod` | fn | — | `evalObjectMethod(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalobjectprotomethod"></a>`evalObjectProtoMethod` | fn | — | `evalObjectProtoMethod( name: string, thisVal: Abs, args: Abs[], ): Abs \| undefined` |
| <a id="evalpromisector"></a>`evalPromiseCtor` | fn | — | `evalPromiseCtor(args: Abs[]): Abs` |
| <a id="evalpromisemethod"></a>`evalPromiseMethod` | fn | — | `evalPromiseMethod( name: string, recv: Abs, args: Abs[], ): Abs \| undefined` |
| <a id="evalpromisestatic"></a>`evalPromiseStatic` | fn | — | `evalPromiseStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalregexpctor"></a>`evalRegExpCtor` | fn | — | `evalRegExpCtor(args: Abs[]): Abs` |
| <a id="evalregexpmethod"></a>`evalRegExpMethod` | fn | — | `evalRegExpMethod(name: string, recv: Abs, args: Abs[]): Abs \| undefined` |
| <a id="evalstringstatic"></a>`evalStringStatic` | fn | — | `evalStringStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalsymbolctor"></a>`evalSymbolCtor` | fn | — | `evalSymbolCtor(args: Abs[]): Abs` |
| <a id="evictchecksourcememoforpaths"></a>`evictCheckSourceMemoForPaths` | fn | — | `evictCheckSourceMemoForPaths(paths: string[]): number` |
| <a id="evictgeneralizememoforpaths"></a>`evictGeneralizeMemoForPaths` | fn | — | `evictGeneralizeMemoForPaths(paths: string[]): number` |
| <a id="execnudomodule"></a>`execNudoModule` | fn | — | `execNudoModule(src: string, opts?: RefineResolveOpts): Record<string, unknown>` |
| <a id="extractdeclaredthrows"></a>`extractDeclaredThrows` | fn | — | `extractDeclaredThrows( source: string, fnName: string, ): string[]` |
| <a id="extractfn"></a>`extractFn` | fn | — | `extractFn( source: string, fnName: string, fileAst?: ReturnType<typeof babelParse>, )` |
| <a id="extractnudoimports"></a>`extractNudoImports` | fn | — | `extractNudoImports(source: string): NamedImport[]` |
| <a id="extractrefinereturnfromsource"></a>`extractRefineReturnFromSource` | fn | — | `extractRefineReturnFromSource( source: string, fnName: string, opts: RefineResolveOpts = {}, )` |
| <a id="extstate"></a>`ExtState` | type | — | `ExtState = "nonext" \| "sealed" \| "frozen"` |
| <a id="extstateof"></a>`extStateOf` | fn | — | `extStateOf(o: Abs): ExtState \| undefined` |
| <a id="falseconstraint"></a>`falseConstraint` | fn | — | `falseConstraint(c: Abs): Pred \| undefined` |
| <a id="fnabs"></a>`FnAbs` | type | — | `FnAbs = Abs & { shape: { k: "fn"; params: string[]; name?: string; paramTypes?: Abs[]; returnType?: Abs; }; }` |
| <a id="fnconstrainttoentryreqs"></a>`fnConstraintToEntryReqs` | fn | — | `fnConstraintToEntryReqs( c: NudoConstraint, ): Array<{ param: string; constraint: NudoConstraint }>` |
| <a id="formalparam"></a>`FormalParam` | type | — | `FormalParam = \| { kind: "id"; name: string; index: number } \| { kind: "default"; name: string; index: number } \| { kind: "rest"; name: st...` |
| <a id="formalparamdisplaynames"></a>`formalParamDisplayNames` | fn | — | `formalParamDisplayNames(formals: FormalParam[]): string[]` |
| <a id="formalparamsfromnodes"></a>`formalParamsFromNodes` | fn | — | `formalParamsFromNodes(params: AstParam[] \| undefined \| null): FormalParam[]` |
| <a id="formatabsmultiline"></a>`formatAbsMultiline` | fn | — | `formatAbsMultiline(a: Abs, label?: string): string` |
| <a id="formatdiagnostics"></a>`formatDiagnostics` | fn | — | `formatDiagnostics(diags: Diagnostic[]): string` |
| <a id="formateffectiveinterfacedisplay"></a>`formatEffectiveInterfaceDisplay` | fn | — | `formatEffectiveInterfaceDisplay(eff: EffectiveInterface): string` |
| <a id="formatgithubannotations"></a>`formatGithubAnnotations` | fn | — | `formatGithubAnnotations( r: CheckReport, opts: { workspaceRoot?: string } = {}, ): string` |
| <a id="formatgitlabcodequality"></a>`formatGitlabCodeQuality` | fn | — | `formatGitlabCodeQuality( r: CheckReport, opts: { workspaceRoot?: string } = {}, ): GitlabCodeQualityIssue[]` |
| <a id="formatinterfacetierline"></a>`formatInterfaceTierLine` | fn | — | `formatInterfaceTierLine(source: InterfaceSource): string` |
| <a id="formatoptions"></a>`FormatOptions` | type | — | `FormatOptions = { showTerm?: boolean; showPred?: boolean; indent?: string; }` |
| <a id="formatshapeslot"></a>`formatShapeSlot` | fn | — | `formatShapeSlot(a: Abs): string` |
| <a id="ge"></a>`ge` | const | — | `const ge` |
| <a id="generatedexportnames"></a>`generatedExportNames` | fn | — | `generatedExportNames(sidecarSrc: string): Set<string>` |
| <a id="genum"></a>`geNum` | fn | — | `geNum(term: Term, n: number): Pred` |
| <a id="getabsproperty"></a>`getAbsProperty` | fn | — | `getAbsProperty(recv: Abs, name: string): Abs \| undefined` |
| <a id="getevalcallcollector"></a>`getEvalCallCollector` | fn | — | `getEvalCallCollector()` |
| <a id="getevalclass"></a>`getEvalClass` | fn | — | `getEvalClass(name: string): EvalClassSpec \| undefined` |
| <a id="getfnimpl"></a>`getFnImpl` | fn | — | `getFnImpl(a: Abs): AbsFnImpl \| undefined` |
| <a id="getgeneralizememosize"></a>`getGeneralizeMemoSize` | fn | — | `getGeneralizeMemoSize(): number` |
| <a id="getimplicationoracle"></a>`getImplicationOracle` | fn | — | `getImplicationOracle(): ImplicationOracle \| undefined` |
| <a id="getpropflags"></a>`getPropFlags` | fn | — | `getPropFlags(o: Abs): Map<string, PropFlags> \| undefined` |
| <a id="getslot"></a>`getSlot` | fn | — | `getSlot<S extends { value: Abs }>( slots: Record<string, S>, key: string, ): S \| undefined` |
| <a id="getterm"></a>`getTerm` | fn | — | `getTerm(obj: Term, key: string): Term` |
| <a id="gitlabcodequalityissue"></a>`GitlabCodeQualityIssue` | type | — | `GitlabCodeQualityIssue = { description: string; check_name: string; fingerprint: string; severity: "major" \| "minor" \| "info" \| "blocker"...` |
| <a id="gt"></a>`gt` | const | — | `const gt` |
| <a id="gtnum"></a>`gtNum` | fn | — | `gtNum(term: Term, n: number): Pred` |
| <a id="hofcollectctx"></a>`HofCollectCtx` | type | — | — |
| <a id="hofsite"></a>`HofSite` | type | — | — |
| <a id="hostbuiltinctorname"></a>`hostBuiltinCtorName` | fn | — | `hostBuiltinCtorName(v: unknown): string \| undefined` |
| <a id="implicationoracle"></a>`ImplicationOracle` | type | — | `ImplicationOracle = (phi: Phi, pred: Pred) => boolean \| undefined` |
| <a id="implies"></a>`implies` | fn | — | `implies(phi: Phi, pred: Pred): boolean` |
| <a id="instantiatereturn"></a>`instantiateReturn` | fn | — | `instantiateReturn(fn: Abs, args: Abs[]): Abs` |
| <a id="interfacediag"></a>`InterfaceDiag` | type | — | `InterfaceDiag = { code: string; message: string; file?: string }` |
| <a id="interfacediagcount"></a>`interfaceDiagCount` | fn | — | `interfaceDiagCount(): number` |
| <a id="interfacesource"></a>`InterfaceSource` | type | — | `InterfaceSource = "handwritten" \| "generated" \| "implicit"` |
| <a id="interfacesourceof"></a>`interfaceSourceOf` | fn | — | `interfaceSourceOf( source: string, fnName: string, fromFile: string, opts: InterfaceTierOpts = {}, ): InterfaceSource \| undefined` |
| <a id="interfacetieropts"></a>`InterfaceTierOpts` | type | — | `InterfaceTierOpts = EffectiveInterfaceOpts` |
| <a id="isbigprim"></a>`isBigPrim` | fn | — | `isBigPrim(a: Abs): boolean` |
| <a id="isdefinitelyfalse"></a>`isDefinitelyFalse` | fn | — | `isDefinitelyFalse(a: Abs): boolean` |
| <a id="isdefinitelytrue"></a>`isDefinitelyTrue` | fn | — | `isDefinitelyTrue(a: Abs): boolean` |
| <a id="iserrorctorname"></a>`isErrorCtorName` | fn | — | `isErrorCtorName(name: string \| undefined): boolean` |
| <a id="isintflag"></a>`isIntFlag` | fn | — | `isIntFlag(c: NudoConstraint): boolean` |
| <a id="ismapabs"></a>`isMapAbs` | fn | — | `isMapAbs(a: Abs \| undefined): boolean` |
| <a id="isnodemodulespath"></a>`isNodeModulesPath` | const | — | — |
| <a id="isnudobreak"></a>`isNudoBreak` | fn | — | `isNudoBreak(e: unknown, label?: string): boolean` |
| <a id="isnudoconstraint"></a>`isNudoConstraint` | fn | — | `isNudoConstraint(x: unknown): x` |
| <a id="isnudocontinue"></a>`isNudoContinue` | fn | — | `isNudoContinue(e: unknown, label?: string): boolean` |
| <a id="isnudoreturn"></a>`isNudoReturn` | fn | — | `isNudoReturn(e: unknown): e` |
| <a id="isnudothrow"></a>`isNudoThrow` | const | — | — |
| <a id="isnullishlitabs"></a>`isNullishLitAbs` | fn | — | `isNullishLitAbs(a: Abs): boolean` |
| <a id="isnullprotoobj"></a>`isNullProtoObj` | fn | — | `isNullProtoObj(o: Abs): boolean` |
| <a id="isnumprim"></a>`isNumPrim` | fn | — | `isNumPrim(a: Abs): boolean` |
| <a id="isobj"></a>`isObj` | fn | — | `isObj(a: Abs): a` |
| <a id="isobjectprotobrand"></a>`isObjectProtoBrand` | fn | — | `isObjectProtoBrand(a: Abs \| undefined): boolean` |
| <a id="isrelfn"></a>`isRelFn` | fn | — | `isRelFn(a: Abs \| undefined \| null): boolean` |
| <a id="issetabs"></a>`isSetAbs` | fn | — | `isSetAbs(a: Abs \| undefined): boolean` |
| <a id="isstrprim"></a>`isStrPrim` | fn | — | `isStrPrim(a: Abs): boolean` |
| <a id="issymbolabs"></a>`isSymbolAbs` | const | — | `const isSymbolAbs` |
| <a id="joinfunctions"></a>`joinFunctions` | fn | — | `joinFunctions(a: Abs, b: Abs): Abs` |
| <a id="joinobjects"></a>`joinObjects` | fn | — | `joinObjects(a: Abs, b: Abs): Abs` |
| <a id="jointhenproject"></a>`joinThenProject` | fn | — | `joinThenProject(absList: Abs[]): NudoConstraint \| undefined` |
| <a id="le"></a>`le` | const | — | `const le` |
| <a id="leavepromiseexecutorscope"></a>`leavePromiseExecutorScope` | fn | — | `leavePromiseExecutorScope(): number` |
| <a id="lenterm"></a>`lenTerm` | fn | — | `lenTerm(t: Term): Term` |
| <a id="lenum"></a>`leNum` | fn | — | `leNum(term: Term, n: number): Pred` |
| <a id="leqresult"></a>`LeqResult` | type | — | `LeqResult = { ok: boolean; reason?: string; }` |
| <a id="listfunctionnames"></a>`listFunctionNames` | fn | — | `listFunctionNames(source: string): string[]` |
| <a id="literalmeetsconstraint"></a>`literalMeetsConstraint` | fn | — | `literalMeetsConstraint( lv: number \| string \| boolean \| null, c: NudoConstraint, ): boolean` |
| <a id="literalvalue"></a>`LiteralValue` | type | — | `LiteralValue = string \| number \| boolean \| null \| undefined` |
| <a id="littruth"></a>`litTruth` | fn | — | `litTruth(a: Abs): boolean \| undefined` |
| <a id="localnamedexports"></a>`localNamedExports` | fn | — | `localNamedExports(source: string): Set<string>` |
| <a id="locatecontractparam"></a>`locateContractParam` | fn | — | `locateContractParam( formals: FormalParam[], contractName: string, )` |
| <a id="lookupobjaccessor"></a>`lookupObjAccessor` | fn | — | `lookupObjAccessor( o: Abs, key: string, )` |
| <a id="looseeqabs"></a>`looseEqAbs` | fn | — | `looseEqAbs(a: Abs, b: Abs): boolean \| undefined` |
| <a id="lt"></a>`lt` | const | — | `const lt` |
| <a id="ltnum"></a>`ltNum` | fn | — | `ltNum(term: Term, n: number): Pred` |
| <a id="makearrayctorabs"></a>`makeArrayCtorAbs` | fn | — | `makeArrayCtorAbs(args: Abs[]): Abs` |
| <a id="makemapabs"></a>`makeMapAbs` | fn | — | `makeMapAbs(iterable?: Abs): Abs` |
| <a id="makesetabs"></a>`makeSetAbs` | fn | — | `makeSetAbs(iterable?: Abs): Abs` |
| <a id="makesymbolabs"></a>`makeSymbolAbs` | fn | — | `makeSymbolAbs(descArg?: Abs): Abs` |
| <a id="mapclearentries"></a>`mapClearEntries` | fn | — | `mapClearEntries(mapAbs: Abs): Abs` |
| <a id="mapdeleteentry"></a>`mapDeleteEntry` | fn | — | `mapDeleteEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| <a id="mapelementfallback"></a>`mapElementFallback` | fn | — | `mapElementFallback( cbAbs: Abs \| undefined, elem: Abs, out: Abs, ): Abs` |
| <a id="mapentriesabs"></a>`mapEntriesAbs` | fn | — | `mapEntriesAbs(mapAbs: Abs): Abs[]` |
| <a id="mapgetentry"></a>`mapGetEntry` | fn | — | `mapGetEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| <a id="maphasentry"></a>`mapHasEntry` | fn | — | `mapHasEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| <a id="mapsetentry"></a>`mapSetEntry` | fn | — | `mapSetEntry(mapAbs: Abs, key: Abs \| undefined, value: Abs): Abs` |
| <a id="mapsizeabs"></a>`mapSizeAbs` | fn | — | `mapSizeAbs(mapAbs: Abs): Abs` |
| <a id="mapvaluesabs"></a>`mapValuesAbs` | fn | — | `mapValuesAbs(mapAbs: Abs): Abs[]` |
| <a id="markextstate"></a>`markExtState` | fn | — | `markExtState(o: Abs, s: ExtState): Abs` |
| <a id="marknullprotoobj"></a>`markNullProtoObj` | fn | — | `markNullProtoObj(o: Abs): Abs` |
| <a id="markpurefn"></a>`markPureFn` | fn | — | `markPureFn(target: object, name: string): void` |
| <a id="matchrelidentlit"></a>`matchRelIdentLit` | fn | — | `matchRelIdentLit( test: unknown, )` |
| <a id="max_eval_call_depth"></a>`MAX_EVAL_CALL_DEPTH` | const | — | `const MAX_EVAL_CALL_DEPTH` |
| <a id="max_eval_total_calls"></a>`MAX_EVAL_TOTAL_CALLS` | const | — | `const MAX_EVAL_TOTAL_CALLS` |
| <a id="mergecollectionarms"></a>`mergeCollectionArms` | fn | — | `mergeCollectionArms(arms: Array<ArmOverlay \| undefined \| null>): void` |
| <a id="migrateinvariants"></a>`migrateInvariants` | fn | — | `migrateInvariants(from: Abs, to: Abs): void` |
| <a id="migratenullproto"></a>`migrateNullProto` | fn | — | `migrateNullProto(from: Abs, to: Abs): Abs` |
| <a id="mod"></a>`mod` | fn | — | `mod(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="mul"></a>`mul` | fn | — | `mul(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="namedimport"></a>`NamedImport` | type | `/// @nudo:import { delay, percent } from "./delay.nudo.js"` | `NamedImport = { names: string[]; spec: string }` |
| <a id="namespacenameof"></a>`namespaceNameOf` | fn | — | `namespaceNameOf(v: unknown): string \| undefined` |
| <a id="ne"></a>`ne` | const | — | `const ne` |
| <a id="negabs"></a>`negAbs` | fn | — | `negAbs(a: Abs, _phi: Phi = pTrue): Abs` |
| <a id="negatepred"></a>`negatePred` | fn | — | `negatePred(p: Pred): Pred` |
| <a id="not"></a>`not` | fn | — | `not(p: Pred): Pred` |
| <a id="notabs"></a>`notAbs` | fn | — | `notAbs(a: Abs): Abs` |
| <a id="notecollectionwrite"></a>`noteCollectionWrite` | fn | — | `noteCollectionWrite(id: object): void` |
| <a id="noteevalcallrecord"></a>`noteEvalCallRecord` | fn | — | `noteEvalCallRecord(r: EvalCallRecord): void` |
| <a id="noteevalfallback"></a>`noteEvalFallback` | fn | — | `noteEvalFallback(e: unknown): void` |
| <a id="notepromiseexecutorfork"></a>`notePromiseExecutorFork` | fn | — | `notePromiseExecutorFork(): void` |
| <a id="nudofield"></a>`NudoField` | type | — | `NudoField = { constraint: NudoConstraint; optional?: boolean; }` |
| <a id="nudofnconstraint"></a>`NudoFnConstraint` | type | fn(params, returns?, &#123; throws? | `NudoFnConstraint = { params: Record<string, NudoConstraint>; returns?: NudoConstraint; throws?: NudoConstraint; }` |
| <a id="nudosidecarerror"></a>`NudoSidecarError` | fn | — | `NudoSidecarError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = "NudoSid...` |
| <a id="nudosig"></a>`NudoSig` | type | — | `NudoSig = { name: string; params: string[]; paramTypes?: string[]; abs: Abs; display: string; detail: string; conf: Confidence; throws?: ...` |
| <a id="nudounsupportederror"></a>`NudoUnsupportedError` | fn | — | `NudoUnsupportedError extends Error { readonly reason: string; readonly loc?: { line: number; column: number }; constructor(reason: string...` |
| <a id="numvar"></a>`numVar` | fn | — | `numVar(id: string, pred?: Pred, conf: Confidence = "path"): Abs` |
| <a id="object_proto_method_names"></a>`OBJECT_PROTO_METHOD_NAMES` | const | — | `const OBJECT_PROTO_METHOD_NAMES` |
| <a id="objectprotobrand"></a>`objectProtoBrand` | fn | — | `objectProtoBrand(): Abs` |
| <a id="objectprotomethodabs"></a>`objectProtoMethodAbs` | fn | — | `objectProtoMethodAbs(name: string): Abs` |
| <a id="objof"></a>`objOf` | fn | — | `objOf( slots: Record<string, Slot>, opts?: { index?: { key: Abs; value: Abs }; open?: boolean }, ): Abs` |
| <a id="omit"></a>`omit` | fn | — | `omit( c: NudoConstraint \| ConstraintBuilder, keys: string[], ): ConstraintBuilder` |
| <a id="or"></a>`or` | fn | — | `or(...preds: Pred[]): Pred` |
| <a id="partial"></a>`partial` | fn | — | `partial(c: NudoConstraint \| ConstraintBuilder): ConstraintBuilder` |
| <a id="pfalse"></a>`pFalse` | const | — | `const pFalse` |
| <a id="phiand"></a>`phiAnd` | const | — | `const phiAnd` |
| <a id="pick"></a>`pick` | fn | — | `pick( c: NudoConstraint \| ConstraintBuilder, keys: string[], ): ConstraintBuilder` |
| <a id="polyfn"></a>`PolyFn` | type | — | `PolyFn = { name: string; params: string[]; typeParams: TypeParam[]; instantiate: (args: Abs[], phi?: Phi) => Abs; symbolic: Abs; display:...` |
| <a id="popcollectionarm"></a>`popCollectionArm` | fn | — | `popCollectionArm(): ArmOverlay \| undefined` |
| <a id="popphi"></a>`popPhi` | fn | — | `popPhi(): void` |
| <a id="powabs"></a>`powAbs` | fn | — | `powAbs(a: Abs, b: Abs): Abs` |
| <a id="predequals"></a>`predEquals` | fn | — | `predEquals(a: Pred, b: Pred): boolean` |
| <a id="predtostring"></a>`predToString` | fn | — | `predToString(p: Pred): string` |
| <a id="predvars"></a>`predVars` | fn | — | `predVars(p: Pred): Set<string>` |
| <a id="primname"></a>`PrimName` | type | — | `PrimName = "number" \| "string" \| "boolean" \| "bigint" \| "symbol"` |
| <a id="primtotypeof"></a>`primToTypeof` | fn | — | `primToTypeof(p: PrimName): TypeofName` |
| <a id="projectflatmapresult"></a>`projectFlatMapResult` | fn | — | `projectFlatMapResult( arrConf: Confidence, mapped: Abs[], ): Abs` |
| <a id="promoteparamshape"></a>`promoteParamShape` | fn | — | `promoteParamShape( env: AstEnv, param: string, promotedShape: Shape, opts?: { loc?: { line: number; column: number }; recordSite?: boolean }, ): boolean` |
| <a id="propertykeyof"></a>`propertyKeyOf` | fn | — | `propertyKeyOf(a: Abs \| undefined): string \| undefined` |
| <a id="propflags"></a>`PropFlags` | type | — | `PropFlags = { writable?: boolean; enumerable?: boolean; configurable?: boolean; }` |
| <a id="protobrandabs"></a>`protoBrandAbs` | fn | — | `protoBrandAbs(ctorName: string): Abs` |
| <a id="protoofrecv"></a>`protoOfRecv` | fn | — | `protoOfRecv(a: Abs): Abs` |
| <a id="ptrue"></a>`pTrue` | const | — | `const pTrue` |
| <a id="ptypeof"></a>`ptypeof` | const | — | `const ptypeof` |
| <a id="purefnnameof"></a>`pureFnNameOf` | fn | — | `pureFnNameOf(fn: unknown): string \| undefined` |
| <a id="pushcollectionarm"></a>`pushCollectionArm` | fn | — | `pushCollectionArm(): void` |
| <a id="pushloopexit"></a>`pushLoopExit` | fn | — | `pushLoopExit(v: Abs): void` |
| <a id="pushphi"></a>`pushPhi` | fn | — | `pushPhi(p: Phi): void` |
| <a id="pushthrowexit"></a>`pushThrowExit` | fn | — | `pushThrowExit(v: Abs): void` |
| <a id="queuepromisemicro"></a>`queuePromiseMicro` | fn | — | `queuePromiseMicro(task: () => void): void` |
| <a id="refinediag"></a>`RefineDiag` | type | — | `RefineDiag = { code: string; message: string; file?: string }` |
| <a id="refinediagcount"></a>`refineDiagCount` | fn | — | `refineDiagCount(): number` |
| <a id="refineentry"></a>`RefineEntry` | type | — | `RefineEntry = { param: string; pred: Pred; constraint: NudoConstraint; }` |
| <a id="refineresolveopts"></a>`RefineResolveOpts` | type | — | `RefineResolveOpts = { loadModule?: (spec: string, fromFile: string) => string \| undefined; fromFile?: string; }` |
| <a id="refinetoindexedfull"></a>`refineToIndexedFull` | fn | — | `refineToIndexedFull( source: string, fnName: string, paramNames: string[], opts: RefineResolveOpts = {}, ): Array<[number, RefineEntry]>` |
| <a id="regexbrandabsfrom"></a>`regexBrandAbsFrom` | fn | — | `regexBrandAbsFrom(pattern: string, flags: string): Abs` |
| <a id="registerevalclass"></a>`registerEvalClass` | fn | — | `registerEvalClass(spec: EvalClassSpec): void` |
| <a id="relationfingerprint"></a>`relationFingerprint` | fn | — | `relationFingerprint( paramTypes: Abs[], returnType: Abs, ): string` |
| <a id="relationfn"></a>`relationFn` | fn | — | `relationFn( paramTypes: Abs[], returnType: Abs, opts?: { params?: string[]; conf?: Confidence; fingerprint?: string; inferFrom?: { fromVar: string; via: "arr" \| "promise"; inferVar: string }; condFallback?: Abs; }, ): Abs` |
| <a id="relsource"></a>`RelSource` | type | — | — |
| <a id="requiredfnarity"></a>`requiredFnArity` | fn | Required arity from fn param labels — skips rest (`...`) and optional (`?`). | `requiredFnArity(params: readonly string[] \| undefined): number` |
| <a id="resetchecksourcememo"></a>`resetCheckSourceMemo` | fn | — | `resetCheckSourceMemo(): void` |
| <a id="resetevalcallbudget"></a>`resetEvalCallBudget` | fn | — | `resetEvalCallBudget(): void` |
| <a id="resetgeneralizememo"></a>`resetGeneralizeMemo` | fn | — | `resetGeneralizeMemo(): void` |
| <a id="resetnudomoduleexeccache"></a>`resetNudoModuleExecCache` | fn | — | `resetNudoModuleExecCache(): void` |
| <a id="resetphi"></a>`resetPhi` | fn | — | `resetPhi(): void` |
| <a id="runtime_import_re"></a>`RUNTIME_IMPORT_RE` | const | — | `const RUNTIME_IMPORT_RE` |
| <a id="runtranspiledoptions"></a>`RunTranspiledOptions` | type | — | `RunTranspiledOptions = { modules?: Record<string, AbsModuleExports \| Record<string, unknown>>; maxLoopIters?: number; mode?: "exec" \| "an...` |
| <a id="runtranspiledoptionsmemokey"></a>`runTranspiledOptionsMemoKey` | fn | — | `runTranspiledOptionsMemoKey( opts: RunTranspiledOptions \| undefined, ): string` |
| <a id="runwithloopexits"></a>`runWithLoopExits` | fn | — | `runWithLoopExits<T>(body: () => T): T` |
| <a id="self"></a>`SELF` | const | — | `const SELF` |
| <a id="setaddentry"></a>`setAddEntry` | fn | — | `setAddEntry(setAbs: Abs, value: Abs): Abs` |
| <a id="setapplycallbackhost"></a>`setApplyCallbackHost` | fn | — | `setApplyCallbackHost(fn: ApplyCallbackHost): void` |
| <a id="setclearentries"></a>`setClearEntries` | fn | Set#clear | `setClearEntries(setAbs: Abs): Abs` |
| <a id="setdeleteentry"></a>`setDeleteEntry` | fn | — | `setDeleteEntry(setAbs: Abs, value: Abs): Abs` |
| <a id="setelementsabs"></a>`setElementsAbs` | fn | — | `setElementsAbs(setAbs: Abs): Abs[]` |
| <a id="setevalassigncollector"></a>`setEvalAssignCollector` | fn | — | `setEvalAssignCollector( collector: ((r: EvalAbsAssignRecord) => void) \| null, )` |
| <a id="setevalbindingsink"></a>`setEvalBindingSink` | fn | — | `setEvalBindingSink(sink: Map<string, unknown> \| null): void` |
| <a id="setevalfallbackcollector"></a>`setEvalFallbackCollector` | fn | — | `setEvalFallbackCollector( collector: ((f: EvalFallback) => void) \| null, ): void` |
| <a id="sethasentry"></a>`setHasEntry` | fn | — | `setHasEntry(setAbs: Abs, value: Abs): Abs` |
| <a id="setimplicationoracle"></a>`setImplicationOracle` | fn | — | `setImplicationOracle(fn: ImplicationOracle \| undefined): void` |
| <a id="setinterfacediagcollector"></a>`setInterfaceDiagCollector` | fn | — | `setInterfaceDiagCollector( fn: ((d: InterfaceDiag) => void) \| null, ): void` |
| <a id="setpropflags"></a>`setPropFlags` | fn | — | `setPropFlags(o: Abs, key: string, f: PropFlags): void` |
| <a id="setrefinediagcollector"></a>`setRefineDiagCollector` | fn | — | `setRefineDiagCollector(fn: ((d: RefineDiag) => void) \| null): void` |
| <a id="setsizeabs"></a>`setSizeAbs` | fn | — | `setSizeAbs(setAbs: Abs): Abs` |
| <a id="shapeofterm"></a>`shapeOfTerm` | fn | — | `shapeOfTerm(t: Term): Shape` |
| <a id="shapeonlyfn"></a>`shapeOnlyFn` | fn | — | `shapeOnlyFn( paramTypes: Abs[], returnType: Abs, opts?: { params?: string[]; conf?: Confidence }, ): Abs` |
| <a id="shapetostring"></a>`shapeToString` | fn | — | `shapeToString(s: Shape): string` |
| <a id="shlabs"></a>`shlAbs` | fn | — | `shlAbs(a: Abs, b: Abs): Abs` |
| <a id="shrabs"></a>`shrAbs` | fn | — | `shrAbs(a: Abs, b: Abs): Abs` |
| <a id="sidecarclosurefingerprint"></a>`sidecarClosureFingerprint` | fn | — | `sidecarClosureFingerprint( fromFile: string, opts: EffectiveInterfaceOpts, ): string \| undefined` |
| <a id="sidecarpathof"></a>`sidecarPathOf` | const | — | — |
| <a id="simplifyterm"></a>`simplifyTerm` | fn | — | `simplifyTerm(t: Term): Term` |
| <a id="snapshotabs"></a>`snapshotAbs` | fn | — | `snapshotAbs(a: Abs): Abs` |
| <a id="spread"></a>`spread` | fn | — | `spread(base: Abs, over: Abs): Abs` |
| <a id="stricteqabs"></a>`strictEqAbs` | fn | — | `strictEqAbs(a: Abs, b: Abs): boolean \| undefined` |
| <a id="stringofsymbol"></a>`stringOfSymbol` | fn | — | `stringOfSymbol(a: Abs): Abs` |
| <a id="sub"></a>`sub` | fn | — | `sub(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="substabs"></a>`substAbs` | fn | — | `substAbs(a: Abs, map: ReadonlyMap<string, Abs>): Abs` |
| <a id="substpred"></a>`substPred` | fn | — | `substPred(p: Pred, subst: (t: Term) => Term): Pred` |
| <a id="substpredabs"></a>`substPredAbs` | fn | — | `substPredAbs( p: Pred, map: ReadonlyMap<string, Abs>, )` |
| <a id="symboldescriptionabs"></a>`symbolDescriptionAbs` | const | — | — |
| <a id="symbolidof"></a>`symbolIdOf` | const | — | — |
| <a id="takeinterfacediags"></a>`takeInterfaceDiags` | fn | — | `takeInterfaceDiags(): InterfaceDiag[]` |
| <a id="takeinterfacediagssince"></a>`takeInterfaceDiagsSince` | fn | — | `takeInterfaceDiagsSince(since: number): InterfaceDiag[]` |
| <a id="takeloopexits"></a>`takeLoopExits` | fn | — | `takeLoopExits(): Abs[]` |
| <a id="takerefinediags"></a>`takeRefineDiags` | fn | — | `takeRefineDiags(): RefineDiag[]` |
| <a id="takerefinediagssince"></a>`takeRefineDiagsSince` | fn | — | `takeRefineDiagsSince(since: number): RefineDiag[]` |
| <a id="takethrowexits"></a>`takeThrowExits` | fn | — | `takeThrowExits(): Abs[]` |
| <a id="termequals"></a>`termEquals` | fn | — | `termEquals(a: Term, b: Term): boolean` |
| <a id="termtostring"></a>`termToString` | fn | — | `termToString(t: Term): string` |
| <a id="throwconstrainttokinds"></a>`throwConstraintToKinds` | fn | — | `throwConstraintToKinds( c: NudoConstraint \| undefined, ): string[]` |
| <a id="tonumberabs"></a>`toNumberAbs` | fn | — | `toNumberAbs(a: Abs): Abs` |
| <a id="trueconstraint"></a>`trueConstraint` | fn | — | `trueConstraint(c: Abs): Pred \| undefined` |
| <a id="trymakeregexabs"></a>`tryMakeRegexAbs` | fn | — | `tryMakeRegexAbs(args: Abs[]): Abs \| undefined` |
| <a id="trypromotedirectcall"></a>`tryPromoteDirectCall` | fn | — | `tryPromoteDirectCall( env: AstEnv, calleeName: string, args: Abs[], loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="trypromoteforofiteratee"></a>`tryPromoteForOfIteratee` | fn | — | `tryPromoteForOfIteratee( env: AstEnv, iterateeName: string, loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="trypromotehofcallback"></a>`tryPromoteHofCallback` | fn | — | `tryPromoteHofCallback( env: AstEnv, cevalName: string, method: string, argAbses: Abs[], loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="trypromotereceiverasarr"></a>`tryPromoteReceiverAsArr` | fn | — | `tryPromoteReceiverAsArr( env: AstEnv, receiverName: string, method: string, loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="tryruntranspiled"></a>`tryRunTranspiled` | fn | — | `tryRunTranspiled( source: string, opts: RunTranspiledOptions = {}, ): Record<string, unknown> \| undefined` |
| <a id="typeof_names"></a>`TYPEOF_NAMES` | const | — | `const TYPEOF_NAMES` |
| <a id="typeofabs"></a>`typeofAbs` | fn | — | `typeofAbs(a: Abs): Abs` |
| <a id="typeofname"></a>`TypeofName` | type | — | `TypeofName = \| "undefined" \| "object" \| "boolean" \| "number" \| "bigint" \| "string" \| "symbol" \| "function"` |
| <a id="typeparam"></a>`TypeParam` | type | — | `TypeParam = { id: string; value: Abs; }` |
| <a id="undefabs"></a>`undefAbs` | fn | — | `undefAbs(): Abs` |
| <a id="ushrabs"></a>`ushrAbs` | fn | — | `ushrAbs(a: Abs, b: Abs): Abs` |
| <a id="withexecphi"></a>`withExecPhi` | fn | — | `withExecPhi<T>(p: Phi, body: () => T): T` |
| <a id="withphiconstraint"></a>`withPhiConstraint` | fn | — | `withPhiConstraint(extra: Phi, body: () => void): void` |
| <a id="withvar"></a>`withVar` | fn | — | `withVar(env: AstEnv, name: string, value: Abs): AstEnv` |

</details>
<!-- NUDO-API-SKELETON:END -->
