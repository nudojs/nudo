import type { Node } from "@babel/types";
import { formalParamsFromNodes, type FormalParam } from "@nudojs/core";
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

/**
 * 箭头 / 函数表达式的扫描结果（mock 载荷、sinon callsFake、case 实参共用）。
 */
export type ArrowFnScan = {
  /**
   * 形参表（1:1 于形参个数）：**JS 源码形态**——
   * 标识符形参是名字（`x`）；默认形参保留默认值（`a = 1`）；rest 保留 `...`；
   * 解构形参保留源码形态（`{ a, b }`）。
   * 消费面（core 的 body 编译 / service 的 mock 绑定）按此拼函数签名。
   */
  params: string[];
  body: Node;
  /** 形参 AST（原样，1:1 于 params）——解构 / 默认值 / rest 的完整绑定语义 */
  paramPatterns: Node[];
  /** async 标志：`async (x) => …`（Bug 857） */
  async: boolean;
  /**
   * 每个形参**绑定的名字**（1:1 于 params）——
   * 解构形参列出全部顶层绑定名（`{ a, b }` ⇒ `["a","b"]`），
   * rest 形参是裸名（`args`，去掉字面 `...`），默认形参是绑定名（`a`）。
   * 自由标识符分析（作用域）按此判定「已被形参绑定」。
   */
  boundNames: string[][];
};

/** 扫描包装前缀——形参源码形态的偏移基准 */
const ARROW_WRAPPER_PREFIX = "const __mock = ";

/**
 * 形参的**源码形态**（拼函数签名用）：默认形参保留默认值、rest 保留 `...`。
 * Babel 节点带 start/end（相对包装串）⇒ 按前缀长度回退到原表达式坐标。
 */
function paramSource(param: Node, expr: string): string {
  const start = param.start;
  const end = param.end;
  if (typeof start === "number" && typeof end === "number") {
    const from = start - ARROW_WRAPPER_PREFIX.length;
    const to = end - ARROW_WRAPPER_PREFIX.length;
    if (from >= 0 && to <= expr.length && from < to) return expr.slice(from, to);
  }
  return "";
}

/** 形参**绑定的名字**（作用域用）——单源：core 的 formalParamsFromNodes */
function boundNamesOf(formal: FormalParam | undefined): string[] {
  if (!formal) return [];
  switch (formal.kind) {
    case "id":
    case "default":
      return [formal.name];
    case "rest":
      // rest 的契约面是**裸名**（`args`）——展示名 `...args` 只用于签名
      return [formal.name];
    case "pattern":
      // 解构：顶层绑定名（`{ a, b }` ⇒ a、b）；嵌套名不在顶层契约面
      return [...formal.bound];
  }
}

/**
 * 扫描箭头 / 函数表达式：形参（**绑定语义**）+ 体 + async 标志。
 *
 * Bug 857：`async (x) => …` 的 async 语义此前被静默丢弃 ⇒ mock 被建模成同步
 * 函数 ⇒ 调用点 `f(1).then(…)` 报「method 'then' missing on number receiver」。
 *
 * Bug 858：形参此前**没有绑定语义**——解构形参退化成占位名（`__destructured_0`）、
 * 默认值形参被整条丢弃（连同 `params` / `paramPatterns` 的下标对齐）、rest 保留
 * 字面 `...`。现在：形参表是源码形态（签名用）、`boundNames` 是绑定名（作用域用）、
 * `paramPatterns` 是原样 AST（消费面可自行解构），三者 1:1 对齐。
 */
export function parseArrowFunctionExpr(expr: string): ArrowFnScan | null {
  // Try to parse as an arrow function expression
  try {
    // Wrap in a variable declaration to make it a valid statement
    const wrapped = `${ARROW_WRAPPER_PREFIX}${expr};`;
    const ast = babelParse(wrapped);

    const decl = ast.program.body[0];
    if (decl.type !== "VariableDeclaration") return null;

    const init = decl.declarations[0]?.init;
    if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) {
      return null;
    }

    // 形参绑定语义单源：core 的 formalParamsFromNodes（契约面同一真理源）。
    // core 会跳过 TS 的 `this` 接收者标注——这里同口径过滤，保证与形参表 1:1 对齐。
    const rawParams = init.params.filter(
      (p) => !(p.type === "Identifier" && p.name === "this"),
    );
    const formals = formalParamsFromNodes(rawParams as never);

    const params: string[] = [];
    const boundNames: string[][] = [];
    const paramPatterns: Node[] = [];
    for (let i = 0; i < rawParams.length; i++) {
      const param = rawParams[i]!;
      paramPatterns.push(param);
      params.push(paramSource(param, expr));
      boundNames.push(boundNamesOf(formals[i]));
    }

    return {
      params,
      body: init.body,
      paramPatterns,
      async: init.async === true,
      boundNames,
    };
  } catch {
    return null;
  }
}
