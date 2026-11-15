/**
 * BUG-083：目标侧 `gt` / `lt` 的**常量抵消**丢掉内层 IEEE 舍入
 *
 * 目标侧严格比较走 `normCmp` 的「`a − b op 0`」归一，常量被**精确抵消**
 * ⇒ `fl(x+1) − 1` 被当成 `x` ⇒ 内层的 `fl` 吸收被抹掉
 * ⇒ `x > 0 ⊨ x + 1 > 1`（反例 x = 2^-53：`fl(x+1) === 1`）⇒ 假事实
 * ⇒ 比较折成字面量 `true` ⇒ 签名面造假 + L1 契约门禁假绿 + 死臂消除。
 *
 * 同命题的 `>=` 变体走 `proveCmpDirect` 的**直接比较**（不抵消常量），
 * 本来就健全 ⇒ 必须仍成立（本文件同时钉住这一对口径）。
 *
 * 修法：线性形携带源表达式「原子 ⊕ 常量」的舍入次数与常量量级
 * （`Lin.rounds` / `Lin.addConstMag`），目标侧端点按
 * `rounds × ½ulp(量级)` 外扩——只放宽不出错。
 */
import { describe, it, expect } from "vitest";
import { implies, and, gt, ge, lt, le } from "../pred.ts";
import { lit, v, app } from "../term.ts";

const x = v("x");
const plus = (t: ReturnType<typeof v>, k: number) => app("+", [t, lit(k)]);
const minus = (t: ReturnType<typeof v>, k: number) => app("-", [t, lit(k)]);

describe("BUG-083：goal 侧 gt/lt 不得按实数环抵消常量", () => {
  it("宿主 IEEE 见证：2^-53 + 1 被吸收成 1", () => {
    expect(2 ** -53 + 1).toBe(1);
  });

  it("x > 0 ⊬ x + 1 > 1（反例 x = 2^-53）", () => {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(1)))).toBe(false);
  });

  it("x > 0 ⊨ x + 1 >= 1（同命题的 ge 变体：IEEE 恒真，直接比较路径）", () => {
    expect(implies(gt(x, lit(0)), ge(plus(x, 1), lit(1)))).toBe(true);
  });

  it("x < 0 ⊬ x - 1 < -1（反例 x = -2^-53）", () => {
    expect(-(2 ** -53) - 1).toBe(-1);
    expect(implies(lt(x, lit(0)), lt(minus(x, 1), lit(-1)))).toBe(false);
  });

  it("x < 0 ⊨ x - 1 <= -1（le 变体健全）", () => {
    expect(implies(lt(x, lit(0)), le(minus(x, 1), lit(-1)))).toBe(true);
  });

  it("死臂消除级联：x > 0 时 `x + 1 <= 1` 仍可能真 ⇒ 不得证伪", () => {
    // 反例 x = 2^-53：x > 0 真、fl(x+1) = 1 ⇒ x + 1 <= 1 真
    expect(2 ** -53 > 0 && 2 ** -53 + 1 <= 1).toBe(true);
    expect(implies(gt(x, lit(0)), lt(plus(x, 1), lit(1)))).toBe(false);
    expect(implies(gt(x, lit(0)), le(plus(x, 1), lit(0)))).toBe(false);
  });
});

describe("BUG-083：不抵消常量的真事实仍可证（精度不回退）", () => {
  it("x > 0 ⊨ x + 1 > 0（常量未被抵消，端点保留 1 ULP 余量）", () => {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(0)))).toBe(true);
  });

  it("x > 1 ⊨ x + 1 > 1", () => {
    expect(implies(gt(x, lit(1)), gt(plus(x, 1), lit(1)))).toBe(true);
  });

  it("x > 1 ⊨ x * 3 > 3（乘法严格端点在拐点处仍越过真值）", () => {
    // fl(3 * nextUp(1)) = 3.0000000000000004 > 3（与 x+1 的吸收不同）
    expect(3 * (1 + 2 ** -52)).toBeGreaterThan(3);
    expect(implies(gt(x, lit(1)), gt(app("*", [x, lit(3)]), lit(3)))).toBe(true);
  });

  it("x ≥ 5 ∧ y ≤ 2 ⊨ x − y ≥ 3", () => {
    expect(implies(and(ge(x, lit(5)), le(v("y"), lit(2))), ge(app("-", [x, v("y")]), lit(3)))).toBe(true);
  });
});
