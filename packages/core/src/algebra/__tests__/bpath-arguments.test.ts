/**
 * B 路径 `arguments` 对象（strict/ESM 语义）：
 * - 类数组 tuple：length / 下标 / typeof / spread / Array.from 可展开实参；
 * - 与形参**独立映射**（strict）：写 arguments[i] 不改形参，写形参不改 arguments。
 *   （sloppy 非严格是 mapped arguments object，二者互相写回——Nudo 按 ESM/strict，
 *   与差分 native `'use strict'` 对齐。）
 * - 箭头无自己的 arguments：体直接引用且外层非箭头建槽时沿词法外层；否则诚实 unknown
 *   （差分 harness 外层是箭头 IIFE，native 为 ReferenceError）。
 * - 默认参 length 按实参个数；rest 的 arguments.length 同实参个数。
 * - rest 绑定仍走真实 arguments/rest 形参（transpile restBind），与本槽解耦。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape, formatAbs, $lit, unknown as unknownAbs } from "@nudojs/core";

function call(src: string, fnName = "f", args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never);
}

function lit(n: number | string | boolean | undefined | null) {
  return $lit(n as never);
}

describe("B-path arguments object (strict/ESM)", () => {
  it("arguments.length is the actual argument count", () => {
    const r = call(`export function f() { return arguments.length }`, "f", [lit(1), lit(2), lit(3)]);
    expect(litValue(r.result)).toBe(3);
    const r0 = call(`export function f() { return arguments.length }`, "f", []);
    expect(litValue(r0.result)).toBe(0);
  });

  it("function expression arguments.length sees actual args (not formal count)", () => {
    const r = call(
      `export function f() { const g = function(){ return arguments.length }; return g(1,2,3); }`,
      "f",
      [],
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("arguments[i] projects the i-th actual argument; OOB is undefined", () => {
    const r = call(`export function f() { return arguments[0] }`, "f", [lit(9)]);
    expect(litValue(r.result)).toBe(9);
    const r2 = call(`export function f() { return arguments[5] }`, "f", [lit(1)]);
    expect(litValue(r2.result)).toBeUndefined();
    expect(formatShape(r2.result)).toBe("undefined");
  });

  it("typeof arguments is \"object\"", () => {
    const r = call(`export function f() { return typeof arguments }`, "f", [lit(1)]);
    expect(litValue(r.result)).toBe("object");
  });

  it("strict: writing arguments[i] does NOT write the formal parameter", () => {
    // sloppy 非严格下 arguments[0]=99 会改 a（mapped arguments object）；
    // Nudo 分析是 ESM/strict——独立映射，a 保持 1。
    const r = call(
      `export function f(a,b){ arguments[0]=99; return a }`,
      "f",
      [lit(1), lit(2)],
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("strict: writing the formal does NOT write arguments[i]", () => {
    // sloppy 下 a=7 会改 arguments[0]；strict 独立映射，arguments[0] 保持 3。
    const r = call(
      `export function f(a){ a=7; return arguments[0] }`,
      "f",
      [lit(3)],
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("strict: arguments[0]=7 then return a keeps a (h(3) → 3)", () => {
    const r = call(`export function h(a){ arguments[0]=7; return a }`, "h", [lit(3)]);
    expect(litValue(r.result)).toBe(3);
  });

  it("spread [...arguments] expands the actual argument list", () => {
    const r = call(`export function f() { const a = [...arguments]; return a.length }`, "f", [lit(1), lit(2), lit(3)]);
    expect(litValue(r.result)).toBe(3);
    const r0 = call(`export function f() { const a = [...arguments]; return a[0] }`, "f", [lit(7), lit(8)]);
    expect(litValue(r0.result)).toBe(7);
    const r1 = call(`export function f() { const a = [...arguments]; return a[1] }`, "f", [lit(7), lit(8)]);
    expect(litValue(r1.result)).toBe(8);
  });

  it("Array.from(arguments, mapFn) visits each actual argument", () => {
    const r = call(
      `export function f() { let t = 0; Array.from(arguments, (x) => { t += x; return x; }); return t }`,
      "f",
      [lit(1), lit(2), lit(3)],
    );
    expect(litValue(r.result)).toBe(6);
  });

  it("Array.from(arguments).join expands (result is a string; join folding stays abstract)", () => {
    // join 的精确折叠仍是既有 arr/tuple join 模型（抽象 string）——不假精确。
    // 展开已由上面的 mapFn/spread 钉住；此处只保证 join 产出 string 不中断。
    const r = call(
      `export function f() { return Array.from(arguments).join('-') }`,
      "f",
      [lit(1), lit(2), lit(3)],
    );
    expect(formatShape(r.result)).toBe("string");
  });

  it("default parameter does not inflate arguments.length", () => {
    // f() → length 0（不是默认参个数 1）
    const r = call(`export function f(a=1){ return arguments.length }`, "f", []);
    expect(litValue(r.result)).toBe(0);
    const r2 = call(`export function f(a=1){ return arguments.length }`, "f", [lit(5)]);
    expect(litValue(r2.result)).toBe(1);
  });

  it("rest parameter arguments.length is the actual argument count", () => {
    const r = call(`export function f(...r){ return arguments.length }`, "f", [lit(1), lit(2)]);
    expect(litValue(r.result)).toBe(2);
  });

  it("rest binding still collects extras (rest path unbroken)", () => {
    const r = call(`export function f(...r){ return r.length }`, "f", [lit(1), lit(2)]);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f(a, ...r){ return r.length }`, "f", [lit(1), lit(2), lit(3)]);
    expect(litValue(r2.result)).toBe(2);
  });

  it("arrow has no own arguments: honest unknown when outer slot is absent", () => {
    // 差分 harness 外层是箭头 IIFE（native ReferenceError）；不得假精确折 0。
    const r = call(`export function f() { const g = () => arguments.length; return g(1,2); }`);
    expect(formatShape(r.result)).toBe("unknown");
  });

  it("arrow inherits outer arguments when the non-arrow outer also references it directly", () => {
    // outer 直接引用 arguments → 建槽；箭头词法继承（JS 语义）。
    const r = call(
      `export function f() { const x = arguments[0]; const g = () => arguments.length; return x + g(1,2); }`,
      "f",
      [lit(10)],
    );
    // x=10, g sees f's arguments.length=1 (f was called with one arg) → 11
    expect(litValue(r.result)).toBe(11);
  });

  it("call/apply feed actual arguments", () => {
    const r = call(
      `export function f() { const g = function(){ return arguments.length }; return g.call(null,1,2,3); }`,
    );
    expect(litValue(r.result)).toBe(3);
    const r2 = call(
      `export function f() { const g = function(){ return arguments.length }; return g.apply(null,[1,2]); }`,
    );
    expect(litValue(r2.result)).toBe(2);
  });

  it("typeof arguments on zero args is still object", () => {
    const r = call(`export function f() { return typeof arguments }`, "f", []);
    expect(litValue(r.result)).toBe("object");
  });

  it("arguments is independent per invocation (no cross-call bleed)", () => {
    const r = call(
      `export function f() {
        function g(){ return arguments[0] }
        const a = g(1);
        const b = g(2);
        return a + b;
      }`,
    );
    expect(litValue(r.result)).toBe(3);
  });
});
