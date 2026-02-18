import type { Node, Comment } from "@babel/types";
import { type TypeValue, T } from "@justscript/core";

export type Directive = {
  kind: "case";
  name: string;
  args: TypeValue[];
};

export type FunctionWithDirectives = {
  node: Node;
  name: string;
  directives: Directive[];
};

const CASE_NAME_REGEX = /@just:case\s+"([^"]+)"\s*\(/g;

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

  const unionMatch = s.match(/^T\.union\((.+)\)$/);
  if (unionMatch) {
    const args = splitTopLevelArgs(unionMatch[1]);
    return T.union(...args.map(parseTypeValueExpr));
  }

  if (/^-?\d+(\.\d+)?$/.test(s)) return T.literal(Number(s));

  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return T.literal(s.slice(1, -1));
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
    if (ch === "(") depth++;
    if (ch === ")") depth--;
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
    CASE_NAME_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CASE_NAME_REGEX.exec(text)) !== null) {
      const name = match[1];
      const parenStart = match.index + match[0].length - 1;
      const argsStr = extractBalancedParens(text, parenStart);
      if (argsStr === null) continue;
      const args = splitTopLevelArgs(argsStr).map(parseTypeValueExpr);
      directives.push({ kind: "case", name, args });
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
