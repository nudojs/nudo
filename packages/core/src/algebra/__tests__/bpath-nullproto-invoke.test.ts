/**
 * 缺失成员调用不抛 TypeError（假精确）：
 * 原生 Object.create(null).toString() / ({}).foo() / o.f=5 后 o.f() 均
 * TypeError，B-path $invoke 槽 miss/值非函数后落 fallthrough 折 unknown——
 * catch 不进入，r 保持旧值（假精确）。null-proto 的对象尤其确定：无
 * Object.prototype 可回退，任何缺失方法名都确定缺失。
 * 修复：definitelyUncallableMember 共用判定（null-proto 缺失名 / 闭 exact
 * 对象非 OP 名缺失槽 / 槽值字面量非可调用）→ NudoThrow(TypeError)；
 * ast-eval 同判定返回 EvalResult{threw}。open/path 对象（spread/assign/
 * create(proto) 产物）与 OP 原型名保持保守不抛（避免假抛 false positive）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("B-path null-proto method calls throw", () => {
  it("Object.prototype methods are caught", () => {
    for (const m of [
      "toString()",
      "valueOf()",
      "toLocaleString()",
      "hasOwnProperty('x')",
      "isPrototypeOf({})",
      "propertyIsEnumerable('x')",
      "constructor()",
      "__defineGetter__('x', () => 1)",
    ]) {
      const src = `export function f() { try { Object.create(null).${m}; } catch(e) { return 'caught'; } return 'missed'; }`;
      expect(litValue(call(src).result), m).toBe("caught");
    }
  });

  it("arbitrary missing names throw too (no prototype chain)", () => {
    expect(
      litValue(call(`export function f() { try { Object.create(null).foo(); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toBe("caught");
    const r = call(`export function f() { return Object.create(null).foo(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("own-slot methods still dispatch", () => {
    expect(
      litValue(
        call(`export function f() { const o = Object.create(null); o.toString = () => 'own'; return o.toString(); }`).result,
      ),
    ).toBe("own");
    expect(
      litValue(
        call(`export function f() { const o = Object.create(null); o.hasOwnProperty = () => 'own2'; return o.hasOwnProperty('x'); }`).result,
      ),
    ).toBe("own2");
  });

  it("property reads stay undefined (no throw)", () => {
    expect(
      litValue(call(`export function f() { return Object.create(null).toString; }`).result),
    ).toBe(undefined);
    expect(
      litValue(call(`export function f() { return Object.create(null).x; }`).result),
    ).toBe(undefined);
  });
});

describe("B-path definitely-uncallable member calls throw", () => {
  it("closed object missing method throws", () => {
    for (const src of [
      `export function f() { try { ({}).foo(); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { const o = {a: 1}; o.foo(); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
    const r = call(`export function f() { return ({}).foo(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("non-callable slot value throws", () => {
    for (const src of [
      `export function f() { try { const o = {f: 5}; o.f(); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { const o = {f: null}; o.f(); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { const o = {}; o.toString = undefined; o.toString(); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { const o = Object.create(null); o.f = 'x'; o.f(); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });

  it("Object.prototype names and open objects stay conservative (no throw)", () => {
    // OP 名：原生经原型链存在，B-path 未建模 → 保守 unknown 不抛
    expect(
      litValue(call(`export function f() { return ({}).toString(); }`).result),
    ).toBe(undefined);
    // spread 产物 open 对象：运行时可能有方法 → 保守
    expect(
      litValue(call(`export function f() { const o = {...{x: 1}}; return o.foo(); }`).result),
    ).toBe(undefined);
    // create(proto) 动态原型不建模（path conf）→ 保守
    expect(
      litValue(call(`export function f() { const p = {greet() { return 'hi'; }}; return Object.create(p).greet(); }`).result),
    ).toBe(undefined);
  });

  it("existing methods unaffected", () => {
    expect(
      litValue(call(`export function f() { const o = {m() { return 7; }}; return o.m(); }`).result),
    ).toBe(7);
    expect(
      litValue(call(`export function f() { const o = Object.assign({}, {foo() { return 3; }}); return o.foo(); }`).result),
    ).toBe(3);
  });
});

