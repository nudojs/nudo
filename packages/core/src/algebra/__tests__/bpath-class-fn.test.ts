/**
 * B 路径 class 值是函数：JS 里 class 声明/表达式本身是 constructor 函数，
 * 而非普通对象。此前 $class 把类值建模为 brand（typeofName → "object"），
 * 且实例语义挂在同一 brand 上：
 *   - typeof A → "object"（原生 "function"）
 *   - A instanceof Function → false（原生 true）
 *   - A.prototype → undefined（原生 prototype 对象）
 *   - typeof A.m（静态方法一等读取）→ "undefined"（原生 "function"）
 *   - typeof A.call / A.apply → "undefined"（原生 "function"，Function.prototype）
 * 修复：markClassValue 标记类值；typeofAbs 对类值折 "function"；
 * $instanceof 类值对 Function/Object 恒 true；$get 类值路径补 staticMethods
 * 一等读取、prototype 与 call/apply/bind 形状；$class 补 name 槽。
 * 实例（new A()）不受影响：typeof 仍 "object"、instanceof Function 仍 false。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path class value is a function", () => {
  it("typeof class declaration is function", () => {
    expect(litValue(call(`export function f() { class A {} return typeof A; }`).result)).toBe("function");
  });

  it("class is instanceof Function and Object", () => {
    expect(litValue(call(`export function f() { class A {} return A instanceof Function; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { class A {} return A instanceof Object; }`).result)).toBe(true);
  });

  it("typeof class expression stays function", () => {
    expect(litValue(call(`export function f() { let B = class {}; return typeof B; }`).result)).toBe("function");
    expect(litValue(call(`export function f() { let B = class {}; return B instanceof Function; }`).result)).toBe(true);
  });

  it("A.prototype is an object (not undefined)", () => {
    expect(litValue(call(`export function f() { class A {} return typeof A.prototype; }`).result)).toBe("object");
  });

  it("static method first-class read is a function", () => {
    expect(litValue(call(`export function f() { class A { static m() { return 1; } } return typeof A.m; }`).result)).toBe("function");
    // 调用路径不受影响
    expect(litValue(call(`export function f() { class A { static m() { return 1; } } return A.m(); }`).result)).toBe(1);
  });

  it("Function.prototype members exist on class value", () => {
    expect(litValue(call(`export function f() { class A {} return typeof A.call; }`).result)).toBe("function");
    expect(litValue(call(`export function f() { class A {} return typeof A.apply; }`).result)).toBe("function");
    expect(litValue(call(`export function f() { class A {} return typeof A.bind; }`).result)).toBe("function");
  });

  it("class name property reads the name", () => {
    expect(litValue(call(`export function f() { class Widget {} return Widget.name; }`).result)).toBe("Widget");
  });

  it("static method still calls and sees statics", () => {
    expect(
      litValue(
        call(
          `export function f() { class A { static x = 5; static m() { return A.x + 1; } } return A.m(); }`,
        ).result,
      ),
    ).toBe(6);
  });

  it("instances stay objects (not functions)", () => {
    expect(litValue(call(`export function f() { class A {} return typeof new A(); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { class A {} return new A() instanceof Function; }`).result)).toBe(false);
    expect(litValue(call(`export function f() { class A {} return new A() instanceof A; }`).result)).toBe(true);
  });

  it("subclass chain instanceof still resolves", () => {
    expect(
      litValue(
        call(
          `export function f() { class A { m() { return 1; } } class B extends A {} return new B() instanceof A; }`,
        ).result,
      ),
    ).toBe(true);
    expect(
      litValue(
        call(
          `export function f() { class A { m() { return 1; } } class B extends A {} return new A() instanceof B; }`,
        ).result,
      ),
    ).toBe(false);
  });
});
