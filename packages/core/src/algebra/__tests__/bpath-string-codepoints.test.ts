/**
 * B 路径字符串迭代按 UTF-16 code unit 而非 code point：
 * [..."𠮷"] 折 2 元素（原生 1）、for-of 字符串近似 unknown。
 * 修复：$concat/$elems 对字符串字面量按 code points 拆分
 * （surrogate pair 合并），$forOf 精确字符串迭代次数。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path string code point iteration", () => {
  it("spread of astral char yields one code point", () => {
    const r = call(`export function f() { return [..."𠮷"].length; }`);
    expect(litValue(r.result)).toBe(1);
  });

  it("spread of astral char keeps the char value", () => {
    const r = call(`export function f() { return [..."𠮷"][0]; }`);
    expect(litValue(r.result)).toBe("𠮷");
  });

  it("spread of ascii keeps per-char split", () => {
    const r = call(`export function f() { return [..."abc"].length; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("mixed literal spread merges string code points", () => {
    const r = call(`export function f() { const a = [...[1, 2], ..."ab"]; return a.length; }`);
    expect(litValue(r.result)).toBe(4);
    const r2 = call(`export function f() { const a = [...[1, 2], ..."ab"]; return a[3]; }`);
    expect(litValue(r2.result)).toBe("b");
  });

  it("for-of over astral string iterates code points", () => {
    const r = call(`export function f() { let n = 0; for (const c of "𠮷") n++; return n; }`);
    expect(litValue(r.result)).toBe(1);
  });

  it("for-of over ascii accumulates chars", () => {
    const r = call(`export function f() { let s = ""; for (const c of "abc") s += c; return s; }`);
    expect(litValue(r.result)).toBe("abc");
  });

  it("array destructure of string yields code points", () => {
    const r = call(`export function f() { const [a, b] = "xy"; return a + b; }`);
    expect(litValue(r.result)).toBe("xy");
  });

  it("regression: spread of tuple unchanged", () => {
    const r = call(`export function f() { return [...[1, 2, 3]].length; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("regression: string length stays code units", () => {
    const r = call(`export function f() { return "𠮷".length; }`);
    expect(litValue(r.result)).toBe(2);
  });
});
