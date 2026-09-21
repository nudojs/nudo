/**
 * B-path 对象不变性差分回归（strict ESM 语义）。
 * 回归背景：Object.freeze/seal/preventExtensions/defineProperty 完全未建模——
 * freeze 后 o.a=2 静默失败（原生 o.a 仍 1）而 B-path 写入成功。
 * 现按 strict 模块语义建模：不可变/不可扩展/不可写目标的写与删抛
 * TypeError（NudoThrow → never + throws），catch 可吸收；
 * 可写路径（seal 已有键、preventExtensions 已有键、writable:true）照常写入。
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

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("B-path object invariants", () => {
  it("freeze writes to existing slots throw TypeError", () => {
    const r = call(`export function run() { let o = {a: 1}; Object.freeze(o); o.a = 2; return o.a; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("freeze adding new slots throws TypeError", () => {
    const r = call(`export function run() { let o = {a: 1}; Object.freeze(o); o.b = 2; return o.b; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("freeze delete throws TypeError", () => {
    const r = call(`export function run() { let o = {a: 1}; Object.freeze(o); delete o.a; return o.a; }`, "run");
    expect(isNever(r.result)).toBe(true);
    const r2 = call(`export function run() { let o = {a: 1}; Object.freeze(o); return delete o.a; }`, "run");
    expect(isNever(r2.result)).toBe(true);
  });

  it("isFrozen reflects freeze", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); return Object.isFrozen(o); }`)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; return Object.isFrozen(o); }`)).toBe(false);
  });

  it("seal allows existing-slot writes; new slots and delete throw", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); o.a = 2; return o.a; }`)).toBe(2);
    expect(isNever(call(`export function run() { let o = {a: 1}; Object.seal(o); o.b = 2; return o.b; }`, "run").result)).toBe(true);
    expect(isNever(call(`export function run() { let o = {a: 1}; Object.seal(o); return delete o.a; }`, "run").result)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); return Object.isSealed(o); }`)).toBe(true);
  });

  it("preventExtensions new slots throw; existing writes and delete ok", () => {
    expect(isNever(call(`export function run() { let o = {a: 1}; Object.preventExtensions(o); o.b = 2; return o.b; }`, "run").result)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); o.a = 2; return o.a; }`)).toBe(2);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); return delete o.a; }`)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); return Object.isExtensible(o); }`)).toBe(false);
    expect(str(`export function run() { let o = {a: 1}; return Object.isExtensible(o); }`)).toBe(true);
  });

  it("defineProperty default writable:false writes throw TypeError", () => {
    expect(isNever(call(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1}); o.p = 2; return o.p; }`, "run").result)).toBe(true);
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

  it("frozen arrays index write throws TypeError", () => {
    const r = call(`export function run() { let a = [1, 2]; Object.freeze(a); a[0] = 9; return a; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
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

  // ES 规范：非对象（prim/null/undefined）恒 frozen/sealed、不可扩展（不抛）。
  it("primitives are always frozen/sealed and not extensible", () => {
    expect(str(`export function run() { return Object.isFrozen(5); }`)).toBe(true);
    expect(str(`export function run() { return Object.isSealed(5); }`)).toBe(true);
    expect(str(`export function run() { return Object.isExtensible(5); }`)).toBe(false);
    expect(str(`export function run() { return Object.isFrozen('s'); }`)).toBe(true);
    expect(str(`export function run() { return Object.isSealed(true); }`)).toBe(true);
    expect(str(`export function run() { return Object.isExtensible(false); }`)).toBe(false);
  });

  it("null/undefined are frozen/sealed and not extensible (no throw)", () => {
    expect(str(`export function run() { return Object.isFrozen(null); }`)).toBe(true);
    expect(str(`export function run() { return Object.isSealed(null); }`)).toBe(true);
    expect(str(`export function run() { return Object.isExtensible(null); }`)).toBe(false);
    expect(str(`export function run() { return Object.isFrozen(undefined); }`)).toBe(true);
    expect(str(`export function run() { return Object.isSealed(undefined); }`)).toBe(true);
    expect(str(`export function run() { return Object.isExtensible(undefined); }`)).toBe(false);
  });

  it("freeze/seal/preventExtensions on primitives return the primitive", () => {
    expect(str(`export function run() { return Object.freeze(5); }`)).toBe(5);
    expect(str(`export function run() { return Object.seal('s'); }`)).toBe("s");
    expect(str(`export function run() { return Object.preventExtensions(true); }`)).toBe(true);
    expect(str(`export function run() { return Object.freeze(null); }`)).toBe(null);
    expect(str(`export function run() { return Object.preventExtensions(undefined); }`)).toBe(undefined);
  });

  // {...frozen} 是**新对象**，不携带 frozen 不变性（原生 identity 也不共享）。
  it("spread of a frozen object produces an unfrozen copy", () => {
    expect(
      str(`export function run() { let o = Object.freeze({a: 1}); return Object.isFrozen({...o}); }`),
    ).toBe(false);
    expect(
      str(`export function run() { let o = Object.freeze({a: 1}); let c = {...o}; return Object.isFrozen(c); }`),
    ).toBe(false);
  });

  it("spread copy is independent (writes do not mutate the source)", () => {
    expect(
      str(
        `export function run() { let o = {a: 1}; let c = {...o}; c.a = 9; return o.a; }`,
      ),
    ).toBe(1);
  });

  it("spread still copies slots and preserves later overrides", () => {
    expect(str(`export function run() { let o = {a: 1, b: 2}; let c = {...o, b: 3}; return c.a + ':' + c.b; }`)).toBe("1:3");
    expect(str(`export function run() { let o = {a: 1}; return ({...o}).a; }`)).toBe(1);
  });
});
