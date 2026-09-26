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
| `runTranspiled` / `callTranspiledExportFull` / `analyzeFn(…)` | Abs-native evaluation entrypoints (B-path). |
| `generalizeFromAst(…)` | Intensional signature extraction — the `intension:` lines and `A1` parameters. |

---

## Operator Semantics (Abs-native)

Operators are algebraic on Abs. Arithmetic, comparison, unary, and spread live in:

| Where | What |
|-------|------|
| `core/src/algebra/surface.ts` | `typeofAbs`, `negAbs`, `notAbs`, `strictEqAbs` (unary ops + strict equality) |
| `core/src/algebra/arithmetic.ts` | Binary arithmetic (`+` `-` `*` `/` `%`) and comparison |
| `service/src/evaluator/abs-route.ts` | Union member-wise routing of binary/unary ops and object spread |

The single evaluation engine is B-path (`core/algebra/exec`: transpile → `new Function` with Abs values). B-incapable sources fail closed to `unknown` / empty exports.

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
> Generated by `pnpm run docs:gen:api` from package export surfaces (`PUBLIC_API.md` / `src/index.ts`) — do not edit this block. Regenerate with `node scripts/gen-api-docs.mjs`.

Product-face inventory from `packages/core/PUBLIC_API.md` §2 (plus non-`$op` names re-exported from `src/index.ts`). Engine `$op` runtime is the `./exec` family in §2.2; host machinery lives on `@nudojs/core/internal` and is intentionally out of scope.

