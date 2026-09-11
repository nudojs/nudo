import { describe, it, expect } from "vitest";
import {
  analyzeFn,
  numLit,
  numVar,
  gtNum,
  geNum,
  v,
  lit,
  termToString,
  predToString,
  litValue,
  leakIfNeeded,
  maybeLeak,
  exceedsBudget,
  termDepth,
  termNodes,
  app,
  resetLeakCounter,
  mul,
  add,
} from "../index.ts";

describe("AST eval: source → Abs", () => {
  it("add(1,3) from real source → 4", () => {
    const src = `
      const add = (a, b) => a + b;
      function main() { return add(1, 3); }
    `;
    const r = analyzeFn(src, "main", []);
    expect(litValue(r)).toBe(4);
    expect(r.conf).toBe("exact");
  });

  it("scale(x) = add(x,1) under x>0 ⇒ (x+1)>1", () => {
    const src = `
      const add = (a, b) => a + b;
      function scale(x) { return add(x, 1); }
    `;
    const phi = gtNum(v("x"), 0);
    const r = analyzeFn(src, "scale", [numVar("x", gtNum(v("x"), 0))], phi);
    expect(r.term).toBeDefined();
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred!.op).toBe("gt");
    if (r.pred!.op === "gt") {
      expect(r.pred!.b).toEqual(lit(1));
    }
  });

  it("twice(x) nested add under x>0 ⇒ >2", () => {
    const src = `
      const add = (a, b) => a + b;
      function twice(x) {
        const c = add(x, 1);
        return add(c, 1);
      }
    `;
    const phi = gtNum(v("x"), 0);
    const r = analyzeFn(src, "twice", [numVar("x", gtNum(v("x"), 0))], phi);
    expect(r.term).toBeDefined();
    expect(r.pred).toBeDefined();
    // ((x+1)+1) > 2 或 (x+2) > 2
    const ps = predToString(r.pred!);
    expect(ps).toContain("2");
  });

  it("if (x > 5) return x; return 0  with x>10 ⇒ x", () => {
    const src = `
      function pick(x) {
        if (x > 5) return x;
        return 0;
      }
    `;
    const phi = gtNum(v("x"), 10);
    const r = analyzeFn(src, "pick", [numVar("x", gtNum(v("x"), 10))], phi);
    // true 分支返回 x（term=x），false 分支 0；join 后丢 term
    // 但 true 分支在 Φ 下 x>5 成立，我们至少得到 number
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("if (x > 0) return x + 1; return 0  with Φ x>0 ⇒ true branch", () => {
    const src = `
      function addOneIfPositive(x) {
        if (x > 0) return x + 1;
        return 0;
      }
    `;
    const phi = gtNum(v("x"), 0);
    const r = analyzeFn(src, "addOneIfPositive", [numVar("x", gtNum(v("x"), 0))], phi);
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred!.op).toBe("gt");
  });

  it("literal only function", () => {
    const src = `
      function f() { return 1 + 2 * 3; }
    `;
    // 注意：JS 里 1+2*3 = 7，我们的 BinaryExpression 是左结合遍历
    // Babel AST: (1 + (2 * 3)) —— 乘法优先，AST 已带优先级
    const r = analyzeFn(src, "f", []);
    expect(litValue(r)).toBe(7);
  });

  it("string concat from source", () => {
    const src = `
      function greet(name) { return "hi, " + name; }
    `;
    const r = analyzeFn(src, "greet", [numLit(1)]);
    // number + string 在 JS 里是字符串，我们 isStrPrim 一侧即可
    // 实参是 number，左侧是 string → 走 string 拼接
    expect(r.shape).toEqual({ k: "prim", type: "string" });
  });
});

describe("leak", () => {
  it("small term does not leak", () => {
    resetLeakCounter();
    const t = app("+", [v("x"), lit(1)]);
    expect(exceedsBudget(t)).toBe(false);
    const a = add(numVar("x"), numLit(1));
    const leaked = leakIfNeeded(a);
    expect(leaked.term).toEqual(a.term);
  });

  it("deep term leaks to fresh var + eq", () => {
    resetLeakCounter();
    let t = v("x");
    for (let i = 0; i < 10; i++) {
      t = app("+", [t, lit(1)]);
    }
    expect(termDepth(t)).toBeGreaterThan(6);
    expect(exceedsBudget(t)).toBe(true);

    const a = { shape: { k: "prim" as const, type: "number" as const }, term: t, conf: "path" as const };
    const leaked = maybeLeak(a, { maxDepth: 4, maxNodes: 20 }, "acc");
    expect(leaked.term?.op).toBe("var");
    if (leaked.term?.op === "var") {
      expect(leaked.term.id.startsWith("acc$")).toBe(true);
    }
    expect(leaked.pred?.op).toBe("eq");
  });
});

describe("mul negative flips bounds", () => {
  it("x>0 * -2 ⇒ (x*-2) < 0", () => {
    const phi = gtNum(v("x"), 0);
    const r = mul(numVar("x", gtNum(v("x"), 0)), numLit(-2), phi);
    expect(r.pred).toBeDefined();
    expect(r.pred!.op).toBe("lt");
    if (r.pred!.op === "lt") {
      expect(r.pred!.b).toEqual(lit(0));
    }
  });
});
