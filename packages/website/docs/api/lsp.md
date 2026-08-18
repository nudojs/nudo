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
| `moduleGraphCache` | `Map<string, { mtimeMs: number; size: number; edges: string[] }>` | Session-level module-graph edge cache shared with `buildModuleGraph` — see [Memory and Isolation Model](#memory-and-isolation-model) |
| `forgetValidatedFile(filePath)` | `(filePath: string) => void` | Drops the `knownFiles` and `analysisCache` records for a file deleted on disk |
| `evictModuleGraphCacheEntries(uris)` | `(uris: string[]) => void` | Drops `moduleGraphCache` entries for deleted files (takes uris, evicts by file path) |
| `clearValidationState()` | `() => void` | Test hook — resets all of the above |

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

Text synchronization is `Full`. Opening a document validates it immediately, and content changes are debounced 300 ms — both paths trigger `validateText` with `propagate = true` (the only propagation entry points); closing a document cancels its timer, drops its cache entry, and clears its diagnostics. Watched-file deletions are handled out-of-band, and everything the session keeps in memory is bounded — see [Memory and Isolation Model](#memory-and-isolation-model).

### Custom requests

| Request | Params | Returns |
|---------|--------|---------|
| `nudo/selectCase` | `{ uri: string; functionName: string; caseIndex: number }` | Revalidates the document with the new active case, requests a CodeLens refresh, returns `{ success: true }` |
| `nudo/getActiveCases` | `{ uri: string }` | `Record<string, number>` — active case index per function |

## Memory and Isolation Model

The server is built to run **next to** `tsserver`, not instead of it — and that constraint shapes everything in this section. Nudo's unit of correctness is the single file, so the session keeps only bounded, string-level state: no AST and no source text survives between requests.

### Resident state

Everything the server holds for the lifetime of a session:

| State | Structure | Bound | Eviction |
|-------|-----------|-------|----------|
| `documents` | open documents (`TextDocuments`) | one entry per open editor document | removed on close |
| `analysisCache` | `Map<filePath, { version, result }>` | one versioned entry per analyzed file | its document closes, or the file is deleted on disk (`forgetValidatedFile`) |
| `knownFiles` | `Set<filePath>` | one path string per file analyzed this session | file deleted on disk (`forgetValidatedFile`) |
| `activeCases` | `Map<uri, Map<functionName, index>>` | case selections, keyed by uri and function name | survives close/reopen so a selection is not lost; dropped when the file is deleted on disk |
| `nudoFileCache` | `Map<uri, boolean>` — Nudo-file detection memo | one boolean per open document | invalidated on every open/change/close/delete of its uri |
| `moduleGraphCache` | `Map<filePath, { mtimeMs, size, edges }>` | one entry per file that ever entered the import graph; edges are path strings | `mtimeMs`+`size` mismatch re-reads from disk and backfills; deletion evicts |
| `debounceTimers` | `Map<uri, timer>` | one pending timer per edited document | fires after 300 ms or is cancelled on close |

Every entry is a path, a function name, a small integer, or a boolean — string-level bookkeeping, never parsed representation. `AnalysisResult` objects exist only inside `analysisCache` and leave with their entry.

### Validate on open

`documents.onDidOpen` triggers validation immediately with `propagate = true` — the same semantics as the debounced edit path, including one round of dirty propagation to open dependents. A newly opened file shows its diagnostics right away instead of waiting for the first edit or a client pull. (`didOpen` does not fire `onDidChangeContent`, so the open path must validate explicitly.)

### The stale-on-closed contract

Dependents that are closed — or were never opened — keep their last published diagnostics **stale on purpose**: the server never re-analyzes a file it cannot read from an open buffer. Reopening the file revalidates it and clears the staleness.

Deletion is the one out-of-band event handled explicitly. A `workspace/didChangeWatchedFiles` change of type `Deleted`, for a file **not** in the open set, drops every session record for it: `forgetValidatedFile` clears `knownFiles` and `analysisCache`, `activeCases` and `nudoFileCache` drop the uri, the `moduleGraphCache` entry is evicted, and an empty diagnostic list is pushed. Files that *are* open are skipped — their content is owned by the edit stream, and the editor itself rescues an externally deleted buffer via `didOpen`/`didChange`.

### Module-graph edge cache

Dirty propagation needs the import graph over `knownFiles`, and rebuilding it used to mean re-reading and re-parsing every known file. `buildModuleGraph` (from `@nudojs/service`) now takes the session-level `moduleGraphCache`: each entry stores a file's `mtimeMs`, `size`, and extracted import edges as plain strings. A `stat`-only metadata check — `mtimeMs` **and** `size` exactly equal — is a hit and reuses the cached edges; a miss re-reads the file from disk and backfills the entry. Unchanged files therefore cost one `stat` per propagation: zero disk reads, zero parsing. The package tests pin this by making a dependency unreadable (`chmod 000`) — propagation still computes the correct dirty set from cached edges.

Per-result work is bounded as well: a single `AnalysisResult` caps synthesized precise cases per function (`MAX_PRECISE_CALLSITE_CASES = 3`), folding the remaining call records into a symbolic aggregate instead of growing without limit.

### Evaluation guards

Validation shares the evaluator with the CLI, and module loading there is guarded so pathological imports degrade to diagnostics instead of hangs: an import cycle produces a `nudo:module-cycle` warning naming the full cycle chain (bindings inside the cycle resolve to their partially evaluated types — evaluation is not aborted); a load chain deeper than 16 modules produces a `nudo:module-depth` warning and truncates the tail to `unknown` stubs; a missing `import`/`require`/`@nudo:mock-module` target surfaces as a `nudo:module-missing` error listing the resolved candidate paths.

### `interFileDependencies: false`

`initialize` declares `diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }`: each file's diagnostics are correct for that file alone, and the explicit `@nudo:case` directives are the contract surface — the cases written into the file *are* its interface. This is the structural difference from `tsserver`, whose whole-`Program` residency is forced by structural typing: any cross-file shape can change any decision, so everything must stay loaded and current. Nudo trades that for single-file correctness with bounded memory — which is precisely what lets both servers run side by side in the same editor. Nudo does not aim to replace `tsserver`.

## Relation to the VS Code Extension

The `nudo-vscode` extension does not reimplement any of this: it launches `@nudojs/lsp`'s `src/server.ts` as a child process (via `tsx`, over IPC transport) and forwards the custom `nudo.selectCase` command to the server. See the [VS Code guide](../guides/vscode.md) for the editor-side view of these features.
