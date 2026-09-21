/**
 * 数组 spread 对未知/不可精确展开操作数的语义（B 路径）。
 *
 * 原生语义：
 * - `[...x]`：x 不可迭代（number/bool/null/undefined/bigint/symbol 字面量）
 *   → TypeError；x 抽象（长度未知）→ 结果长度未知。
 * - `[...set]` / `[...map]`：逐条目展开。
 *
 * 修复前：$concat 对非 tuple/arr/string 的操作数一律折成单元素 tuple
 * （bs-tuple 分支 `[a, ...bs.elements]`）——`[...x].length` 假精确 1
 * （原生长度未知）、`[...new Set([1,2])].length` 折 1（原生 2）、
 * `[...5]` 不抛而折 [5]（原生 TypeError）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, unknown } from "@nudojs/core";

function call(src: string, fnName = "f", args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("B-path spread of abstract iterables", () => {
  it("spread of abstract param does not concretize length to 1", () => {
    const r = call(`export function f(x) { return [...x].length; }`, "f", [unknown]);
    expect(isNever(r.result)).toBe(false);
    expect(litValue(r.result)).toBe(undefined);
  });

  it("spread of abstract param mixed with literals stays unbounded", () => {
    const r = call(`export function f(x) { return [...x, 1].length; }`, "f", [unknown]);
    expect(isNever(r.result)).toBe(false);
    expect(litValue(r.result)).toBe(undefined);
  });
});

describe("B-path spread of Set/Map entries", () => {
  it("Set spread yields every element", () => {
    expect(litValue(call(`export function f() { return [...new Set([1,2])].length; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return [...new Set([1,2])][0]; }`).result)).toBe(1);
  });

  it("Map spread yields every entry tuple", () => {
    expect(litValue(call(`export function f() { return [...new Map([[1,'a'],[2,'b']])].length; }`).result)).toBe(2);
    const r = call(`export function f() { const e = [...new Map([[1,'a'],[2,'b']])][0]; return e[0] + ':' + e[1]; }`);
    expect(litValue(r.result)).toBe("1:a");
  });
});

describe("B-path spread of non-iterables", () => {
  it.each(["5", "true", "null", "undefined", "5n"])("[...%s] throws TypeError", (expr) => {
    const r = call(`export function f() { return [...${expr}].length; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("throw is catchable", () => {
    const r = call(`export function f() { try { [...5]; } catch(e) { return 'caught'; } return 'missed'; }`);
    expect(litValue(r.result)).toBe("caught");
  });
});

describe("B-path spread of concrete containers (regression)", () => {
  it("tuple + tuple", () => {
    expect(litValue(call(`export function f() { return [...[1], ...[2,3]].length; }`).result)).toBe(3);
  });
  it("plain element after spread", () => {
    expect(litValue(call(`export function f() { return [...[1,2], 9][2]; }`).result)).toBe(9);
  });
  it("string spread", () => {
    expect(litValue(call(`export function f() { return [...'ab', 'c'][1]; }`).result)).toBe("b");
  });
});
