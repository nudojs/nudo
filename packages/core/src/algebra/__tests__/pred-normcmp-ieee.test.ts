/**
 * normCmp 比较归一的 IEEE 回归（DEC-007 Phase A）。
 *
 * 背景：`a op b` 曾被归一为 `(a-b) op 0`，对 ±Infinity 不等价：
 *   - eq(Inf,Inf) 为真，而 Inf-Inf=NaN，NaN===0 为假
 *   - ge/le(Inf,Inf) 同理
 *   - ne(Inf,Inf) 为假，而 NaN!==0 为真（假证方向）
 * 因此 eq/ge/le/ne 不经减法归一，改两侧区间直接比较；
 * 反身 a op a 走比较语义（x===x 对 Inf 为真），NaN 可能路径 fail-closed。
 */
import { describe, it, expect } from "vitest";
import { implies, and, eq, ne, gt, ge, le, ptypeof } from "../pred.ts";
import { lit as tLit, v } from "../term.ts";

const x = v("x");
const y = v("y");
const inf = tLit(Infinity);
const ninf = tLit(-Infinity);
const nan = tLit(NaN);

describe("normCmp 不经减法归一：±Inf 上 eq/ge/le/ne 直接比较", () => {
  it("x=Inf ∧ y=Inf ⊢ x===y（归一到 Inf-Inf=NaN 会丢真）", () => {
    const phi = and(eq(x, inf), eq(y, inf));
    expect(implies(phi, eq(x, y))).toBe(true);
  });

  it("x=Inf ∧ y=Inf ⊢ x≥y / x≤y", () => {
    const phi = and(eq(x, inf), eq(y, inf));
    expect(implies(phi, ge(x, y))).toBe(true);
    expect(implies(phi, le(x, y))).toBe(true);
  });

  it("x=Inf ∧ y=Inf ⊬ x>y（Inf>Inf 为假）", () => {
    const phi = and(eq(x, inf), eq(y, inf));
    expect(implies(phi, gt(x, y))).toBe(false);
  });

  it("x=Inf ∧ y=Inf ⊬ x!==y（Inf!==Inf 为假；NaN!==0 会假证）", () => {
    const phi = and(eq(x, inf), eq(y, inf));
    expect(implies(phi, ne(x, y))).toBe(false);
  });

  it("x=-Inf ∧ y=-Inf ⊢ x===y / x≥y / x≤y；⊬ x!==y", () => {
    const phi = and(eq(x, ninf), eq(y, ninf));
    expect(implies(phi, eq(x, y))).toBe(true);
    expect(implies(phi, ge(x, y))).toBe(true);
    expect(implies(phi, le(x, y))).toBe(true);
    expect(implies(phi, ne(x, y))).toBe(false);
  });

  it("x=Inf ∧ y=-Inf ⊢ x!==y / x>y / x≥y；⊬ x===y / x≤y", () => {
    const phi = and(eq(x, inf), eq(y, ninf));
    expect(implies(phi, ne(x, y))).toBe(true);
    expect(implies(phi, gt(x, y))).toBe(true);
    expect(implies(phi, ge(x, y))).toBe(true);
    expect(implies(phi, eq(x, y))).toBe(false);
    expect(implies(phi, le(x, y))).toBe(false);
  });

  it("纯字面量 Inf/NaN 比较仍按 JS 语义判定", () => {
    const t = { op: "true" } as const;
    expect(implies(t, eq(inf, inf))).toBe(true);
    expect(implies(t, ge(inf, inf))).toBe(true);
    expect(implies(t, le(inf, inf))).toBe(true);
    expect(implies(t, ne(inf, inf))).toBe(false);
    expect(implies(t, gt(inf, inf))).toBe(false);
    expect(implies(t, eq(ninf, ninf))).toBe(true);
    expect(implies(t, ne(ninf, inf))).toBe(true);
    expect(implies(t, eq(nan, nan))).toBe(false);
    expect(implies(t, ne(nan, nan))).toBe(true);
    expect(implies(t, eq(nan, tLit(0)))).toBe(false);
    expect(implies(t, ne(nan, tLit(0)))).toBe(true);
    expect(implies(t, ge(nan, tLit(0)))).toBe(false);
    expect(implies(t, le(nan, tLit(0)))).toBe(false);
    expect(implies(t, gt(nan, tLit(0)))).toBe(false);
    expect(implies(t, ne(inf, tLit(5)))).toBe(true);
    expect(implies(t, eq(inf, tLit(5)))).toBe(false);
  });
});

