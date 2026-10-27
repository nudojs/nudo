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

import type { File } from "@babel/types";
import { BoundedLruMap } from "./lru-map.ts";
import { parseSource } from "./parse-source.ts";

/**
 * 源级扫描结果 memo（四个字符串包装器各一个；词法扫描本身另有单源 memo）。
 *
 * 分析期同一源被多个抽取器反复整文件词法扫描：directive-scan 的
 * env / mock-module / import / malformed 各 extractor、refine /
 * check / generalize 的 `@nudo:contract` 存在性探针、load-deps
 * 依赖指纹——都是纯函数，同源同输出。memo 把「源字节数 × 调用
 * 次数」的 lexer 成本折成每唯一源一次（实测 semver hub-edit 路径
 * 每文件分析 ~245 次整文件扫描 → 每唯一源 1 次）。
 *
 * 有界（条数 LRU）：LSP 长驻留会话下防内存膨胀；未命中只退回
 * 全量扫描，无正确性影响。
 */
const SOURCE_SCAN_CACHE_MAX = 256;
const stripCommentsAndStringsCache = new BoundedLruMap<string>(
  SOURCE_SCAN_CACHE_MAX,
);
const stripStringsKeepCommentsCache = new BoundedLruMap<string>(
  SOURCE_SCAN_CACHE_MAX,
);
const maskCommentsAndStringsCache = new BoundedLruMap<string>(
  SOURCE_SCAN_CACHE_MAX,
);
const maskStringsKeepCommentsCache = new BoundedLruMap<string>(
  SOURCE_SCAN_CACHE_MAX,
);

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
 * 词法扫描结果的单源 memo（条数 LRU；比上面的字符串结果缓存小一个量级——
 * 一个 `ScanResult` 持有全部 span 对象）。
 *
 * 消费面有六个（strip×3 / mask×2 / scanStringLiterals），没有这层 memo 时
 * 同一源被整文件扫描 4 次以上（实测 `nudo check` 全语料里 code-text 的
 * 扫描循环占自身耗时 ~17%）。结果**只读共享**：`scanStringLiterals` 返回
 * 副本，其余消费方只遍历。
 */
const scanSourceCache = new BoundedLruMap<ScanResult>(8);

function scanSource(source: string): ScanResult {
  const hit = scanSourceCache.get(source);
  if (hit !== undefined) return hit;
  const out = scanSourceUncached(source);
  scanSourceCache.set(source, out);
  return out;
}

/**
 * 单遍词法切片：code / comment / string。
 * 模板的 cooked 段算 string（含定界符与相邻的 `${` / `}`）；
 * `${…}` 插值区按 code 扫描。正则字面量算 string（不进 literals）。
 */
function scanSourceUncached(source: string): ScanResult {
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
  const hit = stripCommentsAndStringsCache.get(source);
  if (hit !== undefined) return hit;
  let out = "";
  for (const span of scanSource(source).spans) {
    if (span.kind === "code") out += span.text;
    else if (span.kind === "comment") out += " ";
    else out += '""';
  }
  stripCommentsAndStringsCache.set(source, out);
  return out;
}

/**
 * 只剥字符串/模板/正则，**保留注释原文**。
 * `@nudo:` 指令合法住在 JSDoc/行注释里——指令存在性探针不能吃掉注释，
 * 否则真指令被漏扫；同时字符串里的假指令文本必须不算命中。
 * 模板插值 `${…}` 是代码，保留。
 */
export function stripStringsKeepComments(source: string): string {
  const hit = stripStringsKeepCommentsCache.get(source);
  if (hit !== undefined) return hit;
  let out = "";
  for (const span of scanSource(source).spans) {
    out += span.kind === "string" ? '""' : span.text;
  }
  stripStringsKeepCommentsCache.set(source, out);
  return out;
}

/**
 * 等长掩码：注释与字符串/模板/正则整段替换为空格（保留 `\n` 侧行号对齐）。
 * 插值 `${…}` 的**代码**保留，定界符与 cooked 段变空格——下标与原文一一对应。
 * 供定位/改写在**代码区**进行。
 */
export function maskCommentsAndStrings(source: string): string {
  const hit = maskCommentsAndStringsCache.get(source);
  if (hit !== undefined) return hit;
  let out = "";
  for (const span of scanSource(source).spans) {
    if (span.kind === "code") out += span.text;
    else out += span.text.replace(/[^\n]/g, " ");
  }
  maskCommentsAndStringsCache.set(source, out);
  return out;
}

/**
 * 等长掩码：只把字符串/模板/正则整段替换为空格（保留 `\n`），**注释原文保留**。
 * 下标与原文一一对应。供「先剥字符串再定位」的源码正则：
 * 字符串里的同形文本不是代码；但注释不能变空白——导出前缀与 function 之间
 * 若夹着契约注释，注释一旦成空白会被导出前缀的空白匹配吞掉，反向扫描扫不到契约。
 */
export function maskStringsKeepComments(source: string): string {
  const hit = maskStringsKeepCommentsCache.get(source);
  if (hit !== undefined) return hit;
  let out = "";
  for (const span of scanSource(source).spans) {
    out += span.kind === "string" ? span.text.replace(/[^\n]/g, " ") : span.text;
  }
  maskStringsKeepCommentsCache.set(source, out);
  return out;
}

