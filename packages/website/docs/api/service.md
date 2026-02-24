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
  activeCases?: Map<string, number>
): AnalysisResult
```

Runs type inference on a file. Uses `filePath` for module resolution and diagnostics. `activeCases` maps function name → case index for diagnostics (e.g. which case is “active” in the IDE).

**Returns:** `AnalysisResult`

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

Generates TypeScript declaration content (`.d.ts`) from an analysis result. Produces `declare function` signatures for each function and case.

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
}
```

### FunctionAnalysis

```typescript
type FunctionAnalysis = {
  name: string;
  loc: SourceLocation;
  cases: CaseResult[];
  combined?: TypeValue;        // union of case results
  assertionErrors?: string[]; // @nudo:returns failures
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
}
```

### Diagnostic

```typescript
type Diagnostic = {
  range: SourceLocation;
  severity: "error" | "warning" | "info";
  message: string;
  tags?: DiagnosticTag[];
}
```

### CompletionItem

```typescript
type CompletionItem = {
  label: string;
  kind: "property" | "method" | "variable";
  detail?: string;
}
```
