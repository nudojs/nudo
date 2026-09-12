import { describe, it, expect } from "vitest";
import {
  add,
  cmp,
  numLit,
  numVar,
  strLit,
  gtNum,
  lit,
  v,
  termToString,
  predToString,
  litValue,
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
    const r = add(numLit(1), numLit(3));
    expect(litValue(r)).toBe(4);
    expect(r.conf).toBe("exact");
    expect(r.term?.op).toBe("lit");
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("add keeps term as (x + 1) when a is symbolic", () => {
    const x = numVar("x");
    const r = add(x, numLit(1));
    expect(r.term).toBeDefined();
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.shape).toEqual({ k: "prim", type: "number" });
    expect(r.conf).toBe("path");
  });

  it("Φ: x>0  ⇒  add(x,1) has pred term>1", () => {
    const x = numVar("x", gtNum(v("x"), 0));
    const phi = gtNum(v("x"), 0);
    const r = add(x, numLit(1), phi);

    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred).toBeDefined();
    const ps = predToString(r.pred!);
    expect(ps).toContain(">");
    expect(ps).toContain("1");
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

    const c = add(x, numLit(1), phi);
    const r = add(c, numLit(1), phi);

    expect(r.term).toBeDefined();
    const ts = termToString(r.term!);
    expect(ts === "(x + 2)" || ts === "((x + 1) + 1)").toBe(true);

    expect(r.pred).toBeDefined();
    if (r.pred!.op === "gt") {
      expect(r.pred!.b).toEqual(lit(2));
    } else {
      expect(predToString(r.pred!)).toContain("2");
    }
  });

  it("non-negativity: x>0 ⇒ x+1 > 0 (weaker but still valid)", () => {
    const phi = gtNum(v("x"), 0);
    const x = numVar("x", gtNum(v("x"), 0));
    const r = add(x, numLit(1), phi);
    expect(r.pred!.op).toBe("gt");
  });
});

describe("comparison implies under Φ", () => {
  it("x>0 ⊢ x+1 > 1 is true", () => {
    const phi = gtNum(v("x"), 0);
    const x = numVar("x", gtNum(v("x"), 0));
    const sum = add(x, numLit(1), phi);
    const c = cmp("gt", sum, numLit(1), phi);
    expect(litValue(c)).toBe(true);
  });

  it("string concat keeps string shape", () => {
    const r = add(strLit("a"), strLit("b"));
    expect(litValue(r)).toBe("ab");
    expect(r.shape).toEqual({ k: "prim", type: "string" });
  });
});
