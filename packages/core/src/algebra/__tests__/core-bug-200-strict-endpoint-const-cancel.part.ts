/**
 * BUG-200：线性区间层把 `+` 当实数环运算 + 比较归一**精确抵消常量**
 *
 * 与 BUG-083 同源（目标侧常量抵消），本条补的是**适用面**：
 * - 多常量形态（`x+2` / `x+0.5` / 量级吸收 `x+1e6`）；
 * - **同语义两种写法结论互斥**：`x+y` 与 `y+x` 在 JS 里是同一个值
 *   （浮点加法可交换），旧实现因 `linInterval` 按 Map 插入序累加端点，
 *   一个判 false、一个判 true ⇒ 门禁结论不可复现；
 * - 产物面：`nudo check` 渲染 `=> true`、`nudo export --format dts` 产出
 *   `: true`（消费端误拒合法输入）。
 *
 * 修法：`linOf` 记录舍入次数/加性常量量级，`linInterval` 端点按
 * `rounds × ½ulp(量级)` 外扩，并按 atom key **稳定排序**累加（消除书写序）。
 */
import { describe, it, expect } from "vitest";
import { implies, and, gt, ge, lt, le } from "../pred.ts";
import { lit, v, app } from "../term.ts";

const x = v("x");
const y = v("y");
const plus = (t: ReturnType<typeof v>, k: number) => app("+", [t, lit(k)]);

describe("BUG-200：strict 目标侧常量抵消不得证成", () => {
  it("宿主 IEEE 见证：x = MIN_VALUE 时 x > 0 真而 x + 1 > 1 假", () => {
    expect(Number.MIN_VALUE > 0).toBe(true);
    expect(Number.MIN_VALUE + 1 > 1).toBe(false);
  });

  it("x > 0 ⊬ x + 1 > 1", () => {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(1)))).toBe(false);
  });

  it("x > 0 ⊬ x + 2 > 2", () => {
    expect(implies(gt(x, lit(0)), gt(plus(x, 2), lit(2)))).toBe(false);
  });

  it("x > 0 ⊬ x + 0.5 > 0.5", () => {
    expect(implies(gt(x, lit(0)), gt(plus(x, 0.5), lit(0.5)))).toBe(false);
  });

  it("x ≥ 0 ⊬ x + 1 > 1（非 strict 下界同样不足）", () => {
    expect(implies(ge(x, lit(0)), gt(plus(x, 1), lit(1)))).toBe(false);
  });

  it("x > 0 ⊨ x + 1 >= 1（IEEE 恒真，section 明确要求仍成立）", () => {
    expect(implies(gt(x, lit(0)), ge(plus(x, 1), lit(1)))).toBe(true);
  });

  it("x > 0 ⊬ x + 1 > 2（既非可证也不该被常量抵消造出来）", () => {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(2)))).toBe(false);
  });

  it("量级吸收：x > 1e-12 ⊬ x + 1e6 > 1e6（fl(1e-12 + 1e6) === 1e6）", () => {
    expect(1e-12 + 1e6).toBe(1e6);
    expect(implies(gt(x, lit(1e-12)), gt(plus(x, 1e6), lit(1e6)))).toBe(false);
  });

  it("x > 1 ⊬ x + 1 > 2（nextUp(1) + 1 ties-to-even 回 2）", () => {
    expect((1 + 2 ** -52) + 1).toBe(2);
    expect(implies(gt(x, lit(1)), gt(plus(x, 1), lit(2)))).toBe(false);
  });
});

describe("BUG-200：同一加法换操作数顺序必须同结论", () => {
  it("x > 0 ∧ y >= 1：x + y > 1 与 y + x > 1 都不可证", () => {
    const phi = and(gt(x, lit(0)), ge(y, lit(1)));
    expect(implies(phi, gt(app("+", [x, y]), lit(1)))).toBe(false);
    expect(implies(phi, gt(app("+", [y, x]), lit(1)))).toBe(false);
  });

  it("x > 0 ∧ y >= 1：x + y >= 1 与 y + x >= 1 都成立（对称性双向钉）", () => {
    const phi = and(gt(x, lit(0)), ge(y, lit(1)));
    expect(implies(phi, ge(app("+", [x, y]), lit(1)))).toBe(true);
    expect(implies(phi, ge(app("+", [y, x]), lit(1)))).toBe(true);
  });
});

describe("BUG-200：无常量抵消的真事实不回退", () => {
  it("x > 1 ∧ y > 1 ⊨ x + y > 2（拐点处和精确可表示）", () => {
    expect((1 + 2 ** -52) + (1 + 2 ** -52)).toBeGreaterThan(2);
    expect(implies(and(gt(x, lit(1)), gt(y, lit(1))), gt(app("+", [x, y]), lit(2)))).toBe(true);
  });

  it("x > 0 ∧ y > 0 ⊨ x + y > 0", () => {
    expect(implies(and(gt(x, lit(0)), gt(y, lit(0))), gt(app("+", [x, y]), lit(0)))).toBe(true);
  });

  it("x ≥ 1 ∧ y ≥ 1 ⊨ x + y ≥ 2（非严格线性判定不变）", () => {
    expect(implies(and(ge(x, lit(1)), ge(y, lit(1))), ge(app("+", [x, y]), lit(2)))).toBe(true);
  });

  it("x > 2 ⊨ 2 * x > 4（2 的幂缩放精确）", () => {
    expect(implies(gt(x, lit(2)), gt(app("*", [lit(2), x]), lit(4)))).toBe(true);
  });
});
