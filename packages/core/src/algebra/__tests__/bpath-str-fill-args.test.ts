/**
 * 字符串 slice/substring/concat 与数组 fill 的位置参数假精确：
 * - 'abc'.substring(Symbol()) / slice(Symbol()) / concat(Symbol()) 原生 THROW
 *   （Cannot convert a symbol to a number/string），B 路径把抽象实参当缺省
 *   折出精确 "abc"；
 * - 表达式级 [1,2,3].fill(9, start, end) 完全忽略 start/end，
 *   fill(9, 1) 折 [9,9,9]（原生 [1,9,9]）。
 * 修复：非字面量位置参数 → 保守（prim/arr），字面量 start/end 复用
 * runtime 的 fillTuple 精确折叠。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function concreteTuple(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple" || !a.shape.elements) return undefined;
  const els = a.shape.elements.map((e) => litValue(e as never));
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

describe("B-path string method abstract position args", () => {
  it("substring with symbol arg stays abstract (native THROW)", () => {
    const r = call(`export function f() { return "abc".substring(Symbol()); }`);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("substring second arg symbol stays abstract", () => {
    const r = call(`export function f() { return "abc".substring(1, Symbol()); }`);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("slice with symbol arg stays abstract", () => {
    const r = call(`export function f() { return "abc".slice(Symbol()); }`);
    expect(litValue(r.result)).toBeUndefined();
    const r2 = call(`export function f() { return "abc".slice(0, Symbol()); }`);
    expect(litValue(r2.result)).toBeUndefined();
  });

  it("concat with symbol arg stays abstract (native THROW)", () => {
    const r = call(`export function f() { return "abc".concat(Symbol()); }`);
    expect(litValue(r.result)).toBeUndefined();
    const r2 = call(`export function f() { return "abc".concat(Symbol("x")); }`);
    expect(litValue(r2.result)).toBeUndefined();
  });

  it("literal position args stay exact", () => {
    expect(litValue(call(`export function f() { return "abc".slice(1); }`).result)).toBe("bc");
    expect(litValue(call(`export function f() { return "abc".substring(1, 2); }`).result)).toBe("b");
    expect(litValue(call(`export function f() { return "abc".concat("d"); }`).result)).toBe("abcd");
  });
});

describe("B-path array fill start/end", () => {
  it("literal start folds exact", () => {
    expect(concreteTuple(call(`export function f() { return [1,2,3].fill(9, 1); }`).result)).toEqual([1, 9, 9]);
    expect(concreteTuple(call(`export function f() { return [1,2,3].fill(9, 1, 2); }`).result)).toEqual([1, 9, 3]);
    expect(concreteTuple(call(`export function f() { return [1,2,3].fill(9, -1); }`).result)).toEqual([1, 2, 9]);
    expect(concreteTuple(call(`export function f() { return [1,2,3].fill(9, 99); }`).result)).toEqual([1, 2, 3]);
  });

  it("no-arg fill still exact", () => {
    expect(concreteTuple(call(`export function f() { return [1,2,3].fill(9); }`).result)).toEqual([9, 9, 9]);
  });

  it("symbol start stays abstract (native THROW)", () => {
    const r = call(`export function f() { return [1,2,3].fill(9, Symbol()); }`);
    expect(concreteTuple(r.result)).toBeUndefined();
  });
});
