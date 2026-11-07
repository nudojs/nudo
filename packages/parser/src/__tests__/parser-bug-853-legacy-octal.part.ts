/**
 * BUG-853 回归：legacy octal（`0` 开头 + 全八进制数字）被 `Number("017")`
 * 按**十进制**读成 17（native sloppy 是 15 = 八进制）⇒ 见证 / 期望值折出
 * **自信的错值**（假红 / 假绿）。
 *
 * 修法：按 JS 字面量语义解析 —— 前导 0 ⇒ 八进制（`017` → 15）；含 8/9 ⇒
 * sloppy 十进制（`08` → 8）；分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识。
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

describe("BUG-853: legacy octal 按八进制取值（不再按十进制读成错值）", () => {
  it("0 开头 + 全八进制数字 ⇒ 八进制", () => {
    expect(numOf("017")).toBe(15);
    expect(numOf("010")).toBe(8);
    expect(numOf("077")).toBe(63);
    expect(numOf("00")).toBe(0);
    expect(numOf("-017")).toBe(-15);
  });

  it("0 开头且含 8/9 ⇒ sloppy 十进制（与 native sloppy 一致）", () => {
    expect(numOf("08")).toBe(8);
    expect(numOf("09")).toBe(9);
    expect(numOf("018")).toBe(18);
  });

  it("现代进制字面量不受影响（0o / 0b / 0x）", () => {
    expect(numOf("0o17")).toBe(15);
    expect(numOf("0b101")).toBe(5);
    expect(numOf("0x10")).toBe(16);
    expect(numOf("0")).toBe(0);
  });

  it("分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识（不折错值）", () => {
    expect(parseCaseArgExpr("0_1").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("01_0").shape.k).toBe("unknown");
  });

  it("case 见证 / 期望值按八进制取值", () => {
    const { fns, diags } = extractWithDiags(`/**
 * @nudo:case "legacy" (017)
 * @nudo:case "legacy-exp" (1) => 017
 */
function f(x) { return x; }`);
    const cases = fns.flatMap(
      (f) => f.directives.filter((d) => d.kind === "case"),
    ) as CaseDirective[];
    expect(cases).toHaveLength(2);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 15 });
    expect(litValue(cases[1]!.expected!)).toEqual({ ok: true, value: 15 });
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
  });
});
