/**
 * BUG-106：代数把 IEEE 加法当**结合律 / 分配律**（系数表相同 ⇒ 值相同）
 *
 * `proveCmpDirect` 曾用 `linFormsEqual`（只比系数表）判「两侧同值」：
 * `x*6` 与 `x+x+x+x+x+x` 都是 `{x:6}`，`(x+y)+z` 与 `x+(y+z)` 系数全同。
 * 但 IEEE 下 `x*6` 是**一次**舍入、六项折叠是**五次**舍入：
 * `fl(0.1*6) = 0.6000000000000001 ≠ fl(0.1+…+0.1) = 0.6`；加法不结合：
 * `(1+1)+1/3 = 2.3333333333333335 > 1+(1+1/3) = 2.333333333333333`。
 *
 * ⇒ `if (x*6 <= x+x+x+x+x+x) return 1; throw` 的抛臂被当死臂消除
 * ⇒ L2 `nudo:entry-may-throw` **假绿**；`check` 面与 `test` 面给出互斥结论。
 *
 * 修法：`linFormsEqual` 只在两形都是**精确**构造（`Lin.rounds === 0`）时成立；
 * 有限证据（assumeFinite / 自动导出）下按仓库既有环语义口径放行。
 */
import { describe, it, expect } from "vitest";
import { implies, and, gt, ge, le, eq, assumeFinite } from "../pred.ts";
import { lit, v, app } from "../term.ts";

const x = v("x");
const a = v("a");
const b = v("b");
const c = v("c");
const add = (p: ReturnType<typeof v>, q: ReturnType<typeof v>) => app("+", [p, q]);
const mul = (p: ReturnType<typeof v>, k: number) => app("*", [p, lit(k)]);
/** x + x + … + x（n 项左结合折叠） */
const fold = (p: ReturnType<typeof v>, n: number) => {
  let t = p;
  for (let i = 1; i < n; i++) t = add(t, p);
  return t;
};

describe("BUG-106：系数表相同 ≠ 值相同（乘法 vs 折叠）", () => {
  it("宿主 IEEE 见证：[0.1]*6 ≠ 0.1+0.1+0.1+0.1+0.1+0.1", () => {
    expect(0.1 * 6).toBe(0.6000000000000001);
    expect(0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1).toBe(0.6);
    expect(0.1 * 6 <= 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1).toBe(false);
  });

  it("x >= 0 ⊬ x * 6 <= x+x+x+x+x+x（抛臂可达）", () => {
    expect(implies(ge(x, lit(0)), le(mul(x, 6), fold(x, 6)))).toBe(false);
  });

  it("x >= 0 ⊬ x * 6 >= x+x+x+x+x+x（对称方向同样不得证出）", () => {
    expect(implies(ge(x, lit(0)), ge(mul(x, 6), fold(x, 6)))).toBe(false);
  });

  it("x >= 0 ⊬ x * 6 === x+x+x+x+x+x", () => {
    expect(implies(ge(x, lit(0)), eq(mul(x, 6), fold(x, 6)))).toBe(false);
  });
});

describe("BUG-106：结合律形态（check 面 / test 面互斥的根源）", () => {
  it("宿主 IEEE 见证：(1+1)+1/3 > 1+(1+1/3)", () => {
    expect((1 + 1) + 1 / 3).toBeGreaterThan(1 + (1 + 1 / 3));
  });

  it("a,b,c > 0 ⊬ (a+b)+c <= a+(b+c)", () => {
    const phi = and(gt(a, lit(0)), gt(b, lit(0)), gt(c, lit(0)));
    expect(implies(phi, le(add(add(a, b), c), add(a, add(b, c))))).toBe(false);
  });

  it("a,b,c > 0 ⊬ (a+b)+c >= a+(b+c)（反向亦然）", () => {
    const phi = and(gt(a, lit(0)), gt(b, lit(0)), gt(c, lit(0)));
    expect(implies(phi, ge(add(add(a, b), c), add(a, add(b, c))))).toBe(false);
  });
});

describe("BUG-106：精确构造的同形判定不回退", () => {
  it("2 * x 与 x + x 都是精确加倍 ⇒ x > 0 ⊨ 2x <= x+x", () => {
    expect(2 * (1 + 2 ** -52)).toBe((1 + 2 ** -52) + (1 + 2 ** -52));
    expect(implies(gt(x, lit(0)), le(mul(x, 2), add(x, x)))).toBe(true);
  });

  it("x > 1 ∧ assumeFinite(x) 下 2 * x 与 x + x 仍同形", () => {
    const phi = and(gt(x, lit(1)), assumeFinite(x));
    expect(implies(phi, le(mul(x, 2), add(x, x)))).toBe(true);
  });
});
