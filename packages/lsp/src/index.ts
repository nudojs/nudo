/**
 * `@nudojs/lsp` — IDE surface library entry (no server side effects).
 *
 * Hover / completions / type-at-position backed by Abs-native evaluation,
 * plus semantic tokens. The language server itself lives at `@nudojs/lsp/server`
 * (bin `nudo-lsp`); importing this entry does not start it.
 */
export {
  type CaseInfo,
  getTypeAtPosition,
  getTypeAtPositionAsync,
  getAbsAtPosition,
  getAbsAtPositionAsync,
  getHoverAtPosition,
  type HoverInfo,
  getCompletionsAtPosition,
  getCasesForFile,
} from "./lsp-surface.ts";

export {
  buildSemanticTokens,
  encodeSemanticTokens,
  interfaceTierModifierBit,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
  type SemanticToken,
  type BuildSemanticTokensOpts,
} from "./semantic-tokens.ts";
