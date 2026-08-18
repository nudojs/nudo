import { dirname } from "node:path";
import type { Node } from "@babel/types";
import { createEnvironment, type Environment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import {
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  resetMemo,
} from "@nudojs/cli/evaluator";
import { resolveModule } from "./analyzer.ts";

/**
 * Semantic tokens 图例（tokenTypes 下标即 LSP 编码里的 tokenType 值）。
 * 与 LSP server capabilities 里声明的 legend 必须逐字对齐——server.ts 直接
 * 导入本常量注册，保证「提取端索引」与「客户端图例」单一来源。
 * 顺序沿用 lsp 包原 legend（function/variable/parameter/property 在前），
 * 末尾追加 method（对象字面量方法键），只追加不重排，客户端索引稳定。
 */
export const SEMANTIC_TOKEN_TYPES = [
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
  "method",
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
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

/** LSP 标准相对五元组编码：deltaLine/deltaStartChar/length/tokenType/tokenModifiers。 */
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

const TYPE_FUNCTION = SEMANTIC_TOKEN_TYPES.indexOf("function");
const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");
const TYPE_PARAMETER = SEMANTIC_TOKEN_TYPES.indexOf("parameter");
const TYPE_PROPERTY = SEMANTIC_TOKEN_TYPES.indexOf("property");
const TYPE_METHOD = SEMANTIC_TOKEN_TYPES.indexOf("method");
const MOD_DECLARATION = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("declaration");

/**
 * 从源码提取 semantic tokens 并按 LSP 相对编码返回扁平 number[]。
 *
 * 上色范围（声明位优先，未解析的 token 一律不上色）：
 * - 顶层 const/let/var 声明的绑定名：推断为函数绑定 → function，否则 variable
 *   （函数体内部的声明不做 env 反查——外层同名绑定会串味，统一 variable）；
 * - 函数声明/函数表达式的名字 → function；所有函数的参数 → parameter；
 * - 对象字面量的键：值为函数 → method，否则 property。
 *
 * 推断复用 evaluateProgram 的绑定分析（与补全/诊断同一求值链），不另建
 * 符号体系；解析失败返回 []，求值中断则按已绑定的部分结果继续上色。
 */
export function buildSemanticTokens(filePath: string, source: string): number[] {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return [];
  }

  const env = createEnvironment();
  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));
  try {
    evaluateProgram(ast, env);
  } catch {
    // 求值中断（如未支持语法）：尽力而为，用已落进 env 的绑定继续上色
  } finally {
    setModuleResolver(null);
  }

  const program = (ast as { program?: Node }).program ?? ast;
  const ownBindings = env.getOwnBindings();
  // 顶层声明器节点集合：仅这些绑定名做 env 反查区分 function/variable
  const topLevelDeclarators = new Set<unknown>();
  for (const stmt of ((program as { body?: Node[] }).body ?? []) as Node[]) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? ((stmt as { declaration?: Node }).declaration ?? null)
        : stmt;
    if (decl && decl.type === "VariableDeclaration") {
      for (const d of (decl as unknown as { declarations: Node[] }).declarations) {
        topLevelDeclarators.add(d);
      }
    }
  }

  const tokens: SemanticToken[] = [];
  const pushIdentifier = (id: Node, typeIndex: number): void => {
    const loc = (id as { loc?: { start: { line: number; column: number } } }).loc;
    const name = (id as { name?: string }).name;
    if (!loc || typeof name !== "string") return;
    tokens.push({
      line: loc.start.line - 1,
      char: loc.start.column,
      length: name.length,
      typeIndex,
      modifierBitmask: MOD_DECLARATION,
    });
  };

  const collectParams = (params: Node[]): void => {
    for (const p of params) {
      if (!p) continue;
      if (p.type === "Identifier") pushIdentifier(p, TYPE_PARAMETER);
      else if (p.type === "AssignmentPattern" && (p as { left?: Node }).left?.type === "Identifier") {
        pushIdentifier((p as { left: Node }).left, TYPE_PARAMETER);
      } else if (p.type === "RestElement" && (p as { argument?: Node }).argument?.type === "Identifier") {
        pushIdentifier((p as { argument: Node }).argument, TYPE_PARAMETER);
      }
      // 解构模式（ObjectPattern/ArrayPattern）内部不上色：子绑定的
      // function/variable 区分没有可靠推断依据，宁缺毋滥
    }
  };

  const isFunctionValue = (name: string): boolean =>
    ownBindings[name]?.kind === "function";

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    switch (n.type) {
      case "VariableDeclarator": {
        const id = n.id as Node | undefined;
        if (id?.type === "Identifier") {
          const isTopLevel = topLevelDeclarators.has(node);
          const typeIndex =
            isTopLevel && isFunctionValue((id as { name: string }).name) ? TYPE_FUNCTION : TYPE_VARIABLE;
          pushIdentifier(id, typeIndex);
        }
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression": {
        const id = n.id as Node | undefined;
        if (id?.type === "Identifier") pushIdentifier(id, TYPE_FUNCTION);
        collectParams((n.params as Node[] | undefined) ?? []);
        break;
      }
      case "ArrowFunctionExpression":
        collectParams((n.params as Node[] | undefined) ?? []);
        break;
      case "ObjectMethod": {
        const key = n.key as Node | undefined;
        if (key?.type === "Identifier" && !n.computed) pushIdentifier(key, TYPE_METHOD);
        collectParams((n.params as Node[] | undefined) ?? []);
        break;
      }
      case "ObjectProperty": {
        const key = n.key as Node | undefined;
        const value = n.value as Node | undefined;
        if (key?.type === "Identifier" && !n.computed) {
          const isFn =
            value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression";
          pushIdentifier(key, isFn ? TYPE_METHOD : TYPE_PROPERTY);
        }
        break;
      }
    }

    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      const child = n[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string") {
            visit(item);
          }
        }
      } else if (child && typeof child === "object" && typeof (child as { type?: unknown }).type === "string") {
        visit(child);
      }
    }
  };

  visit(program);

  tokens.sort((a, b) => a.line - b.line || a.char - b.char);
  return encodeSemanticTokens(tokens);
}
