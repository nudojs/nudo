import { describe, it, expect } from "vitest";
import {
  add,
  sub,
  mul,
  div,
  mod,
  cmp,
  refineAbsForRelTrue,
  and,
  makeSum,
  numLit,
  numVar,
  strLit,
  boolLit,
  gtNum,
  geNum,
  ltNum,
  leNum,
  or,
  lit,
  v,
  termToString,
  predToString,
  litValue,
  implies,
  simplifyTerm,
  app,
} from "../index.ts";

describe("term simplify", () => {
  it("folds 1+3", () => {
    expect(simplifyTerm(app("+", [lit(1), lit(3)]))).toEqual(lit(4));
  });
  it("x+0 = x", () => {
    expect(simplifyTerm(app("+", [v("x"), lit(0)]))).toEqual(v("x"));
  });
  it("0+x = x", () => {
    expect(simplifyTerm(app("+", [lit(0), v("x")]))).toEqual(v("x"));
  });
  it("x*0 = 0", () => {
    expect(simplifyTerm(app("*", [v("x"), lit(0)]))).toEqual(lit(0));
  });
});

describe("add monotonicity", () => {
  it("unconstrained any + 1: number|string 并集，term kept（real JS）", () => {
    // 无契约时 x 是 any；score('x') 合法，+ 可能是拼接也可能是加法
    const anyA = {
      shape: { k: "any" as const },
      term: v("A1"),
      conf: "path" as const,
    };
    const r = add(anyA, numLit(1));
    expect(r.shape.k).toBe("sum");
    if (r.shape.k === "sum") {
      const kinds = r.shape.members.map((m) =>
        m.shape.k === "prim" ? (m.shape as { type: string }).type : m.shape.k,
      );
      expect(kinds.sort()).toEqual(["number", "string"]);
    }
    expect(termToString(r.term!)).toBe("(A1 + 1)");
  });

  it("unconstrained any - * / % → number (JS ToNumber)", () => {
    const anyA = {
      shape: { k: "any" as const },
      term: v("A1"),
      conf: "path" as const,
    };
    const one = numLit(1);
    for (const [name, r] of [
      ["sub", sub(anyA, one)],
      ["mul", mul(anyA, one)],
      ["div", div(anyA, one)],
      ["mod", mod(anyA, one)],
    ] as const) {
      expect(r.shape, name).toEqual({ k: "prim", type: "number" });
      expect(r.term, name).toBeDefined();
    }
    expect(termToString(sub(anyA, one).term!)).toBe("(A1 - 1)");
  });

  it("x>0 + 1 ⇒ term>1", () => {
    const phi = gtNum(v("x"), 0);
    const r = add(numVar("x", gtNum(v("x"), 0)), numLit(1), phi);
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred!.op).toBe("gt");
  });

  it("x>2 + y>3 ⇒ (x+y)>5", () => {
    const phi = { op: "and" as const, args: [gtNum(v("x"), 2), gtNum(v("y"), 3)] };
    const r = add(
      numVar("x", gtNum(v("x"), 2)),
      numVar("y", gtNum(v("y"), 3)),
      phi,
    );
    expect(r.pred!.op).toBe("gt");
    if (r.pred!.op === "gt") {
      expect(r.pred!.b).toEqual(lit(5));
    }
  });

  it("x≥1 + 0 literal keeps ≥ via simplify to x", () => {
    const phi = geNum(v("x"), 1);
    const r = add(numVar("x", geNum(v("x"), 1)), numLit(0), phi);
    // x+0 simplifies to x
    expect(termToString(r.term!)).toBe("x");
  });

  it("literal 2+3 = 5 exact", () => {
    const r = add(numLit(2), numLit(3));
    expect(litValue(r)).toBe(5);
    expect(r.conf).toBe("exact");
  });
});

