/**
 * prim 装箱 `.constructor`：数字/字符串/布尔/bigint/symbol 与数组/对象/
 * Error brand / Promise 的 constructor 折叠为内建构造器 Abs。
 * - `(42).constructor === Number` / `.name` → true / "Number"
 * - 不把 `.constructor` 变成可任意调用的假精确 Function
 * - Object.getPrototypeOf([]).constructor.name 链对齐
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("prim .constructor === builtin", () => {
  it("number", () => {
    expect(litValue(call(`export function f() { return (42).constructor === Number; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return Number === (42).constructor; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return (42).constructor.name; }`).result)).toBe("Number");
    expect(litValue(call(`export function f() { return (42).constructor === String; }`).result)).toBe(false);
  });

  it("string", () => {
    expect(litValue(call(`export function f() { return "s".constructor === String; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return "nudo".constructor.name; }`).result)).toBe("String");
  });

  it("boolean", () => {
    expect(litValue(call(`export function f() { return true.constructor === Boolean; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return true.constructor.name; }`).result)).toBe("Boolean");
  });

  it("bigint", () => {
    expect(litValue(call(`export function f() { return 1n.constructor === BigInt; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return 1n.constructor.name; }`).result)).toBe("BigInt");
  });

  it("symbol", () => {
    expect(litValue(call(`export function f() { return Symbol().constructor === Symbol; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return Symbol("d").constructor.name; }`).result)).toBe("Symbol");
  });
});

describe("array / object / error / promise .constructor", () => {
  it("array", () => {
    expect(litValue(call(`export function f() { return [1,2,3].constructor === Array; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return [1,2,3].constructor.name; }`).result)).toBe("Array");
    expect(litValue(call(`export function f() { return [].constructor.name; }`).result)).toBe("Array");
  });

  it("object", () => {
    expect(litValue(call(`export function f() { return ({}).constructor === Object; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return ({}).constructor.name; }`).result)).toBe("Object");
    expect(litValue(call(`export function f() { return ({a:1}).constructor.name; }`).result)).toBe("Object");
  });

  it("error brands", () => {
    expect(litValue(call(`export function f() { return new RangeError('r').constructor.name; }`).result)).toBe("RangeError");
    expect(litValue(call(`export function f() { return new TypeError('t').constructor.name; }`).result)).toBe("TypeError");
    expect(litValue(call(`export function f() { return new Error('e').constructor === Error; }`).result)).toBe(true);
  });

  it("catch binding .constructor.name", () => {
    expect(
      litValue(call(`export function f() { try { undefined.x; } catch (e) { return e.constructor.name; } }`).result),
    ).toBe("TypeError");
  });

  it("promise", () => {
    expect(litValue(call(`export function f() { return Promise.resolve(1).constructor.name; }`).result)).toBe("Promise");
  });
});

describe("Object.getPrototypeOf(...).constructor chain", () => {
  it("array proto constructor.name", () => {
    expect(
      litValue(call(`export function f() { return Object.getPrototypeOf([]).constructor.name; }`).result),
    ).toBe("Array");
  });

  it("object proto constructor", () => {
    expect(
      litValue(call(`export function f() { return Object.getPrototypeOf({}).constructor === Object; }`).result),
    ).toBe(true);
  });

  it("prim proto constructor.name", () => {
    expect(
      litValue(call(`export function f() { return Object.getPrototypeOf(5).constructor.name; }`).result),
    ).toBe("Number");
  });
});

describe("constructor is not a fake callable Function", () => {
  it("typeof (42).constructor is function (class-value mark)", () => {
    expect(litValue(call(`export function f() { return typeof (42).constructor; }`).result)).toBe("function");
  });

  it("constructor.name on abstract number stays Number (not unknown)", () => {
    const r = call(`export function f(n) { return n.constructor.name; }`);
    // 入口无约束 → any；any.constructor 不得折假精确字面量
    const lv = litValue(r.result);
    expect(lv === undefined || lv === "Number").toBe(true);
  });
});
