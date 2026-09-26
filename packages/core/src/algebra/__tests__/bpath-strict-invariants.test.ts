/**
 * strict 语义下不可变对象写入应 THROW（原生 ESM 模块 hard TypeError），
 * B 路径按 sloppy 静默失败建模：freeze 写/删/++、seal 加新键、
 * defineProperty writable:false 写、configurable:false 删、getter-only 写、
 * frozen 数组 push/pop/length/下标写——全部折出「写入成功」的假精确/假成功，
 * try/catch 捕获不到（native "caught" vs bpath 旧值）。
 * 修复：写路径（$set/$del/$arrMutContainer/$idxSet/runtimeAssignObject）
 * 遇不可变约束抛 NudoThrow(TypeError)——无 catch 中断执行（never + throws），
 * catch 经 $catchVal 吸收为 TypeError 绑定。
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

describe("B-path strict writes to frozen objects", () => {
  it("write to frozen slot throws TypeError", () => {
    const r = call(`export function f() { let o={a:1}; Object.freeze(o); o.a=2; return o.a; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("compound/update writes to frozen slot throw", () => {
    expect(isNever(call(`export function f() { let o={a:1}; Object.freeze(o); o.a+=2; return o.a; }`).result)).toBe(true);
    expect(isNever(call(`export function f() { let o={a:1}; Object.freeze(o); o.a++; return o.a; }`).result)).toBe(true);
  });

  it("delete frozen slot throws", () => {
    const r = call(`export function f() { let o={a:1}; Object.freeze(o); delete o.a; return o.a; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("delete expression on frozen throws (strict delete)", () => {
    const r = call(`export function f() { let o={a:1}; Object.freeze(o); return delete o.a; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("alias write throws", () => {
    const r = call(`export function f() { let o={a:1}; Object.freeze(o); const b=o; b.a=2; return b.a; }`);
    expect(isNever(r.result)).toBe(true);
  });

  it("read after freeze still works", () => {
    expect(litValue(call(`export function f() { let o={a:1}; Object.freeze(o); return o.a; }`).result)).toBe(1);
  });

  it("try/catch absorbs the throw", () => {
    const r = call(`export function f() { let o={a:1}; Object.freeze(o); try { o.a=2; } catch(e) { return 'caught'; } return o.a; }`);
    expect(litValue(r.result)).toBe("caught");
    const r2 = call(`export function f() { let o={a:1}; Object.freeze(o); try { o.a=2; } catch(e) {} return o.a; }`);
    expect(litValue(r2.result)).toBe(1);
  });
});

describe("B-path strict writes to sealed/nonextensible objects", () => {
  it("seal existing-slot write ok", () => {
    expect(litValue(call(`export function f() { let o={a:1}; Object.seal(o); o.a=2; return o.a; }`).result)).toBe(2);
  });

  it("seal new-slot write throws", () => {
    const r = call(`export function f() { let o={a:1}; Object.seal(o); o.b=2; return o.b; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("preventExtensions new-slot write throws", () => {
    const r = call(`export function f() { let o={a:1}; Object.preventExtensions(o); o.b=2; return o.b; }`);
    expect(isNever(r.result)).toBe(true);
  });

  it("preventExtensions existing write and delete ok", () => {
    expect(litValue(call(`export function f() { let o={a:1}; Object.preventExtensions(o); o.a=2; return o.a; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { let o={a:1}; Object.preventExtensions(o); return delete o.a; }`).result)).toBe(true);
  });
});

describe("B-path strict writes to non-writable/non-configurable props", () => {
  it("write to writable:false throws", () => {
    const r = call(`export function f() { let o={}; Object.defineProperty(o, 'p', {value: 1, writable: false}); o.p=2; return o.p; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("update on writable:false throws", () => {
    const r = call(`export function f() { let o={}; Object.defineProperty(o, 'p', {value: 1, writable: false}); o.p++; return o.p; }`);
    expect(isNever(r.result)).toBe(true);
  });

  it("delete non-configurable throws", () => {
    const r = call(`export function f() { let o={}; Object.defineProperty(o, 'p', {value: 1, configurable: false}); delete o.p; return o.p; }`);
    expect(isNever(r.result)).toBe(true);
  });
});

describe("B-path strict writes to getter-only props", () => {
  it("object literal getter-only write throws", () => {
    const r = call(`export function f() { const o={ get x(){ return 5; } }; o.x=9; return o.x; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("class getter-only write throws", () => {
    const r = call(`export function f() { class A { get v(){ return 42; } } const a=new A(); a.v=1; return a.v; }`);
    expect(isNever(r.result)).toBe(true);
  });
});

describe("B-path strict mutators on frozen arrays", () => {
  it("index write throws", () => {
    const r = call(`export function f() { let a=[1,2]; Object.freeze(a); a[0]=9; return a[0]; }`);
    expect(isNever(r.result)).toBe(true);
  });

  it("push/pop throw", () => {
    expect(isNever(call(`export function f() { let a=[1,2]; Object.freeze(a); a.push(3); return a.length; }`).result)).toBe(true);
    expect(isNever(call(`export function f() { let a=[1,2]; Object.freeze(a); a.pop(); return a.length; }`).result)).toBe(true);
  });

  it("length write throws", () => {
    const r = call(`export function f() { let a=[1,2]; Object.freeze(a); a.length=0; return a.length; }`);
    expect(isNever(r.result)).toBe(true);
  });
});
