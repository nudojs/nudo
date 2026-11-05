/**
 * BUG-854 回归：case 见证 / 期望值的**表达式形态**（括号 / 一元 / 模板字面量 /
 * bigint / 进制内分隔符）落 unknown —— 而 unknown 是顶类型
 * （`leqAbs(actual, unknown)` 恒 ok）⇒ 断言**空洞通过**（期望侧）与
 * 见证满足任何契约（见证侧）= 假绿。
 *
 * 修法：按 JS 字面量语义解析这些形态（括号 / 一元 ± / 无插值模板 / bigint）。
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

function valueOf(expr: string): unknown {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k !== "prim") return undefined;
  const v = litValue(abs);
  return v.ok ? v.value : undefined;
}

function extractWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  return { fns, diags };
}

describe("BUG-854: 表达式形态的字面量（括号 / 一元 / 模板 / bigint）必须被解析", () => {
  it("括号包裹与一元符号", () => {
    expect(valueOf("(7)")).toBe(7);
    expect(valueOf("( 7 )")).toBe(7);
    expect(valueOf("((7))")).toBe(7);
    expect(valueOf("(-7)")).toBe(-7);
    expect(valueOf("-(7)")).toBe(-7);
    expect(valueOf("-(7)")).toBe(-7);
    expect(valueOf("+7")).toBe(7);
  });

  it("bigint 字面量（7n）保留 bigint 类型与值", () => {
    const abs = parseCaseArgExpr("7n");
    expect(abs.shape.k).toBe("prim");
    expect((abs.shape as { type: string }).type).toBe("bigint");
    expect(valueOf("7n")).toBe(7n);
  });

  it("无插值模板字面量 ⇒ 字符串字面量", () => {
    expect(valueOf("`x`")).toBe("x");
    expect(valueOf("`hello`")).toBe("hello");
    // 有插值 ⇒ 不是字面量 ⇒ 不认识
    expect(parseCaseArgExpr("`x${1}`").shape.k).toBe("unknown");
  });

  it("进制内的数字分隔符", () => {
    expect(valueOf("0b1_0")).toBe(2);
    expect(valueOf("0o1_7")).toBe(15);
    expect(valueOf("0x1_F")).toBe(31);
  });

  it("case 见证 / 期望值不再落 unknown（空洞通过的根因）", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "paren" ((7))
 * @nudo:case "unary" (- 7)
 * @nudo:case "tpl" (\`x\`)
 * @nudo:case "exp-paren" (1) => (7)
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(4);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 7 });
    expect(litValue(cases[1]!.argsAbs[0]!)).toEqual({ ok: true, value: -7 });
    expect(litValue(cases[2]!.argsAbs[0]!)).toEqual({ ok: true, value: "x" });
    expect(litValue(cases[3]!.expected!)).toEqual({ ok: true, value: 7 });
    // 合法形态不再发「不认识这个表达式」诊断
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });

  it("非字面量的表达式仍不认识（不折错值）", () => {
    expect(parseCaseArgExpr("1 + 2").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("a ? b : c").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("(1)(2)").shape.k).toBe("unknown");
  });
});
