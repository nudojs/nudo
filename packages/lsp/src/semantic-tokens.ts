export const TOKEN_TYPES = [
  "function",
  "variable",
  "parameter",
  "property",
  "type",
  "keyword",
  "string",
  "number",
  "comment",
  "decorator",
] as const;

export const TOKEN_MODIFIERS = [
  "declaration",
  "readonly",
  "deprecated",
  "unreachable",
] as const;

export type SemanticToken = {
  line: number;
  char: number;
  length: number;
  typeIndex: number;
  modifierBitmask: number;
};

export function encodeSemanticTokens(tokens: SemanticToken[]): number[] {
  const result: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of tokens) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;

    result.push(deltaLine, deltaChar, token.length, token.typeIndex, token.modifierBitmask);

    prevLine = token.line;
    prevChar = token.char;
  }

  return result;
}
