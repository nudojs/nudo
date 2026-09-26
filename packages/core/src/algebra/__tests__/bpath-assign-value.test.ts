/**
 * B 路径赋值表达式的值：JS 语义下 `o.x = v` / `o.x += v` / `o.x ??= v` 的
 * 表达式值是「写入的值」（rhs 结果），不是容器。此前 member 路径直接
 * `return root = $set(...)`，把 $set 返回的新容器当表达式值。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path assignment expression value", () => {
  it("(o.x = 5) is 5", () => {
    const r = call(`export function f() { const o = {}; return (o.x = 5); }`);
    expect(litValue(r.result)).toBe(5);
  });

  it("(o.x += 5) is the new value and writes through", () => {
    const r = call(`export function f() { const o = { x: 1 }; const v = (o.x += 5); return v * 10 + o.x; }`);
    expect(litValue(r.result)).toBe(66);
  });

  it("(o.x -= 3) is the new value", () => {
    const r = call(`export function f() { const o = { x: 10 }; return (o.x -= 3); }`);
    expect(litValue(r.result)).toBe(7);
  });

  it("(a[0] = 7) is 7", () => {
    const r = call(`export function f() { const a = [undefined]; return (a[0] = 7); }`);
    expect(litValue(r.result)).toBe(7);
  });

  it("(o.x.y = 5) is 5 on nested path", () => {
    const r = call(`export function f() { const o = { x: {} }; return (o.x.y = 5); }`);
    expect(litValue(r.result)).toBe(5);
  });

  it("(o.x ??= 5) is 5 when unset", () => {
    const r = call(`export function f() { const o = {}; return (o.x ??= 5); }`);
    expect(litValue(r.result)).toBe(5);
  });

  it("(o.x ??= 9) keeps and returns existing 1", () => {
    const r = call(`export function f() { const o = { x: 1 }; return (o.x ??= 9); }`);
    expect(litValue(r.result)).toBe(1);
  });

  it("(o.x ||= 9) keeps and returns truthy 1", () => {
    const r = call(`export function f() { const o = { x: 1 }; return (o.x ||= 9); }`);
    expect(litValue(r.result)).toBe(1);
  });

  it("(o.x ||= 9) returns 9 when falsy and writes", () => {
    const r = call(`export function f() { const o = { x: 0 }; const v = (o.x ||= 9); return v * 10 + o.x; }`);
    expect(litValue(r.result)).toBe(99);
  });

  it("(o.x &&= 9) returns and writes 9 when truthy", () => {
    const r = call(`export function f() { const o = { x: 1 }; return (o.x &&= 9); }`);
    expect(litValue(r.result)).toBe(9);
  });

  it("(o.x &&= 9) keeps falsy 0", () => {
    const r = call(`export function f() { const o = { x: 0 }; return (o.x &&= 9); }`);
    expect(litValue(r.result)).toBe(0);
  });

  it("(o.x.y ??= 5) is 5 on nested path", () => {
    const r = call(`export function f() { const o = { x: {} }; return (o.x.y ??= 5); }`);
    expect(litValue(r.result)).toBe(5);
  });

  it("(a[0] ??= 7) is 7", () => {
    const r = call(`export function f() { const a = [undefined]; return (a[0] ??= 7); }`);
    expect(litValue(r.result)).toBe(7);
  });

  it("identifier targets unchanged: (n += 1) is new value", () => {
    const r = call(`export function f() { let n = 4; return (n += 1); }`);
    expect(litValue(r.result)).toBe(5);
  });

  it("identifier logical assign unchanged: (n ??= 5) is 5", () => {
    const r = call(`export function f() { let n; return (n ??= 5); }`);
    expect(litValue(r.result)).toBe(5);
  });
});
