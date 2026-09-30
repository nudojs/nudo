/**
 * Function.prototype.call/apply/bind 的 thisArg 被丢弃：
 * 求值引擎函数体 this 恒折 undefined，g.call(5) 里 typeof this 折 "undefined"
 * （原生 strict 下 this === 5 → "number"）；bind 的 bound this 同样丢失。
 * 修复：函数体含 this 时用宿主 this（$rawThis）注入，
 * call/apply/bind 把 thisArg 作为宿主 this 传递。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("evaluator call/apply/bind thisArg", () => {
  it("call passes primitive thisArg (strict: no boxing)", () => {
    const g = "function g(){ return typeof this; }";
    expect(litValue(call(`export function f() { ${g} return g.call(5); }`).result)).toEqual({ ok: true, value: "number" });
    expect(litValue(call(`export function f() { ${g} return g.call("x"); }`).result)).toEqual({ ok: true, value: "string" });
    expect(litValue(call(`export function f() { ${g} return g.call(true); }`).result)).toEqual({ ok: true, value: "boolean" });
    expect(litValue(call(`export function f() { ${g} return g.call(null); }`).result)).toEqual({ ok: true, value: "object" });
    expect(litValue(call(`export function f() { ${g} return g.call(undefined); }`).result)).toEqual({ ok: true, value: "undefined" });
  });

  it("apply passes thisArg", () => {
    const g = "function g(){ return typeof this; }";
    expect(litValue(call(`export function f() { ${g} return g.apply(5, []); }`).result)).toEqual({ ok: true, value: "number" });
    expect(litValue(call(`export function f() { ${g} return g.apply(null, []); }`).result)).toEqual({ ok: true, value: "object" });
  });

  it("call with identity check", () => {
    expect(litValue(call(`export function f() { function g(){ return this === 5; } return g.call(5); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { function g(){ return this === null; } return g.call(null); }`).result)).toEqual({ ok: true, value: true });
  });

  it("bind remembers bound this and args", () => {
    expect(litValue(call(`export function f() { function add(a, b){ return this + a + b; } const g = add.bind(10, 1); return g(2); }`).result)).toEqual({ ok: true, value: 13 });
    expect(litValue(call(`export function f() { function add(a, b){ return this + a + b; } return add.bind(10, 1, 2)(); }`).result)).toEqual({ ok: true, value: 13 });
    expect(litValue(call(`export function f() { function g(){ return typeof this; } const h = g.bind(5); return h(); }`).result)).toEqual({ ok: true, value: "number" });
  });

  it("function expression receiver", () => {
    expect(litValue(call(`export function f() { const g = function(){ return typeof this; }; return g.call(5); }`).result)).toEqual({ ok: true, value: "number" });
  });

  it("method call passes object thisArg", () => {
    const r = call(`export function f() { const o = {n: 9, get(){ return this.n; }}; return o.get.call({n: 1}); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("plain call keeps strict undefined this", () => {
    expect(litValue(call(`export function f() { function g(){ return typeof this; } return g(); }`).result)).toEqual({ ok: true, value: "undefined" });
  });
});