/** 代码区字符串/模板字面量（注释内引号不算；插值模板不报整体，正则不报） */
export function scanStringLiterals(source: string): StringLiteralSpan[] {
  // 扫描结果按源 memo ⇒ 返回**副本**（公共面保持「调用方拿到的数组归自己」）
  return [...scanSource(source).literals];
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

/**
 * 真实 ESM 模块语法：静态 import 声明 / 任意 export 语句（忽略字符串/
 * 注释/正则）。有则该文件**必是 ESM**——二者在 CJS 里都是 SyntaxError；
 * 无则按 Node `.js` 无 `type:"module"` 的默认口径视为 CJS/脚本。动态
 * `import(...)` 不是模块语法（CJS 合法，排除）。
 *
 * 严格性判定**不只用**本函数：脚本形态的 `"use strict"` 指令序言同样是
 * strict mode code，但文本扫描先剥掉了字符串 ⇒ 看不见。源级严格性见
 * `sourceIsStrict`（= 本函数 ∨ 指令序言）。强制 strict 只对真 strict 源
 * 生效：CJS 里合法的 sloppy 语法（`arguments` 作绑定名/赋值目标等）在
 * new Function **编译期**直接 SyntaxError → 整模块 fail-closed 空导出且
 * 失败不进 memo（每次全量重转译）。
 */
export function sourceHasEsmSyntax(source: string): boolean {
  const s = stripCommentsAndStrings(source);
  // import 是保留字：代码区出现且后随非 `(`（动态）非 `:`（对象键）即静态
  // import（import.meta 同）；属性位 `.import` / `x. import` 由 `(?<![\w$.])`
  // 排除（点后空格形态极罕见，误报方向只是多打 strict，不炸编译）。
  if (/(?<![\w$.])import(?!\s*[(:])/.test(s)) return true;
  // export 同为保留字：属性位 `.export` 排除，对象字面量键 `export:` 由
  // `(?!:)` 排除；合法剩余面只剩 export 语句。
  return /(?<![\w$.])export\b(?!:)/.test(s);
}

/** AST 上承载指令序言的节点形状（Program / 函数体 BlockStatement）。 */
type DirectiveHost = {
  directives?:
    | ReadonlyArray<{
        value?: { value?: unknown; extra?: { raw?: unknown } | null } | null;
      } | null>
    | null;
};

/**
 * AST 节点的**指令序言**是否含 `"use strict"`。
 *
 * Program（脚本/模块）与函数体 BlockStatement 都带 `directives`——文本扫描
 * （`sourceHasEsmSyntax`）先剥字符串/注释，**看不见**指令，故严格性判定必须
 * 走 AST。带转义序列的字符串（`"use\x20strict"`）按规范**不是** Use Strict
 * Directive ⇒ 有 raw 原文时要求无 `\`。参数按 `unknown` 收：`Node` 联合类型
 * 没有公共 `directives` 属性，由本函数内窄化。
 */
export function hasUseStrictDirective(node: unknown): boolean {
  const dirs = (node as DirectiveHost | null | undefined)?.directives;
  if (!Array.isArray(dirs)) return false;
  return dirs.some((d) => {
    const lit = d?.value;
    if (!lit || lit.value !== "use strict") return false;
    const raw = lit.extra?.raw;
    return typeof raw !== "string" || !raw.includes("\\");
  });
}

/**
 * 源级严格性（原生 **strict mode code** 判据）：
 * ESM 源（静态 import/export / `import.meta`）**或** Program 指令序言含
 * `"use strict"`。二者在原生 JS 里都使整个源 strict——CJS 风格脚本首部的
 * `"use strict"` 同样让块级函数声明失去 Annex B 函数作用域提升（块外引用
 * ⇒ ReferenceError），引擎不得按「无 ESM 语法 = sloppy」一刀切。
 *
 * `file` 可传入已解析 AST（调用方已有则省一次 parse；parseSource 自带 LRU，
 * 重复调用同样便宜）。解析失败 ⇒ 只看 ESM 文本面（无可观测的指令序言）。
 * 函数体**自身**的指令序言同理经 `hasUseStrictDirective(body)` 判定——
 * sloppy 文件内的 `function f() { "use strict"; … }` 是严格函数体。
 */
export function sourceIsStrict(source: string, file?: File | null): boolean {
  if (sourceHasEsmSyntax(source)) return true;
  if (file) return hasUseStrictDirective(file.program);
  // 指令字面量只可能是 `"use strict"` / `'use strict'` 原文（任何转义序列都
  // 使字符串**不是** Use Strict Directive）⇒ 文本面粗筛不改变结论，只是让
  // 常见「无指令」源免掉一次 parse。注释里的同形文本会进 parse 面被 AST 否掉。
  if (!/"use strict"|'use strict'/.test(source)) return false;
  try {
    return hasUseStrictDirective(parseSource(source).program);
  } catch {
    return false;
  }
}

/** 标识符/导出名插入 RegExp 前转义（`$` `.` `Class.method` 等） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * JS 标识符边界 lookaround：名字转义后两侧包 `(?<![\w$])` / `(?![\w$])`。
 * `$` 是标识符字符，`\b` 的"词"只含 `[A-Za-z0-9_]`——二者错位，
 * 拿 `\b` 当标识符边界会漏 `foo$`、误命中 `$fn$` 的 `$fn`。
 */
export function identBoundaryRegex(name: string): string {
  return `(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`;
}
