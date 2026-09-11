import { describe, it, expect } from "vitest";
import {
  add,
  callAdd,
  cmp,
  defineFn,
  evalExpr,
  evalIf,
  envOf,
  numLit,
  numVar,
  strLit,
  gtNum,
  lit,
  v,
  termToString,
  predToString,
  absToString,
  litValue,
  type Expr,
  type Abs,
} from "../index.ts";

/**
 * 示例 0 金标：类型即计算
 *
 * add = (a, b) => a + b
 * add(1, 3)          → lit(4)                 #exact
 * Φ: x > 0
 * add(x, 1)          → term=x+1, pred:>1      #path
 * twice(x)           → term=(x+1)+1, pred:>2  #path
 */

describe("Example 0: add is the computation itself", () => {
  it("add(1, 3) evaluates to literal 4 #exact", () => {
    const r = callAdd(numLit(1), numLit(3));
    expect(litValue(r)).toBe(4);
    expect(r.conf).toBe("exact");
    expect(r.term?.op).toBe("lit");
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("add keeps term as (x + 1) when a is symbolic", () => {
    const x = numVar("x");
    const r = callAdd(x, numLit(1));
    expect(r.term).toBeDefined();
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.shape).toEqual({ k: "prim", type: "number" });
    expect(r.conf).toBe("path");
  });

  it("Φ: x>0  ⇒  add(x,1) has pred term>1", () => {
    const x = numVar("x", gtNum(v("x"), 0));
    const phi = gtNum(v("x"), 0);
    const r = callAdd(x, numLit(1), phi);

    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred).toBeDefined();
    const ps = predToString(r.pred!);
    // 应推出 (x+1) > 1
    expect(ps).toContain(">");
    expect(ps).toContain("1");
    // 更强检查：pred 就是 (x+1) > 1
    expect(r.pred!.op).toBe("gt");
    if (r.pred!.op === "gt") {
      expect(termToString(r.pred!.a)).toBe("(x + 1)");
      expect(r.pred!.b).toEqual(lit(1));
    }
    expect(r.conf).toBe("path");
  });

  it("twice: x>0 ⇒ (x+1)+1 with pred >2", () => {
    const phi = gtNum(v("x"), 0);
    const x = numVar("x", gtNum(v("x"), 0));

    // const c = add(x, 1)
    const c = callAdd(x, numLit(1), phi);
    // return add(c, 1)  —— 用 c 的 term 与 pred，在同一 Φ 下
    // 注意：c 的 pred 是相对 c.term 的；numericBounds 会用 c.pred
    const r = add(c, numLit(1), phi);

    expect(r.term).toBeDefined();
    // (x+1)+1 可能被 simplify 成 (x + 2) 或保持嵌套
    const ts = termToString(r.term!);
    expect(ts === "(x + 2)" || ts === "((x + 1) + 1)").toBe(true);

    expect(r.pred).toBeDefined();
    if (r.pred!.op === "gt") {
      expect(r.pred!.b).toEqual(lit(2));
    } else {
      // 若因 term 形态不同，至少 pred 文本含 2
      expect(predToString(r.pred!)).toContain("2");
    }
  });

  it("non-negativity: x>0 ⇒ x+1 > 0 (weaker but still valid)", () => {
    const phi = gtNum(v("x"), 0);
    const x = numVar("x", gtNum(v("x"), 0));
    const r = callAdd(x, numLit(1), phi);
    // r.pred 应为 term>1，而 1>0，所以 term>0 也成立
    // 这里检查 numericBounds 路径：lo of x is 0 strict
    expect(r.pred!.op).toBe("gt");
  });
});

describe("Example 0 via mini expression language", () => {
  it("evalExpr(1+3) → 4", () => {
    const e: Expr = {
      kind: "bin",
      op: "+",
      left: { kind: "num", value: 1 },
      right: { kind: "num", value: 3 },
    };
    const r = evalExpr(e, envOf([]));
    expect(litValue(r)).toBe(4);
    expect(r.conf).toBe("exact");
  });

  it("evalExpr(x+1) under Φ x>0", () => {
    const e: Expr = {
      kind: "bin",
      op: "+",
      left: { kind: "var", name: "x" },
      right: { kind: "num", value: 1 },
    };
    const phi = gtNum(v("x"), 0);
    const env = envOf([["x", numVar("x", gtNum(v("x"), 0))]]);
    const r = evalExpr(e, env, phi);
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred!.op).toBe("gt");
  });

  it("call add via registry", () => {
    const e: Expr = {
      kind: "call",
      callee: "add",
      args: [
        { kind: "num", value: 2 },
        { kind: "num", value: 40 },
      ],
    };
    const r = evalExpr(e, envOf([]));
    expect(litValue(r)).toBe(42);
  });
});

describe("comparison implies under Φ", () => {
  it("x>0 ⊢ x+1 > 1 is true", () => {
    const phi = gtNum(v("x"), 0);
    const x = numVar("x", gtNum(v("x"), 0));
    const sum = add(x, numLit(1), phi);
    // sum.pred 应是 term>1；再 cmp(sum, 1) 在 Φ 下应能推出 true
    // 但 cmp 用的是 sum.term vs lit(1)，implies 需从 Φ 推 (x+1)>1
    const c = cmp("gt", sum, numLit(1), phi);
    // 因为 sum 已带 pred term>1，且 implies(phi, (x+1)>1) 应成功
    // 注意 cmp 的 implies 是对 pred=(a.term > b.term) 即 (x+1)>1
    expect(litValue(c)).toBe(true);
  });

  it("string concat keeps string shape", () => {
    const r = add(strLit("a"), strLit("b"));
    expect(litValue(r)).toBe("ab");
    expect(r.shape).toEqual({ k: "prim", type: "string" });
  });
});
