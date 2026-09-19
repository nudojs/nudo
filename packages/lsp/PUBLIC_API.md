# @nudojs/lsp — Public API Freeze Inventory

> **Status (A1/A2):** `@nudojs/lsp` is **0.8.0, pre-1.x**. This file is the freeze
> observation inventory: what the package exposes today, and what counts as
> **stable** vs **experimental** once the package cuts 1.0. Freezing does **not**
> auto-bump `package.json`; 1.0 is gated on ≥1 minor cycle with no unplanned
> breaks of the stable rows below (see [`docs/versioning.md`](../../docs/versioning.md)).
>
> Machine-readable twins: [`src/public-api.ts`](./src/public-api.ts) ·
> npm export `@nudojs/lsp/public-api` (constants only; no server side effect) ·
> regression pin: [`src/__tests__/public-api-surface.test.ts`](./src/__tests__/public-api-surface.test.ts)
>
> Website summary: [api/lsp.md](../website/docs/api/lsp.md) · client matrix:
> [guides/lsp-clients.md](../website/docs/guides/lsp-clients.md)

## 1. npm package surface

| Surface | Value | Stability |
|---------|-------|-----------|
| Package name | `@nudojs/lsp` | **stable** |
| `bin` | `nudo-lsp` → `./dist/server.js` | **stable** |
| `exports["."]` | types `./dist/server.d.ts`, default `./dist/server.js` | **stable** |
| `exports["./public-api"]` | types `./dist/public-api.d.ts`, default `./dist/public-api.js` — freeze inventory constants, importable without starting the server | **stable** (additive) |
| `files` | `["dist"]` — no `src/*` published | **stable** |
| Entry side effect | importing `.` starts the LSP (stdio/IPC) | **stable** (documented contract) |
| Engines | Node `>=20` | **stable** |
| Internal `src/*` paths | monorepo test surface only; not an npm contract | **not public** |

There is no `createServer()` factory. Editors launch `nudo-lsp` or the bundled
`server.js` (VS Code extension) / `node dist/server.js` (generic stdio).

## 2. initialize capabilities

Declared in `connection.onInitialize` (`src/server.ts`). Keys are the freeze list:

| Capability key | Notes |
|----------------|-------|
| `textDocumentSync` | `Full` |
| `hoverProvider` | Abs / intension + interface tier on export fn names |
| `completionProvider` | trigger `.`; `resolveProvider: false` |
| `codeLensProvider` | `resolveProvider: false`; interface tier first |
| `inlayHintProvider` | case + Abs param/return |
| `definitionProvider` | local + cross-file + sidecar |
| `referencesProvider` | |
| `renameProvider` | |
| `documentSymbolProvider` | |
| `workspaceSymbolProvider` | |
| `codeActionProvider` | `codeActionKinds: ["quickfix"]` |
| `signatureHelpProvider` | triggers `(`, `,` |
| `semanticTokensProvider` | full; legend includes `contract` / `generated` / `derived` |
| `executeCommandProvider` | commands = `NUDO_EXECUTE_COMMANDS` (dot form) |
| `diagnosticProvider` | pull; `interFileDependencies: false`, `workspaceDiagnostics: false` |

Stability: **stable** for the key set above after 1.x. Individual legend token
types/modifiers may gain entries (**non-breaking**); removals are breaking.

## 3. executeCommand `nudo.*` (dot form)

`workspace/executeCommand` command names — **stable** inventory:

| Command | Role |
|---------|------|
| `nudo.check` | CheckJson v1 gate |
| `nudo.test` | CaseJson v1 case report |
| `nudo.hover` | lossless Abs at position (+ optional inlays) |
| `nudo.whatIf` | inject `@nudo:as` assumptions |
| `nudo.suggestCase` | case coverage / paste-ready directives |
| `nudo.trace` | per-case arg→result listing |
| `nudo.contract` | interface tiers print |
| `nudo.contract.draft` | code-first `*.nudo.draft.*` |
| `nudo.contract.emit` | persist `@generated` sidecar |
| `nudo.selectCase` | switch active case (positional or object args) |
| `nudo.getActiveCases` | active case index map |

