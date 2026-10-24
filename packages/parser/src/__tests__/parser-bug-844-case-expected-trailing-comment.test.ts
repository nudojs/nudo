/**
 * Bug 844 —— `@nudo:case` 的**期望值**里带**尾注释**（`=> string() // 注释`）
 * ⇒ 期望值解析失败 ⇒ 回退成**显式 unknown** ⇒ **断言被静默作废**（报「1 passed」、
 * exit 0 的**假绿**）。
 *
 * 根因：`=> expected` 表达式没有尾注释归一化——注释被并进表达式 ⇒
 * `parseAbsExprDiag` 解析失败。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag } from "../directives.ts";

function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function caseExpected(src: string): string | undefined {
  const fns = extractDirectives(parse(src), { diags: [] });
  for (const fn of fns) {
    for (const d of fn.directives) {
      if (d.kind === "case") return d.expected === undefined ? undefined : formatShape(d.expected);
    }
  }
  return undefined;
}

const WITH_COMMENT = `/**
 * @nudo:case "x" (1) => string() // 期望值是字符串
 */
export function f(a) {
  return a + 1;
}
`;

const WITHOUT_COMMENT = `/**
 * @nudo:case "x" (1) => string()
 */
export function f(a) {
  return a + 1;
}
`;

describe("Bug 844: a trailing comment must not void the @nudo:case expectation", () => {
  it("the expected type is parsed (not degraded to unknown)", () => {
    expect(caseExpected(WITH_COMMENT)).toBe("string");
  });

  it("the commented form equals the plain form", () => {
    expect(caseExpected(WITH_COMMENT)).toBe(caseExpected(WITHOUT_COMMENT));
  });

  it("no nudo:directive-syntax warning is emitted", () => {
    expect(fnDiags(WITH_COMMENT)).toEqual([]);
  });

  it("a `//` inside a string literal stays part of the expression", () => {
    const src = `/**
 * @nudo:case "x" (1) => shape({ url: string() })
 */
export function f(a) {
  return a;
}
`;
    expect(fnDiags(src)).toEqual([]);
    expect(caseExpected(src)).toContain("url");
  });
});

describe("Bug 844 (same family): the @nudo:skip return type must not be voided by a trailing comment", () => {
  function skipReturns(src: string): string | undefined {
    const fns = extractDirectives(parse(src), { diags: [] });
    for (const fn of fns) {
      for (const d of fn.directives) {
        if (d.kind === "skip" && d.returns !== null) {
          return d.returns === undefined ? undefined : formatShape(d.returns);
        }
      }
    }
    return undefined;
  }

  it("`@nudo:skip => number() // 注释` keeps the declared return type", () => {
    const src = `/**
 * @nudo:skip => number() // 期望返回数字
 */
export function f(a) {
  return a + 1;
}
`;
    expect(skipReturns(src)).toBe("number");
  });

  it("the commented form equals the plain form", () => {
    const plain = `/**
 * @nudo:skip => number()
 */
export function f(a) {
  return a + 1;
}
`;
    expect(skipReturns(plain)).toBe("number");
  });

  it("no nudo:directive-syntax warning is emitted", () => {
    const src = `/**
 * @nudo:skip => number() // 期望返回数字
 */
export function f(a) {
  return a + 1;
}
`;
    expect(fnDiags(src)).toEqual([]);
  });
});
