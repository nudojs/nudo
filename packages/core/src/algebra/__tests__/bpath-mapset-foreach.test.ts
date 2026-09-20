/**
 * B 路径 Map/Set 建模缺口：
 * - forEach 未建模：typeof m.forEach 折 undefined、回调零次调用；
 * - Symbol.iterator 属性读取 undefined（for-of 展开虽已工作，属性访问缺失）；
 * - Set 侧表用 === 比较（SameValue 非 SameValueZero）：NaN 键 has miss、
 *   add 不去重、delete 删不掉。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path Map/Set forEach and iteration", () => {
  it("typeof m.forEach is function", () => {
    const r = call(`export function f() { const m = new Map([["a", 1]]); return typeof m.forEach; }`);
    expect(litValue(r.result)).toBe("function");
  });

  it("Map forEach visits every literal entry", () => {
    const r = call(
      `export function f() { const m = new Map([["a", 1], ["b", 2]]); let s = 0; m.forEach((v) => s += v); return s; }`,
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("Map forEach passes key as second arg", () => {
    const r = call(
      `export function f() { const m = new Map([["a", 1], ["b", 2]]); let s = 0; m.forEach((v, k) => s += k.length); return s; }`,
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("Map forEach returns undefined", () => {
    const r = call(`export function f() { const m = new Map([["a", 1]]); return m.forEach(() => 1); }`);
    expect(formatShape(r.result)).toBe("undefined");
  });

  it("Map forEach on empty map iterates zero times", () => {
    const r = call(`export function f() { const m = new Map(); let n = 0; m.forEach(() => n++); return n; }`);
    expect(litValue(r.result)).toBe(0);
  });

  it("typeof m[Symbol.iterator] is function", () => {
    const r = call(
      `export function f() { const m = new Map([["a", 1]]); return typeof m[Symbol.iterator]; }`,
    );
    expect(litValue(r.result)).toBe("function");
  });

  it("Set forEach visits every element", () => {
    const r = call(
      `export function f() { const s = new Set([1, 2, 3]); let a = 0; s.forEach((v) => a += v); return a; }`,
    );
    expect(litValue(r.result)).toBe(6);
  });

  it("typeof s.forEach and s[Symbol.iterator] are function", () => {
    const r = call(`export function f() { const s = new Set([1, 2]); return typeof s.forEach; }`);
    expect(litValue(r.result)).toBe("function");
    const r2 = call(
      `export function f() { const s = new Set([1, 2]); return typeof s[Symbol.iterator]; }`,
    );
    expect(litValue(r2.result)).toBe("function");
  });

  it("Set has NaN matches SameValueZero", () => {
    const r = call(`export function f() { const s = new Set([NaN]); return s.has(NaN); }`);
    expect(litValue(r.result)).toBe(true);
  });

  it("Set add NaN dedupes SameValueZero", () => {
    const r = call(`export function f() { const s = new Set(); s.add(NaN); s.add(NaN); return s.size; }`);
    expect(litValue(r.result)).toBe(1);
  });

  it("Set delete NaN removes the entry", () => {
    const r = call(
      `export function f() { const s = new Set([NaN]); s.delete(NaN); return s.size; }`,
    );
    expect(litValue(r.result)).toBe(0);
  });

  it("regression: duplicate literal add still dedupes", () => {
    const r = call(`export function f() { const s = new Set(); s.add(1); s.add(1); return s.size; }`);
    expect(litValue(r.result)).toBe(1);
  });
});
