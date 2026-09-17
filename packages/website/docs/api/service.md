---
sidebar_position: 3
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
  externalCallRecords?: CallRecord[]
): AnalysisResult
```

Runs type inference on a file. Uses `filePath` for module resolution and diagnostics. `activeCases` maps function name → case index for diagnostics (e.g. which case is “active” in the IDE).

`externalCallRecords` accepts call records harvested by [`collectCallRecords`](#collectcallrecords) from usage-site files (tests, examples, upstream apps). Records that resolve to functions defined in this file are matched and injected as synthesized `call@L` cases — see the [Call-Site Discovery guide](../guides/callsite-discovery.md).

Functions without `@nudo:case` directives are not skipped: whole-program inference synthesizes a `call@L` case for each observed call site, or an `entry@L` case with `unknown` parameters when no call site is found (marked `entryOnly` on the [`FunctionAnalysis`](#functionanalysis)).

**Returns:** `AnalysisResult`

---

## analyzeFileAsync

```typescript
analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[]
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

Extension gate shared by the CLI collector, watch mode, and the LSP `isNudoFile` check: `.js`/`.mjs`/`.ts` (case-insensitive) are inference targets; `.d.ts`, `.tsx`, and everything else are not.

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

Per-function slice of [`generateDts`](#generatedts) — JSDoc plus one `export declare function` line. The CLI's `infer --dts` / `watch --dts` share this exact function with `generateDts`, so both paths emit byte-identical declarations. Functions without cases emit nothing (or a rest-args `(...args: unknown[])` line when only `combined` is known); `noDeclaration` functions (CJS `exports.X = fn`) emit nothing and stay in infer/JSON output only.

---

## absToZodSchema

```typescript
absToZodSchema(a: Abs): string
```

Converts an Abs to a Zod schema string. Handles all shape kinds including primitives, literals, objects, arrays, tuples, unions, and more.

**Example:**
```typescript
absToZodSchema(obj({ name: str(), age: num() }))
// → "z.object({ name: z.string(), age: z.number() })"
```

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

The case-emitter functions freeze synthesized `call@L` cases into source text. The CLI's `--emit-cases` is a thin orchestration over them — see the [CLI guide — Persisting cases as directives](../guides/cli.md#persisting-cases-as-directives) for the workflows and merge policy.

### serializeCaseArg

```typescript
serializeCaseArg(a: Abs): string | null
```

Serializes a single Abs into expression text that the directive grammar (`parseCaseArgExpr`) can read back. Returns `null` for shapes directives cannot express: function, promise (eff), and brand values, `bigint` literals, non-finite / scientific-notation numbers, and strings/object keys containing structural characters or control characters.

**Example:**
```typescript
serializeCaseArg(num())     // → "T.number" (legacy T.* spelling round-trips)
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
// → ' * @nudo:case "call@L2" (T.string)'
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
      infer/JSON output still reports them */
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
