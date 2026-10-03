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
> Generated by `pnpm run docs:gen:api` from package export surfaces (`PUBLIC_API.md` / `src/index.ts`) — do not edit this block. Regenerate with `node scripts/gen-api-docs.mjs`. Summaries quote the source JSDoc first sentence as-is — CJK text means the symbol's doc is not yet English, and `—` means no JSDoc at all. Each row's name carries a stable anchor `#slug` (the lowercased symbol name).

Includes the `@nudojs/service` (`src/index.ts`) face and public emit faces re-exported from `@nudojs/service/emit`.

| Name | Kind | Summary | Signature |
|------|------|------|------|
| <a id="absgraphoptions"></a>`AbsGraphOptions` | type | — | `AbsGraphOptions = { loadModule?: AbsLoadModule; seedVars?: Record<string, Abs>; seedFns?: Record<string, { params: string[]; body: Node; ...` |
| <a id="absmockseeds"></a>`AbsMockSeeds` | type | — | `AbsMockSeeds = { seedVars: Record<string, Abs>; seedFns: Record<string, { params: string[]; body: Node; async?: boolean; fingerprint?: st...` |
| <a id="absmodulecacheentry"></a>`AbsModuleCacheEntry` | type | 会话级依赖模块缓存条目：自身 stat 指纹 + 子树内容指纹 + 导出 + 子树装载 issue。 | `AbsModuleCacheEntry = { mtimeMs: number; size: number; contentHash: string; depFingerprints: AbsModuleDepFingerprint[]; exports: AbsModul...` |
| <a id="absmoduledepfingerprint"></a>`AbsModuleDepFingerprint` | type | 单条本地依赖的内容指纹：解析后稳定路径 + 求值时源码的 hashSource （与 loadModuleDepsFingerprint 同一 hash 口径，DESIGN-002 不另起第二套）。 | `AbsModuleDepFingerprint = { path: string; hash: string }` |
| <a id="absmodulegraphresult"></a>`AbsModuleGraphResult` | type | — | `AbsModuleGraphResult = { modules: Record<string, AbsModuleExports>; byPath: Map<string, AbsModuleExports>; issues: AbsModuleLoadIssue[]; }` |
| <a id="absmoduleloadissue"></a>`AbsModuleLoadIssue` | type | 模块加载守卫：与 TypeValue loadModuleEnv 口径对齐，供 analyzer 映射诊断 | `AbsModuleLoadIssue = { kind: "cycle" \| "depth" \| "missing" \| "missing-export" \| "exports-unresolved"; label: string; reason: string; }` |
| <a id="abstoschemanode"></a>`absToSchemaNode` | fn | Abs → SchemaNode + dropped（优先 core absToConstraint；失败则 shape 尽力） | `absToSchemaNode(a: Abs)` |
| <a id="abstoschemasource"></a>`absToSchemaSource` | fn | — | `absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string` |
| <a id="abstostandardschema"></a>`absToStandardSchema` | fn | 便捷：单个 Abs → 单导出模块（默认导出名 `schema`）。 | `absToStandardSchema( a: Abs, opts?: { name?: string }, ): StandardSchemaModuleProjection` |
| <a id="abstostandardschemamodule"></a>`absToStandardSchemaModule` | fn | Abs → Standard Schema v1 模块源码。 | `absToStandardSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): StandardSchemaModuleProjection` |
| <a id="abstotstype"></a>`absToTSType` | fn | Abs → TS 类型串。有损：pred / 非 lit term 落到 shape 基类型。 | `absToTSType(a: Abs, typeVars?: Map<string, string>): string` |
| <a id="abstozodschemamodule"></a>`absToZodSchemaModule` | fn | Abs 导出表 → 可 import 的 zod JS 模块源码。 | `absToZodSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): ZodModuleProjection` |
| <a id="addbudgetannotation"></a>`addBudgetAnnotation` | fn | `@nudo:budget forks=N` 注解 | `addBudgetAnnotation( source: string, fnName: string, forks = 64, )` |
| <a id="addthrowsannotation"></a>`addThrowsAnnotation` | fn | ") \|\| lines[j]!.trim().startsWith("//")) return j; j--; &#125; return i; &#125; &#125; return -1; &#125; /** 在函数 JSDoc 里插入一行 `* @nudo:throws <Kind>`（已存在则不重复） | `addThrowsAnnotation( source: string, fnName: string, kind: string, )` |
| <a id="ambientsourcesofsidecar"></a>`ambientSourcesOfSidecar` | fn | `lib.nudo.{js,mjs,ts}` → candidate ambient sources next to it | `ambientSourcesOfSidecar(sidecarPath: string): string[]` |
| <a id="analysis_abi"></a>`ANALYSIS_ABI` | const | 带包版本：升级 @nudojs/* 后旧 CheckJson 不得继续命中。 | `const ANALYSIS_ABI` |
| <a id="analysisconfig"></a>`analysisConfig` | fn | 归一化 `nudo.analysis`。默认 mode=exports（A1：无指令但有 export/侧车的文件 进 IDE 分析；`all` / `directives` 需显式配置）。 | `analysisConfig(config: NudoConfig \| null \| undefined): AnalysisConfig` |
| <a id="analysisconfig"></a>`AnalysisConfig` | type | — | `AnalysisConfig = { include: string[]; exclude: string[]; mode: AnalysisMode; diagnostics: DiagnosticsLevel; callSiteBudget: number; evalM...` |
| <a id="analysisfilecachekey"></a>`analysisFileCacheKey` | fn | — | `analysisFileCacheKey( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], analysisCfg?: { mode: string; evalMissingSlot: string; callSiteBudget: number; diagnostics: string; maxForks?: number; }, loadModule?: AnalyzeLoadModule, projectEnvNames?: string[], autoBind?: boolean, caseMode: DirectiveCaseMode = "all", )` |
| <a id="analysismode"></a>`AnalysisMode` | type | — | `AnalysisMode = "directives" \| "exports" \| "all"` |
| <a id="analysisresult"></a>`AnalysisResult` | type | — | `AnalysisResult = { functions: FunctionAnalysis[]; diagnostics: Diagnostic[]; bindings: Map<string, BindingInfo>; nodeAbsMap: Map<Node, Ab...` |
| <a id="analysissession"></a>`AnalysisSession` | type | — | `AnalysisSession = { evictForDependents(files: string[]): void; clear(): void; reset(): void; analyze( filePath: string, source: string, a...` |
| <a id="analyzeexportsfromsource"></a>`analyzeExportsFromSource` | fn | 分析单文件导出 + 内涵签名（source 由 host 提供） | `analyzeExportsFromSource( filePath: string, source: string, ): ModuleExports` |
| <a id="analyzefile"></a>`analyzeFile` | fn | 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。 | `analyzeFile( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): AnalysisResult` |
| <a id="analyzefileasync"></a>`analyzeFileAsync` | fn | Async entry to analyzeFile: preloads path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible synchronously in ESM — then runs the sync analysis, which picks the preloaded factories up from the env-loader cache. | `analyzeFileAsync( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): Promise<AnalysisResult>` |
| <a id="applybforkbudgetfromconfig"></a>`applyBForkBudgetFromConfig` | fn | 把 fork 预算写进 core（core 保持无 IO）。 | `applyBForkBudgetFromConfig( config: NudoConfig \| null \| undefined, env: NodeJS.ProcessEnv = process.env, ): number` |
| <a id="applymockmoduledirectives"></a>`applyMockModuleDirectives` | fn | Overlay `@nudo:mock-module` directives onto a modules map. | `applyMockModuleDirectives( base: Record<string, AbsModuleExports>, fileDirectives: FileDirective[], opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| <a id="applymockmoduledirectivesfromsource"></a>`applyMockModuleDirectivesFromSource` | fn | Source string → apply mock-module (CLI / one-shot hosts). | `applyMockModuleDirectivesFromSource( source: string, base: Record<string, AbsModuleExports>, opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| <a id="applysessioncacheconfig"></a>`applySessionCacheConfig` | fn | 接线 package.json#nudo.sessionCache（进程内 LRU 上限）并立刻 trim。 | `applySessionCacheConfig(config: NudoConfig \| null \| undefined): SessionCacheLimits` |
| <a id="applytextedits"></a>`applyTextEdits` | fn | 把 edits 应用到源码（按 start 从后往前） | `applyTextEdits(source: string, edits: TextEdit[]): string` |
| <a id="bindinginfo"></a>`BindingInfo` | type | — | `BindingInfo = { abs: Abs; loc?: SourceLocation; }` |
| <a id="bodyreadfield"></a>`BodyReadField` | type | — | `BodyReadField = { field: string; type: string; via: string; fields?: BodyReadField[]; }` |
| <a id="bodyreadfieldsfor"></a>`bodyReadFieldsFor` | fn | 某函数某形参的 body-read 字段类型（供 draft / quickfix） | `bodyReadFieldsFor( map: BodyReadTypes, fnName: string, paramName: string, ): BodyReadField[] \| undefined` |
| <a id="bodyreadtypes"></a>`BodyReadTypes` | type | — | `BodyReadTypes = Map<string, Map<string, BodyReadField[]>>` |
| <a id="buildcasedirective"></a>`buildCaseDirective` | fn | 组装单行 ` * @nudo:case "name" (a, b)` 指令文本（无尾换行）。 | `buildCaseDirective(name: string, argsAbs: Abs[]): string \| null` |
| <a id="buildmodulegraph"></a>`buildModuleGraph` | fn | Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). | `buildModuleGraph( files: string[], cache?: ModuleGraphCache, )` |
| <a id="callrecord"></a>`CallRecord` | type | — | — |
| <a id="casehint"></a>`CaseHint` | type | — | `CaseHint = { line: number; label: string; ok: boolean; }` |
| <a id="casejson"></a>`CaseJson` | type | — | `CaseJson = { version: 1; file: string; summary: { functions: number; externalFunctions: number; cases: number; diagnostics: number; }; fu...` |
| <a id="casejsoncase"></a>`CaseJsonCase` | type | — | `CaseJsonCase = { name: string; args: string[]; result: string; throws: string \| null; source: string \| null; aggregatedFrom?: number; arg...` |
| <a id="casejsonfunction"></a>`CaseJsonFunction` | type | — | `CaseJsonFunction = { name: string; loc: SourceLocation; entryOnly: boolean; noDeclaration?: boolean; cases: CaseJsonCase[]; combined?: st...` |
| <a id="caseresult"></a>`CaseResult` | type | — | `CaseResult = { name: string; argAbs: Abs[]; abs: Abs; throwsAbs: Abs; throwLoc?: SourceLocation; source?: "directive" \| "callsite"; expec...` |
| <a id="checkcachekey"></a>`checkCacheKey` | fn | check 报告键：abi + 相对路径 + 源码 sha + autoBind + **侧车 sha** + **@nudo:import / 传递契约依赖内容 sha**（依赖变更必须 miss）。 | `checkCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarContent?: string \| null; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; analysisCfg?: { mode?: string; evalMissingSlot?: string; callSiteBudget?: number; entryThrows?: string; ignoreThrows?: string; maxForks?: number; }; }, ): string` |
| <a id="checkconfig"></a>`checkConfig` | fn | package.json#nudo.check → 执法选项 | `checkConfig(config: NudoConfig \| null \| undefined): CheckConfig` |
| <a id="checkconfig"></a>`CheckConfig` | type | — | `CheckConfig = { entryThrows: "error" \| "warning" \| "off"; ignoreThrows: string[]; }` |
| <a id="clearabsmodulecache"></a>`clearAbsModuleCache` | fn | — | `clearAbsModuleCache(): void` |
| <a id="clearanalysisfilecache"></a>`clearAnalysisFileCache` | fn | — | `clearAnalysisFileCache(): void` |
| <a id="clearanalysissessioncaches"></a>`clearAnalysisSessionCaches` | fn | 清空全部会话级分析缓存（service + core）。 | `clearAnalysisSessionCaches(): void` |
| <a id="clearenvpathdeps"></a>`clearEnvPathDeps` | fn | — | `clearEnvPathDeps(): void` |
| <a id="clearevalcache"></a>`clearEvalCache` | fn | — | `clearEvalCache(): void` |
| <a id="clearfnanalysiscache"></a>`clearFnAnalysisCache` | fn | — | `clearFnAnalysisCache(): void` |
| <a id="clearpathenvcaches"></a>`clearPathEnvCaches` | fn | Host cache-clear hooks (CLI watch / vite / tests) must drop path-env modules too | `clearPathEnvCaches(): void` |
| <a id="collectabsbindingsfromgraph"></a>`collectAbsBindingsFromGraph` | fn | 收集顶层绑定名 → Abs（含相对 import / 裸包 harvest 注入）。 | `collectAbsBindingsFromGraph( source: string, filePath: string, opts: AbsGraphOptions = {}, ): Map<string, Abs>` |
| <a id="collectcallrecords"></a>`collectCallRecords` | fn | 调用点发现（阶段一）：在"使用现场"文件（测试 / 上层应用）中求值 顶层代码，收集它对（外部模块导出的）函数的调用记录。每条记录带 真实的实参类型与结果类型——后续 analyzeFile 将其注入合成 case， 使被使用方从 entry-only（参数全 unknown）升级为真实调用形态。 | `collectCallRecords(filePath: string, source: string): CallRecord[]` |
| <a id="collectdependencyspecs"></a>`collectDependencySpecs` | fn | 从 AST 收集静态相对依赖（ESM import + CJS require） | `collectDependencySpecs(ast: File): string[]` |
| <a id="collectenvglobals"></a>`collectEnvGlobals` | fn | — | `collectEnvGlobals(envNames: string[]): Record<string, Abs>` |
| <a id="collectenvmodules"></a>`collectEnvModules` | fn | — | `collectEnvModules(envNames: string[]): Record<string, AbsModuleExports>` |
| <a id="collectenvnames"></a>`collectEnvNames` | fn | — | `collectEnvNames(filePath: string, source: string, includeProject: boolean): string[]` |
| <a id="collectevaldiagnostics"></a>`collectEvalDiagnostics` | fn | 静态收集 求值引擎诊断。 | `collectEvalDiagnostics( source: string, extraKnown?: Iterable<string>, ): EvalDiagnostics` |
| <a id="collectevalreplacements"></a>`collectEvalReplacements` | fn | 收集 @nudo:replace + @nudo:as → transpile 注入表。 | `collectEvalReplacements( source: string, opts?: { diags?: DirectiveDiag[] }, )` |
| <a id="collectloaddepcontents"></a>`collectLoadDepContents` | fn | — | `collectLoadDepContents( filePath: string, source: string, loadModule: (spec: string, fromFile: string) => string \| undefined, )` |
| <a id="collectmissingexportissues"></a>`collectMissingExportIssues` | fn | named import / re-export 缺名 → missing-export issue。 | `collectMissingExportIssues( source: string, modules: Record<string, AbsModuleExports>, fromFile: string, ): AbsModuleLoadIssue[]` |
| <a id="collectparambodyaccesses"></a>`collectParamBodyAccesses` | fn | Draft-only：收集每个顶层函数形参上的成员读取键（`user.name` → name）。 | `collectParamBodyAccesses( source: string, ): Map` |
| <a id="collectparambodyreadtypes"></a>`collectParamBodyReadTypes` | fn | 收集每个函数形参成员读取 + 用法推断类型。 | `collectParamBodyReadTypes(source: string): BodyReadTypes` |
| <a id="collectskipreturns"></a>`collectSkipReturns` | fn | 每个带 `@nudo:skip` 的顶层函数 → 声明的返回 Abs；`null` = 未声明返回类型。 | `collectSkipReturns(source: string): Map<string, Abs \| null>` |
| <a id="collectstaticimports"></a>`collectStaticImports` | fn | 从入口文件沿静态相对 import/require 收集（仅类型事实，不是运行时加载器）。 | `collectStaticImports( entryFile: string, maxDepth = 8, ): Map<string, ModuleExports>` |
| <a id="completionitem"></a>`CompletionItem` | type | — | `CompletionItem = { label: string; kind: "property" \| "method" \| "variable"; detail?: string; }` |
| <a id="composedevalmodules"></a>`ComposedEvalModules` | type | 模块图组装的共享产物：analyzer 与 tryRunEval 走同一序列 （evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv → applyMockModule*），单一事实源，不再各自漂移。 | `ComposedEvalModules = { modules: Record<string, AbsModuleExports>; issues: AbsModuleLoadIssue[]; mockErrors: string[]; }` |
| <a id="composeevalmodules"></a>`composeEvalModules` | fn | 模块图组装单一入口：相对/harvest 模块图 → @nudo:env modules 并入 （手写 env wins，B8）→ @nudo:mock-module 覆盖。 | `composeEvalModules( source: string, filePath: string, opts: { envNames?: string[]; seedVars?: Record<string, Abs>; seedFns?: AbsGraphOptions["seedFns"]; loadModule?: LoadModule; fileDirectives?: FileDirective[]; } = {}, ): ComposedEvalModules` |
| <a id="computedirtyset"></a>`computeDirtySet` | fn | changed plus its transitive dependents (reverse-edge BFS); cycle-safe via visited. | `computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[]` |
| <a id="constraintsourceexpr"></a>`ConstraintSourceExpr` | type | — | `ConstraintSourceExpr = { expr: string; importFrom?: string; importName?: string; }` |
| <a id="constrainttoschemanode"></a>`constraintToSchemaNode` | fn | NudoConstraint → SchemaNode（与 absToConstraint 投影语义对齐） | `constraintToSchemaNode(c: NudoConstraint): SchemaNode` |
| <a id="currentbforkbudgetlimit"></a>`currentBForkBudgetLimit` | fn | 当前生效 fork 上限（调试/测试；与 core getEvalForkBudgetLimit 同源） | `currentBForkBudgetLimit(): number` |
| <a id="default_analysis_mode"></a>`DEFAULT_ANALYSIS_MODE` | const | ", ]; /** A1 产品默认：exports — 普通带导出的 .js 进 IDE；directives/all 需显式 | `const DEFAULT_ANALYSIS_MODE` |
| <a id="default_session_cache_limits"></a>`DEFAULT_SESSION_CACHE_LIMITS` | const | 保守默认：多项目共存时不悄悄吃内存（大仓请显式调高） | `const DEFAULT_SESSION_CACHE_LIMITS` |
| <a id="defaultabsloadmodule"></a>`defaultAbsLoadModule` | fn | 相对说明符 → 源码（与 defaultLoadModule 同一扩展名/入口候选表） | `defaultAbsLoadModule(spec: string, fromFile: string): string \| undefined` |
| <a id="defaultloadmodule"></a>`defaultLoadModule` | fn | 默认 loadModule：支持 .js/.mjs/.ts 与 index 入口。 | `defaultLoadModule(spec: string, fromFile: string): string \| undefined` |
| <a id="depcontent"></a>`DepContent` | type | — | `DepContent = { path: string; content: string \| null }` |
| <a id="derivedexport"></a>`DerivedExport` | type | — | `DerivedExport = { file: string; fn: string; paramNames: string[]; params: DerivedParam[]; returns?: { constraint: NudoConstraint; dsl: st...` |
| <a id="derivedparam"></a>`DerivedParam` | type | — | `DerivedParam = { name: string; constraint: NudoConstraint; dsl: string; prelude: string[]; imports: Array<{ name: string; from: string }>...` |
| <a id="derivefromroot"></a>`deriveFromRoot` | fn | 入口：对 filePath 做 root 驱动下行推导。 | `deriveFromRoot( filePath: string, opts: RootDeriveOpts = {}, ): RootDeriveResult` |
| <a id="detectentryvariantsfrompackagejson"></a>`detectEntryVariantsFromPackageJson` | fn | Detect browser/node dual faces in a parsed package.json. | `detectEntryVariantsFromPackageJson(pkg: unknown): EntryVariantFaces \| null` |
| <a id="diagnostic"></a>`Diagnostic` | type | — | `Diagnostic = { range: SourceLocation; severity: DiagnosticSeverity; message: string; tags?: DiagnosticTag[]; code?: string; suggestions?:...` |
| <a id="diagnosticseverity"></a>`DiagnosticSeverity` | type | — | `DiagnosticSeverity = "error" \| "warning" \| "info"` |
| <a id="diagnosticslevel"></a>`DiagnosticsLevel` | type | — | `DiagnosticsLevel = "off" \| "errors" \| "default" \| "verbose"` |
| <a id="diagnosticslevelforfile"></a>`diagnosticsLevelForFile` | fn | — | `diagnosticsLevelForFile(filePath: string): DiagnosticsLevel` |
| <a id="diagnostictag"></a>`DiagnosticTag` | type | — | `DiagnosticTag = "unnecessary"` |
| <a id="directivecasemode"></a>`DirectiveCaseMode` | type | `@nudo:case` 求值档： - `none`（默认）：不跑 case；有 case 的函数也走 entry@ 出签名（check / IDE） - `all`：逐 case 真跑（`nudo test` / CaseJson / freeze） - `selected`：只跑 `activeCases` 选中的那条（LSP selectCase） | `DirectiveCaseMode = "none" \| "all" \| "selected"` |
| <a id="diskcache"></a>`DiskCache` | fn | — | `DiskCache { private readonly root: string \| undefined; private readonly ns: string; enabled = false; constructor(opts: DiskCacheOptions) ...` |
| <a id="diskcacheoptions"></a>`DiskCacheOptions` | type | — | `DiskCacheOptions = { root?: string \| undefined; namespace: string; }` |
| <a id="diskcacheroot"></a>`diskCacheRoot` | fn | 磁盘缓存根（B3）：config.cache / NUDO_CACHE_DIR / 默认关 | `diskCacheRoot( config: NudoConfig \| null \| undefined, projectDir: string \| undefined, ): string \| undefined` |
| <a id="draftevidence"></a>`DraftEvidence` | type | DraftEvidence `body` = 仅来自函数体对形参的成员读取（草稿建议，非义务）。 | `DraftEvidence = "callsite" \| "directive" \| "symbolic" \| "body" \| "none"` |
| <a id="draftinterface"></a>`draftInterface` | fn | 为单文件顶层导出生成 interface 草稿（不写盘）。 | `draftInterface( filePath: string, opts: InterfaceDraftOpts = {}, ): Promise<InterfaceDraftResult>` |
| <a id="emitderivedfromroot"></a>`emitDerivedFromRoot` | fn | — | `emitDerivedFromRoot( rootFile: string, opts: { fnNames?: string[]; mode: "add" \| "update"; dryRun?: boolean; loadModule?: LoadModule; autoBind?: boolean; refreshExistingOnly?: boolean; }, ): EmitDerivedResult` |
| <a id="emitderivedresult"></a>`EmitDerivedResult` | type | — | `EmitDerivedResult = { sidecars: Array<{ file: string; sidecarPath: string; fn: string; written: boolean; changed: boolean; skipped?: "nam...` |
| <a id="emitinterface"></a>`emitInterface` | fn | 单文件 emit：分析 → 逐目标投影/自检 → 组装侧车内容 →（非 dryRun）写盘。 | `emitInterface( filePath: string, opts: EmitInterfaceOpts, ): Promise<EmitInterfaceResult>` |
| <a id="emitinterfaceopts"></a>`EmitInterfaceOpts` | type | — | `EmitInterfaceOpts = { fnNames?: string[]; mode: "add" \| "update"; all?: boolean; dryRun?: boolean; records?: CallRecord[]; source?: strin...` |
| <a id="emitinterfaceresult"></a>`EmitInterfaceResult` | type | — | `EmitInterfaceResult = { written: string[]; skipped: Array<{ fn: string; reason: EmitInterfaceSkipReason }>; changed: boolean; diff?: stri...` |
| <a id="emitinterfaceskipreason"></a>`EmitInterfaceSkipReason` | type | — | `EmitInterfaceSkipReason = \| "name-clash" \| "not-projectable" \| "not-an-export" \| "no-change" \| "emit-denied" \| "multi-declarator"` |
| <a id="emitresult"></a>`EmitResult` | type | — | `EmitResult = { source: string; changed: boolean; written: Array<{ fn: string; cases: string[] }>; skipped: Array<{ fn: string; reason: Em...` |
| <a id="emitskipreason"></a>`EmitSkipReason` | type | — | `EmitSkipReason = \| "hand-written" \| "already-generated" \| "entry-only" \| "no-serializable-cases" \| "no-declaration" \| "skipped"` |
| <a id="entryvariantfacegroup"></a>`EntryVariantFaceGroup` | type | One browser/node face pair, scoped to a subpath or field source. | `EntryVariantFaceGroup = { key: string; browser: string[]; node: string[]; }` |
| <a id="entryvariantfaces"></a>`EntryVariantFaces` | type | — | `EntryVariantFaces = { kind: "exports-conditions" \| "browser-field"; groups: Map<string, EntryVariantFaceGroup>; }` |
| <a id="entryvariantforfile"></a>`entryVariantForFile` | fn | Dual-entry info for an analyzed file: the owning package must declare a dual group (browser + node faces resolving to different files **in the same subpath / field source**) **and** this file must be one of that group's entry targets on exactly one face. | `entryVariantForFile(filePath: string): EntryVariantInfo \| null` |
| <a id="entryvariantinfo"></a>`EntryVariantInfo` | type | — | `EntryVariantInfo = { pkgPath: string; pkgDir: string; pkgName?: string; kind: "exports-conditions" \| "browser-field"; browserPaths: strin...` |
| <a id="entryvariantissue"></a>`EntryVariantIssue` | type | Host-facing info issue (CLI check / JSON) for one analyzed entry variant. | `EntryVariantIssue = { severity: "info"; code: "nudo:dual-entry"; message: string; suggestion: string; line: number; column: number; }` |
| <a id="entryvariantissueforfile"></a>`entryVariantIssueForFile` | fn | — | `entryVariantIssueForFile(filePath: string): EntryVariantIssue \| null` |
| <a id="envharvestconflict"></a>`EnvHarvestConflict` | type | Conflict when handwritten env overwrote a harvest module/export (B8). | `EnvHarvestConflict = { module: string; exports: string[]; defaultOverwritten: boolean; }` |
| <a id="envpathdependents"></a>`envPathDependents` | fn | 依赖该 env 模板的源文件列表 | `envPathDependents(envPath: string): string[]` |
| <a id="evalabsmodulegraph"></a>`evalAbsModuleGraph` | fn | 递归求值相对依赖 + 裸包 harvest，产出入口可用的 modules 表。 | `evalAbsModuleGraph( entrySource: string, entryFile: string, opts: AbsGraphOptions = {}, ): AbsModuleGraphResult` |
| <a id="evalbuiltinunknown"></a>`EvalBuiltinUnknown` | type | — | `EvalBuiltinUnknown = { name: string; range: EvalLoc }` |
| <a id="evaldiagnostics"></a>`EvalDiagnostics` | type | — | `EvalDiagnostics = { unreachable: EvalUnreachable[]; builtinUnknown: EvalBuiltinUnknown[]; }` |
| <a id="evalrunresult"></a>`EvalRunResult` | type | — | `EvalRunResult = { exports: Record<string, unknown>; modules: Record<string, AbsModuleExports>; memberDiags?: EvalMemberDiag[]; moduleIssu...` |
| <a id="evalunreachable"></a>`EvalUnreachable` | type | — | `EvalUnreachable = { range: EvalLoc }` |
| <a id="evictabsmodulecachefiles"></a>`evictAbsModuleCacheFiles` | fn | 键身份统一 stablePathKey（FIX-RESIDUAL-4）：跨盘符形态删除/命中一致 | `evictAbsModuleCacheFiles(paths: string[]): void` |
| <a id="evictanalysiscachesforfiles"></a>`evictAnalysisCachesForFiles` | fn | 依赖内容变更后：按入口文件定向逐出 service 层缓存。 | `evictAnalysisCachesForFiles(files: string[]): void` |
| <a id="evictanalysisfilecacheforfiles"></a>`evictAnalysisFileCacheForFiles` | fn | 依赖变更后：按入口文件逐出（查找与写入同走 stablePathKey） | `evictAnalysisFileCacheForFiles(files: string[]): number` |
| <a id="evictevalcacheforfiles"></a>`evictEvalCacheForFiles` | fn | 依赖文件变更后：逐出以这些文件为入口的 evaluator 缓存（键走 stablePathKey；两种 mode 槽一并清） | `evictEvalCacheForFiles(files: string[]): number` |
| <a id="evictfnanalysiscacheforfiles"></a>`evictFnAnalysisCacheForFiles` | fn | Dependency content changed: drop every per-fn entry for these entry files. | `evictFnAnalysisCacheForFiles(files: string[]): number` |
| <a id="evictprojectconfigmemo"></a>`evictProjectConfigMemo` | fn | 清空 findProjectConfig 目录链 memo（项目配置 watch 通道 / 测试隔离） | `evictProjectConfigMemo(): void` |
| <a id="extractfnconstraintsources"></a>`extractFnConstraintSources` | fn | — | `extractFnConstraintSources( sidecarSrc: string, fnName: string, )` |
| <a id="extractnudoimportspecs"></a>`extractNudoImportSpecs` | fn | 从源码提取 `@nudo:import` / `@nudo:import * as` 的 specifier | `extractNudoImportSpecs(source: string): string[]` |
| <a id="filterdiagnosticsbylevel"></a>`filterDiagnosticsByLevel` | fn | 按 analysis.diagnostics 档过滤 evaluator/check **显示路径**诊断。 | `filterDiagnosticsByLevel<T extends { severity: string; code?: string }>( diags: T[], level: DiagnosticsLevel, ): T[]` |
| <a id="findfndeclstart"></a>`findFnDeclStart` | fn | 在源码中找 `function <fn>` / `export function <fn>` / `const <fn> =` 的 JSDoc/声明行 | `findFnDeclStart(lines: string[], fnName: string): number` |
| <a id="findowningpackage"></a>`findOwningPackage` | fn | Nearest package.json walking up from the file's directory. | `findOwningPackage( fromFile: string, )` |
| <a id="findprojectconfig"></a>`findProjectConfig` | fn | — | `findProjectConfig( startDir: string, )` |
| <a id="formatderivedsection"></a>`formatDerivedSection` | fn | 组装生成段（组合式 + import + prelude）。 | `formatDerivedSection( row: DerivedExport, opts: { rootSidecarDir: string; targetSidecarDir: string; takenNames?: Iterable<string>; }, )` |
| <a id="formatdraftmodule"></a>`formatDraftModule` | fn | 草稿模块文本（人读 + 可复制到 *.nudo.js / *.nudo.ts） | `formatDraftModule( filePath: string, entries: InterfaceDraftEntry[], sidecarPath?: string, ): string` |
| <a id="formatdraftsummary"></a>`formatDraftSummary` | fn | — | `formatDraftSummary( sourceRel: string, draftRel: string, result: InterfaceDraftResult, write?: WriteDraftResult, ): string[]` |
| <a id="formatemitsummary"></a>`formatEmitSummary` | fn | emit 摘要行（CLI runInterfaceEmit 与 LSP agent 面共用；路径由调用方按 展示口径传入——CLI 传 cwd 相对、agent 传绝对路径）。 | `formatEmitSummary( sourcePath: string, sidecarRel: string, result: EmitInterfaceResult, ): string[]` |
| <a id="formatinterfacesurfaceline"></a>`formatInterfaceSurfaceLine` | fn | 单条 interface 打印行（CLI runInterface 与 LSP agent 面共用） | `formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string` |
| <a id="functionanalysis"></a>`FunctionAnalysis` | type | — | `FunctionAnalysis = { name: string; loc: SourceLocation; paramNames: string[]; formals?: FormalParam[]; cases: CaseResult[]; combinedAbs?:...` |
| <a id="generatedts"></a>`generateDts` | fn | — | `generateDts(result: AnalysisResult): string` |
| <a id="generatefunctiondtslines"></a>`generateFunctionDtsLines` | fn | 为单个函数生成 .d.ts 声明行（JSDoc + 单一 widen 主签名）。 | `generateFunctionDtsLines(fn: FunctionAnalysis): string[]` |
| <a id="generateguardfunction"></a>`generateGuardFunction` | fn | 兼容别名：Abs 路径唯一 | `generateGuardFunction(name: string, abs: Abs): string` |
| <a id="generateguardfunctionfromabs"></a>`generateGuardFunctionFromAbs` | fn | Abs 指称守卫（设计 §2.7）：保留 pred | `generateGuardFunctionFromAbs(name: string, abs: Abs): string` |
| <a id="getabsmodulecachesize"></a>`getAbsModuleCacheSize` | fn | 测试/诊断：当前条目数（≤ ABS_MODULE_CACHE_MAX） | `getAbsModuleCacheSize(): number` |
| <a id="getanalysisfilecachesize"></a>`getAnalysisFileCacheSize` | fn | — | `getAnalysisFileCacheSize(): number` |
| <a id="getanalysissession"></a>`getAnalysisSession` | fn | 进程内默认 AnalysisSession（LSP server / CLI watch / agent tools 共用） | `getAnalysisSession(): AnalysisSession` |
| <a id="getenvharvestconflictcollector"></a>`getEnvHarvestConflictCollector` | fn | Read-only peek for tests / nested restore. | `getEnvHarvestConflictCollector()` |
| <a id="getenvpathdepssize"></a>`getEnvPathDepsSize` | fn | 测试/诊断：反向依赖驻留规模 | `getEnvPathDepsSize(): number` |
| <a id="getevalcachesize"></a>`getEvalCacheSize` | fn | 测试/诊断：当前 evaluator run 缓存条目数（≤ getSessionCacheLimits().maxEvalRuns） | `getEvalCacheSize(): number` |
| <a id="getfnanalysiscachesize"></a>`getFnAnalysisCacheSize` | fn | 测试/诊断：当前条目数（≤ getSessionCacheLimits().maxFns） | `getFnAnalysisCacheSize(): number` |
| <a id="getpathenvcachesizes"></a>`getPathEnvCacheSizes` | fn | 测试/诊断：path-env 驻留规模（均 ≤ 对应上限） | `getPathEnvCacheSizes()` |
| <a id="getsessioncachelimits"></a>`getSessionCacheLimits` | fn | — | `getSessionCacheLimits( env: NodeJS.ProcessEnv = process.env, ): SessionCacheLimits` |
| <a id="ifacecachekey"></a>`ifaceCacheKey` | fn | effectiveInterface 表键（L1 Phase B，design-persistent-cache）。 | `ifaceCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarSource?: string \| undefined; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; }, ): string` |
| <a id="injectbindings"></a>`injectBindings` | fn | — | `injectBindings( source: string, bindings: TypeBinding[], )` |
| <a id="insertgeneratedcasedirectives"></a>`insertGeneratedCaseDirectives` | fn | 把 analysis 中的合成 case（source === "callsite"）固化为源码指令： 1. | `insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult` |
| <a id="interfaceconfig"></a>`interfaceConfig` | fn | 归一化 `nudo.contract` 配置段。 | `interfaceConfig(config: NudoConfig \| null \| undefined): InterfaceConfig` |
| <a id="interfaceconfig"></a>`InterfaceConfig` | type | — | `InterfaceConfig = { autoBind: boolean; emit: string[]; }` |
| <a id="interfacedraftentry"></a>`InterfaceDraftEntry` | type | — | `InterfaceDraftEntry = { fn: string; params: Array<{ name: string; constraint?: NudoConstraint; display: string; projected: boolean; bodyA...` |
| <a id="interfacedraftopts"></a>`InterfaceDraftOpts` | type | — | `InterfaceDraftOpts = { fnNames?: string[]; records?: CallRecord[]; loadModule?: LoadModule; autoBind?: boolean; bodyAccesses?: boolean; s...` |
| <a id="interfacedraftresult"></a>`InterfaceDraftResult` | type | — | `InterfaceDraftResult = { file: string; entries: InterfaceDraftEntry[]; draftSource: string; sidecarPath: string; }` |
| <a id="interfacesurface"></a>`interfaceSurface` | fn | 单文件 interface 表面：analyzer 推断结果给出函数清单与 implicit 展示， effectiveInterface 给出契约命中（手写 &gt; 生成段）。诊断 side-channel 在收尾时取走丢弃——打印命令不执法，interface-load 等错误留给 check 路径。 | `interfaceSurface( filePath: string, opts: InterfaceSurfaceOpts = {}, ): Promise<InterfaceSurfaceEntry[]>` |
| <a id="interfacesurfaceentry"></a>`InterfaceSurfaceEntry` | type | — | `InterfaceSurfaceEntry = { fn: string; kind: "export" \| "local"; source: "handwritten" \| "generated" \| "implicit"; params: Array<{ name: s...` |
| <a id="interfacesurfaceopts"></a>`InterfaceSurfaceOpts` | type | — | `InterfaceSurfaceOpts = { autoBind?: boolean; loadModule?: LoadModule; records?: CallRecord[]; source?: string; }` |
| <a id="isdraftableentry"></a>`isDraftableEntry` | fn | Parse-layer draftable: at least one entry has generated DSL and was not skipped | `isDraftableEntry(entries: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>): boolean` |
| <a id="isenvtemplatepath"></a>`isEnvTemplatePath` | fn | watch 门禁：env 模板变更必须可被接收（即便扩展名不进 isNudoTargetPath） | `isEnvTemplatePath(path: string): boolean` |
| <a id="isnudotargetpath"></a>`isNudoTargetPath` | fn | nudo 推断目标文件判定（纯扩展名规则，路径无需存在）。 | `isNudoTargetPath(path: string): boolean` |
| <a id="isprojectconfigpath"></a>`isProjectConfigPath` | fn | — | `isProjectConfigPath(path: string): boolean` |
| <a id="issidecarpath"></a>`isSidecarPath` | fn | Formal sidecar contracts only — drafts never ambient-bind and need not reanalyze | `isSidecarPath(path: string): boolean` |
| <a id="iswatchrelevantpath"></a>`isWatchRelevantPath` | fn | Watch accept gate: analysis targets + sidecar/config/env-template invalidators | `isWatchRelevantPath(path: string): boolean` |
| <a id="loadmodule"></a>`LoadModule` | type | — | `LoadModule = (spec: string, fromFile: string) => string \| undefined` |
| <a id="locfromnode"></a>`locFromNode` | fn | — | `locFromNode(node: Node): SourceLocation` |
| <a id="matchesemitallowlist"></a>`matchesEmitAllowlist` | fn | 极简 glob（`**` / `*` / `?`）：相对 projectDir 匹配**源文件**绝对路径 （不是侧车路径；侧车随源文件同目录写出）。无白名单 → true。 | `matchesEmitAllowlist( absPath: string, projectDir: string \| undefined, patterns: string[], ): boolean` |
| <a id="matchsidecarfndecl"></a>`matchSidecarFnDecl` | fn | 定位侧车里目标契约的声明起点：`export const <name> = fn(` / `<name> = fn(`。 | `matchSidecarFnDecl( sidecarSource: string, exportName: string, )` |
| <a id="materializeaction"></a>`materializeAction` | fn | kind → WorkspaceEdit 物化。返回 undefined = 该 action 只读（info）或缺证据。 | `materializeAction(input: MaterializeInput): QuickfixPlan \| undefined` |
| <a id="materializeinput"></a>`MaterializeInput` | type | — | `MaterializeInput = { code: string; fn?: string; file: string; source: string; sidecarText?: string; sidecarPath: string; action: CheckAct...` |
| <a id="mergeharvestoptions"></a>`MergeHarvestOptions` | type | — | `MergeHarvestOptions = { onConflict?: (c: EnvHarvestConflict) => void; }` |
| <a id="mergeharvestunderenv"></a>`mergeHarvestUnderEnv` | fn | Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping module keys and overlapping export names (docs/versioning.md B8 + website harvester API). | `mergeHarvestUnderEnv( harvestModules: Record<string, AbsModuleExports>, envModules: Record<string, AbsModuleExports>, opts?: MergeHarvestOptions, ): Record<string, AbsModuleExports>` |
| <a id="mockdirectivestoabsseeds"></a>`mockDirectivesToAbsSeeds` | fn | 从函数上的 @nudo:mock 指令收集 Abs seed | `mockDirectivesToAbsSeeds( functions: Array<{ directives: FunctionWithDirectives["directives"] }>, opts?: { fromFile?: string; loadModule?: LoadModule; }, ): AbsMockSeeds` |
| <a id="mockmoduleapplyresult"></a>`MockModuleApplyResult` | type | — | `MockModuleApplyResult = { modules: Record<string, AbsModuleExports>; errors: FromMockError[]; applied: boolean; }` |
| <a id="mockseedsforsource"></a>`mockSeedsForSource` | fn | 便捷入口：源码 → @nudo:mock 的 eval 注入 Abs 绑定（checkSource 注入管线用） | `mockSeedsForSource( source: string, opts?: { fromFile?: string; loadModule?: LoadModule }, ): Record<string, Abs>` |
| <a id="mockseedstoabsmocks"></a>`mockSeedsToAbsMocks` | fn | 求值引擎注入用：seedVars + seedFns 统一为 Abs 函数绑定。 | `mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs>` |
| <a id="moduleexports"></a>`ModuleExports` | type | — | `ModuleExports = { path: string; named: Map<string, string>; defaultExport?: string; source: string; poly: Map<string, PolyFn>; }` |
| <a id="modulegraphcache"></a>`ModuleGraphCache` | type | mtime 边缓存：key 为文件路径，edges 为已抽取的相对 import 边（与 buildModuleGraph 返回语义一致）。 | `ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>` |
| <a id="modulereaderror"></a>`ModuleReadError` | fn | 文件已解析但读失败（EACCES / EMFILE / EISDIR-race …）。 | `ModuleReadError extends Error { readonly code: string; readonly path: string; constructor(path: string, cause: unknown) { const code = (c...` |
| <a id="noteenvpathdeps"></a>`noteEnvPathDeps` | fn | 源码里的 path-based load specs 解析为绝对路径后登记反向边 | `noteEnvPathDeps(sourcePath: string, source: string): void` |
| <a id="nudoconfig"></a>`NudoConfig` | type | — | `NudoConfig = { env?: string[]; mocks?: Record<string, string>; contract?: { autoBind?: boolean; emit?: string[] \| string; }; analysis?: {...` |
| <a id="projectabstoschema"></a>`projectAbsToSchema` | fn | — | `projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): SchemaProjection` |
| <a id="projectconfigmemostats"></a>`projectConfigMemoStats` | fn | 诊断/测试：memo 条目数 + 实际读盘（readFileSync+JSON.parse）次数 | `projectConfigMemoStats()` |
| <a id="quickfixplan"></a>`QuickfixPlan` | type | — | `QuickfixPlan = { titleKind: QuickfixTitleKind; title: string; edits: TextEdit[]; sidecar?: { path: string; newText: string }; openPath?: ...` |
| <a id="quickfixtitlekind"></a>`QuickfixTitleKind` | type | — | `QuickfixTitleKind = "fix" \| "silence" \| "review" \| "adjust" \| "scaffold"` |
| <a id="referenceinfo"></a>`ReferenceInfo` | type | — | `ReferenceInfo = { name: string; loc: SourceLocation; uri?: string; }` |
| <a id="relativizepath"></a>`relativizePath` | fn | 稳定逻辑根相对化（磁盘缓存路径维）：树内相对 `root`，树外取 `node_modules/<pkg>` 段、monorepo root 或 pnpm store 内容哈希； 绝对路径明文绝不进 key。 | `relativizePath(p: string, root?: string): string` |
| <a id="resetallanalysiscaches"></a>`resetAllAnalysisCaches` | fn | 比 clearAnalysisSessionCaches 更彻底：再丢 AST LRU（测试 / 进程复用场景） | `resetAllAnalysisCaches(): void` |
| <a id="resetsessioncachelimitstate"></a>`resetSessionCacheLimitState` | fn | 测试：清空显式 / package.json 层（env 每次调用现读，无需重置） | `resetSessionCacheLimitState(): void` |
| <a id="resolvemodule"></a>`resolveModule` | fn | — | `resolveModule(source: string, fromDir: string)` |
| <a id="rootderiveopts"></a>`RootDeriveOpts` | type | — | `RootDeriveOpts = { loadModule?: LoadModule; autoBind?: boolean; fnNames?: string[]; refreshExistingOnly?: boolean; }` |
| <a id="rootderiveresult"></a>`RootDeriveResult` | type | — | `RootDeriveResult = { roots: string[]; derived: DerivedExport[]; hasRoot: boolean; graphError?: string; }` |
| <a id="safeloadmodule"></a>`safeLoadModule` | fn | loadModule 容错包装：读失败当 miss，避免 I/O 错误炸穿指纹/图遍历。 | `safeLoadModule( loadModule: (spec: string, fromFile: string) => string \| undefined, spec: string, fromFile: string, ): string \| undefined` |
| <a id="schemadialect"></a>`SchemaDialect` | type | — | `SchemaDialect = "zod"` |
| <a id="schemanode"></a>`SchemaNode` | type | — | `SchemaNode = \| { k: "lit"; value: import("@nudojs/core").LiteralValue } \| { k: "prim"; type: "number" \| "string" \| "boolean" \| "bigint" \|...` |
| <a id="schemanodetozod"></a>`schemaNodeToZod` | fn | — | `schemaNodeToZod(node: SchemaNode): string` |
| <a id="schemaprojection"></a>`SchemaProjection` | type | — | `SchemaProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
| <a id="schemarefinement"></a>`SchemaRefinement` | type | — | `SchemaRefinement = \| { kind: "numBound"; op: "gt" \| "ge" \| "lt" \| "le"; n: number } \| { kind: "int" } \| { kind: "strMin"; n: number } \| {...` |
| <a id="serializecasearg"></a>`serializeCaseArg` | fn | 单个 Abs → parseCaseArgExpr 可解析回去的表达式文本；不可表达返回 null | `serializeCaseArg(a: Abs): string \| null` |
| <a id="serializecasejson"></a>`serializeCaseJson` | fn | — | `serializeCaseJson( result: AnalysisResult, file: string, ): CaseJson` |
| <a id="sessioncachelimits"></a>`SessionCacheLimits` | type | 会话级内存 LRU 上限（进程内，非磁盘 cache）。 | `SessionCacheLimits = { maxFiles: number; maxFns: number; maxEvalRuns: number; }` |
| <a id="setanalysissession"></a>`setAnalysisSession` | fn | 测试：替换默认 session（返回旧值以便恢复） | `setAnalysisSession(session: AnalysisSession \| undefined): AnalysisSession \| undefined` |
| <a id="setenvharvestconflictcollector"></a>`setEnvHarvestConflictCollector` | fn | Install conflict collector; returns the previous one so nested/concurrent analyzeFile callers can save/restore (scoped fallback: inside runWithCollectorScope each analysis gets its own slot, no cross-talk). | `setEnvHarvestConflictCollector( collector: ((c: EnvHarvestConflict) => void) \| null, )` |
| <a id="setsessioncachefromproject"></a>`setSessionCacheFromProject` | fn | package.json#nudo.sessionCache 层（findProjectConfig / 宿主接线） | `setSessionCacheFromProject(partial: PartialLimits \| null \| undefined): void` |
| <a id="setsessioncachelimits"></a>`setSessionCacheLimits` | fn | 显式覆盖（宿主 / 测试）。传 null 清除显式层 | `setSessionCacheLimits(partial: PartialLimits \| null): SessionCacheLimits` |
| <a id="sha256hex"></a>`sha256Hex` | fn | — | `sha256Hex(data: string \| Buffer): string` |
| <a id="shapedslfromfields"></a>`shapeDslFromFields` | fn | `shape({ type: string(), loc: shape({ start: … }) })` 文本。 | `shapeDslFromFields(fields: BodyReadField[]): string` |
| <a id="shouldanalyzefile"></a>`shouldAnalyzeFile` | fn | 是否应对该文件跑分析（自动路径，如 LSP validate）。 | `shouldAnalyzeFile( filePath: string, source: string \| undefined, config?: AnalysisConfig, ): boolean` |
| <a id="sidecarbindingfor"></a>`sidecarBindingFor` | fn | 侧车里导出名 → 模块绑定名（DESIGN-003 别名段：`export { _nudo_1 as class }`）。 | `sidecarBindingFor(sidecarSource: string, exportName: string): string \| undefined` |
| <a id="sidecardraftpath"></a>`sidecarDraftPath` | fn | `lib.js\|ts` → `lib.nudo.draft.js\|ts`（不进 ambient sidecar 表） | `sidecarDraftPath(filePath: string): string` |
| <a id="sourcehasnudodirectives"></a>`sourceHasNudoDirectives` | fn | — | `hasNudoDirectives(source: string): boolean` |
| <a id="sourcelocation"></a>`SourceLocation` | type | — | `SourceLocation = { start: { line: number; column: number }; end: { line: number; column: number }; }` |
| <a id="stablepathkey"></a>`stablePathKey` | const | — | — |
| <a id="stablepathkeygraph"></a>`stablePathKeyGraph` | const | — | — |
| <a id="standardschemaissue"></a>`StandardSchemaIssue` | type | — | `StandardSchemaIssue = { message: string; path?: ReadonlyArray<PropertyKey>; }` |
| <a id="standardschemamoduleprojection"></a>`StandardSchemaModuleProjection` | type | — | `StandardSchemaModuleProjection = { source: string; dropped: string[]; }` |
| <a id="standardschemaresult"></a>`StandardSchemaResult` | type | — | `StandardSchemaResult = \| { value: unknown; issues?: undefined } \| { issues: ReadonlyArray<StandardSchemaIssue>; value?: undefined }` |
| <a id="stripgeneratedcasedirectives"></a>`stripGeneratedCaseDirectives` | fn | 从源码剥离所有本模块生成的 @nudo:case 指令（名字以 call@ 开头，整行删除）。 | `stripGeneratedCaseDirectives(source: string)` |
| <a id="symbolinfo"></a>`SymbolInfo` | type | — | `SymbolInfo = { name: string; kind: "function" \| "variable" \| "class" \| "parameter"; loc: SourceLocation; uri?: string; }` |
| <a id="symboltable"></a>`SymbolTable` | type | — | `SymbolTable = { definitions: Map<string, SymbolInfo>; references: ReferenceInfo[]; }` |
| <a id="textedit"></a>`TextEdit` | type | — | `TextEdit = { startLine: number; startCol: number; endLine: number; endCol: number; newText: string; }` |
| <a id="titlekindfor"></a>`titleKindFor` | fn | kind → 标注（Fix all 不得把 silence 当修复） | `titleKindFor(code: string, action: CheckAction): QuickfixTitleKind` |
| <a id="toposortdirty"></a>`topoSortDirty` | fn | Topological order with dependencies before dependents (only imports edges internal to dirty; cycles tolerated — remaining files appended in arbitrary order). | `topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[]` |
| <a id="trimanalysisfilecache"></a>`trimAnalysisFileCache` | fn | 立刻压到当前 maxFiles（调低上限时收内存） | `trimAnalysisFileCache(): void` |
| <a id="trimevalcache"></a>`trimEvalCache` | fn | 立刻压到当前 maxEvalRuns（调低上限时收内存） | `trimEvalCache(): void` |
| <a id="trimfnanalysiscache"></a>`trimFnAnalysisCache` | fn | 立刻压到当前 maxFns（调低上限时收内存） | `trimFnAnalysisCache(): void` |
| <a id="tryevalcall"></a>`tryEvalCall` | fn | 求值引擎求值具名导出（仅成功结果） | `tryEvalCall( source: string, filePath: string, fnName: string, args: Abs[], opts: { envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi; loadModule?: LoadModule; depKey?: string \| null; } = {}, ): Abs \| undefined` |
| <a id="tryevalcallfull"></a>`tryEvalCallFull` | fn | 求值引擎求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录。 | `tryEvalCallFull( source: string, filePath: string, fnName: string, args: Abs[], opts: { collectCalls?: boolean; collectMemberDiags?: boolean; envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi; loadModule?: LoadModule; depKey?: string \| null; } = {}, )` |
| <a id="tryruneval"></a>`tryRunEval` | fn | 模块图 + runTranspiled（默认 analyze 模式） | `tryRunEval( source: string, filePath: string, opts: { maxLoopIters?: number; mode?: "exec" \| "analyze"; envNames?: string[]; mocks?: Record<string, Abs>; lenientGlobals?: boolean; loadModule?: LoadModule; depKey?: string \| null; composed?: ComposedEvalModules; } = {}, ): EvalRunResult \| undefined` |
| <a id="typebinding"></a>`TypeBinding` | type | — | `TypeBinding = { name: string; type: string }` |
| <a id="typeexprtodirective"></a>`typeExprToDirective` | fn | agent 面类型表达式 → `@nudo:as` 文法 | `typeExprToDirective(expr: string): string` |
| <a id="unifieddiff"></a>`unifiedDiff` | fn | 行级 unified diff：`--- a/path` 头 + `@@` hunk + 上下文 3 行；相同返回 "" | `unifiedDiff(a: string, b: string, path: string): string` |
| <a id="validateschemanode"></a>`validateSchemaNode` | fn | SchemaNode 同步校验（生成模块与测试共用语义）。 | `validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult` |
| <a id="wrapreturnnullable"></a>`wrapReturnNullable` | fn | 侧车 return 契约包一层 `nullable(...)`（nullish 臂违例的机械修法）。 | `wrapReturnNullable( sidecarSource: string, fnName: string, ): string \| undefined` |
| <a id="writedraftresult"></a>`WriteDraftResult` | type | — | `WriteDraftResult = { draftPath: string; written: boolean; changed: boolean; draftable: boolean; draftSource: string; }` |
| <a id="writeinterfacedraft"></a>`writeInterfaceDraft` | fn | 写入 `*.nudo.draft.js`（覆盖草稿文件本身；不碰正式 `*.nudo.js`）。 | `writeInterfaceDraft( filePath: string, draftSource: string, opts: { dryRun?: boolean; projectDir?: string; entries?: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>; draftable?: boolean; } = {}, ): WriteDraftResult` |
| <a id="zodmoduleprojection"></a>`ZodModuleProjection` | type | — | `ZodModuleProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
<!-- NUDO-API-SKELETON:END -->
