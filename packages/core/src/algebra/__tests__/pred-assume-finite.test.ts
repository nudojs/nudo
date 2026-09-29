/**
 * assumeFinite 恢复分配律 / 环消去精度（DEC-007C）。
 *
 * 背景：BUG-001 / DEC-007A 后 linOf / linSub 对环消去 fail-closed，
 * 损失 k*(x+1) 分配律、x-x 消去等精度。assumeFinite 谓词（显式有限证据）
 * 与 typeof=number ∧ 双侧有限界自动导出，在已证有限时恢复环化简。
 * 默认关闭：无有限证据仍 fail-closed，Inf/NaN 不得假证。
 */
import { describe, it, expect } from "vitest";
import {
  implies,
  and,
  eq,
  ne,
  gt,
  ge,
  lt,
  le,
  ptypeof,
  assumeFinite,
  not,
} from "../pred.ts";
import { app, lit as tLit, v } from "../term.ts";

const x = v("x");
const y = v("y");
const inf = tLit(Infinity);
const nan = tLit(NaN);

describe("assumeFinite 开启环消去（显式有限证据）", () => {
  it("x>0 ∧ assumeFinite(x) ⊢ x-x===0", () => {
    const phi = and(gt(x, tLit(0)), assumeFinite(x));
    const subXX = app("-", [x, x]);
    expect(implies(phi, eq(subXX, tLit(0)))).toBe(true);
  });

  it("x>0 ∧ assumeFinite(x) ⊢ 0*x===0 / x*0===0", () => {
    const phi = and(gt(x, tLit(0)), assumeFinite(x));
    expect(implies(phi, eq(app("*", [tLit(0), x]), tLit(0)))).toBe(true);
    expect(implies(phi, eq(app("*", [x, tLit(0)]), tLit(0)))).toBe(true);
  });

  it("x>0 ∧ assumeFinite(x) ⊢ x-x > -1 / x-x ≥ 0", () => {
    const phi = and(gt(x, tLit(0)), assumeFinite(x));
    const subXX = app("-", [x, x]);
    expect(implies(phi, gt(subXX, tLit(-1)))).toBe(true);
    expect(implies(phi, ge(subXX, tLit(0)))).toBe(true);
  });

  it("x>2 ∧ assumeFinite(x) ⊢ (2*x - x) > 2（异号合并）", () => {
    const phi = and(gt(x, tLit(2)), assumeFinite(x));
    const twoX = app("*", [tLit(2), x]);
    const mixed = app("-", [twoX, x]);
    expect(implies(phi, gt(mixed, tLit(2)))).toBe(true);
  });

  it("x>0 ∧ y>0 ∧ assumeFinite(x) ∧ assumeFinite(y) ⊢ (x-x)+y > 0 ⇐ y>0", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)), assumeFinite(x), assumeFinite(y));
    const inner = app("+", [app("-", [x, x]), y]);
    expect(implies(phi, gt(inner, tLit(0)))).toBe(true);
  });

  it("x>0 ∧ y>0 ∧ assumeFinite(x) ∧ assumeFinite(y) ⊢ x+y-y === x", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)), assumeFinite(x), assumeFinite(y));
    const t = app("-", [app("+", [x, y]), y]);
    expect(implies(phi, eq(t, x))).toBe(true);
  });
});

describe("assumeFinite 开启分配律", () => {
  it("x>0 ∧ assumeFinite(x) ⊢ 2*(x+1)>2（分配律恢复）", () => {
    const phi = and(gt(x, tLit(0)), assumeFinite(x));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(true);
  });

  it("x>0 ∧ assumeFinite(x) ⊢ 2*(x+1)≥2", () => {
    const phi = and(gt(x, tLit(0)), assumeFinite(x));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, ge(twoXp1, tLit(2)))).toBe(true);
  });

  it("x>1 ∧ y>1 ∧ assumeFinite(x) ∧ assumeFinite(y) ⊢ 2*(x+y)>4", () => {
    const phi = and(
      gt(x, tLit(1)),
      gt(y, tLit(1)),
      assumeFinite(x),
      assumeFinite(y),
    );
    const twoSum = app("*", [tLit(2), app("+", [x, y])]);
    expect(implies(phi, gt(twoSum, tLit(4)))).toBe(true);
  });

  it("x>0 ∧ assumeFinite(x) ⊢ 3*(x+2)>6", () => {
    const phi = and(gt(x, tLit(0)), assumeFinite(x));
    const t = app("*", [tLit(3), app("+", [x, tLit(2)])]);
    expect(implies(phi, gt(t, tLit(6)))).toBe(true);
  });
});

describe("无有限证据仍 fail-closed（不回退 BUG-001 / DEC-007A）", () => {
  it("x>0 ⊬ 2*(x+1)>2", () => {
    const phi = gt(x, tLit(0));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(false);
  });

  it("x>0 ⊬ x-x===0 / 0*x===0", () => {
    const phi = gt(x, tLit(0));
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(false);
    expect(implies(phi, eq(app("*", [tLit(0), x]), tLit(0)))).toBe(false);
  });

  it("x>2 ⊬ (2*x - x) > 2", () => {
    const phi = gt(x, tLit(2));
    const twoX = app("*", [tLit(2), x]);
    const mixed = app("-", [twoX, x]);
    expect(implies(phi, gt(mixed, tLit(2)))).toBe(false);
  });

  it("x>0 ∧ y>0 ⊬ x+y-y === x（y 无有限证据）", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)));
    const t = app("-", [app("+", [x, y]), y]);
    expect(implies(phi, eq(t, x))).toBe(false);
  });

  it("x>0 ∧ y>0 ⊬ (x-x)+y > 0（x 无有限证据）", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)));
    const inner = app("+", [app("-", [x, x]), y]);
    expect(implies(phi, gt(inner, tLit(0)))).toBe(false);
  });

  it("x>0 ⊬ x-x > -1（无有限证据）", () => {
    const phi = gt(x, tLit(0));
    expect(implies(phi, gt(app("-", [x, x]), tLit(-1)))).toBe(false);
    expect(implies(phi, ge(app("-", [x, x]), tLit(0)))).toBe(false);
  });
});

