/**
 * LSP 表面 — 补全域。
 *
 * owns：getCompletionsAtPosition（成员补全 = Abs 接收者优先，变量补全 =
 * 绑定面）、内置成员唯一真值来源 builtinProtoMember(Names) 的补全投影
 * （promise / string / array / sum 成员交集）。补全 detail 走外延口径
 * （formatShape / formatAbs）。
 * 不 owns：绑定面求值与复用载荷（replay.ts 的 reuseBinding /
 * SurfaceReuse——直接 import 叶子模块）。
 */
import { formatAbs, formatShape, type Abs, type PrimName } from "@nudojs/core";
import { maskCommentsAndStrings } from "@nudojs/core/internal";
import { extractDirectivesQuiet, parse } from "@nudojs/parser";
import {
  builtinProtoMember,
  builtinProtoMemberNames,
  describeAbsMember,
} from "@nudojs/service/evaluator";
import {
  collectAbsBindingsFromGraph,
  mockDirectivesToAbsSeeds,
  type CompletionItem,
} from "@nudojs/service";
import { reuseBinding, type SurfaceReuse } from "./replay.ts";

/**
 * 补全上下文（片 A 定形状；片 B 在 server-ide.ts 消费）。
 *
 * 两个字段都**可缺省**：缺省时本模块走既有口径（自算词法上下文 +
 * 全局绑定面）⇒ 既有调用方零改动。
 */
export type CompletionContext = {
  /**
   * 光标处的词法上下文（code / comment / string）。
   *
   * 缺省 ⇒ 本模块自算（cursorLexicalContext(source, line - 1, column)；
   * 注意本模块的 `line` 是 1-based，而 cursorLexicalContext 是 0-based）。
   * 非 "code" ⇒ **成员面与变量面都返回 []**：光标不在代码位置时给出任何
   * 候选都是噪声（接受候选即把标识符写进字符串 / 注释里）。
   */
  lexical?: LexicalContext;
  /**
   * 作用域感知的绑定查询（片 B 的绑定下沉产物的挂载点）。
   *
   * 语义：按**光标所在作用域**解析接收者路径的根标识符（`a` / `a.b.c` 的
   * `a`）；返回 undefined ⇒ 该作用域里没有这个名字 ⇒ 成员面为空。
   * 缺省 ⇒ 走 reuseBinding(reuse, name) 的全局绑定面。
   */
  lookupBinding?: (name: string) => Abs | undefined;
};

/** 补全面分支（member = 成员面 / variable = 变量面）。 */
export type CompletionBranch = "member" | "variable";

/**
 * 光标处的补全面分支（片 B 的分支判定依据）。
 *
 * 口径与 getCompletionsAtPosition **同一份触发点文法**（parseReceiver）：
 * - "member"：光标前存在成员访问触发点（`x.` / `x.y` / `x.y.` / 字面量 `.` …）
 * - "variable"：没有触发点 ⇒ 变量面
 *
 * line 是 **1-based 行号**（与 getCompletionsAtPosition 同口径），
 * column 是 0-based 列（UTF-16 code unit）。
 */
export function completionBranchAt(
  source: string,
  line: number,
  column: number,
): CompletionBranch {
  const textBefore = getTextBeforePosition(source, line, column);
  return parseReceiver(textBefore) === null ? "variable" : "member";
}

export function getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  reuse?: SurfaceReuse,
  context?: CompletionContext,
): CompletionItem[] {
  // 词法上下文闸：光标在字符串 / 注释里 ⇒ 不出任何候选。
  // 成员面与变量面**同闸**——两者的候选在非代码位置都是噪声
  // （接受候选即把标识符写进字面量内部，静默改写运行时值）。
  const lexical = context?.lexical ?? cursorLexicalContext(source, line - 1, column);
  if (lexical !== "code") return [];

  const textBefore = getTextBeforePosition(source, line, column);
  const receiver = parseReceiver(textBefore);
  // 没有成员访问触发点 ⇒ 变量补全面（绑定面）。
  if (receiver === null) return getVariableCompletions(filePath, source, reuse);
  // 有触发点 ⇒ 成员面。**认不出接收者时给空**，不回落到顶层变量表
  // （那份表与「成员」意图无关；Bug 782 / 787）。
  return getMemberCompletions(filePath, source, receiver, reuse, context);
}

