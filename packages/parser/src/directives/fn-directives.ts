import type { Comment, File, Node } from "@babel/types";
import {
  type Abs,
  extractBalancedParens,
  listFnDirectiveScopes,
  scanCaseArgSpans,
  scanCaseTags,
} from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { parseAbsExprDiag } from "./case-arg.ts";
import {
  emitDirectiveDiag,
  runWithDirectiveDiags,
  type ExtractDirectivesOpts,
} from "./diag.ts";
import { parseArrowFunctionExpr, splitTopLevelArgs } from "./expr-scan.ts";
import { parseNudoMockExpr, parseSinonExpr } from "./mock-expr.ts";
import type { Directive, FunctionWithDirectives } from "./types.ts";

// 指令标签只在「注释行首」匹配（可选 `*` / `//` 已由 comment.value 剥掉）：
// 不得命中 case 参数字符串或文档散文里的 `@nudo:skip` / `@nudo:case` / `@nudo:mock` 字样。
// `\b` 防 `@nudo:skipped` / `@nudo:cases` 误命中。
/** 宽松捕获 @nudo:case 标签后的整行文本，用于检测非法名形态（含空标签）。
 * S4-004：`\s+` 跨行会把下一行粘进本标签（诊断错误归因/吞下一个标签），
 * 改同行分隔 `[ \t]`；`[^\n]*` 让空标签也可见。前缀镜像 core
 * directive-scan 的 CASE_NAME_REGEX（块 `*` 续行 / `///` 残留单 `/`）。 */
const CASE_TAG_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:case\b[ \t]*([^\n]*)/g;
/** JS 标识符（Unicode 感知）：mock 名文法 */
const JS_IDENT_RE = /^[\p{L}$_][\p{L}\p{N}$_]*$/u;
const MOCK_INLINE_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:mock\b[ \t]+([^\s=]+)[ \t]*=[ \t]*(.+)/g;
/** from 路径单/双引号皆可（`'./x.js'` 此前静默不识别）——`m[2] ?? m[3]` 取路径 */
const MOCK_FROM_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:mock\b[ \t]+([^\s]+)[ \t]+from[ \t]+(?:"([^"\n]+)"|'([^'\n]+)')/g;
/** 宽松捕获 @nudo:mock 标签后的整行文本（含空标签），用于检测非法名形态 */
const MOCK_TAG_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:mock\b[ \t]*([^\n]*)/g;
const PURE_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:pure\b/g;
const SKIP_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:skip\b(?:[ \t]+(\S[^\n]*))?/g;
/** 宽松捕获 @nudo:sample 后的整段 token（数字文法在下方校验，不再静默截断） */
const SAMPLE_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:sample\b(?:[ \t]+(\S+))?/g;
/** 完整数字 token：整数 / 小数 / 负数 / 科学计数；禁止 `3.5` 截成 `3` */
const SAMPLE_NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * `@nudo:skip` 返回类型显式文法（D1=A1 产品文法变更）：
 *   `@nudo:skip`              → returns = null（不声明）
 *   `@nudo:skip => <expr>`    → 显式类型（箭头前缀）
 *   `@nudo:skip (<expr>)`     → 显式类型（括号包裹，整段包完才算）
 *   `@nudo:skip <散文>`       → returns = null（散文不得当类型表达式）
 */
function parseSkipReturnsExpr(rest: string | undefined): Abs | undefined {
  if (rest === undefined) return undefined;
  const s = rest.trim();
  if (s === "") return undefined;

  // `=> <expr>` 显式类型
  if (s.startsWith("=>")) {
    const expr = s.slice(2).trim();
    if (expr === "") {
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `@nudo:skip => requires a type expression (e.g. @nudo:skip => number())`,
      });
      return undefined;
    }
    return parseAbsExprDiag(expr, "@nudo:skip =>");
  }

  // `(<expr>)` 显式类型：外层括号必须包完整段
  if (s.startsWith("(")) {
    const inner = extractBalancedParens(s, 0);
    if (inner !== null && s.slice(inner.length + 2).trim() === "") {
      return parseAbsExprDiag(inner, "@nudo:skip (...)");
    }
    if (inner === null) {
      // S4-003 同族：`@nudo:skip (number()` 括号未闭合不再静默落回散文分支
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `@nudo:skip type expression has unclosed parenthesis (expected @nudo:skip (<typeExpr>)) — got: ${s.slice(0, 60)}`,
      });
      return undefined;
    }
    // 括号后有残留：不按显式类型处理，落到散文分支
  }

  // 散文：不解析为类型，returns = null
  return undefined;
}

