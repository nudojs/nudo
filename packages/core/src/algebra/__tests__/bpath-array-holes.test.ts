/**
 * B 路径数组 hole 语义：delete a[1] 与 [1,,3] 字面量产生 hole 槽位——
 * 读值为 undefined，但 `in` 判定为 false（区别于显式 undefined 槽）。
 * 此前 $del 把元素置 undefined 字面量（槽仍存在），$in 按 length 判断，
 * `1 in a` 恒 true；数组字面量 hole 元素还被整体跳过压缩下标。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path array holes", () => {
  it("delete a[1] then 1 in a is false", () => {
    const r = call(`export function f() { const a = [1,2,3]; delete a[1]; return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
  });

  it("delete a[1] leaves neighbors present", () => {
    const r = call(`export function f() { const a = [1,2,3]; delete a[1]; return 0 in a; }`);
    expect(litValue(r.result)).toBe(true);
    const r2 = call(`export function f() { const a = [1,2,3]; delete a[1]; return 2 in a; }`);
    expect(litValue(r2.result)).toBe(true);
  });

  it("delete a[1] reads undefined but length unchanged", () => {
    const r = call(`export function f() { const a = [1,2,3]; delete a[1]; return a[1]; }`);
    expect(formatShape(r.result)).toBe("undefined");
    const r2 = call(`export function f() { const a = [1,2,3]; delete a[1]; return a.length; }`);
    expect(litValue(r2.result)).toBe(3);
  });

  it("writing into a hole restores presence", () => {
    const r = call(
      `export function f() { const a = [1,2,3]; delete a[1]; a[1] = 5; return 1 in a; }`,
    );
    expect(litValue(r.result)).toBe(true);
  });

  it("out-of-bounds delete leaves length unchanged", () => {
    const r = call(`export function f() { const a = [1,2,3]; delete a[9]; return a.length; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("literal [1,,3]: 1 in is false, 2 in is true", () => {
    const r = call(`export function f() { return 1 in [1,,3]; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { return 2 in [1,,3]; }`);
    expect(litValue(r2.result)).toBe(true);
  });

  it("literal [1,,3] keeps length 3 and undefined read", () => {
    const r = call(`export function f() { return [1,,3].length; }`);
    expect(litValue(r.result)).toBe(3);
    const r2 = call(`export function f() { return [1,,3][1]; }`);
    expect(formatShape(r2.result)).toBe("undefined");
  });

  it("regression: existing slot stays present", () => {
    const r = call(`export function f() { const a = [1]; return 0 in a; }`);
    expect(litValue(r.result)).toBe(true);
  });

  it("regression: object delete then in is false", () => {
    const r = call(`export function f() { const o = { a: 1 }; delete o.a; return "a" in o; }`);
    expect(litValue(r.result)).toBe(false);
  });
});