describe("反身比较 a op a：比较语义而非 a-a 归一", () => {
  it("x>0 ⊢ x===x / x≥x / x≤x（x>0 排除 NaN，x===x 对 Inf 为真）", () => {
    const phi = gt(x, tLit(0));
    expect(implies(phi, eq(x, x))).toBe(true);
    expect(implies(phi, ge(x, x))).toBe(true);
    expect(implies(phi, le(x, x))).toBe(true);
  });

  it("x>0 ⊬ x>x / x<x / x!==x", () => {
    const phi = gt(x, tLit(0));
    expect(implies(phi, gt(x, x))).toBe(false);
    expect(implies(phi, ne(x, x))).toBe(false);
  });

  it("允许 NaN 的上下文（x!==x）下 eq(x,x) 不得假证", () => {
    const phi = ne(x, x);
    expect(implies(phi, eq(x, x))).toBe(false);
    expect(implies(phi, ge(x, x))).toBe(false);
    expect(implies(phi, le(x, x))).toBe(false);
  });

  it("x!==x ∧ y>0 时 eq(x,x) 仍不得假证", () => {
    const phi = and(ne(x, x), gt(y, tLit(0)));
    expect(implies(phi, eq(x, x))).toBe(false);
  });

  it("无约束 Φ ⊬ eq(x,x)（x 可能是 NaN）", () => {
    const t = { op: "true" } as const;
    expect(implies(t, eq(x, x))).toBe(false);
  });

  it("typeof x=number 不排除 NaN，⊬ eq(x,x)", () => {
    const phi = ptypeof(x, "number");
    expect(implies(phi, eq(x, x))).toBe(false);
  });

  it("x===Inf ⊢ eq(x,x) / ge(x,x)（Inf===Inf 为真）", () => {
    const phi = eq(x, inf);
    expect(implies(phi, eq(x, x))).toBe(true);
    expect(implies(phi, ge(x, x))).toBe(true);
    expect(implies(phi, le(x, x))).toBe(true);
    expect(implies(phi, ne(x, x))).toBe(false);
  });
});

describe("NaN 可能路径 fail-closed", () => {
  it("x 可能 NaN 时 ⊬ x===x 之外的关系比较", () => {
    const t = { op: "true" } as const;
    expect(implies(t, ge(x, tLit(0)))).toBe(false);
    expect(implies(t, le(x, tLit(0)))).toBe(false);
    expect(implies(t, gt(x, tLit(-1)))).toBe(false);
    expect(implies(t, eq(x, tLit(0)))).toBe(false);
  });

  it("y>0 但 x 无约束时 ⊬ x+y≥x（x=-Inf,y=Inf 时 x+y 为 NaN）", () => {
    const phi = gt(y, tLit(0));
    expect(implies(phi, ge({ op: "app", fn: "+", args: [x, y] } as never, x))).toBe(false);
  });

  it("x=Inf ⊢ x+1===x（两侧皆 Inf，直接比较可证）", () => {
    const phi = eq(x, inf);
    const xp1 = { op: "app", fn: "+", args: [x, tLit(1)] } as never;
    expect(implies(phi, eq(xp1, x))).toBe(true);
    expect(implies(phi, ge(xp1, x))).toBe(true);
    expect(implies(phi, le(xp1, x))).toBe(true);
    expect(implies(phi, ne(xp1, x))).toBe(false);
  });

  it("x≥5 ∧ y≤2 ⊢ x-y≥3 与 x≥y 仍可证（真线性事实不丢）", () => {
    const phi = and(ge(x, tLit(5)), le(y, tLit(2)));
    expect(implies(phi, ge({ op: "app", fn: "-", args: [x, y] } as never, tLit(3)))).toBe(true);
    expect(implies(phi, ge(x, y))).toBe(true);
    expect(implies(phi, gt(x, y))).toBe(true);
    expect(implies(phi, ne(x, y))).toBe(true);
    expect(implies(phi, eq(x, y))).toBe(false);
  });

  it("x>2 ∧ y>2 ⊢ x+y>4 仍可证", () => {
    const phi = and(gt(x, tLit(2)), gt(y, tLit(2)));
    expect(implies(phi, gt({ op: "app", fn: "+", args: [x, y] } as never, tLit(4)))).toBe(true);
  });
});