/**
 * 成员面：按接收者形态投影候选。
 *
 * - 字面量接收者（`42` / `"abc"` / `true` / `[1,2]`）⇒ 直接投影内建原型表，
 *   **不需要绑定面**（也不需要 parse 源码）。
 * - 标识符路径接收者（`a` / `a.b` / `a.b.c`）⇒ 先查根绑定，再沿 Abs 形状
 *   逐段下钻（Bug 772：接收者是**整条路径**，不是最后一段标识符）。
 */
function getMemberCompletions(
  filePath: string,
  source: string,
  receiver: Receiver,
  reuse?: SurfaceReuse,
  context?: CompletionContext,
): CompletionItem[] {
  if (receiver.kind === "unknown") return [];
  if (receiver.kind === "prim") return getPrimCompletions(receiver.prim);
  if (receiver.kind === "array") return getArrayCompletionsAbs(undefined);

  const root = receiver.segments[0]!;
  let bound = lookupRootBinding(filePath, source, root, reuse, context);
  if (!bound) return [];
  // 路径下钻：`a.b.c` ⇒ a → a.b → a.b.c
  for (const seg of receiver.segments.slice(1)) {
    const next = memberAbsOf(bound, seg);
    if (!next) return [];
    bound = next;
  }
  if (bound.shape.k === "unknown" || bound.shape.k === "never") return [];
  return getCompletionsForAbs(bound);
}

/**
 * 接收者根标识符的绑定查询。
 *
 * 优先级：调用方注入的作用域感知查询（片 B 的绑定下沉）→ 同源复用载荷的
 * 全局绑定面（reuse.result.bindings）→ 模块图绑定面（无复用载荷时）。
 */
function lookupRootBinding(
  filePath: string,
  source: string,
  root: string,
  reuse?: SurfaceReuse,
  context?: CompletionContext,
): Abs | undefined {
  if (context?.lookupBinding) return context.lookupBinding(root);
  if (reuse?.result) return reuseBinding(reuse, root);
  // 无复用载荷：模块图绑定面（编辑中间态的尾随点经消毒后才可解析，Bug 698）。
  try {
    // 成员补全的接收者解析用「尾点消毒」源码（与原 source 内容不同）；
    // reuse.ast 只对原文成立，这里保持独立 parse（parseSource 自带 LRU）
    const ast = parseForBindings(source);
    const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
    const binds = collectAbsBindingsFromGraph(sanitizeSourceForParsing(source), filePath, {
      seedVars: seeds.seedVars,
      seedFns: seeds.seedFns as never,
    });
    return binds.get(root);
  } catch {
    return undefined;
  }
}

/** 绑定解析用的 AST：消毒文本优先（编辑中间态），原文兜底；都失败则抛。 */
function parseForBindings(source: string): ReturnType<typeof parse> {
  try {
    return parse(sanitizeSourceForParsing(source));
  } catch {
    return parse(source);
  }
}

/**
 * Abs 形状下钻：取成员槽位的 Abs（`a.b` ⇒ a 的 `b` 槽）。
 *
 * sum 形态：逐臂求交——**所有臂都有该成员**才有接收者（否则接收者可能
 * 是 undefined）；多臂命中时合成 sum（下游按交集口径投影）。
 */
