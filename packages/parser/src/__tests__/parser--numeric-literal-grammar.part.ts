/**
 * BUG-839 回归：case 实参 / 期望值的数字文法只认一条十进制正则
 * （/^-?\d+(\.\d+)?$/）⇒ 指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 等
 * **合法** JS 数字写法全部落 unknown —— 而 unknown 是顶类型
 * （`leqAbs(actual, unknown)` 恒 ok）⇒ 见证满足任何契约 = 假绿。
 *
 * 修法：按 **JS 字面量语义** 解析（指数 / 进制 / 分隔符 / 前导点 / 尾点 /
 * 一元 / 括号 / bigint / Infinity / NaN 全部覆盖）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  parseCaseArgExpr,
  type DirectiveDiag,
} from "../directives.ts";
import type { CaseDirective } from "../directives.ts";

function numOf(expr: string): number | undefined {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k !== "prim") return undefined;
  const v = litValue(abs);
  return v.ok && typeof v.value === "number" ? v.value : undefined;
}

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

describe("BUG-839: 合法 JS 数字写法必须被解析（不再落 unknown）", () => {
  it("指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元正号", () => {
    expect(numOf("1e3")).toBe(1000);
    expect(numOf("1e-3")).toBe(0.001);
    expect(numOf("1E3")).toBe(1000);
    expect(numOf("1E-3")).toBe(0.001);
    expect(numOf("1e+3")).toBe(1000);
    expect(numOf("0x10")).toBe(16);
    expect(numOf("0XFF")).toBe(255);
    expect(numOf("0b101")).toBe(5);
    expect(numOf("0o17")).toBe(15);
    expect(numOf("0O17")).toBe(15);
    expect(numOf("1_000")).toBe(1000);
    expect(numOf("1_000.5")).toBe(1000.5);
    expect(numOf(".5")).toBe(0.5);
    expect(numOf("5.")).toBe(5);
    expect(numOf("+1")).toBe(1);
    expect(numOf("- 7")).toBe(-7);
    expect(numOf("-1")).toBe(-1);
  });

  it("Infinity / NaN 是数值常量形态（不再落 unknown）", () => {
    expect(numOf("Infinity")).toBe(Infinity);
    expect(numOf("-Infinity")).toBe(-Infinity);
    const nan = parseCaseArgExpr("NaN");
    expect(nan.shape.k).toBe("prim");
    const v = litValue(nan);
    expect(v.ok && Number.isNaN(v.value as number)).toBe(true);
  });

  it("case 见证值不再是 unknown（假绿根因：见证满足任何契约）", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "exp" (1e3)
 * @nudo:case "hex" (0x10)
 * @nudo:case "sep" (1_000)
 * @nudo:case "lead" (.5)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(4);
    const values = cases.map((c) => litValue(c.argsAbs[0]!));
    expect(values.map((v) => (v.ok ? v.value : "<none>"))).toEqual([
      1000,
      16,
      1000,
      0.5,
    ]);
    // 合法写法不再发「不认识这个表达式」诊断
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("非法写法仍落 unknown（不折出自信的错值）", () => {
    expect(parseCaseArgExpr("0_1").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("1__0").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("0x").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("T.number").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("bogus()").shape.k).toBe("unknown");
  });
});
