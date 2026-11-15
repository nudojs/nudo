/**
 * BUG-077：谓词代数把 IEEE **舍入**运算当可逆恒等式做「精确消去」
 *
 * 事实侧 `applyCmp` 的单原子分支曾把 `fl(atom ⊕ k) op c` 直接反解成点
 * `atom === c-k`。IEEE 下 `fl` **非单射**——`fl(x + 1) === 1` 的解含
 * `x = -5e-324`（`Number.MIN_VALUE`），`fl(x + 1e6) === 1e6` 的解含
 * `|x| ≤ ½ulp(1e6)`，`fl(3*x) === 1` 的解含 `0.33333333333333337`。
 *
 * 点反解 ⇒ 假事实 ⇒ 签名面造出字面量 `true` + L1 契约门禁**假绿**：
 * `if (x + 1 !== 1) throw; return x >= 0;` 对 `lit(true)` 契约曾报 OK / exit 0
 * （原生 `x = MIN_VALUE` 时返回 `false`）。
 *
 * 修法（section 方案 B）：解集按**舍入前像区间**提取——
 * `atom ∈ [c-k-½ulp(量级), c-k+½ulp(量级)]`，量级 = max(|比较常量|, 加性常量)。
 * 精确构造（rounds === 0：纯 var/lit、2 的幂缩放）仍是点反解。
 */
import { describe, it, expect } from "vitest";
import { implies, and, eq, ge, le, gt } from "../pred.ts";
import { lit, v, app } from "../term.ts";

const x = v("x");
const plus = (t: ReturnType<typeof v>, k: number) => app("+", [t, lit(k)]);
const minus = (t: ReturnType<typeof v>, k: number) => app("-", [t, lit(k)]);
const times = (t: ReturnType<typeof v>, k: number) => app("*", [t, lit(k)]);

describe("BUG-077：等式反解必须给出舍入前像，而不是点", () => {
  it("宿主 IEEE 见证：fl(MIN_VALUE + 1) === 1 但 x ≠ 0", () => {
    expect(1 + Number.MIN_VALUE).toBe(1);
    expect(Number.MIN_VALUE).not.toBe(0);
  });

  it("x + 1 === 1 ⊬ x === 0（吸收型加法；反例 x = MIN_VALUE）", () => {
    expect(implies(eq(plus(x, 1), lit(1)), eq(x, lit(0)))).toBe(false);
  });

  it("x + 1 === 1 ⊬ x >= 0（同一前像区间不得收成单点）", () => {
    expect(implies(eq(plus(x, 1), lit(1)), ge(x, lit(0)))).toBe(false);
  });

  it("x - 1 === -1 ⊬ x === 0（减法同源；反例 x = -5e-324）", () => {
    expect(-Number.MIN_VALUE - 1).toBe(-1);
    expect(implies(eq(minus(x, 1), lit(-1)), eq(x, lit(0)))).toBe(false);
  });

  it("x + 1e6 === 1e6 ⊬ x === 0（量级吸收：解集 |x| ≤ ½ulp(1e6)）", () => {
    expect(2.9e-11 + 1e6).toBe(1e6);
    expect(implies(eq(plus(x, 1e6), lit(1e6)), eq(x, lit(0)))).toBe(false);
  });

  it("3 * x === 1 ⊬ x === 1/3（系数非 2 的幂；反例 0.33333333333333337）", () => {
    expect(3 * 0.33333333333333337).toBe(1);
    expect(0.33333333333333337).not.toBe(1 / 3);
    expect(implies(eq(times(x, 3), lit(1)), eq(x, lit(1 / 3)))).toBe(false);
  });

  it("不等式同源：x + 1 >= 1 ⊬ x >= 0（反例 x = -5e-324）", () => {
    expect(-Number.MIN_VALUE + 1 >= 1).toBe(true);
    expect(implies(ge(plus(x, 1), lit(1)), ge(x, lit(0)))).toBe(false);
  });

  it("乘法不等式：3 * x <= 1 ⊬ x <= 1/3（反例 0.33333333333333337）", () => {
    expect(3 * 0.33333333333333337 <= 1).toBe(true);
    expect(implies(le(times(x, 3), lit(1)), le(x, lit(1 / 3)))).toBe(false);
  });
});

describe("BUG-077：精确构造的反解不受影响（精度不回退）", () => {
  it("2 * x === 4 ⊨ x === 2（2 的幂缩放无舍入）", () => {
    expect(implies(eq(times(x, 2), lit(4)), eq(x, lit(2)))).toBe(true);
  });

  it("x === 5 ⊨ x === 5 / x >= 5（纯原子事实仍是点）", () => {
    expect(implies(eq(x, lit(5)), eq(x, lit(5)))).toBe(true);
    expect(implies(eq(x, lit(5)), ge(x, lit(5)))).toBe(true);
  });

  it("x + 1 === 0 仍可取到 x = -1 的下界（前像不含正区间）", () => {
    // fl(-1 + δ) = 0 只可能在 δ 被吸收到 0 之外；但 fl(x+1)=0 的解集仍以
    // -1 为中心且 |x+1| ≤ ½ulp(0) = 0 ⇒ 单点。这里钉「界仍单调收紧」。
    const ok = implies(eq(plus(x, 1), lit(0)), and(ge(x, lit(-1.0000000000000002)), le(x, lit(-0.9999999999999998))));
    expect(ok).toBe(true);
  });
});
