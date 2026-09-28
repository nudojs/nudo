/**
 * 源码文本工具：注释/字符串/正则字面量剥离。
 * 原文正则特性探测（require/import/exports 等）必须先剥再测——
 * 字符串或注释里的同名片段不是代码。
 *
 * 扫描语义（单遍状态机）：
 * - 字符串/模板/注释互不串台（字符串里的 `//` 不是注释）。
 * - 模板插值 `${…}` 是**代码岛**：内部按普通代码继续扫（可嵌套模板/字符串/
 *   正则/注释），只把真正的字符串内容当 string——`${require()}` 里的 require
 *   是真代码，必须可见；嵌套模板按深度配对，内外不串台。
 * - 正则字面量按 division-vs-regex 启发式识别（前一有效 token 决定 `/`）：
 *   `/https?:\/\//` 尾部 `//` 不会误开行注释；regex 体整体当 string 剥掉，
 *   避免 `/import *from/` 误命中 import 探针。
 * - 已知限制：`if (x) /re/` 这类 `)` 后紧跟 regex 的极端写法会当除法；
 *   目标是探测器正确，不做完整 JS 词法。
 */

type TextSpan = { kind: "code" | "comment" | "string"; text: string };

export type StringLiteralSpan = {
  /** 引号内原文（转义未折叠；模块 specifier 无需折叠） */
  value: string;
  /** 开引号下标 */
  start: number;
  /** 含两侧引号的总长 */
  length: number;
};

type ScanResult = {
  spans: TextSpan[];
  literals: StringLiteralSpan[];
};

/** `/` 在这些词之后是 regex 开始，否则按除法 */
const REGEX_KEYWORDS = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "new",
  "of", "return", "throw", "typeof", "void", "yield",
]);

/** 前一有效 token：决定 `/` 是 regex 还是除法 */
type PrevTok =
  | { t: "none" }
  | { t: "value" }
  | { t: "kw"; name: string }
  | { t: "op" };

function regexAllowed(prev: PrevTok): boolean {
  switch (prev.t) {
    case "none":
      return true;
    case "value":
      return false;
    case "kw":
      return REGEX_KEYWORDS.has(prev.name);
    case "op":
      return true;
  }
}

const isIdStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
const isIdPart = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/** 从开引号/反引号扫完一个字符串/模板字面量（不含插值递归）；返回结束下标 */
function scanQuoted(source: string, start: number): number {
  const n = source.length;
  const quote = source[start]!;
  let i = start + 1;
  while (i < n) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return n;
}

