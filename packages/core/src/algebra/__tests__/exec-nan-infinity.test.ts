/**
 * evaluator 全局字面量标识符 NaN/Infinity 转译回归。
 * 回归背景：transpile 只转译 undefined（→ $lit(undefined)），NaN/Infinity
 * 作为裸 JS 值留在产物里——Abs 路径把它们当宿主值处理，`return NaN` 折
 * unknown（原生 NaN）、1 + NaN 折 unknown（原生 NaN）、Number.isNaN(NaN)
 * 折 partial boolean（原生 true）。
 * 每条断言与 Node 真实执行结果对齐（vm 复核）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "@nudojs/core";

function call(src: string, fnName: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function str(src: string) {
  return litValue(call(src, "run").result);
}

describe("evaluator NaN / Infinity global literals", () => {
  it("bare NaN folds to NaN literal", () => {
    const v = str(`export function run() { return NaN; }`);
    expect(v.ok && typeof v.value).toBe("number");
    expect(Number.isNaN((v).ok ? (v).value : undefined)).toBe(true);
  });

  it("bare Infinity folds to Infinity literal", () => {
    expect(str(`export function run() { return Infinity; }`)).toEqual({ ok: true, value: Infinity });
    expect(str(`export function run() { return -Infinity; }`)).toEqual({ ok: true, value: -Infinity });
  });

  it("arithmetic with NaN folds to NaN", () => {
    const a = str(`export function run() { return 1 + NaN; }`);
    expect(Number.isNaN(a.ok ? a.value : undefined)).toBe(true);
    const b = str(`export function run() { return 1 * NaN; }`);
    expect(Number.isNaN(b.ok ? b.value : undefined)).toBe(true);
  });

  it("Number.isNaN(NaN) is true", () => {
    expect(str(`export function run() { return Number.isNaN(NaN); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Number.isNaN(1); }`)).toEqual({ ok: true, value: false });
  });

  it("Math.min/max with NaN and Infinity", () => {
    const mn = str(`export function run() { return Math.min(NaN, 1); }`);
    expect(Number.isNaN(mn.ok ? mn.value : undefined)).toBe(true);
    expect(str(`export function run() { return Math.max(1, Infinity); }`)).toEqual({ ok: true, value: Infinity });
    expect(str(`export function run() { return Math.min(1, Infinity); }`)).toEqual({ ok: true, value: 1 });
  });

  it("NaN flows into method positional args", () => {
    expect(str(`export function run() { return "hello".startsWith("hell", NaN); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return "hello".endsWith("lo", NaN); }`)).toEqual({ ok: true, value: false });
  });

  it("NaN as split limit yields empty array (ToUint32(NaN)=0)", () => {
    const r = call(`export function run() { return "abc".split("b", NaN); }`, "run").result;
    if (r.shape.k !== "tuple") throw new Error("expected tuple");
    expect(r.shape.elements.length).toBe(0);
  });

  it("NaN inside array/object literal folds", () => {
    const arr = str(`export function run() { return [NaN][0]; }`);
    expect(Number.isNaN(arr.ok ? arr.value : undefined)).toBe(true);
    const obj = str(`export function run() { return { n: NaN }.n; }`);
    expect(Number.isNaN(obj.ok ? obj.value : undefined)).toBe(true);
  });

  it("comparisons with NaN / Infinity", () => {
    expect(str(`export function run() { return NaN === NaN; }`)).toEqual({ ok: true, value: false });
    expect(str(`export function run() { return NaN !== NaN; }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Infinity > 1; }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return 1 / Infinity; }`)).toEqual({ ok: true, value: 0 });
  });

  it("NaN binding can be reassigned like any local", () => {
    expect(str(`export function run() { let n = NaN; n = 5; return n; }`)).toEqual({ ok: true, value: 5 });
  });
});
