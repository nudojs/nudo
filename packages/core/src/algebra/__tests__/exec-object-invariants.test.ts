/**
 * B-path 对象不变性差分回归（sloppy mode 值语义）。
 * 回归背景：Object.freeze/seal/preventExtensions/defineProperty 完全未建模——
 * freeze 后 o.a=2 静默失败（原生 o.a 仍 1）而 B-path 写入成功；seal 后加新键
 * 静默失败而 B-path 写入；defineProperty 默认 writable:false 的写静默失败。
 * 每条值断言与 Node sloppy mode 真实执行对齐（vm 复核）；throw 建模差异
 * （如 frozen 数组 push 原生 TypeError）不在此断言。
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

function tupleOf(src: string) {
  const r = call(src, "run").result;
  if (r.shape.k !== "tuple") return undefined;
  return r.shape.elements.map((e) => litValue(e));
}

describe("B-path object invariants", () => {
  it("freeze blocks writes to existing slots", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); o.a = 2; return o.a; }`)).toBe(1);
  });

  it("freeze blocks adding new slots", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); o.b = 2; return o.b; }`)).toBe(undefined);
  });

  it("freeze blocks delete", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); delete o.a; return o.a; }`)).toBe(1);
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); return delete o.a; }`)).toBe(false);
  });

  it("isFrozen reflects freeze", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); return Object.isFrozen(o); }`)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; return Object.isFrozen(o); }`)).toBe(false);
  });

  it("seal allows existing-slot writes but blocks new slots and delete", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); o.a = 2; return o.a; }`)).toBe(2);
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); o.b = 2; return o.b; }`)).toBe(undefined);
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); return delete o.a; }`)).toBe(false);
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); return Object.isSealed(o); }`)).toBe(true);
  });

  it("preventExtensions blocks new slots only", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); o.b = 2; return o.b; }`)).toBe(undefined);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); o.a = 2; return o.a; }`)).toBe(2);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); return delete o.a; }`)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); return Object.isExtensible(o); }`)).toBe(false);
    expect(str(`export function run() { let o = {a: 1}; return Object.isExtensible(o); }`)).toBe(true);
  });

  it("defineProperty default writable:false blocks writes", () => {
    expect(str(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1}); o.p = 2; return o.p; }`)).toBe(1);
    expect(str(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1}); return o.p; }`)).toBe(1);
    expect(str(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1, writable: true}); o.p = 2; return o.p; }`)).toBe(2);
  });

  it("defineProperty non-enumerable keys are hidden from Object.keys", () => {
    const r = call(
      `export function run() { let o = {a: 1}; Object.defineProperty(o, "p", {value: 1, enumerable: false}); return Object.keys(o); }`,
      "run",
    ).result;
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k === "tuple") {
      expect(r.shape.elements.map((e) => litValue(e))).toEqual(["a"]);
    }
  });

  it("frozen arrays keep elements on index write", () => {
    expect(tupleOf(`export function run() { let a = [1, 2]; Object.freeze(a); a[0] = 9; return a; }`)).toEqual([1, 2]);
    expect(str(`export function run() { let a = [1, 2]; Object.freeze(a); return Object.isFrozen(a); }`)).toBe(true);
  });

  it("freeze does not change Object.keys or reads", () => {
    const r = call(
      `export function run() { let o = {a: 1}; Object.freeze(o); return Object.keys(o); }`,
      "run",
    ).result;
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k === "tuple") {
      expect(r.shape.elements.map((e) => litValue(e))).toEqual(["a"]);
    }
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); return o.a; }`)).toBe(1);
  });

  it("unfrozen objects keep previous mutability", () => {
    expect(str(`export function run() { let o = {a: 1}; o.a = 2; return o.a; }`)).toBe(2);
    expect(str(`export function run() { let o = {a: 1}; o.b = 2; return o.b; }`)).toBe(2);
    expect(str(`export function run() { let o = {a: 1}; return delete o.a; }`)).toBe(true);
  });
});
