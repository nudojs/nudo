/**
 * **报告外发现**（S10 转来）：转译侧 `for (let {a} of …)` 的 pack 闭包引用了
 * **体内作用域**的解构绑定 ⇒ ReferenceError。
 *
 * 根因（`transpile/stmt/statement.ts`，ForOfStatement 路径）：头解构
 * （let/const）的子名由 `emitDestructure` 声明在**循环体回调内**（块级绑定），
 * 而 pack/unpack 闭包发射在回调**外** —— 名字一旦进 pack 名集，闭包就引用了
 * 作用域外的绑定 ⇒ 抽象出口（`$forOf` 的 exit join 取包）直接抛 ReferenceError
 * （`f(arr) => never throws ReferenceError`）。
 *
 * 修法：头解构（let/const）的子名不是外层绑定（每轮独立 / const 不可再赋）
 * ⇒ 排除出 pack 名集（var 头的子名是函数级提升槽，仍在集内）。
 */
import { describe, it, expect } from "vitest";
import { call, throwsError, isNever } from "./eval-helpers.ts";
import { anyAbs, litValue } from "../abs.ts";

/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function("arr", body)([{ a: 1 }]);
}

describe("报告外发现: for (let {a} of …) 的 pack 闭包不得引用体内作用域绑定", () => {
  it("具体迭代：结果与原生一致", () => {
    const body = `let t=0; for (let {a} of arr) { a = a + 1; t = t + a; } return t;`;
    expect(native(body)).toBe(2);
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(isNever(r.result)).toBe(false);
  });

  it("抽象迭代：不抛 ReferenceError（抽象出口取包不再引用作用域外绑定）", () => {
    const body = `let t=0; for (let {a} of arr) { a = a + 1; t = t + a; } return t;`;
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(throwsError(r.result, "ReferenceError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("抽象迭代（数组模式头）：不抛 ReferenceError", () => {
    const body = `let t=0; for (let [a] of arr) { t = t + a; } return t;`;
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(throwsError(r.result, "ReferenceError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("const 头解构：不抛 ReferenceError", () => {
    const body = `let t=0; for (const {a} of arr) { t = t + a; } return t;`;
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(throwsError(r.result, "ReferenceError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：var 头解构（子名是函数级提升槽，仍在 pack 集内）不回归", () => {
    const body = `let t=0; for (var {a} of arr) { a = a + 1; t = t + a; } return t;`;
    expect(native(body)).toBe(2);
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(throwsError(r.result, "ReferenceError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("负控制：标识符头（let x of …）不回归", () => {
    const body = `let t=0; for (let x of arr) { t = t + x; } return t;`;
    // 原生：迭代项是对象 ⇒ t = 0 + "[object Object]"（字符串）
    expect(native(body)).toBe("0[object Object]");
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(throwsError(r.result, "ReferenceError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("负控制：外层绑定仍进 pack 集（写回不丢）", () => {
    const body = `let t=0; for (let {a} of arr) { t = t + a; } return t;`;
    const r = call(`export function f(arr) { ${body} }`, "f", [anyAbs]);
    expect(throwsError(r.result, "ReferenceError")).toBe(false);
    const lv = litValue(r.result);
    expect(lv.ok || r.result.shape.k === "sum").toBe(true);
  });
});
