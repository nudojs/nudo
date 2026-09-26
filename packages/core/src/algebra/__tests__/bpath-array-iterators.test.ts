/**
 * 数组 keys()/values()/entries() 迭代器建模。
 * 回归背景：初始建模（索引字符串序列、跳过 hole）与原生数组迭代器语义不符——
 * 原生产出 number 下标且**不跳过 hole**（keys 覆盖 0..length-1 全下标；
 * values/entries 对 hole 按 Get 语义产出 undefined）。两条假精确差分：
 * [...[1,,3].keys()] 折 ["0","2"]（原生 [0,1,2]）、
 * [...[1,,3].values()].length 折 2（原生 3）。
 * 修复：invokeArrMethod 三方法按原生迭代器语义建模——keys 下标 number、
 * 不滤 hole；values/entries 对 hole 位产出 undefined；非 tuple（长度未知）
 * 走未知 number 下标（arr element 保守）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function tupleLits(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (a?.shape?.k !== "tuple" || !a.shape.elements) return undefined;
  const els = a.shape.elements.map((e) => {
    const lv = litValue(e as never);
    if (lv !== undefined) return lv;
    return tupleLits(e); // 嵌套 entry 元组
  });
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

describe("B-path array keys/values/entries", () => {
  it("keys() yields numeric indices", () => {
    expect(tupleLits(call(`export function f() { return [...[1,2,3].keys()]; }`).result)).toEqual([0, 1, 2]);
  });

  it("keys() covers hole indices (native iterator does not skip holes)", () => {
    expect(tupleLits(call(`export function f() { return [...[1,,3].keys()]; }`).result)).toEqual([0, 1, 2]);
    expect(tupleLits(call(`export function f() { return [...new Array(3).keys()]; }`).result)).toEqual([0, 1, 2]);
  });

  it("values() yields elements", () => {
    expect(tupleLits(call(`export function f() { return [...[1,2,3].values()]; }`).result)).toEqual([1, 2, 3]);
  });

  it("values() yields undefined at holes (Get semantics)", () => {
    expect(litValue(call(`export function f() { return [...[1,,3].values()].length; }`).result)).toBe(3);
    expect(
      litValue(call(`export function f() { let c = 0; for (const v of [1,,3].values()) { c++; } return c; }`).result),
    ).toBe(3);
    expect(
      litValue(call(`export function f() { return [...[1,,3].values()][1] === undefined; }`).result),
    ).toBe(true);
  });

  it("entries() yields numeric [index, value] pairs", () => {
    const r = call(`export function f() { return [...[7,8].entries()]; }`).result;
    expect(tupleLits(r)).toEqual([
      [0, 7],
      [1, 8],
    ]);
  });

  it("entries() does not skip holes (value is undefined)", () => {
    expect(
      litValue(call(`export function f() { return [...[1,,3].entries()][1][0]; }`).result),
    ).toBe(1);
    expect(
      litValue(call(`export function f() { return [...[1,,3].entries()][1][1] === undefined; }`).result),
    ).toBe(true);
    expect(
      litValue(call(`export function f() { return [...new Array(3).entries()].length; }`).result),
    ).toBe(3);
  });

  it("for-of over keys() accumulates exactly", () => {
    const r = call(`export function f() { let out=[]; for (const k of [1,2,3].keys()) { out.push(k); } return out; }`);
    expect(tupleLits(r.result)).toEqual([0, 1, 2]);
  });

  it("for-of over entries() destructures pairs", () => {
    const r = call(`export function f() { let out=[]; for (const [i,x] of [1,2,3].entries()) { out.push([i, x]); } return out; }`);
    expect(tupleLits(r.result)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("abstract array keys() stays conservative (single rep iteration)", () => {
    // 参数抽象：长度未知——结果不得假精确（0 次出口 join）
    const r = call(`export function f(a) { let out=[]; for (const k of a.keys()) { out.push(k); } return out; }`);
    expect(tupleLits(r.result)).toBeUndefined();
  });
});
