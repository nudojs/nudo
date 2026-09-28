/**
 * 源码文本工具：注释/字符串字面量剥离。
 * 原文正则特性探测（require/import/exports 等）必须先剥再测——
 * 字符串或注释里的同名片段不是代码。
 * 单遍状态机：字符串/模板/注释互不串台（字符串里的 `//` 不是注释）。
 */
export function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const next = i + 1 < n ? source[i + 1]! : "";
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && i + 1 < n && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
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
      out += '""';
      continue;
    }
    out += c;
    i++;
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