## 4. Custom requests `nudo/…` (slash form) — protocol contract

Slash form is the **protocol contract** for custom LSP requests. Dot-form agent
methods are also registered as request methods for MCP-style bridges; both route
to the same handlers (`AGENT_TOOL_SOURCES` same-source pin).

| Request (slash) | executeCommand twin | Returns |
|-----------------|---------------------|---------|
| `nudo/check` | `nudo.check` | AgentToolResult / CheckJson text |
| `nudo/test` | `nudo.test` | CaseJson v1 text |
| `nudo/hover` | `nudo.hover` | Abs payload text |
| `nudo/whatIf` | `nudo.whatIf` | analysis after injection |
| `nudo/suggestCase` | `nudo.suggestCase` | coverage / directives |
| `nudo/trace` | `nudo.trace` | case traces |
| `nudo/contract` | `nudo.contract` | tier lines |
| `nudo/contract.draft` | `nudo.contract.draft` | draft summary |
| `nudo/contract.emit` | `nudo.contract.emit` | emit summary |
| `nudo/selectCase` | `nudo.selectCase` | `{ success: true }` — editor-only (slash + executeCommand; no dot-form custom request) |
| `nudo/getActiveCases` | `nudo.getActiveCases` | `Record<string, number>` — editor-only (slash + executeCommand; no dot-form custom request) |

**Consistency invariant (A7):** every slash-form request must have a matching
executeCommand name (`nudo/X` ↔ `nudo.X`). Pinned by
`public-api-surface.test.ts`.

Stability: **stable** — removing a slash request or changing its return shape
after 1.0 is **major** (see `docs/versioning.md` “LSP protocol contracts”).

## 5. Agent tools (`AGENT_TOOL_SOURCES`)

Source table in [`src/agent-tools.ts`](./src/agent-tools.ts). Keys are the
documented agent tool names; values are the shared computation (E5 same-source).

| Tool key | Shared source | Command / request |
|----------|---------------|-------------------|
| `whatIf` | `injectBindings + analyzeFile` | `nudo.whatIf` / `nudo/whatIf` |
| `suggestCase` | `analyzeFile + buildCaseDirective` | `nudo.suggestCase` / `nudo/suggestCase` |
| `trace` | `analyzeFile cases` | `nudo.trace` / `nudo/trace` |
| `check` | `checkSource + serializeCheckJson` | `nudo.check` / `nudo/check` |
| `hover` | `getHoverAtPosition + interfaceTierOf` | `nudo.hover` / `nudo/hover` |
| `test` | `analyzeFile + serializeCaseJson` | `nudo.test` / `nudo/test` |
| `contract` | `interfaceSurface + formatInterfaceSurfaceLine` | `nudo.contract` / `nudo/contract` |
| `contract.draft` | `draftInterface + formatDraftSummary` | `nudo.contract.draft` / `nudo/contract.draft` |
| `contract.emit` | `emitInterface` | `nudo.contract.emit` / `nudo/contract.emit` |
| `codeLens` | `computeInterfaceLenses + interfaceTierOf` | **server-only** (no command) |

`selectCase` / `getActiveCases` are editor commands, not agent tools — they are
still on the protocol inventory (§3–§4) but **not** registered as dot-form
custom request methods (`nudo.selectCase` request ≠ executeCommand).

Stability: **stable** tool *names* after 1.x. Implementations may change as long
as they keep consuming the same service/core entrypoints (E5). Bypassing
`AGENT_TOOL_SOURCES` with a second semantic path is a contract break even if
the tool name stays.

## 6. CheckJson / CaseJson schema pointers

These schemas are owned by **core/service**, not lsp; lsp agent tools surface
them unchanged. Schema breaks are **major** on 1.x packages.

| Schema | Definition | Serializer | Stability |
|--------|------------|------------|-----------|
| **CheckJson v1** | `packages/core/src/algebra/check-report.ts` (`type CheckJson`) | `serializeCheckJson` | fields additive-only; `version: 1` |
| **CaseJson v1** | `packages/service/src/case-json.ts` (`type CaseJson`) | `serializeCaseJson` | fields additive-only; `version: 1`; `intension.*` lossless Abs |

