/**
 * JSON.stringify 顶层非 JSON 值折叠回归。
 * 回归背景：JSON.stringify 对 function/symbol 返回 undefined（JS 值），
 * 不是字符串。absToJsonNative 对 fn/symbol 子树返回 NOT_LITERAL 后
 * 一律落 str("partial")——把 undefined 说成 string（不健全）。
 * 顶层 undefined 已返回 undefAbs；function/symbol 是同族漏网点。
 * 嵌套 function 仍是 NOT_LITERAL→partial（可接受超集），不在本回归面。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

describe("JSON.stringify top-level non-JSON values return undefined", () => {
  it("function / arrow fold to undefined (the JS value)", () => {
    const a = call(`export function f() { return JSON.stringify(function(){}); }`).result;
    expect(formatAbs(a)).toContain("undefined");
    expect(a.shape.k === "unknown" || a.shape.k === "never").toBe(true);
    // litValue(undefined 值) 为 undefined；不得是 string 字面量
    expect(typeof val(`export function f() { return JSON.stringify(function(){}); }`)).not.toBe("string");

    const b = call(`export function f() { return JSON.stringify(() => {}); }`).result;
    expect(b.shape.k === "unknown" || b.shape.k === "never").toBe(true);
  });

  it("symbol folds to undefined (the JS value)", () => {
    const a = call(`export function f() { return JSON.stringify(Symbol()); }`).result;
    expect(a.shape.k === "unknown" || a.shape.k === "never").toBe(true);
    expect(typeof val(`export function f() { return JSON.stringify(Symbol()); }`)).not.toBe("string");
  });

  it("undefined still folds to undefined (control)", () => {
    const a = call(`export function f() { return JSON.stringify(undefined); }`).result;
    expect(formatAbs(a)).toContain("undefined");
  });

  it("plain JSON values still fold to strings (control)", () => {
    expect(val(`export function f() { return JSON.stringify(1); }`)).toEqual({ ok: true, value: "1" });
    expect(val(`export function f() { return JSON.stringify('a'); }`)).toEqual({ ok: true, value: '"a"' });
    expect(val(`export function f() { return JSON.stringify(null); }`)).toEqual({ ok: true, value: "null" });
  });
});
