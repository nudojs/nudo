/**
 * Bug 10 修复的连带缺口（差分引爆）：`undefined + <数值>` 折 exact NaN 后，
 * 两个既有 imprecision 从「number|string 并集（差分容忍）」变成「exact
 * 错值」被差分抓到，必须一并修复：
 *
 * 1. 解构赋值成员目标（`[o.x,o.y]=[1,2]` / `({ p: o.x } = o)`）——
 *    emitDestructure 只认 Identifier 目标，成员写被静默丢弃，`o.x` 读折
 *    exact undefined，`o.x + o.y` 折 exact NaN（native 3）。
 *    修复：emitMemberTargetAssign 逐项写回（可重绑根走不可变更新链）。
 * 2. TypedArray 下标读（`new Uint8Array([1,2,3])[0]`）——brand 内层空
 *    obj 落 exact undefined，`a[0] + a[2]` 折 exact NaN（native 4）。
 *    修复：$idx 对 TypedArray brand 返回 元素 prim ∪ undefined（长度未
 *    建模，下标可能越界）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(call(src).result);
}

describe("destructure assignment to member targets", () => {
  it("[o.x, o.y] = [1,2] writes members (native 3)", () => {
    expect(val(`export function f() { let o={}; [o.x,o.y]=[1,2]; return o.x+o.y; }`)).toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { let o={}; [o.x,o.y]=[1,2]; return o.x; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { let o={}; [o.x,o.y]=[1,2]; return o.y; }`)).toEqual({ ok: true, value: 2 });
  });

  it("({ p: o.x } = src) writes named member", () => {
    expect(val(`export function f() { let o={}; ({ p: o.x, q: o.y } = { p: 5, q: 6 }); return o.x + o.y; }`)).toEqual({ ok: true, value: 11 });
  });

  it("nested member chains write through the immutable update chain", () => {
    expect(val(`export function f() { const o = { a: { b: 0 } }; [o.a.b] = [7]; return o.a.b; }`)).toEqual({ ok: true, value: 7 });
  });

  it("member target keeps the expression value = RHS", () => {
    expect(val(`export function f() { let o={}; return ([o.x] = [9]).length; }`)).toEqual({ ok: true, value: 1 });
  });

  it("identifier targets still bind (no regression)", () => {
    expect(val(`export function f() { let a, b; [a, b] = [1, 2]; return a + b; }`)).toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { const { x, y } = { x: 1, y: 2 }; return x + y; }`)).toEqual({ ok: true, value: 3 });
  });
});

describe("TypedArray index read domain", () => {
  it("u8[i] is number | undefined (element domain ∪ OOB), never exact undefined", () => {
    const r = call(`export function f() { const a = new Uint8Array([1,2,3]); return a[0]; }`).result;
    expect(formatShape(r)).toBe("number | undefined");
  });

  it("u8[0] + u8[2] folds number domain (no exact NaN, no string arm)", () => {
    const r = call(`export function f() { const a = new Uint8Array([1,2,3]); return a[0] + a[2]; }`).result;
    expect(formatShape(r)).not.toContain("string");
    expect(formatShape(r)).not.toBe("NaN");
    expect(formatShape(r)).toContain("number");
  });

  it("BigInt64Array element domain is bigint", () => {
    const r = call(`export function f() { const a = new BigInt64Array(2); return a[0]; }`).result;
    expect(formatShape(r)).toBe("bigint | undefined");
  });
});
