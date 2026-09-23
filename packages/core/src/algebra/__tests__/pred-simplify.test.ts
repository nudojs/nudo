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
  ptypeof,
  TYPEOF_NAMES,
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

  it("typeof 否定展开为其余 7 标签析取", () => {
    const x = v("x");
    const n = negatePred(ptypeof(x, "number"));
    expect(n.op).toBe("or");
    if (n.op !== "or") throw new Error("unreachable");
    expect(n.args).toHaveLength(7);
    const tags = n.args.map((a) => (a as { type: string }).type);
    expect(tags).toEqual([
      "undefined",
      "object",
      "boolean",
      "bigint",
      "string",
      "symbol",
      "function",
    ]);
    expect(tags).not.toContain("number");
  });

  it("¬(typeof x=\"function\") 展开含 object/undefined 等其余标签", () => {
    const x = v("x");
    const n = negatePred(ptypeof(x, "function"));
    expect(n.op).toBe("or");
    if (n.op !== "or") throw new Error("unreachable");
    expect(n.args).toHaveLength(7);
    const tags = n.args.map((a) => (a as { type: string }).type);
    expect(tags).toContain("object");
    expect(tags).toContain("undefined");
    expect(tags).toContain("number");
    expect(tags).not.toContain("function");
    // 展开完备：恰好是 TypeofName \ {function}
    expect(tags.slice().sort()).toEqual(
      TYPEOF_NAMES.filter((t) => t !== "function")
        .slice()
        .sort(),
    );
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
    const phi = ptypeof(x, "string");
    const goal = not(ptypeof(x, "number"));
    expect(implies(phi, goal)).toBe(true);
  });

  it("typeof 否定：已知 string ⇒ ¬boolean（同项不同标签）", () => {
    const x = v("x");
    const phi = ptypeof(x, "string");
    const goal = not(ptypeof(x, "boolean"));
    expect(implies(phi, goal)).toBe(true);
  });

  it("typeof：¬number ⊬ string（否定不能反推正标签）", () => {
    const x = v("x");
    const phi = not(ptypeof(x, "number"));
    const goal = ptypeof(x, "string");
    expect(implies(phi, goal)).toBe(false);
  });

  it("typeof 否定展开的析取可被 implies 消费：string ⊢ ¬number 的展开形", () => {
    const x = v("x");
    const phi = ptypeof(x, "string");
    expect(implies(phi, negatePred(ptypeof(x, "number")))).toBe(true);
  });

  it("¬(typeof x=\"function\") 后已知 object 仍推不出 function", () => {
    const x = v("x");
    const phi = not(ptypeof(x, "function"));
    expect(implies(phi, ptypeof(x, "object"))).toBe(false);
    expect(implies(phi, ptypeof(x, "undefined"))).toBe(false);
  });
});
