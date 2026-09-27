/**
 * 同变量严格相等对 NaN 的健全性回归。
 * 回归背景：strictEqAbs 对 term 同 var id 一律折 true，但 JS 里
 * `x === x` 在 x 为 NaN 时为 false（NaN !== NaN）。抽象 number/any
 * 实参可能是 NaN，不得假精确。同 Abs 引用路径已排除 number lit NaN
 * 与 object-like 之外的折叠；同 var 路径是漏网点。
 * 同类：nan-literal-identity / nan-algebra-identity 已改用 SameValue
 * 口径处理 NaN 字面量；变量身份比较是同族漏网点。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  numLit,
  abs,
} from "../index.ts";

function call(src: string, fnName = "f", args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never);
}

describe("x === x must not fold true when x may be NaN", () => {
  it("abstract number arg: x === x is not exact true", () => {
    const src = `export function f(x) { return x === x; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absNum = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    const r = callTranspiledExportFull(exports, "f", [absNum]);
    // 不健全时会折 true #exact；健全结果不得是 exact true
    const v = litValue(r.result);
    if (v === true) {
      expect(r.result.conf).not.toBe("exact");
    } else {
      expect(v).toBeUndefined();
    }
  });

  it("NaN literal arg already folds false (control)", () => {
    const r = call(`export function f(x) { return x === x; }`, "f", [numLit(NaN)]);
    expect(litValue(r.result)).toBe(false);
  });

  it("finite literal arg folds true (control)", () => {
    const r = call(`export function f(x) { return x === x; }`, "f", [numLit(1)]);
    expect(litValue(r.result)).toBe(true);
  });

  it("undefined arg folds true (control: undefined === undefined)", () => {
    const r = call(`export function f(x) { return x === x; }`, "f", []);
    expect(litValue(r.result)).toBe(true);
  });

  it("object arg: x === x stays true (reference identity)", () => {
    const src = `export function f() { const o = {}; return o === o; }`;
    const r = call(src, "f", []);
    expect(litValue(r.result)).toBe(true);
  });

  it("x != x must not fold false when x may be NaN", () => {
    const src = `export function f(x) { return x != x; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const absNum = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    const r = callTranspiledExportFull(exports, "f", [absNum]);
    const v = litValue(r.result);
    if (v === false) {
      expect(r.result.conf).not.toBe("exact");
    } else {
      expect(v).toBeUndefined();
    }
  });
});