function memberAbsOf(base: Abs, key: string): Abs | undefined {
  const s = base.shape;
  switch (s.k) {
    case "obj":
      return s.slots[key]?.value;
    case "brand":
      return memberAbsOf(s.shape, key);
    case "fn":
      return s.slots?.[key]?.value;
    case "sum": {
      const hits: Abs[] = [];
      for (const m of s.members) {
        const hit = memberAbsOf(m, key);
        if (!hit) return undefined;
        hits.push(hit);
      }
      if (hits.length === 0) return undefined;
      if (hits.length === 1) return hits[0];
      return { shape: { k: "sum", members: hits }, conf: "path" };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// 接收者解析（Bug 772 / 782 / 787）
// ---------------------------------------------------------------------------

/**
 * 接收者形态（光标前的文本 → 成员访问的接收者）。
 *
 * - path：标识符路径（`a` / `a.b` / `a.b.c` / `对象` / `a.对象`）
 * - prim：字面量接收者（`42` / `"abc"` / `true`）——直接投影内建原型表
 * - array：数组字面量接收者（`[1, 2]`）
 * - unknown：有成员访问触发点，但接收者**认不出** ⇒ 成员面给空
 */
type Receiver =
  | { kind: "path"; segments: string[] }
  | { kind: "prim"; prim: PrimName }
  | { kind: "array" }
  | { kind: "unknown" };

/** 标识符起始字符（JS IdentifierStart + `$`）。 */
function isIdentStart(ch: string): boolean {
  return ch === "$" || ch === "_" || /\p{ID_Start}/u.test(ch);
}

/** 标识符续接字符（JS IdentifierPart + `$`）。 */
function isIdentPart(ch: string): boolean {
  return ch === "$" || ch === "_" || /\p{ID_Continue}/u.test(ch);
}

/** 合法标识符（Unicode 感知：CJK / `$` / `_` 都认）。 */
function isValidIdentifier(s: string): boolean {
  if (s === "") return false;
  if (!isIdentStart(s[0]!)) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isIdentPart(s[i]!)) return false;
  }
  return true;
}

/** 数字字面量（十进制 / 指数 / 数值分隔符；不含小数点判定）。 */
function isNumericLiteral(s: string): boolean {
  return /^[+-]?\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?$/.test(s);
}

/**
 * 末尾的「匹配开括号」下标（从右往左配对）；找不到 ⇒ -1。
 */
function matchingOpen(cur: string, open: string, close: string): number {
  let depth = 0;
  for (let i = cur.length - 1; i >= 0; i--) {
    const c = cur[i]!;
    if (c === close) depth++;
    else if (c === open) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 闭合的字符串字面量的**起始引号**下标；未闭合 ⇒ -1。
 */
function stringLiteralStart(cur: string): number {
  const quote = cur[cur.length - 1]!;
  for (let i = cur.length - 2; i >= 0; i--) {
    if (cur[i] === "\\") {
      i--;
      continue;
    }
    if (cur[i] === quote) return i;
  }
  return -1;
}

/**
 * 标识符路径回扫（`a.b.c` → ["a","b","c"]）。
 *
 * 从文本末尾往回吃标识符段；每吃一段，若前面是 `.` 则继续往回吃
 * （⇒ 整条成员访问链都在路径里）。任一段不是合法标识符 ⇒ null
 * （数字等不是标识符路径）。
 */
function scanIdentifierPath(cur: string): string[] | null {
  const segments: string[] = [];
  let rest = cur;
  for (;;) {
    let end = rest.length;
    while (end > 0 && isIdentPart(rest[end - 1]!)) end--;
    const seg = rest.slice(end);
    if (!isValidIdentifier(seg)) return null;
    segments.unshift(seg);
    rest = rest.slice(0, end).replace(/\s+$/u, "");
    if (!rest.endsWith(".")) break;
    rest = rest.slice(0, -1).replace(/\s+$/u, "");
    if (rest === "") break;
  }
  return segments;
}

/** 文本末尾的数字字面量（`return 42` → "42"）；不是数字结尾 ⇒ null。 */
function scanNumberTail(cur: string): string | null {
  const m = /(?:^|[^\w.$])([+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)$/.exec(
    cur,
  );
  return m ? m[1]! : null;
}

/**
 * 关键字接收者（`true` / `false` / `null` / `NaN` …）——它们不是绑定面里的
 * 名字，必须在标识符路径**之前**判定。
 */
const KEYWORD_RECEIVERS: Record<string, Receiver> = {
  true: { kind: "prim", prim: "boolean" },
  false: { kind: "prim", prim: "boolean" },
  NaN: { kind: "prim", prim: "number" },
  Infinity: { kind: "prim", prim: "number" },
  // null / undefined 上取属性必抛 ⇒ 没有成员面
  null: { kind: "unknown" },
  undefined: { kind: "unknown" },
};

/**
 * 表达式前缀的关键字（`return (42)` / `await [1]` 里的 `return` / `await`
 * 是**代码前缀**；`foo(42)` 里的 `foo` 是被调者 ⇒ 那是调用表达式）。
 */
const EXPRESSION_PREFIX_KEYWORDS = new Set([
  "return",
  "await",
  "typeof",
  "void",
  "delete",
  "new",
  "yield",
  "in",
  "of",
  "instanceof",
  "case",
  "do",
  "else",
  "throw",
  "default",
]);

/**
 * 括号 / 方括号**之前**的文本是不是「代码前缀」（而非表达式的一部分）。
 *
 * - 空 ⇒ 是（整个接收者就是括号表达式）
 * - 末尾不是标识符字符（运算符 / `=` / `,` …）⇒ 是
 * - 末尾是标识符 ⇒ 只有**关键字**才是（`return (42)` vs `foo(42)`）
 */
function isCodePrefix(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (trimmed === "") return true;
  const last = trimmed[trimmed.length - 1]!;
  if (!isIdentPart(last)) return true;
  const word = /([\p{ID_Start}$_][\p{ID_Continue}$_]*)$/u.exec(trimmed)?.[1] ?? "";
  return EXPRESSION_PREFIX_KEYWORDS.has(word);
}

/**
 * 点号之前的文本 → 接收者形态。
 *
 * 口径：只看**紧邻点号的表达式**（前面的 `return ` / `x = ` 等是代码前缀，
 * 不属于接收者）。
 */
function classifyReceiver(head: string): Receiver {
  const cur = head.replace(/\s+$/u, "");
  if (cur === "") return { kind: "unknown" };
  const last = cur[cur.length - 1]!;

  // ① 括号表达式 / 调用表达式
  if (last === ")") {
    const open = matchingOpen(cur, "(", ")");
    if (open === -1) return { kind: "unknown" };
    // 括号前面是**被调者**（`foo(…)`）⇒ 调用表达式：静态解析不出接收者
    if (!isCodePrefix(cur.slice(0, open))) return { kind: "unknown" };
    return classifyReceiver(cur.slice(open + 1, cur.length - 1));
  }

  // ② 数组字面量 / 下标表达式
  if (last === "]") {
    const open = matchingOpen(cur, "[", "]");
    if (open === -1) return { kind: "unknown" };
    if (!isCodePrefix(cur.slice(0, open))) return { kind: "unknown" };
    return { kind: "array" };
  }

  // ③ 字符串字面量（**闭合**的）：`"abc".` / `'abc'.` / `` `abc`. ``
  if (last === '"' || last === "'" || last === "`") {
    if (stringLiteralStart(cur) === -1) return { kind: "unknown" };
    return { kind: "prim", prim: "string" };
  }

  // ④ 标识符 / 关键字 / 数字字面量
  if (isIdentPart(last)) {
    const segments = scanIdentifierPath(cur);
    if (segments) {
      if (segments.length === 1) {
        const keyword = KEYWORD_RECEIVERS[segments[0]!];
        if (keyword) return keyword;
      }
      return { kind: "path", segments };
    }
    const num = scanNumberTail(cur);
    if (num !== null) return { kind: "prim", prim: "number" };
    return { kind: "unknown" };
  }
  if (/\d/.test(last)) {
    const num = scanNumberTail(cur);
    if (num !== null) return { kind: "prim", prim: "number" };
  }
  return { kind: "unknown" };
}

/**
 * 光标前的文本 → 成员访问的接收者。
 *
 * 口径（Bug 772 / 782 / 787）：
 * - 返回 null ⇒ **没有成员访问触发点** ⇒ 调用方走变量补全面；
 * - 返回 Receiver ⇒ 有触发点（`kind: "unknown"` = 触发点在、但接收者认不出
 *   ⇒ 成员面给空，**不回落到顶层变量表**——那份表与用户意图（成员）无关）。
 *
 * 触发点文法 = 末尾的「`.` + 已敲出的成员名前缀」；接收者按**整条路径**
 * 解析（`a.b.c` ⇒ 接收者是 `a.b`，不是最后一段 `b`）。
 */
function parseReceiver(textBefore: string): Receiver | null {
  const text = textBefore.replace(/\s+$/u, "");
  if (text === "") return null;

  // 触发点：末尾的 `.` + 已敲出的成员名前缀（可为空）。
  const trigger = /\.([\p{ID_Continue}$_]*)$/u.exec(text);
  if (!trigger) return null;
  const dotIdx = trigger.index;
  const typedMember = trigger[1] ?? "";
  const head = text.slice(0, dotIdx).trimEnd();

  // 小数点不是成员访问（`1.5` / `42.0`）；`42.`（尾随点）才是。
  if (typedMember !== "" && isNumericLiteral(head)) return { kind: "unknown" };

  return classifyReceiver(head);
}

/**
 * 解析用消毒：把「尾随点号」改写成合法成员访问（`x.` → `x._ `）。
 *
 * 编辑中间态（用户刚敲下 `.`）buffer 文本必然语法非法，而 parse 不容错 ⇒
 * 分析/绑定解析直接抛。分析输入与绑定解析输入**共用**本消毒器
 * （Bug 698）。注意：消毒会改变文本长度，故消毒结果**不得**当原文进缓存。
 *
 * 标识符捕获组是 **Unicode 感知**的（JS IdentifierStart/Continue + `$`；
 * 纯数字段沿用旧口径）：ASCII-only 的 `\w+` 认不出非 ASCII 接收者
 * （`对象.`）⇒ 尾随点不被消毒 ⇒ 原文语法非法 ⇒ 整个文件的分析/绑定解析抛
 * ⇒ 成员补全清零（Bug 782）。
 */
export function sanitizeSourceForParsing(source: string): string {
  return source.replace(
    /([\p{ID_Start}$_][\p{ID_Continue}$_]*|\d[\d_]*)\.\s*$/gmu,
    "$1._ ",
  );
}

/** 光标所在的词法上下文。 */
export type LexicalContext = "code" | "comment" | "string";

/**
 * 光标的词法上下文（code / comment / string）。
 *
 * 判定基于 core 的 `maskCommentsAndStrings`：它把**注释与字符串整段**掩成
 * 等长空格（行号/列对齐），代码区原样保留 ⇒ 掩码里的「空白段」= 注释段 ∪ 字符串段。
 * 段类型看**原文**：注释段必以 `//` 或 `/*` 起，字符串段以引号/反引号起；
 * 跨行块注释逐行回溯到段首那一行再判。
 *
 * 用途（Bug 708）：指令补全**只在光标确实落在注释里**时才出——
 * `x * `（乘号）、字符串字面量里的 `@nudo:` 都不是注释。
 */
export function cursorLexicalContext(
  source: string,
  line: number,
  character: number,
): LexicalContext {
  const masked = maskCommentsAndStrings(source);
  const lineStarts = lineStartOffsets(source);
  const offset = offsetOfPosition(source, lineStarts, line, character);
  if (offset <= 0) return "code";
  const ctx = offset - 1;
  // 掩码里非空白 ⇒ 代码区（注释/字符串被整段掩成空格）
  if (masked[ctx] !== " ") return "code";

  // 定位光标所在的空白段（行内；换行不是空白段的一部分）
  let segStart = ctx;
  while (segStart > 0 && masked[segStart - 1] === " ") segStart--;
  let segEnd = ctx + 1;
  while (segEnd < masked.length && masked[segEnd] === " ") segEnd++;

  const lineEnd = (l: number): number =>
    l + 1 < lineStarts.length ? lineStarts[l + 1]! - 1 : source.length;

  let curLine = line;
  let curSegStart = segStart;
  let curSegEnd = segEnd;
  for (let guard = 0; guard < 10_000; guard++) {
    const text = source.slice(curSegStart, curSegEnd).trimStart();
    if (text.startsWith("//") || text.startsWith("/*")) return "comment";
    if (
      text.startsWith('"') ||
      text.startsWith("'") ||
      text.startsWith("`") ||
      text.startsWith("}")
    ) {
      return "string";
    }
    // 空白段（代码里的空白 / 段已结束）⇒ 不是注释
    if (text === "") return "code";
    // 跨行块注释：只有「本段一直延伸到行尾」才可能续到上一行
    if (curSegEnd !== lineEnd(curLine)) return "code";
    if (curLine === 0) return "code";
    curLine -= 1;
    const prevStart = lineStarts[curLine]!;
    const prevEnd = lineEnd(curLine);
    let p = prevEnd - 1;
    while (p >= prevStart && masked[p] === " ") p--;
    curSegStart = p + 1;
    curSegEnd = prevEnd;
  }
  return "code";
}

/** 每行起始偏移（UTF-16 code unit）——第 i 项是第 i 行的行首。 */
function lineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** LSP 位置（0 基行 / UTF-16 列）→ 源码绝对偏移（UTF-16 code unit）。 */
function offsetOfPosition(
  source: string,
  lineStarts: number[],
  line: number,
  character: number,
): number {
  if (line < 0 || line >= lineStarts.length) return source.length;
  const start = lineStarts[line]!;
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : source.length;
  return start + Math.min(Math.max(character, 0), end - start);
}

function getTextBeforePosition(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return "";
  return lines[line - 1].slice(0, column);
}

function getVariableCompletions(
  filePath: string,
  source: string,
  reuse?: SurfaceReuse,
): CompletionItem[] {
  if (reuse?.result) {
    // 同源绑定面（analyzeFile bindings）：不再 parse + 整文件求值
    const completions: CompletionItem[] = [];
    for (const [name, info] of reuse.result.bindings) {
      if (name.startsWith("__export_")) continue;
      completions.push({
        label: name,
        // 顶层 fn 绑定 = **函数**（不是某对象的成员）⇒ "function" 档
        // （"method" 只留给成员函数）——Bug 717。
        kind: info.abs.shape.k === "fn" ? "function" : "variable",
        detail: absDetail(info.abs),
      });
    }
    if (completions.length > 0) return completions;
    return [];
  }
  // 解析输入同样走消毒文本：编辑中间态（尾随 `x.`）原文语法非法 ⇒
  // 裸 parse 直接抛 ⇒ 变量补全整面清零（Bug 698）。
  let ast;
  try {
    ast = parse(sanitizeSourceForParsing(source));
  } catch {
    ast = parse(source);
  }

  // Abs 模块图绑定优先（无损；detail 经外延桥保持既有文案）
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
    const binds = collectAbsBindingsFromGraph(sanitizeSourceForParsing(source), filePath, {
      seedVars: seeds.seedVars,
      seedFns: seeds.seedFns as never,
    });
    if (binds.size > 0) {
      const completions: CompletionItem[] = [];
      for (const [name, absVal] of binds) {
        if (name.startsWith("__export_")) continue;
        completions.push({
          label: name,
          kind: absVal.shape.k === "fn" ? "function" : "variable",
          detail: absDetail(absVal),
        });
      }
      if (completions.length > 0) return completions;
    }
  } catch {
    /* fall through */
  }

  // TypeValue evaluateProgram 已删除：无 Abs 绑定时返回空
  return [];
}

/**
 * 内置成员签名：直接读 BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS（唯一真值）。
 */
function builtinMemberAbs(className: string, member: string): Abs | null {
  return builtinProtoMember(className, member);
}

/**
 * 内置成员补全的唯一真值来源：求值器原型近似表。
 */
function builtinProtoMembers(className: string): string[] {
  return builtinProtoMemberNames(className);
}

/**
 * 成员 detail 的展示形态：内置方法优先取 Abs 签名
 * （formatAbs 渲染为 `(a: string) => boolean` 形式）；无签名
 * （未建模）时退回 `成员名(…)@<类>` 概要。
 */
function describeMember(label: string, a: Abs | null, fallbackClass: string): string {
  if (a) {
    const s = describeAbsMember(a);
    if (s) return s;
  }
  return `${label}(…)@${fallbackClass}`;
}

/**
 * 内置类的成员补全（唯一真值 = 求值器原型近似表）。
 */
function getBuiltinCompletions(className: string): CompletionItem[] {
  return builtinProtoMembers(className).map((m) => ({
    label: m,
    kind: "method" as const,
    detail: describeMember(m, builtinMemberAbs(className, m), className),
  }));
}

function getPromiseCompletions(): CompletionItem[] {
  return getBuiltinCompletions("Promise");
}

function getStringCompletions(): CompletionItem[] {
  const completions: CompletionItem[] = getBuiltinCompletions("String");
  completions.push({ label: "length", kind: "property", detail: "number" });
  return completions;
}

/**
 * prim 类型 → 内置原型类（Bug 788：旧口径只投影 String，number / boolean /
 * bigint / symbol 一律零候选，而求值器的原型近似表里这些类的成员**齐备**）。
 */
const PRIM_BUILTIN_CLASS: Record<PrimName, string> = {
  number: "Number",
  string: "String",
  boolean: "Boolean",
  bigint: "BigInt",
  symbol: "Symbol",
};

/** prim 接收者的成员补全（按类型分派到内建原型表）。 */
function getPrimCompletions(prim: PrimName): CompletionItem[] {
  if (prim === "string") return getStringCompletions();
  const className = PRIM_BUILTIN_CLASS[prim];
  if (!className) return [];
  // BigInt 等类在原型近似表里没有条目 ⇒ 零候选（表无数据 ⇒ 不臆造）。
  return getBuiltinCompletions(className);
}

// ---------------------------------------------------------------------------
// Abs 接收者补全
// ---------------------------------------------------------------------------

/** Abs → 补全 detail（外延口径："1" / "number"） */
function absDetail(a: Abs): string {
  try {
    return formatShape(a);
  } catch {
    return formatAbs(a);
  }
}

function absIsFn(a: Abs): boolean {
  return a.shape.k === "fn";
}

/**
 * 该形态的成员面是否**可判定**（sum 交集口径，Bug 771）。
 *
 * false = 「补全信息不可得」：unknown（分析失败）/ any（无约束）/ never
 * （不可能发生）——这三者不提供任何成员约束，交集计算时**跳过**。
 * true = 成员面可判定：成员集为空 ⇒ 该臂**确实没有属性** ⇒ 交集必空。
 */
function memberSurfaceKnown(k: Abs["shape"]["k"]): boolean {
  return k !== "unknown" && k !== "any" && k !== "never";
}

/** Abs 接收者的成员补全；空数组表示该形态无可派生成员（调用方可回退） */
function getCompletionsForAbs(a: Abs): CompletionItem[] {
  const s = a.shape;
  switch (s.k) {
    case "obj": {
      const completions: CompletionItem[] = [];
      for (const [key, slot] of Object.entries(s.slots)) {
        completions.push({
          label: key,
          kind: absIsFn(slot.value) ? "method" : "property",
          detail: absDetail(slot.value),
        });
      }
      return completions;
    }
    case "brand":
      // 品牌名命中内建类（Date / Map / Set / Symbol …）⇒ 投影该类的成员表；
      // 否则沿品牌内层形状下钻（Bug 788）。
      if (builtinProtoMembers(s.name).length > 0) return getBuiltinCompletions(s.name);
      return getCompletionsForAbs(s.shape);
    case "sum":
      return getSumCompletions(s.members);
    case "tuple":
      // Abs 定长元组（含 path conf——map 同长/filter 子集和的臂成员）：length
      // 就是字面量长度。旧口径只放 exact 元组、path 元组回退 TypeValue 求宽
      // array——filter 的不确定谓词臂已是精确子序列和（长度集合诚实），
      // 不再需要按「假精确」熔断。
      return getArrayCompletionsAbs(s.elements.length);
    case "arr":
      return getArrayCompletionsAbs(undefined);
    case "eff":
      if (s.eff === "promise") return getPromiseCompletions();
      return [];
    case "prim":
      return getPrimCompletions(s.type);
    default:
      // fn / never / unknown / any：无属性面
      return [];
  }
}

function getArrayCompletionsAbs(tupleLen?: number): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("Array")) {
    const detail = describeMember(m, builtinMemberAbs("Array", m), "Array");
    completions.push({ label: m, kind: "method", detail });
  }
  completions.push({
    label: "length",
    kind: "property",
    detail: tupleLen !== undefined ? `${tupleLen}` : "number",
  });
  return completions;
}

/**
 * sum 接收者：各成员补全取交集（与 getUnionCompletions 同口径），
 * detail 为各成员该键类型字符串的并集渲染。
 *
 * 交集口径（Bug 771）：**「该臂成员集为空」不等于「该臂无信息」**——
 * 原始值臂（number / boolean …）**没有任何属性** ⇒ 交集必空（取 `u.x`
 * 在原始值臂上是 TypeError）；只有**补全信息不可得**的臂
 * （unknown / any / never——分析失败或不可能发生）才可跳过。
 */
function getSumCompletions(members: Abs[]): CompletionItem[] {
  if (members.length === 0) return [];
  // 可判定的臂（其余臂不提供任何成员约束，跳过不改变交集）
  const arms = members
    .map((m) => ({ abs: m, labels: getCompletionsForAbs(m) }))
    .filter((arm) => memberSurfaceKnown(arm.abs.shape.k));
  if (arms.length === 0) return [];
  const base = arms.find((arm) => arm.labels.length > 0);
  // 所有可判定的臂都没有成员 ⇒ 交集为空
  if (!base) return [];

  const common: CompletionItem[] = [];
  for (const item of base.labels) {
    let allPresent = true;
    const memberTypes: string[] = [item.detail ?? item.label];
    for (const arm of arms) {
      if (arm === base) continue;
      if (arm.labels.length === 0) {
        // 该臂**确实没有成员**（原始值 / 无属性对象）⇒ 交集必空
        allPresent = false;
        break;
      }
      const hit = arm.labels.find((l) => l.label === item.label);
      if (!hit) {
        allPresent = false;
        break;
      }
      memberTypes.push(hit.detail ?? hit.label);
    }
    if (allPresent) {
      // 臂渲染去重：`[] | [1] | ["a"]` 的 length 臂 0|1|1|2 → 0|1|2
      common.push({ ...item, detail: [...new Set(memberTypes)].join(" | ") });
    }
  }
  return common;
}
