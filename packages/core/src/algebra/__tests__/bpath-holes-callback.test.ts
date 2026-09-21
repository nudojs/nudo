/**
 * B 路径数组回调方法求值语义：
 * 1. map/flatMap/forEach/filter/reduce/reduceRight 对 hole 槽位**跳过回调**
 *    （原生 HasProperty 检查），map 输出保留 hole 位置；
 * 2. some/every/find/findIndex 不检查 HasProperty：hole 位置回调收到
 *    undefined（原生 Get 语义）；
 * 3. 回调必须收到索引实参 (el, i)；
 * 4. some/every/find/findIndex 按回调结果**短路**（命中即停，副作用计数精确）；
 * 5. filter 逐位调用谓词（此前 B-path 降 arr 不调回调，副作用假精确 t=0）；
 * 6. findIndex 未命中折 -1（原生语义），此前无 handler 落 unknown。
 * 此前实现把 hole 位置的 $lit(undefined) 当实元素逐位调用回调：
 * `[1,,3].map(x=>7)` 折 [7,7,7]（原生 [7,,7]）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path array callback methods: hole skipping", () => {
  it("map skips the hole callback and keeps the hole position", () => {
    const r = call(`export function f() { const a = [1,,3].map(x => 7); return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3].map(x => 7); return a[0]; }`);
    expect(litValue(r2.result)).toBe(7);
    const r3 = call(`export function f() { const a = [1,,3].map(x => 7); return a[2]; }`);
    expect(litValue(r3.result)).toBe(7);
    const r4 = call(`export function f() { const a = [1,,3].map(x => 7); return a.length; }`);
    expect(litValue(r4.result)).toBe(3);
  });

  it("forEach invokes the callback once per present element", () => {
    const r = call(`export function f() { let t = 0; [1,,3].forEach((x) => { t++; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
  });

  it("reduce skips holes in the accumulator fold", () => {
    const r = call(`export function f() { let t = 0; [1,,3].reduce((a, b) => { t++; return a; }, 0); return t; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { return [1,,3].reduce((a, b) => a + b, 0); }`);
    expect(litValue(r2.result)).toBe(4);
  });

  it("reduceRight skips holes", () => {
    const r = call(`export function f() { let t = 0; [1,,3].reduceRight((a, b) => { t++; return a; }, 0); return t; }`);
    expect(litValue(r.result)).toBe(2);
  });

  it("some/every skip holes (HasProperty check)", () => {
    const r = call(`export function f() { return [1,,3].some((x) => x === undefined); }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { let t = 0; [1,,3].some((x) => { t++; return false; }); return t; }`);
    expect(litValue(r2.result)).toBe(2);
    const r3 = call(`export function f() { return [1,,3].every((x) => x !== undefined); }`);
    expect(litValue(r3.result)).toBe(true);
    const r4 = call(`export function f() { let t = 0; [1,,3].every((x) => { t++; return typeof x === "number"; }); return t; }`);
    expect(litValue(r4.result)).toBe(2);
  });

  it("find/findIndex visit holes as undefined (Get, no HasProperty check)", () => {
    const r = call(`export function f() { let t = 0; [,2,3].find((x) => { t++; return false; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
    const r2 = call(`export function f() { let t = 0; [,2,3].findIndex((x) => { t++; return false; }); return t; }`);
    expect(litValue(r2.result)).toBe(3);
    const r3 = call(`export function f() { return [1,,3].findIndex((x) => x === undefined); }`);
    expect(litValue(r3.result)).toBe(1);
  });

  it("flatMap skips the hole callback", () => {
    const r = call(`export function f() { let t = 0; [1,,3].flatMap((x) => { t++; return [x]; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
  });

  it("filter skips the hole predicate and drops the hole from the result", () => {
    const r = call(`export function f() { const a = [1,,3].filter((x) => true); return a.length; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { const a = [1,,3].filter((x) => true); return a[1]; }`);
    expect(litValue(r2.result)).toBe(3);
  });

  it("regression: dense arrays still invoke per element", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].forEach((x) => { t++; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("regression: empty literal maps to empty", () => {
    const r = call(`export function f() { return [].map((x) => x).length; }`);
    expect(litValue(r.result)).toBe(0);
  });
});

describe("B-path array callback methods: index argument", () => {
  it("map/forEach pass the element index", () => {
    const r = call(`export function f() { const a = [1,,3].map((x, i) => i); return a[0]; }`);
    expect(litValue(r.result)).toBe(0);
    const r2 = call(`export function f() { const a = [1,,3].map((x, i) => i); return a[2]; }`);
    expect(litValue(r2.result)).toBe(2);
    const r3 = call(`export function f() { let t = 0; [1,2,3].forEach((x, i) => { t += i; }); return t; }`);
    expect(litValue(r3.result)).toBe(3);
  });

  it("reduce passes the element index", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].reduce((a, b, i) => { t += i; return a; }, 0); return t; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("reduceRight passes the reversed index", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].reduceRight((a, b, i) => { t += i; return a; }, 0); return t; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("filter predicate receives the index", () => {
    const r = call(`export function f() { const a = [1,2,3].filter((x, i) => i > 0); return a.length; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { const a = [1,2,3].filter((x, i) => i > 0); return a[0]; }`);
    expect(litValue(r2.result)).toBe(2);
  });

  it("find receives the index", () => {
    const r = call(`export function f() { return [1,2,3].find((x, i) => i === 1); }`);
    expect(litValue(r.result)).toBe(2);
  });

  it("flatMap receives the index", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].flatMap((x, i) => { t += i; return [x]; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
  });
});

describe("B-path array callback methods: short-circuit", () => {
  it("some stops at the first truthy callback result", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].some((x) => { t++; return x === 2; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { return [1,2,3].some((x) => x === 2); }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { return [1,2,3].some((x) => x === 9); }`);
    expect(litValue(r3.result)).toBe(false);
  });

  it("every stops at the first falsy callback result", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].every((x) => { t++; return x < 2; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { return [1,2,3].every((x) => x > 0); }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { return [1,2,3].every((x) => x > 2); }`);
    expect(litValue(r3.result)).toBe(false);
  });

  it("find stops at the first truthy callback result and returns the element", () => {
    const r = call(`export function f() { let t = 0; const v = [1,2,3].find((x) => { t++; return x === 2; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { return [1,2,3].find((x) => x === 2); }`);
    expect(litValue(r2.result)).toBe(2);
    const r3 = call(`export function f() { return [1,2,3].find((x) => x === 9); }`);
    expect(litValue(r3.result)).toBe(undefined);
  });

  it("findIndex stops at the first truthy result; -1 on miss", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].findIndex((x) => { t++; return x === 2; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { return [1,2,3].findIndex((x) => x === 2); }`);
    expect(litValue(r2.result)).toBe(1);
    const r3 = call(`export function f() { return [1,2,3].findIndex((x) => x === 9); }`);
    expect(litValue(r3.result)).toBe(-1);
    const r4 = call(`export function f() { return [1,,3].findIndex((x) => x === 3); }`);
    expect(litValue(r4.result)).toBe(2);
  });

  it("filter invokes the predicate for every element (no short-circuit)", () => {
    const r = call(`export function f() { let t = 0; [1,2,3].filter((x) => { t++; return x > 1; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
  });
});
