/**
 * Bug 387 回归：`implies` 缺「**等式 ⇒ 序关系 / 对称**」规则。
 *
 * 根因（实测）：`packages/core/src/algebra/pred.ts` 的 `implies` 只有序关系之间
 * 的传递/代数恒等式与 `predEquals` 逐原子比对，**没有**这条规则：
 * `x === y` ⇒ `x <= y` ∧ `x >= y`（`===` 排除 NaN ⇒ 等值必然不小于也不大于），
 * `x === x` ⇒ `x <= x`（x 非 NaN）。⇒ `a === b` 前提**消解不掉** `a <= b`
 * 的分支可达性 ⇒ 恒假分支被算成可达 ⇒ 签名多出一个可能值。
 *
 * 症状（产品面）：`nudo check` 的签名 `f(a: any, b: any) => 1 | 2 | 3`
 * （应为 `1 | 3`）——`if (a === b) { if (a <= b) return 1; return 2; }` 的
 * `return 2` 是死分支。
 *
 * 口径：等式事实与目标**同一对项**（无序匹配——`x === y` 同时给出
 * `x <= y` 与 `y <= x`）。**不含** `lt` / `gt`：等值不蕴含严格序
 * （`x === y` 时 `x < y` 为假——这条由「蕴含否定」侧折叠成 false）。
 */
import { describe, it, expect } from "vitest";
import { eq, ge, gt, le, lt, implies } from "../pred.ts";
import { v } from "../term.ts";
import { abs } from "../abs.ts";
import { cmp } from "../arithmetic/cmp.ts";
import { formatAbs } from "../format.ts";
import { sigOf, issuesOf } from "./nudo-constraints.ts";

const x = v("x");
const y = v("y");
const z = v("z");

/** 签名里的可能值集合（排序后比较——join 顺序不稳定） */
function sigValues(display: string): string[] {
  return display
    .split("  #")[0]!
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}

describe("Bug 387：eq ⇒ 序关系 / 对称（implies 读侧）", () => {
  it("eq(x,y) ⇒ le(x,y) ∧ ge(x,y)", () => {
    expect(implies(eq(x, y), le(x, y))).toBe(true);
    expect(implies(eq(x, y), ge(x, y))).toBe(true);
  });

  it("eq(x,y) ⇒ eq(y,x)（对称）", () => {
    expect(implies(eq(x, y), eq(y, x))).toBe(true);
  });

  it("eq(x,x) ⇒ le(x,x) ∧ ge(x,x)（重言式：x === x ⇒ x 非 NaN）", () => {
    expect(implies(eq(x, x), le(x, x))).toBe(true);
    expect(implies(eq(x, x), ge(x, x))).toBe(true);
  });

  it("反向不成立：eq(x,y) ⇏ lt(x,y) ∧ gt(x,y)（等值不含严格序）", () => {
    expect(implies(eq(x, y), lt(x, y))).toBe(false);
    expect(implies(eq(x, y), gt(x, y))).toBe(false);
  });

  it("无关项不成立：eq(x,x) ⇏ le(x,y)", () => {
    expect(implies(eq(x, x), le(x, y))).toBe(false);
    expect(implies(eq(x, y), le(x, z))).toBe(false);
  });

  it("比较折叠：a === b 前提下 `a <= b` 折 true、`a < b` 折 false", () => {
    const a = abs({ k: "any" }, x, undefined, "exact");
    const b = abs({ k: "any" }, y, undefined, "exact");
    expect(formatAbs(cmp("le", a, b, eq(x, y)))).toMatch(/^true\b/);
    expect(formatAbs(cmp("ge", a, b, eq(x, y)))).toMatch(/^true\b/);
    // a === b ⇒ ¬(a < b)
    expect(formatAbs(cmp("lt", a, b, eq(x, y)))).toMatch(/^false\b/);
  });

  it("产品面：a === b 分支内的 `a <= b` 恒真 ⇒ 死分支被剪（签名 1 | 3，不是 1 | 2 | 3）", () => {
    const r = issuesOf(
      `
export function f(a, b) {
  if (a === b) {
    if (a <= b) return 1;
    return 2;
  }
  return 3;
}
`,
      "/t/bug-387.js",
    );
    expect(sigValues(sigOf(r, "f"))).toEqual(["1", "3"]);
  });

  it("产品面控制组：`a === b` 两次 ⇒ 同样 1 | 3（改前已绿）", () => {
    const r = issuesOf(
      `
export function control(a, b) {
  if (a === b) {
    if (a === b) return 1;
    return 2;
  }
  return 3;
}
`,
      "/t/bug-387.js",
    );
    expect(sigValues(sigOf(r, "control"))).toEqual(["1", "3"]);
  });
});