Consumer docs: [api/agent.md](../website/docs/api/agent.md) ·
[guides/mcp-server.md](../website/docs/guides/mcp-server.md)

## 7. Analysis defaults that affect the IDE

| Default | Value | Source |
|---------|-------|--------|
| `DEFAULT_ANALYSIS_MODE` | `"exports"` | `packages/service/src/evaluator/config.ts` |
| `analysisConfig(null)` / `{}` | `mode=exports`, `diagnostics=default`, `evalMissingSlot=off`, `callSiteBudget=3`, `exclude` = node_modules/dist/coverage | same |
| `mode=directives` | `diagnostics=errors` (conservative gate) | same |
| File detection | export-bearing / sidecar / directives analyzed in exports mode; non-export plain JS not; `node_modules` excluded even in `all` | `shouldAnalyzeFile` + tests |

Escape hatch: `package.json#nudo.analysis.mode` = `"directives"` \| `"all"`.
Default flips that silence or invent diagnostics are **major** on 1.x (already
recorded in `docs/versioning.md` fix-2).

Coverage pins (A8):

- `packages/service/src/__tests__/config-analysis.test.ts` — full `AnalysisConfig`
  snapshot for null/{}; directives → errors; evalMissingSlot opt-in
- `packages/service/src/__tests__/analysis-scope.test.ts` — export file analyzed,
  non-export not (exports mode), node_modules excluded

## 8. IDE daily smoke (A6)

Service-level daily path without a live VS Code — **vitest**, no IPC:

| Path | Test |
|------|------|
| `shouldAnalyzeFile` + `analyzeFile` on export-bearing `.js` | `packages/lsp/src/__tests__/ide-daily-smoke.test.ts` |
| hover + inlay via service pure functions | same |
| sidecar go-to-definition via `resolveDefinitionLocations` | same (+ existing `sidecar-lsp.test.ts`) |

Results: all green under `pnpm vitest run packages/lsp/src/__tests__/ide-daily-smoke.test.ts`
and the service defaults/scope suites. Live editor latency is **out of scope**
(Backlog S1 monorepo bench).

## 9. Stable vs experimental (1.x gate)

| Surface | After 1.0 |
|---------|-----------|
| npm `exports` + `bin.nudo-lsp` | **stable** |
| initialize capability **key set** | **stable** (legend may grow) |
| executeCommand names | **stable** |
| slash-form `nudo/…` requests + return shapes | **stable** (protocol contract) |
| agent tool **names** + E5 same-source rule | **stable** |
| CheckJson / CaseJson v1 | **stable** (additive fields only) |
| Default `analysis.mode=exports` + diagnostics tier | **stable**; flip = major |
| VS Code bundled server path `server/server.js` | **product-stable** for `nudo-vscode` (private package; follow extension notes, not npm semver) |
| `src/*` sibling modules (`validation.ts`, `symbols.ts`, …) | **experimental** monorepo test surface — not published |
| Internal caches / debounce timing / memory bounds | **experimental** — may change without major |
| Exact human-readable hover/CodeLens string wording | **experimental** — clients must not parse free text as API |
| CodeLens positional arg order beyond documented cases | **stable** for `selectCase` / `contract` / `contract.draft` / `contract.emit` bridges already in tree |

**1.0 gate (A2):** no automatic bump. Cut major only after this inventory is
observed for ≥1 lsp minor with no unplanned stable-surface breaks, with a
changeset `**BREAKING**` table aligned to core/service 1.0 style.

## 10. Versioning pointer

- Policy: [`docs/versioning.md`](../../docs/versioning.md) (maturity table +
  IDE/agent breaking wave + env/harvester B8 notes)
- Consumer summary: [guides/versioning.md](../website/docs/guides/versioning.md)
- VS Code release checklist: [`packages/vscode/RELEASE_CHECKLIST.md`](../vscode/RELEASE_CHECKLIST.md)