describe("sub / mul", () => {
  it("5-2 = 3", () => {
    expect(litValue(sub(numLit(5), numLit(2)))).toBe(3);
  });
  it("x>0 - 1 ⇒ (x-1)>-1? x>0 ⇒ x-1 > -1", () => {
    const phi = gtNum(v("x"), 0);
    const r = sub(numVar("x", gtNum(v("x"), 0)), numLit(1), phi);
    expect(r.term).toBeDefined();
    expect(r.pred!.op).toBe("gt");
    if (r.pred!.op === "gt") {
      expect(r.pred!.b).toEqual(lit(-1));
    }
  });
  it("3*4 = 12", () => {
    expect(litValue(mul(numLit(3), numLit(4)))).toBe(12);
  });
  it('JS ToNumber: "a"*2 → NaN, "3"*2 → 6, true*2 → 2', () => {
    expect(litValue(mul(strLit("a"), numLit(2)))).toBeNaN();
    expect(litValue(mul(strLit("3"), numLit(2)))).toBe(6);
    expect(litValue(mul(boolLit(true), numLit(2)))).toBe(2);
    expect(mul(strLit("a"), numLit(2)).shape).toEqual({
      k: "prim",
      type: "number",
    });
  });
  it('JS relational: "a">3 → false, "10"<9 → false, true>0 → true', () => {
    expect(litValue(cmp("gt", strLit("a"), numLit(3)))).toBe(false);
    expect(litValue(cmp("lt", strLit("10"), numLit(9)))).toBe(false);
    expect(litValue(cmp("gt", boolLit(true), numLit(0)))).toBe(true);
    expect(litValue(cmp("gt", strLit("hello"), numLit(3)))).toBe(false);
  });

  it("refineAbsForRelTrue: any > 3 → number>3 | string", () => {
    const anyA = { shape: { k: "any" as const }, term: v("A1"), conf: "path" as const };
    const r = refineAbsForRelTrue(anyA, "gt", 3);
    expect(r.shape.k).toBe("sum");
    if (r.shape.k !== "sum") return;
    const kinds = r.shape.members.map((m) =>
      m.shape.k === "prim" ? m.shape.type : m.shape.k,
    );
    expect(kinds.sort()).toEqual(["number", "string"]);
    const num = r.shape.members.find(
      (m) => m.shape.k === "prim" && m.shape.type === "number",
    )!;
    expect(num.pred?.op).toBe("gt");
  });

  it("x>0 * 2 ⇒ (x*2)>0", () => {
    const phi = gtNum(v("x"), 0);
    const r = mul(numVar("x", gtNum(v("x"), 0)), numLit(2), phi);
    expect(r.pred!.op).toBe("gt");
    if (r.pred!.op === "gt") {
      expect(r.pred!.b).toEqual(lit(0));
    }
  });
});

describe("implies", () => {
  it("x>0 ⊢ x>0", () => {
    expect(implies(gtNum(v("x"), 0), gtNum(v("x"), 0))).toBe(true);
  });
  it("x>0 ⊢ x≥0", () => {
    expect(implies(gtNum(v("x"), 0), geNum(v("x"), 0))).toBe(true);
  });
  it("x>0 ⊬ x>5", () => {
    expect(implies(gtNum(v("x"), 0), gtNum(v("x"), 5))).toBe(false);
  });
  it("x>5 ⊢ x>0", () => {
    expect(implies(gtNum(v("x"), 5), gtNum(v("x"), 0))).toBe(true);
  });
  it("x>0 ⊢ x+1>1", () => {
    const phi = gtNum(v("x"), 0);
    expect(implies(phi, gtNum(app("+", [v("x"), lit(1)]), 1))).toBe(true);
  });
  it("x>0 ⊬ x+1>2", () => {
    const phi = gtNum(v("x"), 0);
    expect(implies(phi, gtNum(app("+", [v("x"), lit(1)]), 2))).toBe(false);
  });
  it("De Morgan：x≤0 ∧ y≤0 ⊢ x≤0 ∨ y≤0", () => {
    const x = v("x");
    const y = v("y");
    expect(implies(and(leNum(x, 0), leNum(y, 0)), or(leNum(x, 0), leNum(y, 0)))).toBe(true);
    expect(implies(or(leNum(x, 0), leNum(y, 0)), leNum(x, 0))).toBe(false);
  });
});

describe("cmp under phi", () => {
  it("x>0, cmp(x, 0, >) → true", () => {
    const phi = gtNum(v("x"), 0);
    const r = cmp("gt", numVar("x"), numLit(0), phi);
    expect(litValue(r)).toBe(true);
  });
  it("1<3 → true", () => {
    expect(litValue(cmp("lt", numLit(1), numLit(3)))).toBe(true);
  });
});

describe("bound tightening: strict over non-strict at equal bound", () => {
  // le(x,5) ∧ lt(x,5) ≡ lt(x,5)。等值处 strict 必须胜出，否则顺序
  // 会影响结果：le 在前会把 lt 的 strict 吞掉，得到过弱的 x≤5。
  it("pred path: le then lt keeps strict (hi bound)", () => {
    const x = v("x");
    const r = add(numVar("x", and(leNum(x, 5), ltNum(x, 5))), numLit(0));
    expect(r.pred?.op).toBe("lt");
    if (r.pred?.op === "lt") expect(r.pred.b).toEqual(lit(5));
  });

  it("phi path: le then lt keeps strict (hi bound)", () => {
    const x = v("x");
    const r = add(numVar("x"), numLit(0), and(leNum(x, 5), ltNum(x, 5)));
    expect(r.pred?.op).toBe("lt");
    if (r.pred?.op === "lt") expect(r.pred.b).toEqual(lit(5));
  });

  it("phi path: ge then gt keeps strict (lo bound)", () => {
    const x = v("x");
    const r = add(numVar("x"), numLit(0), and(geNum(x, 5), gtNum(x, 5)));
    expect(r.pred?.op).toBe("gt");
    if (r.pred?.op === "gt") expect(r.pred.b).toEqual(lit(5));
  });
});

describe("add sum dispatch dedup", () => {
  it("does not collapse same-prim members with distinct terms", () => {
    // number(x) | number(y) + 1 → 两个不同 term 的 number，不能按 prim:number 去重塌缩
    const r = add(makeSum(numVar("x"), numVar("y")), numLit(1));
    expect(r.shape.k).toBe("sum");
    if (r.shape.k === "sum") expect(r.shape.members.length).toBe(2);
  });
});
