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
import { nextDown } from "../pred.ts";

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
    expect(litValue(r)).toEqual({ ok: true, value: 4 });
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
      // Bug A（IEEE strict 端点校准）：原断言 lit(1) 是假 strict 界——
      // x=5e-324 时 fl(x+1) === 1（吸收），不 > 1；端点退一步
      // （gt(nextDown(1)) ⟺ ge(1)，离散语义等价且 sound）。
      expect(termToString(r.pred!.a)).toBe("(x + 1)");
      expect(r.pred!.b).toEqual(lit(nextDown(1)));
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
      // Bug A：两次吸收链同理——x=5e-324 时 fl(fl(x+1)+1) === 2，不 > 2
      expect(r.pred!.b).toEqual(lit(nextDown(2)));
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
  it("x>0 ⊬ x+1 > 1（IEEE 吸收：x = MIN_VALUE 时 fl(x+1) === 1）", () => {
    // 重钉（BUG-200，parent 授权）：旧断言 `{ ok: true, value: true }` 是**假事实**
    // ——它正是 cmp.ts「implies(phi, pred) ⇒ boolLit(true)」这条**造值点**。
    // 原生反例：x = Number.MIN_VALUE 时 x > 0 真、fl(x+1) === 1 ⇒ x+1 > 1 假。
    // 依据 BUG-200 section:14-16,27,30（`x>0 ⊢ x+1>1` 是假证）。
    expect(Number.MIN_VALUE > 0).toBe(true);
    expect(Number.MIN_VALUE + 1).toBe(1);
    const phi = gtNum(v("x"), 0);
    const x = numVar("x", gtNum(v("x"), 0));
    const sum = add(x, numLit(1), phi);
    // Φ 不决定该比较（x = MIN_VALUE ⇒ false；x = 1 ⇒ true）⇒ 不可折成字面量。
    // 这不是「实现退化为不可判定」：两个见证在 Φ 下都合法，故诚实的答案是
    // 不可判定；把 `{ ok: false }` 换成 `{ ok: true, value: false }` 反而是造值。
    expect(litValue(cmp("gt", sum, numLit(1), phi))).toEqual({ ok: false });
    // 恒真的是 ge 变体（section:18：`x>0 ⇒ x+1 >= 1` 在 IEEE 下恒成立）。
    expect(litValue(cmp("ge", sum, numLit(1), phi))).toEqual({ ok: true, value: true });
    // `x+1 < 1` 由 ge 恒真排除 ⇒ 可判定为 false（保留「确定 false 可判定」口径）。
    expect(litValue(cmp("lt", sum, numLit(1), phi))).toEqual({ ok: true, value: false });
  });

  it("string concat keeps string shape", () => {
    const r = add(strLit("a"), strLit("b"));
    expect(litValue(r)).toEqual({ ok: true, value: "ab" });
    expect(r.shape).toEqual({ k: "prim", type: "string" });
  });
});