/** 从开 `/` 扫完一个正则字面量（含 flags）；返回结束下标 */
function scanRegex(source: string, start: number): number {
  const n = source.length;
  let i = start + 1;
  let inClass = false;
  while (i < n) {
    const c = source[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i; // 未闭合：按行截断
    if (c === "[") {
      inClass = true;
      i++;
      continue;
    }
    if (c === "]" && inClass) {
      inClass = false;
      i++;
      continue;
    }
    if (c === "/" && !inClass) {
      i++;
      while (i < n && /[a-z]/i.test(source[i]!)) i++;
      return i;
    }
    i++;
  }
  return n;
}

/**
 * 单遍词法切片：code / comment / string。
 * 模板的 cooked 段算 string（含定界符与相邻的 `${` / `}`）；
 * `${…}` 插值区按 code 扫描。正则字面量算 string（不进 literals）。
 */
function scanSource(source: string): ScanResult {
  const spans: TextSpan[] = [];
  const literals: StringLiteralSpan[] = [];
  const n = source.length;
  let prev: PrevTok = { t: "none" };

  const emit = (kind: TextSpan["kind"], start: number, end: number): void => {
    if (end > start) spans.push({ kind, text: source.slice(start, end) });
  };

  /** 收集简单字面量（普通引号串 / 完整无插值模板）；插值模板 cooked 段不报 */
  const pushLiteral = (start: number, end: number): void => {
    const text = source.slice(start, end);
    const quote = text[0]!;
    if (quote !== '"' && quote !== "'" && quote !== "`") return;
    const closed = text.length >= 2 && text[text.length - 1] === quote;
    const value = closed ? text.slice(1, -1) : text.slice(1);
    // 只报完整无插值模板；`}…\`` 尾段不是字面量
    if (quote === "`" && (!closed || value.includes("${"))) return;
    literals.push({ value, start, length: text.length });
  };

  /**
   * 扫描代码区。stopAtBrace=true 时停在闭合插值的 `}`（不含），否则扫到 EOF。
   * 返回停止下标。
   */
  const scanCode = (from: number, stopAtBrace: boolean): number => {
    let i = from;
    let codeStart = from;
    let depth = 0; // 插值/对象字面量花括号深度
    while (i < n) {
      const c = source[i]!;
      const next = i + 1 < n ? source[i + 1]! : "";
      if (c === "/" && next === "/") {
        emit("code", codeStart, i);
        const start = i;
        while (i < n && source[i] !== "\n") i++;
        emit("comment", start, i);
        codeStart = i;
        continue;
      }
      if (c === "/" && next === "*") {
        emit("code", codeStart, i);
        const start = i;
        i += 2;
        while (i < n && !(source[i] === "*" && i + 1 < n && source[i + 1] === "/")) i++;
        i = Math.min(i + 2, n);
        emit("comment", start, i);
        codeStart = i;
        continue;
      }
      if (c === '"' || c === "'") {
        emit("code", codeStart, i);
        const end = scanQuoted(source, i);
        emit("string", i, end);
        pushLiteral(i, end);
        i = end;
        codeStart = i;
        prev = { t: "value" };
        continue;
      }
      if (c === "`") {
        emit("code", codeStart, i);
        i = scanTemplate(i);
        codeStart = i;
        prev = { t: "value" };
        continue;
      }
      if (c === "/") {
        if (regexAllowed(prev)) {
          emit("code", codeStart, i);
          const end = scanRegex(source, i);
          emit("string", i, end); // regex 体不进探针匹配面
          i = end;
          codeStart = i;
          prev = { t: "value" };
          continue;
        }
        // 除法（/= 一并吞掉，避免 `=` 被当成 regex 开头）
        i += next === "=" ? 2 : 1;
        prev = { t: "op" };
        continue;
      }
      if (c === "{") {
        depth++;
        i++;
        prev = { t: "op" };
        continue;
      }
      if (c === "}") {
        if (stopAtBrace && depth === 0) {
          emit("code", codeStart, i);
          return i;
        }
        depth--;
        i++;
        prev = { t: "op" };
        continue;
      }
      if (isIdStart(c)) {
        const start = i;
        while (i < n && isIdPart(source[i]!)) i++;
        const word = source.slice(start, i);
        prev = REGEX_KEYWORDS.has(word) ? { t: "kw", name: word } : { t: "value" };
        continue;
      }
      if (/\s/.test(c)) {
        i++; // 空白不改变 prev
        continue;
      }
      if (isDigit(c) || (c === "." && isDigit(next))) {
        i++;
        while (i < n && /[0-9a-fA-Fn_xXoObBeE.]/.test(source[i]!)) {
          // `1e+10` 的 +/- 留给后续 op/数字扫，对启发式无影响
          i++;
        }
        prev = { t: "value" };
        continue;
      }
      if ((c === "+" || c === "-") && next === c) {
        i += 2;
        prev = { t: "value" }; // ++/-- 后是值位置
        continue;
      }
      if (c === ")" || c === "]") {
        i++;
        prev = { t: "value" };
        continue;
      }
      i++;
      prev = { t: "op" };
    }
    emit("code", codeStart, n);
    return n;
  };

  /** 从开反引号扫模板（含嵌套插值）；返回结束下标 */
  const scanTemplate = (from: number): number => {
    let i = from;
    let strStart = from;
    i++; // 跳过开引号
    while (i < n) {
      const c = source[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        emit("string", strStart, i);
        pushLiteral(strStart, i);
        return i;
      }
      if (c === "$" && i + 1 < n && source[i + 1] === "{") {
        // cooked 段 + `${` 归 string（定界符不进代码，避免 brace 串台）
        i += 2;
        emit("string", strStart, i);
        prev = { t: "op" }; // 插值起始是表达式位置，允许 regex
        i = scanCode(i, true);
        if (i < n && source[i] === "}") {
          // `}` 开启下一段 cooked，归 string
          i++;
          strStart = i - 1;
          continue;
        }
        return i;
      }
      i++;
    }
    emit("string", strStart, i);
    return i;
  };

  scanCode(0, false);
  return { spans, literals };
}

export function stripCommentsAndStrings(source: string): string {
  let out = "";
  for (const span of scanSource(source).spans) {
    if (span.kind === "code") out += span.text;
    else if (span.kind === "comment") out += " ";
    else out += '""';
  }
  return out;
}

/**
 * 只剥字符串/模板/正则，**保留注释原文**。
 * `@nudo:` 指令合法住在 JSDoc/行注释里——指令存在性探针不能吃掉注释，
 * 否则真指令被漏扫；同时字符串里的假指令文本必须不算命中。
 * 模板插值 `${…}` 是代码，保留。
 */
export function stripStringsKeepComments(source: string): string {
  let out = "";
  for (const span of scanSource(source).spans) {
    out += span.kind === "string" ? '""' : span.text;
  }
  return out;
}

/**
 * 等长掩码：注释与字符串/模板/正则整段替换为空格（保留 `\n` 侧行号对齐）。
 * 插值 `${…}` 的**代码**保留，定界符与 cooked 段变空格——下标与原文一一对应。
 * 供定位/改写在**代码区**进行。
 */
export function maskCommentsAndStrings(source: string): string {
  let out = "";
  for (const span of scanSource(source).spans) {
    if (span.kind === "code") out += span.text;
    else out += span.text.replace(/[^\n]/g, " ");
  }
  return out;
}

/** 代码区字符串/模板字面量（注释内引号不算；插值模板不报整体，正则不报） */
export function scanStringLiterals(source: string): StringLiteralSpan[] {
  return scanSource(source).literals;
}

/** 真实 `require(` 调用（忽略字符串/注释/正则；模板插值内可见） */
export function sourceHasRequireCall(source: string): boolean {
  return /\brequire\s*\(/.test(stripCommentsAndStrings(source));
}

/** 真实 import / require 模块依赖（忽略字符串/注释/正则；模板插值内可见） */
export function sourceHasModuleDependency(source: string): boolean {
  const s = stripCommentsAndStrings(source);
  return /\brequire\s*\(/.test(s) || /\bimport\s*[{'"*]/.test(s);
}

/** 真实 CJS exports 赋值面（exports.x / exports[x] / module.x） */
export function sourceHasCjsExports(source: string): boolean {
  return /\b(?:exports|module)\s*(?:\.|\[)/.test(stripCommentsAndStrings(source));
}

/** 标识符/导出名插入 RegExp 前转义（`$` `.` `Class.method` 等） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
