import { describe, it, expect } from "vitest";
import { dispatchSumArg, undefAbs } from "../hof.ts";
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

/** 求值引擎驱动：runTranspiled + 导出调用（取代 analyzeFn 的求值面） */
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
    expect(litValue(r.shape.element)).toEqual({ ok: true, value: 2 });
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

describe("dispatchSumArg（applyCallbackAbs 与 invokeArr callFn 共用）", () => {
  const sumOf = (members: Abs[]): Abs =>
    abs({ k: "sum", members }, undefined, undefined, "path");

  it("无 sum 实参 → handled:false，且不递归", () => {
    let calls = 0;
    const r = dispatchSumArg([numLit(1)], (next) => {
      calls++;
      return next[0]!;
    });
    expect(r.handled).toBe(false);
    expect(calls).toBe(0);
  });

  it("首个 sum 逐成员替换实参并递归，结果 joinAbs 左折", () => {
    const seen: Abs[] = [];
    const r = dispatchSumArg([numLit(0), sumOf([numLit(1), numLit(2)])], (next) => {
      seen.push(next[1]!);
      return next[1]!;
    });
    expect(r.handled).toBe(true);
    expect(seen.map((a) => litValue(a))).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
    expect(formatShape(r.result)).toBe("1 | 2");
  });

  it("只分发首个 sum 下标（其余 sum 原样传入）", () => {
    const first = sumOf([numLit(1)]);
    const second = sumOf([numLit(2), numLit(3)]);
    const seen: Abs[] = [];
    const r = dispatchSumArg([first, second], (next) => {
      seen.push(next[1]!);
      return next[1]!;
    });
    expect(seen).toEqual([second]);
    expect(r.result).toBe(second);
    expect(formatShape(r.result)).toBe("2 | 3");
  });

  it("空 sum → handled:true 且 unknown（无成员可递归）", () => {
    const empty = sumOf([]);
    const r = dispatchSumArg([empty], () => {
      throw new Error("空 sum 不得递归");
    });
    expect(r.handled).toBe(true);
    expect(r.result).toBe(unknown);
  });

  it("invokeArrMethod callFn 经同一 helper 对 sum 元素逐成员分发", () => {
    const src = `
      export function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    const elem = sumOf([numLit(1), numLit(2)]);
    const arr = abs({ k: "arr", element: elem }, undefined, undefined, "path");
    const r = analyzeExport(src, "doubleAll", [arr]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(formatShape(r.shape.element)).toBe("2 | 4");
  });
});

describe("undefAbs 单一实现（collections 与 hof 共用）", () => {
  it("pred 归一为 undefined（abs() 对 pTrue 的规范形态）", () => {
    const u = undefAbs();
    expect(u.shape).toEqual({ k: "unknown" });
    expect(u.term).toEqual({ op: "lit", value: undefined });
    expect(u.pred).toBeUndefined();
    expect(u.conf).toBe("exact");
  });
});
