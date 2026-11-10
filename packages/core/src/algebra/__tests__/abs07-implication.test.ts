/**
 * ABS-07：Pred 蕴含判定升级（sound 子集）。
 *
 * 覆盖：
 * - 序关系闭包（difference logic 的可证片段）：`x≤y ∧ y≤z ⇒ x≤z`、
 *   严格链、反向链；反向/无证据必须**证不出**（不新增假绿）；
 * - 简单非线性：`x≥0 ⇒ x*x≥0`、`x≥3 ⇒ x*x≥9`；无事实 / 严格目标 /
 *   下溢反例（`x>0 ⇒ x*x>0`，x=5e-324 ⇒ 0）必须证不出；
 * - DNF 重写：合取内嵌析取的等价展开；析取不得被误当单支；
 * - 反例钉：IEEE 吸收（2^53）与 Inf-Inf 使「关系式 ⇒ 差式」**不成立**，
 *   引擎必须保持诚实（unprovable）；
 * - 可选 oracle：答案按 (phi, pred) 缓存（确定性契约），默认仍 fail-closed。
 */
import { describe, it, expect } from "vitest";
import {
  and,
  or,
  le,
  ge,
  gt,
  lt,
  eq,
  assumeFinite,
  implies,
  pTrue,
  setImplicationOracle,
} from "../pred.ts";
import { v, lit, app, type Term } from "../term.ts";

const x = v("x");
const y = v("y");
const z = v("z");
const sq = (t: Term): Term => app("*", [t, t]);
const sub = (a: Term, b: Term): Term => app("-", [a, b]);

describe("ABS-07 序关系闭包（difference logic 可证片段）", () => {
  it("传递闭包：≤ / 严格链 / ≥ 链", () => {
    expect(implies(and(le(x, y), le(y, z)), le(x, z))).toBe(true);
    expect(implies(and(lt(x, y), le(y, z)), lt(x, z))).toBe(true);
    expect(implies(and(ge(x, y), ge(y, z)), ge(x, z))).toBe(true);
    expect(implies(and(gt(x, y), ge(y, z)), gt(x, z))).toBe(true);
  });

  it("无证据 / 方向相反 ⇒ 证不出（不新增假绿）", () => {
    expect(implies(le(x, y), gt(x, y))).toBe(false);
    expect(implies(and(le(x, y), le(y, z)), le(z, x))).toBe(false);
    expect(implies(lt(x, y), lt(x, z))).toBe(false);
    expect(implies(pTrue, le(x, y))).toBe(false);
  });

  it("单跳等价：le/lt/ge/gt 的对偶方向", () => {
    expect(implies(le(x, y), ge(y, x))).toBe(true);
    expect(implies(lt(x, y), gt(y, x))).toBe(true);
    expect(implies(le(x, y), lt(x, y))).toBe(false);
  });
});

describe("ABS-07 简单非线性（平方下界）", () => {
  it("x≥0 ⇒ x*x≥0；x≥3 ⇒ x*x≥9", () => {
    expect(implies(ge(x, lit(0)), ge(sq(x), lit(0)))).toBe(true);
    expect(implies(ge(x, lit(3)), ge(sq(x), lit(9)))).toBe(true);
    expect(implies(ge(x, lit(3)), ge(sq(x), lit(8)))).toBe(true);
  });

  it("反例：无事实时 x*x≥0 不成立（x 可能是 NaN / 非数）", () => {
    expect(implies(pTrue, ge(sq(x), lit(0)))).toBe(false);
  });

  it("反例：x>0 ⇒ x*x>0 不成立（下溢：x=5e-324 ⇒ x*x=0）", () => {
    expect(implies(gt(x, lit(0)), gt(sq(x), lit(0)))).toBe(false);
  });

  it("反例：x≥0 不足以证 x*x≤0（仅 x=0 时成立）", () => {
    expect(implies(ge(x, lit(0)), le(sq(x), lit(0)))).toBe(false);
  });
});

describe("ABS-07 DNF 重写（合取内嵌析取）", () => {
  it("(A ∧ (B ∨ C)) ⇒ B∨C / A 可证", () => {
    const phi = and(gt(x, lit(0)), or(gt(y, lit(0)), gt(z, lit(0))));
    expect(implies(phi, or(gt(y, lit(0)), gt(z, lit(0))))).toBe(true);
    expect(implies(phi, gt(x, lit(0)))).toBe(true);
  });

  it("析取整体不得被误当成单支（无假绿）", () => {
    expect(implies(or(gt(x, lit(0)), gt(y, lit(0))), gt(x, lit(0)))).toBe(false);
  });

  it("(A∨B) ∧ C ⇒ C 可证", () => {
    const phi = and(or(gt(x, lit(0)), gt(y, lit(0))), gt(z, lit(0)));
    expect(implies(phi, gt(z, lit(0)))).toBe(true);
  });
});

describe("ABS-07 反例钉（IEEE 舍入 / 非线性边界）", () => {
  it("Inf-Inf：x≤y ⊬ x-y≤0（x=y=Inf 时差为 NaN）", () => {
    expect(implies(le(x, y), le(sub(x, y), lit(0)))).toBe(false);
  });

  it("2^53 吸收：x≥y+1 ⊬ x-y≥1（巨大 y 时 fl(y+1)=y）", () => {
    expect(
      implies(ge(x, app("+", [y, lit(1)])), ge(sub(x, y), lit(1))),
    ).toBe(false);
  });

  it("x-y≤0 目标在无有限证据时保持证不出（sound）", () => {
    expect(
      implies(
        and(le(x, y), assumeFinite(x), assumeFinite(y)),
        le(sub(x, y), lit(0)),
      ),
    ).toBe(false);
  });
});

describe("ABS-07 可选 oracle（默认 fail-closed；答案缓存）", () => {
  it("oracle 证出时生效；同一 (phi, pred) 只问一次", () => {
    let calls = 0;
    setImplicationOracle((_phi, pred) => {
      calls++;
      // 只对「无内建证据」的目标给出答案
      return pred.op === "eq" && pred.a.op === "var" && pred.b.op === "var";
    });
    try {
      const goal = eq(x, y);
      expect(implies(le(x, y), goal)).toBe(true);
      expect(implies(le(x, y), goal)).toBe(true);
      expect(calls).toBe(1);
    } finally {
      setImplicationOracle(undefined);
    }
  });

  it("默认无 oracle：不可证目标保持 false", () => {
    expect(implies(le(x, y), eq(x, y))).toBe(false);
  });
});
