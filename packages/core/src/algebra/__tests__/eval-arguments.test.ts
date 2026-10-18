/**
 * 求值引擎 `arguments` 对象（strict/ESM 语义）：
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
import { litValue, formatShape, formatAbs, $lit, unknown as unknownAbs, runTranspiled, callTranspiledExportFull } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function lit(n: number | string | boolean | undefined | null) {
  return $lit(n as never);
}

describe("evaluator arguments object (strict/ESM)", () => {
  it("arguments.length is the actual argument count", () => {
    const r = call(`export function f() { return arguments.length }`, "f", [lit(1), lit(2), lit(3)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    const r0 = call(`export function f() { return arguments.length }`, "f", []);
    expect(litValue(r0.result)).toEqual({ ok: true, value: 0 });
  });

  it("function expression arguments.length sees actual args (not formal count)", () => {
    const r = call(
      `export function f() { const g = function(){ return arguments.length }; return g(1,2,3); }`,
      "f",
      [],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("arguments[i] projects the i-th actual argument; OOB is undefined", () => {
    const r = call(`export function f() { return arguments[0] }`, "f", [lit(9)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
    const r2 = call(`export function f() { return arguments[5] }`, "f", [lit(1)]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: undefined });
    expect(formatShape(r2.result)).toBe("undefined");
  });

  it("typeof arguments is \"object\"", () => {
    const r = call(`export function f() { return typeof arguments }`, "f", [lit(1)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });

  it("strict: writing arguments[i] does NOT write the formal parameter", () => {
    // sloppy 非严格下 arguments[0]=99 会改 a（mapped arguments object）；
    // Nudo 分析是 ESM/strict——独立映射，a 保持 1。
    const r = call(
      `export function f(a,b){ arguments[0]=99; return a }`,
      "f",
      [lit(1), lit(2)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("strict: writing the formal does NOT write arguments[i]", () => {
    // sloppy 下 a=7 会改 arguments[0]；strict 独立映射，arguments[0] 保持 3。
    const r = call(
      `export function f(a){ a=7; return arguments[0] }`,
      "f",
      [lit(3)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("strict: arguments[0]=7 then return a keeps a (h(3) → 3)", () => {
    const r = call(`export function h(a){ arguments[0]=7; return a }`, "h", [lit(3)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("spread [...arguments] expands the actual argument list", () => {
    const r = call(`export function f() { const a = [...arguments]; return a.length }`, "f", [lit(1), lit(2), lit(3)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    const r0 = call(`export function f() { const a = [...arguments]; return a[0] }`, "f", [lit(7), lit(8)]);
    expect(litValue(r0.result)).toEqual({ ok: true, value: 7 });
    const r1 = call(`export function f() { const a = [...arguments]; return a[1] }`, "f", [lit(7), lit(8)]);
    expect(litValue(r1.result)).toEqual({ ok: true, value: 8 });
  });

  it("Array.from(arguments, mapFn) visits each actual argument", () => {
    const r = call(
      `export function f() { let t = 0; Array.from(arguments, (x) => { t += x; return x; }); return t }`,
      "f",
      [lit(1), lit(2), lit(3)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
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
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
    const r2 = call(`export function f(a=1){ return arguments.length }`, "f", [lit(5)]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 1 });
  });

  it("rest parameter arguments.length is the actual argument count", () => {
    const r = call(`export function f(...r){ return arguments.length }`, "f", [lit(1), lit(2)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("rest binding still collects extras (rest path unbroken)", () => {
    const r = call(`export function f(...r){ return r.length }`, "f", [lit(1), lit(2)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    const r2 = call(`export function f(a, ...r){ return r.length }`, "f", [lit(1), lit(2), lit(3)]);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  });

  it("arrow has no own arguments: reads the enclosing non-arrow binding precisely", () => {
    // 箭头词法继承外层函数的 arguments（fnBodyHasOwnArguments 下降箭头建槽）。
    // f() 无实参 → f 的 arguments.length = 0；g(1,2) 的实参不影响箭头内读。
    const r = call(`export function f() { const g = () => arguments.length; return g(1,2); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("free arguments (module top level) is a definite ReferenceError", () => {
    // ESM 模块顶层无 arguments：unresolvable reference → 定抛 ReferenceError
    //（原生同抛）；`typeof arguments` 是唯一豁免（折 "undefined" 不抛）。
    const r = call(`const f = () => arguments.length;\nexport function f2(){ return f(); }`, "f2");
    expect(formatShape(r.result)).toBe("never");
    expect(formatShape(r.throws)).toBe("ReferenceError");
    const t = call(`const f = () => typeof arguments;\nexport function f2(){ return f(); }`, "f2");
    expect(litValue(t.result)).toEqual({ ok: true, value: "undefined" });
  });

  it("arrow inherits outer arguments when the non-arrow outer also references it directly", () => {
    // outer 直接引用 arguments → 建槽；箭头词法继承（JS 语义）。
    const r = call(
      `export function f() { const x = arguments[0]; const g = () => arguments.length; return x + g(1,2); }`,
      "f",
      [lit(10)],
    );
    // x=10, g sees f's arguments.length=1 (f was called with one arg) → 11
    expect(litValue(r.result)).toEqual({ ok: true, value: 11 });
  });

  it("call/apply feed actual arguments", () => {
    const r = call(
      `export function f() { const g = function(){ return arguments.length }; return g.call(null,1,2,3); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    const r2 = call(
      `export function f() { const g = function(){ return arguments.length }; return g.apply(null,[1,2]); }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  });

  it("typeof arguments on zero args is still object", () => {
    const r = call(`export function f() { return typeof arguments }`, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
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
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });
});

// --- Bug 116：求值引擎模块体 strict 化（seam） ------------------------------

describe("Bug 116: module body strict seam (new Function \"use strict\")", () => {
  it("arguments / this / 递归既有面不回归（control）", () => {
    expect(litValue(call(`export function f(a, b) { return arguments.length }`, "f", [lit(1), lit(2)]).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f(a) { return arguments[0] }`, "f", [lit(7)]).result)).toEqual({ ok: true, value: 7 });
    // strict 下 arguments.caller 是 undefined 数据属性（node 实测不抛）
    expect(litValue(call(`export function f() { return typeof arguments.caller }`, "f", []).result)).toEqual({ ok: true, value: "undefined" });
    // 裸调用 this = undefined（strict）
    expect(litValue(call(`export function f() { return typeof this }`, "f", []).result)).toEqual({ ok: true, value: "undefined" });
    // 命名函数表达式递归
    expect(litValue(call(`export function f(n) { return n <= 0 ? 0 : f(n - 1) }`, "f", [lit(3)]).result)).toEqual({ ok: true, value: 0 });
  });

  it("sloppy 静默赋值面：未声明变量写不再静默成功（strict ReferenceError 面）", () => {
    // 引擎宿主面 strict 化后 undeclared 写冒 ReferenceError → throws 面表达
    const r = call(`export function f() { function g() { q = 1; return "ok"; } try { return g(); } catch (e) { return "caught:" + e.name; } }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught:ReferenceError" });
  });

  it("strict 毒丸：arguments.callee 读/写/delete 定抛 TypeError（caller 不毒）", () => {
    // node 实测（strict）：callee 读/写/删都抛 TypeError；caller 读 undefined
    expect(litValue(call(`export function f() { try { return (function () { return arguments.callee; })(); } catch (e) { return "T:" + e.name; } }`).result)).toEqual({ ok: true, value: "T:TypeError" });
    expect(litValue(call(`export function f() { try { (function () { arguments.callee = 1; })(); return "ok"; } catch (e) { return "T:" + e.name; } }`).result)).toEqual({ ok: true, value: "T:TypeError" });
    expect(litValue(call(`export function f() { try { (function () { delete arguments.callee; })(); return "ok"; } catch (e) { return "T:" + e.name; } }`).result)).toEqual({ ok: true, value: "T:TypeError" });
    // control：caller 读 strict 下是 undefined 数据属性（不抛）
    expect(litValue(call(`export function f() { return typeof (function () { return arguments.caller; })(); }`).result)).toEqual({ ok: true, value: "undefined" });
  });
});

// --- strict seam 修订：守卫影子绑定 × ESM/CJS 面判定（yargs 回退） ---------

describe("strict seam: guard shadow bindings × ESM/CJS source face", () => {
  it("ESM 体内 arguments.length 判别守卫不再编译期 SyntaxError（yargs-factory 形态）", () => {
    // 守卫影子重绑曾发射 ((arguments) => THUNK)(…)——arguments 在 strict 下
    // 是非法绑定名，new Function 编译期整模块炸（bench yargs 5.5x 回退根因）；
    // 现影子包装跳过，模块正常求值、fork 语义照旧 sound。
    const r = call(
      `export function f() {
        if (arguments.length === 0) return "zero";
        return "n:" + arguments.length;
      }`,
      "f",
      [],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "zero" });
    const r2 = call(
      `export function f() {
        if (arguments.length === 0) return "zero";
        return "n:" + arguments.length;
      }`,
      "f",
      [lit(1), lit(2)],
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: "n:2" });
  });

  it("无 ESM 语法的源按 Node .js 默认 CJS（sloppy）正常求值（控制）", () => {
    // CJS 面不强制 strict：模块求值照常（未声明写 ReferenceError 由
    // $assignRecord 旧值读面产生，与 strict 前缀无关，不在此钉）。
    const exp = runTranspiled(
      `function g(x) { return x + 1; }\nmodule.exports = g;`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exp, "g", [lit(1)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("ESM 源保持 Bug 116 strict 面：未声明写冒 ReferenceError", () => {
    const r = call(`export function f() { function g() { q2 = 1; return "ok"; } try { return g(); } catch (e) { return "caught:" + e.name; } }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught:ReferenceError" });
  });

  it("源码自身 \"use strict\" 前缀经 transpile 保留（无 ESM 语法的 strict 脚本）", () => {
    const r = call(
      `"use strict";
       function g() { q3 = 1; return "ok"; }
       export function f() { try { return g(); } catch (e) { return "caught:" + e.name; } }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught:ReferenceError" });
  });
});
