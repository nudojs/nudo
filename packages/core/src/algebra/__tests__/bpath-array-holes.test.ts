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

describe("B-path array holes: mutator migration", () => {
  it("push keeps existing holes", () => {
    const r = call(`export function f() { const a = [1,,3]; a.push(4); return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.push(4); return 2 in a; }`);
    expect(litValue(r2.result)).toBe(true);
  });

  it("unshift shifts hole indices by count", () => {
    const r = call(`export function f() { const a = [1,,3]; a.unshift(0); return 2 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.unshift(0); return 3 in a; }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { const a = [1,,3]; a.unshift(0, 9); return 4 in a; }`);
    expect(litValue(r3.result)).toBe(true);
    const r4 = call(`export function f() { const a = [1,,3]; a.unshift(0, 9); return 3 in a; }`);
    expect(litValue(r4.result)).toBe(false);
  });

  it("pop truncates the hole list", () => {
    const r = call(`export function f() { const a = [1,,3]; a.pop(); return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.pop(); return a.length; }`);
    expect(litValue(r2.result)).toBe(2);
    const r3 = call(`export function f() { const a = [1,,]; a.pop(); return 1 in a; }`);
    expect(litValue(r3.result)).toBe(false);
    const r4 = call(`export function f() { const a = [1,,]; a.pop(); return a.length; }`);
    expect(litValue(r4.result)).toBe(1);
  });

  it("shift shifts hole indices down", () => {
    const r = call(`export function f() { const a = [1,,3]; a.shift(); return 0 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.shift(); return 1 in a; }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { const a = [1,,3]; a.shift(); return a[0]; }`);
    expect(litValue(r3.result)).toBe(undefined);
  });

  it("reverse mirrors hole indices", () => {
    const r = call(`export function f() { const a = [1,,3]; a.reverse(); return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.reverse(); return 0 in a; }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { const a = [1,,3]; a.reverse(); return a[0]; }`);
    expect(litValue(r3.result)).toBe(3);
  });

  it("length extension appends holes", () => {
    const r = call(`export function f() { const a = [1,,3]; a.length = 5; return 4 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.length = 5; return 3 in a; }`);
    expect(litValue(r2.result)).toBe(false);
    const r3 = call(`export function f() { const a = [1,,3]; a.length = 5; return 1 in a; }`);
    expect(litValue(r3.result)).toBe(false);
    const r4 = call(`export function f() { const a = [1,,3]; a.length = 5; return 2 in a; }`);
    expect(litValue(r4.result)).toBe(true);
    const r5 = call(`export function f() { const a = [1,,3]; a.length = 5; return a.length; }`);
    expect(litValue(r5.result)).toBe(5);
  });

  it("length shrink drops holes past the end", () => {
    const r = call(`export function f() { const a = [1,,3]; a.length = 1; return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.length = 1; return a.length; }`);
    expect(litValue(r2.result)).toBe(1);
  });

  it("out-of-bounds index write fills the gap with holes", () => {
    const r = call(`export function f() { const a = [1,,3]; a[4] = 9; return 3 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a[4] = 9; return 4 in a; }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { const a = [1,,3]; a[4] = 9; return a[3]; }`);
    expect(litValue(r3.result)).toBe(undefined);
  });

  it("index write into a literal hole clears it", () => {
    const r = call(`export function f() { const a = [1,,3]; a[1] = 5; return 1 in a; }`);
    expect(litValue(r.result)).toBe(true);
    const r2 = call(`export function f() { const a = [1,,3]; a[1] = 5; return a[1]; }`);
    expect(litValue(r2.result)).toBe(5);
  });

  it("fill clears holes in range and keeps them on no-op window", () => {
    const r = call(`export function f() { const a = [1,,3]; a.fill(9, 1, 2); return 1 in a; }`);
    expect(litValue(r.result)).toBe(true);
    const r2 = call(`export function f() { const a = [1,,3]; a.fill(9, 1, 2); return 0 in a; }`);
    expect(litValue(r2.result)).toBe(true);
    const r3 = call(`export function f() { const a = [1,,3]; a.fill(9, 2, 1); return 1 in a; }`);
    expect(litValue(r3.result)).toBe(false);
    const r4 = call(`export function f() { const a = [1,,3]; a.fill(9); return 1 in a; }`);
    expect(litValue(r4.result)).toBe(true);
  });

  it("copyWithin source hole deletes the target slot", () => {
    const r = call(`export function f() { const a = [1,,3]; a.copyWithin(1, 0, 2); return 2 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.copyWithin(1, 0, 2); return a[1]; }`);
    expect(litValue(r2.result)).toBe(1);
    const r3 = call(`export function f() { const a = [1,,3]; a.copyWithin(1, 0, 2); return a[2]; }`);
    expect(litValue(r3.result)).toBe(undefined);
  });

  it("copyWithin untouched holes stay holes", () => {
    const r = call(`export function f() { const a = [1,,3]; a.copyWithin(2, 0, 1); return 1 in a; }`);
    expect(litValue(r.result)).toBe(false);
    const r2 = call(`export function f() { const a = [1,,3]; a.copyWithin(2, 0, 1); return a[2]; }`);
    expect(litValue(r2.result)).toBe(1);
  });

  it("copyWithin zero count is a no-op", () => {
    const r = call(`export function f() { const a = [1,2,3]; a.copyWithin(0, 5); return a[0]; }`);
    expect(litValue(r.result)).toBe(1);
    const r2 = call(`export function f() { const a = [1,2,3]; a.copyWithin(0, 5); return 0 in a; }`);
    expect(litValue(r2.result)).toBe(true);
  });
});
