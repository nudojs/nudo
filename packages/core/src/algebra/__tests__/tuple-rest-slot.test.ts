/**
 * BUG-002（pattern: tuple-rest-slot-dropped）— core 内部各面的 rest 槽回归。
 *
 * tuple shape 的 `rest?: Abs`（abs.ts）在固定位被逐槽处理的每个面都必须被
 * 装进语义：此前 leq / widenForAssign / schema 投影整槽丢失（各自测试文件），
 * 本文件锁 core 内部三处同族点：
 * - widenForAssign（check-assign.ts）：tuple→arr 拓宽丢 rest 臂
 * - $copy（exec/runtime/containers.ts）：fork/switch 快照副本丢 rest
 * - $arrRest（exec/runtime/containers.ts）：`const [a, ...t]` 只切固定位前缀
 * - JSON.stringify 字面量折叠（builtins/json.ts）：rest 段折成缺尾前缀（假精确）
 */
import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, type Abs } from "../abs.ts";
import { litValue, runTranspiled, callTranspiledExportFull } from "../index.ts";
import { widenForAssign } from "../check-assign.ts";

const tup = (elements: Abs[], rest?: Abs): Abs =>
  abs({ k: "tuple", elements, ...(rest ? { rest } : {}) }, undefined, undefined, "exact");

describe("widenForAssign keeps tuple rest in element join (BUG-002)", () => {
  it("fixed elements + rest both join into widened array element", () => {
    // [1, ...string] 拓宽 → (number | string)[]，不得丢 string 臂
    const w = widenForAssign(tup([numLit(1)], str()));
    expect(w.shape.k).toBe("arr");
    if (w.shape.k !== "arr") return;
    expect(w.shape.element.shape.k).toBe("sum");
    const members = w.shape.element.shape.k === "sum" ? w.shape.element.shape.members : [];
    expect(members.map((m) => m.shape)).toEqual(
      expect.arrayContaining([num().shape, str().shape]),
    );
  });

  it("homogeneous fixed + rest stays the same element", () => {
    const w = widenForAssign(tup([numLit(1)], num()));
    if (w.shape.k !== "arr") throw new Error("expected arr");
    expect(w.shape.element.shape).toEqual(num().shape);
  });

  it("rest-only tuple still widens to rest element (unchanged path)", () => {
    const w = widenForAssign(tup([], str()));
    if (w.shape.k !== "arr") throw new Error("expected arr");
    expect(w.shape.element.shape).toEqual(str().shape);
  });

  it("empty tuple without rest widens to any element", () => {
    const w = widenForAssign(tup([]));
    if (w.shape.k !== "arr") throw new Error("expected arr");
    expect(w.shape.element.shape.k).toBe("any");
  });
});

describe("runtime rest slot survives copy / destructure (BUG-002)", () => {
  function call(src: string, arg: Abs) {
    const exports = runTranspiled(src, { mode: "analyze" });
    return callTranspiledExportFull(exports, "f", [arg] as never);
  }

  it("$copy snapshot keeps rest (arg round-trip through call)", () => {
    // 实参经调用边界拷贝；返回原值必须仍携带 rest 槽
    const r = call(`export function f(a) { return a; }`, tup([numLit(1)], str()));
    expect(r.result.shape.k).toBe("tuple");
    if (r.result.shape.k !== "tuple") return;
    expect(r.result.shape.elements).toHaveLength(1);
    expect(r.result.shape.rest?.shape).toEqual(str().shape);
  });

  it("$arrRest keeps source rest in the tail", () => {
    // const [a, ...t] = [1, 2, ...string] → t = [2, ...string]，不是 [2]
    const r = call(
      `export function f(a) { const [h, ...t] = a; return t; }`,
      tup([numLit(1), numLit(2)], str()),
    );
    expect(r.result.shape.k).toBe("tuple");
    if (r.result.shape.k !== "tuple") return;
    expect(r.result.shape.elements.map((e) => litValue(e))).toEqual([
      { ok: true, value: 2 },
    ]);
    expect(r.result.shape.rest?.shape).toEqual(str().shape);
  });

  it("$arrRest start at rest region degrades to rest element array", () => {
    // const [a, ...t] = [1, ...string] → t = string[]（固定位耗尽，尾段纯 rest）
    const r = call(
      `export function f(a) { const [h, ...t] = a; return t; }`,
      tup([numLit(1)], str()),
    );
    expect(r.result.shape.k).toBe("arr");
    if (r.result.shape.k !== "arr") return;
    expect(r.result.shape.element.shape).toEqual(str().shape);
  });

  it("$arrRest from rest-only prefix degrades to rest element array", () => {
    // const [a, b, ...t] = [1, ...number] → t = number[]（起点落在 rest 段）
    const r = call(
      `export function f(a) { const [x, y, ...t] = a; return t; }`,
      tup([numLit(1)], num()),
    );
    expect(r.result.shape.k).toBe("arr");
    if (r.result.shape.k !== "arr") return;
    expect(r.result.shape.element.shape).toEqual(num().shape);
  });

  it("JSON.stringify does not fold rest tuple to fixed prefix (BUG-002)", () => {
    // rest 段有 0..n 个未知元素：折叠成 exact "[1]" 是缺尾假精确 → 保守 partial
    const r = call(`export function f(a) { return JSON.stringify(a); }`, tup([numLit(1)], num()));
    const lv = litValue(r.result);
    expect(lv.ok && lv.value === "[1]").toBe(false);
    // 固定元组照常折叠
    const r2 = call(`export function f(a) { return JSON.stringify(a); }`, tup([numLit(1)]));
    expect(litValue(r2.result)).toEqual({ ok: true, value: "[1]" });
  });
});
