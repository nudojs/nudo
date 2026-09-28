/**
 * Object.prototype.isPrototypeOf(V)：先 V = V.[[GetPrototypeOf]]()，再 SameValue
 * —— 对象**不在**自己的原型链上：
 *   Object.prototype.isPrototypeOf(Object.prototype)  原生 false，引擎 true
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function val(src: string) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return litValue(callTranspiledExportFull(exports, "f", []).result);
}

describe("Object.prototype.isPrototypeOf self is false", () => {
  it("Object.prototype.isPrototypeOf(Object.prototype) === false", () => {
    expect(
      val(`export function f() {
        return Object.prototype.isPrototypeOf(Object.prototype);
      }`),
    ).toBe(false);
  });

  it("Object.prototype.isPrototypeOf({}) === true", () => {
    expect(
      val(`export function f() {
        return Object.prototype.isPrototypeOf({});
      }`),
    ).toBe(true);
  });
});
