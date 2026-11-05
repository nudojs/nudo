/**
 * BUG-837 回归：`parseAbsExprDiag` 把**解析失败**折成**显式 unknown Abs**
 * ⇒ `leqAbs(actual, unknown)` 恒 ok（unknown 是顶类型）⇒ 断言**空洞通过**
 * （报「1 passed」、exit 0 = 假绿）。
 *
 * 修法：解析失败与「显式 unknown」在 Abs 层面**可区分** —— 失败用失败表示
 * （never，底类型：没有任何实际值满足它 ⇒ 断言判 FAIL），显式 unknown 仍是
 * 顶类型（用户主动声明，不约束）。
 */
import { describe, it, expect } from "vitest";
import { runWithDirectiveDiags, type DirectiveDiag } from "../directives.ts";
import { parseAbsExprDiag } from "../directives/case-arg.ts";

function withDiags<T>(fn: () => T): { value: T; diags: DirectiveDiag[] } {
  const diags: DirectiveDiag[] = [];
  const value = runWithDirectiveDiags(diags, fn);
  return { value, diags };
}

const EXPECTED_CTX = '@nudo:case "t" => expected';

describe("BUG-837: 解析失败 ≠ 显式 unknown（失败必须传到断言层）", () => {
  it("解析失败 ⇒ 失败表示（never），不是 unknown（顶类型）", () => {
    const { value } = withDiags(() => parseAbsExprDiag("bogus()", EXPECTED_CTX));
    expect(value.shape.k).toBe("never");
    expect(value.shape.k).not.toBe("unknown");
  });

  it("显式 unknown / any / any() 仍是 unknown（用户主动声明，不约束）", () => {
    for (const expr of ["unknown", "any", "any()"]) {
      const { value, diags } = withDiags(() => parseAbsExprDiag(expr, EXPECTED_CTX));
      expect(value.shape.k, expr).toBe("unknown");
      expect(diags, expr).toHaveLength(0);
    }
  });

  it("解析失败发 nudo:directive-syntax 诊断（文案带 tag 位置）", () => {
    const { diags } = withDiags(() => parseAbsExprDiag("bogus()", EXPECTED_CTX));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain(EXPECTED_CTX);
    expect(diags[0]!.message).toContain("bogus()");
  });

  it("非断言面上下文（@nudo:as / @nudo:replace / @nudo:skip）保持 unknown", () => {
    // 这些上下文的 Abs 会进类型覆盖面 / 求值面：never 会污染那里的语义
    for (const ctx of ["@nudo:as", "@nudo:replace", "@nudo:skip =>"]) {
      const { value } = withDiags(() => parseAbsExprDiag("bogus()", ctx));
      expect(value.shape.k, ctx).toBe("unknown");
    }
  });
});
