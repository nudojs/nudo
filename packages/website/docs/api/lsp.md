---
sidebar_position: 6
---

# @nudojs/lsp

API reference for the Nudo Language Server Protocol package. `@nudojs/lsp` wraps the [service layer](./service.md) into a language server that editors can consume: diagnostics, hover types, completions, case-switching CodeLens, inlay hints, and symbol navigation. The [nudo-vscode extension](../guides/vscode.md) launches this server over IPC to power all of its editor features.

## Package Layout

The package entry point (`main`) is `src/server.ts` — **importing it starts the server**: it calls `createConnection(ProposedFeatures.all)` and `connection.listen()` as a module side effect, speaking LSP over stdio/IPC. There is no `createServer()`-style factory.

The testable programmatic API lives in three sibling source modules, deliberately extracted from `server.ts` so they can be exercised without a live LSP connection:

| Module | Purpose |
|--------|---------|
| `src/validation.ts` | Diagnostics pipeline, analysis cache, dirty propagation, Nudo-file detection |
| `src/symbols.ts` | Symbol table construction, definition/reference lookup for navigation handlers |
| `src/semantic-tokens.ts` | Semantic-token legend and delta encoder |

`server.ts` wires those functions to `connection` / `documents`; tests wire them to fakes.

## validation.ts

### validateText

```typescript
validateText(
  filePath: string,
  uri: string,
  text: string,
  version: number,
  deps: ValidateTextDeps,
  propagate?: boolean,           // default false
): Promise<void>
```

Analyzes one document end to end:

1. **Gate** — if `deps.isNudoUri` is provided and rejects the URI, publishes an empty diagnostic list and returns.
2. **Analyze** — runs `analyzeFileAsync` from `@nudojs/service` (the async entry, so path-based `/// @nudo:env` files preload via dynamic import). Analysis errors are published as a single error diagnostic (`Analysis error: <message>`) instead of throwing.
3. **Publish** — maps each `AnalysisResult` diagnostic to an LSP diagnostic: severity `error`/`warning`/`info`, `source: "nudo"`, the diagnostic `code`, `unnecessary` tags, and `origin` provenance mapped to `relatedInformation` (`"value originates here"`, 1-based positions converted to 0-based).
4. **Cache** — stores the result in `analysisCache` (keyed by file path, versioned) and records the file in `knownFiles`.
5. **Propagate** — when `propagate` is `true` and `getOpenDocumentByPath` is provided, builds the module graph over `knownFiles`, computes the dirty set from the changed file, and revalidates each *open* dependent once with `propagate = false` — dirt never cascades further.

`ValidateTextDeps` is a dependency-injection record, which is what makes the pipeline testable outside a real connection:

```typescript
type ValidateTextDeps = {
  sendDiagnostics: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void;
  isNudoUri?: (uri: string) => boolean;
  getActiveCases?: (uri: string) => Map<string, number>;
  getOpenDocumentByPath?: (filePath: string) => OpenDocumentLike | undefined;
};

type OpenDocumentLike = {
  uri: string;
  version: number;
  getText(): string;
};
```

Example — validate a buffer with fakes (as the package tests do):

```typescript
import { validateText } from "@nudojs/lsp/src/validation.ts";

const sent = new Map<string, LspDiagnostic[]>();
await validateText("/src/app.js", "file:///src/app.js", source, 1, {
  sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
});
```

The package declares no `exports` map and ships its TypeScript sources, so the modules import by path (`@nudojs/lsp/src/validation.ts`, `src/symbols.ts`, `src/semantic-tokens.ts`) through a TS-aware loader such as `tsx` — the same loader the VS Code extension uses to run the server itself.

### getCachedOrAnalyze

```typescript
getCachedOrAnalyze(
  filePath: string,
  source: string,
  version: number,
  activeCases?: Map<string, number>,
): AnalysisResult
```

Synchronous, cache-aware analysis for high-frequency handlers (hover, completion). Returns the cached `AnalysisResult` when the document version matches; otherwise runs the sync `analyzeFile` and refreshes the cache. Path-based `@nudo:env` files degrade on this path — the async preload only happens inside `validateText`.

### hasNudoDirectives

```typescript
hasNudoDirectives(source: string): boolean
```

