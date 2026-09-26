/**
 * B 路径 void 一元运算：表达式值恒 undefined，但操作数必须求值
 * （副作用：赋值写回、函数调用、成员写）。此前 transpile 直接把
 * void 折叠为 $lit(undefined)，操作数整体丢失。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path void operator", () => {
  it("void (n = 9) evaluates the assignment", () => {
    const r = call(`export function f() { let n = 5; void (n = 9); return n; }`);
    expect(litValue(r.result)).toBe(9);
  });

  it("void f() invokes the function", () => {
    const r = call(
      `export function f() {
        let calls = 0;
        const g = () => { calls++; return 1; };
        void g();
        return calls;
      }`,
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("void (o.x = 1) writes the member", () => {
    const r = call(`export function f() { const o = {}; void (o.x = 1); return o.x; }`);
    expect(litValue(r.result)).toBe(1);
  });

  it("void expression value is always undefined", () => {
    const r = call(`export function f() { const r = void (5 + 5); return r; }`);
    expect(formatShape(r.result)).toBe("undefined");
  });

  it("void 0 stays undefined", () => {
    const r = call(`export function f() { return void 0; }`);
    expect(formatShape(r.result)).toBe("undefined");
  });

  it("void on postfix increment still updates the binding", () => {
    const r = call(`export function f() { let n = 1; void (n++); return n; }`);
    expect(litValue(r.result)).toBe(2);
  });
});
