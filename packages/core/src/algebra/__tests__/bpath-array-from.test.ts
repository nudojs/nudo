/**
 * B 路径 Array.from：此前 evalArrayStatic 的 from 分支只取可迭代物元素类型、
 * **完全忽略 mapFn 实参**——回调副作用静默丢失（`Array.from([1,2,3], cb); t`
 * 折 0），带 mapFn 的结果也不传播回调输出。修复：mapFn 逐位应用 (el, i)，
 * 数组 hole 位置按迭代器语义 yield undefined（实槽）、字符串按 code point、
 * Set/Map 走条目表、array-like 按 length 槽逐位调（元素 undefined）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path Array.from mapFn", () => {
  it("invokes mapFn once per tuple element with index", () => {
    const r = call(`export function f() { let t = 0; Array.from([1,2,3], (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
    const r2 = call(`export function f() { let t = 0; Array.from([1,2,3], (x, i) => { t += i; return x; }); return t; }`);
    expect(litValue(r2.result)).toBe(3);
  });

  it("visits holes as undefined (iterator Get semantics)", () => {
    const r = call(`export function f() { let t = 0; Array.from([1,,3], (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
    const r2 = call(`export function f() { let t = 0; Array.from([1,,3], (x, i) => { if (x === undefined) t += i; return x; }); return t; }`);
    expect(litValue(r2.result)).toBe(1);
  });

  it("string source iterates code points", () => {
    const r = call(`export function f() { let t = 0; Array.from("ab", (c) => { t++; return c; }); return t; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { let t = 0; Array.from("𠮷", (c) => { t++; return c; }); return t; }`);
    expect(litValue(r2.result)).toBe(1);
  });

  it("Set/Map source invokes mapFn per entry", () => {
    const r = call(`export function f() { let t = 0; Array.from(new Set([1,2,3]), (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
    const r2 = call(`export function f() { let t = 0; Array.from(new Map([["a",1],["b",2]]), (e) => { t++; return e; }); return t; }`);
    expect(litValue(r2.result)).toBe(2);
  });

  it("array-like length source invokes mapFn with undefined elements", () => {
    const r = call(`export function f() { let t = 0; Array.from({length: 3}, (x, i) => { t += i; return x; }); return t; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("without mapFn tuple keeps element union (regression)", () => {
    const r = call(`export function f() { const a = Array.from([1,2,3]); return a.length; }`);
    // 无 mapFn 时结果保持 arr 元素联合（非具体长度），不得假精确
    expect(litValue(r.result)).toBeUndefined();
  });

  it("regression: Array.from of empty tuple stays abstract", () => {
    const r = call(`export function f() { let t = 0; Array.from([], (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toBe(0);
  });
});
