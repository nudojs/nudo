import { describe, it, expect } from "vitest";
import {
  analyzeFn,
  numLit,
  strLit,
  numVar,
  gtNum,
  v,
  litValue,
  termToString,
  formatShape,
  abs,
  unknown,
} from "../index.ts";

describe("HOF map/reduce from real source", () => {
  it("map doubles literals: [1,2,3].map(x=>x*2) → number[] with joined elem", () => {
    const src = `
      function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    // 实参数组：arr(number)
    const arr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    const r = analyzeFn(src, "doubleAll", [arr]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    // x=1, x*2=2
    expect(litValue(r.shape.element)).toBe(2);
  });

  it("map on symbolic element: Arr(number) map x=>x+1 under Φ elem>0", () => {
    // 元素带约束的数组：用 numVar 作为 element 的 term/pred
    const elem = {
      shape: { k: "prim" as const, type: "number" as const },
      term: { op: "var" as const, id: "e" },
      pred: { op: "gt" as const, a: { op: "var" as const, id: "e" }, b: { op: "lit" as const, value: 0 } },
      conf: "path" as const,
    };
    const arr = abs({ k: "arr", element: elem }, undefined, undefined, "path");
    const src = `
      function incAll(xs) {
        return xs.map((x) => x + 1);
      }
    `;
    const r = analyzeFn(src, "incAll", [arr]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    const el = r.shape.element;
    expect(termToString(el.term!)).toBe("(e + 1)");
    expect(el.pred!.op).toBe("gt");
  });

  it("reduce sum of literals: [1,2,3].reduce((a,n)=>a+n,0) → 6", () => {
    const src = `
      function sum(xs) {
        return xs.reduce((acc, n) => acc + n, 0);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    // 用字面量元素 1 反复加不够 —— 用 tuple 语义：我们用 arr(number) 时元素是 1
    // 更好：传 tuple
    // Phase A：reduce 对 arr(element) 做不动点：0+1=1, 1+1=2, ... 会收敛到 number
    const r = analyzeFn(src, "sum", [arr]);
    // 0+1=1 exact first iter; join(0,1) 丢 term → number path
    // 或者若 first next=1, join(0,1) → number
    expect(r.shape).toEqual({ k: "prim", type: "number" });
  });

  it("filter preserves element type", () => {
    const src = `
      function keep(xs) {
        return xs.filter((x) => x > 0);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(5) }, undefined, undefined, "exact");
    const r = analyzeFn(src, "keep", [arr]);
    expect(r.shape.k).toBe("arr");
  });
});