Returns `true` when the source contains any Nudo directive: `@nudo:case`, `@nudo:mock`, `@nudo:pure`, `@nudo:skip`, `@nudo:sample`, `@nudo:returns`, `@nudo:env`, `@nudo:mock-module`, `@nudo:as`, or `@nudo:replace`. The server uses it (plus a `.js` / `.ts` / `.mjs` extension check) as the `isNudoFile` gate — every feature handler below is a no-op for files that fail it.

### uriToFilePath

```typescript
uriToFilePath(uri: string): string
```

Strips a `file://` prefix (and decodes percent escapes); non-`file://` URIs are returned unchanged.

### Module state

| Export | Type | Purpose |
|--------|------|---------|
| `analysisCache` | `Map<string, { version: number; result: AnalysisResult }>` | Per-file analysis results, keyed by file path, versioned from `TextDocument.version` |
| `knownFiles` | `Set<string>` | Every file analyzed successfully in this session — the node set for dirty propagation |
| `clearValidationState()` | `() => void` | Test hook — resets both |

## symbols.ts

Backs the go-to-definition, references, and rename handlers. Types (`SymbolTable`, `SymbolInfo`, `ReferenceInfo`) come from `@nudojs/service`.

```typescript
buildSymbolTable(ast: Node, uri: string): SymbolTable;
findDefinition(symbolTable: SymbolTable, name: string): SymbolInfo | null;
findReferences(symbolTable: SymbolTable, name: string): ReferenceInfo[];
findIdentifierAtPosition(ast: Node, line: number, column: number): string | null;
```

`findIdentifierAtPosition` takes a **1-based line** and 0-based column, matching parser locations. Traversal failures on partial ASTs are swallowed — the functions degrade to empty results instead of throwing.

## semantic-tokens.ts

```typescript
encodeSemanticTokens(tokens: SemanticToken[]): number[];
```

Delta-encodes `{ line, char, length, typeIndex, modifierBitmask }` tokens into the flat `number[]` the LSP expects. `TOKEN_TYPES` (`function`, `variable`, `parameter`, `property`, `type`, `keyword`, `string`, `number`, `comment`, `decorator`) and `TOKEN_MODIFIERS` (`declaration`, `readonly`, `deprecated`, `unreachable`) form the server's declared legend. The server's semanticTokens handler currently returns an empty token set — the legend and encoder are in place for richer highlighting later.

## Server Capabilities

What `src/server.ts` actually registers (`connection.onInitialize`):

| Capability | Handler | Behavior |
|------------|---------|----------|
| Hover | `onHover` | Inferred type at cursor via `getTypeAtPosition`, rendered as a fenced `nudo` markdown code block |
| Completion (trigger `.`) | `onCompletion` | Property/method/variable items from `getCompletionsAtPosition` |
| CodeLens | `onCodeLens` | One lens per `@nudo:case`: `● case "name"` for the active case, `○ case "name"` otherwise; clicking sends the custom `nudo/selectCase` request and refreshes lenses |
| Inlay hints | `languages.inlayHint.on` | End-of-line `Type` hints from analysis `caseHints` |
| Definition | `onDefinition` | `buildSymbolTable` + `findDefinition` |
| References | `onReferences` | `buildSymbolTable` + `findReferences` |
| Rename | `onRenameRequest` | Workspace edit over the definition plus all references |
| Code actions (`quickfix`) | `onCodeAction` | *Remove unreachable code* for `nudo-unreachable`; *Update @nudo:returns to match inferred type* for `nudo-assertion-failed` |
| Signature help (triggers `(`, `,`) | `onSignatureHelp` | Locates the enclosing call, types the callee, highlights the active parameter |
| Semantic tokens (full) | `languages.semanticTokens.on` | Declared legend; currently emits no tokens |

Text synchronization is `Full`. Content changes are debounced 300 ms before triggering `validateText` with `propagate = true` (the only propagation entry point); closing a document cancels its timer, drops its cache entry, and clears its diagnostics.

### Custom requests

| Request | Params | Returns |
|---------|--------|---------|
| `nudo/selectCase` | `{ uri: string; functionName: string; caseIndex: number }` | Revalidates the document with the new active case, requests a CodeLens refresh, returns `{ success: true }` |
| `nudo/getActiveCases` | `{ uri: string }` | `Record<string, number>` — active case index per function |

## Relation to the VS Code Extension

The `nudo-vscode` extension does not reimplement any of this: it launches `@nudojs/lsp`'s `src/server.ts` as a child process (via `tsx`, over IPC transport) and forwards the custom `nudo.selectCase` command to the server. See the [VS Code guide](../guides/vscode.md) for the editor-side view of these features.
