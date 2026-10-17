import type { Node } from "@babel/types";
import { parse as babelParse } from "../parse.ts";

/**
 * 字符串感知的括号深度扫描：引号内字符不当结构（与 findReplaceSeparator 同口径）。
 * 与 parseCaseArgExpr 的**原样 slice**（不反转义）一致：引号内 `\` 不是转义
 * ——`"foo\"` 的值是 `foo\`，引号正常闭合。此前把 `\` 当转义会吃掉闭合引号，
 * 整条 case 被静默丢弃。
 * onChar 对每个可见字符（含字符串内容）回调；onStructural 仅对非字符串字符回调。
 */
function scanWithStrings(
  s: string,
  onChar: (ch: string, i: number) => void,
  onStructural: (ch: string, i: number, depth: number) => void,
): void {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      onChar(ch, i);
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      onChar(ch, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      onChar(ch, i);
      onStructural(ch, i, depth);
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      onChar(ch, i);
      onStructural(ch, i, depth);
      continue;
    }
    onChar(ch, i);
    onStructural(ch, i, depth);
  }
}

export function splitTopLevelArgs(s: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      current += ch;
      // 原样 slice：`\` 不是转义（与 parseCaseArgExpr 一致）
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export function findTopLevelColon(s: string): number {
  let found = -1;
  scanWithStrings(
    s,
    () => {},
    (ch, i, depth) => {
      if (found === -1 && ch === ":" && depth === 0) found = i;
    },
  );
  return found;
}

export function findTopLevelArrow(s: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && ch === "=" && s[i + 1] === ">") return i;
  }
  return -1;
}

export function parseArrowFunctionExpr(expr: string): { params: string[]; body: Node; paramPatterns: Node[] } | null {
  // Try to parse as an arrow function expression
  try {
    // Wrap in a variable declaration to make it a valid statement
    const wrapped = `const __mock = ${expr};`;
    const ast = babelParse(wrapped);

    const decl = ast.program.body[0];
    if (decl.type !== "VariableDeclaration") return null;

    const init = decl.declarations[0]?.init;
    if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) {
      return null;
    }

    const params: string[] = [];
    const paramPatterns: Node[] = [];
    for (let i = 0; i < init.params.length; i++) {
      const param = init.params[i];
      if (param.type === "Identifier") {
        params.push(param.name);
        paramPatterns.push(param);
      } else if (param.type === "RestElement" && param.argument.type === "Identifier") {
        // Handle rest parameters: (...args) => ...
        params.push(`...${param.argument.name}`);
        paramPatterns.push(param);
      } else if (param.type === "ArrayPattern" || param.type === "ObjectPattern") {
        // Handle destructuring patterns: ([a, b]) => ... or ({x, y}) => ...
        params.push(`__destructured_${i}`);
        paramPatterns.push(param);
      }
    }

    return { params, body: init.body, paramPatterns };
  } catch {
    return null;
  }
}
