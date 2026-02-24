import type { Node, Comment } from "@babel/types";
import { type TypeValue, T } from "@nudojs/core";

export type CaseDirective = {
  kind: "case";
  name: string;
  args: TypeValue[];
  expected?: TypeValue;
  commentLine?: number;
};

export type MockDirective = {
  kind: "mock";
  name: string;
  expression?: string;
  fromPath?: string;
};

export type PureDirective = {
  kind: "pure";
};

export type SkipDirective = {
  kind: "skip";
  returns?: TypeValue;
};

export type SampleDirective = {
  kind: "sample";
  count: number;
};

export type ReturnsDirective = {
  kind: "returns";
  expected: TypeValue;
};

export type Directive = CaseDirective | MockDirective | PureDirective | SkipDirective | SampleDirective | ReturnsDirective;

export type FunctionWithDirectives = {
  node: Node;
  name: string;
  directives: Directive[];
};

const CASE_NAME_REGEX = /@nudo:case\s+"([^"]+)"\s*\(/g;
const MOCK_INLINE_REGEX = /@nudo:mock\s+(\w+)\s*=\s*(.+)/g;
const MOCK_FROM_REGEX = /@nudo:mock\s+(\w+)\s+from\s+"([^"]+)"/g;
const PURE_REGEX = /@nudo:pure\b/g;
const SKIP_REGEX = /@nudo:skip(?:\s+(.+))?/g;
const SAMPLE_REGEX = /@nudo:sample\s+(\d+)/g;
const RETURNS_REGEX = /@nudo:returns\s*\(/g;

export function parseTypeValueExpr(expr: string): TypeValue {
  const s = expr.trim();

  if (s === "T.number") return T.number;
  if (s === "T.string") return T.string;
  if (s === "T.boolean") return T.boolean;
  if (s === "T.unknown") return T.unknown;
  if (s === "T.never") return T.never;
  if (s === "T.null") return T.null;
  if (s === "T.undefined") return T.undefined;

  if (s === "true") return T.literal(true);
  if (s === "false") return T.literal(false);
  if (s === "null") return T.literal(null);
  if (s === "undefined") return T.literal(undefined);

  const literalMatch = s.match(/^T\.literal\((.+)\)$/);
  if (literalMatch) {
    return T.literal(parsePrimitiveValue(literalMatch[1].trim()));
  }

  if (s.startsWith("T.union(") && s.endsWith(")")) {
    const inner = s.slice("T.union(".length, -1);
    const args = splitTopLevelArgs(inner);
    return T.union(...args.map(parseTypeValueExpr));
  }

  if (s.startsWith("T.array(") && s.endsWith(")")) {
    const inner = s.slice("T.array(".length, -1);
    return T.array(parseTypeValueExpr(inner));
  }

  if (s.startsWith("T.tuple(") && s.endsWith(")")) {
    const inner = s.slice("T.tuple(".length, -1).trim();
    if (inner.startsWith("[") && inner.endsWith("]")) {
      const elements = splitTopLevelArgs(inner.slice(1, -1));
      return T.tuple(elements.map(parseTypeValueExpr));
    }
    return T.tuple([]);
  }

  if (s.startsWith("T.object(") && s.endsWith(")")) {
    const inner = s.slice("T.object(".length, -1).trim();
    if (inner.startsWith("{") && inner.endsWith("}")) {
      const content = inner.slice(1, -1).trim();
      if (!content) return T.object({});
      const entries = splitTopLevelArgs(content);
      const props: Record<string, TypeValue> = {};
      for (const entry of entries) {
        const colonIdx = entry.indexOf(":");
        if (colonIdx === -1) continue;
        const key = entry.slice(0, colonIdx).trim();
        const val = entry.slice(colonIdx + 1).trim();
        props[key] = parseTypeValueExpr(val);
      }
      return T.object(props);
    }
    return T.object({});
  }

  if (/^-?\d+(\.\d+)?$/.test(s)) return T.literal(Number(s));

  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return T.literal(s.slice(1, -1));
  }

  if (s.startsWith("{") && s.endsWith("}")) {
    const content = s.slice(1, -1).trim();
    if (!content) return T.object({});
    const entries = splitTopLevelArgs(content);
    const props: Record<string, TypeValue> = {};
    for (const entry of entries) {
      const colonIdx = findTopLevelColon(entry);
      if (colonIdx === -1) continue;
      const key = entry.slice(0, colonIdx).trim().replace(/^["']|["']$/g, "");
      const val = entry.slice(colonIdx + 1).trim();
      props[key] = parseTypeValueExpr(val);
    }
    return T.object(props);
  }

  if (s.startsWith("[") && s.endsWith("]")) {
    const content = s.slice(1, -1).trim();
    if (!content) return T.tuple([]);
    const elements = splitTopLevelArgs(content);
    return T.tuple(elements.map(parseTypeValueExpr));
  }

  return T.unknown;
}

function parsePrimitiveValue(s: string): string | number | boolean | null | undefined {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (s === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function splitTopLevelArgs(s: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function findTopLevelColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

function extractBalancedParens(text: string, startIdx: number): string | null {
  if (text[startIdx] !== "(") return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (depth === 0) return text.slice(startIdx + 1, i);
  }
  return null;
}

function parseDirectivesFromComments(comments: readonly Comment[]): Directive[] {
  const directives: Directive[] = [];
  for (const comment of comments) {
    const text = comment.value;

    MOCK_FROM_REGEX.lastIndex = 0;
    let mockFromMatch: RegExpExecArray | null;
    const mockFromRanges: [number, number][] = [];
    while ((mockFromMatch = MOCK_FROM_REGEX.exec(text)) !== null) {
      directives.push({
        kind: "mock",
        name: mockFromMatch[1],
        fromPath: mockFromMatch[2],
      });
      mockFromRanges.push([mockFromMatch.index, mockFromMatch.index + mockFromMatch[0].length]);
    }

    MOCK_INLINE_REGEX.lastIndex = 0;
    let mockMatch: RegExpExecArray | null;
    while ((mockMatch = MOCK_INLINE_REGEX.exec(text)) !== null) {
      const inFromRange = mockFromRanges.some(
        ([s, e]) => mockMatch!.index >= s && mockMatch!.index < e,
      );
      if (inFromRange) continue;
      directives.push({
        kind: "mock",
        name: mockMatch[1],
        expression: mockMatch[2].trim(),
      });
    }

    CASE_NAME_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    const commentStartLine = comment.loc?.start.line ?? 0;
    while ((match = CASE_NAME_REGEX.exec(text)) !== null) {
      const name = match[1];
      const parenStart = match.index + match[0].length - 1;
      const argsStr = extractBalancedParens(text, parenStart);
      if (argsStr === null) continue;
      const args = splitTopLevelArgs(argsStr).map(parseTypeValueExpr);

      const afterParen = parenStart + argsStr.length + 2;
      const restLine = text.slice(afterParen).split("\n")[0].trim();
      const arrowMatch = restLine.match(/^=>\s*(.+)/);
      const expected = arrowMatch ? parseTypeValueExpr(arrowMatch[1].trim()) : undefined;

      const linesBeforeMatch = text.slice(0, match.index).split("\n").length - 1;
      const commentLine = commentStartLine + linesBeforeMatch;

      directives.push({ kind: "case", name, args, expected, commentLine });
    }

    PURE_REGEX.lastIndex = 0;
    if (PURE_REGEX.test(text)) {
      directives.push({ kind: "pure" });
    }

    SKIP_REGEX.lastIndex = 0;
    let skipMatch: RegExpExecArray | null;
    while ((skipMatch = SKIP_REGEX.exec(text)) !== null) {
      const returnsExpr = skipMatch[1]?.trim();
      directives.push({
        kind: "skip",
        returns: returnsExpr ? parseTypeValueExpr(returnsExpr) : undefined,
      });
    }

    SAMPLE_REGEX.lastIndex = 0;
    let sampleMatch: RegExpExecArray | null;
    while ((sampleMatch = SAMPLE_REGEX.exec(text)) !== null) {
      directives.push({ kind: "sample", count: Number(sampleMatch[1]) });
    }

    RETURNS_REGEX.lastIndex = 0;
    let returnsMatch: RegExpExecArray | null;
    while ((returnsMatch = RETURNS_REGEX.exec(text)) !== null) {
      const parenStart = returnsMatch.index + returnsMatch[0].length - 1;
      const argsStr = extractBalancedParens(text, parenStart);
      if (argsStr === null) continue;
      directives.push({ kind: "returns", expected: parseTypeValueExpr(argsStr) });
    }
  }
  return directives;
}

function getFunctionName(node: Node): string {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (node.type === "ExportDefaultDeclaration" && node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
    return node.declaration.id.name;
  }
  if (node.type === "VariableDeclaration") {
    const decl = node.declarations[0];
    if (decl.id.type === "Identifier") return decl.id.name;
  }
  return "<anonymous>";
}

export function extractDirectives(ast: Node): FunctionWithDirectives[] {
  const results: FunctionWithDirectives[] = [];

  if (ast.type !== "File") return results;
  const body = ast.program.body;

  for (const stmt of body) {
    const leadingComments = stmt.leadingComments;
    if (!leadingComments || leadingComments.length === 0) continue;

    const directives = parseDirectivesFromComments(leadingComments);
    if (directives.length === 0) continue;

    const name = getFunctionName(stmt);
    results.push({ node: stmt, name, directives });
  }

  return results;
}
