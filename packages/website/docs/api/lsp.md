---
description: "@nudojs/lsp API — the language server over @nudojs/service: validation pipeline and caches, symbols, semantic tokens, agent tools, capabilities."
---

# @nudojs/lsp

API reference for the Nudo Language Server Protocol package. `@nudojs/lsp` wraps the [service layer](./service.md) into a language server that editors can consume: diagnostics, hover types, completions, case-switching CodeLens, inlay hints, and symbol navigation. The [nudo-vscode extension](../guides/vscode.md) launches this server over IPC; the [Zed extension](../guides/zed.md) launches the same server over stdio.

## Public API freeze surface (A1/A2)

`@nudojs/lsp` is **1.0.0**. The freeze inventory — what must stay stable across the 1.x line — lives in the monorepo:

**[`packages/lsp/PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md)**

| Freeze row | Summary |
|------------|---------|
| npm surface | `exports["."]` → `dist/server.js`; `bin.nudo-lsp`; `files: ["dist"]`; importing the entry **starts** the server |
| initialize capabilities | `textDocumentSync` (Full), hover, completion (trigger `.`), codeLens, inlayHint, definition/references/rename, document/workspace symbols, code actions (`quickfix`), signatureHelp, semanticTokens (full), executeCommand, pull `diagnosticProvider` |
| executeCommand | **dot form** `nudo.check`, `nudo.test`, `nudo.hover`, `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.contract`, `nudo.contract.draft`, `nudo.contract.emit`, `nudo.selectCase`, `nudo.getActiveCases` |
| custom requests | **slash form is the protocol contract**: `nudo/check`, `nudo/test`, `nudo/hover`, `nudo/whatIf`, `nudo/suggestCase`, `nudo/trace`, `nudo/contract`, `nudo/contract.draft`, `nudo/contract.emit`, `nudo/selectCase`, `nudo/getActiveCases` — each has a matching executeCommand (`nudo/X` ↔ `nudo.X`) |
| agent tools | `AGENT_TOOL_SOURCES` keys: `whatIf`, `suggestCase`, `trace`, `check`, `hover`, `test`, `contract`, `contract.draft`, `contract.emit`, `codeLens` (server-only) |
| CheckJson / CaseJson | v1 schemas owned by core/service (`check-report.ts`, `case-json.ts`); lsp surfaces them unchanged; field add-only |
| analysis defaults | `DEFAULT_ANALYSIS_MODE = "exports"`; null config → diagnostics `default`, `evalMissingSlot` `off` |
| experimental | `src/*` test modules, caches/debounce, free-text hover/CodeLens wording — not npm/protocol contracts |

Regression pins: `packages/lsp/src/public-api.ts` + `packages/lsp/src/__tests__/public-api-surface.test.ts` (protocol consistency) and service defaults tests (see PUBLIC_API.md §7–§8). Versioning gate: [`docs/versioning.md`](https://github.com/nudojs/nudo/blob/main/docs/versioning.md).

## Package Layout

The package entry point (`main`) is `dist/server.js` (built from `src/server.ts`). **Importing it starts the server**: it calls `createConnection(ProposedFeatures.all)` and `connection.listen()` as a module side effect, speaking LSP over stdio/IPC. There is no `createServer()`-style factory. The package also exposes a `nudo-lsp` bin (`dist/server.js` with a shebang) for editors that launch a bare command — the [Zed extension](../guides/zed.md) and agent bridges use this path.

The testable programmatic API lives in three sibling source modules, deliberately extracted from `server.ts` so they can be exercised without a live LSP connection:

| Module | Purpose |
|--------|---------|
| `src/validation.ts` | Diagnostics pipeline, analysis cache, dirty propagation, Nudo-file detection |
| `src/symbols.ts` | Symbol table construction, definition/reference lookup for navigation handlers |
| `src/semantic-tokens.ts` | Semantic-token legend and delta encoder (re-exported from `@nudojs/service`) |
| `src/agent-tools.ts` | Agent command implementations (`nudo.whatIf`/`suggestCase`/`trace`) — see the [Agent API](./agent.md) page |

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
  force?: boolean,               // default false — disables the sourceHash short-circuit on dirty propagation
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
  /** Buffer-aware module loader (A4/E5); omitted → disk `defaultLoadModule` */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
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

The published package ships only compiled `dist/` (`files: ["dist"]`) with an `exports` map and the `nudo-lsp` bin — import the entry or run the bin; do not import `src/*` paths from npm. The sibling modules above (`src/validation.ts`, `src/symbols.ts`, `src/semantic-tokens.ts`, `src/agent-tools.ts`) are the monorepo test surface: exercise them there through a TS-aware loader such as `tsx` (or the workspace path aliases).

### getCachedOrAnalyze

```typescript
getCachedOrAnalyze(
  filePath: string,
  source: string,
  version: number,
  activeCases?: Map<string, number>,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): AnalysisResult
```

Synchronous, cache-aware analysis for high-frequency handlers (hover, completion, pull diagnostics). Reuses the cached `AnalysisResult` when document `version`, `casesHash`, **and sidecar/deps fingerprint** match; otherwise runs sync `analyzeFile` (with optional buffer-aware `loadModule`) and refreshes the cache. Path-based `@nudo:env` files degrade on this path — the async preload only happens inside `validateText`. Sidecar/dep changes also invalidate via `handleNudoDepFileChanged` (cache delete + force revalidate + `workspace/diagnostic/refresh`).

### isNudoFile gate

Server-side `isNudoFile(uri)` is **not** a pure directive scan. It requires:

1. `isNudoTargetPath` — `.js` / `.mjs` / `.ts`, excluding `.d.ts`, JSX, `*.nudo.{js,mjs,ts}` sidecars, and `*.nudo.draft.{js,mjs,ts}` draft artifacts; and
2. `shouldAnalyzeFile(filePath, text)` — path + `package.json#nudo.analysis.mode` (shipped default `exports`; `all` / `directives` available).

Results are cached per URI and invalidated on open/change/close.

### toLspDiagnostic

```typescript
toLspDiagnostic(d: Diagnostic, uri: string): LspDiagnostic
```

Maps one `@nudojs/service` diagnostic to the LSP shape: severity `error`→1/`warning`→2/`info`→3, 1-based positions converted to 0-based, `source: "nudo"`, `tags: ["unnecessary"]`, and `origin` mapped to a `relatedInformation` entry (`"value originates here"`). Exported so tests and alternative clients can reuse the exact mapping.

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

Delta-encodes `{ line, char, length, typeIndex, modifierBitmask }` tokens into the flat `number[]` the LSP expects. `TOKEN_TYPES` (`function`, `variable`, `parameter`, `property`, `type`, `keyword`, `string`, `number`, `comment`, `decorator`, `method`) and `TOKEN_MODIFIERS` (`declaration`, `readonly`, `deprecated`, `unreachable`, `contract`, `generated`, `derived`) form the server's declared legend. The server's semanticTokens handler colors declarations from the analysis result — function bindings get the `function` type, other bindings `variable`, parameters `parameter`; top-level named-export functions also carry an interface-tier modifier aligned with CodeLens `● interface` (A7) — via `buildSemanticTokens` from `@nudojs/service`.

## Server Capabilities

What the server registers on `connection.onInitialize` (`src/server.ts`):

| Capability | Handler | Behavior |
|------------|---------|----------|
| Hover | `onHover` | Inferred type at cursor via `getTypeAtPosition`; when the cursor is on an exported function name, the first line is `● interface / handwritten|generated|implicit` (same source as CodeLens) plus the effective contract display for handwritten/generated |
| Completion (trigger `.`) | `onCompletion` | Property/method/variable items from `getCompletionsAtPosition` |
| CodeLens | `onCodeLens` | Interface tier first: `● interface / handwritten|generated|implicit` (+ persist/update emit lenses + `⚡ draft interface` for non-handwritten exports); case lenses are the debug sub-layer — `● case "name"` active, `○` otherwise. Clicking sends `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit` and refreshes lenses |
| Inlay hints | `languages.inlayHint` | End-of-line case `Type` hints + Abs param/return inlays; implicit exports carry `· derived` |
| Definition | `onDefinition` | `resolveDefinitionLocations` (local + cross-file + sidecar + workspace fallback) |
| References | `onReferences` | `buildSymbolTable` + `findReferences` |
| Rename | `onRenameRequest` | Workspace edit over the definition plus all references |
| Code actions (`quickfix`) | `onCodeAction` | *Remove unreachable code* for `nudo-unreachable`; contract/param fixes |
| Signature help (triggers `(`, `,`) | `onSignatureHelp` | Locates the enclosing call, types the callee, highlights the active parameter |
| Semantic tokens (full) | `languages.semanticTokens` | Inference-driven highlighting via `buildSemanticTokens`; export function bindings carry interface-tier modifiers (`contract`/`generated`/`derived`) |

Cross-editor support matrix: [LSP Client Matrix](../guides/lsp-clients.md).

Text synchronization is `Full`. Opening a document validates it immediately, and content changes are debounced adaptively by buffer size (300 ms under 50k chars, 400 ms under 200k, 800 ms above) — both paths trigger `validateText` with `propagate = true` (the only propagation entry points); closing a document cancels its timer, drops its cache entry, bumps the per-file validate generation (so in-flight results are discarded), and clears its diagnostics. Watched-file deletions are handled out-of-band, and everything the session keeps in memory is bounded — see [Memory and Isolation Model](#memory-and-isolation-model).

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
| `activeCases` | `Map<uri, Map<functionName, index>>` | case selections, keyed by uri and function name | dropped when the document closes or the file is deleted on disk |
| `nudoFileCache` | `Map<uri, boolean>` — Nudo-file detection memo | one boolean per open document | invalidated on every open/change/close/delete of its uri |
| `moduleGraphCache` | `Map<filePath, { mtimeMs, size, edges }>` | one entry per file that ever entered the import graph; edges are path strings | `mtimeMs`+`size` mismatch re-reads from disk and backfills; deletion evicts |
| `debounceTimers` | `Map<uri, timer>` | one pending timer per edited document | fires after the adaptive delay (300/400/800 ms by buffer size) or is cancelled on close |

Every entry is a path, a function name, a small integer, or a boolean — string-level bookkeeping, never parsed representation. `AnalysisResult` objects exist only inside `analysisCache` and leave with their entry.

### Validate on open

`documents.onDidOpen` triggers validation immediately with `propagate = true` — the same semantics as the debounced edit path, including one round of dirty propagation to open dependents. A newly opened file shows its diagnostics right away instead of waiting for the first edit or a client pull. (`didOpen` does not fire `onDidChangeContent`, so the open path must validate explicitly.)

### The stale-on-closed contract

Dependents that are closed — or were never opened — keep their last published diagnostics **stale on purpose**: the server never re-analyzes a file it cannot read from an open buffer. Reopening the file revalidates it and clears the staleness.

Deletion is the one out-of-band event handled explicitly. A `workspace/didChangeWatchedFiles` change of type `Deleted`, for a file **not** in the open set, drops every session record for it: `forgetValidatedFile` clears `knownFiles` and `analysisCache`, `activeCases` and `nudoFileCache` drop the uri, the `moduleGraphCache` entry is evicted, and an empty diagnostic list is pushed. Files that *are* open are skipped — their content is owned by the edit stream, and the editor itself rescues an externally deleted buffer via `didOpen`/`didChange`.

### Module-graph edge cache

Dirty propagation needs the import graph over `knownFiles`, and rebuilding it used to mean re-reading and re-parsing every known file. `buildModuleGraph` (from `@nudojs/service`) now takes the session-level `moduleGraphCache`: each entry stores a file's `mtimeMs`, `size`, and extracted import edges as plain strings. A `stat`-only metadata check — `mtimeMs` **and** `size` exactly equal — is a hit and reuses the cached edges; a miss re-reads the file from disk and backfills the entry. Unchanged files therefore cost one `stat` per propagation: zero disk reads, zero parsing. The package tests pin this by making a dependency unreadable (`chmod 000`) — propagation still computes the correct dirty set from cached edges.

Per-result work is bounded as well: a single `AnalysisResult` caps synthesized precise cases per function (`callSiteBudget`, default `3`; configurable via `package.json#nudo.analysis.callSiteBudget`), folding the remaining call records into a symbolic aggregate instead of growing without limit.

### Evaluation guards

Validation shares the evaluator with the CLI, and module loading there is guarded so pathological imports degrade to diagnostics instead of hangs: an import cycle produces a `nudo:module-cycle` warning naming the full cycle chain (bindings inside the cycle resolve to their partially evaluated types — evaluation is not aborted); a load chain deeper than 16 modules produces a `nudo:module-depth` warning and truncates the tail to `unknown` stubs; a missing `import`/`require`/`@nudo:mock-module` target surfaces as a `nudo:module-missing` error listing the resolved candidate paths.

### `interFileDependencies: false`

`initialize` declares `diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }`: each file's diagnostics are correct for that file alone, and contracts come from `*.nudo.js` sidecars / `@nudo:refine` (alias `@nudo:interface`). `@nudo:case` is a debug / optional `nudo test` sub-layer, not the contract product. This is the structural difference from `tsserver`, whose whole-`Program` residency is forced by structural typing: any cross-file shape can change any decision, so everything must stay loaded and current. Nudo trades that for single-file correctness with bounded memory — which is precisely what lets both servers run side by side in the same editor. Nudo does not aim to replace `tsserver`.

## Relation to Editor Extensions

The `nudo-vscode` extension does not reimplement any of this: it bundles `@nudojs/lsp`'s compiled `dist/server.js` into the extension as `server/server.js` and launches that child process over IPC, then forwards the custom `nudo.selectCase` command to the server. The [Zed extension](../guides/zed.md) launches the same server over stdio (`nudo-lsp` / `node dist/server.js`). See the [VS Code guide](../guides/vscode.md) and [Zed guide](../guides/zed.md) for the editor-side view of these features.
