import type { Node } from "@babel/types";
import { parse } from "@nudojs/parser";
import { collectAbsBindingsFromGraph } from "@nudojs/service";
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
 * 末尾追加 method（对象字面量方法键）、class（类名）与 interface 档 modifier（A7），
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
  "class",
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "readonly",
  "deprecated",
  "unreachable",
  /** handwritten：显式契约（侧车手写 / @nudo:contract） */
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
const TYPE_CLASS = SEMANTIC_TOKEN_TYPES.indexOf("class");
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
 * - 类名 → class；类方法键 → method、类字段键 → property；类方法形参 → parameter；
 * - 解构绑定（对象 / 数组模式）→ variable（绑定名，不是属性键）；
 * - 对象字面量的键：值为函数 → method，否则 property；简写 `{ x }` 是对变量的
 *   **引用** → variable（不带 declaration modifier）。
 *
 * A7：本地 named export 的函数绑定额外带 interface 档 modifier
 * （contract / generated / derived），与 CodeLens `● interface` 同源。
 * 非导出绑定只带 declaration，不假装进档。
 *
 * 推断优先 Abs 模块图绑定（TypeValue 退出主路径）；失败时复用
 * evaluateProgram。**解析失败走词法降级**（{@link lexicalFallbackTokens}）——
 * 语法非法 buffer 上**不整面清零**（见该函数的取舍说明）。
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
    // 语法非法 buffer ⇒ **降级而非清零**（Babel 的 errorRecovery 只覆盖极少数
    // 错误，「Unexpected token」照样抛 ⇒ 不能靠它兜底）⇒ 走词法降级。
    return encodeSemanticTokens(lexicalFallbackTokens(source));
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
  /**
   * 推一个标识符 token。
   *
   * - **length 用源码跨度**（`loc.end.column - loc.start.column`）：Babel 的
   *   `Identifier.name` 是**解码后**的名字（`abc`），而 `const \u0061bc = 1`
   *   这种转义写法的源码跨度是 8 ⇒ 用 `name.length` 会让 token 只盖住转义
   *   序列的前半截（Bug 723）。`loc.end` 不可用时回退源码偏移区间，最后才
   *   回退 `name.length`（仅当源码写法与名字一致时才等长）。
   * - char / length 均为 **UTF-16 code unit**（Babel 的 column 口径）。
   * - `declaration = false` ⇒ 该 token 是**引用位**（如对象字面量简写
   *   `{ x }`），不带 declaration modifier（Bug 721）。
   */
  const pushIdentifier = (
    id: Node,
    typeIndex: number,
    extraMod = 0,
    declaration = true,
  ): void => {
    const loc = (
      id as {
        loc?: {
          start: { line: number; column: number };
          end?: { line: number; column: number };
        };
      }
    ).loc;
    const name = (id as { name?: string }).name;
    if (!loc || typeof name !== "string") return;
    const startColumn = loc.start.column;
    const endColumn = loc.end?.column;
    const nodeStart = (id as { start?: number }).start;
    const nodeEnd = (id as { end?: number }).end;
    const sourceSpan =
      typeof nodeStart === "number" && typeof nodeEnd === "number" && nodeEnd > nodeStart
        ? nodeEnd - nodeStart
        : undefined;
    const length =
      typeof endColumn === "number" && endColumn > startColumn
        ? endColumn - startColumn
        : (sourceSpan ?? name.length);
    tokens.push({
      line: loc.start.line - 1,
      char: startColumn,
      length,
      typeIndex,
      modifierBitmask: (declaration ? MOD_DECLARATION : 0) | extraMod,
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

  const visit = (node: unknown, parent?: Node): void => {
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
      // CJS 成员导出：`exports.f = fn` / `module.exports.f = fn` —— 键名即导出名，
      // 带 interface 档 modifier（与 ESM `export function f` 同口径；Bug 998）
      case "AssignmentExpression": {
        const operator = n.operator as string | undefined;
        const left = n.left as Node | undefined;
        const right = n.right as Node | undefined;
        if (operator !== "=" || !left || !right) break;
        if (left.type !== "MemberExpression") break;
        const me = left as { computed?: boolean; object?: Node; property?: Node };
        if (me.computed === true) break;
        const obj = me.object;
        if (!obj) break;
        const isExports =
          obj.type === "Identifier" && (obj as { name?: string }).name === "exports";
        const objMember =
          obj.type === "MemberExpression"
            ? (obj as { object?: Node; property?: Node })
            : undefined;
        const isModuleExports =
          objMember?.object?.type === "Identifier" &&
          (objMember.object as { name?: string }).name === "module" &&
          objMember.property?.type === "Identifier" &&
          (objMember.property as { name?: string }).name === "exports";
        if (!isExports && !isModuleExports) break;
        const prop = me.property;
        if (prop?.type !== "Identifier") break;
        if (right.type !== "FunctionExpression" && right.type !== "ArrowFunctionExpression") break;
        const name = (prop as { name: string }).name;
        pushIdentifier(prop, TYPE_FUNCTION, tierModFor(name));
        break;
      }
      case "ArrowFunctionExpression":
        collectParams((n.params as Node[] | undefined) ?? []);
        break;
      // 类名 → class 档（Bug 701）
      case "ClassDeclaration":
      case "ClassExpression": {
        const id = n.id as Node | undefined;
        if (id?.type === "Identifier") pushIdentifier(id, TYPE_CLASS);
        break;
      }
      // 类方法键 → method 档；方法形参 → parameter 档（Bug 701）
      case "ClassMethod":
      case "ClassPrivateMethod": {
        const key = n.key as Node | undefined;
        if (key?.type === "Identifier" && !n.computed) pushIdentifier(key, TYPE_METHOD);
        collectParams((n.params as Node[] | undefined) ?? []);
        break;
      }
      // 类字段键 → property 档（Bug 701）
      case "ClassProperty": {
        const key = n.key as Node | undefined;
        if (key?.type === "Identifier" && !n.computed) pushIdentifier(key, TYPE_PROPERTY);
        break;
      }
      case "ObjectMethod": {
        const key = n.key as Node | undefined;
        if (key?.type === "Identifier" && !n.computed) pushIdentifier(key, TYPE_METHOD);
        collectParams((n.params as Node[] | undefined) ?? []);
        break;
      }
      case "ObjectProperty": {
        const key = n.key as Node | undefined;
        const value = n.value as Node | undefined;
        // 解构绑定（父节点是 ObjectPattern）⇒ 绑定名是 **value** 侧，不是属性键
        if (parent?.type === "ObjectPattern") {
          const bound =
            value?.type === "AssignmentPattern" ? (value as { left?: Node }).left : value;
          if (bound?.type === "Identifier") pushIdentifier(bound, TYPE_VARIABLE);
          break;
        }
        if (key?.type === "Identifier" && !n.computed) {
          // 简写 `{ x }` ⇒ 对变量的**引用**（不是属性定义）⇒ variable 且不带
          // declaration modifier（Bug 721）
          if (n.shorthand === true) {
            pushIdentifier(key, TYPE_VARIABLE, 0, false);
            break;
          }
          const isFn =
            value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression";
          pushIdentifier(key, isFn ? TYPE_METHOD : TYPE_PROPERTY);
        }
        break;
      }
      // 数组解构的元素 ⇒ variable 绑定（Bug 701）
      case "ArrayPattern": {
        for (const el of (n.elements as Node[] | undefined) ?? []) {
          if (!el) continue;
          if (el.type === "Identifier") {
            pushIdentifier(el, TYPE_VARIABLE);
          } else if (
            el.type === "AssignmentPattern" &&
            (el as { left?: Node }).left?.type === "Identifier"
          ) {
            pushIdentifier((el as { left: Node }).left, TYPE_VARIABLE);
          } else if (
            el.type === "RestElement" &&
            (el as { argument?: Node }).argument?.type === "Identifier"
          ) {
            pushIdentifier((el as { argument: Node }).argument, TYPE_VARIABLE);
          }
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
            visit(item, node as Node);
          }
        }
      } else if (child && typeof child === "object" && typeof (child as { type?: unknown }).type === "string") {
        visit(child, node as Node);
      }
    }
  };

  visit(program);

  tokens.sort((a, b) => a.line - b.line || a.char - b.char);
  return encodeSemanticTokens(tokens);
}

