/**
 * Array 构造器语义：此前单 number 实参非整数/负数折 arr（partial）且
 * throws=never——new Array(1.5)/Array(-1) 原生 RangeError 不抛（check L2
 * 漏报）；字符串单实参 new Array('a') 原生 ['a'] 却折 arr（精度缺口）；
 * 无 new 的 Array(...) 走宿主原生调用（GLOBAL_FNS 未登记 Array），结果
 * 不可靠。
 * 修复：makeArrayCtorAbs 共享口径（evaluator $new、evalGlobalFn、ast-eval
 * evalBuiltinNew）——number 整数 0..2^32-1 折空洞 tuple（超物化上限降
 * arr）、非法 number 硬抛 RangeError、其余字面量单实参折单元素 tuple、
 * 多实参折字面量 tuple、抽象实参保守 arr。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

function tupleEls(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple") return undefined;
  const els = a.shape.elements!.map((e) => { const r = litValue(e as never); return r.ok ? r.value : undefined; });
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

describe("evaluator Array constructor folding", () => {
  it("new Array(n) is an n-length holey tuple", () => {
    expect(litValue(call(`export function f() { return new Array(3).length; }`).result)).toEqual({ ok: true, value: 3 });
    expect(litValue(call(`export function f() { return new Array(0).length; }`).result)).toEqual({ ok: true, value: 0 });
    expect(litValue(call(`export function f() { return new Array(3)[0]; }`).result)).toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { return 1 in new Array(3); }`).result)).toEqual({ ok: true, value: false });
  });

  it("single non-number arg folds single-element tuple", () => {
    expect(tupleEls(call(`export function f() { return new Array('a'); }`).result)).toEqual(["a"]);
    expect(tupleEls(call(`export function f() { return Array('a'); }`).result)).toEqual(["a"]);
    expect(tupleEls(call(`export function f() { return new Array(null); }`).result)).toEqual([null]);
    expect(tupleEls(call(`export function f() { return Array(7n); }`).result)).toEqual([7n]);
  });

  it("multi args fold literal tuple (with and without new)", () => {
    expect(tupleEls(call(`export function f() { return Array('a','b'); }`).result)).toEqual(["a", "b"]);
    expect(tupleEls(call(`export function f() { return new Array(1, 2); }`).result)).toEqual([1, 2]);
    expect(tupleEls(call(`export function f() { return Array(); }`).result)).toEqual([]);
  });

  it("abstract arg stays abstract", () => {
    const r = call(`export function f(x) { return new Array(x); }`);
    expect(tupleEls(r.result)).toBeUndefined();
  });

  it("Bug 53: abstract number-prim length → 元素域可判定 undefined（不再 unknown[]）", () => {
    // 单 number prim 实参恒走 length 路径（ToArrayLength；越界已记
    // may RangeError）→ 稀疏数组，元素全 hole → 读恒 undefined
    const exports = runTranspiled(`export function f(n) { return new Array(n); }`, { mode: "analyze" });
    const numAbs = { shape: { k: "prim", type: "number" }, conf: "path" } as never;
    const r = callTranspiledExportFull(exports, "f", [numAbs]) as { result: unknown };
    const a = r.result as { shape?: { k?: string; element?: { shape?: { k?: string; term?: { op?: string; value?: unknown } } } } };
    expect(a.shape?.k).toBe("arr");
    const el = a.shape?.element;
    expect(el?.shape?.k).toBe("unknown");
    expect(el?.term?.op).toBe("lit");
    expect(el?.term?.value).toBe(undefined);
    // 级联下标读 → undefined（不再 unknown 污染）
    const idxExports = runTranspiled(`export function g(n) { return new Array(n)[0]; }`, { mode: "analyze" });
    const rIdx = callTranspiledExportFull(idxExports, "g", [numAbs]) as { result: unknown };
    const iLit = litValue(rIdx.result);
    expect(iLit).toEqual({ ok: true, value: undefined });
    // .length 面：number（不回归）
    const lenExports = runTranspiled(`export function h(n) { return new Array(n).length; }`, { mode: "analyze" });
    const rLen = callTranspiledExportFull(lenExports, "h", [numAbs]) as { result: unknown };
    expect((rLen.result as { shape?: { k?: string; type?: string } }).shape).toMatchObject({
      k: "prim",
      type: "number",
    });
  });

  it("Bug 53: any 实参保持 unknown[]（字符串 → 单元素数组，真不可判定）", () => {
    const exports = runTranspiled(`export function f(x) { return new Array(x); }`, { mode: "analyze" });
    const anyAbs = { shape: { k: "any" }, conf: "path" } as never;
    const r = callTranspiledExportFull(exports, "f", [anyAbs]) as { result: unknown };
    const a = r.result as { shape?: { k?: string; element?: { shape?: { k?: string } } } };
    expect(a.shape?.k).toBe("arr");
    expect(a.shape?.element?.shape?.k).toBe("unknown");
  });
});

describe("evaluator Array constructor invalid length throws RangeError", () => {
  it("fractional / negative / NaN / out-of-range length", () => {
    for (const src of [
      `export function f() { return new Array(1.5); }`,
      `export function f() { return Array(1.5); }`,
      `export function f() { return new Array(-1); }`,
      `export function f() { return Array(-1); }`,
      `export function f() { return new Array(NaN); }`,
      `export function f() { return new Array(4294967296); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "RangeError"), src).toBe(true);
    }
  });

  it("caught by try/catch", () => {
    for (const src of [
      `export function f() { try { new Array(1.5); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Array(-1); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toEqual({ ok: true, value: "caught" });
    }
  });
});

