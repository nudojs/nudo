/**
 * `@nudojs/lsp` — IDE surface library entry (no server side effects).
 *
 * Hover / completions / type-at-position backed by Abs-native evaluation,
 * plus semantic tokens. The language server itself lives at `@nudojs/lsp/server`
 * (bin `nudo-lsp`); importing this entry does not start it.
 */
export {
  type CaseInfo,
  getTypeAtPositionAsync,
  getAbsAtPosition,
  getAbsAtPositionAsync,
  getHoverAtPosition,
  type HoverInfo,
  getCompletionsAtPosition,
  getCasesForFile,
} from "./lsp-surface.ts";

// 公共名保留（双入口合一）：replay.ts 的 `getTypeAtPosition` 字面透传包装
// 已删——它就是 `getAbsAtPosition`，这里以别名保住既有公共 API 名。
export { getAbsAtPosition as getTypeAtPosition } from "./lsp-surface.ts";

export {
  buildSemanticTokens,
  encodeSemanticTokens,
  contractTierModifierBit,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
  type SemanticToken,
  type BuildSemanticTokensOpts,
} from "./semantic-tokens.ts";
