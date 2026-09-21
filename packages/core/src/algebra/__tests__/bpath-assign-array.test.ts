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

describe("B-path Object.assign non-object sources (string/array prims)", () => {
  it("string literal source projects code-unit index props", () => {
    // 原生：Object.assign({}, 'ab') === {'0':'a','1':'b'}——按码元（非码点）逐位
    expect(litValue(call(`export function f() { return Object.assign({}, 'ab')['0']; }`).result)).toBe("a");
    expect(litValue(call(`export function f() { return Object.assign({}, 'ab')['1']; }`).result)).toBe("b");
    expect(
      litValue(call(`export function f() { return Object.keys(Object.assign({}, 'ab')).length; }`).result),
    ).toBe(2);
    // 代理对拆两个码元键（spread 按码点合并，assign 按 [[OwnPropertyKeys]] 码元——勿混用）
    expect(
      litValue(call(`export function f() { return Object.assign({}, '\uD83D\uDE00')['0'] === '\uD83D'; }`).result),
    ).toBe(true);
    expect(
      litValue(call(`export function f() { return Object.keys(Object.assign({}, '\uD83D\uDE00')).length; }`).result),
    ).toBe(2);
  });

  it("array source projects numeric keys and skips holes", () => {
    expect(litValue(call(`export function f() { return Object.assign({}, [7,,9])['0']; }`).result)).toBe(7);
    expect(litValue(call(`export function f() { return Object.assign({}, [7,,9])['2']; }`).result)).toBe(9);
    expect(
      litValue(call(`export function f() { return Object.keys(Object.assign({}, [7,,9])).length; }`).result),
    ).toBe(2);
    expect(litValue(call(`export function f() { return Object.assign({x: 0}, 'xy', {x: 2})['0']; }`).result)).toBe("x");
  });

  it("array target × string/array source writes indices", () => {
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], 'a')[0]; }`).result)).toBe("a");
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], 'a')[1]; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return Object.assign([9,9], 'xy')[1]; }`).result)).toBe("y");
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], [9])[0]; }`).result)).toBe(9);
    expect(litValue(call(`export function f() { return Object.assign([1,2,3], [9]).length; }`).result)).toBe(3);
    expect(litValue(call(`export function f() { return Object.assign([1,2], [7,,9])[2]; }`).result)).toBe(9);
    expect(litValue(call(`export function f() { return Object.assign([1,2], [7,,9]).length; }`).result)).toBe(3);
  });

  it("nullish / number / boolean sources are ignored (no throw, no props)", () => {
    expect(litValue(call(`export function f() { return Object.assign({a: 1}, null).a; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return Object.assign({a: 1}, undefined, null, 5, true).a; }`).result)).toBe(1);
    expect(
      litValue(call(`export function f() { return Object.keys(Object.assign({a: 1}, null, 5)).length; }`).result),
    ).toBe(1);
  });
});

describe("ast-eval Object.assign non-object source parity", () => {
  it("string source folds code-unit keys", () => {
    expect(litValue(analyzeFn(`function f() { return Object.assign({}, 'ab')['0']; }`, "f", []))).toBe("a");
    expect(
      litValue(analyzeFn(`function f() { return Object.keys(Object.assign({}, 'ab')).length; }`, "f", [])),
    ).toBe(2);
  });

  it("array source folds numeric keys", () => {
    // hole 源键跳过依赖 ast-eval 数组字面量 hole 建模（单独批次修）——
    // 此处用无 hole 字面量验证键投影本身
    expect(litValue(analyzeFn(`function f() { return Object.assign({}, [7,8,9])['2']; }`, "f", []))).toBe(9);
    expect(
      litValue(analyzeFn(`function f() { return Object.keys(Object.assign({}, [7,8,9])).length; }`, "f", [])),
    ).toBe(3);
  });

  it("array target × string/array source writes indices", () => {
    expect(litValue(analyzeFn(`function f() { return Object.assign([1,2,3], 'a')[0]; }`, "f", []))).toBe("a");
    expect(litValue(analyzeFn(`function f() { return Object.assign([1,2,3], [9])[0]; }`, "f", []))).toBe(9);
    expect(
      litValue(analyzeFn(`function f() { const t = Object.assign([1,2], [9]); return t.length + ':' + t[0]; }`, "f", [])),
    ).toBe("2:9");
  });

  it("nullish sources are ignored", () => {
    expect(litValue(analyzeFn(`function f() { return Object.assign({a: 1}, null, undefined).a; }`, "f", []))).toBe(1);
  });
});

describe("B-path Object.assign statement position", () => {
  // 语句位调用结果被丢弃——此前 assign 返回新容器但目标绑定不回写：
  // const t = {a:1}; Object.assign(t, {b:2}); return t 折 {a:1}（假精确）。
  it("writes through on obj target", () => {
    expect(
      litValue(call(`export function f() { const t = {a: 1}; Object.assign(t, {b: 2}); return t.b; }`).result),
    ).toBe(2);
  });

  it("writes through with string/array sources", () => {
    expect(
      litValue(call(`export function f() { const t = {a: 1}; Object.assign(t, 'bc'); return t['0'] + t['1'] + t.a; }`).result),
    ).toBe("bc1");
    expect(
      litValue(call(`export function f() { const t = [9,9]; Object.assign(t, 'xy'); return t[0] + t[1] + t.length; }`).result),
    ).toBe("xy2");
    expect(
      litValue(call(`export function f() { const t = [9,9]; Object.assign(t, [7]); return t[0] * 10 + t[1]; }`).result),
    ).toBe(79);
  });

  it("preserves aliasing (reference semantics)", () => {
    expect(
      litValue(call(`export function f() { const t = {a: 1}; const u = t; Object.assign(t, {b: 2}); return u.b; }`).result),
    ).toBe(2);
  });

  it("length key on array target writes through", () => {
    expect(
      litValue(call(`export function f() { const t = [1,2,3]; Object.assign(t, {length: 0}); return t.length; }`).result),
    ).toBe(0);
  });

  it("expression position still returns the merged value", () => {
    expect(
      litValue(call(`export function f() { const t = {a: 1}; return Object.assign(t, {b: 2}).b; }`).result),
    ).toBe(2);
    expect(litValue(call(`export function f() { const t = {a: 1}; return t.b; }`).result)).toBeUndefined();
  });
});

describe("ast-eval Object.assign statement parity", () => {
  it("statement position rebinds the target binding", () => {
    expect(
      litValue(analyzeFn(`function f() { const t = {a: 1}; Object.assign(t, {b: 2}); return t.b; }`, "f", [])),
    ).toBe(2);
    expect(
      litValue(analyzeFn(`function f() { const t = {a: 1}; Object.assign(t, 'bc'); return t['0'] + t['1']; }`, "f", [])),
    ).toBe("bc");
    expect(
      litValue(analyzeFn(`function f() { const t = [9,9]; Object.assign(t, 'xy'); return t[0] + t[1]; }`, "f", [])),
    ).toBe("xy");
  });
});
