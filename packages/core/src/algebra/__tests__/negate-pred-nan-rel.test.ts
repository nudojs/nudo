/**
 * 关系比较的否定在 NaN 上不是全序对偶。
 * 回归背景：JS 里所有关系比较遇 NaN 皆 false，故 ¬(x<5) 为真时不能推出 x≥5
 * （x=NaN 时前者 true、后者 false）。negatePred 旧实现 lt→ge / le→gt /
 * gt→le / ge→lt，else 分支被钉成假事实，下游 cmp 在污染的 Φ 上折出 exact true。
 * eq→ne 是精确否定，不受影响。
 */
import { describe, it, expect } from "vitest";
import {
  negatePred,
  falseConstraint,
  cmp,
  numVar,
  numLit,
  lit,
  v,
  gt,
  ge,
  lt,
  le,
  and,
  formatAbs,
} from "../index.ts";

describe("negatePred on relations is not total-order duality", () => {
  it("¬(x<5) must not assert x≥5", () => {
    const n = negatePred(lt(v("x"), lit(5)));
    // 可以是 not(lt) 或 or(...) 形态，但不得是 ge
    expect(n.op === "ge").toBe(false);
    expect(n.op === "le" || n.op === "gt" || n.op === "lt").toBe(false);
  });

  it("¬(x≥5) must not assert x<5", () => {
    const n = negatePred(ge(v("x"), lit(5)));
    expect(n.op === "lt").toBe(false);
    expect(n.op === "le" || n.op === "gt" || n.op === "ge").toBe(false);
  });

  it("falseConstraint(x<5) must not imply x>=5 as exact", () => {
    const c = cmp("lt", numVar("x"), numLit(5));
    const fc = falseConstraint(c);
    expect(fc).toBeDefined();
    // 拿着该约束做 else 分支：x>=5 不得被折成 exact true
    const r = cmp("ge", numVar("x"), numLit(5), fc!);
    const isExactTrue = r.term?.op === "lit" && r.term.value === true;
    expect(isExactTrue).toBe(false);
  });

  it("else of (x<5) does not make (x>=5) exact true (NaN arm)", () => {
    // 模拟：if (x<5) ... else return x>=5
    const test = cmp("lt", numVar("x"), numLit(5));
    const fc = falseConstraint(test)!;
    const r = cmp("ge", numVar("x"), numLit(5), fc);
    expect(formatAbs(r)).not.toContain("#exact");
  });

  it("eq/ne duality is still exact", () => {
    const n = negatePred({ op: "eq", a: v("x"), b: lit(1) });
    expect(n.op).toBe("ne");
    const n2 = negatePred({ op: "ne", a: v("x"), b: lit(1) });
    expect(n2.op).toBe("eq");
  });
});