| Name | Kind | Summary | Signature |
|------|------|------|------|
| `$add` | fn | operator runtime | `$add(a: Abs, b: Abs): Abs` |
| `$arguments` | fn | array runtime | `$arguments(items: ArrayLike<unknown>): Abs` |
| `$arr` | fn | array runtime | `$arr(items: Abs[]): Abs` |
| `$arrMutContainer` | fn | array runtime | `$arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs` |
| `$arrRest` | fn | object / member runtime | `$arrRest(a: Abs, start: number): Abs` |
| `$arrWithHoles` | fn | array runtime | `$arrWithHoles(items: Abs[], holes: number[]): Abs` |
| `$assignRecord` | fn | call-site recording for analyze | `$assignRecord( name: string, prev: Abs \| undefined, next: Abs, line: number, column: number, conditional: boolean, ): void` |
| `$async` | fn | async / generator | `$async(thunk: () => Abs): Abs` |
| `$asyncReturn` | fn | async / generator | `$asyncReturn(v: Abs): Abs` |
| `$await` | fn | async / generator | `$await(v: Abs): Abs` |
| `$callNamed` | fn | call-site recording for analyze | `$callNamed( name: string, fn: unknown, args: Abs[], loc?: [number, number], argLocs?: Array<[number, number] \| null \| undefined>, ): Abs` |
| `$catchVal` | fn | control-signal / throw | `$catchVal(e: unknown): Abs` |
| `$classExpr` | fn | value / class runtime | `$classExpr(): Abs` |
| `$concat` | fn | object / member runtime | `$concat(a: Abs, b: Abs): Abs` |
| `$copy` | fn | array runtime | `$copy(a: Abs): Abs` |
| `$del` | fn | object / member runtime | `$del(o: Abs, key: Abs): Abs` |
| `$elems` | fn | object / member runtime | `$elems(a: Abs): Abs[]` |
| `$eq` | fn | operator runtime | `$eq(a: Abs, b: Abs): Abs` |
| `$fnVal` | fn | value / class runtime | `$fnVal( params: string[], impl: (...args: Abs[]) => Abs, opts?: { bindThis?: boolean }, ): Abs` |
| `$for` | fn | control-flow lowering | `$for( init: Abs, test: (s: Abs) => Abs, step: (s: Abs) => Abs, body: (s: Abs) => Abs, maxIters: number = DEFAULT_MAX_LOOP_ITERS, opts?: { pack?: () => Abs; unpack?: (s: Abs) => void; label?: string; }, ): Abs` |
| `$forIter` | const | control-flow lowering | — |
| `$fork` | fn | control-flow lowering | `$fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs` |
| `$ge` | fn | operator runtime | `$ge(a: Abs, b: Abs): Abs` |
| `$gen` | fn | async / generator | `$gen(body: () => void): Abs` |
| `$get` | fn | object / member runtime | `$get( o: Abs, key: string, opts?: { silent?: boolean }, ): Abs` |
| `$idx` | fn | array runtime | `$idx(a: Abs, i: Abs): Abs` |
| `$idxSet` | fn | array runtime | `$idxSet(a: Abs, i: Abs, value: Abs): Abs` |
| `$in` | fn | value / class runtime | `$in(key: Abs, o: Abs): Abs` |
| `$instanceof` | fn | value / class runtime | `$instanceof(left: Abs, rightName: string, rightVal?: Abs): Abs` |
| `$join` | fn | operator runtime | `$join(a: Abs, b: Abs): Abs` |
| `$len` | fn | array runtime | `$len(a: Abs): Abs` |
| `$lit` | fn | value / class runtime | `$lit(v: unknown): Abs` |
| `$loopBreak` | fn | control-signal / throw | `$loopBreak(label?: string): never` |
| `$loopContinue` | fn | control-signal / throw | `$loopContinue(label?: string): never` |
| `$loopReturn` | fn | control-signal / throw | `$loopReturn(v: Abs): never` |
| `$neg` | fn | operator runtime | `$neg(a: Abs): Abs` |
| `$not` | fn | operator runtime | `$not(a: Abs): Abs` |
| `$nullishTest` | fn | control-flow lowering | `$nullishTest(v: Abs): Abs` |
| `$obj` | fn | object / member runtime | `$obj(slots: Record<string, Abs>): Abs` |
| `$objRest` | fn | object / member runtime | `$objRest(o: Abs, keys: string[]): Abs` |
| `$pow` | fn | operator runtime | `$pow(a: Abs, b: Abs): Abs` |
| `$rawThis` | fn | value / class runtime | `$rawThis(v: unknown): Abs` |
| `$recordBinding` | fn | call-site recording for analyze | `$recordBinding(name: string, value: unknown): void` |
| `$set` | fn | object / member runtime | `$set(o: Abs, key: string, value: Abs): Abs` |
| `$spread` | fn | object / member runtime | `$spread(a: Abs, b: Abs): Abs` |
| `$switch` | fn | control-flow lowering | `$switch( disc: Abs, cases: Array<{ test: Abs; run: () => Abs }>, dflt?: () => Abs, ): Abs` |
| `$throw` | fn | control-signal / throw | `$throw(v: Abs): never` |
| `$typeof` | fn | operator runtime | `$typeof(a: Abs): Abs` |
| `$while` | fn | control-flow lowering | `$while( init: Abs, test: (s: Abs) => Abs, step: (s: Abs) => Abs, maxIters: number = DEFAULT_MAX_LOOP_ITERS, ): Abs` |
| `$whileSeq` | fn | control-flow lowering | `$whileSeq( test: () => Abs, body: () => void, maxIters: number = DEFAULT_MAX_LOOP_ITERS, opts?: { pack?: () => Abs; unpack?: (s: Abs) => void; label?: string; }, ): void` |
| `$yield` | fn | async / generator | `$yield(v: Abs): Abs` |
| `abs` | fn | Abs constructors / faces | `abs( shape: Shape, term: Term \| undefined, pred: Pred \| undefined, conf: Confidence, ): Abs` |
| `Abs` | type | Abs = shape × term × pred × conf | `Abs = { shape: Shape; term?: Term; pred?: Pred; conf: Confidence; pathNote?: string; }` |
| `AbsAssignRecord` | type | Abs 域赋值记录（B 通道 $assignRecord 的同形投影） | `AbsAssignRecord = { name: string; prev?: Abs; next: Abs; line?: number; column?: number; conditional?: boolean; }` |
| `AbsCallRecord` | type | Abs 域调用记录（B 通道 BCallRecord 的同形投影） | `AbsCallRecord = { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean; }` |
| `AbsFnImpl` | type | — | `AbsFnImpl = { params: string[]; body?: Node; async?: boolean; env?: AstEnv; kind?: string; apply?: (args: Abs[], thisVal?: Abs) => Abs; b...` |
| `absFunction` | fn | 造一个带实现的 Abs 函数值 | `absFunction( params: string[], impl: Omit<AbsFnImpl, "params">, ): Abs` |
| `AbsModuleExports` | type | — | `AbsModuleExports = { named: Record<string, Abs>; default?: Abs; }` |
| `absShapeKey` | fn | — | `absShapeKey(a: Abs, seen: Set<object> = new Set()): string` |
| `AbsSigImpl` | type | Abs 原生 env/builtin 实现（B-path 优先） | `AbsSigImpl = (args: Abs[], thisVal?: Abs) => Abs \| undefined` |
| `absToConstraint` | fn | Abs → 契约；不可表达 → undefined | `absToConstraint(a: Abs): NudoConstraint \| undefined` |
| `absToSchemaSource` | const | one-way projections | — |
| `absToString` | fn | — | `absToString(a: Abs): string` |
| `absToTSType` | const | one-way projections | — |
| `actionsForIssue` | fn | 诊断码 → 结构化动作（AI1）；未知码给 info 提示 | `actionsForIssue(i: { code: string; expected?: string; suggestion?: string; fn?: string; }): CheckAction[]` |
| `add` | fn | 抽象加法：eval(a + b) —— 跟真实 JS，不无根据地假定 number。 | `add(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| `alphaOf` | fn | 仅当 term 是 var 且 id ∈ alphaIds（本次 typeParams）时复用；否则 fresh α。 | `alphaOf( absOrTerm: Abs \| Term \| undefined, ctx: HofCollectCtx, ): Term` |
| `and` | fn | `@nudo:contract` builder grammar | `and(...preds: Pred[]): Pred` |
| `andC` | fn | `@nudo:contract` builder grammar | `andC( ...cs: (NudoConstraint \| ConstraintBuilder)[] ): ConstraintBuilder` |
| `any` | fn | Abs constructors / faces | `any(): ConstraintBuilder` |
| `anyAbs` | const | Abs constructors / faces | `const anyAbs` |
| `anyVar` | fn | Abs constructors / faces | `anyVar(id: string, conf: Confidence = "path"): Abs` |
| `app` | const | term / shape builders | `const app` |
| `applyCallbackAbs` | fn | — | `applyCallbackAbs( cb: Abs \| { type: string }, args: Abs[], env: unknown, phi: unknown, budget: unknown, ): Abs` |
| `applyCallbackValue` | fn | 通用回调实参调用（exec/class invokeArrMethod 与 builtins Array.from 共用）： 原始 JS 函数直调（展开实参）；Abs fn 走 applyCallbackAbs（sum 分发/宿主）。 | `applyCallbackValue( fn: unknown, args: Abs[], env: unknown, phi: unknown, budget: unknown, ): Abs` |
| `array` | fn | term / shape builders | `array( item: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined, ): ConstraintBuilder` |
| `asAbs` | fn | 从 map/filter/reduce 回调实参里取出 Abs（Identifier 已绑定或直接 Abs） | `asAbs(v: unknown): Abs \| undefined` |
| `asAbsVal` | fn | value / class runtime | `asAbsVal(v: unknown): Abs` |
| `assignSourceSlots` | fn | — | `assignSourceSlots(src: Abs): Record<string, { value: Abs }> \| undefined` |
| `AstEnv` | type | — | — |
| `attachFnImpl` | fn | — | `attachFnImpl(a: Abs, impl: AbsFnImpl): void` |
| `BAbsAssignRecord` | type | B 赋值记录（与 ast-records.ts AbsAssignRecord 同形；structuralAssignIssues 消费） | `BAbsAssignRecord = { name: string; prev: Abs \| undefined; next: Abs; line?: number; column?: number; conditional?: boolean; }` |
| `BCallRecord` | type | call-site recording for analyze | `BCallRecord = { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean; }` |
| `BClassSpec` | type | — | — |
| `beginCollectionFork` | fn | — | `beginCollectionFork(): void` |
| `betaOf` | fn | 共享输出变量 B:$&#123;param&#125;（§5.1 P2 钉死） | `betaOf(param: string): Term` |
| `bigintLit` | fn | literal Abs | `bigintLit(value: bigint): Abs` |
| `bindImports` | fn | 把 import 说明符绑定进 env（宿主已求值依赖） | `bindImports( node: ImportDeclaration, env: AstEnv, modules: Record<string, AbsModuleExports>, ): void` |
| `bindingsOf` | fn | — | `bindingsOf(run: Record<string, unknown>): Map<string, unknown> \| undefined` |
| `bitandAbs` | fn | &amp; —— ToInt32 两侧后按位与 | `bitandAbs(a: Abs, b: Abs): Abs` |
| `bitnotAbs` | fn | ~ —— ToInt32 后按位取反（bigint 无符号截断） | `bitnotAbs(a: Abs): Abs` |
| `bitorAbs` | fn | \| —— ToInt32 两侧后按位或 | `bitorAbs(a: Abs, b: Abs): Abs` |
| `bitxorAbs` | fn | ^ —— ToInt32 两侧后按位异或 | `bitxorAbs(a: Abs, b: Abs): Abs` |
| `bool` | fn | Abs constructors / faces | `bool(): Abs` |
| `boolean` | fn | `@nudo:contract` builder grammar | `boolean(): ConstraintBuilder` |
| `boolLit` | fn | literal Abs | `boolLit(value: boolean): Abs` |
| `BPathFallback` | type | B-path 回落事件（观测单一埋点；reason: unsupported:* = 能力边界，internal = B 自身缺陷） | `BPathFallback = { reason: string; message: string; loc?: { line: number; column: number }; }` |
| `buildArgsFromAssume` | fn | 按 assume 集合构造实参：被 assume 的参数给带约束的符号，其余 any （design-cli-semantics §2：入口无约束 = any，不是 unknown）。 | `buildArgsFromAssume( source: string, fnName: string, assumeIds: Set<string>, ): Abs[]` |
| `builtinCtorAbs` | fn | — | `builtinCtorAbs(name: string): Abs` |
| `builtinCtorNameOf` | fn | Abs 侧内建构造器身份（与宿主构造器名对齐） | `builtinCtorNameOf(v: unknown): string \| undefined` |
| `callAbsMethod` | fn | 调用 Abs 方法。返回 undefined = 未接管（调用方走其它路径）。 | `callAbsMethod( recv: Abs, name: string, args: Abs[], ): Abs \| undefined` |
| `callAtFunctionBoundary` | fn | 函数调用边界：callee 的 loop/early-return 不得冒泡成 caller 结果。 | `callAtFunctionBoundary<T>(body: () => T): T` |
| `callTranspiledExport` | fn | B-path execution (analyze mode) | `callTranspiledExport( exports: Record<string, unknown>, name: string, args: Abs[], ): Abs` |
| `callTranspiledExportFull` | fn | B-path execution (analyze mode) | `callTranspiledExportFull( exports: Record<string, unknown>, name: string, args: Abs[], opts?: { phi?: Phi }, ): TranspiledCallResult` |
| `canonicalArrayIndex` | fn | ES 规范数组下标（无前导零、&lt; 2^32-1）；非规范键返回 undefined | `canonicalArrayIndex(v: unknown): number \| undefined` |
| `CheckAction` | type | 结构化修复动作（AI1；稳定枚举，只增不改语义） | `CheckAction = { kind: "draft" \| "relax" \| "callsite" \| "assume" \| "mock" \| "emit" \| "ignore-throws" \| "info"; command?: string; label: st...` |
| `checkArg` | fn | contract checking | `checkArg( arg: Abs, expect: Pred \| undefined, phi: Phi = pTrue, ): Diagnostic \| undefined` |
| `checkCall` | fn | contract checking | `checkCall( source: string, fnName: string, args: Abs[], phi: Phi = pTrue, ): Diagnostic[]` |
| `CheckIssue` | type | — | `CheckIssue = Diagnostic & { fn?: string; line?: number; column?: number; actual?: string; expected?: string; actions?: CheckAction[]; }` |
| `CheckJson` | type | `nudo check` gate | `CheckJson = { version: 1; file: string; ok: boolean; summary: CheckReport["summary"]; signatures: Array<{ name: string; params: string[];...` |
| `CheckJsonMulti` | type | 多文件 `check --json` 信封（CI / monorepo）。单文件仍输出裸 CheckJson。 | `CheckJsonMulti = { version: 1; kind: "multi"; ok: boolean; summary: CheckReport["summary"] & { files: number; budgetTruncated?: boolean }...` |
| `CheckOptions` | type | — | — |
| `CheckReport` | type | `nudo check` gate | `CheckReport = { file: string; issues: CheckIssue[]; ok: boolean; signatures: NudoSig[]; summary: { errors: number; warnings: number; info...` |
| `checkSource` | fn | `nudo check` gate | `checkSource( filePath: string, source: string, phi: Phi = pTrue, opts: CheckOptions = {}, ): CheckReport` |
| `clearBClasses` | fn | — | `clearBClasses(): void` |
| `clearCollectionTables` | fn | — | `clearCollectionTables(): void` |
| `clearStaleTermPred` | fn | 调用方已直接改 shape 时的 term/pred 清理 | `clearStaleTermPred(v: Abs): void` |
| `cmp` | fn | 比较：返回 boolean Abs；若双字面量则 exact | `cmp( op: "lt" \| "le" \| "gt" \| "ge" \| "eq" \| "ne", a: Abs, b: Abs, phi: Phi = pTrue, ): Abs` |
| `collectAbsExports` | fn | 从已求值 env + AST 收集 ESM 导出。 | `collectAbsExports( file: File, env: AstEnv, modules?: Record<string, AbsModuleExports>, ): AbsModuleExports` |
| `collectAbsFreeVars` | fn | 公开：收集 Abs 自由 term 变元（dts 泛型投影 / α 作用域判定复用 L2 基建）。 | `collectAbsFreeVars(a: Abs): Set<string>` |
| `collectionElementJoin` | fn | 元素联合（for-of / Array.from）；无表 → unknown。 | `collectionElementJoin(c: Abs): Abs` |
| `collectionExactLen` | fn | 确切条目数：Set 无 maybeAbsent / Map 无 shadow+maybeAbsent 时返回长度； 否则 undefined（for-of 不得假装有界）。 | `collectionExactLen(c: Abs): number \| undefined` |
| `Confidence` | type | Abs = shape × term × pred × conf | `Confidence = "exact" \| "path" \| "widened" \| "mock" \| "partial" \| "opaque"` |
| `confJoin` | fn | assignability / join | `confJoin(a: Confidence, b: Confidence): Confidence` |
| `ConstraintBuilder` | type | `@nudo:contract` builder grammar | `ConstraintBuilder = NudoConstraint & { gt(n: number): ConstraintBuilder; ge(n: number): ConstraintBuilder; lt(n: number): ConstraintBuild...` |
| `constraintToEntryAbs` | fn | 契约 → 函数入口 param Abs（infer/hover 用）。 | `constraintToEntryAbs( c: NudoConstraint, paramName: string, ): Abs` |
| `contractParamNameSet` | fn | 侧车契约可绑定的参数名全集 | `contractParamNameSet(formals: FormalParam[]): Set<string>` |
| `createEnvironment` | fn | env host surface | `createEnvironment( parent?: Environment, bindings: Map<string, Abs> = new Map(), ): Environment` |
| `createHofCollectCtx` | fn | — | `createHofCollectCtx( paramNames: ReadonlySet<string>, alphaIds: Iterable<string>, ): HofCollectCtx` |
| `ctorArgDefinitelyInvalid` | fn | 构造器实参**确定**非法（原生 TypeError 域）： - 非可迭代字面量（number/boolean/symbol/bigint、闭对象字面量）→ Set/Map 都抛 - Map 条目必须是对象：外层 iterable 出现 lit prim 条目（含字符串实参的 每个字符、tuple/Set 元素）→ TypeError（空串例外：零条目合法） 抽象形态不确定 → false（保守）。 | `ctorArgDefinitelyInvalid( name: "Map" \| "Set", iterable: Abs \| undefined, ): boolean` |
| `ctorNameOfRecv` | fn | 接收者 → 原型链 constructor 名（`.constructor` 折叠）。 | `ctorNameOfRecv(recv: Abs): string \| undefined` |
| `currentExecPhi` | fn | — | `currentExecPhi(): Phi` |
| `currentPhi` | fn | — | `currentPhi(): Phi` |
| `DEFAULT_MAX_LOOP_ITERS` | const | 循环展开上限（leaf）—— 从 control.ts 拆出，打断 control ↔ containers 环。 | `const DEFAULT_MAX_LOOP_ITERS` |
| `definitelyNotNullishShape` | fn | 该 shape 在 JS 上一定不是 null/undefined | `definitelyNotNullishShape(s: Shape): boolean` |
| `describePhi` | fn | — | `describePhi(): string` |
| `Diagnostic` | type | — | `Diagnostic = { severity: "error" \| "warning" \| "info"; code: string; message: string; suggestion?: string; fn?: string; argIndex?: number; }` |
| `div` | fn | 除法：字面量折叠；除以正/负常数时按单调性推界。 | `div(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| `drainPromiseMicros` | fn | — | `drainPromiseMicros(): void` |
| `effectiveInterface` | fn | interface tiers | `effectiveInterface( source: string, fnName: string, opts: EffectiveInterfaceOpts = {}, ): EffectiveInterface \| undefined` |
| `EffectiveInterface` | type | interface tiers | `EffectiveInterface = { fnName: string; params: Array<{ param: string; constraint: NudoConstraint }>; returns?: { constraint: NudoConstrai...` |
| `EffectiveInterfaceOpts` | type | — | `EffectiveInterfaceOpts = RefineResolveOpts & { autoBind?: boolean \| ((sidecarPath: string) => boolean); projectDir?: string; }` |
| `emptyEnv` | fn | 空求值环境（分析宿主用：不带任何绑定） | `emptyEnv(): AstEnv` |
| `emptyPhi` | const | — | `const emptyPhi` |
| `endCollectionFork` | fn | — | `endCollectionFork(arms: Array<ArmOverlay \| undefined \| null>): void` |
| `enterPromiseExecutorScope` | fn | — | `enterPromiseExecutorScope(): void` |
| `Environment` | type | env host surface | `Environment = { lookup(name: string): Abs; bind(name: string, value: Abs): Environment; update(name: string, value: Abs): boolean; extend...` |
| `eq` | const | — | `const eq` |
| `errorBrandAbs` | fn | Error brand：shape 带 name/message（字面量 message 保精确）。 | `errorBrandAbs(name: string, args: Abs[]): Abs` |
| `evalArrayStatic` | fn | Array.isArray / Array.from / Array.of | `evalArrayStatic(name: string, args: Abs[]): Abs \| undefined` |
| `evalBuiltinInstanceMethod` | fn | brand 实例方法（Date/RegExp/Map/Set） | `evalBuiltinInstanceMethod( brandName: string, method: string, recv: Abs, args: Abs[], ): Abs \| undefined` |
| `evalBuiltinNew` | fn | new X(...) | `evalBuiltinNew(className: string, args: Abs[]): Abs \| undefined` |
| `evalDateCtor` | fn | — | `evalDateCtor(args: Abs[]): Abs` |
| `evalDateMethod` | fn | — | `evalDateMethod(name: string, _recv: Abs, _args: Abs[]): Abs \| undefined` |
| `evalDateStatic` | fn | — | `evalDateStatic(name: string, _args: Abs[]): Abs \| undefined` |
| `evalExprAbs` | fn | Abs-native expression eval | `evalExprAbs( expr: import("@babel/types").Expression, bindings: Record<string, Abs> = {}, ): Abs` |
| `evalGlobalFn` | fn | — | `evalGlobalFn(name: string, args: Abs[]): Abs \| undefined` |
| `evalJsonMethod` | fn | JSON.parse / stringify：字面量实参真执行折叠；失败硬抛（catch 可吸收） | `evalJsonMethod(name: string, args: Abs[]): Abs \| undefined` |
| `evalMathMethod` | fn | — | `evalMathMethod(name: string, args: Abs[]): Abs \| undefined` |
| `evalNamespaceCall` | fn | — | `evalNamespaceCall( ns: string, method: string, args: Abs[], ): Abs \| undefined` |
| `evalNumberStatic` | fn | Number.isInteger / isNaN / parseFloat 等 | `evalNumberStatic(name: string, args: Abs[]): Abs \| undefined` |
| `evalObjectMethod` | fn | Object.keys/values/entries/assign + 不变性方法 | `evalObjectMethod(name: string, args: Abs[]): Abs \| undefined` |
| `evalObjectProtoMethod` | fn | Object.prototype 方法语义（B-path $invoke 与 Object.prototype.X.call 共用）。 | `evalObjectProtoMethod( name: string, thisVal: Abs, args: Abs[], ): Abs \| undefined` |
| `evalPromiseCtor` | fn | new Promise(executor)：调用 executor(resolve, reject)，收集 resolve 实参作为 promise inner。原生只认第一次 settle——顺序双 resolve 取第一次；执行器内 $fork 分叉时各臂 settle 值 join（路径敏感，不得 first-wins 假精确）。 | `evalPromiseCtor(args: Abs[]): Abs` |
| `evalPromiseMethod` | fn | then/catch/finally：可映射回调 → 新 inner；做不到诚实 promise&lt;unknown&gt; | `evalPromiseMethod( name: string, recv: Abs, args: Abs[], ): Abs \| undefined` |
| `evalPromiseStatic` | fn | — | `evalPromiseStatic(name: string, args: Abs[]): Abs \| undefined` |
| `evalRegExpCtor` | fn | — | `evalRegExpCtor(args: Abs[]): Abs` |
| `evalRegExpMethod` | fn | — | `evalRegExpMethod(name: string, recv: Abs, args: Abs[]): Abs \| undefined` |
| `evalStringStatic` | fn | String.fromCharCode(...)： - 全部字面量 → 按 ToUint16 折成精确字符串（含越界/非整数/数字字符串） - symbol 字面量 → TypeError（ToNumber 抛） - 任一抽象实参 → 抽象 string（不假精确） | `evalStringStatic(name: string, args: Abs[]): Abs \| undefined` |
| `evalSymbolCtor` | fn | 全局 Symbol([desc])（$callNamed 身份校验后派发） | `evalSymbolCtor(args: Abs[]): Abs` |
| `evictCheckSourceMemoForPaths` | fn | `*.nudo.js` 变更后定向逐出依赖它的整文件 check 缓存 | `evictCheckSourceMemoForPaths(paths: string[]): number` |
| `evictGeneralizeMemoForPaths` | fn | LSP/宿主：`*.nudo.js` 变更后按路径定向逐出依赖它的 L0 条目。 | `evictGeneralizeMemoForPaths(paths: string[]): number` |
| `execNudoModule` | fn | 执行 *.nudo.js（真实 JS + 我们的构建器）。import/export 由 Babel 语句级 改写：多行 named import、注释/字符串里的同形文本不误伤；相对 .nudo 递归 求值；环 → throw NudoSidecarError。结果进 exec 缓存（依赖闭包内容指纹键）。 | `execNudoModule(src: string, opts?: RefineResolveOpts): Record<string, unknown>` |
| `extractDeclaredThrows` | fn | 申报式抛错（declare throws — L2 豁免）： 与 refine 同扫函数前注释块。返回 `*` = 申报任意；数组 = 按名申报； undefined = 无申报（L2 照常执法）。 | `extractDeclaredThrows( source: string, fnName: string, ): string[]` |
| `extractFn` | fn | — | `extractFn( source: string, fnName: string, fileAst?: ReturnType<typeof babelParse>, )` |
| `extractNudoImports` | fn | — | `extractNudoImports(source: string): NamedImport[]` |
| `extractRefineReturnFromSource` | fn | 解析 `@nudo:contract return positive` → 返回契约。 | `extractRefineReturnFromSource( source: string, fnName: string, opts: RefineResolveOpts = {}, )` |
| `extractRefinesFromSource` | fn | refinement gate | `extractRefinesFromSource( source: string, fnName: string, opts: RefineResolveOpts = {}, ): RefineEntry[]` |
| `ExtState` | type | — | `ExtState = "nonext" \| "sealed" \| "frozen"` |
| `extStateOf` | fn | — | `extStateOf(o: Abs): ExtState \| undefined` |
| `falseConstraint` | fn | — | `falseConstraint(c: Abs): Pred \| undefined` |
| `fillTuple` | fn | array runtime | `fillTuple( shape: { k: "tuple"; elements: Abs[]; holes?: number[] } \| { k: "arr"; element: Abs }, vals: Abs[], arr: Abs, ): Abs` |
| `fn` | fn | term / shape builders | `fn( params: Record<string, NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined>, returns?: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined, opts?: { throws?: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined }, ): ConstraintBuilder` |
| `FnAbs` | type | — | `FnAbs = Abs & { shape: { k: "fn"; params: string[]; name?: string; paramTypes?: Abs[]; returnType?: Abs; }; }` |
| `fnConstraintToEntryReqs` | fn | fn 约束 → 逐参约束表（interface 推导 / 入口签名消费）。 | `fnConstraintToEntryReqs( c: NudoConstraint, ): Array<{ param: string; constraint: NudoConstraint }>` |
| `fnOf` | fn | term / shape builders | `fnOf(params: string[], name?: string): Abs` |
| `foldRequireSpecArg` | fn | static folding helpers | `foldRequireSpecArg(arg: unknown): string \| undefined` |
| `foldStaticStringExpr` | fn | static folding helpers | `foldStaticStringExpr(node: unknown): string \| undefined` |
| `FormalParam` | type | C4.1：函数形参表面（contract surface）—— 侧车 `fn({…})` / `@nudo:contract` 参数名与求值形参的对齐基线。 | `FormalParam = \| { kind: "id"; name: string; index: number } \| { kind: "default"; name: string; index: number } \| { kind: "rest"; name: st...` |
| `formalParamDisplayNames` | fn | 求值/签名用形参名（与 analyzer extractParamNames / dts 对齐） | `formalParamDisplayNames(formals: FormalParam[]): string[]` |
| `formalParamsFromNodes` | fn | — | `formalParamsFromNodes(params: AstParam[] \| undefined \| null): FormalParam[]` |
| `formatAbs` | fn | extensional rendering (one-way) | `formatAbs(a: Abs, opts: FormatOptions = {}): string` |
| `formatAbsMultiline` | fn | 多行展示，CLI 用 | `formatAbsMultiline(a: Abs, label?: string): string` |
| `formatCheckReport` | fn | extensional rendering (one-way) | `formatCheckReport(r: CheckReport, opts: { verbose?: boolean } = {}): string` |
| `formatConstraint` | fn | extensional rendering (one-way) | `formatConstraint(c: NudoConstraint): string` |
| `formatDiagnostics` | fn | — | `formatDiagnostics(diags: Diagnostic[]): string` |
| `formatEffectiveInterfaceDisplay` | fn | EffectiveInterface → 契约展示串（与 CLI interface 打印同口径，不含函数名） | `formatEffectiveInterfaceDisplay(eff: EffectiveInterface): string` |
| `formatGithubAnnotations` | fn | GitHub Actions 行内注解（PR Files changed 红/黄标）。 | `formatGithubAnnotations( r: CheckReport, opts: { workspaceRoot?: string } = {}, ): string` |
| `formatGitlabCodeQuality` | fn | GitLab Code Quality 报告数组（`--gitlab`；可写 gl-code-quality-report.json） | `formatGitlabCodeQuality( r: CheckReport, opts: { workspaceRoot?: string } = {}, ): GitlabCodeQualityIssue[]` |
| `formatInterfaceTierLine` | fn | CodeLens / hover 首行标题（design-refine-derivation §8）：`● interface / <source>` | `formatInterfaceTierLine(source: InterfaceSource): string` |
| `FormatOptions` | type | — | `FormatOptions = { showTerm?: boolean; showPred?: boolean; indent?: string; }` |
| `formatShape` | fn | extensional rendering (one-way) | `formatShape(a: Abs): string` |
| `formatShapeSlot` | fn | fn/arr 槽位：shape + 非 lit term（禁止在 format 里内联复制 term 逻辑） | `formatShapeSlot(a: Abs): string` |
| `ge` | const | — | `const ge` |
| `generalizeAll` | fn | symbolic α generalization | `generalizeAll( source: string, opts: { budget?: LeakBudget } = {}, ): PolyFn[]` |
| `generalizeFromAst` | fn | symbolic α generalization | `generalizeFromAst( fnName: string, source: string, opts: { budget?: LeakBudget; label?: string; refine?: EffectiveInterfaceOpts; file?: ReturnType<typeof babelParse>; depsFp?: LoadDepsFingerprint; sidecarFp?: string; modules?: Record<string, AbsModuleExports \| Record<string, unknown>>; inject?: RunTranspiledOptions; } = {}, ): PolyFn \| undefined` |
| `generatedExportNames` | fn | 侧车源码的生成段导出名：export 之前（跳过紧邻的 import/const 链）的注释 行含 `@generated` → 该名为 generated。组合式下行段（§5.3）形态为 `import` + `@generated 头` + prelude + export；callsite 段则是头紧贴 export。隔了其他代码行 / 无标记 / re-export 列表均不算。 | `generatedExportNames(sidecarSrc: string): Set<string>` |
| `geNum` | fn | — | `geNum(term: Term, n: number): Pred` |
| `getAbsProperty` | fn | 属性读取：template/string.length 等 | `getAbsProperty(recv: Abs, name: string): Abs \| undefined` |
| `getBCallCollector` | fn | — | `getBCallCollector()` |
| `getBClass` | fn | — | `getBClass(name: string): BClassSpec \| undefined` |
| `getFnImpl` | fn | — | `getFnImpl(a: Abs): AbsFnImpl \| undefined` |
| `getGeneralizeMemoSize` | fn | — | `getGeneralizeMemoSize(): number` |
| `getImplicationOracle` | fn | — | `getImplicationOracle(): ImplicationOracle \| undefined` |
| `getParseSourceCacheSize` | fn | Babel parse + memo | `getParseSourceCacheSize(): number` |
| `getPropFlags` | fn | — | `getPropFlags(o: Abs): Map<string, PropFlags> \| undefined` |
| `getSlot` | fn | 自有槽位读取。slots 是普通对象，直接 `slots[key]` 会让 `__proto__` / `toString` / `valueOf` 等键命中 Object.prototype 原型链，得到既非 slot 又 truthy 的原生值（历史 bug 模式，已两次复发）。所有跨来源 key 的槽位 读取必须走这里。 | `getSlot<S extends { value: Abs }>( slots: Record<string, S>, key: string, ): S \| undefined` |
| `getTerm` | fn | 字段访问项：u.id | `getTerm(obj: Term, key: string): Term` |
| `GitlabCodeQualityIssue` | type | — | `GitlabCodeQualityIssue = { description: string; check_name: string; fingerprint: string; severity: "major" \| "minor" \| "info" \| "blocker"...` |
| `gt` | const | — | `const gt` |
| `gtNum` | fn | 便捷：数字下界 | `gtNum(term: Term, n: number): Pred` |
| `HofCollectCtx` | type | — | — |
| `HofSite` | type | — | — |
| `hostBuiltinCtorName` | fn | 宿主全局构造器身份（Number === (42).constructor 折叠用） | `hostBuiltinCtorName(v: unknown): string \| undefined` |
| `ImplicationOracle` | type | 外部蕴含 oracle（可选 SMT 等）。内建判定证不出时调用。 | `ImplicationOracle = (phi: Phi, pred: Pred) => boolean \| undefined` |
| `implies` | fn | 简单蕴含：在区间/线性/字面量/typeof 可判定范围内判断 Φ ⊢ pred | `implies(phi: Phi, pred: Pred): boolean` |
| `instantiateConstraint` | fn | contract checking | `instantiateConstraint( c: NudoConstraint, paramName: string, ): Pred` |
| `instantiateReturn` | fn | relation-only / isRelFn 的应用：按 paramTypes 做 α 替换得到 returnType。 | `instantiateReturn(fn: Abs, args: Abs[]): Abs` |
| `InterfaceDiag` | type | interface 推导诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） | `InterfaceDiag = { code: string; message: string; file?: string }` |
| `interfaceDiagCount` | fn | 当前诊断累计序号（since 锚：工具面只排干自身探测产生的增量） | `interfaceDiagCount(): number` |
| `InterfaceSource` | type | 有效契约来源：手写（源码 refine ∪ 侧车手写绑定）&gt; 生成段 &gt; 隐式 | `InterfaceSource = "handwritten" \| "generated" \| "implicit"` |
| `interfaceSourceOf` | fn | interfaceTierOf 的来源投影；非导出 → undefined | `interfaceSourceOf( source: string, fnName: string, fromFile: string, opts: InterfaceTierOpts = {}, ): InterfaceSource \| undefined` |
| `InterfaceTierInfo` | type | interface tiers | `InterfaceTierInfo = { source: InterfaceSource; display?: string; }` |
| `interfaceTierOf` | fn | interface tiers | `interfaceTierOf( source: string, fnName: string, fromFile: string, opts: InterfaceTierOpts = {}, ): InterfaceTierInfo \| undefined` |
| `InterfaceTierOpts` | type | — | `InterfaceTierOpts = EffectiveInterfaceOpts` |
| `isArrMutator` | fn | array runtime | `isArrMutator(name: string): boolean` |
| `isBigPrim` | fn | — | `isBigPrim(a: Abs): boolean` |
| `isDefinitelyFalse` | fn | — | `isDefinitelyFalse(a: Abs): boolean` |
| `isDefinitelyTrue` | fn | — | `isDefinitelyTrue(a: Abs): boolean` |
| `isErrorCtorName` | fn | — | `isErrorCtorName(name: string \| undefined): boolean` |
| `isExactLit` | fn | literal Abs | `isExactLit(a: Abs): boolean` |
| `isIntFlag` | fn | builder 与纯数据形态统一的 int 标志读取：纯数据看 `int === true`， builder（int 是链式方法）查 WeakSet。toPlainConstraint 归一化后只剩前者。 | `isIntFlag(c: NudoConstraint): boolean` |
| `isMapAbs` | fn | — | `isMapAbs(a: Abs \| undefined): boolean` |
| `isNodeModulesPath` | const | — | — |
| `isNudoBreak` | fn | — | `isNudoBreak(e: unknown, label?: string): boolean` |
| `isNudoConstraint` | fn | — | `isNudoConstraint(x: unknown): x` |
| `isNudoContinue` | fn | — | `isNudoContinue(e: unknown, label?: string): boolean` |
| `isNudoReturn` | fn | — | `isNudoReturn(e: unknown): e` |
| `isNudoThrow` | const | — | — |
| `isNullishLitAbs` | fn | 仅当 term 确为 lit null/undefined 时为 true；非 lit 的 litValue===undefined 不得当 nullish | `isNullishLitAbs(a: Abs): boolean` |
| `isNullProtoObj` | fn | — | `isNullProtoObj(o: Abs): boolean` |
| `isNumPrim` | fn | — | `isNumPrim(a: Abs): boolean` |
| `isObj` | fn | — | `isObj(a: Abs): a` |
| `isObjectProtoBrand` | fn | — | `isObjectProtoBrand(a: Abs \| undefined): boolean` |
| `isRelFn` | fn | 「有可用外延签名」判定：唯一权威定义。 | `isRelFn(a: Abs \| undefined \| null): boolean` |
| `isSetAbs` | fn | — | `isSetAbs(a: Abs \| undefined): boolean` |
| `isStrPrim` | fn | — | `isStrPrim(a: Abs): boolean` |
| `isSymbolAbs` | const | — | `const isSymbolAbs` |
| `joinAbs` | fn | assignability / join | `joinAbs(a: Abs, b: Abs): Abs` |
| `joinFunctions` | fn | 函数 join：签名并（重载），禁止 (A\|C)→(B\|D)。 | `joinFunctions(a: Abs, b: Abs): Abs` |
| `joinObjects` | fn | 对象 join：默认积之和（sum），不自动折 optional。 | `joinObjects(a: Abs, b: Abs): Abs` |
| `joinThenProject` | fn | 工件聚合投影（设计 §4.2：先 Abs join 折叠再投影）。 | `joinThenProject(absList: Abs[]): NudoConstraint \| undefined` |
| `joinValues` | fn | assignability / join | `joinValues(a: Abs, b: Abs): Abs` |
| `le` | const | — | `const le` |
| `leavePromiseExecutorScope` | fn | — | `leavePromiseExecutorScope(): number` |
| `lenTerm` | fn | 长度项：length(u) | `lenTerm(t: Term): Term` |
| `leNum` | fn | — | `leNum(term: Term, n: number): Pred` |
| `leqAbs` | fn | assignability / join | `leqAbs( src: Abs, tgt: Abs, opts: { phi?: Phi; env?: AstEnv } = {}, ): LeqResult` |
| `LeqResult` | type | — | `LeqResult = { ok: boolean; reason?: string; }` |
| `listFunctionNames` | fn | 列出源码中的顶层函数名。 | `listFunctionNames(source: string): string[]` |
| `lit` | const | term / shape builders | `const lit` |
| `litC` | fn | `@nudo:contract` builder grammar | `litC(v: number \| string \| boolean \| null \| undefined): ConstraintBuilder` |
| `literalMeetsConstraint` | fn | 字面量 lv 是否落在约束 c 表达的域内（保守：判不了 → false）。 | `literalMeetsConstraint( lv: number \| string \| boolean \| null, c: NudoConstraint, ): boolean` |
| `LiteralValue` | type | 项（Term）：抽象值的身份。字面量是项的特例。 | `LiteralValue = string \| number \| boolean \| null \| undefined` |
| `litTruth` | fn | JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined | `litTruth(a: Abs): boolean \| undefined` |
| `litValue` | fn | literal Abs | `litValue(a: Abs): LiteralValue \| undefined` |
| `localNamedExports` | fn | 源文件本地导出名表（侧车自动绑定边界）： - ESM：`export function/const/let/var/class` 与本地 `export { x }` / `export { local as exported }`（按**导出名**绑定）； - `export default function add` / `const add = …; export default add`： 按**本地名** `add` 绑定（侧车可 `export const add = fn(…)`）； 同时登记 `"default"`，供侧车 `export default fn(…)` 对齐； - CJS（C4.3）：`module.exports = { a, b }`、`module.exports.a = …`、 `exports.a = …`、`module.exports = localFn`（登记 localFn 名）。 | `localNamedExports(source: string): Set<string>` |
| `locateContractParam` | fn | 契约参数名 → 形参定位。 | `locateContractParam( formals: FormalParam[], contractName: string, )` |
| `lookupObjAccessor` | fn | 对象字面量访问器查询（供 $get/$set/$spread/Object.assign 共用） | `lookupObjAccessor( o: Abs, key: string, )` |
| `looseEqAbs` | fn | 宽松相等 `==`（C2.3）：双 lit 走 Abstract Equality；否则回落严格相等判定。 | `looseEqAbs(a: Abs, b: Abs): boolean \| undefined` |
| `lt` | const | — | `const lt` |
| `ltNum` | fn | — | `ltNum(term: Term, n: number): Pred` |
| `makeArrayCtorAbs` | fn | — | `makeArrayCtorAbs(args: Abs[]): Abs` |
| `makeMapAbs` | fn | — | `makeMapAbs(iterable?: Abs): Abs` |
| `makeSetAbs` | fn | — | `makeSetAbs(iterable?: Abs): Abs` |
| `makeSum` | fn | term / shape builders | `makeSum(a: Abs, b: Abs): Abs` |
| `makeSymbolAbs` | fn | Symbol([description])：非具体 unique symbol（prim type=symbol，无 term）。 | `makeSymbolAbs(descArg?: Abs): Abs` |
| `mapClearEntries` | fn | Map#clear：清空条目；fork 下仍走 overlay | `mapClearEntries(mapAbs: Abs): Abs` |
| `mapDeleteEntry` | fn | Map#delete：fork overlay 内移除字面量键；未知 key 仅标 shadow 不确定 | `mapDeleteEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| `mapElementFallback` | fn | map 元素投影：body 在符号实参上跑出 unknown 时， 用 shape.returnType 槽，conf 由调用方按 path/partial 处理。 | `mapElementFallback( cbAbs: Abs \| undefined, elem: Abs, out: Abs, ): Abs` |
| `mapEntriesAbs` | fn | Map 迭代条目：JS `for (const [k,v] of map)` / `Array.from(map)` 产出 `[key, value]` 元组 Abs。字面量 key 精确；shadow 写入 key 为 unknown。 | `mapEntriesAbs(mapAbs: Abs): Abs[]` |
| `mapGetEntry` | fn | Map#get：命中字面量 key → 精确；miss / 未知 key / maybeAbsent / shadow 并 undefined | `mapGetEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| `mapHasEntry` | fn | Map#has：字面量 miss 折 exact false 时，get 必须是 undefined（不可再并 value） | `mapHasEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| `mapSetEntry` | fn | Map#set：fork 内写 overlay；否则原地。返回同一 Abs（JS 可变语义） | `mapSetEntry(mapAbs: Abs, key: Abs \| undefined, value: Abs): Abs` |
| `mapSizeAbs` | fn | — | `mapSizeAbs(mapAbs: Abs): Abs` |
| `mapValuesAbs` | fn | — | `mapValuesAbs(mapAbs: Abs): Abs[]` |
| `markExtState` | fn | — | `markExtState(o: Abs, s: ExtState): Abs` |
| `markNullProtoObj` | fn | — | `markNullProtoObj(o: Abs): Abs` |
| `markPureFn` | fn | 标记纯函数（@nudo:pure）：调用结果可按实参记忆化 | `markPureFn(target: object, name: string): void` |
| `matchRelIdentLit` | fn | 从 Identifier 在比较中的位置解析「对哪个变量、用哪个关系」。 | `matchRelIdentLit( test: unknown, )` |
| `MAX_B_CALL_DEPTH` | const | — | `const MAX_B_CALL_DEPTH` |
| `MAX_B_TOTAL_CALLS` | const | 总调用上限：与 call-budget.MAX_TOTAL_CALLS 同阀（递归×循环×分支展开的 规模阀）。200k 在病态展开（lodash _baseFlatten）下 ~30s，20k 收口到 ~3s——截断 → opaque（更保守，zero-FP 安全）。 | `const MAX_B_TOTAL_CALLS` |
| `mergeCollectionArms` | fn | 合并 fork 各臂 overlay → 全局表（由 endCollectionFork 实现）。 | `mergeCollectionArms(arms: Array<ArmOverlay \| undefined \| null>): void` |
| `migrateInvariants` | fn | 写路径产生新副本时迁移不变性侧表（同 migrateAccessors 模式）。 | `migrateInvariants(from: Abs, to: Abs): void` |
| `migrateNullProto` | fn | 同一对象的不可变更新（$set/$del）迁移 nullProto 标记 | `migrateNullProto(from: Abs, to: Abs): Abs` |
| `mock` | fn | test mock helpers | `mock(): MockHelper` |
| `MockHelper` | type | test mock helpers | `MockHelper = { kind: "mock-helper"; returnValue?: Abs; resolvedValue?: Abs; rejectedValue?: Abs; onFirstCallValue?: Abs; onSecondCallValu...` |
| `mod` | fn | 取模：字面量折叠；`x % k`（k&gt;0 字面量）结果界在 (−\|k\|, \|k\|)。 | `mod(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| `mul` | fn | 乘法：字面量直接求值；×正数同向缩放；×负数翻转不等式；×0 归零 | `mul(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| `NamedImport` | type | `/// @nudo:import { delay, percent } from "./delay.nudo.js"` | `NamedImport = { names: string[]; spec: string }` |
| `namespaceNameOf` | fn | 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象 （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。 | `namespaceNameOf(v: unknown): string \| undefined` |
| `ne` | const | — | `const ne` |
| `negAbs` | fn | 一元负号：字面量折叠；符号数翻转不等式 | `negAbs(a: Abs, _phi: Phi = pTrue): Abs` |
| `negatePred` | fn | 逻辑否定（De Morgan）：¬(A∧B)=¬A∨¬B；¬(A∨B)=¬A∧¬B；双重否定消去。 | `negatePred(p: Pred): Pred` |
| `never` | const | Abs constructors / faces | `const never` |
| `not` | fn | — | `not(p: Pred): Pred` |
| `notAbs` | fn | 逻辑非 | `notAbs(a: Abs): Abs` |
| `noteBCallRecord` | fn | 成员/方法调用点打点（$invoke 等；无收集器时 no-op）。不进 $callNamed 预算。 | `noteBCallRecord(r: BCallRecord): void` |
| `noteBPathFallback` | fn | 记录一次 B 回落（body-fn 等非 runTranspiled 入口共用） | `noteBPathFallback(e: unknown): void` |
| `noteCollectionWrite` | fn | — | `noteCollectionWrite(id: object): void` |
| `notePromiseExecutorFork` | fn | $fork 在 executor 内发生时打点（多臂 resolve 需 join，不得 first-wins 假精确） | `notePromiseExecutorFork(): void` |
| `NudoConstraint` | type | contract checking | `NudoConstraint = { readonly __nudoConstraint: true; readonly prim?: PrimName; readonly preds: Pred[]; readonly fields?: Record<string, Nu...` |
| `NudoField` | type | — | `NudoField = { constraint: NudoConstraint; optional?: boolean; }` |
| `NudoFnConstraint` | type | fn(params, returns?, &#123; throws? | `NudoFnConstraint = { params: Record<string, NudoConstraint>; returns?: NudoConstraint; throws?: NudoConstraint; }` |
| `NudoLoopSignal` | type | control-signal / throw | `NudoLoopSignal extends Error { readonly kind: "break" \| "continue"; readonly label: string \| undefined; constructor(kind: "break" \| "cont...` |
| `NudoReturn` | type | control-signal / throw | `NudoReturn extends Error { readonly absValue: Abs; constructor(absValue: Abs) { super("nudo:return"); this.name = "NudoReturn"; this.absV...` |
| `NudoSidecarError` | fn | 侧车模块错误：code ∈ nudo:interface-cycle \| nudo:interface-load | `NudoSidecarError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = "NudoSid...` |
| `NudoSig` | type | 无损函数签名（类型即计算） | `NudoSig = { name: string; params: string[]; paramTypes?: string[]; abs: Abs; display: string; detail: string; conf: Confidence; throws?: ...` |
| `NudoThrow` | type | control-signal / throw | — |
| `NudoUnsupportedError` | fn | 转译器无法正确 lowering 的构造：抛此错误（替代静默降级注释）。 | `NudoUnsupportedError extends Error { readonly reason: string; readonly loc?: { line: number; column: number }; constructor(reason: string...` |
| `num` | fn | Abs constructors / faces | `num(): Abs` |
| `number` | fn | `@nudo:contract` builder grammar | `number(): ConstraintBuilder` |
| `numLit` | fn | literal Abs | `numLit(value: number): Abs` |
| `numVar` | fn | 带项的符号数，例如参数 x | `numVar(id: string, pred?: Pred, conf: Confidence = "path"): Abs` |
| `obj` | fn | term / shape builders | `obj( slots: Record<string, { value: Abs; optional?: boolean }>, ): Abs` |
| `OBJECT_PROTO_METHOD_NAMES` | const | — | `const OBJECT_PROTO_METHOD_NAMES` |
| `objectProtoBrand` | fn | Object.prototype 单例（$get(Object, "prototype") 与 host Object.prototype 共用）。 | `objectProtoBrand(): Abs` |
| `objectProtoMethodAbs` | fn | Object.prototype.X 一等函数（bindThis：call/apply 把 receiver 注入首参） | `objectProtoMethodAbs(name: string): Abs` |
| `objOf` | fn | — | `objOf( slots: Record<string, Slot>, opts?: { index?: { key: Abs; value: Abs }; open?: boolean }, ): Abs` |
| `ObjShape` | type | Abs = shape × term × pred × conf | `ObjShape = { k: "obj"; slots: Record<string, Slot>; index?: { key: Abs; value: Abs }; open?: boolean; }` |
| `omit` | fn | omit(c, keys)：shape 去字段；非 shape throw | `omit( c: NudoConstraint \| ConstraintBuilder, keys: string[], ): ConstraintBuilder` |
| `or` | fn | — | `or(...preds: Pred[]): Pred` |
| `parseSource` | fn | Babel parse + memo | `parseSource( source: string, opts?: { errorRecovery?: boolean; keepTs?: boolean }, ): File` |
| `partial` | fn | partial(c)：shape 全字段变可选；非 shape throw | `partial(c: NudoConstraint \| ConstraintBuilder): ConstraintBuilder` |
| `pFalse` | const | — | `const pFalse` |
| `Phi` | type | Abs = shape × term × pred × conf | `Phi = Pred` |
| `phiAnd` | const | — | `const phiAnd` |
| `pick` | fn | pick(c, keys)：shape 子形状（不存在的 key 忽略）；非 shape throw | `pick( c: NudoConstraint \| ConstraintBuilder, keys: string[], ): ConstraintBuilder` |
| `PolyFn` | type | — | `PolyFn = { name: string; params: string[]; typeParams: TypeParam[]; instantiate: (args: Abs[], phi?: Phi) => Abs; symbolic: Abs; display:...` |
| `popCollectionArm` | fn | — | `popCollectionArm(): ArmOverlay \| undefined` |
| `popPhi` | fn | — | `popPhi(): void` |
| `powAbs` | fn | —— 幂（右结合由 AST 保证）；负指数 bigint 原生 RangeError → 不可折叠 | `powAbs(a: Abs, b: Abs): Abs` |
| `Pred` | type | Abs = shape × term × pred × conf | `Pred = \| { op: "true" } \| { op: "false" } \| { op: "eq"; a: Term; b: Term } \| { op: "ne"; a: Term; b: Term } \| { op: "lt"; a: Term; b: Ter...` |
| `predEquals` | fn | — | `predEquals(a: Pred, b: Pred): boolean` |
| `predToString` | fn | — | `predToString(p: Pred): string` |
| `predVars` | fn | 收集 pred 中出现的自由变量 | `predVars(p: Pred): Set<string>` |
| `PrimName` | type | — | `PrimName = "number" \| "string" \| "boolean" \| "bigint" \| "symbol"` |
| `primToTypeof` | fn | abs prim 标签 → typeof 标签（恒等嵌入）。abs prim 仍是 PrimName 子集。 | `primToTypeof(p: PrimName): TypeofName` |
| `projectAbsToSchema` | const | one-way projections | — |
| `projectFlatMapResult` | fn | flatMap 统一结果：展开后的元素 join 成 arr(γ)。 | `projectFlatMapResult( arrConf: Confidence, mapped: Abs[], ): Abs` |
| `promoteParamShape` | fn | 提升写入载体：替换 env.vars map 项，禁止 mutate 共享 Abs。 | `promoteParamShape( env: AstEnv, param: string, promotedShape: Shape, opts?: { loc?: { line: number; column: number }; recordSite?: boolean }, ): boolean` |
| `PropFlags` | type | — | `PropFlags = { writable?: boolean; enumerable?: boolean; configurable?: boolean; }` |
| `protoBrandAbs` | fn | `X.prototype` 形态（getPrototypeOf 结果；带 constructor 槽） | `protoBrandAbs(ctorName: string): Abs` |
| `protoOfRecv` | fn | Object.getPrototypeOf 的具体原型投影（constructor 链可解）。 | `protoOfRecv(a: Abs): Abs` |
| `pTrue` | const | — | `const pTrue` |
| `ptypeof` | const | — | `const ptypeof` |
| `pureFnNameOf` | fn | 读纯函数标记（Abs impl 或对象属性 `_memoize`） | `pureFnNameOf(fn: unknown): string \| undefined` |
| `pushCollectionArm` | fn | — | `pushCollectionArm(): void` |
| `pushLoopExit` | fn | — | `pushLoopExit(v: Abs): void` |
| `pushPhi` | fn | — | `pushPhi(p: Phi): void` |
| `pushThrowExit` | fn | — | `pushThrowExit(v: Abs): void` |
| `queuePromiseMicro` | fn | — | `queuePromiseMicro(task: () => void): void` |
| `refineAbsForRelTrue` | fn | refinement gate | `refineAbsForRelTrue( a: Abs, op: "gt" \| "ge" \| "lt" \| "le", k: number, ): Abs` |
| `RefineDiag` | type | refine 侧车加载诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） | `RefineDiag = { code: string; message: string; file?: string }` |
| `refineDiagCount` | fn | 当前诊断累计序号（since 锚） | `refineDiagCount(): number` |
| `RefineEntry` | type | 解析 `ms delay` / `n percent` → [param, Pred] 多条用 &amp;&amp; 或换行连接。 | `RefineEntry = { param: string; pred: Pred; constraint: NudoConstraint; }` |
| `RefineResolveOpts` | type | — | `RefineResolveOpts = { loadModule?: (spec: string, fromFile: string) => string \| undefined; fromFile?: string; }` |
| `refineToIndexedFull` | fn | refine 参数 → 带约束模板的下标表（shape 检查用） | `refineToIndexedFull( source: string, fnName: string, paramNames: string[], opts: RefineResolveOpts = {}, ): Array<[number, RefineEntry]>` |
| `regexBrandAbsFrom` | fn | RegExp brand：source/flags/lastIndex 进 slots（B-path evalRegExpCtor / $regex 共用） | `regexBrandAbsFrom(pattern: string, flags: string): Abs` |
| `registerBClass` | fn | — | `registerBClass(spec: BClassSpec): void` |
| `relationFingerprint` | fn | relationFn 稳定 fingerprint（同签名共享，见 §3.3 已知限制） | `relationFingerprint( paramTypes: Abs[], returnType: Abs, ): string` |
| `relationFn` | fn | 无 body、纯关系的 fn Abs。params 仅记 arity。 | `relationFn( paramTypes: Abs[], returnType: Abs, opts?: { params?: string[]; conf?: Confidence; fingerprint?: string; inferFrom?: { fromVar: string; via: "arr" \| "promise"; inferVar: string }; condFallback?: Abs; }, ): Abs` |
| `RelSource` | type | — | — |
| `requiredFnArity` | fn | Required arity from fn param labels — skips rest (`...`) and optional (`?`). | `requiredFnArity(params: readonly string[] \| undefined): number` |
| `resetBCallBudget` | fn | 宿主入口（runTranspiled / callTranspiledExportFull）前重置 | `resetBCallBudget(): void` |
| `resetCheckSourceMemo` | fn | — | `resetCheckSourceMemo(): void` |
| `resetGeneralizeMemo` | fn | — | `resetGeneralizeMemo(): void` |
| `resetNudoModuleExecCache` | fn | — | `resetNudoModuleExecCache(): void` |
| `resetParseSourceCache` | fn | Babel parse + memo | `resetParseSourceCache(): void` |
| `resetPhi` | fn | — | `resetPhi(): void` |
| `RUNTIME_IMPORT_RE` | const | — | `const RUNTIME_IMPORT_RE` |
| `runtimeImportOf` | fn | JS AST → `$op` program | `runtimeImportOf(runtime: string): string` |
| `runTranspiled` | fn | B-path execution (analyze mode) | `runTranspiled( source: string, opts: RunTranspiledOptions = {}, ): Record<string, unknown>` |
| `RunTranspiledOptions` | type | — | `RunTranspiledOptions = { modules?: Record<string, AbsModuleExports \| Record<string, unknown>>; maxLoopIters?: number; mode?: "exec" \| "an...` |
| `runTranspiledOptionsMemoKey` | fn | inject/modules **内容**指纹（memo 键）。对象身份对「每次新建同内容」 的 CLI 注入不稳——同一语义的 inject 跨 checkSource 调用会 miss 缓存。 | `runTranspiledOptionsMemoKey( opts: RunTranspiledOptions \| undefined, ): string` |
| `runWithLoopExits` | fn | 函数求值作用域：收集抽象分支上的 early-return / throw 值；try 标记栈同边界 | `runWithLoopExits<T>(body: () => T): T` |
| `SELF` | const | 模板占位项；instantiate 时换成真实参数名 | `const SELF` |
| `serializeCheckJson` | fn | `nudo check` gate | `serializeCheckJson(r: CheckReport): CheckJson` |
| `serializeCheckJsonMulti` | fn | `nudo check` gate | `serializeCheckJsonMulti(reports: CheckJson[]): CheckJsonMulti` |
| `setAddEntry` | fn | Set#add：fork 内写 overlay；返回同一 Abs | `setAddEntry(setAbs: Abs, value: Abs): Abs` |
| `setApplyCallbackHost` | fn | B-path 宿主 `exec/call.ts` 加载时注册（副作用）。 | `setApplyCallbackHost(fn: ApplyCallbackHost): void` |
| `setBAssignCollector` | fn | 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） | `setBAssignCollector( collector: ((r: BAbsAssignRecord) => void) \| null, )` |
| `setBBindingSink` | fn | — | `setBBindingSink(sink: Map<string, unknown> \| null): void` |
| `setBCallCollector` | fn | call-site recording for analyze | `setBCallCollector( collector: ((r: BCallRecord) => void) \| null, )` |
| `setBPathFallbackCollector` | fn | — | `setBPathFallbackCollector( collector: ((f: BPathFallback) => void) \| null, ): void` |
| `setClearEntries` | fn | Set#clear | `setClearEntries(setAbs: Abs): Abs` |
| `setDeleteEntry` | fn | Set#delete：按字面量元素移除；fork overlay 内生效。 | `setDeleteEntry(setAbs: Abs, value: Abs): Abs` |
| `setElementsAbs` | fn | — | `setElementsAbs(setAbs: Abs): Abs[]` |
| `setHasEntry` | fn | — | `setHasEntry(setAbs: Abs, value: Abs): Abs` |
| `setImplicationOracle` | fn | — | `setImplicationOracle(fn: ImplicationOracle \| undefined): void` |
| `setInterfaceDiagCollector` | fn | 设置诊断观察者（null 清除）；缓冲照常累积，takeInterfaceDiags 取走 | `setInterfaceDiagCollector( fn: ((d: InterfaceDiag) => void) \| null, ): void` |
| `setPropFlags` | fn | — | `setPropFlags(o: Abs, key: string, f: PropFlags): void` |
| `setRefineDiagCollector` | fn | 设置诊断观察者（null 清除）；缓冲照常累积，takeRefineDiags 取走 | `setRefineDiagCollector(fn: ((d: RefineDiag) => void) \| null): void` |
| `setSizeAbs` | fn | — | `setSizeAbs(setAbs: Abs): Abs` |
| `shape` | fn | term / shape builders | `shape( fields: Record< string, NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined >, ): ConstraintBuilder` |
| `Shape` | type | Abs = shape × term × pred × conf | `Shape = \| { k: "never" } \| { k: "any" } \| { k: "unknown" } \| { k: "prim"; type: PrimName } \| { k: "obj"; slots: Record<string, { value: A...` |
| `shapeOfTerm` | fn | 从 term 反推 prim shape | `shapeOfTerm(t: Term): Shape` |
| `shapeOnlyFn` | fn | 仅写 shape 槽（E 路径 / §5.2 提升产物）；禁止 attachFnImpl | `shapeOnlyFn( paramTypes: Abs[], returnType: Abs, opts?: { params?: string[]; conf?: Confidence }, ): Abs` |
| `shapeToString` | fn | — | `shapeToString(s: Shape): string` |
| `shlAbs` | fn | &lt;&lt; —— 左移（rhs ToUint32 &amp; 31；bigint 不限位宽） | `shlAbs(a: Abs, b: Abs): Abs` |
| `shrAbs` | fn | &gt;&gt; —— 算术右移（rhs ToUint32 &amp; 31；bigint 不限位宽） | `shrAbs(a: Abs, b: Abs): Abs` |
| `sidecarClosureFingerprint` | fn | 侧车及递归 .nudo 依赖闭包的内容指纹：`${hashSource(侧车)}\|路径=hash,…`。 | `sidecarClosureFingerprint( fromFile: string, opts: EffectiveInterfaceOpts, ): string \| undefined` |
| `sidecarPathOf` | const | — | — |
| `simplifyTerm` | fn | 常量折叠 + 简单代数化简 | `simplifyTerm(t: Term): Term` |
| `Slot` | type | Abs = shape × term × pred × conf | `Slot = { value: Abs; optional?: boolean; readonly?: boolean }` |
| `snapshotAbs` | fn | deep-ish copy for snapshot（新对象，不是 env.vars 同一引用） | `snapshotAbs(a: Abs): Abs` |
| `spread` | fn | spread：base ⊕ over（右侧覆盖，不是 join） 未出现在 over 的 key 保留 base；over 的 key 覆盖。 | `spread(base: Abs, over: Abs): Abs` |
| `spy` | fn | test mock helpers | `spy(): MockHelper` |
| `str` | fn | Abs constructors / faces | `str(): Abs` |
| `strictEqAbs` | fn | 严格相等（Abs）：双字面量折叠；nullish 与 definitely-not-nullish → false。 | `strictEqAbs(a: Abs, b: Abs): boolean \| undefined` |
| `string` | fn | `@nudo:contract` builder grammar | `string(): ConstraintBuilder` |
| `stringOfSymbol` | fn | String(sym) → SymbolDescriptiveString（原生不抛；隐式 ToString 才抛） | `stringOfSymbol(a: Abs): Abs` |
| `stripTypes` | fn | AST TS-stripping helper | `stripTypes<T extends Node>(ast: T): T` |
| `strLit` | fn | literal Abs | `strLit(value: string): Abs` |
| `stub` | fn | test mock helpers | `stub(): MockHelper` |
| `sub` | fn | 减法：a - b = a + (-b)，数值上做单调性 | `sub(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| `substAbs` | fn | α 替换：map 的 key 是 term var id，value 是替换 Abs。 | `substAbs(a: Abs, map: ReadonlyMap<string, Abs>): Abs` |
| `substPred` | fn | 把 pred 里的 Term 用 subst 替换（用于 bound 变量重命名等） | `substPred(p: Pred, subst: (t: Term) => Term): Pred` |
| `substPredAbs` | fn | pred 三条规则： 1. | `substPredAbs( p: Pred, map: ReadonlyMap<string, Abs>, )` |
| `symbolDescriptionAbs` | const | — | — |
| `symbolIdOf` | const | — | — |
| `takeInterfaceDiags` | fn | 取走已收集的诊断（收集即清空） | `takeInterfaceDiags(): InterfaceDiag[]` |
| `takeInterfaceDiagsSince` | fn | 只取走 seq &gt; since 的诊断（清空仅限增量）——LSP 长驻进程里 lens/打印/ emit 工具用它排干**自身探测**产生的诊断，不窃取在途 validateText 待消费 的接口诊断（全量 take 曾在 await 窗口偷走 checkSource 的待收诊断）。 | `takeInterfaceDiagsSince(since: number): InterfaceDiag[]` |
| `takeLoopExits` | fn | — | `takeLoopExits(): Abs[]` |
| `takeRefineDiags` | fn | 取走已收集的诊断（收集即清空） | `takeRefineDiags(): RefineDiag[]` |
| `takeRefineDiagsSince` | fn | 只取走 seq &gt; since 的增量（工具面防窃取在途诊断；全量 take 的 since 版） | `takeRefineDiagsSince(since: number): RefineDiag[]` |
| `takeThrowExits` | fn | — | `takeThrowExits(): Abs[]` |
| `Term` | type | Abs = shape × term × pred × conf | `Term = \| { op: "lit"; value: LiteralValue } \| { op: "var"; id: string } \| { op: "app"; fn: string; args: Term[] }` |
| `termEquals` | fn | — | `termEquals(a: Term, b: Term): boolean` |
| `termToString` | fn | — | `termToString(t: Term): string` |
| `throwConstraintToKinds` | fn | fn(..., &#123; throws &#125;) / throws 约束 → 申报的 throws 类型名。 | `throwConstraintToKinds( c: NudoConstraint \| undefined, ): string[]` |
| `toNumberAbs` | fn | 一元 + —— ToNumber 折叠；bigint 原生恒抛 TypeError → 不可折叠 | `toNumberAbs(a: Abs): Abs` |
| `transpile` | fn | JS AST → `$op` program | `transpile(source: string, opts?: TranspileOptions): string` |
| `transpileBodyNode` | fn | JS AST → `$op` program | `transpileBodyNode(node: Node, opts: TranspileOptions): string` |
| `TranspiledCallResult` | type | B-path execution (analyze mode) | `TranspiledCallResult = { result: Abs; throws: Abs; }` |
| `transpileExpression` | fn | JS AST → `$op` program | `transpileExpression(expr: Expression, opts: TranspileOptions = {}): string` |
| `transpileFile` | fn | JS AST → `$op` program | `transpileFile(file: File, opts: TranspileOptions = {}): string` |
| `TranspileOptions` | type | JS AST → `$op` program | — |
| `transpileSource` | fn | JS AST → `$op` program | `transpileSource(source: string, opts: TranspileOptions = {}): string` |
| `trueConstraint` | fn | 从比较结果 Abs 提取「若为真」的额外约束（供 if 使用） | `trueConstraint(c: Abs): Pred \| undefined` |
| `tryMakeRegexAbs` | fn | new RegExp(pattern, flags) 字面量真构造验证（$new 与 evalRegExpCtor 共用）： - 无参 → /(?:)/（原生 source 归一） - pattern 非字面量（抽象/RegExp 实例）→ undefined（调用方保守） - symbol pattern / flags → TypeError（ToString 抛） - 非法 pattern / 非法 flags（含 number/null/boolean flags 的 ToString） → SyntaxError；合法 → 精确 brand（source/flags 取真构造结果） | `tryMakeRegexAbs(args: Abs[]): Abs \| undefined` |
| `tryPromoteDirectCall` | fn | 挂载点②：CallExpression callee = 形参 Identifier 直接调用 p(x) / p(a,b)。 | `tryPromoteDirectCall( env: AstEnv, calleeName: string, args: Abs[], loc?: { line: number; column: number }, ): Abs \| undefined` |
| `tryPromoteForOfIteratee` | fn | for-of 迭代对象提升（applyEach 型）：`for (const x of items)`， items 为形参且仍是 any/unknown → arr(自身 var)。不依赖方法名。 | `tryPromoteForOfIteratee( env: AstEnv, iterateeName: string, loc?: { line: number; column: number }, ): Abs \| undefined` |
| `tryPromoteHofCallback` | fn | 挂载点③：HOF 回调实参。回调是 Identifier ∈ paramNames 且尚未有 fn 形状。 | `tryPromoteHofCallback( env: AstEnv, cbName: string, method: string, argAbses: Abs[], loc?: { line: number; column: number }, ): Abs \| undefined` |
| `tryPromoteReceiverAsArr` | fn | 挂载点①：方法派发 miss。receiver 是形参 Identifier 且 shape 为 any/未知， 方法名为 filter/map/reduce/flatMap → 提升为 arr(自身 var)。 | `tryPromoteReceiverAsArr( env: AstEnv, receiverName: string, method: string, loc?: { line: number; column: number }, ): Abs \| undefined` |
| `tryRunTranspiled` | fn | B 单一入口：runTranspiled + 类型化回落观测。 | `tryRunTranspiled( source: string, opts: RunTranspiledOptions = {}, ): Record<string, unknown> \| undefined` |
| `TYPEOF_NAMES` | const | typeof 标签全集（否定展开用；顺序稳定） | `const TYPEOF_NAMES` |
| `typeofAbs` | fn | JS typeof：结果域永远是 string | `typeofAbs(a: Abs): Abs` |
| `TypeofName` | type | JS `typeof` 完整结果域（8 标签）。Pred 的 typeof 节点用此域。 | `TypeofName = \| "undefined" \| "object" \| "boolean" \| "number" \| "bigint" \| "string" \| "symbol" \| "function"` |
| `TypeParam` | type | — | `TypeParam = { id: string; value: Abs; }` |
| `undefAbs` | fn | undefined 值的统一 Abs 表示（forEach/find 等） | `undefAbs(): Abs` |
| `union` | fn | term / shape builders | `union( ...cs: (NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined)[] ): ConstraintBuilder` |
| `unknown` | const | Abs constructors / faces | `const unknown` |
| `ushrAbs` | fn | &gt;&gt;&gt; —— 逻辑右移（rhs ToUint32 &amp; 31；bigint 无此运算符 → 不可折叠） | `ushrAbs(a: Abs, b: Abs): Abs` |
| `v` | const | term / shape builders | `const v` |
| `withExecPhi` | fn | — | `withExecPhi<T>(p: Phi, body: () => T): T` |
| `withPhiConstraint` | fn | 在当前 Φ 上合取额外约束，body 结束后恢复 | `withPhiConstraint(extra: Phi, body: () => void): void` |
| `withVar` | fn | — | `withVar(env: AstEnv, name: string, value: Abs): AstEnv` |
<!-- NUDO-API-SKELETON:END -->
