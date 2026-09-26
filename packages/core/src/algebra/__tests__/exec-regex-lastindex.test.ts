/**
 * B-path RegExp global lastIndex 状态差分回归。
 * 回归背景：execRegexBrand 每次调用 new RegExp 从头执行，receiver 的
 * lastIndex 状态完全丢失；且 test 路径「先 exec 再 test」——exec 先更新
 * 共享 reReal.lastIndex，/g 正则的 test 从错位开始：/b/g.test("abc")
 * 折 false（原生 true）、连续 test 恒 false（原生 true→false→true）。
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

describe("B-path RegExp lastIndex state", () => {
  it("single global test folds true (no stray exec)", () => {
    expect(str(`export function run() { return /b/g.test("abc"); }`)).toBe(true);
    expect(str(`export function run() { return /b/gi.test("aBc"); }`)).toBe(true);
    expect(str(`export function run() { return /b/g.test("zbc"); }`)).toBe(true);
    expect(str(`export function run() { return /z/g.test("abc"); }`)).toBe(false);
  });

  it("consecutive test statements advance lastIndex", () => {
    expect(
      str(`export function run() { let r = /b/g; r.test("abc"); return r.test("abc"); }`),
    ).toBe(false);
    expect(
      str(`export function run() { let r = /b/g; r.test("abc"); r.test("abc"); return r.test("abc"); }`),
    ).toBe(true); // 第二次失败后 lastIndex 归零，第三次重新命中
  });

  it("failed test resets lastIndex to 0", () => {
    expect(
      str(`export function run() { let r = /b/g; r.test("abc"); r.test("abc"); return r.lastIndex; }`),
    ).toBe(0);
  });

  it("exec statement advances lastIndex", () => {
    expect(
      str(`export function run() { let r = /b/g; r.exec("abc"); return r.lastIndex; }`),
    ).toBe(2);
  });

  it("exec wraps: fail after lastIndex 2, then restarts from 0", () => {
    expect(
      str(`export function run() { let r = /b/g; r.exec("abc"); return r.exec("abc") === null; }`),
    ).toBe(true);
    expect(
      str(`export function run() { let r = /b/g; r.exec("abc"); r.exec("abc"); return r.exec("abc")[0]; }`),
    ).toBe("b");
  });

  it("manual lastIndex assignment is honored", () => {
    expect(
      str(`export function run() { let r = /b/g; r.lastIndex = 2; return r.test("abc"); }`),
    ).toBe(false);
    expect(
      str(`export function run() { let r = /b/g; r.lastIndex = 2; return r.exec("abc") === null; }`),
    ).toBe(true);
  });

  it("expression-position call still rebinds container", () => {
    expect(
      str(`export function run() { let r = /b/g; let a = r.test("abc"); return r.lastIndex; }`),
    ).toBe(2);
    expect(
      str(`export function run() { let r = /b/g; let a = r.test("abc"); return a; }`),
    ).toBe(true);
  });

  it("array literal element order: later element sees advanced lastIndex", () => {
    const r = call(
      `export function run() { let r = /b/g; return [r.test("abc"), r.lastIndex]; }`,
      "run",
    ).result;
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k === "tuple") {
      expect(litValue(r.shape.elements[0]!)).toBe(true);
      expect(litValue(r.shape.elements[1]!)).toBe(2);
    }
    const r2 = call(
      `export function run() { let r = /b/g; return [r.exec("abc"), r.lastIndex]; }`,
      "run",
    ).result;
    expect(r2.shape.k).toBe("tuple");
    if (r2.shape.k === "tuple") {
      expect(litValue(r2.shape.elements[1]!)).toBe(2);
    }
  });

  it("failed exec resets lastIndex before next element reads it", () => {
    const r = call(
      `export function run() { let r = /b/g; r.exec("abc"); return [r.exec("abc") === null, r.lastIndex]; }`,
      "run",
    ).result;
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k === "tuple") {
      expect(litValue(r.shape.elements[0]!)).toBe(true);
      expect(litValue(r.shape.elements[1]!)).toBe(0);
    }
  });

  it("non-global regex keeps lastIndex at 0", () => {
    expect(
      str(`export function run() { let r = /b/; r.test("abc"); return r.lastIndex; }`),
    ).toBe(0);
  });
});