describe("自动导出：typeof=number ∧ 双侧有限界", () => {
  it("typeof x=number ∧ x>0 ∧ x<100 ⊢ 2*(x+1)>2（自动有限）", () => {
    const phi = and(ptypeof(x, "number"), gt(x, tLit(0)), lt(x, tLit(100)));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(true);
  });

  it("typeof x=number ∧ x>0 ∧ x<100 ⊢ x-x===0", () => {
    const phi = and(ptypeof(x, "number"), gt(x, tLit(0)), lt(x, tLit(100)));
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(true);
  });

  it("typeof x=number ∧ x>0 ⊬ 2*(x+1)>2（不排除 +Inf）", () => {
    const phi = and(ptypeof(x, "number"), gt(x, tLit(0)));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(false);
  });

  it("typeof x=number ∧ x<100 ⊬ 2*(x+1)>2（不排除 -Inf / NaN 上界）", () => {
    const phi = and(ptypeof(x, "number"), lt(x, tLit(100)));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(false);
  });

  it("typeof x=number 单独 ⊬ x-x===0（无界）", () => {
    const phi = ptypeof(x, "number");
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(false);
  });

  it("x>0 ∧ x<10（无 typeof）⊬ 2*(x+1)>2（需 typeof=number 条件）", () => {
    const phi = and(gt(x, tLit(0)), lt(x, tLit(10)));
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(false);
  });

  it("typeof x=number ∧ x≥1 ∧ x≤10 ⊢ x-x===0（eq 点 [5,5] 同理）", () => {
    const phi = and(ptypeof(x, "number"), ge(x, tLit(1)), le(x, tLit(10)));
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(true);
  });
});

describe("assumeFinite 目标证明", () => {
  it("assumeFinite(x) ⊢ assumeFinite(x)", () => {
    expect(implies(assumeFinite(x), assumeFinite(x))).toBe(true);
  });

  it("typeof x=number ∧ x>0 ∧ x<10 ⊢ assumeFinite(x)", () => {
    const phi = and(ptypeof(x, "number"), gt(x, tLit(0)), lt(x, tLit(10)));
    expect(implies(phi, assumeFinite(x))).toBe(true);
  });

  it("x>0 ⊬ assumeFinite(x)（不排除 +Inf）", () => {
    expect(implies(gt(x, tLit(0)), assumeFinite(x))).toBe(false);
  });

  it("true ⊬ assumeFinite(x)", () => {
    expect(implies({ op: "true" }, assumeFinite(x))).toBe(false);
  });

  it("assumeFinite(x) ⊢ ¬¬assumeFinite(x)", () => {
    expect(implies(assumeFinite(x), not(not(assumeFinite(x))))).toBe(true);
  });
});

describe("健全性不回退：Inf/NaN 仍不得假证", () => {
  it("x=Inf ⊬ x-x===0（无 assumeFinite）", () => {
    const phi = eq(x, inf);
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(false);
  });

  it("x=Inf ⊬ 0*x===0", () => {
    const phi = eq(x, inf);
    expect(implies(phi, eq(app("*", [tLit(0), x]), tLit(0)))).toBe(false);
  });

  it("x!==x（NaN）⊬ x-x===0", () => {
    const phi = ne(x, x);
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(false);
  });

  it("x=Inf ⊬ 2*(x+1)>2（分配律默认关闭）", () => {
    const phi = eq(x, inf);
    const twoXp1 = app("*", [tLit(2), app("+", [x, tLit(1)])]);
    expect(implies(phi, gt(twoXp1, tLit(2)))).toBe(false);
  });

  it("typeof x=number ∧ x===Inf ⊬ x-x===0（Inf 非有限）", () => {
    const phi = and(ptypeof(x, "number"), eq(x, inf));
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(false);
  });

  it("typeof x=number ∧ x===NaN ⊬ x-x===0（NaN 非有限）", () => {
    const phi = and(ptypeof(x, "number"), eq(x, nan));
    expect(implies(phi, eq(app("-", [x, x]), tLit(0)))).toBe(false);
  });
});

describe("真线性事实不受影响", () => {
  it("y>1 ⊢ y+1>2（原有精度不丢）", () => {
    expect(implies(gt(y, tLit(1)), gt(app("+", [y, tLit(1)]), tLit(2)))).toBe(true);
  });

  it("x>2 ⊢ 2*x>4（单原子缩放始终可用）", () => {
    expect(implies(gt(x, tLit(2)), gt(app("*", [tLit(2), x]), tLit(4)))).toBe(true);
  });

  it("x≥5 ∧ y≤2 ⊢ x-y≥3（无环消去也可证）", () => {
    const phi = and(ge(x, tLit(5)), le(y, tLit(2)));
    expect(implies(phi, ge(app("-", [x, y]), tLit(3)))).toBe(true);
  });

  it("x>0 ∧ y>0 ⊢ x+y>0", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)));
    expect(implies(phi, gt(app("+", [x, y]), tLit(0)))).toBe(true);
  });
});