/**
 * **词法降级**：语法非法 buffer 上保住**部分** semantic token。
 *
 * 背景：解析失败此前直接 `return []` ⇒ 客户端把**整面**颜色清掉（用户改到一半
 * 语法非法 ⇒ 整个文件瞬间没色 ⇒ 语义高亮「一闪就没」）。
 *
 * 做法：把注释 / 字符串内容**挖空**（保留长度与换行 ⇒ 坐标不变）⇒ 再按关键字
 * （`function` / `class` / `const` / `let` / `var`）取紧随其后的标识符。
 *
 * 取舍（说明）：
 * - **只给声明位上色**（函数名 / 类名 / 变量名）⇒ 降级档**不撒谎**：
 *   成员访问 / 参数 / 引用位一律不上色（静态不可知 ⇒ 不猜）。
 * - **不缓存上次成功结果** ⇒ 不会拿**旧坐标**染色（用户改了一行 ⇒ 上次坐标全错，
 *   比清零更坏）。
 * - 代价：降级档**认不出方法键 / 参数 / 解构绑定**（宁可少上色，不可错上色）。
 */
function lexicalFallbackTokens(source: string): SemanticToken[] {
  const masked = maskCommentsAndStrings(source);
  const tokens: SemanticToken[] = [];
  const KEYWORDS: Array<{ kw: string; typeIndex: number }> = [
    { kw: "function", typeIndex: TYPE_FUNCTION },
    { kw: "class", typeIndex: TYPE_CLASS },
    { kw: "const", typeIndex: TYPE_VARIABLE },
    { kw: "let", typeIndex: TYPE_VARIABLE },
    { kw: "var", typeIndex: TYPE_VARIABLE },
  ];
  for (const { kw, typeIndex } of KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "g");
    for (;;) {
      const m = re.exec(masked);
      if (!m) break;
      const kwStart = m.index;
      const kwEnd = kwStart + kw.length;
      // 成员访问（`x.function`）不是声明 ⇒ 跳过
      const prev = previousNonSpace(masked, kwStart);
      if (prev === ".") continue;
      // 声明名：关键字之后（允许 `*` 生成器标记与空白）的标识符
      let i = kwEnd;
      while (i < masked.length && /\s/.test(masked[i]!)) i++;
      if (masked[i] === "*") {
        i++;
        while (i < masked.length && /\s/.test(masked[i]!)) i++;
      }
      const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(masked.slice(i));
      if (!idMatch) continue;
      const name = idMatch[0];
      const nameStart = i;
      const nameEnd = i + name.length;
      // 对象字面量的键（`{ const: 1 }`）不是声明 ⇒ 跳过
      const after = masked[nameEnd];
      if (typeIndex === TYPE_VARIABLE && after === ":") continue;
      const { line, column } = lineColumnAt(source, nameStart);
      tokens.push({
        line,
        char: column,
        length: nameEnd - nameStart,
        typeIndex,
        modifierBitmask: MOD_DECLARATION,
      });
      re.lastIndex = nameEnd;
    }
  }
  tokens.sort((a, b) => a.line - b.line || a.char - b.char);
  return tokens;
}

