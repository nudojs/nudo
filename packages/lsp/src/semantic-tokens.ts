// Semantic tokens 的图例与编码单一来源在 @nudojs/service（提取器
// buildSemanticTokens 与图例同处一模块，tokenType 索引不可能与图例漂移）。
// 此处仅按 server.ts 原引用名（TOKEN_TYPES/TOKEN_MODIFIERS）再导出。
export {
  SEMANTIC_TOKEN_TYPES as TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS as TOKEN_MODIFIERS,
  encodeSemanticTokens,
  type SemanticToken,
} from "@nudojs/service";