function parseDirectivesFromComments(comments: readonly Comment[]): Directive[] {
  return parseDirectivesFromCommentTexts(
    comments.map((c) => ({
      text: c.value,
      startLine: c.loc?.start.line ?? 0,
    })),
  );
}

/**
 * 从注释块文本抽函数级指令（case/mock/pure/skip/sample）。
 * D6=G2：文本来自 core directive-scan 的 scope 绑定，与 contract 同一函数集合。
 */
function parseDirectivesFromCommentTexts(
  comments: Array<{ text: string; startLine: number }>,
): Directive[] {
  const directives: Directive[] = [];
  for (const { text, startLine: commentStartLine } of comments) {

    // D5=F1：case 标签文法（平衡括号 / 多行实参 / => expected / 实参遮罩）在
    // core directive-scan 单源。多行实参里的 `@nudo:*` 字样是数据不是指令——
    // PURE/SKIP/MOCK/SAMPLE 扫描前必须按实参区间遮罩。
    const caseArgSpans: [number, number][] = scanCaseArgSpans(text);
    const caseTags = scanCaseTags(text);

    // case 名非法形态（单引号/空/转义/缺实参括号）→ nudo:directive-syntax
    scanMalformedCaseNames(text, caseArgSpans);

    const inCaseArgs = (idx: number): boolean =>
      caseArgSpans.some(([s, e]: [number, number]) => idx >= s && idx < e);

    // mock 名非法形态（非标识符）→ nudo:directive-syntax
    scanMalformedMockNames(text, caseArgSpans);

    MOCK_FROM_REGEX.lastIndex = 0;
    let mockFromMatch: RegExpExecArray | null;
    const mockFromRanges: [number, number][] = [];
    while ((mockFromMatch = MOCK_FROM_REGEX.exec(text)) !== null) {
      if (inCaseArgs(mockFromMatch.index)) continue;
      const name = mockFromMatch[1]!;
      if (!JS_IDENT_RE.test(name)) continue; // 已由 scanMalformedMockNames 报诊断
      directives.push({
        kind: "mock",
        name,
        fromPath: mockFromMatch[2] ?? mockFromMatch[3],
      });
      mockFromRanges.push([mockFromMatch.index, mockFromMatch.index + mockFromMatch[0].length]);
    }

    MOCK_INLINE_REGEX.lastIndex = 0;
    let mockMatch: RegExpExecArray | null;
    while ((mockMatch = MOCK_INLINE_REGEX.exec(text)) !== null) {
      const inFromRange = mockFromRanges.some(
        ([s, e]) => mockMatch!.index >= s && mockMatch!.index < e,
      );
      if (inFromRange || inCaseArgs(mockMatch.index)) continue;

      const mockName = mockMatch[1]!;
      if (!JS_IDENT_RE.test(mockName)) continue; // 已由 scanMalformedMockNames 报诊断

      const expr = mockMatch[2].trim();
      let arrowFn = parseArrowFunctionExpr(expr);
      const sinonExpr = parseSinonExpr(expr);
      const nudoMock = parseNudoMockExpr(expr);

      // callsFake 统一：sinon.stub().callsFake(fn) / stub().callsFake(fn) 都把
      // fn 提升到 arrowFn 字段——与 @nudo:mock f = (x) => ... 走完全同一绑定机制
      // （applyMocks 的 T.fn + _paramPatterns + 全局 env 闭包），调用时以实参求值
      if (!arrowFn) {
        const callsFakeChain = expr.match(/^(?:sinon\.)?stub\(\)\.callsFake\((.+)\)$/);
        if (callsFakeChain) {
          arrowFn = parseArrowFunctionExpr(callsFakeChain[1].trim());
        }
      }

      directives.push({
        kind: "mock",
        name: mockName,
        expression: expr,
        arrowFn: arrowFn ?? undefined,
        sinonExpr: sinonExpr ?? undefined,
        nudoMock: nudoMock ?? undefined,
      });
    }

    for (const tag of caseTags) {
      const name = tag.name;
      // 块注释续行的 ` * ` 前缀不属于实参文本（键名会被污染成 "* supplyChain"）
      const cleaned = tag.argsText
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, ""))
        .join("\n");
      const rawArgs = splitTopLevelArgs(cleaned);
      const argsAbs = rawArgs.map((a) => parseAbsExprDiag(a, `@nudo:case "${name}" argument`));

      const expected =
        tag.expectedText !== undefined
          ? parseAbsExprDiag(tag.expectedText, `@nudo:case "${name}" => expected`)
          : undefined;

      // tagOffset 可能落在行首前缀（`\n * `）上；commentLine 按标签实际位置计行
      const linesBeforeMatch = text.slice(0, tag.tagOffset).split("\n").length - 1;
      const commentLine = commentStartLine + linesBeforeMatch;

      directives.push({
        kind: "case",
        name,
        argsAbs,
        expected,
        commentLine,
      });
    }

    PURE_REGEX.lastIndex = 0;
    let pureMatch: RegExpExecArray | null;
    while ((pureMatch = PURE_REGEX.exec(text)) !== null) {
      if (inCaseArgs(pureMatch.index)) continue;
      directives.push({ kind: "pure" });
      break;
    }

    SKIP_REGEX.lastIndex = 0;
    let skipMatch: RegExpExecArray | null;
    while ((skipMatch = SKIP_REGEX.exec(text)) !== null) {
      if (inCaseArgs(skipMatch.index)) continue;
      // D1=A1：散文不得当类型表达式；类型须 `=>` 或括号显式形式
      const returns = parseSkipReturnsExpr(skipMatch[1]);
      directives.push({
        kind: "skip",
        returns,
      });
    }

    SAMPLE_REGEX.lastIndex = 0;
    let sampleMatch: RegExpExecArray | null;
    while ((sampleMatch = SAMPLE_REGEX.exec(text)) !== null) {
      if (inCaseArgs(sampleMatch.index)) continue;
      const raw = sampleMatch[1];
      // 无数字 / 非完整数字 token：显式 nudo:directive-syntax，不再静默忽略或截断
      if (raw === undefined || !SAMPLE_NUM_RE.test(raw)) {
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `Malformed @nudo:sample: expected a numeric count (integer, decimal, or negative) — got: @nudo:sample ${raw ?? "(missing count)"}`,
        });
        continue;
      }
      directives.push({ kind: "sample", count: Number(raw) });
    }
  }
  return directives;
}

