/**
 * linOf / proveInCtx 的 IEEE 环公理回归。
 * 回归背景：pred.ts 的 linOf 按实数环化简 `x-x`→0、`0*x`→0，
 * 与 arithmetic.ts/term.ts 禁止 `x*0=0` 的 IEEE 口径冲突。
 * x=±Infinity 时 `Inf-Inf`/`Inf*0` 为 NaN，分支上下文 `x>0` 不排除 Infinity，
 * 因此 `x-x===0` / `0*x===0` 不得被 imply 为恒真。
 * `x+x=2*x`、`2*x` 缩放、真线性式仍应可证。
 */
import { describe, it, expect } from "vitest";
import { implies, and, eq, ne, gt, ge, lt, le } from "../pred.ts";
import { app, lit as tLit, v } from "../term.ts";

const x = v("x");
const y = v("y");

describe("linOf IEEE: x-x / 0*x must not fold to constant 0", () => {
  it("x>0 ⊬ x-x===0（Infinity 时 Inf-Inf 为 NaN）", () => {
    const phi = gt(x, tLit(0));
    const subXX = app("-", [x, x]);
    expect(implies(phi, eq(subXX, tLit(0)))).toBe(false);
  });

  it("x>0 ⊬ 0*x===0（Infinity 时 Inf*0 为 NaN）", () => {
    const phi = gt(x, tLit(0));
    const zeroX = app("*", [tLit(0), x]);
    expect(implies(phi, eq(zeroX, tLit(0)))).toBe(false);
  });

  it("x>0 ⊬ x*0===0", () => {
    const phi = gt(x, tLit(0));
    const xZero = app("*", [x, tLit(0)]);
    expect(implies(phi, eq(xZero, tLit(0)))).toBe(false);
  });

  it("x>0 ⊬ 0*x > -1（Inf*0=NaN，NaN>-1 为 false）", () => {
    const phi = gt(x, tLit(0));
    const zeroX = app("*", [tLit(0), x]);
    expect(implies(phi, gt(zeroX, tLit(-1)))).toBe(false);
    expect(implies(phi, ge(zeroX, tLit(0)))).toBe(false);
  });

  it("x>0 ⊬ x-x > -1 / x-x ≥ 0", () => {
    const phi = gt(x, tLit(0));
    const subXX = app("-", [x, x]);
    expect(implies(phi, gt(subXX, tLit(-1)))).toBe(false);
    expect(implies(phi, ge(subXX, tLit(0)))).toBe(false);
    expect(implies(phi, le(subXX, tLit(0)))).toBe(false);
    expect(implies(phi, lt(subXX, tLit(1)))).toBe(false);
    expect(implies(phi, ne(subXX, tLit(1)))).toBe(false);
  });

  it("x>0 ⊬ (x-x)+y > 0 ⇐ y>0（被消去的 x 仍可能让表达式为 NaN）", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)));
    const inner = app("+", [app("-", [x, x]), y]);
    expect(implies(phi, gt(inner, tLit(0)))).toBe(false);
  });

  it("x>0 ⊬ (x-x)+y === y", () => {
    const phi = gt(x, tLit(0));
    const inner = app("+", [app("-", [x, x]), y]);
    expect(implies(phi, eq(inner, y))).toBe(false);
  });

  it("x>2 ⊬ (2*x - x) > 2（异号合并 Inf-Inf 为 NaN）", () => {
    const phi = gt(x, tLit(2));
    const twoX = app("*", [tLit(2), x]);
    const mixed = app("-", [twoX, x]);
    expect(implies(phi, gt(mixed, tLit(2)))).toBe(false);
  });

  it("x>0 ⊬ x+y-y === x（y 消去后 y=Inf 可得 NaN）", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)));
    const t = app("-", [app("+", [x, y]), y]);
    expect(implies(phi, eq(t, x))).toBe(false);
  });
});

describe("linOf IEEE: true linear facts still provable", () => {
  it("y>1 ⊢ y+1>2", () => {
    expect(implies(gt(y, tLit(1)), gt(app("+", [y, tLit(1)]), tLit(2)))).toBe(true);
  });

  it("x>2 ⊢ 2*x>4（常数×单原子缩放仍可用）", () => {
    expect(implies(gt(x, tLit(2)), gt(app("*", [tLit(2), x]), tLit(4)))).toBe(true);
  });

  it("x>2 ⊢ x*2>4", () => {
    expect(implies(gt(x, tLit(2)), gt(app("*", [x, tLit(2)]), tLit(4)))).toBe(true);
  });

  it("x≥5 ∧ y≤2 ⊢ x-y≥3", () => {
    const phi = and(ge(x, tLit(5)), le(y, tLit(2)));
    expect(implies(phi, ge(app("-", [x, y]), tLit(3)))).toBe(true);
  });

  it("x>0 ∧ y>0 ⊢ x+y>0", () => {
    const phi = and(gt(x, tLit(0)), gt(y, tLit(0)));
    expect(implies(phi, gt(app("+", [x, y]), tLit(0)))).toBe(true);
  });

  it("x+x = 2*x 同号合并在 IEEE 成立，常数目标可证", () => {
    // x+x-2*x 恒为 0（含 Inf：Inf+Inf-2*Inf = Inf-Inf 为 NaN，故该项内
    // 异号合并应拒绝）——这里只验证纯字面量与单原子缩放不受影响。
    expect(implies(gt(x, tLit(0)), gt(app("+", [x, x]), tLit(0)))).toBe(true);
    expect(implies(gt(x, tLit(0)), gt(app("*", [tLit(3), x]), tLit(0)))).toBe(true);
  });

  it("纯字面量比较仍可判定", () => {
    expect(implies(gt(x, tLit(0)), eq(tLit(1), tLit(1)))).toBe(true);
    expect(implies(gt(x, tLit(0)), eq(tLit(1), tLit(2)))).toBe(false);
  });
});
