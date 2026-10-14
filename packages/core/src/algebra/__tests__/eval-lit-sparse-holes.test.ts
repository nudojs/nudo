/**
 * Bug 14：$lit（case 实参 / litAbsFromJs）稀疏数组丢洞——数组分支
 * v.map(...) 无视洞下标（map 保留洞），tuple 形状不带 holes 槽 →
 * 洞与显式 undefined 元素不可区分：`in` / hasOwnProperty 在洞下标折
 * 精确 true（原生 false）。修复：转换时按 `i in v` 探洞，把洞下标
 * 记入 tuple.holes（与字面量路径 $arrWithHoles 同一口径）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatShape,
  $lit,
} from "@nudojs/core";

function call(src: string, jsArgs: unknown[], fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, jsArgs.map((v) => $lit(v)));
}

describe("$lit sparse array case args keep holes (Bug 14)", () => {
  it("1 in [1,,3] (case arg) is false; present indices true", () => {
    const r = call(`export function f(a) { return 1 in a; }`, [[1, , 3]]);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
    const r2 = call(`export function f(a) { return 0 in a; }`, [[1, , 3]]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: true });
    const r3 = call(`export function f(a) { return 2 in a; }`, [[1, , 3]]);
    expect(litValue(r3.result)).toEqual({ ok: true, value: true });
  });

  it("hasOwnProperty('1') on hole index is false", () => {
    const r = call(`export function f(a) { return a.hasOwnProperty("1"); }`, [[1, , 3]]);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
    const r2 = call(`export function f(a) { return a.hasOwnProperty("0"); }`, [[1, , 3]]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: true });
  });

  it("hole reads undefined; length counts the hole", () => {
    const r = call(`export function f(a) { return a[1]; }`, [[1, , 3]]);
    expect(formatShape(r.result)).toBe("undefined");
    const r2 = call(`export function f(a) { return a.length; }`, [[1, , 3]]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 3 });
  });

  it("leading hole and trailing hole both honored", () => {
    const r = call(`export function f(a) { return 0 in a; }`, [[, 1]]);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
    const r2 = call(`export function f(a) { return 1 in a; }`, [[1, ,]]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: false });
    const r3 = call(`export function f(a) { return a.hasOwnProperty("0"); }`, [[, 1]]);
    expect(litValue(r3.result)).toEqual({ ok: true, value: false });
  });

  it("JSON.stringify of sparse case arg matches native [1,null,3]", () => {
    const r = call(`export function f(a) { return JSON.stringify(a); }`, [[1, , 3]]);
    expect(litValue(r.result)).toEqual({ ok: true, value: "[1,null,3]" });
  });

  it("control: dense [1,undefined,3] keeps own properties", () => {
    const r = call(`export function f(a) { return 1 in a; }`, [[1, undefined, 3]]);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    const r2 = call(`export function f(a) { return a.hasOwnProperty("1"); }`, [[1, undefined, 3]]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: true });
  });

  it("control: dense literal case arg unchanged", () => {
    const r = call(`export function f(a) { return a[0] + a[1]; }`, [[1, 2]]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });
});
