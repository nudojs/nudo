# @nudojs/core — Public API Freeze Inventory

> **Status:** `@nudojs/core` is **3.0.0**. This file is the freeze inventory:
> what the package exposes, and what counts as **public** vs **internal**.
>
> **3.0 breaking reduction:** engine machinery (leak / call-budget / hash /
> derivation / inlay / template / language / scan extras / may-throw ·
> member-diag collectors) no longer ships on `.` or `./exec`. Hosts that need
> it import **`@nudojs/core/internal`**. Product faces (`check` / `test` /
> `contract` / `export` / `health` and §2 rows) are unchanged.
>
> Machine-readable twin: [`public-api.snapshot.json`](./public-api.snapshot.json) ·
> regression pin: [`src/__tests__/public-api-freeze.test.ts`](./src/__tests__/public-api-freeze.test.ts)
>
> Style reference: [`packages/lsp/PUBLIC_API.md`](../lsp/PUBLIC_API.md).

## 1. npm package surface

| Surface | Value | Stability |
|---------|-------|-----------|
| Package name | `@nudojs/core` | **public** |
| `exports["."]` | types `./dist/index.d.ts`, default `./dist/index.js` | **public** |
| `exports["./exec"]` | types `./dist/exec.d.ts`, default `./dist/exec.js` — B-path transpile + `$op` runtime | **public** |
| `exports["./internal"]` | types `./dist/internal.d.ts`, default `./dist/internal.js` — engine machinery for monorepo hosts | **internal** (minor may break) |
| `files` | `["dist"]` — no `src/*` published | **public** |
| Engines | Node `>=20` | **public** |
| Internal `src/*` deep paths | monorepo / test surface only; not an npm contract | **not public** |

Published subpaths are only `.`, `./exec`, and `./internal`.

> **Monorepo path-mapping footnote:** when a `tsconfig` maps `@nudojs/core` to
> `src`, it must also map `@nudojs/core/internal` → `packages/core/src/internal.ts`.
> Mapping only `.` while letting `./internal` resolve to `dist` loads **two**
> copies of engine machinery (e.g. may-throw collectors) and silently drops
> soft may-throw effects.

## 2. Entry points (stable product face)

Consumers (service / cli / lsp / vite-plugin) depend on these. Removing or
changing the signature of any row below is **major**.

### 2.1 Type system core (`.`)

| Symbol | Kind | Role | Stability |
|--------|------|------|-----------|
| `Abs`, `Shape`, `Term`, `Pred`, `Phi`, `Confidence`, `ObjShape`, `Slot` | type | Abs = shape × term × pred × conf | **public** |
| `abs`, `unknown`, `never`, `num`, `str`, `bool`, `any`, `anyAbs`, `anyVar` | value | Abs constructors / faces | **public** |
| `lit`, `v`, `app`, `fn`, `fnOf`, `obj`, `array`, `union`, `makeSum`, `shape` | value | term / shape builders | **public** |
| `numLit`, `strLit`, `boolLit`, `bigintLit`, `litValue`, `isExactLit` | value | literal Abs | **public** |
| `leqAbs`, `joinAbs`, `joinValues`, `confJoin` | value | assignability / join | **public** |
| `formatAbs`, `formatShape`, `formatConstraint`, `formatCheckReport` | value | extensional rendering (one-way) | **public** |
| `absToTSType`, `absToSchemaSource`, `projectAbsToSchema` | value | one-way projections | **public** |
| `checkSource`, `CheckJson`, `CheckReport`, `serializeCheckJson`, `serializeCheckJsonMulti` | value/type | `nudo check` gate | **public** |
| `generalizeFromAst`, `generalizeAll` | value | symbolic α generalization | **public** |
| `parseSource`, `resetParseSourceCache`, `getParseSourceCacheSize` | value | Babel parse + memo | **public** |
| `Environment`, `createEnvironment` | value/type | env host surface | **public** |
| `MockHelper`, `stub`, `spy`, `mock` | value/type | test mock helpers | **public** |
| `stripTypes` | value | AST TS-stripping helper | **public** |
| `ConstraintBuilder`, `number`, `string`, `boolean`, `litC()` (sidecar key `lit()`), `andC()` (sidecar key `and()`), `shape()`, `union()`, … | value/type | `@nudo:contract` builder grammar | **public** |
| `NudoConstraint`, `instantiateConstraint`, `checkArg`, `checkCall` | value/type | contract checking | **public** |
| `interfaceTierOf`, `effectiveInterface`, `EffectiveInterface`, `InterfaceTierInfo` | value/type | interface tiers | **public** |
| `refineAbsForRelTrue`, `extractRefinesFromSource` | value | refinement gate | **public** |
| `runTranspiled`, `callTranspiledExport`, `callTranspiledExportFull`, `TranspiledCallResult` | value/type | B-path execution (analyze mode) | **public** |
| `evalExprAbs` | value | Abs-native expression eval | **public** |

### 2.2 Exec runtime (`./exec` = `src/algebra/exec/index.ts`, also re-exported from `.`)

