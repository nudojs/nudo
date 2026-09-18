import type { Node } from "@babel/types";
import { parse } from "@nudojs/parser";
import { collectAbsBindingsFromGraph } from "./abs-modules-graph.ts";
import {
  interfaceTierOf,
  type InterfaceSource,
  type InterfaceTierOpts,
} from "@nudojs/core";

/**
 * Semantic tokens 图例（tokenTypes 下标即 LSP 编码里的 tokenType 值）。
 * 与 LSP server capabilities 里声明的 legend 必须逐字对齐——server.ts 直接
 * 导入本常量注册，保证「提取端索引」与「客户端图例」单一来源。
 * 顺序沿用 lsp 包原 legend（function/variable/parameter/property 在前），
 * 末尾追加 method（对象字面量方法键）与 interface 档 modifier（A7），
 * 只追加不重排，客户端索引稳定。
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
  /** handwritten：显式契约（侧车手写 / @nudo:refine） */
  "contract",
  /** generated：侧车 @generated 段 */
  "generated",
  /** derived：implicit 展示档（非义务契约） */
  "derived",
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
const MOD_CONTRACT = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("contract");
const MOD_GENERATED = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("generated");
const MOD_DERIVED = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("derived");

/** A7：interface 档 → semantic token modifier（与 CodeLens 同源） */
export function interfaceTierModifierBit(src: InterfaceSource): number {
  return src === "handwritten" ? MOD_CONTRACT : src === "generated" ? MOD_GENERATED : MOD_DERIVED;
}

/**
 * 顶层绑定中「函数值」名集合。
 * Abs 模块图（shape.k === "fn"）；TypeValue evaluateProgram 已删除。
 */
function collectFunctionBindingNames(filePath: string, source: string, _ast: Node): Set<string> {
  try {
    const binds = collectAbsBindingsFromGraph(source, filePath);
    if (binds.size > 0) {
      const fns = new Set<string>();
      for (const [name, a] of binds) {
        if (a.shape.k === "fn") fns.add(name);
      }
      return fns;
    }
  } catch {
    /* fall through */
  }
  return new Set();
}

export type BuildSemanticTokensOpts = InterfaceTierOpts & {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/**
 * 从源码提取 semantic tokens 并按 LSP 相对编码返回扁平 number[]。
 *
 * 上色范围（声明位优先，未解析的 token 一律不上色）：
 * - 顶层 const/let/var 声明的绑定名：推断为函数绑定 → function，否则 variable
 *   （函数体内部的声明不做 env 反查——外层同名绑定会串味，统一 variable）；
 * - 函数声明/函数表达式的名字 → function；所有函数的参数 → parameter；
 * - 对象字面量的键：值为函数 → method，否则 property。
 *
 * A7：本地 named export 的函数绑定额外带 interface 档 modifier
 * （contract / generated / derived），与 CodeLens `● interface` 同源。
 * 非导出绑定只带 declaration，不假装进档。
 *
 * 推断优先 Abs 模块图绑定（TypeValue 退出主路径）；失败时复用
 * evaluateProgram。解析失败返回 []。
 */
export function buildSemanticTokens(
  filePath: string,
  source: string,
  opts?: BuildSemanticTokensOpts,
): number[] {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return [];
  }

  const functionNames = collectFunctionBindingNames(filePath, source, ast);

  const program = (ast as { program?: Node }).program ?? ast;
  const topLevelDeclarators = new Set<unknown>();
  const topLevelFnDeclNodes = new Set<unknown>();
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
    // Track top-level FunctionDeclaration nodes by identity — nested same-name
    // functions must not inherit the exported interface tier modifier.
    if (decl && decl.type === "FunctionDeclaration" && (decl as { id?: Node }).id) {
      topLevelFnDeclNodes.add(decl);
    }
  }

  const tierOpts: InterfaceTierOpts = {
    ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
    ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
  };
  const tierModCache = new Map<string, number>();
  const tierModFor = (name: string): number => {
    const cached = tierModCache.get(name);
    if (cached !== undefined) return cached;
    let bit = 0;
    try {
      const tier = interfaceTierOf(source, name, filePath, tierOpts);
      if (tier) bit = interfaceTierModifierBit(tier.source);
    } catch {
      bit = 0;
    }
    tierModCache.set(name, bit);
    return bit;
  };

  const tokens: SemanticToken[] = [];
  const pushIdentifier = (id: Node, typeIndex: number, extraMod = 0): void => {
    const loc = (id as { loc?: { start: { line: number; column: number } } }).loc;
    const name = (id as { name?: string }).name;
    if (!loc || typeof name !== "string") return;
    tokens.push({
      line: loc.start.line - 1,
      char: loc.start.column,
      length: name.length,
      typeIndex,
      modifierBitmask: MOD_DECLARATION | extraMod,
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
    }
  };

  const isFunctionValue = (name: string): boolean => functionNames.has(name);

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    switch (n.type) {
      case "VariableDeclarator": {
        const id = n.id as Node | undefined;
        if (id?.type === "Identifier") {
          const isTopLevel = topLevelDeclarators.has(node);
          const name = (id as { name: string }).name;
          const isFn = isTopLevel && isFunctionValue(name);
          const typeIndex = isFn ? TYPE_FUNCTION : TYPE_VARIABLE;
          // 仅顶层函数值导出带 interface 档 modifier（A7）
          const extraMod = isFn ? tierModFor(name) : 0;
          pushIdentifier(id, typeIndex, extraMod);
        }
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression": {
        const id = n.id as Node | undefined;
        if (id?.type === "Identifier") {
          const name = (id as { name: string }).name;
          // Only top-level FunctionDeclarations (Program / ExportNamed /
          // ExportDefault) get the interface tier modifier. Nested/local
          // declarations stay declaration-only so same-name inner functions
          // do not inherit the exported contract tier.
          const isTopLevelFnDecl =
            n.type === "FunctionDeclaration" && topLevelFnDeclNodes.has(node);
          const extraMod = isTopLevelFnDecl ? tierModFor(name) : 0;
          pushIdentifier(id, TYPE_FUNCTION, extraMod);
        }
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
