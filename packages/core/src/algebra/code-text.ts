/**
 * 源码文本工具：注释/字符串字面量剥离。
 * 原文正则特性探测（require/import/exports 等）必须先剥再测——
 * 字符串或注释里的同名片段不是代码。
 * 单遍状态机：字符串/模板/注释互不串台（字符串里的 `//` 不是注释）。
 */

type TextSpan = { kind: "code" | "comment" | "string"; text: string };

/** 单遍词法切片：code / comment / string（模板整段算 string，含 ${}——与历史 stripper 同口径）。 */
function textSpans(source: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const n = source.length;
  let i = 0;
  let codeStart = 0;
  const flushCode = (end: number): void => {
    if (end > codeStart) spans.push({ kind: "code", text: source.slice(codeStart, end) });
  };
  while (i < n) {
    const c = source[i]!;
    const next = i + 1 < n ? source[i + 1]! : "";
    if (c === "/" && next === "/") {
      flushCode(i);
      const start = i;
      while (i < n && source[i] !== "\n") i++;
      spans.push({ kind: "comment", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    if (c === "/" && next === "*") {
      flushCode(i);
      const start = i;
      i += 2;
      while (i < n && !(source[i] === "*" && i + 1 < n && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      spans.push({ kind: "comment", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      flushCode(i);
      const start = i;
      const quote = c;
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      spans.push({ kind: "string", text: source.slice(start, i) });
      codeStart = i;
      continue;
    }
    i++;
  }
  flushCode(n);
  return spans;
}

export function stripCommentsAndStrings(source: string): string {
  let out = "";
  for (const span of textSpans(source)) {
    if (span.kind === "code") out += span.text;
    else if (span.kind === "comment") out += " ";
    else out += '""';
  }
  return out;
}

/**
 * 只剥字符串/模板，**保留注释原文**。
 * `@nudo:` 指令合法住在 JSDoc/行注释里——指令存在性探针不能吃掉注释，
 * 否则真指令被漏扫；同时字符串里的假指令文本必须不算命中。
 */
export function stripStringsKeepComments(source: string): string {
  let out = "";
  for (const span of textSpans(source)) {
    out += span.kind === "string" ? '""' : span.text;
  }
  return out;
}

/**
 * 等长掩码：注释与字符串/模板字面量整段替换为空格（保留 `\n` 侧行号对齐）。
 * 供定位/改写在**代码区**进行——对掩码扫描得到的下标与原文一一对应。
 */
export function maskCommentsAndStrings(source: string): string {
  let out = "";
  for (const span of textSpans(source)) {
    if (span.kind === "code") out += span.text;
    else out += span.text.replace(/[^\n]/g, " ");
  }
  return out;
}

export type StringLiteralSpan = {
  /** 引号内原文（转义未折叠；模块 specifier 无需折叠） */
  value: string;
  /** 开引号下标 */
  start: number;
  /** 含两侧引号的总长 */
  length: number;
};

/** 代码区字符串/模板字面量（注释内的引号不算）。 */
export function scanStringLiterals(source: string): StringLiteralSpan[] {
  const out: StringLiteralSpan[] = [];
  let offset = 0;
  for (const span of textSpans(source)) {
    if (span.kind === "string") {
      const text = span.text;
      const quote = text[0]!;
      const closed = text.length >= 2 && text[text.length - 1] === quote;
      out.push({
        value: closed ? text.slice(1, -1) : text.slice(1),
        start: offset,
        length: text.length,
      });
    }
    offset += span.text.length;
  }
  return out;
}

/** 真实 `require(` 调用（忽略字符串/注释） */
export function sourceHasRequireCall(source: string): boolean {
  return /\brequire\s*\(/.test(stripCommentsAndStrings(source));
}

/** 真实 import / require 模块依赖（忽略字符串/注释） */
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
