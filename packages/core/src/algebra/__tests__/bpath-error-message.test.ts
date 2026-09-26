/**
 * Error 家族构造器消息槽建模（B 路径）。
 *
 * 原生语义：
 * - message 恒为字符串：缺省/undefined → ""；非字符串字面量 → ToString
 *   （new Error(5).message === "5"，new Error(null).message === "null"）。
 * - AggregateError(errors, message[, options])：第一实参是 errors 数组
 *   （.errors），第二实参才是 message。
 * - 第二（Error）或第三（AggregateError）实参 options 的 cause 挂 .cause。
 *
 * 修复前：errorBrandAbs(name, args[0]) 把 AggregateError 的 errors 数组
 * 当 message（new AggregateError(['e1'],'x').message 折 ['e1']）；消息槽
 * 不 ToString（new Error(5).message 折 5、new Error(undefined).message 折
 * undefined）；.errors/.cause 闭槽 miss 折 undefined（原生有值）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path Error message slot is always a string", () => {
  it("string message passthrough", () => {
    expect(litValue(call(`export function f() { return new Error('hello').message; }`).result)).toBe("hello");
  });

  it("number message is stringified", () => {
    expect(litValue(call(`export function f() { return new Error(5).message; }`).result)).toBe("5");
  });

  it("boolean message is stringified", () => {
    expect(litValue(call(`export function f() { return new Error(true).message; }`).result)).toBe("true");
  });

  it("null message is stringified", () => {
    expect(litValue(call(`export function f() { return new Error(null).message; }`).result)).toBe("null");
  });

  it("absent message is empty string", () => {
    expect(litValue(call(`export function f() { return new Error().message; }`).result)).toBe("");
  });

  it("explicit undefined message is empty string", () => {
    expect(litValue(call(`export function f() { return new Error(undefined).message; }`).result)).toBe("");
  });

  it("error subclasses share the stringification", () => {
    expect(litValue(call(`export function f() { return new TypeError(5).message; }`).result)).toBe("5");
    expect(litValue(call(`export function f() { return new RangeError(5).message; }`).result)).toBe("5");
  });

  it("name slot unaffected", () => {
    expect(litValue(call(`export function f() { return new TypeError('t').name; }`).result)).toBe("TypeError");
  });
});

describe("B-path AggregateError argument order", () => {
  it("message is the second argument", () => {
    expect(litValue(call(`export function f() { return new AggregateError([], 'x').message; }`).result)).toBe("x");
    expect(litValue(call(`export function f() { return new AggregateError(['e1'], 'x').message; }`).result)).toBe("x");
  });

  it("errors is the first argument", () => {
    expect(litValue(call(`export function f() { return new AggregateError(['e1'], 'x').errors[0]; }`).result)).toBe("e1");
    expect(litValue(call(`export function f() { return new AggregateError([], 'x').errors.length; }`).result)).toBe(0);
  });

  it("name slot unaffected", () => {
    expect(litValue(call(`export function f() { return new AggregateError([], 'x').name; }`).result)).toBe("AggregateError");
  });
});

describe("B-path Error options.cause", () => {
  it("cause is projected from options", () => {
    expect(litValue(call(`export function f() { return new Error('x', {cause: 7}).cause; }`).result)).toBe(7);
  });

  it("missing cause stays undefined", () => {
    expect(litValue(call(`export function f() { return new Error('x', {}).cause; }`).result)).toBe(undefined);
  });

  it("AggregateError takes options as third argument", () => {
    expect(litValue(call(`export function f() { return new AggregateError([], 'x', {cause: 1}).cause; }`).result)).toBe(1);
  });
});
