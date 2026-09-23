import { describe, it, expect } from "vitest";
import {
  and,
  or,
  gt,
  lt,
  le,
  ge,
  eq,
  ne,
  not,
  negatePred,
  implies,
  pTrue,
  pFalse,
  predToString,
} from "../pred.ts";
import { v, lit } from "../term.ts";

describe("pred and/or 化简（D3）", () => {
  it("and 去重：ms>0 ∧ ms>0 → ms>0", () => {
    const x = v("ms");
    const p = and(gt(x, lit(0)), gt(x, lit(0)));
    expect(predToString(p)).toBe("ms > 0");
  });

  it("and 嵌套展平后仍去重", () => {
    const x = v("ms");
    const p = and(and(gt(x, lit(0)), gt(x, lit(0))), gt(x, lit(0)));
    expect(predToString(p)).toBe("ms > 0");
  });

  it("or 去重", () => {
    const x = v("n");
    const p = or(eq(x, lit(1)), eq(x, lit(1)));
    expect(predToString(p)).toBe("n = 1");
  });

  it("不等谓词不去重", () => {
    const x = v("n");
    const p = and(gt(x, lit(0)), lt(x, lit(10)));
    expect(predToString(p)).toBe("n > 0 ∧ n < 10");
  });

  it("true/false 吸收不变", () => {
    const x = v("n");
    expect(and(pTrue, gt(x, lit(0)))).toEqual(gt(x, lit(0)));
    expect(and(pFalse, gt(x, lit(0)))).toEqual(pFalse);
  });
});

describe("negatePred De Morgan", () => {
  it("¬(A∧B) = ¬A∨¬B", () => {
    const x = v("x");
    const y = v("y");
    const p = and(gt(x, lit(0)), gt(y, lit(0)));
    expect(predToString(negatePred(p))).toBe("(x ≤ 0 ∨ y ≤ 0)");
  });

  it("¬(A∨B) = ¬A∧¬B", () => {
    const x = v("x");
    const y = v("y");
    const p = or(gt(x, lit(0)), gt(y, lit(0)));
    expect(predToString(negatePred(p))).toBe("x ≤ 0 ∧ y ≤ 0");
  });

  it("双重否定消去", () => {
    const x = v("x");
    expect(negatePred(negatePred(gt(x, lit(0))))).toEqual(gt(x, lit(0)));
  });

  it("原子比较取互补", () => {
    const x = v("x");
    expect(negatePred(eq(x, lit(1)))).toEqual(ne(x, lit(1)));
    expect(negatePred(lt(x, lit(1)))).toEqual(ge(x, lit(1)));
  });

  it("typeof 否定保持 not（PrimName 域不全，不展开）", () => {
    const x = v("x");
    const p = { op: "typeof" as const, t: x, type: "number" as const };
    const n = negatePred(p);
    expect(n.op).toBe("not");
  });
});

describe("implies with De Morgan / not", () => {
  it("x≤0∨y≤0 ⊢ ¬(x>0∧y>0)", () => {
    const x = v("x");
    const y = v("y");
    const phi = or(le(x, lit(0)), le(y, lit(0)));
    expect(implies(phi, negatePred(and(gt(x, lit(0)), gt(y, lit(0)))))).toBe(true);
  });

  it("x≤0∧y≤0 ⊢ ¬(x>0∧y>0)", () => {
    const x = v("x");
    const y = v("y");
    const phi = and(le(x, lit(0)), le(y, lit(0)));
    expect(implies(phi, negatePred(and(gt(x, lit(0)), gt(y, lit(0)))))).toBe(true);
  });

  it("x≤0 ∨ y≤0 ⊬ x≤0（析取不能砍成单支）", () => {
    const x = v("x");
    const y = v("y");
    const phi = or(le(x, lit(0)), le(y, lit(0)));
    expect(implies(phi, le(x, lit(0)))).toBe(false);
  });

  it("逆否：¬(x>0) ⊢ ¬(x>5) 当 x>5 ⊢ x>0", () => {
    const x = v("x");
    // 构造侧已 De Morgan 成 x≤0；目标 ¬(x>5) 展开为 x≤5
    const phi = negatePred(gt(x, lit(0)));
    expect(implies(phi, negatePred(gt(x, lit(5))))).toBe(true);
  });

  it("typeof 否定：已知 string ⇒ ¬number", () => {
    const x = v("x");
    const phi = { op: "typeof" as const, t: x, type: "string" as const };
    const goal = not({ op: "typeof" as const, t: x, type: "number" as const });
    expect(implies(phi, goal)).toBe(true);
  });

  it("typeof 否定：已知 string ⇒ ¬boolean（同项不同标签）", () => {
    const x = v("x");
    const phi = { op: "typeof" as const, t: x, type: "string" as const };
    const goal = not({ op: "typeof" as const, t: x, type: "boolean" as const });
    expect(implies(phi, goal)).toBe(true);
  });

  it("typeof：¬number ⊬ string（否定不能反推正标签）", () => {
    const x = v("x");
    const phi = not({ op: "typeof" as const, t: x, type: "number" as const });
    const goal = { op: "typeof" as const, t: x, type: "string" as const };
    expect(implies(phi, goal)).toBe(false);
  });
});
