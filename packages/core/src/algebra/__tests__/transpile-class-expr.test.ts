/**
 * Bug 9 回归：非空（匿名）ClassExpression 处于子表达式位置时，转译器把
 * 类 spec 的语句终止符 `;` 一起发进表达式文本（`$class(…});`），被父级
 * 包裹成 `return($class(…}););` 之类 → new Function SyntaxError，整个模块
 * 加载失败（原生是合法 JS）。
 *
 * 修复：类表达式发射纯表达式（结尾不带 `;`）——与 $fnVal 同口径；命名/
 * 带静态块分支仍走 IIFE 绑定后返回。本文件覆盖报告 repro 矩阵的每个
 * 位置 + 空/具名/声明位类不回退。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

/** 模块可加载且 f 可调用，result 折字面量值 */
function evalsTo(src: string, value: unknown, fnName = "f") {
  const r = call(src, fnName);
  expect(litValue(r.result)).toEqual({ ok: true, value });
}

describe("Bug 9：非空匿名类表达式在子表达式位置（修复前 new Function SyntaxError 整模块失败）", () => {
  it("报告原始 repro：return class { m() { return a; } } 模块可加载", () => {
    const exports = runTranspiled(
      `export function f(a) { return class { m() { return a; } }; }`,
      { mode: "analyze" },
    );
    expect(typeof exports.f).toBe("function");
  });

  it("return 值位：类值 typeof 为 function", () => {
    evalsTo(`export function f() { return typeof (class { m() { return 1; } }); }`, "function");
  });

  it("数组元素位", () => {
    evalsTo(
      `export function f() { const a = [class { m() { return 1; } }]; return typeof a[0]; }`,
      "function",
    );
  });

  it("对象属性值位", () => {
    evalsTo(
      `export function f() { return typeof ({ k: class { m() { return 1; } } }).k; }`,
      "function",
    );
  });

  it("调用实参位", () => {
    evalsTo(
      `function g(x) { return typeof x; } export function f() { return g(class { m() { return 1; } }); }`,
      "function",
    );
  });

  it("new 被调者位：构造 + 实例方法可用", () => {
    evalsTo(
      `export function f() { return (new (class { constructor() { this.n = 7; } m() { return this.n; } })()).m(); }`,
      7,
    );
  });

  it("箭头简写体位", () => {
    evalsTo(
      `export function f() { const g = () => class { m() { return 1; } }; return typeof g(); }`,
      "function",
    );
  });

  it("括号位", () => {
    evalsTo(`export function f() { return typeof (class { m() { return 1; } }); }`, "function");
  });

  it("三元臂位", () => {
    evalsTo(
      `export function f() { const c = 1; return typeof (c ? class { m() { return 1; } } : null); }`,
      "function",
    );
  });

  it("成员读取位：.prototype", () => {
    evalsTo(
      `export function f() { return typeof (class { m() { return 1; } }).prototype; }`,
      "object",
    );
  });

  it("无初始化绑定赋值位：let K; K = class {…}", () => {
    evalsTo(
      `export function f() { let K; K = class { m() { return 3; } }; return typeof K; }`,
      "function",
    );
  });

  it("初始化声明位（修复前幸存位）不回退：可构造可调用", () => {
    evalsTo(
      `export function f() { const C = class { m() { return 9; } }; return (new C()).m(); }`,
      9,
    );
  });

  it("嵌套子表达式：类方法体内再返回匿名类表达式", () => {
    evalsTo(
      `export function f() {
        class Outer { make() { return class { m() { return 5; } }; } }
        const C = new Outer().make();
        return (new C()).m();
      }`,
      5,
    );
  });
});

describe("Bug 9：不回退面（空类 / 具名类表达式 / 类声明）", () => {
  it("空类体仍走 $classExpr fn 形状", () => {
    const r = call(`export function f() { let B = class {}; return typeof B; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("子表达式位置的空匿名类", () => {
    evalsTo(`export function f() { return typeof (class {}); }`, "function");
  });

  it("具名类表达式在 return 位（修复前已走 IIFE，不回退）", () => {
    evalsTo(
      `export function f() { const C = class Named { m() { return 4; } }; return (new C()).m(); }`,
      4,
    );
    evalsTo(
      `export function f() { return typeof (class Named { m() { return 4; } }); }`,
      "function",
    );
  });

  it("匿名类 + 静态块（staticInit 分支）在 return 位", () => {
    evalsTo(
      `export function f() { return (new (class { static { 1; } m() { return 2; } })()).m(); }`,
      2,
    );
  });

  it("类声明位不回退", () => {
    evalsTo(
      `export function f() { class A { m() { return 6; } } return (new A()).m(); }`,
      6,
    );
  });
});
