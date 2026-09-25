/**
 * `@nudojs/service/lsp` — IDE surface.
 *
 * Hover / completions / type-at-position backed by Abs-native evaluation
 * (identifier bindings from `evalAbsModuleGraph`; node-level Abs collection
 * is gone), plus semantic tokens and inlay hints.
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

export { collectAbsInlays, type AbsInlay } from "@nudojs/core/internal";