/**
 * 检测非法 case 名形态（F-3 #1-3）：单引号名、空名、名内转义引号、缺实参括号。
 * 合法形态 `@nudo:case "name" (…)` 已由 CASE_NAME_REGEX 吸走；这里扫剩下的标签。
 */
function scanMalformedCaseNames(text: string, caseArgSpans: [number, number][]): void {
  const inCaseArgs = (idx: number): boolean =>
    caseArgSpans.some(([s, e]) => idx >= s && idx < e);
  CASE_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CASE_TAG_REGEX.exec(text)) !== null) {
    if (inCaseArgs(m.index)) continue;
    const rest = m[1]!.trim();
    // 合法形态前缀：非空双引号名 + 同行实参括号（已被 CASE_NAME_REGEX 吸走的不重复报）
    const legal = rest.match(/^("[^"]+")[ \t]*\(/);
    if (legal) {
      // S4-003：合法形态判定必须真的平衡——此前 `"a" (1`（未闭合）既有形似
      // 前缀又不进 caseArgSpans，被静默丢弃且零诊断。跨行未闭合同样在此暴露。
      const parenIdx = m.index + m[0].length - m[1]!.length + legal[0].length - 1;
      if (extractBalancedParens(text, parenIdx) === null) {
        emitDirectiveDiag({
          code: DIAG.directiveSyntax,
          message: `Malformed @nudo:case: unclosed argument list (missing closing ")") — got: @nudo:case ${rest.slice(0, 60)}`,
        });
      }
      continue;
    }
    let reason: string;
    if (rest.startsWith("'")) {
      reason = `single-quoted name (use double quotes: @nudo:case "name" (…))`;
    } else if (rest.startsWith('""')) {
      reason = `empty name (name must be non-empty)`;
    } else if (/^"[^"]*\\/.test(rest)) {
      reason = `escaped quote in name (avoid embedded double quotes)`;
    } else if (rest.startsWith('"')) {
      reason = `malformed name or missing argument list (expected @nudo:case "name" (…))`;
    } else {
      reason = `missing quoted name (expected @nudo:case "name" (…))`;
    }
    emitDirectiveDiag({
      code: DIAG.directiveSyntax,
      message: `Malformed @nudo:case: ${reason} — got: @nudo:case ${rest.slice(0, 60)}`,
    });
  }
}

