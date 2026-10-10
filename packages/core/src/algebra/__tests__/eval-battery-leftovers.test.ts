/**
 * batch21 电池排除台账四面收尾（回归锁定；differential 行已随修复入库）：
 * 1. BigInt 数组实参 ToString 折叠漏检——join 折出 "1,2" 不可解析 → 确定
 *    SyntaxError；symbol 元素 → 确定 TypeError；可解析串（[] / [1] / [null]）
 *    值面维持保守非具体（skip-baseline 盲区稳定）；抽象元素 → may。
 * 2. 装箱构造器缺省实参 ≠ undefined——new Number() → +0、new String() →
 *    ""（显式 undefined 才折 NaN / "undefined"）。
 * 3. new URLSearchParams([{}])——闭 obj 元素无 @@iterator 槽 → 非可迭代
 *    pair，确定 TypeError（[{0:"a",1:"b"}] 同抛；二元组/缺省照旧 total）。
 * 4. Array.from(x, undefined)——undefined 字面量 mapper ≡ 无 mapper，不再
 *    假抛 TypeError（null/prim mapper 原生同抛，维持定抛）。
 * ground truth：node 原生实测。
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import { litValue } from "../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";

function call(src: string, fnName = "f") {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, []) as {
    result?: unknown;
    throws?: unknown;
  };
}

function check(src: string) {
  return checkSource("/t/battery-leftovers.js", src);
}

function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function throwsKind(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function litOf(r: unknown): { ok: boolean; value?: unknown } {
  const lr = litValue(r as never);
  return lr.ok ? { ok: true, value: lr.value } : { ok: false };
}

describe("BigInt 数组实参：ToString 折叠定抛面", () => {
  it("join 折出不可解析串 → 确定 SyntaxError（native 同）", () => {
    for (const src of [
      `export function f() { return BigInt([1, 2]); }`,
      `export function f() { return BigInt([true]); }`,
      `export function f() { return BigInt([1, null]); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsKind(r.throws, "SyntaxError"), src).toBe(true);
    }
  });

  it("symbol 元素 → 确定 TypeError（join ToString 口径）", () => {
    const r = call(`export function f() { return BigInt([Symbol()]); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsKind(r.throws, "TypeError")).toBe(true);
  });

  it("可解析串值面维持保守非具体（skip-baseline 盲区稳定）", () => {
    // native：BigInt([]) → 0n、BigInt([1]) → 1n、BigInt([null]) → 0n（node 实测）
    for (const src of [
      `export function f() { return BigInt([]); }`,
      `export function f() { return BigInt([1]); }`,
      `export function f() { return BigInt([null]); }`,
    ]) {
      const r = call(src);
      expect(litOf(r.result).ok, src).toBe(false);
      expect(isNever(r.throws), src).toBe(true);
    }
  });

  it("抽象元素 → may SyntaxError（gate 非静默）+ 保守 bigint 返回", () => {
    const r = check(`export function f(x) { BigInt([x]); }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    const e = call(`export function f(x) { return BigInt([x]); }`);
    expect(litOf(e.result).ok).toBe(false);
  });
});

describe("装箱构造器缺省实参 ≠ undefined", () => {
  it("new Number() → +0、new String() → \"\"", () => {
    const n = call(`export function f() { return new Number().valueOf(); }`);
    expect(litOf(n.result)).toEqual({ ok: true, value: 0 });
    const s = call(`export function f() { return new String().valueOf(); }`);
    expect(litOf(s.result)).toEqual({ ok: true, value: "" });
  });

  it("控制组：显式 undefined / null 照旧折叠", () => {
    const nu = call(`export function f() { return new Number(undefined).valueOf(); }`);
    expect(litOf(nu.result)).toEqual({ ok: true, value: NaN });
    const su = call(`export function f() { return new String(undefined).valueOf(); }`);
    expect(litOf(su.result)).toEqual({ ok: true, value: "undefined" });
    const nl = call(`export function f() { return new Number(null).valueOf(); }`);
    expect(litOf(nl.result)).toEqual({ ok: true, value: 0 });
    const b = call(`export function f() { return new Boolean().valueOf(); }`);
    expect(litOf(b.result)).toEqual({ ok: true, value: false });
  });
});

describe("URLSearchParams 非可迭代 pair 元素", () => {
  it("闭 obj 元素（无 @@iterator 槽）→ 确定 TypeError", () => {
    for (const src of [
      `export function f() { return new URLSearchParams([{}]).toString(); }`,
      `export function f() { return new URLSearchParams([{ 0: "a", 1: "b" }]).toString(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsKind(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("控制组：二元组 / 缺省 / nullish 照旧 total", () => {
    for (const src of [
      `export function f() { return typeof new URLSearchParams([["a", "b"]]); }`,
      `export function f() { return typeof new URLSearchParams(); }`,
      `export function f() { return typeof new URLSearchParams(null); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.throws), src).toBe(true);
      expect(litOf(r.result), src).toEqual({ ok: true, value: "object" });
    }
  });

  it("抽象元素 → may TypeError（gate 非静默）", () => {
    const r = check(`export function f(x) { new URLSearchParams([x]); }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  });
});

describe("Array.from undefined 字面量 mapper", () => {
  it("undefined mapper ≡ 无 mapper，不抛且保留元素", () => {
    const r = call(`export function f() { return Array.from([1], undefined).join(","); }`);
    expect(isNever(r.throws)).toBe(true);
    expect(isNever(r.result)).toBe(false);
  });

  it("控制组：null / 非可调用 mapper 维持确定 TypeError（native 同抛）", () => {
    for (const src of [
      `export function f() { return Array.from([1], null).join(","); }`,
      `export function f() { return Array.from([1], 0).join(","); }`,
      `export function f() { return Array.from([1], "x").join(","); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsKind(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("真 mapper 照旧逐位应用（回归）", () => {
    const r = call(`export function f() { let t = 0; Array.from([1, 2, 3], (x) => { t += x; return x; }); return t; }`);
    expect(litOf(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("字符串源 + undefined mapper 不再误映射（native 折 a,b）", () => {
    const r = call(`export function f() { return Array.from("ab", undefined).join(","); }`);
    expect(isNever(r.throws)).toBe(true);
    expect(isNever(r.result)).toBe(false);
  });
});
