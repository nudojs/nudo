import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
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
  type Abs,
} from "../index.ts";

/** B 路径驱动：runTranspiled + 导出调用（取代 analyzeFn 的求值面） */
function analyzeExport(src: string, fnName: string, args: Abs[]): Abs {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, args).result;
}

describe("HOF map/reduce from real source", () => {
  it("map doubles literals: [1,2,3].map(x=>x*2) → number[] with joined elem", () => {
    const src = `
      export function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    // 实参数组：arr(number)
    const arr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    const r = analyzeExport(src, "doubleAll", [arr]);
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
      export function incAll(xs) {
        return xs.map((x) => x + 1);
      }
    `;
    const r = analyzeExport(src, "incAll", [arr]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    const el = r.shape.element;
    expect(termToString(el.term!)).toBe("(e + 1)");
    expect(el.pred!.op).toBe("gt");
  });

  it("reduce sum of literals: [1,2,3].reduce((acc,n)=>acc+n,0) on arr(1) keeps numeric domain", () => {
    const src = `
      export function sum(xs) {
        return xs.reduce((acc, n) => acc + n, 0);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    const r = analyzeExport(src, "sum", [arr]);
    // 抽象长度 arr：join 字面量枚举或收成 number；不得丢成 never/unknown
    if (r.shape.k === "prim") {
      expect(r.shape.type).toBe("number");
    } else if (r.shape.k === "sum") {
      expect(r.shape.members.every((m) => m.shape.k === "prim")).toBe(true);
    } else {
      expect(["prim", "sum"]).toContain(r.shape.k);
    }
  });

  it("filter preserves element type", () => {
    const src = `
      export function keep(xs) {
        return xs.filter((x) => x > 0);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(5) }, undefined, undefined, "exact");
    const r = analyzeExport(src, "keep", [arr]);
    expect(r.shape.k).toBe("arr");
  });
});