/** 注释 / 字符串内容挖空（保留长度与换行 ⇒ 坐标不变） */
function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  let prevSignificant = "";
  const blank = (idx: number): void => {
    if (out[idx] !== "\n") out[idx] = " ";
  };
  while (i < n) {
    const ch = source[i]!;
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") {
        blank(i);
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          blank(i);
          blank(i + 1);
          i += 2;
          break;
        }
        blank(i);
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // 只在**值位置**当字符串开头（前一个有效字符是标识符 / 数字 / `)` / `]`
      // ⇒ 更可能是除号后的标识符或属性名）
      const isValuePos = prevSignificant === "" || !/[A-Za-z0-9_$)\]]/.test(prevSignificant);
      if (!isValuePos) {
        prevSignificant = ch;
        i++;
        continue;
      }
      const quote = ch;
      blank(i);
      i++;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          blank(i);
          if (i + 1 < n && source[i + 1] !== "\n") blank(i + 1);
          i += 2;
          continue;
        }
        if (c === quote) {
          blank(i);
          i++;
          break;
        }
        blank(i);
        i++;
      }
      prevSignificant = quote;
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return out.join("");
}

/** offset 之前的最后一个非空白字符（没有 ⇒ ""） */
function previousNonSpace(text: string, offset: number): string {
  for (let i = offset - 1; i >= 0; i--) {
    const c = text[i]!;
    if (!/\s/.test(c)) return c;
  }
  return "";
}

/** offset → (0-based 行, UTF-16 列) */
function lineColumnAt(source: string, offset: number): { line: number; column: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart };
}
