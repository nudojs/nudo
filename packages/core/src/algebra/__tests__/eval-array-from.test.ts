/**
 * 求值引擎 Array.from：此前 evalArrayStatic 的 from 分支只取可迭代物元素类型、
 * **完全忽略 mapFn 实参**——回调副作用静默丢失（`Array.from([1,2,3], cb); t`
 * 折 0），带 mapFn 的结果也不传播回调输出。修复：mapFn 逐位应用 (el, i)，
 * 数组 hole 位置按迭代器语义 yield undefined（实槽）、字符串按 code point、
 * Set/Map 走条目表、array-like 按 length 槽逐位调（元素 undefined）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, effects } from "./eval-helpers.ts";

describe("evaluator Array.from mapFn", () => {
  it("invokes mapFn once per tuple element with index", () => {
    const r = call(`export function f() { let t = 0; Array.from([1,2,3], (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    const r2 = call(`export function f() { let t = 0; Array.from([1,2,3], (x, i) => { t += i; return x; }); return t; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 3 });
  });

  it("visits holes as undefined (iterator Get semantics)", () => {
    const r = call(`export function f() { let t = 0; Array.from([1,,3], (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    const r2 = call(`export function f() { let t = 0; Array.from([1,,3], (x, i) => { if (x === undefined) t += i; return x; }); return t; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 1 });
  });

  it("string source iterates code points", () => {
    const r = call(`export function f() { let t = 0; Array.from("ab", (c) => { t++; return c; }); return t; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    const r2 = call(`export function f() { let t = 0; Array.from("𠮷", (c) => { t++; return c; }); return t; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 1 });
  });

  it("Set/Map source invokes mapFn per entry", () => {
    const r = call(`export function f() { let t = 0; Array.from(new Set([1,2,3]), (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    const r2 = call(`export function f() { let t = 0; Array.from(new Map([["a",1],["b",2]]), (e) => { t++; return e; }); return t; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  });

  it("array-like length source invokes mapFn with undefined elements", () => {
    const r = call(`export function f() { let t = 0; Array.from({length: 3}, (x, i) => { t += i; return x; }); return t; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("without mapFn tuple keeps element union (regression)", () => {
    const r = call(`export function f() { const a = Array.from([1,2,3]); return a.length; }`);
    // 无 mapFn 时结果保持 arr 元素联合（非具体长度），不得假精确
    expect(litValue(r.result)).toEqual({ ok: false });
  });

  it("regression: Array.from of empty tuple stays abstract", () => {
    const r = call(`export function f() { let t = 0; Array.from([], (x) => { t++; return x; }); return t; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });
});

// --- Bug 104：array-like length 的 ArrayCreate 上限 -------------------------

describe("Bug 104: Array.from array-like length ceiling", () => {
  it("字面量 length > 2^32-1 → definite RangeError（含折算字符串/Infinity）", () => {
    for (const src of [
      `export function f() { return Array.from({ length: 2 ** 32 }); }`,
      `export function f() { return Array.from({ length: Infinity }); }`,
      `export function f() { return Array.from({ length: 1e10 }); }`,
      `export function f() { return Array.from({ length: "4294967296" }); }`,
    ]) {
      const r = call(src);
      expect(litValue(r.result), src).toEqual({ ok: false });
      expect((r.throws as { shape?: { k?: string; name?: string } })?.shape?.k === "never").toBe(false);
      expect((r.throws as { shape?: { k?: string; name?: string } })?.shape?.name).toBe("RangeError");
    }
  });

  it("边界内字面量（2^32-1 / 0 / NaN / 截断小数）不抛", () => {
    // 2^32-1 行：4294967295 元素不可物化（诚实不精确）——只钉不抛 +
    // throws 域 never；其余行长度可物化，钉精确
    const r1 = call(`export function f() { return Array.from({ length: 4294967295 }).length; }`);
    expect((r1.throws as { shape?: { k?: string } })?.shape?.k).toBe("never");
    expect((r1.result as { shape?: { k?: string } })?.shape?.k).not.toBe("never");
    for (const src of [
      `export function f() { return Array.from({ length: 0 }).length === 0; }`,
      `export function f() { return Array.from({ length: NaN }).length === 0; }`,
      `export function f() { return Array.from({ length: 2.5 }, (v) => v).length === 2; }`,
    ]) {
      const r = call(src);
      expect(litValue(r.result), src).toEqual({ ok: true, value: true });
      expect((r.throws as { shape?: { k?: string } })?.shape?.k).toBe("never");
    }
  });

  it("抽象 length → may RangeError（gate 面）", () => {
    const eff = effects(`export function f(x) { return Array.from({ length: x }); }`);
    expect(eff).toContain("RangeError");
  });
});

// --- Bug 110：普通对象 @@iterator 先行（iterator beats array-like） ---------

describe("Bug 110: Array.from 普通对象 @@iterator", () => {
  it("带 @@iterator 的普通对象 → 迭代路径：元素域 unknown 的 arr（不再折 exact 空 tuple）", () => {
    const r = call(`export function f() { const o = { [Symbol.iterator]: function* () { yield 1; yield 2; } }; return Array.from(o); }`);
    const s = r.result as { shape?: { k?: string; element?: unknown } };
    expect(s.shape?.k).toBe("arr");
    expect((s.shape as { element?: { shape?: { k?: string } } }).element?.shape?.k).toBe("unknown");
    // 长度不可判（native 2）——不得 wrong-exact 折 0
    const len = call(`export function f() { const o = { [Symbol.iterator]: function* () { yield 1; yield 2; } }; return Array.from(o).length; }`);
    expect(litValue(len.result)).toEqual({ ok: false });
  });

  it("非可调用 @@iterator 字面量 → definite TypeError（GetMethod 语义）", () => {
    const r = call(`export function f() { const o = { [Symbol.iterator]: 5 }; return Array.from(o); }`);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("iterator beats length：{...iterObj, length: 0} 仍走迭代（不折 exact 0）", () => {
    const r = call(`export function f() { const g = { [Symbol.iterator]: function* () { yield 1; yield 2; } }; return Array.from({ ...g, length: 0 }).length; }`);
    expect(litValue(r.result)).toEqual({ ok: false });
  });

  it("@@iterator 值 undefined → GetMethod 视为缺席，回落 array-like", () => {
    const r = call(`export function f() { const o = { [Symbol.iterator]: undefined, 0: "a", 1: "b", length: 2 }; return Array.from(o).join(""); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ab" });
  });

  it("控制组：无 @@iterator 的 array-like / 空对象面不回归（Bug 51 口径）", () => {
    expect(litValue(call(`export function f() { return Array.from({ 0: "a", 1: "b", length: 2 }).length; }`).result))
      .toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return Array.from({ a: 1 }).length; }`).result))
      .toEqual({ ok: true, value: 0 });
    expect(litValue(call(`export function f() { function* gen() { yield 3; yield 4; } return Array.from(gen()).length; }`).result))
      .toEqual({ ok: true, value: 2 });
  });
});
