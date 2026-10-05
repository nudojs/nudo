/**
 * 字符串 slice/substring/concat 与数组 fill 的位置参数假精确：
 * - 'abc'.substring(Symbol()) / slice(Symbol()) / concat(Symbol()) 原生 THROW
 *   （Cannot convert a symbol to a number/string），求值引擎把抽象实参当缺省
 *   折出精确 "abc"；
 * - 表达式级 [1,2,3].fill(9, start, end) 完全忽略 start/end，
 *   fill(9, 1) 折 [9,9,9]（原生 [1,9,9]）。
 * 修复：非字面量位置参数 → 保守（prim/arr），字面量 start/end 复用
 * runtime 的 fillTuple 精确折叠。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function concreteTuple(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple" || !a.shape.elements) return undefined;
  const els = a.shape.elements.map((e) => { const r = litValue(e as never); return r.ok ? r.value : undefined; });
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

describe("evaluator string method abstract position args", () => {
  it("substring with symbol arg stays abstract (native THROW)", () => {
    const r = call(`export function f() { return "abc".substring(Symbol()); }`);
    expect(litValue(r.result)).toEqual({ ok: false });
  });

  it("substring second arg symbol stays abstract", () => {
    const r = call(`export function f() { return "abc".substring(1, Symbol()); }`);
    expect(litValue(r.result)).toEqual({ ok: false });
  });

  it("slice with symbol arg stays abstract", () => {
    const r = call(`export function f() { return "abc".slice(Symbol()); }`);
    expect(litValue(r.result)).toEqual({ ok: false });
    const r2 = call(`export function f() { return "abc".slice(0, Symbol()); }`);
    expect(litValue(r2.result)).toEqual({ ok: false });
  });

  it("concat with symbol arg stays abstract (native THROW)", () => {
    const r = call(`export function f() { return "abc".concat(Symbol()); }`);
    expect(litValue(r.result)).toEqual({ ok: false });
    const r2 = call(`export function f() { return "abc".concat(Symbol("x")); }`);
    expect(litValue(r2.result)).toEqual({ ok: false });
  });

  it("literal position args stay exact", () => {
    expect(litValue(call(`export function f() { return "abc".slice(1); }`).result)).toEqual({ ok: true, value: "bc" });
    expect(litValue(call(`export function f() { return "abc".substring(1, 2); }`).result)).toEqual({ ok: true, value: "b" });
    expect(litValue(call(`export function f() { return "abc".concat("d"); }`).result)).toEqual({ ok: true, value: "abcd" });
  });
});

describe("evaluator array fill start/end", () => {
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

describe("abstract-length fill window (issue #98 / review blocker 2)", () => {
  // 未知长度 arr（a.length=5000 触发降级）上的 fill：默认窗口 [0, len) 覆盖
  // 全数组 → 元素精确替换；start/end 显式给定 → 窗口不保证覆盖 → 元素 join。
  // 负 start 是长度相对的（[1,2,3].fill(0,-1) 只写末元素）——不得折全替换。
  function elemOf(src: string): string {
    const r = call(src);
    return formatAbs(r.result);
  }

  it("default window replaces the element exactly", () => {
    expect(elemOf(`export function f() { const a = [1]; a.length = 5000; const b = a.fill(0); return b[0]; }`)).toContain("0");
    expect(elemOf(`export function f() { const a = [1]; a.length = 5000; const b = a.fill(0, 0); return b[0]; }`)).toContain("0");
  });

  it("negative/positive start keeps the element domain (length-relative window)", () => {
    // 原生 b[0] 仍是 1（窗口只覆盖尾部/跳过头部）——折叠成 0 丢元素域
    const neg = elemOf(`export function f() { const a = [1]; a.length = 5000; const b = a.fill(0, -1); return b[0]; }`);
    expect(neg).toContain("1");
    expect(neg).toContain("0");
    const pos = elemOf(`export function f() { const a = [1]; a.length = 5000; const b = a.fill(0, 1); return b[0]; }`);
    expect(pos).toContain("1");
  });

  it("explicit end keeps the element domain", () => {
    const r = elemOf(`export function f() { const a = [1]; a.length = 5000; const b = a.fill(0, 0, 5); return b[0]; }`);
    expect(r).toContain("1");
  });
});
