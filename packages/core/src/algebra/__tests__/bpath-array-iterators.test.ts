/**
 * 数组 keys()/values()/entries() 未建模：
 * - 表达式值折 unknown，for-of 消费 unknown iterable 时按 maxIters（默认 8、
 *   差分 harness 2000）展开「单代表元素」，每次迭代索引不同导致大数组反复
 *   join/深拷贝——分析含 for (const k of a.keys()) 的文件卡死数十秒；
 * - 有界 tuple 上 keys/values/entries 应建模为产出序列（迭代器建模既有近似），
 *   for-of 精确展开。
 * 修复：invokeArrMethod 建模 keys（索引字符串序列）/values（元素序列）/
 * entries（[i, x] 元组序列）；$forOf 对长度未知的迭代只跑一次代表迭代
 * （索引传未知 number），0 次出口 join 保持 sound。
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
  it("keys() yields index strings", () => {
    expect(tupleLits(call(`export function f() { return [...[1,2,3].keys()]; }`).result)).toEqual(["0", "1", "2"]);
  });

  it("values() yields elements", () => {
    expect(tupleLits(call(`export function f() { return [...[1,2,3].values()]; }`).result)).toEqual([1, 2, 3]);
  });

  it("entries() yields [index, value] pairs", () => {
    const r = call(`export function f() { return [...[7,8].entries()]; }`).result;
    expect(tupleLits(r)).toEqual([
      ["0", 7],
      ["1", 8],
    ]);
  });

  it("for-of over keys() accumulates exactly", () => {
    const r = call(`export function f() { let out=[]; for (const k of [1,2,3].keys()) { out.push(k); } return out; }`);
    expect(tupleLits(r.result)).toEqual(["0", "1", "2"]);
  });

  it("for-of over entries() destructures pairs", () => {
    const r = call(`export function f() { let out=[]; for (const [i,x] of [1,2,3].entries()) { out.push([i, x]); } return out; }`);
    expect(tupleLits(r.result)).toEqual([
      ["0", 1],
      ["1", 2],
      ["2", 3],
    ]);
  });

  it("abstract array keys() stays conservative (single rep iteration)", () => {
    // 参数抽象：长度未知——结果不得假精确（0 次出口 join）
    const r = call(`export function f(a) { let out=[]; for (const k of a.keys()) { out.push(k); } return out; }`);
    expect(tupleLits(r.result)).toBeUndefined();
  });
});
