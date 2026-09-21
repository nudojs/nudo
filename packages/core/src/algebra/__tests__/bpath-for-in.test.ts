/**
 * B 路径 for-in：此前 transpile 无 ForInStatement case，整体 skip——
 * 循环体零迭代（对象/数组/字符串键遍历全部丢失）。修复：生成
 * $forOf($forInKeys(obj), …)，键序按原生（整数键升序 → 字符串键插入序），
 * 数组 hole 槽不出键，循环内 break/continue 同信号机制生效。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path for-in", () => {
  it("iterates object keys in insertion order", () => {
    const r = call(
      `export function f() { let s = ""; for (const x in { a: 1, b: 2 }) s += x; return s; }`,
    );
    expect(litValue(r.result)).toBe("ab");
  });

  it("integer keys come first in ascending order", () => {
    const r = call(
      `export function f() { let s = ""; for (const x in { 10: "a", 2: "b" }) s += x; return s; }`,
    );
    expect(litValue(r.result)).toBe("210");
  });

  it("iterates array indices as strings", () => {
    const r = call(`export function f() { let s = ""; for (const x in [9, 8]) s += x; return s; }`);
    expect(litValue(r.result)).toBe("01");
  });

  it("iterates string indices", () => {
    const r = call(`export function f() { let s = ""; for (const x in "abc") s += x; return s; }`);
    expect(litValue(r.result)).toBe("012");
  });

  it("reads values through the loop key", () => {
    const r = call(
      `export function f() { let s = 0; const o = { a: 1, b: 2 }; for (const k in o) s += o[k]; return s; }`,
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("break exits for-in", () => {
    const r = call(
      `export function f() { let s = 0; const o = { a: 1, b: 2, c: 3 }; for (const k in o) { if (k === "b") break; s += o[k]; } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("continue skips in for-in", () => {
    const r = call(
      `export function f() { let s = 0; const o = { a: 1, b: 2, c: 3 }; for (const k in o) { if (k === "b") continue; s += o[k]; } return s; }`,
    );
    expect(litValue(r.result)).toBe(4);
  });

  it("empty object iterates zero times", () => {
    const r = call(`export function f() { let n = 0; for (const k in {}) n++; return n; }`);
    expect(litValue(r.result)).toBe(0);
  });

  it("deleted array slot does not appear", () => {
    const r = call(
      `export function f() { let s = ""; const a = [1, 2, 3]; delete a[1]; for (const x in a) s += x; return s; }`,
    );
    expect(litValue(r.result)).toBe("02");
  });
});
