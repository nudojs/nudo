/**
 * B-path String 方法位置/限制参数差分回归。
 * 回归背景：includes/startsWith/endsWith/split 忽略第二个实参——
 * "hello".includes("ell", 2) 折 true（原生 false）、"a,b,c".split(",", 2)
 * 折 3 元素（原生截断 2）、startsWith("he", 1) 折 true（原生 false）。
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

/** split 折 tuple：提取元素字面量数组 */
function splitOf(src: string) {
  const r = call(src, "run").result;
  if (r.shape.k !== "tuple") return undefined;
  return r.shape.elements.map((e) => litValue(e));
}

describe("B-path string method positional args", () => {
  it("includes with fromIndex", () => {
    expect(str(`export function run() { return "hello".includes("ell", 2); }`)).toBe(false);
    expect(str(`export function run() { return "hello".includes("ell", 1); }`)).toBe(true);
    expect(str(`export function run() { return "hello".includes("ell", 3); }`)).toBe(false);
  });

  it("includes negative fromIndex counts from 0", () => {
    expect(str(`export function run() { return "hello".includes("ell", -1); }`)).toBe(true);
    expect(str(`export function run() { return "hello".includes("hello", -100); }`)).toBe(true);
  });

  it("startsWith with position", () => {
    expect(str(`export function run() { return "hello".startsWith("he", 1); }`)).toBe(false);
    expect(str(`export function run() { return "hello".startsWith("ell", 1); }`)).toBe(true);
    expect(str(`export function run() { return "hello".startsWith("ell", 2); }`)).toBe(false);
  });

  it("endsWith with length", () => {
    expect(str(`export function run() { return "hello".endsWith("lo", 4); }`)).toBe(false);
    expect(str(`export function run() { return "hello".endsWith("he", 2); }`)).toBe(true);
    expect(str(`export function run() { return "hello".endsWith("hell", 4); }`)).toBe(true);
  });

  it("endsWith length clamps at string length", () => {
    expect(str(`export function run() { return "hello".endsWith("lo", 100); }`)).toBe(true);
  });

  it("positional NaN behaves like 0", () => {
    expect(str(`export function run() { return "hello".startsWith("hell", NaN); }`)).toBe(true);
    expect(str(`export function run() { return "hello".includes("hell", NaN); }`)).toBe(true);
    expect(str(`export function run() { return "hello".endsWith("lo", NaN); }`)).toBe(false);
  });

  it("explicit undefined positional arg equals omission", () => {
    expect(str(`export function run() { return "hello".includes("ell", undefined); }`)).toBe(true);
    expect(str(`export function run() { return "hello".startsWith("he", undefined); }`)).toBe(true);
  });

  it("split with limit", () => {
    expect(splitOf(`export function run() { return "a,b,c".split(",", 2); }`)).toEqual(["a", "b"]);
    expect(splitOf(`export function run() { return "a,b,c".split(",", 0); }`)).toEqual([]);
    expect(splitOf(`export function run() { return "a,b,c".split(",", 1); }`)).toEqual(["a"]);
    expect(splitOf(`export function run() { return "abc".split("", 2); }`)).toEqual(["a", "b"]);
  });

  it("split negative limit keeps all (ToUint32 wraps)", () => {
    expect(splitOf(`export function run() { return "a,b,c".split(",", -1); }`)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("split limit beyond part count keeps all", () => {
    expect(splitOf(`export function run() { return "a,b,c".split(",", 9); }`)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("split explicit undefined limit equals omission", () => {
    expect(splitOf(`export function run() { return "a,b,c".split(",", undefined); }`)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("no second arg keeps previous behavior", () => {
    expect(str(`export function run() { return "hello".includes("ell"); }`)).toBe(true);
    expect(splitOf(`export function run() { return "a,b,c".split(","); }`)).toEqual(["a", "b", "c"]);
  });
});
