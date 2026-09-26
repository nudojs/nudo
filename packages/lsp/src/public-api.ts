/**
 * Freeze inventory for `@nudojs/lsp` public surface (A1/A7).
 *
 * Pure constants — importable without starting the language server
 * (`server.ts` has side effects on import). Human-readable inventory:
 * `packages/lsp/PUBLIC_API.md`.
 *
 * Protocol contract:
 * - executeCommand uses **dot** form: `nudo.check`
 * - custom requests use **slash** form: `nudo/check` (canonical protocol)
 * - every slash-form agent request has a matching executeCommand name
 *
 * Product names match CLI verbs (design-cli-semantics): check / test /
 * contract / export / health. There are no protocol aliases.
 */

/** workspace/executeCommand names (dot form) — declared on initialize */
export const NUDO_EXECUTE_COMMANDS = [
  "nudo.whatIf",
  "nudo.suggestCase",
  "nudo.trace",
  "nudo.check",
  "nudo.hover",
  "nudo.test",
  "nudo.contract",
  "nudo.contract.draft",
  "nudo.contract.emit",
  "nudo.selectCase",
  "nudo.getActiveCases",
] as const;

/**
 * Custom LSP request method names (slash form) — the protocol contract.
 * Agent tools also register the dot-form method for MCP bridges.
 */
export const NUDO_SLASH_REQUESTS = [
  "nudo/selectCase",
  "nudo/getActiveCases",
  "nudo/whatIf",
  "nudo/suggestCase",
  "nudo/trace",
  "nudo/check",
  "nudo/hover",
  "nudo/test",
  "nudo/contract",
  "nudo/contract.draft",
  "nudo/contract.emit",
] as const;

/**
 * Agent-tool names shared by executeCommand / slash requests / AGENT_TOOL_SOURCES.
 * `codeLens` is server-computed only (no command/request); `selectCase` /
 * `getActiveCases` are editor commands, not agent tools.
 */
export const NUDO_AGENT_TOOL_NAMES = [
  "whatIf",
  "suggestCase",
  "trace",
  "check",
  "hover",
  "test",
  "contract",
  "contract.draft",
  "contract.emit",
] as const;

/** Capability keys declared in connection.onInitialize */
export const NUDO_INITIALIZE_CAPABILITIES = [
  "textDocumentSync",
  "hoverProvider",
  "completionProvider",
  "codeLensProvider",
  "inlayHintProvider",
  "definitionProvider",
  "referencesProvider",
  "renameProvider",
  "documentSymbolProvider",
  "workspaceSymbolProvider",
  "codeActionProvider",
  "signatureHelpProvider",
  "semanticTokensProvider",
  "executeCommandProvider",
  "diagnosticProvider",
] as const;

/** Slash-form → matching executeCommand (dot form) */
export function slashToExecuteCommand(slash: string): string {
  return slash.replace(/^nudo\//, "nudo.");
}

/** npm package public surface (mirrors packages/lsp/package.json) */
export const NUDO_LSP_PACKAGE_SURFACE = {
  name: "@nudojs/lsp",
  bin: "nudo-lsp",
  entry: ".",
  entryPath: "./dist/server.js",
  files: ["dist"],
  /** Machine-readable freeze inventory (no server side effects). */
  publicApiExport: "./public-api",
  publicApiPath: "./dist/public-api.js",
} as const;
