/**
 * B-path 全局字面量标识符 NaN/Infinity 转译回归。
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

describe("B-path NaN / Infinity global literals", () => {
  it("bare NaN folds to NaN literal", () => {
    const v = str(`export function run() { return NaN; }`);
    expect(typeof v).toBe("number");
    expect(Number.isNaN(v)).toBe(true);
  });

  it("bare Infinity folds to Infinity literal", () => {
    expect(str(`export function run() { return Infinity; }`)).toBe(Infinity);
    expect(str(`export function run() { return -Infinity; }`)).toBe(-Infinity);
  });

  it("arithmetic with NaN folds to NaN", () => {
    expect(Number.isNaN(str(`export function run() { return 1 + NaN; }`))).toBe(true);
    expect(Number.isNaN(str(`export function run() { return 1 * NaN; }`))).toBe(true);
  });

  it("Number.isNaN(NaN) is true", () => {
    expect(str(`export function run() { return Number.isNaN(NaN); }`)).toBe(true);
    expect(str(`export function run() { return Number.isNaN(1); }`)).toBe(false);
  });

  it("Math.min/max with NaN and Infinity", () => {
    expect(Number.isNaN(str(`export function run() { return Math.min(NaN, 1); }`))).toBe(true);
    expect(str(`export function run() { return Math.max(1, Infinity); }`)).toBe(Infinity);
    expect(str(`export function run() { return Math.min(1, Infinity); }`)).toBe(1);
  });

  it("NaN flows into method positional args", () => {
    expect(str(`export function run() { return "hello".startsWith("hell", NaN); }`)).toBe(true);
    expect(str(`export function run() { return "hello".endsWith("lo", NaN); }`)).toBe(false);
  });

  it("NaN as split limit yields empty array (ToUint32(NaN)=0)", () => {
    const r = call(`export function run() { return "abc".split("b", NaN); }`, "run").result;
    if (r.shape.k !== "tuple") throw new Error("expected tuple");
    expect(r.shape.elements.length).toBe(0);
  });

  it("NaN inside array/object literal folds", () => {
    expect(Number.isNaN(str(`export function run() { return [NaN][0]; }`))).toBe(true);
    expect(Number.isNaN(str(`export function run() { return { n: NaN }.n; }`))).toBe(true);
  });

  it("comparisons with NaN / Infinity", () => {
    expect(str(`export function run() { return NaN === NaN; }`)).toBe(false);
    expect(str(`export function run() { return NaN !== NaN; }`)).toBe(true);
    expect(str(`export function run() { return Infinity > 1; }`)).toBe(true);
    expect(str(`export function run() { return 1 / Infinity; }`)).toBe(0);
  });

  it("NaN binding can be reassigned like any local", () => {
    expect(str(`export function run() { let n = NaN; n = 5; return n; }`)).toBe(5);
  });
});
