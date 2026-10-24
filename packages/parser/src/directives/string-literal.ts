// ---------------------------------------------------------------------------
// 字符串字面量文法单源（case 实参 / 期望值 / @nudo:skip / @nudo:mock 载荷共用）
//
// 旧实现只按「首尾字符是引号」切片（`s.slice(1, -1)`），带来两类**自信的错值**：
// - **转义不解释**：`"a\tb"` 折成 4 字符的 `a\tb`（含字面反斜杠）——与侧车
//   契约（真实 JS 求值）落在**不同的字符串**上 ⇒ 见证 ⊭ contract 假红（Bug 840）。
// - **非字面量被切片**：`"a" + "b"` 折成 `a" + "b`——一个谁也没写过的字符串，
//   期望值 / 见证 / skip 返回类型 / mock 值全被静默改写（Bug 849 / 850 / 851）。
//
// 本模块按**词法边界**判定（引号感知 + 转义感知的闭合引号扫描），
// 且整段文本必须**就是**一个字面量（其后无残留文本）。转义按 JS 语义解释
// （Babel 的 StringLiteral cooked 值）——与真实 JS 求值同口径。
//
// 消费面：
// - `case-arg.ts` 的字符串分支（case 实参 / 期望值 / skip / mock 载荷的文法入口）。
// - `fn-directives.ts` / `mock-expr.ts`（P4）可直接 import 本模块复用同一判定，
//   避免三处各写一遍切片逻辑。
// ---------------------------------------------------------------------------

import { parse as babelParse } from "../parse.ts";

/** 「不是单个字符串字面量」的原因（诊断文案与分支判定共用） */
export type StringLiteralRejectReason =
  /** 文本压根不是引号开头（不是字符串候选） */
  | "not-quoted"
  /** 有开引号、没有闭合引号（截断的字面量） */
  | "unterminated"
  /** 闭合引号之后还有文本 ⇒ 是表达式，不是单个字面量（`"a" + "b"`） */
  | "trailing-text"
  /** 整段是单个字面量形态，但转义非法 / 解析不出来 */
  | "not-parseable";

/** 字符串字面量扫描结果 */
export type StringLiteralScan =
  | { kind: "literal"; value: string }
  | { kind: "not-literal"; reason: StringLiteralRejectReason };

/**
 * 词法边界扫描：找**未转义**的闭合引号下标；没有则返回 -1。
 *
 * 转义感知是刻意的：`\"` 是字面量内容里的一个引号，不是闭合引号。
 * （与 `expr-scan.ts` 的 `splitTopLevelArgs` 旧口径相反——那边按「`\` 不是
 * 转义」找串尾，见 P5 协调点。）
 */
function findClosingQuote(s: string, quote: string): number {
  for (let i = 1; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\") {
      i += 1; // 跳过被转义的字符（闭合引号可能就在它后面）
      continue;
    }
    if (c === quote) return i;
  }
  return -1;
}

/**
 * 文本 → 单个字符串字面量的值。
 *
 * - `literal` ⇒ 整段文本**就是**一个 JS 字符串字面量，`value` 是转义已解释的
 *   真实字符串值（`"a\tb"` → `a<TAB>b`）。
 * - `not-literal` ⇒ 不是单个字面量（调用方不得折出自信的错值 ⇒ 落 unknown）。
 */
export function scanStringLiteral(text: string): StringLiteralScan {
  const s = text.trim();
  const quote = s[0];
  if (quote !== '"' && quote !== "'") {
    return { kind: "not-literal", reason: "not-quoted" };
  }
  const close = findClosingQuote(s, quote);
  if (close === -1) return { kind: "not-literal", reason: "unterminated" };
  // 闭合引号之后还有文本 ⇒ 这是表达式（`"a" + "b"`），不是单个字面量
  if (close !== s.length - 1) return { kind: "not-literal", reason: "trailing-text" };
  // 单个字面量：借 Babel 取 cooked 值（转义按 JS 语义解好）
  try {
    const ast = babelParse(`(${s});`);
    const stmt = ast.program.body[0];
    if (!stmt || stmt.type !== "ExpressionStatement") {
      return { kind: "not-literal", reason: "not-parseable" };
    }
    const expr = stmt.expression;
    if (expr.type !== "StringLiteral") {
      return { kind: "not-literal", reason: "not-parseable" };
    }
    return { kind: "literal", value: expr.value };
  } catch {
    return { kind: "not-literal", reason: "not-parseable" };
  }
}

/**
 * 「不是单个字符串字面量」的统一诊断文案（case / skip / mock 三个面共用，
 * 避免三处各写一遍措辞）。
 */
export function stringLiteralRejectMessage(
  text: string,
  reason: StringLiteralRejectReason,
): string {
  const detail =
    reason === "trailing-text"
      ? "trailing text after the closing quote (not a single literal)"
      : reason === "unterminated"
        ? "unterminated string literal"
        : reason === "not-parseable"
          ? "not a parsable string literal (invalid escape?)"
          : "not a quoted string";
  return `Not a single string literal: ${text.trim().slice(0, 60)} (${detail})`;
}
