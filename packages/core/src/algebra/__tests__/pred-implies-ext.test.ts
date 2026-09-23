import { describe, it, expect, afterEach } from "vitest";
import {
  implies,
  and,
  or,
  gt,
  ge,
  lt,
  le,
  eq,
  ne,
  setImplicationOracle,
} from "../pred.ts";
import { lit, v, app } from "../term.ts";

const x = v("x");
const y = v("y");
const z = v("z");

afterEach(() => setImplicationOracle(undefined));

describe("D2 and-goal decomposition", () => {
  it("x>0 ∧ x<10 ⊢ x>0 ∧ x<10（交换序）", () => {
    const phi = and(gt(x, lit(0)), lt(x, lit(10)));
    const goal = and(lt(x, lit(10)), gt(x, lit(0)));
    expect(implies(phi, goal)).toBe(true);
  });

  it("x>0 ∧ x<10 ⊬ x>0 ∧ x<5", () => {
    const phi = and(gt(x, lit(0)), lt(x, lit(10)));
    const goal = and(gt(x, lit(0)), lt(x, lit(5)));
    expect(implies(phi, goal)).toBe(false);
  });
});

describe("D2 equality class", () => {
  it("x=y ∧ y>0 ⊢ x>0", () => {
    const phi = and(eq(x, y), gt(y, lit(0)));
    expect(implies(phi, gt(x, lit(0)))).toBe(true);
  });

  it("x=y ∧ x>5 ⊢ y>5", () => {
    const phi = and(eq(x, y), gt(x, lit(5)));
    expect(implies(phi, gt(y, lit(5)))).toBe(true);
  });

  it("x=y ∧ y>0 ⊬ x>5", () => {
    const phi = and(eq(x, y), gt(y, lit(0)));
    expect(implies(phi, gt(x, lit(5)))).toBe(false);
  });
});

describe("D2 disequality tightens bounds", () => {
  it("x≥5 ∧ x≠5 ⊢ x>5", () => {
    const phi = and(ge(x, lit(5)), ne(x, lit(5)));
    expect(implies(phi, gt(x, lit(5)))).toBe(true);
  });

  it("x≤5 ∧ x≠5 ⊢ x<5", () => {
    const phi = and(le(x, lit(5)), ne(x, lit(5)));
    expect(implies(phi, lt(x, lit(5)))).toBe(true);
  });

  it("x≥5 ∧ x≠5 ⊬ x>6", () => {
    const phi = and(ge(x, lit(5)), ne(x, lit(5)));
    expect(implies(phi, gt(x, lit(6)))).toBe(false);
  });
});

describe("D2 cross-term / affine", () => {
  it("x>5 ∧ y<3 ⊢ x>y", () => {
    const phi = and(gt(x, lit(5)), lt(y, lit(3)));
    expect(implies(phi, gt(x, y))).toBe(true);
  });

  it("x>0 ∧ y>0 ⊢ x+y>0", () => {
    const phi = and(gt(x, lit(0)), gt(y, lit(0)));
    expect(implies(phi, gt(app("+", [x, y]), lit(0)))).toBe(true);
  });

  it("x≥1 ∧ y≥1 ⊢ x+y>1", () => {
    const phi = and(ge(x, lit(1)), ge(y, lit(1)));
    expect(implies(phi, gt(app("+", [x, y]), lit(1)))).toBe(true);
  });

  it("x>0 ∧ y>0 ⊬ x+y>1", () => {
    const phi = and(gt(x, lit(0)), gt(y, lit(0)));
    expect(implies(phi, gt(app("+", [x, y]), lit(1)))).toBe(false);
  });

  it("x≥5 ∧ y≤2 ⊢ x-y≥3", () => {
    const phi = and(ge(x, lit(5)), le(y, lit(2)));
    expect(implies(phi, ge(app("-", [x, y]), lit(3)))).toBe(true);
  });

  it("x≥5 ∧ y≤2 ⊬ x>y∧z（无关 z）", () => {
    const phi = and(ge(x, lit(5)), le(y, lit(2)));
    expect(implies(phi, gt(x, z))).toBe(false);
  });

  it("2*x>4 ⇐ x>2 的系数归一", () => {
    const phi = gt(x, lit(2));
    expect(implies(phi, gt(app("*", [lit(2), x]), lit(4)))).toBe(true);
  });
});

describe("D2 length atoms", () => {
  const s = v("s");
  const lenS = app("length", [s]);
  it("length(s)≥1 ⊢ length(s)≥1（结构）", () => {
    expect(implies(ge(lenS, lit(1)), ge(lenS, lit(1)))).toBe(true);
  });
  it("length(s)≥2 ⊢ length(s)≥1", () => {
    expect(implies(ge(lenS, lit(2)), ge(lenS, lit(1)))).toBe(true);
  });
  it("length(s)≥1 ⊬ length(s)≥2", () => {
    expect(implies(ge(lenS, lit(1)), ge(lenS, lit(2)))).toBe(false);
  });
});

describe("D2 optional SMT oracle", () => {
  it("内建证不出时调用 oracle；oracle true 则蕴含成立", () => {
    const phi = gt(x, lit(0));
    // x*y>0 非线性，内建证不出
    const goal = gt(app("*", [x, y]), lit(0));
    expect(implies(phi, goal)).toBe(false);
    setImplicationOracle(() => true);
    expect(implies(phi, goal)).toBe(true);
  });

  it("oracle false 不抬升", () => {
    const phi = gt(x, lit(0));
    const goal = gt(x, lit(5));
    setImplicationOracle(() => false);
    expect(implies(phi, goal)).toBe(false);
  });

  it("内建已可证时不依赖 oracle", () => {
    const phi = gt(x, lit(5));
    const goal = gt(x, lit(0));
    setImplicationOracle(() => false);
    expect(implies(phi, goal)).toBe(true);
  });
});

describe("D2 soundness guards", () => {
  it("x>0 ⊬ x>5", () => {
    expect(implies(gt(x, lit(0)), gt(x, lit(5)))).toBe(false);
  });
  it("x>5 ∧ y<3 ⊬ y>x", () => {
    const phi = and(gt(x, lit(5)), lt(y, lit(3)));
    expect(implies(phi, gt(y, x))).toBe(false);
  });
  it("x≥5 ⊬ x>5（非严格下界）", () => {
    expect(implies(ge(x, lit(5)), gt(x, lit(5)))).toBe(false);
  });
  it("or 目标仍要求存在一支", () => {
    const phi = gt(x, lit(5));
    expect(implies(phi, or(gt(x, lit(0)), gt(y, lit(0))))).toBe(true);
    expect(implies(phi, or(gt(x, lit(10)), gt(y, lit(0))))).toBe(false);
  });
});
