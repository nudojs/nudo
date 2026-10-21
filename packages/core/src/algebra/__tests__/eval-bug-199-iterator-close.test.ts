/**
 * Bug 199 回归：**非正常出口必须 IteratorClose**（对用户迭代器调 `return()`）。
 *
 * ES 语义（IteratorClose / ForInOfBodyEvaluation / 数组解构）：
 * - `for-of` 循环体 `break` / `return` / `throw`（含 label break）⇒ 迭代器
 *   的 `return()` 被调用（**副作用可见**）；
 * - 数组解构模式被**填满**而迭代器尚未耗尽 ⇒ 同样 IteratorClose；
 * - `continue` 与**自然耗尽** ⇒ **不**调用 `return()`；
 * - 无 `return` 槽 ⇒ 不调用（原生无副作用）；
 * - `return` 槽是**非可调用值** ⇒ GetMethod 定抛 TypeError；
 * - `return()` 的返回值**必须是对象** ⇒ 否则定抛 TypeError（`return(){}` 无
 *   返回值即抛——原生实测）。
 *
 * 修复前：引擎从不调 `return()` ⇒ 迭代器的清理副作用**丢失**
 * （`forOfCloseOnBreak() => ""`，原生 `"ret"`）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

/** 迭代器夹具：next 产 1,2,3（done 于第 4 次），return() 记 "ret" */
const IT = `const log = [];
  const it = {
    i: 0,
    next() { return { value: ++this.i, done: this.i > 3 }; },
    return() { log.push("ret"); return { done: true }; },
    [Symbol.iterator]() { return this; },
  };`;

describe("Bug 199：非正常出口触发 IteratorClose", () => {
  it("for-of 里 break ⇒ 调 return()", () => {
    expect(val(`export function f() { ${IT} for (const v of it) { break; } return log.join(","); }`)).toEqual({
      ok: true,
      value: "ret",
    });
  });

  it("for-of 里条件 break ⇒ 调 return()", () => {
    expect(
      val(`export function f() { ${IT} for (const v of it) { if (v === 2) break; } return log.join(","); }`),
    ).toEqual({ ok: true, value: "ret" });
  });

  it("for-of 循环体抛错 ⇒ 调 return()（抛错被捕获后副作用可见）", () => {
    expect(
      val(`export function f() { ${IT} try { for (const v of it) { throw new Error("x"); } } catch (e) { log.push("caught"); } return log.join(","); }`),
    ).toEqual({ ok: true, value: "ret,caught" });
  });

  it("label break ⇒ 调 return()", () => {
    expect(
      val(`export function f() { ${IT} outer: for (const v of it) { for (let j = 0; j < 2; j++) { break outer; } } return log.join(","); }`),
    ).toEqual({ ok: true, value: "ret" });
  });

  it("循环体里 return ⇒ 调 return()（函数返回值先算，close 副作用后置可见）", () => {
    expect(
      val(`export function f() { ${IT} function g() { for (const v of it) { return "r" + v; } } const r = g(); return r + "|" + log.join(","); }`),
    ).toEqual({ ok: true, value: "r1|ret" });
  });

  it("解构模式填满而迭代器未耗尽 ⇒ 调 return()", () => {
    expect(val(`export function f() { ${IT} const [a, b] = it; return a + "," + b + "|" + log.join(","); }`)).toEqual({
      ok: true,
      value: "1,2|ret",
    });
  });

  it("return() 的返回值不是对象 ⇒ 原生定抛 TypeError", () => {
    const src = `export function f() {
      const log = [];
      const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, return() { log.push("ret"); }, [Symbol.iterator]() { return this; } };
      for (const v of it) { break; }
      return log.join(",");
    }`;
    const rec = call(src, "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("return 槽是非可调用值 ⇒ 原生定抛 TypeError（GetMethod）", () => {
    const src = `export function f() {
      const log = [];
      const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, return: 5, [Symbol.iterator]() { return this; } };
      for (const v of it) { break; }
      return log.join(",");
    }`;
    const rec = call(src, "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("return() 自身抛错 ⇒ 该抛错取代原完成值并冒泡", () => {
    expect(
      val(`export function f() {
        const log = [];
        const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, return() { log.push("ret"); throw new Error("boom"); }, [Symbol.iterator]() { return this; } };
        try { for (const v of it) { break; } } catch (e) { log.push("caught"); }
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "ret,caught" });
  });

  it("负控制：continue 不调 return()", () => {
    expect(
      val(`export function f() { ${IT} for (const v of it) { if (v === 2) continue; } return log.join(","); }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("负控制：自然耗尽不调 return()", () => {
    expect(val(`export function f() { ${IT} for (const v of it) { } return log.join(","); }`)).toEqual({
      ok: true,
      value: "",
    });
  });

  it("负控制：迭代器无 return 槽 ⇒ 不凭空抛、不凭空调", () => {
    expect(
      val(`export function f() {
        const log = [];
        const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, [Symbol.iterator]() { return this; } };
        for (const v of it) { break; }
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("负控制：rest 模式把迭代器读空 ⇒ 不调 return()", () => {
    expect(val(`export function f() { ${IT} const [a, ...rest] = it; return a + "|" + rest.length + "|" + log.join(","); }`)).toEqual({
      ok: true,
      value: "1|2|",
    });
  });
});
