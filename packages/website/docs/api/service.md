---
sidebar_position: 3
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

`externalCallRecords` accepts call records harvested by [`collectCallRecords`](#collectcallrecords) from usage-site files (tests, examples, upstream apps). Records that resolve to functions defined in this file are matched and injected as synthesized `call@L` cases — see the [Call-Site Discovery guide](/docs/guides/callsite-discovery).

Functions without `@nudo:case` directives are not skipped: whole-program inference synthesizes a `call@L` case for each observed call site, or an `entry@L` case with `T.unknown` parameters when no call site is found (marked `entryOnly` on the [`FunctionAnalysis`](#functionanalysis)).

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

Pass the returned records to `analyzeFile`/`analyzeFileAsync` as `externalCallRecords` to have them injected as `call@L` cases. See [Call-Site Discovery — Programmatic API](/docs/guides/callsite-discovery#programmatic-api) for the two-phase flow.

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
): TypeValue | null
```

Returns the TypeValue at the given source position (1-based line, 0-based column). Uses the active case index per function when position is inside a function with cases.

**Returns:** `TypeValue` or `null` if no type at that position.

---

## getTypeAtPositionAsync

```typescript
getTypeAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>
): Promise<TypeValue | null>
```

Async entry to `getTypeAtPosition` with path-env preloading (see [`analyzeFileAsync`](#analyzefileasync)).

**Returns:** `Promise<TypeValue | null>`

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

## buildModuleGraph

```typescript
buildModuleGraph(files: string[]): {
  imports: Map<string, Set<string>>;    // file → files it imports
  dependents: Map<string, Set<string>>; // file → files importing it
}
```

Statically extracts each file's relative import edges — the building block for incremental analysis. Extension resolution matches module resolution (`''`, `.js`, `.ts`, `.mjs`); bare npm specifiers are skipped. Both the CLI's watch mode and the LSP's dirty propagation build a graph over their known files this way.

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

## typeValueToTSType

```typescript
typeValueToTSType(tv: TypeValue): string
```

Serializes a TypeValue to TypeScript type syntax (e.g. `number`, `string | number`, `{ id: number; name: string }`).

---

## generateDts

```typescript
generateDts(result: AnalysisResult): string
```

Generates TypeScript declaration content (`.d.ts`) from an analysis result. Produces `declare function` signatures with real parameter names, inferred return types, and JSDoc comments.

---

## typeValueToZodSchema

```typescript
typeValueToZodSchema(tv: TypeValue): string
```

Converts a TypeValue to a Zod schema string. Handles all type kinds including primitives, literals, objects, arrays, tuples, unions, and more.

**Example:**
```typescript
typeValueToZodSchema(T.object({ name: T.string, age: T.number }))
// → "z.object({ name: z.string(), age: z.number() })"
```

---

## generateGuardFunction

```typescript
generateGuardFunction(name: string, tv: TypeValue): string
```

Generates a zero-dependency runtime type guard function as a string. The generated function uses `typeof`, `Array.isArray`, and property checks for validation.

**Example:**
```typescript
generateGuardFunction("isUser", T.object({ name: T.string }))
// → "function isUser(data) { ... }"
```

---

## Result Types

### AnalysisResult

```typescript
type AnalysisResult = {
  functions: FunctionAnalysis[];
  diagnostics: Diagnostic[];
  bindings: Map<string, BindingInfo>;
  nodeTypeMap: Map<Node, TypeValue>;
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
  combined?: TypeValue;        // union of case results
  assertionErrors?: string[]; // @nudo:returns failures
  entryOnly?: boolean;         // synthesized entry@L case, no call sites found
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
  args: TypeValue[];
  result: TypeValue;
  throws: TypeValue;
  throwLoc?: SourceLocation;
  source?: "directive" | "callsite"; // hand-written @nudo:case or synthesized call@L
  aggregatedFrom?: number;           // additional call sites folded into a symbolic case
}
```

### CallRecord

One observed call at a usage site, harvested by [`collectCallRecords`](#collectcallrecords):

```typescript
type CallRecord = {
  fnName: string;             // callee name observed at the call site
  argTypes: TypeValue[];      // argument types as observed
  resultType: TypeValue;      // observed result type
  throws: TypeValue;          // observed throw type
  callLoc?: { line: number; column: number }; // call position; line becomes the call@L case name
  targetModule?: string;      // module the callee was bound from
  targetExport?: string;      // export name the callee was bound as
  targetAliases?: string[];   // later re-export names (barrels, CJS forwarding shims)
  fnModule?: string;          // module whose evaluation created the function value (definition site)
}
```

The `targetModule`/`targetExport`/`fnModule` fields drive the attribution gate: a record only matches files its module actually points at, so same-named helpers in test files cannot smear their records across unrelated files. See [Call-Site Discovery — Safety Design](/docs/guides/callsite-discovery#safety-design).

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
  code?: string;                  // e.g. "nudo:unknown-recv", "nudo:mock-invalid", "nudo-unreachable", "nudo-assertion-failed"
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
  type: TypeValue;
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
