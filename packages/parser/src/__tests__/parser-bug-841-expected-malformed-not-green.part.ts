/**
 * BUG-841 回归：`@nudo:case` 的**期望值**解析失败与「显式 unknown」共用同一个
 * unknown Abs ⇒ 断言面把「没读懂用户的期望」记成「断言通过」
 * （[ok] / 1 passed / exit 0 = 假绿）。
 *
 * 修法（parser 侧）：期望值的解析失败产出**失败表示**（never），与显式 unknown
 * 在 Abs 层面可区分；断言层据此判 FAIL（fail-closed）。
 * 另提供严格 API `parseCaseExpectedAbs`：失败 ⇒ undefined，供下游按
 * 「unchecked（没被检查）」口径收口。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  type DirectiveDiag,
} from "../directives.ts";
import type { CaseDirective } from "../directives.ts";
import { parseCaseExpectedAbs } from "../directives/case-arg.ts";
import { runWithDirectiveDiags } from "../directives.ts";

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

const EXPECTED_CTX = '@nudo:case "t" => expected';

describe("BUG-841: 期望值解析失败不得空洞通过（断言层必须看到失败）", () => {
  it("directive.expected：解析失败 ⇒ 失败表示；显式 unknown ⇒ unknown", () => {
    const { fns } = extractWithDiags(`/**
 * @nudo:case "malformed" (1) => bogus()
 * @nudo:case "explicit" (1) => unknown
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(2);
    // 解析失败：不是 unknown（顶类型 ⇒ leqAbs 恒 ok ⇒ 空洞通过）
    expect(cases[0]!.expected).toBeDefined();
    expect(cases[0]!.expected!.shape.k).not.toBe("unknown");
    // 显式 unknown：用户主动声明「不约束」，保持 unknown
    expect(cases[1]!.expected!.shape.k).toBe("unknown");
  });

  it("解析失败仍发 nudo:directive-syntax 诊断（不是静默）", () => {
    const { diags } = extractWithDiags(`/**
 * @nudo:case "malformed" (1) => bogus()
 */
function f(x) { return x; }`);
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("=> expected") &&
          d.message.includes("bogus()"),
      ),
    ).toBe(true);
  });

  it("严格 API parseCaseExpectedAbs：失败 ⇒ undefined（可传递的失败表示）", () => {
    const diags: DirectiveDiag[] = [];
    const failed = runWithDirectiveDiags(diags, () =>
      parseCaseExpectedAbs("bogus()", EXPECTED_CTX),
    );
    expect(failed).toBeUndefined();
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");

    // 合法期望值 / 显式 unknown ⇒ 仍是 Abs（不是失败）
    expect(parseCaseExpectedAbs("1e3", EXPECTED_CTX)).toBeDefined();
    expect(parseCaseExpectedAbs("unknown", EXPECTED_CTX)).toBeDefined();
  });
});
