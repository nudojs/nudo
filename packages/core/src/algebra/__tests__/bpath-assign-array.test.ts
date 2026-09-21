/**
 * Object.assign 到数组 target 不按下标/长度键写（假精确）：
 * 原生 Object.assign([], {0:'a'}).length === 1，B-path runtimeAssignObject
 * 只处理 obj×obj——数组 target 的下标写、length 键覆盖全部被忽略，
 * 折原数组长度（假精确）。ast-eval（builtins evalObjectMethod "assign"）
 * 同源。
 * 修复：数组 target 分支按源键序逐键写——数字键经 canonicalArrayIndex
 * 按下标写（扩展 length）、"length" 键截断/延长（延长段 hole、非法
 * length 原生 RangeError）、非规范数字键 expando 忽略；getter 源调用
 * getter（与 obj 分支同口径）；frozen/sealed 新下标 strict TypeError。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { analyzeFn } from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

describe("B-path Object.assign to array target", () => {
  it("numeric keys write indices and extend length", () => {
    expect(litValue(call(`export function f() { return Object.assign([], {0:'a'}).length; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return Object.assign([], {0:'a'})[0]; }`).result)).toBe("a");
    expect(litValue(call(`export function f() { return Object.assign([], {5:'x'}).length; }`).result)).toBe(6);
    expect(litValue(call(`export function f() { return Object.assign([], {5:'x'})[5]; }`).result)).toBe("x");
    expect(litValue(call(`export function f() { return Object.assign([], {'2':'a'}).length; }`).result)).toBe(3);
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], {1:'y'})[1]; }`).result)).toBe("y");
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], {1:'y'}).length; }`).result)).toBe(3);
  });

  it("non-canonical numeric keys are expandos (no length effect)", () => {
    expect(litValue(call(`export function f() { return Object.assign([], {2.5:'a'}).length; }`).result)).toBe(0);
    expect(litValue(call(`export function f() { return Object.assign([], {'01':'x'}).length; }`).result)).toBe(0);
    expect(litValue(call(`export function f() { return Object.assign([], {'4294967295':'x'}).length; }`).result)).toBe(0);
  });

  it("length key truncates and extends (extended segment is holes)", () => {
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], {length: 0}).length; }`).result)).toBe(0);
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], {length: 1}).length; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], {length: 1})[0]; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return Object.assign([1,2], {length: 5}).length; }`).result)).toBe(5);
    expect(litValue(call(`export function f() { return 2 in Object.assign([1,2], {length: 5}); }`).result)).toBe(false);
  });

  it("source key order matters (idx then length truncates the write)", () => {
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], {0:'z', length: 0}).length; }`).result)).toBe(0);
    expect(litValue(call(`export function f() { return 3 in Object.assign([1,2], {3:'x', length: 2}); }`).result)).toBe(false);
  });

  it("getter source keys are invoked", () => {
    expect(
      litValue(call(`export function f() { return Object.assign([], {get 0(){ return 9; }})[0]; }`).result),
    ).toBe(9);
    expect(
      litValue(call(`export function f() { return Object.assign([], {get 0(){ return 9; }}).length; }`).result),
    ).toBe(1);
  });

  it("invalid length throws RangeError (catchable)", () => {
    for (const src of [
      `export function f() { try { Object.assign([1], {length: -1}); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Object.assign([1], {length: 2.5}); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Object.assign([1], {length: NaN}); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
    const r = call(`export function f() { return Object.assign([1], {length: -1}); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  });

  it("frozen/sealed targets keep strict TypeError semantics", () => {
    expect(
      litValue(
        call(
          `export function f() { try { const a = Object.freeze([1]); Object.assign(a, {1: 2}); } catch(e) { return 'caught'; } return 'missed'; }`,
        ).result,
      ),
    ).toBe("caught");
    expect(
      litValue(
        call(
          `export function f() { try { const a = Object.seal([1]); Object.assign(a, {1: 2}); } catch(e) { return 'caught'; } return 'missed'; }`,
        ).result,
      ),
    ).toBe("caught");
    // sealed 已有下标照常写
    expect(
      litValue(call(`export function f() { const a = Object.seal([1,2]); return Object.assign(a, {1: 9})[1]; }`).result),
    ).toBe(9);
  });
});

describe("ast-eval Object.assign to array parity", () => {
  it("numeric keys and length keys match B-path", () => {
    // 注意：ast-eval 空数组字面量 [] 折 arr（未知长度）——空 target 不精确
    // 是既有形状差异（保守不假精确）；非空数组走 tuple 分支与 B-path 同轨
    expect(
      litValue(analyzeFn(`function f() { const a = Object.assign([1,2], {1:'y'}); return a[1] + ':' + a.length; }`, "f", [])),
    ).toBe("y:2");
    expect(litValue(analyzeFn(`function f() { const a = Object.assign([1,2,3], {length: 0}); return a.length; }`, "f", []))).toBe(0);
    expect(litValue(analyzeFn(`function f() { return Object.assign([1,2], {length: 5}).length; }`, "f", []))).toBe(5);
    expect(litValue(analyzeFn(`function f() { return Object.assign([1], {2:'x'}).length; }`, "f", []))).toBe(3);
  });

  it("invalid length is caught", () => {
    expect(
      litValue(analyzeFn(`function f() { try { Object.assign([1], {length: -1}); } catch(e) { return 'caught'; } return 'missed'; }`, "f", [])),
    ).toBe("caught");
  });
});