/**
 * 检测非法 mock 名形态（F-3 #4）：非 JS 标识符。
 * `变量` / `café` 等 Unicode 标识符合法；`foo-bar` / `123abc` 等发诊断。
 */
function scanMalformedMockNames(text: string, caseArgSpans: [number, number][]): void {
  const inCaseArgs = (idx: number): boolean =>
    caseArgSpans.some(([s, e]) => idx >= s && idx < e);
  MOCK_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MOCK_TAG_REGEX.exec(text)) !== null) {
    if (inCaseArgs(m.index)) continue;
    const rest = m[1]!.trim();
    // 提取名部分：到 `=` 或 `from` 之前
    const nameMatch = rest.match(/^([^\s=]+)(?:\s*=|\s+from\b)/);
    if (!nameMatch) {
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `Malformed @nudo:mock: cannot parse name (expected @nudo:mock <ident> = <expr> or @nudo:mock <ident> from "path" / 'path') — got: ${rest.slice(0, 60)}`,
      });
      continue;
    }
    const name = nameMatch[1]!;
    if (!JS_IDENT_RE.test(name)) {
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `Malformed @nudo:mock name '${name}': not a valid identifier (use letters, digits, _, $; Unicode letters allowed)`,
      });
      continue;
    }
    // S4-004 同族：from 路径必须同行闭引号——此前 `"([^"]+)` 跨行把下一行
    // 粘进 fromPath（错误归因）；收紧后引号未闭合不再静默丢弃。
    // 单/双引号独立判闭（`"a'` / `'a"` 都算未闭合）
    const afterName = rest.slice(name.length);
    if (/^[ \t]+from[ \t]+(?:"[^"\n]*|'[^'\n]*)$/.test(afterName)) {
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `Malformed @nudo:mock from: unclosed quote in path (expected @nudo:mock ${name} from "path" / 'path') — got: @nudo:mock ${rest.slice(0, 60)}`,
      });
    }
  }
}

function getFunctionName(node: Node): string {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (node.type === "ExportNamedDeclaration") {
    // export const f = … / export function f …
    return node.declaration ? getFunctionName(node.declaration as Node) : "<anonymous>";
  }
  if (node.type === "ExportDefaultDeclaration" && node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
    return node.declaration.id.name;
  }
  if (node.type === "VariableDeclaration") {
    const decl = node.declarations[0];
    if (decl.id.type === "Identifier") return decl.id.name;
  }
  return "<anonymous>";
}

/**
 * D6=G2：指令绑定 AST 最近 Function（含 nested function、class method）。
 * 作用域清单与 refine 的 @nudo:contract 同源（core directive-scan），
 * case 与 contract 对同一函数集合同时可见。
 */
export function extractDirectives(
  ast: Node,
  opts?: ExtractDirectivesOpts,
): FunctionWithDirectives[] {
  // 不传 diags：不自成去重域——落外层 runWithDirectiveDiags 域（无则丢弃）
  if (!opts?.diags) return collectFnDirectives(ast);
  // 显式通道：runWithDirectiveDiags 换入/还原 sink（仅在本次调用内生效，
  // finally 恢复，异常不泄漏——状态本体住 diag.ts 单一模块）
  return runWithDirectiveDiags(opts.diags, () => collectFnDirectives(ast));
}

function collectFnDirectives(ast: Node): FunctionWithDirectives[] {
  const results: FunctionWithDirectives[] = [];
  if (ast.type !== "File") return results;

  const scopes = listFnDirectiveScopes(ast as File);
  for (const scope of scopes) {
    const directives = parseDirectivesFromCommentTexts(
      scope.commentTexts.map((text, i) => ({
        text,
        startLine: scope.commentStartLines[i] ?? 0,
      })),
    );
    if (directives.length === 0) continue;
    results.push({ node: scope.node, name: scope.name, directives });
  }
  return results;
}

/**
 * 纯查询 extract：诊断丢弃——hover/completion/collectSkipReturns 等探测
 * 路径不产诊断（不污染消费方待收的诊断，也不背走别人的在途诊断）。
 * 需要诊断的调用方用 extractDirectives(ast, { diags })。
 */
export function extractDirectivesQuiet(ast: Node): FunctionWithDirectives[] {
  return extractDirectives(ast, { diags: [] });
}
