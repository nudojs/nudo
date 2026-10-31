/**
 * BUG-207 回归：**嵌套**值级谓词（`shape({ n: number().gt(0) })`）必须与
 * 顶层写法（`number().gt(0)`）**同结论、同可读性**。
 *
 * 改前：顶层谓词才走值级判定与渲染 ⇒ 同一谓词放槽里既不执法（`[FAIL]`）
 * 也不显示（报告只印 `{ n: number }`），报告看上去 expected/actual 一致却判红。
 */
import { describe, it, expect } from "vitest";
import { parseCaseArgExpr } from "@nudojs/parser";
import {
  caseExpectedSatisfied,
  formatExpected,
} from "../analyzer-orchestrate-uncached-cases.ts";

const nestedExpected = () => parseCaseArgExpr("shape({ n: number().gt(0) })");
const topExpected = () => parseCaseArgExpr("number().gt(0)");

describe("BUG-207 — 嵌套槽谓词执法 + 渲染", () => {
  it("槽谓词满足 ⇒ 判 ok（与顶层写法一致）", () => {
    expect(caseExpectedSatisfied(parseCaseArgExpr("{ n: 3 }"), nestedExpected())).toBe(true);
    expect(caseExpectedSatisfied(parseCaseArgExpr("3"), topExpected())).toBe(true);
  });

  it("槽谓词不满足 ⇒ 判不满足（与顶层写法一致）", () => {
    expect(caseExpectedSatisfied(parseCaseArgExpr("{ n: -1 }"), nestedExpected())).toBe(false);
    expect(caseExpectedSatisfied(parseCaseArgExpr("-1"), topExpected())).toBe(false);
  });

  it("期望文本递归渲染槽谓词（不再是 `{ n: number }`）", () => {
    const text = formatExpected(nestedExpected());
    expect(text).toContain("n: number");
    expect(text).toContain("> 0");
  });

  it("无槽谓词时渲染逐字不变（不引入噪音）", () => {
    expect(formatExpected(parseCaseArgExpr("shape({ n: number() })"))).toBe("{ n: number }");
  });
});
