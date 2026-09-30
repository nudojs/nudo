/**
 * const 绑定再赋值必须 TypeError（strict/ESM）。
 * 回归背景：transpile 把 `const` 降成 `let`（成员写要重绑根），用户层
 * `x = 2` / `x++` / `x += 1` 也跟着静默成功——原生 Assignment to constant
 * variable 抛 TypeError，求值引擎折出新值（假成功）。同类覆盖：块内/函数内
 * const、解构赋值、for-of/for-in 的 const 头、逻辑赋值真正写入时。
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
  return (
    !!a &&
    typeof a === "object" &&
    a.shape?.k === "brand" &&
    a.shape.name === "TypeError"
  );
}

function expectConstAssignThrows(src: string, fnName = "f") {
  const r = call(src, fnName);
  expect(isNever(r.result)).toBe(true);
  expect(throwsTypeError(r.throws)).toBe(true);
}

describe("const binding reassignment throws TypeError", () => {
  it("const x = 1; x = 2 throws", () => {
    expectConstAssignThrows(
      `export function f() { const x = 1; x = 2; return x; }`,
    );
  });

  it("const x = 1; x++ / ++x / x-- throw", () => {
    expectConstAssignThrows(
      `export function f() { const x = 1; x++; return x; }`,
    );
    expectConstAssignThrows(
      `export function f() { const x = 1; ++x; return x; }`,
    );
    expectConstAssignThrows(
      `export function f() { const x = 1; x--; return x; }`,
    );
  });

  it("compound assignment on const throws", () => {
    expectConstAssignThrows(
      `export function f() { const x = 1; x += 1; return x; }`,
    );
    expectConstAssignThrows(
      `export function f() { const x = 1; x *= 2; return x; }`,
    );
  });

  it("logical assignment that writes throws (x &&= when x is truthy)", () => {
    expectConstAssignThrows(
      `export function f() { const x = 1; x &&= 2; return x; }`,
    );
    expectConstAssignThrows(
      `export function f() { const x = 0; x ||= 2; return x; }`,
    );
    expectConstAssignThrows(
      `export function f() { const x = null; x ??= 2; return x; }`,
    );
  });

  it("logical assignment that short-circuits does not throw", () => {
    // x=1 is truthy → ||= never writes
    const r = call(`export function f() { const x = 1; x ||= 2; return x; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("block-scoped and function-scoped const", () => {
    expectConstAssignThrows(
      `export function f() { const x = 1; { x = 2; } return x; }`,
    );
    expectConstAssignThrows(
      `export function f() { const x = 1; x = 2; return x; }`,
    );
  });

  it("destructuring assignment to const throws", () => {
    expectConstAssignThrows(
      `export function f() { const [a] = [1]; a = 2; return a; }`,
    );
    expectConstAssignThrows(
      `export function f() { const {p} = {p:1}; p = 2; return p; }`,
    );
    expectConstAssignThrows(
      `export function f() { const [a,b] = [1,2]; [a,b] = [b,a]; return a; }`,
    );
  });

  it("for-of / for-in const header binding is immutable", () => {
    expectConstAssignThrows(
      `export function f() { for (const x of [1]) { x = 2; } return 1; }`,
    );
    expectConstAssignThrows(
      `export function f() { for (const x of [1]) { x++; } return 1; }`,
    );
    expectConstAssignThrows(
      `export function f() { for (const k in {a:1}) { k = 2; } return 1; }`,
    );
  });

  it("let / var stay mutable", () => {
    expect(litValue(call(`export function f() { let x = 1; x = 2; return x; }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { var x = 1; x++; return x; }`).result)).toEqual({ ok: true, value: 2 });
  });

  it("shadowing: inner let over outer const is mutable", () => {
    const r = call(
      `export function f() { const x = 1; { let x = 2; x = 3; return x; } return x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("shadowing: inner const over outer let throws only inside", () => {
    expectConstAssignThrows(
      `export function f() { let x = 1; { const x = 2; x = 3; } return x; }`,
    );
    const r = call(`export function f() { let x = 1; x = 4; return x; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("const object member write is still allowed", () => {
    const r = call(
      `export function f() { const o = {a:1}; o.a = 2; return o.a; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("const array index / mutator still allowed", () => {
    const r = call(`export function f() { const a = [1]; a[0] = 2; return a[0]; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    const r2 = call(`export function f() { const a = [1]; a.push(2); return a.length; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  });

  it("function parameters stay mutable", () => {
    const r = call(`export function f() { function g(x) { x = 2; return x; } return g(1); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("catch binding stays mutable", () => {
    const r = call(
      `export function f() { try { throw 1; } catch (e) { e = 2; return e; } }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});