| Symbol family | Role | Stability |
|---------------|------|-----------|
| `transpile`, `transpileSource`, `transpileFile`, `transpileExpression`, `transpileBodyNode`, `runtimeImportOf`, `TranspileOptions` | JS AST → `$op` program | **public** |
| `foldStaticStringExpr`, `foldRequireSpecArg` | static folding helpers | **public** |
| `$add`…`$pow`, `$eq`…`$ge`, `$neg`/`$not`/`$typeof`, `$join` | operator runtime | **public** |
| `$fork`, `$for`, `$forIter`, `$while`, `$whileSeq`, `$switch`, `$nullishTest` | control-flow lowering | **public** |
| `$arr`, `$idx`, `$idxSet`, `$len`, `$arrMutContainer`, `$copy`, `fillTuple`, `$arrWithHoles`, `$arguments`, `isArrMutator` | array runtime | **public** |
| `$obj`, `$get`, `$set`, `$del`, `$spread`, `$objRest`, `$arrRest`, `$concat`, `$elems` | object / member runtime | **public** |
| `$fnVal`, `$rawThis`, `$lit`, `asAbsVal`, `$classExpr`, `$instanceof`, `$in` | value / class runtime | **public** |
| `$async`, `$await`, `$asyncReturn`, `$gen`, `$yield` | async / generator | **public** |
| `$throw`, `$catchVal`, `$loopReturn`, `$loopBreak`, `$loopContinue`, `NudoReturn`, `NudoLoopSignal`, `NudoThrow` | control-signal / throw | **public** |
| `$callNamed`, `$assignRecord`, `$recordBinding`, `BCallRecord`, `setBCallCollector` | call-site recording for analyze | **public** (additive) |
| `runTranspiled`, `runtimeImportOf` | execution entry | **public** |

`./exec` does **not** re-export may-throw / member-diag collectors (3.0).
Those live on `./internal`.

## 3. Internal — `@nudojs/core/internal`

Engine machinery for monorepo hosts (`service` / `lsp`). **Not** a product
face. Renames / signature changes / removals are **minor**, not major.

| Area | Modules | Notes |
|------|---------|-------|
| Leak accounting | `leak.ts` | internal budget |
| Call / fork budgets | `call-budget.ts` | `MAX_*` / collectors / truncation |
| Hash / fingerprint | `hash-source.ts`, `stable-source-key.ts`, `fn-fp.ts`, `load-deps-fp.ts` | memo keys |
| Derivation sessions | `derivation.ts` | intension / dsl projection |
| Inlay helpers | `inlay.ts` | IDE experimental wording |
| Template / denote / language | `template.ts`, `denote.ts`, `language.ts` | experimental rendering |
| Scan extras | `checkInjectedDomainEvidence`, `listTopFunctions`, … | service analyzer |
| B-path collectors | `exec/may-throw.ts`, `exec/member-diag.ts` | host plumbing, not `$op` |

Import rule: hosts use `@nudojs/core/internal`. Do not deep-import `src/*`
from published packages.

## 4. Stability tiers (summary)

| Tier | Meaning | Examples |
|------|---------|----------|
| **public** | Semver-protected. Removal / breaking signature change = **major**. | `checkSource`, `Abs`, `transpile`, `runTranspiled`, `serializeCheckJson`, contract builders |
| **public (additive)** | May gain members; existing names stay. | `CheckJson` fields, `TranspileOptions` fields, snapshot additions |
| **internal** | Engine machinery on `./internal`; may change in **minor**. | `call-budget`, `leak`, `derivation`, collectors, memo keys |
| **experimental** | No promise at all. | human-readable diagnostic wording, inlay text, template views |
| **not public** | Not an npm surface. | `src/*` deep paths, `packages/*/src` test imports |

Unconstrained entry params display as **`any`** (unconstrained), never as
`unknown` (engine debt). That display rule is **public**.

## 5. Freeze regression

`src/__tests__/public-api-freeze.test.ts`:

1. Collects export names from `src/algebra/index.ts`, `src/index.ts`, and
   `src/internal.ts` via the TypeScript compiler API.
2. Compares the sorted `value:` / `type:` name lists to
   `public-api.snapshot.json`.
3. Fails on any unplanned add / remove / rename, and on product-face leakage
   of `./internal` names into `.`.

Updating the snapshot is intentional only: edit `public-api.snapshot.json` in
the same PR as the export change and say why in the PR body. Unplanned drift
fails CI.

> **Barrel rule:** `export *` is banned on public barrels (`src/index.ts`,
> `src/algebra/index.ts`, `src/algebra/exec/index.ts`, `src/internal.ts`).
> New engine symbols go to `@nudojs/core/internal` or an explicit list
> reviewed with PUBLIC_API.md + the snapshot.

## 6. Versioning pointer

- Policy: [`docs/versioning.md`](../../docs/versioning.md)
- LSP twin: [`packages/lsp/PUBLIC_API.md`](../lsp/PUBLIC_API.md)
- Product CLI face: [`docs/design/cli-semantics.md`](../../docs/design/cli-semantics.md)
