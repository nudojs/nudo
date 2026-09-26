---
description: "@nudojs/service API — analyzeFile/analyzeFileAsync, call-record collection, module graph and dirty set, semantic tokens, d.ts/zod/guard generation, case emission."
---

# @nudojs/service

The service package provides the main programmatic API for type inference. It combines parsing, directive extraction, and evaluation to produce analysis results suitable for tooling (LSP, CLI, IDE extensions).

## analyzeFile

```typescript
analyzeFile(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: LoadModule
): AnalysisResult
```

Runs type inference on a file. Uses `filePath` for module resolution and diagnostics. `activeCases` maps function name → case index for diagnostics (e.g. which case is “active” in the IDE).

`externalCallRecords` accepts call records harvested by [`collectCallRecords`](#collectcallrecords) from usage-site files (tests, examples, upstream apps). Records that resolve to functions defined in this file are matched and injected as synthesized `call@L` cases — see the [Call-Site Discovery guide](../guides/callsite-discovery.md).

Functions without `@nudo:case` directives are not skipped: whole-program inference synthesizes a `call@L` case for each observed call site, or an `entry@L` case with **`any`** parameters when no call site is found (marked `entryOnly` on the [`FunctionAnalysis`](#functionanalysis)). Unconstrained entry params are `any`; true `unknown` means inference failed.

**Returns:** `AnalysisResult`

---

## analyzeFileAsync

```typescript
analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: LoadModule
): Promise<AnalysisResult>
```

Async entry to `analyzeFile`: preloads path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible synchronously in ESM — then runs the sync analysis, which picks the preloaded factories up from the env-loader cache. Use it from async tooling (CLI, LSP); the sync `analyzeFile` degrades when the analyzed file declares path envs.

**Returns:** `Promise<AnalysisResult>`

---

## collectCallRecords

```typescript
collectCallRecords(filePath: string, source: string): CallRecord[]
```

Phase 1 of call-site discovery: evaluates a usage-site file's top-level code and records every call it makes, with the real argument and result types observed at each call site. Test-framework callbacks (`it`, `test`, `describe`) are invoked with `unknown` parameters so call sites inside test bodies are captured — the test framework itself never runs. The pass produces no diagnostics and never throws: usage-site files may depend on unmocked globals, so collection is best-effort.

Pass the returned records to `analyzeFile`/`analyzeFileAsync` as `externalCallRecords` to have them injected as `call@L` cases. See [Call-Site Discovery — Programmatic API](../guides/callsite-discovery.md#programmatic-api) for the two-phase flow.

**Returns:** `CallRecord[]` (see [`CallRecord`](#callrecord))

---

## getTypeAtPosition

```typescript
getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>
): Abs | null
```

Returns the Abs (the lossless `shape × term × pred × conf` value) at the given source position (1-based line, 0-based column). Uses the active case index per function when position is inside a function with cases.

**Returns:** `Abs` or `null` if no type at that position.

---

## getTypeAtPositionAsync

```typescript
getTypeAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>
): Promise<Abs | null>
```

Async entry to `getTypeAtPosition` with path-env preloading (see [`analyzeFileAsync`](#analyzefileasync)).

**Returns:** `Promise<Abs | null>`

---

## getCompletionsAtPosition

```typescript
getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number
): CompletionItem[]
```

Returns completion items at the given position. Supports variable completions and property/method completions after `obj.`.

**Returns:** Array of `CompletionItem`

---

## getCasesForFile

```typescript
getCasesForFile(filePath: string, source: string): {
  functionName: string;
  cases: { name: string; index: number }[];
  loc: SourceLocation;
}[]
```

Lists all functions with `@nudo:case` directives and their case names/indices. Used for IDE case switching.

---

## isNudoTargetPath

```typescript
isNudoTargetPath(path: string): boolean
```

Extension gate shared by the CLI collector, watch mode, and the LSP `isNudoFile` check. Pure path rule (the file need not exist):

| Path | Target? |
|------|---------|
| `.js` / `.mjs` / `.ts` (case-insensitive) | **yes** |
| `.d.ts`, `.tsx`, `.jsx`, `.cjs`, `.mts`, `.cts`, other extensions | no |
| `*.nudo.{js,mjs,ts}` sidecars | no (contract modules, not implementation) |
| `*.nudo.draft.{js,mjs,ts}` | no (draft artifacts) |

---

## shouldAnalyzeFile

```typescript
shouldAnalyzeFile(
  filePath: string,
  source: string | undefined,
  config?: AnalysisConfig,
): boolean
```

Whether an **automatic** path (LSP validate, watch, Vite plugin) should run analysis on this buffer/file. Named-path CLI commands (`nudo check src/lib.js`) ignore this gate and analyze the named file.

Gate order:

1. `isNudoTargetPath` — non-targets never analyze
2. `nudo.analysis.exclude` / `include` (default exclude: `node_modules` / `dist` / `coverage`)
3. `package.json#nudo.analysis.mode` (shipped default **`"exports"`**; `DEFAULT_ANALYSIS_MODE`):
   - `"directives"` — only files with `@nudo:*` directives
   - `"exports"` (default) — directives **or** export-bearing (ESM/CJS) **or** a same-stem `*.nudo.js` sidecar
   - `"all"` — every target path that passes include/exclude

Source of truth for defaults: [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) §7. Mode semantics: [Coexistence](../guides/coexistence.md#when-to-use-modedirectives-vs-modeexports).

Related: `DEFAULT_ANALYSIS_MODE` (re-exported constant, `"exports"`), `filterDiagnosticsByLevel`, `diagnosticsLevelForFile`, `sourceHasNudoDirectives`.

---

## buildSemanticTokens

```typescript
buildSemanticTokens(
  filePath: string,
  source: string,
  opts?: { loadModule?: LoadModule; autoBind?: boolean },
): number[]
```

Produces LSP-encoded semantic tokens (5-tuples: deltaLine/deltaStartChar/length/tokenType/tokenModifiers) from the analysis result — function bindings typed as `function`, other bindings as `variable`, parameters as `parameter`. Top-level **named-export** function bindings also carry an interface-tier modifier (`contract` / `generated` / `derived`) aligned with CodeLens `● interface` via `interfaceTierOf` (A7). Non-export declarations keep `declaration` only. The LSP server's semanticTokens handler consumes this directly.

The matching legend and encoder are exported from the same module, and the LSP package re-exports them (`TOKEN_TYPES`/`TOKEN_MODIFIERS`) so the token-type indices can never drift from the extractor:

```typescript
SEMANTIC_TOKEN_TYPES: readonly string[]    // ["function", "variable", "parameter", "property",
                                           //  "type", "keyword", "string", "number", "comment",
                                           //  "decorator", "method"]
SEMANTIC_TOKEN_MODIFIERS: readonly string[] // ["declaration", "readonly", "deprecated", "unreachable",
                                           //  "contract", "generated", "derived"]

type SemanticToken = {
  line: number; char: number; length: number;
  typeIndex: number; modifierBitmask: number;
};

encodeSemanticTokens(tokens: SemanticToken[]): number[];
interfaceTierModifierBit(src: "handwritten" | "generated" | "implicit"): number;
```

`encodeSemanticTokens` delta-encodes `{ line, char, … }` tokens into the flat `number[]` the LSP expects — `buildSemanticTokens` already returns encoded output, so you only need it when building tokens yourself.

---

## buildModuleGraph

```typescript
buildModuleGraph(
  files: string[],
  cache?: ModuleGraphCache,
): {
  imports: Map<string, Set<string>>;    // file → files it imports
  dependents: Map<string, Set<string>>; // file → files importing it
}

type ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>;
```

Statically extracts each file's relative import edges — the building block for incremental analysis. Extension resolution matches module resolution (`''`, `.js`, `.ts`, `.mjs`); bare npm specifiers are skipped. Both the CLI's watch mode and the LSP's dirty propagation build a graph over their known files this way.

Pass a `cache` to keep per-file edges across rebuilds (the LSP session exports one as `moduleGraphCache`): an entry is reused when the file's `mtimeMs` **and** `size` are unchanged — a `stat`-only hit with zero disk reads and zero parsing; a miss re-reads the file and backfills the entry.

---

## computeDirtySet

```typescript
computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[]
```

Returns the changed file plus its transitive dependents (reverse-edge BFS over `dependents`). Safe in the presence of import cycles.

---

## topoSortDirty

```typescript
topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[]
```

Orders a dirty set topologically with dependencies before dependents (only import edges internal to the dirty set count; cycles are tolerated — remaining files are appended in arbitrary order). Re-analyzing in this order ensures importers see their dependencies' updated types first.

A typical incremental-analysis loop:

```typescript
const graph = buildModuleGraph(files);
const dirty = computeDirtySet(graph.dependents, changedFile);
for (const file of topoSortDirty(graph.imports, dirty)) {
  // re-read and re-analyze `file`
}
```

---

## absToTSType

```typescript
absToTSType(a: Abs): string
```

Serializes an Abs to TypeScript type syntax (e.g. `number`, `string | number`, `{ id: number; name: string }`).

---

## generateDts

```typescript
generateDts(result: AnalysisResult): string
```

Generates TypeScript declaration content (`.d.ts`) from an analysis result. Produces `declare function` signatures with real parameter names, inferred return types, and JSDoc comments.

---

## generateFunctionDtsLines

```typescript
generateFunctionDtsLines(fn: FunctionAnalysis): string[]
```

Per-function slice of [`generateDts`](#generatedts) — JSDoc plus one `export declare function` line. The CLI's `nudo export --format dts` shares this exact function with `generateDts`, so both paths emit byte-identical declarations. Functions without cases emit nothing (or a rest-args `(...args: unknown[])` line when only `combined` is known); `noDeclaration` functions (CJS `exports.X = fn`) emit nothing and stay in check/test JSON output only.

---

## absToSchemaSource

```typescript
absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string
projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): {
  source: string;
  dialect: SchemaDialect;
  dropped: string[];
}
absToSchemaNode(a: Abs): { node: SchemaNode; dropped: string[] }
```

Abs → dialect schema **source** (one-way, lossy). Intermediate `SchemaNode` carries refinements from Abs preds (numeric bounds, `int`, string length) plus `dropped` notes for unprojectable preds. Default dialect is `zod`.

**Example:**
```typescript
absToSchemaSource(numVar("x", gt(v("x"), lit(0))))
// → "z.number().gt(0)"
```

---

## absToStandardSchema / absToStandardSchemaModule

```typescript
absToStandardSchema(a: Abs, opts?: { name?: string }): { source: string; dropped: string[] }
absToStandardSchemaModule(
  exports: Record<string, Abs>,
  opts?: { banner?: string },
): { source: string; dropped: string[] }
validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult
```

Abs → **Standard Schema v1** runtime module source (`~standard`, `vendor: "nudo"`). Zero third-party validator dependency. `validate` walks the same SchemaNode refinements as schema dialect projection (bounds / int / string length). This is an ecosystem runtime path — **not** a replacement for `nudo check`.

`validateSchemaNode` is the testable semantic core; generated modules inline the same check.

---

## generateGuardFunction

```typescript
generateGuardFunction(name: string, abs: Abs): string
generateGuardFunctionFromAbs(name: string, abs: Abs): string
```

Generates a zero-dependency runtime type guard function as a string. The generated function uses `typeof`, `Array.isArray`, and property checks for validation.

**Example:**
```typescript
generateGuardFunction("isUser", obj({ name: str() }))
// → "function isUser(data) { ... }"
```

---

## Case Emission

The case-emitter functions freeze synthesized `call@L` cases into source text. The CLI's `nudo test --freeze[=update]` is a thin orchestration over them — see the [CLI guide](../guides/cli.md#nudo-test) for the workflows and merge policy.

### serializeCaseArg

```typescript
serializeCaseArg(a: Abs): string | null
```

Serializes a single Abs into expression text that the directive grammar (`parseCaseArgExpr`) can read back. Returns `null` for shapes directives cannot express: function, promise (eff), and brand values, `bigint` literals, non-finite / scientific-notation numbers, and strings/object keys containing structural characters or control characters.

**Example:**
```typescript
serializeCaseArg(num())     // → "number()"
serializeCaseArg(strLit("a")) // → '"a"'
```

### buildCaseDirective

```typescript
buildCaseDirective(name: string, argsAbs: Abs[]): string | null
```

Assembles one single-line directive ` * @nudo:case "name" (a, b)` (leading ` *`, no trailing newline) ready to be spliced into a JSDoc block. Returns `null` when any argument fails serialization or the name contains a quote or newline.

**Example:**
```typescript
buildCaseDirective("call@L2", [str()])
// → ' * @nudo:case "call@L2" (string())'
```

### stripGeneratedCaseDirectives

```typescript
stripGeneratedCaseDirectives(source: string): { source: string; removed: string[] }
```

Removes every generated `@nudo:case` directive line (name starting with the reserved `call@` prefix); a JSDoc block left with no other directives or text is removed together with its `/**` and `*/` lines. Non-case directives and plain comments are never touched. `removed` lists the deleted case names in order. This is the first half of `update` mode — note that hand-written cases named `call@…` are stripped too, since the prefix is reserved.

### insertGeneratedCaseDirectives

```typescript
insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult
```

Freezes the analysis's synthesized cases (`source === "callsite"`) into `source`: directives are inserted directly above each function declaration — into an existing JSDoc block after its `/**` line, or into a newly created block. Functions with hand-written cases or existing `call@` directives are skipped (see [`EmitResult`](#emitresult)), as are entry-only functions; cases that fail serialization are reported per function. Returns the rewritten source alongside the written/skipped report.

### unifiedDiff

```typescript
unifiedDiff(a: string, b: string, path: string): string
```

Line-level unified diff (`--- a/path` header, `@@` hunks, 3 context lines) with no third-party dependency; returns `""` when the texts are identical. Used by `--dry-run` to preview emission.

### EmitResult

```typescript
type EmitSkipReason =
  | "hand-written"            // function has non-call@ case directives
  | "already-generated"       // function already has call@ directives (add mode leaves them)
  | "entry-only"              // no call sites found — nothing worth freezing
  | "no-serializable-cases"   // no case could be expressed as directive text
  | "no-declaration"          // CJS binding/assignment function, no stable declaration
  | "skipped";                // function skipped by the analyzer itself

type EmitResult = {
  source: string;             // rewritten source (identical to input when nothing changed)
  changed: boolean;           // whether any function was written
  written: Array<{ fn: string; cases: string[] }>;
  skipped: Array<{ fn: string; reason: EmitSkipReason; detail?: string }>;
};
```

Minimal `add` / `update` flows:

```typescript
import { analyzeFileAsync, insertGeneratedCaseDirectives, stripGeneratedCaseDirectives } from "@nudojs/service";

// add: insert the synthesized cases into the source as-is
const result = await analyzeFileAsync(filePath, source, undefined, records);
const emitted = insertGeneratedCaseDirectives(source, result);

// update: strip old generated directives first, re-analyze, then insert
const stripped = stripGeneratedCaseDirectives(source);
const reanalyzed = await analyzeFileAsync(filePath, stripped.source, undefined, records);
const synced = insertGeneratedCaseDirectives(stripped.source, reanalyzed);
```

---

## Result Types

### AnalysisResult

```typescript
type AnalysisResult = {
  functions: FunctionAnalysis[];
  diagnostics: Diagnostic[];
  bindings: Map<string, BindingInfo>;
  nodeAbsMap: Map<Node, Abs>;
  caseHints: CaseHint[];
  /** functions imported from other modules, synthesized from
      cross-file call sites observed while analyzing this file */
  externalFunctions?: FunctionAnalysis[];
}
```

### FunctionAnalysis

```typescript
type FunctionAnalysis = {
  name: string;
  loc: SourceLocation;
  paramNames: string[];        // actual parameter names from AST
  cases: CaseResult[];
  combinedAbs?: Abs;          // join of case-result Abs; source of the d.ts return type
  entryOnly?: boolean;        // synthesized entry@L case, no call sites found
  skipped?: boolean;
  /** CJS-style binding/assignment functions (exports.X = fn) have no
      declaration-stable name; .d.ts generation skips them while
      check/test JSON output still reports them */
  noDeclaration?: boolean;
  /** absolute path of the module this function is imported from
      (externalFunctions only) */
  fromModule?: string;
}
```

### CaseResult

```typescript
type CaseResult = {
  name: string;
  argAbs: Abs[];              // lossless argument Abs
  abs: Abs;                   // lossless result Abs
  throwsAbs: Abs;             // lossless thrown Abs (never when no throw)
  throwLoc?: SourceLocation;
  source?: "directive" | "callsite"; // "callsite" = synthesized from an observed call site;
                                     // hand-written cases and entry@ fallbacks leave it unset
  expected?: Abs;             // `@nudo:case "name" (…) => expected` — presence marks a test assertion
  aggregatedFrom?: number;    // additional call sites folded into a symbolic case
  intension?: {               // intensional summary (algebra generalize)
    display?: string; term?: string; pred?: string; conf?: string;
    abs?: string;             // lossless Abs, single line (formatAbs)
    absMultiline?: string;
  };
}
```

### CallRecord

One observed call at a usage site, harvested by [`collectCallRecords`](#collectcallrecords):

```typescript
type CallRecord = {
  fnName: string;             // callee name observed at the call site
  argAbs: Abs[];              // lossless argument Abs as observed
  resultAbs: Abs;             // observed result Abs (never when the call threw)
  throwsAbs: Abs;             // observed thrown Abs (never when no throw)
  callLoc?: { line: number; column: number }; // call position; line becomes the call@L case name
  targetModule?: string;      // module the callee was bound from
  targetExport?: string;      // export name the callee was bound as
  targetAliases?: string[];   // later re-export names (barrels, CJS forwarding shims)
  fnModule?: string;          // module whose evaluation created the function value (definition site)
}
```

The `targetModule`/`targetExport`/`fnModule` fields drive the attribution gate: a record only matches files its module actually points at, so same-named helpers in test files cannot smear their records across unrelated files. See [Call-Site Discovery — Safety Design](../guides/callsite-discovery.md#safety-design).

### CaseInfo

```typescript
type CaseInfo = {
  functionName: string;
  caseName: string;
  caseIndex: number;
}
```

Addresses a single case of a single function by name and index.

### CaseHint

```typescript
type CaseHint = {
  line: number;
  label: string;
  ok: boolean;
}
```

Inline hint (line, label, pass/fail) rendered by IDE integrations next to directives.

### Diagnostic

```typescript
type Diagnostic = {
  range: SourceLocation;
  severity: DiagnosticSeverity;   // "error" | "warning" | "info"
  message: string;
  tags?: DiagnosticTag[];         // e.g. ["unnecessary"]
  code?: string;                  // e.g. "nudo:unknown-recv", "nudo:mock-invalid", "nudo-unreachable"
  suggestions?: string[];
  data?: unknown;                 // additional context for code actions
  /** provenance of the receiver value (callsite argument that flowed into the error) */
  origin?: { line: number; column: number };
}
```

`DiagnosticSeverity` is `"error" | "warning" | "info"`; `DiagnosticTag` is currently `"unnecessary"`.

### SourceLocation

```typescript
type SourceLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
}
```

### BindingInfo

```typescript
type BindingInfo = {
  abs: Abs;
  loc?: SourceLocation;
}
```

Type (and optional location) of a top-level binding, keyed by name in `AnalysisResult.bindings`.

### CompletionItem

```typescript
type CompletionItem = {
  label: string;
  kind: "property" | "method" | "variable";
  detail?: string;
}
```

### SymbolInfo / ReferenceInfo / SymbolTable

```typescript
type SymbolInfo = {
  name: string;
  kind: "function" | "variable" | "class" | "parameter";
  loc: SourceLocation;
  uri?: string;
}

type ReferenceInfo = {
  name: string;
  loc: SourceLocation;
  uri?: string;
}

type SymbolTable = {
  definitions: Map<string, SymbolInfo>;
  references: ReferenceInfo[];
}
```

Definitions and references for go-to-definition / find-references tooling; the LSP package builds tables of this shape over its open documents.

## Export inventory

<!-- NUDO-API-SKELETON:BEGIN -->
> Generated by `pnpm run docs:gen:api` from package export surfaces (`PUBLIC_API.md` / `src/index.ts`) — do not edit this block. Regenerate with `node scripts/gen-api-docs.mjs`.

Includes the `@nudojs/service` (`src/index.ts`) face and public emit faces re-exported from `@nudojs/service/emit`.

| Name | Kind | Summary | Signature |
|------|------|------|------|
| `AbsGraphOptions` | type | — | `AbsGraphOptions = { loadModule?: AbsLoadModule; seedVars?: Record<string, Abs>; seedFns?: Record<string, { params: string[]; body: Node; ...` |
| `AbsMockSeeds` | type | — | `AbsMockSeeds = { seedVars: Record<string, Abs>; seedFns: Record<string, { params: string[]; body: Node; async?: boolean; fingerprint?: st...` |
| `AbsModuleCacheEntry` | type | 会话级依赖模块缓存条目：stat 指纹 + 导出 + 子树装载 issue。 | `AbsModuleCacheEntry = { mtimeMs: number; size: number; exports: AbsModuleExports; issues: AbsModuleLoadIssue[]; }` |
| `AbsModuleGraphResult` | type | — | `AbsModuleGraphResult = { modules: Record<string, AbsModuleExports>; byPath: Map<string, AbsModuleExports>; issues: AbsModuleLoadIssue[]; }` |
| `AbsModuleLoadIssue` | type | 模块加载守卫：与 TypeValue loadModuleEnv 口径对齐，供 analyzer 映射诊断 | `AbsModuleLoadIssue = { kind: "cycle" \| "depth" \| "missing"; label: string; reason: string; }` |
| `absToSchemaNode` | fn | Abs → SchemaNode + dropped（优先 core absToConstraint；失败则 shape 尽力） | `absToSchemaNode(a: Abs)` |
| `absToSchemaSource` | fn | — | `absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string` |
| `absToStandardSchema` | fn | 便捷：单个 Abs → 单导出模块（默认导出名 `schema`）。 | `absToStandardSchema( a: Abs, opts?: { name?: string }, ): StandardSchemaModuleProjection` |
| `absToStandardSchemaModule` | fn | Abs → Standard Schema v1 模块源码。 | `absToStandardSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): StandardSchemaModuleProjection` |
| `absToTSType` | fn | Abs → TS 类型串。有损：pred / 非 lit term 落到 shape 基类型。 | `absToTSType(a: Abs, typeVars?: Map<string, string>): string` |
| `absToZodSchemaModule` | fn | Abs 导出表 → 可 import 的 zod JS 模块源码。 | `absToZodSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): ZodModuleProjection` |
| `ambientSourcesOfSidecar` | fn | `lib.nudo.js\|ts` → candidate ambient sources next to it | `ambientSourcesOfSidecar(sidecarPath: string): string[]` |
| `ANALYSIS_ABI` | const | 带包版本：升级 @nudojs/* 后旧 CheckJson 不得继续命中。 | `const ANALYSIS_ABI` |
| `analysisConfig` | fn | 归一化 `nudo.analysis`。默认 mode=exports（A1：无指令但有 export/侧车的文件 进 IDE 分析；`all` / `directives` 需显式配置）。 | `analysisConfig(config: NudoConfig \| null \| undefined): AnalysisConfig` |
| `AnalysisConfig` | type | — | `AnalysisConfig = { include: string[]; exclude: string[]; mode: AnalysisMode; diagnostics: DiagnosticsLevel; callSiteBudget: number; evalM...` |
| `analysisFileCacheKey` | fn | — | `analysisFileCacheKey( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], analysisCfg?: { mode: string; evalMissingSlot: string; callSiteBudget: number; diagnostics: string }, loadModule?: AnalyzeLoadModule, projectEnvNames?: string[], autoBind?: boolean, caseMode: DirectiveCaseMode = "all", )` |
| `AnalysisMode` | type | — | `AnalysisMode = "directives" \| "exports" \| "all"` |
| `AnalysisResult` | type | — | `AnalysisResult = { functions: FunctionAnalysis[]; diagnostics: Diagnostic[]; bindings: Map<string, BindingInfo>; nodeAbsMap: Map<Node, Ab...` |
| `AnalysisSession` | type | — | `AnalysisSession = { evictForDependents(files: string[]): void; clear(): void; reset(): void; analyze( filePath: string, source: string, a...` |
| `analyzeExportsFromSource` | fn | 分析单文件导出 + 内涵签名（source 由 host 提供） | `analyzeExportsFromSource( filePath: string, source: string, ): ModuleExports` |
| `analyzeFile` | fn | 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。 | `analyzeFile( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): AnalysisResult` |
| `analyzeFileAsync` | fn | Async entry to analyzeFile: preloads path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible synchronously in ESM — then runs the sync analysis, which picks the preloaded factories up from the env-loader cache. | `analyzeFileAsync( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): Promise<AnalysisResult>` |
| `applyBForkBudgetFromConfig` | fn | 把 fork 预算写进 core（core 保持无 IO）。 | `applyBForkBudgetFromConfig( config: NudoConfig \| null \| undefined, env: NodeJS.ProcessEnv = process.env, ): number` |
| `applyMockModuleDirectives` | fn | Overlay `@nudo:mock-module` directives onto a modules map. | `applyMockModuleDirectives( base: Record<string, AbsModuleExports>, fileDirectives: FileDirective[], opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| `applyMockModuleDirectivesFromSource` | fn | Source string → apply mock-module (CLI / one-shot hosts). | `applyMockModuleDirectivesFromSource( source: string, base: Record<string, AbsModuleExports>, opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| `applySessionCacheConfig` | fn | 接线 package.json#nudo.sessionCache（进程内 LRU 上限）并立刻 trim。 | `applySessionCacheConfig(config: NudoConfig \| null \| undefined): SessionCacheLimits` |
| `BindingInfo` | type | — | `BindingInfo = { abs: Abs; loc?: SourceLocation; }` |
| `BPathBuiltinUnknown` | type | — | `BPathBuiltinUnknown = { name: string; range: BPathLoc }` |
| `BPathDiagnostics` | type | — | `BPathDiagnostics = { unreachable: BPathUnreachable[]; builtinUnknown: BPathBuiltinUnknown[]; }` |
| `BPathRunResult` | type | — | `BPathRunResult = { exports: Record<string, unknown>; modules: Record<string, AbsModuleExports>; memberDiags?: BMemberDiag[]; moduleIssues...` |
| `BPathUnreachable` | type | — | `BPathUnreachable = { range: BPathLoc }` |
| `buildCaseDirective` | fn | 组装单行 ` * @nudo:case "name" (a, b)` 指令文本（无尾换行）。 | `buildCaseDirective(name: string, argsAbs: Abs[]): string \| null` |
| `buildModuleGraph` | fn | Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). | `buildModuleGraph( files: string[], cache?: ModuleGraphCache, )` |
| `CallRecord` | type | — | — |
| `CaseHint` | type | — | `CaseHint = { line: number; label: string; ok: boolean; }` |
| `CaseJson` | type | — | `CaseJson = { version: 1; file: string; summary: { functions: number; externalFunctions: number; cases: number; diagnostics: number; }; fu...` |
| `CaseJsonCase` | type | — | `CaseJsonCase = { name: string; args: string[]; result: string; throws: string \| null; source: string \| null; aggregatedFrom?: number; arg...` |
| `CaseJsonFunction` | type | — | `CaseJsonFunction = { name: string; loc: SourceLocation; entryOnly: boolean; noDeclaration?: boolean; cases: CaseJsonCase[]; combined?: st...` |
| `CaseResult` | type | — | `CaseResult = { name: string; argAbs: Abs[]; abs: Abs; throwsAbs: Abs; throwLoc?: SourceLocation; source?: "directive" \| "callsite"; expec...` |
| `checkCacheKey` | fn | check 报告键：abi + 相对路径 + 源码 sha + autoBind + **侧车 sha** + **@nudo:import / 传递契约依赖内容 sha**（依赖变更必须 miss）。 | `checkCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarContent?: string \| null; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; analysisCfg?: { mode?: string; evalMissingSlot?: string; callSiteBudget?: number; entryThrows?: string; ignoreThrows?: string; }; }, ): string` |
| `checkConfig` | fn | package.json#nudo.check → 执法选项 | `checkConfig(config: NudoConfig \| null \| undefined): CheckConfig` |
| `CheckConfig` | type | — | `CheckConfig = { entryThrows: "error" \| "warning" \| "off"; ignoreThrows: string[]; }` |
| `clearAbsModuleCache` | fn | — | `clearAbsModuleCache(): void` |
| `clearAnalysisFileCache` | fn | — | `clearAnalysisFileCache(): void` |
| `clearAnalysisSessionCaches` | fn | 清空全部会话级分析缓存（service + core）。 | `clearAnalysisSessionCaches(): void` |
| `clearBPathCache` | fn | — | `clearBPathCache(): void` |
| `clearEnvPathDeps` | fn | — | `clearEnvPathDeps(): void` |
| `clearFnAnalysisCache` | fn | — | `clearFnAnalysisCache(): void` |
| `clearPathEnvCaches` | fn | Host cache-clear hooks (CLI watch / vite / tests) must drop path-env modules too | `clearPathEnvCaches(): void` |
| `collectAbsBindingsFromGraph` | fn | 收集顶层绑定名 → Abs（含相对 import / 裸包 harvest 注入）。 | `collectAbsBindingsFromGraph( source: string, filePath: string, opts: AbsGraphOptions = {}, ): Map<string, Abs>` |
| `collectBPathDiagnostics` | fn | 静态收集 B 路径诊断。 | `collectBPathDiagnostics( source: string, extraKnown?: Iterable<string>, ): BPathDiagnostics` |
| `collectBPathReplacements` | fn | 收集 @nudo:replace + @nudo:as → transpile 注入表 | `collectBPathReplacements(source: string)` |
| `collectCallRecords` | fn | 调用点发现（阶段一）：在"使用现场"文件（测试 / 上层应用）中求值 顶层代码，收集它对（外部模块导出的）函数的调用记录。每条记录带 真实的实参类型与结果类型——后续 analyzeFile 将其注入合成 case， 使被使用方从 entry-only（参数全 unknown）升级为真实调用形态。 | `collectCallRecords(filePath: string, source: string): CallRecord[]` |
| `collectDependencySpecs` | fn | 从 AST 收集静态相对依赖（ESM import + CJS require） | `collectDependencySpecs(ast: File): string[]` |
| `collectEnvGlobals` | fn | — | `collectEnvGlobals(envNames: string[]): Record<string, Abs>` |
| `collectEnvModules` | fn | — | `collectEnvModules(envNames: string[]): Record<string, AbsModuleExports>` |
| `collectEnvNames` | fn | — | `collectEnvNames(filePath: string, source: string, includeProject: boolean): string[]` |
| `collectLoadDepContents` | fn | — | `collectLoadDepContents( filePath: string, source: string, loadModule: (spec: string, fromFile: string) => string \| undefined, )` |
| `collectParamBodyAccesses` | fn | Draft-only：收集每个顶层函数形参上的成员读取键（`user.name` → name）。 | `collectParamBodyAccesses( source: string, ): Map` |
| `collectSkipReturns` | fn | 每个带 `@nudo:skip` 的顶层函数 → 声明的返回 Abs；`null` = 未声明返回类型。 | `collectSkipReturns(source: string): Map<string, Abs \| null>` |
| `collectStaticImports` | fn | 从入口文件沿静态相对 import/require 收集（仅类型事实，不是运行时加载器）。 | `collectStaticImports( entryFile: string, maxDepth = 8, ): Map<string, ModuleExports>` |
| `CompletionItem` | type | — | `CompletionItem = { label: string; kind: "property" \| "method" \| "variable"; detail?: string; }` |
| `computeDirtySet` | fn | changed plus its transitive dependents (reverse-edge BFS); cycle-safe via visited. | `computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[]` |
| `ConstraintSourceExpr` | type | — | `ConstraintSourceExpr = { expr: string; importFrom?: string; importName?: string; }` |
| `constraintToSchemaNode` | fn | NudoConstraint → SchemaNode（与 absToConstraint 投影语义对齐） | `constraintToSchemaNode(c: NudoConstraint): SchemaNode` |
| `currentBForkBudgetLimit` | fn | 当前生效 fork 上限（调试/测试；与 core getBForkBudgetLimit 同源） | `currentBForkBudgetLimit(): number` |
| `DEFAULT_ANALYSIS_MODE` | const | ", ]; /** A1 产品默认：exports — 普通带导出的 .js 进 IDE；directives/all 需显式 | `const DEFAULT_ANALYSIS_MODE` |
| `DEFAULT_SESSION_CACHE_LIMITS` | const | 保守默认：多项目共存时不悄悄吃内存（大仓请显式调高） | `const DEFAULT_SESSION_CACHE_LIMITS` |
| `defaultAbsLoadModule` | fn | 相对说明符 → 源码 | `defaultAbsLoadModule(spec: string, fromFile: string): string \| undefined` |
| `defaultLoadModule` | fn | 默认 loadModule：支持 .js/.mjs/.ts 与 index 入口 | `defaultLoadModule(spec: string, fromFile: string): string \| undefined` |
| `DepContent` | type | — | `DepContent = { path: string; content: string \| null }` |
| `DerivedExport` | type | — | `DerivedExport = { file: string; fn: string; paramNames: string[]; params: DerivedParam[]; returns?: { constraint: NudoConstraint; dsl: st...` |
| `DerivedParam` | type | — | `DerivedParam = { name: string; constraint: NudoConstraint; dsl: string; prelude: string[]; imports: Array<{ name: string; from: string }>...` |
| `deriveFromRoot` | fn | 入口：对 filePath 做 root 驱动下行推导。 | `deriveFromRoot( filePath: string, opts: RootDeriveOpts = {}, ): RootDeriveResult` |
| `detectEntryVariantsFromPackageJson` | fn | Detect browser/node dual faces in a parsed package.json. | `detectEntryVariantsFromPackageJson(pkg: unknown): EntryVariantFaces \| null` |
| `Diagnostic` | type | — | `Diagnostic = { range: SourceLocation; severity: DiagnosticSeverity; message: string; tags?: DiagnosticTag[]; code?: string; suggestions?:...` |
| `DiagnosticSeverity` | type | — | `DiagnosticSeverity = "error" \| "warning" \| "info"` |
| `DiagnosticsLevel` | type | — | `DiagnosticsLevel = "off" \| "errors" \| "default" \| "verbose"` |
| `diagnosticsLevelForFile` | fn | — | `diagnosticsLevelForFile(filePath: string): DiagnosticsLevel` |
| `DiagnosticTag` | type | — | `DiagnosticTag = "unnecessary"` |
| `DirectiveCaseMode` | type | `@nudo:case` 求值档： - `none`（默认）：不跑 case；有 case 的函数也走 entry@ 出签名（check / IDE） - `all`：逐 case 真跑（`nudo test` / CaseJson / freeze） - `selected`：只跑 `activeCases` 选中的那条（LSP selectCase） | `DirectiveCaseMode = "none" \| "all" \| "selected"` |
| `DiskCache` | fn | — | `DiskCache { private readonly root: string \| undefined; private readonly ns: string; enabled = false; constructor(opts: DiskCacheOptions) ...` |
| `DiskCacheOptions` | type | — | `DiskCacheOptions = { root?: string \| undefined; namespace: string; }` |
| `diskCacheRoot` | fn | 磁盘缓存根（B3）：config.cache / NUDO_CACHE_DIR / 默认关 | `diskCacheRoot( config: NudoConfig \| null \| undefined, projectDir: string \| undefined, ): string \| undefined` |
| `DraftEvidence` | type | DraftEvidence `body` = 仅来自函数体对形参的成员读取（草稿建议，非义务）。 | `DraftEvidence = "callsite" \| "directive" \| "symbolic" \| "body" \| "none"` |
| `draftInterface` | fn | 为单文件顶层导出生成 interface 草稿（不写盘）。 | `draftInterface( filePath: string, opts: InterfaceDraftOpts = {}, ): Promise<InterfaceDraftResult>` |
| `emitDerivedFromRoot` | fn | — | `emitDerivedFromRoot( rootFile: string, opts: { fnNames?: string[]; mode: "add" \| "update"; dryRun?: boolean; loadModule?: LoadModule; autoBind?: boolean; refreshExistingOnly?: boolean; }, ): EmitDerivedResult` |
| `EmitDerivedResult` | type | — | `EmitDerivedResult = { sidecars: Array<{ file: string; sidecarPath: string; fn: string; written: boolean; changed: boolean; skipped?: "nam...` |
| `emitInterface` | fn | 单文件 emit：分析 → 逐目标投影/自检 → 组装侧车内容 →（非 dryRun）写盘。 | `emitInterface( filePath: string, opts: EmitInterfaceOpts, ): Promise<EmitInterfaceResult>` |
| `EmitInterfaceOpts` | type | — | `EmitInterfaceOpts = { fnNames?: string[]; mode: "add" \| "update"; all?: boolean; dryRun?: boolean; records?: CallRecord[]; source?: strin...` |
| `EmitInterfaceResult` | type | — | `EmitInterfaceResult = { written: string[]; skipped: Array<{ fn: string; reason: EmitInterfaceSkipReason }>; changed: boolean; diff?: stri...` |
| `EmitInterfaceSkipReason` | type | — | `EmitInterfaceSkipReason = \| "name-clash" \| "not-projectable" \| "not-an-export" \| "no-change" \| "emit-denied" \| "multi-declarator"` |
| `EmitResult` | type | — | `EmitResult = { source: string; changed: boolean; written: Array<{ fn: string; cases: string[] }>; skipped: Array<{ fn: string; reason: Em...` |
| `EmitSkipReason` | type | — | `EmitSkipReason = \| "hand-written" \| "already-generated" \| "entry-only" \| "no-serializable-cases" \| "no-declaration" \| "skipped"` |
| `entryVariantForFile` | fn | Dual-entry info for an analyzed file: the owning package must declare two differing faces **and** this file must be one of the entry targets. | `entryVariantForFile(filePath: string): EntryVariantInfo \| null` |
| `EntryVariantInfo` | type | — | `EntryVariantInfo = { pkgPath: string; pkgDir: string; pkgName?: string; kind: "exports-conditions" \| "browser-field"; browserPaths: strin...` |
| `EntryVariantIssue` | type | Host-facing info issue (CLI check / JSON) for one analyzed entry variant. | `EntryVariantIssue = { severity: "info"; code: "nudo:dual-entry"; message: string; suggestion: string; line: number; column: number; }` |
| `entryVariantIssueForFile` | fn | — | `entryVariantIssueForFile(filePath: string): EntryVariantIssue \| null` |
| `EnvHarvestConflict` | type | Conflict when handwritten env overwrote a harvest module/export (B8). | `EnvHarvestConflict = { module: string; exports: string[]; defaultOverwritten: boolean; }` |
| `envPathDependents` | fn | 依赖该 env 模板的源文件列表 | `envPathDependents(envPath: string): string[]` |
| `evalAbsModuleGraph` | fn | 递归求值相对依赖 + 裸包 harvest，产出入口可用的 modules 表。 | `evalAbsModuleGraph( entrySource: string, entryFile: string, opts: AbsGraphOptions = {}, ): AbsModuleGraphResult` |
| `evictAbsModuleCacheFiles` | fn | — | `evictAbsModuleCacheFiles(paths: string[]): void` |
| `evictAnalysisCachesForFiles` | fn | 依赖内容变更后：按入口文件定向逐出 service 层缓存。 | `evictAnalysisCachesForFiles(files: string[]): void` |
| `evictAnalysisFileCacheForFiles` | fn | 依赖变更后：按入口文件逐出 | `evictAnalysisFileCacheForFiles(files: string[]): number` |
| `evictBPathCacheForFiles` | fn | 依赖文件变更后：逐出以这些文件为入口的 B-path 缓存 | `evictBPathCacheForFiles(files: string[]): number` |
| `evictFnAnalysisCacheForFiles` | fn | Dependency content changed: drop every per-fn entry for these entry files. | `evictFnAnalysisCacheForFiles(files: string[]): number` |
| `extractFnConstraintSources` | fn | — | `extractFnConstraintSources( sidecarSrc: string, fnName: string, )` |
| `extractNudoImportSpecs` | fn | 从源码提取 `@nudo:import` / `@nudo:import * as` 的 specifier | `extractNudoImportSpecs(source: string): string[]` |
| `filterDiagnosticsByLevel` | fn | 按 analysis.diagnostics 档过滤 evaluator/check **显示路径**诊断。 | `filterDiagnosticsByLevel<T extends { severity: string; code?: string }>( diags: T[], level: DiagnosticsLevel, ): T[]` |
| `findOwningPackage` | fn | Nearest package.json walking up from the file's directory. | `findOwningPackage( fromFile: string, )` |
| `findProjectConfig` | fn | — | `findProjectConfig( startDir: string, )` |
| `formatDerivedSection` | fn | 组装生成段（组合式 + import + prelude）。 | `formatDerivedSection( row: DerivedExport, opts: { rootSidecarDir: string; targetSidecarDir: string; takenNames?: Iterable<string>; }, )` |
| `formatDraftModule` | fn | 草稿模块文本（人读 + 可复制到 *.nudo.js / *.nudo.ts） | `formatDraftModule( filePath: string, entries: InterfaceDraftEntry[], sidecarPath?: string, ): string` |
| `formatDraftSummary` | fn | — | `formatDraftSummary( sourceRel: string, draftRel: string, result: InterfaceDraftResult, write?: WriteDraftResult, ): string[]` |
| `formatEmitSummary` | fn | emit 摘要行（CLI runInterfaceEmit 与 LSP agent 面共用；路径由调用方按 展示口径传入——CLI 传 cwd 相对、agent 传绝对路径）。 | `formatEmitSummary( sourcePath: string, sidecarRel: string, result: EmitInterfaceResult, ): string[]` |
| `formatInterfaceSurfaceLine` | fn | 单条 interface 打印行（CLI runInterface 与 LSP agent 面共用） | `formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string` |
| `FunctionAnalysis` | type | — | `FunctionAnalysis = { name: string; loc: SourceLocation; paramNames: string[]; formals?: FormalParam[]; cases: CaseResult[]; combinedAbs?:...` |
| `generateDts` | fn | — | `generateDts(result: AnalysisResult): string` |
| `generateFunctionDtsLines` | fn | 为单个函数生成 .d.ts 声明行（JSDoc + 单一 widen 主签名）。 | `generateFunctionDtsLines(fn: FunctionAnalysis): string[]` |
| `generateGuardFunction` | fn | 兼容别名：Abs 路径唯一 | `generateGuardFunction(name: string, abs: Abs): string` |
| `generateGuardFunctionFromAbs` | fn | Abs 指称守卫（设计 §2.7）：保留 pred | `generateGuardFunctionFromAbs(name: string, abs: Abs): string` |
| `getAbsModuleCacheSize` | fn | 测试/诊断：当前条目数（≤ ABS_MODULE_CACHE_MAX） | `getAbsModuleCacheSize(): number` |
| `getAnalysisFileCacheSize` | fn | — | `getAnalysisFileCacheSize(): number` |
| `getAnalysisSession` | fn | 进程内默认 AnalysisSession（LSP server / CLI watch / agent tools 共用） | `getAnalysisSession(): AnalysisSession` |
| `getBPathCacheSize` | fn | 测试/诊断：当前 B-path run 缓存条目数（≤ getSessionCacheLimits().maxBRuns） | `getBPathCacheSize(): number` |
| `getEnvHarvestConflictCollector` | fn | Read-only peek for tests / nested restore. | `getEnvHarvestConflictCollector()` |
| `getEnvPathDepsSize` | fn | 测试/诊断：反向依赖驻留规模 | `getEnvPathDepsSize(): number` |
| `getFnAnalysisCacheSize` | fn | 测试/诊断：当前条目数（≤ getSessionCacheLimits().maxFns） | `getFnAnalysisCacheSize(): number` |
| `getPathEnvCacheSizes` | fn | 测试/诊断：path-env 驻留规模（均 ≤ 对应上限） | `getPathEnvCacheSizes()` |
| `getSessionCacheLimits` | fn | — | `getSessionCacheLimits( env: NodeJS.ProcessEnv = process.env, ): SessionCacheLimits` |
| `ifaceCacheKey` | fn | effectiveInterface 表键（L1 Phase B，design-persistent-cache）。 | `ifaceCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarSource?: string \| undefined; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; }, ): string` |
| `injectBindings` | fn | — | `injectBindings( source: string, bindings: TypeBinding[], )` |
| `insertGeneratedCaseDirectives` | fn | 把 analysis 中的合成 case（source === "callsite"）固化为源码指令： 1. | `insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult` |
| `interfaceConfig` | fn | 归一化 `nudo.contract` 配置段。 | `interfaceConfig(config: NudoConfig \| null \| undefined): InterfaceConfig` |
| `InterfaceConfig` | type | — | `InterfaceConfig = { autoBind: boolean; emit: string[]; }` |
| `InterfaceDraftEntry` | type | — | `InterfaceDraftEntry = { fn: string; params: Array<{ name: string; constraint?: NudoConstraint; display: string; projected: boolean; bodyA...` |
| `InterfaceDraftOpts` | type | — | `InterfaceDraftOpts = { fnNames?: string[]; records?: CallRecord[]; loadModule?: LoadModule; autoBind?: boolean; bodyAccesses?: boolean; s...` |
| `InterfaceDraftResult` | type | — | `InterfaceDraftResult = { file: string; entries: InterfaceDraftEntry[]; draftSource: string; sidecarPath: string; }` |
| `interfaceSurface` | fn | 单文件 interface 表面：analyzer 推断结果给出函数清单与 implicit 展示， effectiveInterface 给出契约命中（手写 &gt; 生成段）。诊断 side-channel 在收尾时取走丢弃——打印命令不执法，interface-load 等错误留给 check 路径。 | `interfaceSurface( filePath: string, opts: InterfaceSurfaceOpts = {}, ): Promise<InterfaceSurfaceEntry[]>` |
| `InterfaceSurfaceEntry` | type | — | `InterfaceSurfaceEntry = { fn: string; kind: "export" \| "local"; source: "handwritten" \| "generated" \| "implicit"; params: Array<{ name: s...` |
| `InterfaceSurfaceOpts` | type | — | `InterfaceSurfaceOpts = { autoBind?: boolean; loadModule?: LoadModule; records?: CallRecord[]; source?: string; }` |
| `isBPathCapable` | fn | 可走 transpile+exec 的快速预判（env 经 loadEnvs 内置 + 已 preload 的路径型）。 | `isBPathCapable(source: string, envNames: string[] = []): boolean` |
| `isDraftableEntry` | fn | Parse-layer draftable: at least one entry has generated DSL and was not skipped | `isDraftableEntry(entries: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>): boolean` |
| `isEnvTemplatePath` | fn | watch 门禁：env 模板变更必须可被接收（即便扩展名不进 isNudoTargetPath） | `isEnvTemplatePath(path: string): boolean` |
| `isNudoTargetPath` | fn | nudo 推断目标文件判定（纯扩展名规则，路径无需存在）。 | `isNudoTargetPath(path: string): boolean` |
| `isProjectConfigPath` | fn | — | `isProjectConfigPath(path: string): boolean` |
| `isSidecarPath` | fn | Formal sidecar contracts only — drafts never ambient-bind and need not reanalyze | `isSidecarPath(path: string): boolean` |
| `isWatchRelevantPath` | fn | Watch accept gate: analysis targets + sidecar/config/env-template invalidators | `isWatchRelevantPath(path: string): boolean` |
| `LoadModule` | type | — | `LoadModule = (spec: string, fromFile: string) => string \| undefined` |
| `locFromNode` | fn | — | `locFromNode(node: Node): SourceLocation` |
| `matchesEmitAllowlist` | fn | 极简 glob（`**` / `*` / `?`）：相对 projectDir 匹配**源文件**绝对路径 （不是侧车路径；侧车随源文件同目录写出）。无白名单 → true。 | `matchesEmitAllowlist( absPath: string, projectDir: string \| undefined, patterns: string[], ): boolean` |
| `MergeHarvestOptions` | type | — | `MergeHarvestOptions = { onConflict?: (c: EnvHarvestConflict) => void; }` |
| `mergeHarvestUnderEnv` | fn | Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping module keys and overlapping export names (docs/versioning.md B8 + website harvester API). | `mergeHarvestUnderEnv( harvestModules: Record<string, AbsModuleExports>, envModules: Record<string, AbsModuleExports>, opts?: MergeHarvestOptions, ): Record<string, AbsModuleExports>` |
| `mockDirectivesToAbsSeeds` | fn | 从函数上的 @nudo:mock 指令收集 Abs seed | `mockDirectivesToAbsSeeds( functions: Array<{ directives: FunctionWithDirectives["directives"] }>, opts?: { fromFile?: string; loadModule?: LoadModule; }, ): AbsMockSeeds` |
| `MockModuleApplyResult` | type | — | `MockModuleApplyResult = { modules: Record<string, AbsModuleExports>; errors: FromMockError[]; applied: boolean; }` |
| `mockSeedsForSource` | fn | 便捷入口：源码 → @nudo:mock 的 B 注入 Abs 绑定（checkSource 注入管线用） | `mockSeedsForSource( source: string, opts?: { fromFile?: string; loadModule?: LoadModule }, ): Record<string, Abs>` |
| `mockSeedsToAbsMocks` | fn | B 路径注入用：seedVars + seedFns 统一为 Abs 函数绑定。 | `mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs>` |
| `ModuleExports` | type | — | `ModuleExports = { path: string; named: Map<string, string>; defaultExport?: string; source: string; poly: Map<string, PolyFn>; }` |
| `ModuleGraphCache` | type | mtime 边缓存：key 为文件路径，edges 为已抽取的相对 import 边（与 buildModuleGraph 返回语义一致）。 | `ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>` |
| `noteEnvPathDeps` | fn | 源码里的 path-based load specs 解析为绝对路径后登记反向边 | `noteEnvPathDeps(sourcePath: string, source: string): void` |
| `NudoConfig` | type | — | `NudoConfig = { env?: string[]; mocks?: Record<string, string>; contract?: { autoBind?: boolean; emit?: string[] \| string; }; analysis?: {...` |
| `projectAbsToSchema` | fn | — | `projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): SchemaProjection` |
| `ReferenceInfo` | type | — | `ReferenceInfo = { name: string; loc: SourceLocation; uri?: string; }` |
| `relativizePath` | fn | 相对化路径，避免绝对路径进磁盘键；树外路径用稳定内容 hash | `relativizePath(p: string, root?: string): string` |
| `resetAllAnalysisCaches` | fn | 比 clearAnalysisSessionCaches 更彻底：再丢 AST LRU（测试 / 进程复用场景） | `resetAllAnalysisCaches(): void` |
| `resetSessionCacheLimitState` | fn | 测试：丢弃 env 惰性缓存，重新读 process.env | `resetSessionCacheLimitState(): void` |
| `resolveModule` | fn | — | `resolveModule(source: string, fromDir: string)` |
| `RootDeriveOpts` | type | — | `RootDeriveOpts = { loadModule?: LoadModule; autoBind?: boolean; fnNames?: string[]; refreshExistingOnly?: boolean; }` |
| `RootDeriveResult` | type | — | `RootDeriveResult = { roots: string[]; derived: DerivedExport[]; hasRoot: boolean; }` |
| `SchemaDialect` | type | — | `SchemaDialect = "zod"` |
| `SchemaNode` | type | — | `SchemaNode = \| { k: "lit"; value: string \| number \| boolean \| null \| undefined } \| { k: "prim"; type: "number" \| "string" \| "boolean" \| "...` |
| `schemaNodeToZod` | fn | — | `schemaNodeToZod(node: SchemaNode): string` |
| `SchemaProjection` | type | — | `SchemaProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
| `SchemaRefinement` | type | — | `SchemaRefinement = \| { kind: "numBound"; op: "gt" \| "ge" \| "lt" \| "le"; n: number } \| { kind: "int" } \| { kind: "strMin"; n: number } \| {...` |
| `serializeCaseArg` | fn | 单个 Abs → parseCaseArgExpr 可解析回去的表达式文本；不可表达返回 null | `serializeCaseArg(a: Abs): string \| null` |
| `serializeCaseJson` | fn | — | `serializeCaseJson( result: AnalysisResult, file: string, ): CaseJson` |
| `SessionCacheLimits` | type | 会话级内存 LRU 上限（进程内，非磁盘 cache）。 | `SessionCacheLimits = { maxFiles: number; maxFns: number; maxBRuns: number; }` |
| `setAnalysisSession` | fn | 测试：替换默认 session（返回旧值以便恢复） | `setAnalysisSession(session: AnalysisSession \| undefined): AnalysisSession \| undefined` |
| `setEnvHarvestConflictCollector` | fn | Install conflict collector; returns the previous one so nested/concurrent analyzeFile callers can save/restore (module-global is not re-entrant). | `setEnvHarvestConflictCollector( collector: ((c: EnvHarvestConflict) => void) \| null, )` |
| `setSessionCacheFromProject` | fn | package.json#nudo.sessionCache 层（findProjectConfig / 宿主接线） | `setSessionCacheFromProject(partial: PartialLimits \| null \| undefined): void` |
| `setSessionCacheLimits` | fn | 显式覆盖（宿主 / 测试）。传 null 清除显式层 | `setSessionCacheLimits(partial: PartialLimits \| null): SessionCacheLimits` |
| `sha256Hex` | fn | — | `sha256Hex(data: string \| Buffer): string` |
| `shouldAnalyzeFile` | fn | 是否应对该文件跑分析（自动路径，如 LSP validate）。 | `shouldAnalyzeFile( filePath: string, source: string \| undefined, config?: AnalysisConfig, ): boolean` |
| `sidecarDraftPath` | fn | `lib.js\|ts` → `lib.nudo.draft.js\|ts`（不进 ambient sidecar 表） | `sidecarDraftPath(filePath: string): string` |
| `sourceHasNudoDirectives` | fn | — | `hasNudoDirectives(source: string): boolean` |
| `SourceLocation` | type | — | `SourceLocation = { start: { line: number; column: number }; end: { line: number; column: number }; }` |
| `StandardSchemaIssue` | type | — | `StandardSchemaIssue = { message: string; path?: ReadonlyArray<PropertyKey>; }` |
| `StandardSchemaModuleProjection` | type | — | `StandardSchemaModuleProjection = { source: string; dropped: string[]; }` |
| `StandardSchemaResult` | type | — | `StandardSchemaResult = \| { value: unknown; issues?: undefined } \| { issues: ReadonlyArray<StandardSchemaIssue>; value?: undefined }` |
| `stripGeneratedCaseDirectives` | fn | 从源码剥离所有本模块生成的 @nudo:case 指令（名字以 call@ 开头，整行删除）。 | `stripGeneratedCaseDirectives(source: string)` |
| `SymbolInfo` | type | — | `SymbolInfo = { name: string; kind: "function" \| "variable" \| "class" \| "parameter"; loc: SourceLocation; uri?: string; }` |
| `SymbolTable` | type | — | `SymbolTable = { definitions: Map<string, SymbolInfo>; references: ReferenceInfo[]; }` |
| `topoSortDirty` | fn | Topological order with dependencies before dependents (only imports edges internal to dirty; cycles tolerated — remaining files appended in arbitrary order). | `topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[]` |
| `trimAnalysisFileCache` | fn | 立刻压到当前 maxFiles（调低上限时收内存） | `trimAnalysisFileCache(): void` |
| `trimBPathCache` | fn | 立刻压到当前 maxBRuns（调低上限时收内存） | `trimBPathCache(): void` |
| `trimFnAnalysisCache` | fn | 立刻压到当前 maxFns（调低上限时收内存） | `trimFnAnalysisCache(): void` |
| `tryBPathCall` | fn | B 路径求值具名导出（仅成功结果） | `tryBPathCall( source: string, filePath: string, fnName: string, args: Abs[], opts: { envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi } = {}, ): Abs \| undefined` |
| `tryBPathCallFull` | fn | B 路径求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录。 | `tryBPathCallFull( source: string, filePath: string, fnName: string, args: Abs[], opts: { collectCalls?: boolean; collectMemberDiags?: boolean; envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi; } = {}, )` |
| `tryRunBPath` | fn | 模块图 + runTranspiled（默认 analyze 模式） | `tryRunBPath( source: string, filePath: string, opts: { maxLoopIters?: number; mode?: "exec" \| "analyze"; envNames?: string[]; mocks?: Record<string, Abs>; lenientGlobals?: boolean; } = {}, ): BPathRunResult \| undefined` |
| `TypeBinding` | type | — | `TypeBinding = { name: string; type: string }` |
| `typeExprToDirective` | fn | agent 面类型表达式 → `@nudo:as` 文法 | `typeExprToDirective(expr: string): string` |
| `unifiedDiff` | fn | 行级 unified diff：`--- a/path` 头 + `@@` hunk + 上下文 3 行；相同返回 "" | `unifiedDiff(a: string, b: string, path: string): string` |
| `validateSchemaNode` | fn | SchemaNode 同步校验（生成模块与测试共用语义）。 | `validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult` |
| `WriteDraftResult` | type | — | `WriteDraftResult = { draftPath: string; written: boolean; changed: boolean; draftable: boolean; draftSource: string; }` |
| `writeInterfaceDraft` | fn | 写入 `*.nudo.draft.js`（覆盖草稿文件本身；不碰正式 `*.nudo.js`）。 | `writeInterfaceDraft( filePath: string, draftSource: string, opts: { dryRun?: boolean; projectDir?: string; entries?: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>; draftable?: boolean; } = {}, ): WriteDraftResult` |
| `ZodModuleProjection` | type | — | `ZodModuleProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
<!-- NUDO-API-SKELETON:END -->
