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
> Generated by `pnpm run docs:gen:api` from package export surfaces (`PUBLIC_API.md` / `src/index.ts`) — do not edit this block. Regenerate with `node scripts/gen-api-docs.mjs`. A `—` summary means the source JSDoc first sentence is not yet English — see the package source. Each row's name carries a stable anchor `#slug` (the lowercased symbol name).

Includes the `@nudojs/service` (`src/index.ts`) face and public emit faces re-exported from `@nudojs/service/emit`.

| Name | Kind | Summary | Signature |
|------|------|------|------|
| <a id="absgraphoptions"></a>`AbsGraphOptions` | type | — | `AbsGraphOptions = { loadModule?: AbsLoadModule; seedVars?: Record<string, Abs>; seedFns?: Record<string, { params: string[]; body: Node; ...` |
| <a id="absmockseeds"></a>`AbsMockSeeds` | type | — | `AbsMockSeeds = { seedVars: Record<string, Abs>; seedFns: Record<string, { params: string[]; body: Node; async?: boolean; fingerprint?: st...` |
| <a id="absmodulecacheentry"></a>`AbsModuleCacheEntry` | type | — | `AbsModuleCacheEntry = { mtimeMs: number; size: number; exports: AbsModuleExports; issues: AbsModuleLoadIssue[]; }` |
| <a id="absmodulegraphresult"></a>`AbsModuleGraphResult` | type | — | `AbsModuleGraphResult = { modules: Record<string, AbsModuleExports>; byPath: Map<string, AbsModuleExports>; issues: AbsModuleLoadIssue[]; }` |
| <a id="absmoduleloadissue"></a>`AbsModuleLoadIssue` | type | — | `AbsModuleLoadIssue = { kind: "cycle" \| "depth" \| "missing"; label: string; reason: string; }` |
| <a id="abstoschemanode"></a>`absToSchemaNode` | fn | — | `absToSchemaNode(a: Abs)` |
| <a id="abstoschemasource"></a>`absToSchemaSource` | fn | — | `absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string` |
| <a id="abstostandardschema"></a>`absToStandardSchema` | fn | — | `absToStandardSchema( a: Abs, opts?: { name?: string }, ): StandardSchemaModuleProjection` |
| <a id="abstostandardschemamodule"></a>`absToStandardSchemaModule` | fn | — | `absToStandardSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): StandardSchemaModuleProjection` |
| <a id="abstotstype"></a>`absToTSType` | fn | — | `absToTSType(a: Abs, typeVars?: Map<string, string>): string` |
| <a id="abstozodschemamodule"></a>`absToZodSchemaModule` | fn | — | `absToZodSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): ZodModuleProjection` |
| <a id="ambientsourcesofsidecar"></a>`ambientSourcesOfSidecar` | fn | `lib.nudo.js\|ts` → candidate ambient sources next to it | `ambientSourcesOfSidecar(sidecarPath: string): string[]` |
| <a id="analysis_abi"></a>`ANALYSIS_ABI` | const | — | `const ANALYSIS_ABI` |
| <a id="analysisconfig"></a>`analysisConfig` | fn | — | `analysisConfig(config: NudoConfig \| null \| undefined): AnalysisConfig` |
| <a id="analysisconfig"></a>`AnalysisConfig` | type | — | `AnalysisConfig = { include: string[]; exclude: string[]; mode: AnalysisMode; diagnostics: DiagnosticsLevel; callSiteBudget: number; evalM...` |
| <a id="analysisfilecachekey"></a>`analysisFileCacheKey` | fn | — | `analysisFileCacheKey( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], analysisCfg?: { mode: string; evalMissingSlot: string; callSiteBudget: number; diagnostics: string }, loadModule?: AnalyzeLoadModule, projectEnvNames?: string[], autoBind?: boolean, caseMode: DirectiveCaseMode = "all", )` |
| <a id="analysismode"></a>`AnalysisMode` | type | — | `AnalysisMode = "directives" \| "exports" \| "all"` |
| <a id="analysisresult"></a>`AnalysisResult` | type | — | `AnalysisResult = { functions: FunctionAnalysis[]; diagnostics: Diagnostic[]; bindings: Map<string, BindingInfo>; nodeAbsMap: Map<Node, Ab...` |
| <a id="analysissession"></a>`AnalysisSession` | type | — | `AnalysisSession = { evictForDependents(files: string[]): void; clear(): void; reset(): void; analyze( filePath: string, source: string, a...` |
| <a id="analyzeexportsfromsource"></a>`analyzeExportsFromSource` | fn | — | `analyzeExportsFromSource( filePath: string, source: string, ): ModuleExports` |
| <a id="analyzefile"></a>`analyzeFile` | fn | — | `analyzeFile( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): AnalysisResult` |
| <a id="analyzefileasync"></a>`analyzeFileAsync` | fn | Async entry to analyzeFile: preloads path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible synchronously in ESM — then runs the sync analysis, which picks the preloaded factories up from the env-loader cache. | `analyzeFileAsync( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): Promise<AnalysisResult>` |
| <a id="applybforkbudgetfromconfig"></a>`applyBForkBudgetFromConfig` | fn | — | `applyBForkBudgetFromConfig( config: NudoConfig \| null \| undefined, env: NodeJS.ProcessEnv = process.env, ): number` |
| <a id="applymockmoduledirectives"></a>`applyMockModuleDirectives` | fn | Overlay `@nudo:mock-module` directives onto a modules map. | `applyMockModuleDirectives( base: Record<string, AbsModuleExports>, fileDirectives: FileDirective[], opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| <a id="applymockmoduledirectivesfromsource"></a>`applyMockModuleDirectivesFromSource` | fn | Source string → apply mock-module (CLI / one-shot hosts). | `applyMockModuleDirectivesFromSource( source: string, base: Record<string, AbsModuleExports>, opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| <a id="applysessioncacheconfig"></a>`applySessionCacheConfig` | fn | — | `applySessionCacheConfig(config: NudoConfig \| null \| undefined): SessionCacheLimits` |
| <a id="bindinginfo"></a>`BindingInfo` | type | — | `BindingInfo = { abs: Abs; loc?: SourceLocation; }` |
| <a id="buildcasedirective"></a>`buildCaseDirective` | fn | — | `buildCaseDirective(name: string, argsAbs: Abs[]): string \| null` |
| <a id="buildmodulegraph"></a>`buildModuleGraph` | fn | Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). | `buildModuleGraph( files: string[], cache?: ModuleGraphCache, )` |
| <a id="callrecord"></a>`CallRecord` | type | — | — |
| <a id="casehint"></a>`CaseHint` | type | — | `CaseHint = { line: number; label: string; ok: boolean; }` |
| <a id="casejson"></a>`CaseJson` | type | — | `CaseJson = { version: 1; file: string; summary: { functions: number; externalFunctions: number; cases: number; diagnostics: number; }; fu...` |
| <a id="casejsoncase"></a>`CaseJsonCase` | type | — | `CaseJsonCase = { name: string; args: string[]; result: string; throws: string \| null; source: string \| null; aggregatedFrom?: number; arg...` |
| <a id="casejsonfunction"></a>`CaseJsonFunction` | type | — | `CaseJsonFunction = { name: string; loc: SourceLocation; entryOnly: boolean; noDeclaration?: boolean; cases: CaseJsonCase[]; combined?: st...` |
| <a id="caseresult"></a>`CaseResult` | type | — | `CaseResult = { name: string; argAbs: Abs[]; abs: Abs; throwsAbs: Abs; throwLoc?: SourceLocation; source?: "directive" \| "callsite"; expec...` |
| <a id="checkcachekey"></a>`checkCacheKey` | fn | — | `checkCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarContent?: string \| null; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; analysisCfg?: { mode?: string; evalMissingSlot?: string; callSiteBudget?: number; entryThrows?: string; ignoreThrows?: string; }; }, ): string` |
| <a id="checkconfig"></a>`checkConfig` | fn | — | `checkConfig(config: NudoConfig \| null \| undefined): CheckConfig` |
| <a id="checkconfig"></a>`CheckConfig` | type | — | `CheckConfig = { entryThrows: "error" \| "warning" \| "off"; ignoreThrows: string[]; }` |
| <a id="clearabsmodulecache"></a>`clearAbsModuleCache` | fn | — | `clearAbsModuleCache(): void` |
| <a id="clearanalysisfilecache"></a>`clearAnalysisFileCache` | fn | — | `clearAnalysisFileCache(): void` |
| <a id="clearanalysissessioncaches"></a>`clearAnalysisSessionCaches` | fn | — | `clearAnalysisSessionCaches(): void` |
| <a id="clearenvpathdeps"></a>`clearEnvPathDeps` | fn | — | `clearEnvPathDeps(): void` |
| <a id="clearevalcache"></a>`clearEvalCache` | fn | — | `clearEvalCache(): void` |
| <a id="clearfnanalysiscache"></a>`clearFnAnalysisCache` | fn | — | `clearFnAnalysisCache(): void` |
| <a id="clearpathenvcaches"></a>`clearPathEnvCaches` | fn | Host cache-clear hooks (CLI watch / vite / tests) must drop path-env modules too | `clearPathEnvCaches(): void` |
| <a id="collectabsbindingsfromgraph"></a>`collectAbsBindingsFromGraph` | fn | — | `collectAbsBindingsFromGraph( source: string, filePath: string, opts: AbsGraphOptions = {}, ): Map<string, Abs>` |
| <a id="collectcallrecords"></a>`collectCallRecords` | fn | — | `collectCallRecords(filePath: string, source: string): CallRecord[]` |
| <a id="collectdependencyspecs"></a>`collectDependencySpecs` | fn | — | `collectDependencySpecs(ast: File): string[]` |
| <a id="collectenvglobals"></a>`collectEnvGlobals` | fn | — | `collectEnvGlobals(envNames: string[]): Record<string, Abs>` |
| <a id="collectenvmodules"></a>`collectEnvModules` | fn | — | `collectEnvModules(envNames: string[]): Record<string, AbsModuleExports>` |
| <a id="collectenvnames"></a>`collectEnvNames` | fn | — | `collectEnvNames(filePath: string, source: string, includeProject: boolean): string[]` |
| <a id="collectevaldiagnostics"></a>`collectEvalDiagnostics` | fn | — | `collectEvalDiagnostics( source: string, extraKnown?: Iterable<string>, ): EvalDiagnostics` |
| <a id="collectevalreplacements"></a>`collectEvalReplacements` | fn | — | `collectEvalReplacements(source: string)` |
| <a id="collectloaddepcontents"></a>`collectLoadDepContents` | fn | — | `collectLoadDepContents( filePath: string, source: string, loadModule: (spec: string, fromFile: string) => string \| undefined, )` |
| <a id="collectparambodyaccesses"></a>`collectParamBodyAccesses` | fn | — | `collectParamBodyAccesses( source: string, ): Map` |
| <a id="collectskipreturns"></a>`collectSkipReturns` | fn | — | `collectSkipReturns(source: string): Map<string, Abs \| null>` |
| <a id="collectstaticimports"></a>`collectStaticImports` | fn | — | `collectStaticImports( entryFile: string, maxDepth = 8, ): Map<string, ModuleExports>` |
| <a id="completionitem"></a>`CompletionItem` | type | — | `CompletionItem = { label: string; kind: "property" \| "method" \| "variable"; detail?: string; }` |
| <a id="computedirtyset"></a>`computeDirtySet` | fn | changed plus its transitive dependents (reverse-edge BFS); cycle-safe via visited. | `computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[]` |
| <a id="constraintsourceexpr"></a>`ConstraintSourceExpr` | type | — | `ConstraintSourceExpr = { expr: string; importFrom?: string; importName?: string; }` |
| <a id="constrainttoschemanode"></a>`constraintToSchemaNode` | fn | — | `constraintToSchemaNode(c: NudoConstraint): SchemaNode` |
| <a id="currentbforkbudgetlimit"></a>`currentBForkBudgetLimit` | fn | — | `currentBForkBudgetLimit(): number` |
| <a id="default_analysis_mode"></a>`DEFAULT_ANALYSIS_MODE` | const | — | `const DEFAULT_ANALYSIS_MODE` |
| <a id="default_session_cache_limits"></a>`DEFAULT_SESSION_CACHE_LIMITS` | const | — | `const DEFAULT_SESSION_CACHE_LIMITS` |
| <a id="defaultabsloadmodule"></a>`defaultAbsLoadModule` | fn | — | `defaultAbsLoadModule(spec: string, fromFile: string): string \| undefined` |
| <a id="defaultloadmodule"></a>`defaultLoadModule` | fn | — | `defaultLoadModule(spec: string, fromFile: string): string \| undefined` |
| <a id="depcontent"></a>`DepContent` | type | — | `DepContent = { path: string; content: string \| null }` |
| <a id="derivedexport"></a>`DerivedExport` | type | — | `DerivedExport = { file: string; fn: string; paramNames: string[]; params: DerivedParam[]; returns?: { constraint: NudoConstraint; dsl: st...` |
| <a id="derivedparam"></a>`DerivedParam` | type | — | `DerivedParam = { name: string; constraint: NudoConstraint; dsl: string; prelude: string[]; imports: Array<{ name: string; from: string }>...` |
| <a id="derivefromroot"></a>`deriveFromRoot` | fn | — | `deriveFromRoot( filePath: string, opts: RootDeriveOpts = {}, ): RootDeriveResult` |
| <a id="detectentryvariantsfrompackagejson"></a>`detectEntryVariantsFromPackageJson` | fn | Detect browser/node dual faces in a parsed package.json. | `detectEntryVariantsFromPackageJson(pkg: unknown): EntryVariantFaces \| null` |
| <a id="diagnostic"></a>`Diagnostic` | type | — | `Diagnostic = { range: SourceLocation; severity: DiagnosticSeverity; message: string; tags?: DiagnosticTag[]; code?: string; suggestions?:...` |
| <a id="diagnosticseverity"></a>`DiagnosticSeverity` | type | — | `DiagnosticSeverity = "error" \| "warning" \| "info"` |
| <a id="diagnosticslevel"></a>`DiagnosticsLevel` | type | — | `DiagnosticsLevel = "off" \| "errors" \| "default" \| "verbose"` |
| <a id="diagnosticslevelforfile"></a>`diagnosticsLevelForFile` | fn | — | `diagnosticsLevelForFile(filePath: string): DiagnosticsLevel` |
| <a id="diagnostictag"></a>`DiagnosticTag` | type | — | `DiagnosticTag = "unnecessary"` |
| <a id="directivecasemode"></a>`DirectiveCaseMode` | type | — | `DirectiveCaseMode = "none" \| "all" \| "selected"` |
| <a id="diskcache"></a>`DiskCache` | fn | — | `DiskCache { private readonly root: string \| undefined; private readonly ns: string; enabled = false; constructor(opts: DiskCacheOptions) ...` |
| <a id="diskcacheoptions"></a>`DiskCacheOptions` | type | — | `DiskCacheOptions = { root?: string \| undefined; namespace: string; }` |
| <a id="diskcacheroot"></a>`diskCacheRoot` | fn | — | `diskCacheRoot( config: NudoConfig \| null \| undefined, projectDir: string \| undefined, ): string \| undefined` |
| <a id="draftevidence"></a>`DraftEvidence` | type | — | `DraftEvidence = "callsite" \| "directive" \| "symbolic" \| "body" \| "none"` |
| <a id="draftinterface"></a>`draftInterface` | fn | — | `draftInterface( filePath: string, opts: InterfaceDraftOpts = {}, ): Promise<InterfaceDraftResult>` |
| <a id="emitderivedfromroot"></a>`emitDerivedFromRoot` | fn | — | `emitDerivedFromRoot( rootFile: string, opts: { fnNames?: string[]; mode: "add" \| "update"; dryRun?: boolean; loadModule?: LoadModule; autoBind?: boolean; refreshExistingOnly?: boolean; }, ): EmitDerivedResult` |
| <a id="emitderivedresult"></a>`EmitDerivedResult` | type | — | `EmitDerivedResult = { sidecars: Array<{ file: string; sidecarPath: string; fn: string; written: boolean; changed: boolean; skipped?: "nam...` |
| <a id="emitinterface"></a>`emitInterface` | fn | — | `emitInterface( filePath: string, opts: EmitInterfaceOpts, ): Promise<EmitInterfaceResult>` |
| <a id="emitinterfaceopts"></a>`EmitInterfaceOpts` | type | — | `EmitInterfaceOpts = { fnNames?: string[]; mode: "add" \| "update"; all?: boolean; dryRun?: boolean; records?: CallRecord[]; source?: strin...` |
| <a id="emitinterfaceresult"></a>`EmitInterfaceResult` | type | — | `EmitInterfaceResult = { written: string[]; skipped: Array<{ fn: string; reason: EmitInterfaceSkipReason }>; changed: boolean; diff?: stri...` |
| <a id="emitinterfaceskipreason"></a>`EmitInterfaceSkipReason` | type | — | `EmitInterfaceSkipReason = \| "name-clash" \| "not-projectable" \| "not-an-export" \| "no-change" \| "emit-denied" \| "multi-declarator"` |
| <a id="emitresult"></a>`EmitResult` | type | — | `EmitResult = { source: string; changed: boolean; written: Array<{ fn: string; cases: string[] }>; skipped: Array<{ fn: string; reason: Em...` |
| <a id="emitskipreason"></a>`EmitSkipReason` | type | — | `EmitSkipReason = \| "hand-written" \| "already-generated" \| "entry-only" \| "no-serializable-cases" \| "no-declaration" \| "skipped"` |
| <a id="entryvariantforfile"></a>`entryVariantForFile` | fn | Dual-entry info for an analyzed file: the owning package must declare two differing faces **and** this file must be one of the entry targets. | `entryVariantForFile(filePath: string): EntryVariantInfo \| null` |
| <a id="entryvariantinfo"></a>`EntryVariantInfo` | type | — | `EntryVariantInfo = { pkgPath: string; pkgDir: string; pkgName?: string; kind: "exports-conditions" \| "browser-field"; browserPaths: strin...` |
| <a id="entryvariantissue"></a>`EntryVariantIssue` | type | Host-facing info issue (CLI check / JSON) for one analyzed entry variant. | `EntryVariantIssue = { severity: "info"; code: "nudo:dual-entry"; message: string; suggestion: string; line: number; column: number; }` |
| <a id="entryvariantissueforfile"></a>`entryVariantIssueForFile` | fn | — | `entryVariantIssueForFile(filePath: string): EntryVariantIssue \| null` |
| <a id="envharvestconflict"></a>`EnvHarvestConflict` | type | Conflict when handwritten env overwrote a harvest module/export (B8). | `EnvHarvestConflict = { module: string; exports: string[]; defaultOverwritten: boolean; }` |
| <a id="envpathdependents"></a>`envPathDependents` | fn | — | `envPathDependents(envPath: string): string[]` |
| <a id="evalabsmodulegraph"></a>`evalAbsModuleGraph` | fn | — | `evalAbsModuleGraph( entrySource: string, entryFile: string, opts: AbsGraphOptions = {}, ): AbsModuleGraphResult` |
| <a id="evalbuiltinunknown"></a>`EvalBuiltinUnknown` | type | — | `EvalBuiltinUnknown = { name: string; range: EvalLoc }` |
| <a id="evaldiagnostics"></a>`EvalDiagnostics` | type | — | `EvalDiagnostics = { unreachable: EvalUnreachable[]; builtinUnknown: EvalBuiltinUnknown[]; }` |
| <a id="evalrunresult"></a>`EvalRunResult` | type | — | `EvalRunResult = { exports: Record<string, unknown>; modules: Record<string, AbsModuleExports>; memberDiags?: EvalMemberDiag[]; moduleIssu...` |
| <a id="evalunreachable"></a>`EvalUnreachable` | type | — | `EvalUnreachable = { range: EvalLoc }` |
| <a id="evictabsmodulecachefiles"></a>`evictAbsModuleCacheFiles` | fn | — | `evictAbsModuleCacheFiles(paths: string[]): void` |
| <a id="evictanalysiscachesforfiles"></a>`evictAnalysisCachesForFiles` | fn | — | `evictAnalysisCachesForFiles(files: string[]): void` |
| <a id="evictanalysisfilecacheforfiles"></a>`evictAnalysisFileCacheForFiles` | fn | — | `evictAnalysisFileCacheForFiles(files: string[]): number` |
| <a id="evictevalcacheforfiles"></a>`evictEvalCacheForFiles` | fn | — | `evictEvalCacheForFiles(files: string[]): number` |
| <a id="evictfnanalysiscacheforfiles"></a>`evictFnAnalysisCacheForFiles` | fn | Dependency content changed: drop every per-fn entry for these entry files. | `evictFnAnalysisCacheForFiles(files: string[]): number` |
| <a id="extractfnconstraintsources"></a>`extractFnConstraintSources` | fn | — | `extractFnConstraintSources( sidecarSrc: string, fnName: string, )` |
| <a id="extractnudoimportspecs"></a>`extractNudoImportSpecs` | fn | — | `extractNudoImportSpecs(source: string): string[]` |
| <a id="filterdiagnosticsbylevel"></a>`filterDiagnosticsByLevel` | fn | — | `filterDiagnosticsByLevel<T extends { severity: string; code?: string }>( diags: T[], level: DiagnosticsLevel, ): T[]` |
| <a id="findowningpackage"></a>`findOwningPackage` | fn | Nearest package.json walking up from the file's directory. | `findOwningPackage( fromFile: string, )` |
| <a id="findprojectconfig"></a>`findProjectConfig` | fn | — | `findProjectConfig( startDir: string, )` |
| <a id="formatderivedsection"></a>`formatDerivedSection` | fn | — | `formatDerivedSection( row: DerivedExport, opts: { rootSidecarDir: string; targetSidecarDir: string; takenNames?: Iterable<string>; }, )` |
| <a id="formatdraftmodule"></a>`formatDraftModule` | fn | — | `formatDraftModule( filePath: string, entries: InterfaceDraftEntry[], sidecarPath?: string, ): string` |
| <a id="formatdraftsummary"></a>`formatDraftSummary` | fn | — | `formatDraftSummary( sourceRel: string, draftRel: string, result: InterfaceDraftResult, write?: WriteDraftResult, ): string[]` |
| <a id="formatemitsummary"></a>`formatEmitSummary` | fn | — | `formatEmitSummary( sourcePath: string, sidecarRel: string, result: EmitInterfaceResult, ): string[]` |
| <a id="formatinterfacesurfaceline"></a>`formatInterfaceSurfaceLine` | fn | — | `formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string` |
| <a id="functionanalysis"></a>`FunctionAnalysis` | type | — | `FunctionAnalysis = { name: string; loc: SourceLocation; paramNames: string[]; formals?: FormalParam[]; cases: CaseResult[]; combinedAbs?:...` |
| <a id="generatedts"></a>`generateDts` | fn | — | `generateDts(result: AnalysisResult): string` |
| <a id="generatefunctiondtslines"></a>`generateFunctionDtsLines` | fn | — | `generateFunctionDtsLines(fn: FunctionAnalysis): string[]` |
| <a id="generateguardfunction"></a>`generateGuardFunction` | fn | — | `generateGuardFunction(name: string, abs: Abs): string` |
| <a id="generateguardfunctionfromabs"></a>`generateGuardFunctionFromAbs` | fn | — | `generateGuardFunctionFromAbs(name: string, abs: Abs): string` |
| <a id="getabsmodulecachesize"></a>`getAbsModuleCacheSize` | fn | — | `getAbsModuleCacheSize(): number` |
| <a id="getanalysisfilecachesize"></a>`getAnalysisFileCacheSize` | fn | — | `getAnalysisFileCacheSize(): number` |
| <a id="getanalysissession"></a>`getAnalysisSession` | fn | — | `getAnalysisSession(): AnalysisSession` |
| <a id="getenvharvestconflictcollector"></a>`getEnvHarvestConflictCollector` | fn | Read-only peek for tests / nested restore. | `getEnvHarvestConflictCollector()` |
| <a id="getenvpathdepssize"></a>`getEnvPathDepsSize` | fn | — | `getEnvPathDepsSize(): number` |
| <a id="getevalcachesize"></a>`getEvalCacheSize` | fn | — | `getEvalCacheSize(): number` |
| <a id="getfnanalysiscachesize"></a>`getFnAnalysisCacheSize` | fn | — | `getFnAnalysisCacheSize(): number` |
| <a id="getpathenvcachesizes"></a>`getPathEnvCacheSizes` | fn | — | `getPathEnvCacheSizes()` |
| <a id="getsessioncachelimits"></a>`getSessionCacheLimits` | fn | — | `getSessionCacheLimits( env: NodeJS.ProcessEnv = process.env, ): SessionCacheLimits` |
| <a id="ifacecachekey"></a>`ifaceCacheKey` | fn | — | `ifaceCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarSource?: string \| undefined; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; }, ): string` |
| <a id="injectbindings"></a>`injectBindings` | fn | — | `injectBindings( source: string, bindings: TypeBinding[], )` |
| <a id="insertgeneratedcasedirectives"></a>`insertGeneratedCaseDirectives` | fn | — | `insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult` |
| <a id="interfaceconfig"></a>`interfaceConfig` | fn | — | `interfaceConfig(config: NudoConfig \| null \| undefined): InterfaceConfig` |
| <a id="interfaceconfig"></a>`InterfaceConfig` | type | — | `InterfaceConfig = { autoBind: boolean; emit: string[]; }` |
| <a id="interfacedraftentry"></a>`InterfaceDraftEntry` | type | — | `InterfaceDraftEntry = { fn: string; params: Array<{ name: string; constraint?: NudoConstraint; display: string; projected: boolean; bodyA...` |
| <a id="interfacedraftopts"></a>`InterfaceDraftOpts` | type | — | `InterfaceDraftOpts = { fnNames?: string[]; records?: CallRecord[]; loadModule?: LoadModule; autoBind?: boolean; bodyAccesses?: boolean; s...` |
| <a id="interfacedraftresult"></a>`InterfaceDraftResult` | type | — | `InterfaceDraftResult = { file: string; entries: InterfaceDraftEntry[]; draftSource: string; sidecarPath: string; }` |
| <a id="interfacesurface"></a>`interfaceSurface` | fn | — | `interfaceSurface( filePath: string, opts: InterfaceSurfaceOpts = {}, ): Promise<InterfaceSurfaceEntry[]>` |
| <a id="interfacesurfaceentry"></a>`InterfaceSurfaceEntry` | type | — | `InterfaceSurfaceEntry = { fn: string; kind: "export" \| "local"; source: "handwritten" \| "generated" \| "implicit"; params: Array<{ name: s...` |
| <a id="interfacesurfaceopts"></a>`InterfaceSurfaceOpts` | type | — | `InterfaceSurfaceOpts = { autoBind?: boolean; loadModule?: LoadModule; records?: CallRecord[]; source?: string; }` |
| <a id="isdraftableentry"></a>`isDraftableEntry` | fn | Parse-layer draftable: at least one entry has generated DSL and was not skipped | `isDraftableEntry(entries: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>): boolean` |
| <a id="isenvtemplatepath"></a>`isEnvTemplatePath` | fn | — | `isEnvTemplatePath(path: string): boolean` |
| <a id="isevalcapable"></a>`isEvalCapable` | fn | — | `isEvalCapable(source: string, envNames: string[] = []): boolean` |
| <a id="isnudotargetpath"></a>`isNudoTargetPath` | fn | — | `isNudoTargetPath(path: string): boolean` |
| <a id="isprojectconfigpath"></a>`isProjectConfigPath` | fn | — | `isProjectConfigPath(path: string): boolean` |
| <a id="issidecarpath"></a>`isSidecarPath` | fn | Formal sidecar contracts only — drafts never ambient-bind and need not reanalyze | `isSidecarPath(path: string): boolean` |
| <a id="iswatchrelevantpath"></a>`isWatchRelevantPath` | fn | Watch accept gate: analysis targets + sidecar/config/env-template invalidators | `isWatchRelevantPath(path: string): boolean` |
| <a id="loadmodule"></a>`LoadModule` | type | — | `LoadModule = (spec: string, fromFile: string) => string \| undefined` |
| <a id="locfromnode"></a>`locFromNode` | fn | — | `locFromNode(node: Node): SourceLocation` |
| <a id="matchesemitallowlist"></a>`matchesEmitAllowlist` | fn | — | `matchesEmitAllowlist( absPath: string, projectDir: string \| undefined, patterns: string[], ): boolean` |
| <a id="mergeharvestoptions"></a>`MergeHarvestOptions` | type | — | `MergeHarvestOptions = { onConflict?: (c: EnvHarvestConflict) => void; }` |
| <a id="mergeharvestunderenv"></a>`mergeHarvestUnderEnv` | fn | Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping module keys and overlapping export names (docs/versioning.md B8 + website harvester API). | `mergeHarvestUnderEnv( harvestModules: Record<string, AbsModuleExports>, envModules: Record<string, AbsModuleExports>, opts?: MergeHarvestOptions, ): Record<string, AbsModuleExports>` |
| <a id="mockdirectivestoabsseeds"></a>`mockDirectivesToAbsSeeds` | fn | — | `mockDirectivesToAbsSeeds( functions: Array<{ directives: FunctionWithDirectives["directives"] }>, opts?: { fromFile?: string; loadModule?: LoadModule; }, ): AbsMockSeeds` |
| <a id="mockmoduleapplyresult"></a>`MockModuleApplyResult` | type | — | `MockModuleApplyResult = { modules: Record<string, AbsModuleExports>; errors: FromMockError[]; applied: boolean; }` |
| <a id="mockseedsforsource"></a>`mockSeedsForSource` | fn | — | `mockSeedsForSource( source: string, opts?: { fromFile?: string; loadModule?: LoadModule }, ): Record<string, Abs>` |
| <a id="mockseedstoabsmocks"></a>`mockSeedsToAbsMocks` | fn | — | `mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs>` |
| <a id="moduleexports"></a>`ModuleExports` | type | — | `ModuleExports = { path: string; named: Map<string, string>; defaultExport?: string; source: string; poly: Map<string, PolyFn>; }` |
| <a id="modulegraphcache"></a>`ModuleGraphCache` | type | — | `ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>` |
| <a id="noteenvpathdeps"></a>`noteEnvPathDeps` | fn | — | `noteEnvPathDeps(sourcePath: string, source: string): void` |
| <a id="nudoconfig"></a>`NudoConfig` | type | — | `NudoConfig = { env?: string[]; mocks?: Record<string, string>; contract?: { autoBind?: boolean; emit?: string[] \| string; }; analysis?: {...` |
| <a id="projectabstoschema"></a>`projectAbsToSchema` | fn | — | `projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): SchemaProjection` |
| <a id="referenceinfo"></a>`ReferenceInfo` | type | — | `ReferenceInfo = { name: string; loc: SourceLocation; uri?: string; }` |
| <a id="relativizepath"></a>`relativizePath` | fn | — | `relativizePath(p: string, root?: string): string` |
| <a id="resetallanalysiscaches"></a>`resetAllAnalysisCaches` | fn | — | `resetAllAnalysisCaches(): void` |
| <a id="resetsessioncachelimitstate"></a>`resetSessionCacheLimitState` | fn | — | `resetSessionCacheLimitState(): void` |
| <a id="resolvemodule"></a>`resolveModule` | fn | — | `resolveModule(source: string, fromDir: string)` |
| <a id="rootderiveopts"></a>`RootDeriveOpts` | type | — | `RootDeriveOpts = { loadModule?: LoadModule; autoBind?: boolean; fnNames?: string[]; refreshExistingOnly?: boolean; }` |
| <a id="rootderiveresult"></a>`RootDeriveResult` | type | — | `RootDeriveResult = { roots: string[]; derived: DerivedExport[]; hasRoot: boolean; }` |
| <a id="schemadialect"></a>`SchemaDialect` | type | — | `SchemaDialect = "zod"` |
| <a id="schemanode"></a>`SchemaNode` | type | — | `SchemaNode = \| { k: "lit"; value: string \| number \| boolean \| null \| undefined } \| { k: "prim"; type: "number" \| "string" \| "boolean" \| "...` |
| <a id="schemanodetozod"></a>`schemaNodeToZod` | fn | — | `schemaNodeToZod(node: SchemaNode): string` |
| <a id="schemaprojection"></a>`SchemaProjection` | type | — | `SchemaProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
| <a id="schemarefinement"></a>`SchemaRefinement` | type | — | `SchemaRefinement = \| { kind: "numBound"; op: "gt" \| "ge" \| "lt" \| "le"; n: number } \| { kind: "int" } \| { kind: "strMin"; n: number } \| {...` |
| <a id="serializecasearg"></a>`serializeCaseArg` | fn | — | `serializeCaseArg(a: Abs): string \| null` |
| <a id="serializecasejson"></a>`serializeCaseJson` | fn | — | `serializeCaseJson( result: AnalysisResult, file: string, ): CaseJson` |
| <a id="sessioncachelimits"></a>`SessionCacheLimits` | type | — | `SessionCacheLimits = { maxFiles: number; maxFns: number; maxEvalRuns: number; }` |
| <a id="setanalysissession"></a>`setAnalysisSession` | fn | — | `setAnalysisSession(session: AnalysisSession \| undefined): AnalysisSession \| undefined` |
| <a id="setenvharvestconflictcollector"></a>`setEnvHarvestConflictCollector` | fn | Install conflict collector; returns the previous one so nested/concurrent analyzeFile callers can save/restore (module-global is not re-entrant). | `setEnvHarvestConflictCollector( collector: ((c: EnvHarvestConflict) => void) \| null, )` |
| <a id="setsessioncachefromproject"></a>`setSessionCacheFromProject` | fn | — | `setSessionCacheFromProject(partial: PartialLimits \| null \| undefined): void` |
| <a id="setsessioncachelimits"></a>`setSessionCacheLimits` | fn | — | `setSessionCacheLimits(partial: PartialLimits \| null): SessionCacheLimits` |
| <a id="sha256hex"></a>`sha256Hex` | fn | — | `sha256Hex(data: string \| Buffer): string` |
| <a id="shouldanalyzefile"></a>`shouldAnalyzeFile` | fn | — | `shouldAnalyzeFile( filePath: string, source: string \| undefined, config?: AnalysisConfig, ): boolean` |
| <a id="sidecardraftpath"></a>`sidecarDraftPath` | fn | — | `sidecarDraftPath(filePath: string): string` |
| <a id="sourcehasnudodirectives"></a>`sourceHasNudoDirectives` | fn | — | `hasNudoDirectives(source: string): boolean` |
| <a id="sourcelocation"></a>`SourceLocation` | type | — | `SourceLocation = { start: { line: number; column: number }; end: { line: number; column: number }; }` |
| <a id="standardschemaissue"></a>`StandardSchemaIssue` | type | — | `StandardSchemaIssue = { message: string; path?: ReadonlyArray<PropertyKey>; }` |
| <a id="standardschemamoduleprojection"></a>`StandardSchemaModuleProjection` | type | — | `StandardSchemaModuleProjection = { source: string; dropped: string[]; }` |
| <a id="standardschemaresult"></a>`StandardSchemaResult` | type | — | `StandardSchemaResult = \| { value: unknown; issues?: undefined } \| { issues: ReadonlyArray<StandardSchemaIssue>; value?: undefined }` |
| <a id="stripgeneratedcasedirectives"></a>`stripGeneratedCaseDirectives` | fn | — | `stripGeneratedCaseDirectives(source: string)` |
| <a id="symbolinfo"></a>`SymbolInfo` | type | — | `SymbolInfo = { name: string; kind: "function" \| "variable" \| "class" \| "parameter"; loc: SourceLocation; uri?: string; }` |
| <a id="symboltable"></a>`SymbolTable` | type | — | `SymbolTable = { definitions: Map<string, SymbolInfo>; references: ReferenceInfo[]; }` |
| <a id="toposortdirty"></a>`topoSortDirty` | fn | Topological order with dependencies before dependents (only imports edges internal to dirty; cycles tolerated — remaining files appended in arbitrary order). | `topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[]` |
| <a id="trimanalysisfilecache"></a>`trimAnalysisFileCache` | fn | — | `trimAnalysisFileCache(): void` |
| <a id="trimevalcache"></a>`trimEvalCache` | fn | — | `trimEvalCache(): void` |
| <a id="trimfnanalysiscache"></a>`trimFnAnalysisCache` | fn | — | `trimFnAnalysisCache(): void` |
| <a id="tryevalcall"></a>`tryEvalCall` | fn | — | `tryEvalCall( source: string, filePath: string, fnName: string, args: Abs[], opts: { envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi } = {}, ): Abs \| undefined` |
| <a id="tryevalcallfull"></a>`tryEvalCallFull` | fn | — | `tryEvalCallFull( source: string, filePath: string, fnName: string, args: Abs[], opts: { collectCalls?: boolean; collectMemberDiags?: boolean; envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi; } = {}, )` |
| <a id="tryruneval"></a>`tryRunEval` | fn | — | `tryRunEval( source: string, filePath: string, opts: { maxLoopIters?: number; mode?: "exec" \| "analyze"; envNames?: string[]; mocks?: Record<string, Abs>; lenientGlobals?: boolean; } = {}, ): EvalRunResult \| undefined` |
| <a id="typebinding"></a>`TypeBinding` | type | — | `TypeBinding = { name: string; type: string }` |
| <a id="typeexprtodirective"></a>`typeExprToDirective` | fn | — | `typeExprToDirective(expr: string): string` |
| <a id="unifieddiff"></a>`unifiedDiff` | fn | — | `unifiedDiff(a: string, b: string, path: string): string` |
| <a id="validateschemanode"></a>`validateSchemaNode` | fn | — | `validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult` |
| <a id="writedraftresult"></a>`WriteDraftResult` | type | — | `WriteDraftResult = { draftPath: string; written: boolean; changed: boolean; draftable: boolean; draftSource: string; }` |
| <a id="writeinterfacedraft"></a>`writeInterfaceDraft` | fn | — | `writeInterfaceDraft( filePath: string, draftSource: string, opts: { dryRun?: boolean; projectDir?: string; entries?: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>; draftable?: boolean; } = {}, ): WriteDraftResult` |
| <a id="zodmoduleprojection"></a>`ZodModuleProjection` | type | — | `ZodModuleProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
<!-- NUDO-API-SKELETON:END -->
