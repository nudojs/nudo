/**
 * Bug 307 回归：`Object.getPrototypeOf(Function.prototype)` 必须是
 * `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型
 * 就是 Object.prototype）。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   Object.getPrototypeOf(Function.prototype) === Object.prototype → true
 *   Object.getPrototypeOf(Object.prototype) === null              → true
 *   Object.getPrototypeOf([]) === Array.prototype                 → true
 *   Object.getPrototypeOf(Array.prototype) === Object.prototype   → true
 *   Object.getPrototypeOf(userFn) === Function.prototype          → true
 *   typeof Function.prototype                                     → "function"
 *
 * 修前：引擎把 Function.prototype 的 [[Prototype]] 压成 undefined ⇒
 * `getPrototypeOf(Function.prototype) === Object.prototype` 恒 **false**
 * ⇒ 对完全合法的代码给出**自信的错值**（wrong-exact：假绿/假红同源）。
 *
 * 报告勘误（**勿照抄报告**）：原始报告称原生 `typeof Function.prototype`
 * 是 "object"——**报告是错的**。node v26 实测为 **"function"**
 * （Function.prototype 本身就是可调用的）。引擎当前也给 "function" ✅。
 * 本文件按**原生**把 typeof 钉成 "function"，并单列一条断言防回退。
 *
 * 取证（原生 oracle）：
 *   node -e 'console.log(Object.getPrototypeOf(Function.prototype)===Object.prototype,
 *     Object.getPrototypeOf(Object.prototype)===null,
 *     Object.getPrototypeOf([])===Array.prototype,
 *     Object.getPrototypeOf(Array.prototype)===Object.prototype,
 *     typeof Function.prototype)'
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 307 — Function.prototype 的 [[Prototype]] 是 Object.prototype", () => {
  it("Object.getPrototypeOf(Function.prototype) === Object.prototype → true（修前恒 false）", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Function.prototype) === Object.prototype;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("Object.getPrototypeOf(Object.prototype) === null → true（链顶恒 null）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Object.prototype) === null;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf([]) === Array.prototype → true（实例原型面不回归）", () => {
    const r = call(wrap(`return Object.getPrototypeOf([]) === Array.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(Array.prototype) === Object.prototype → true（内建原型上一层）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Array.prototype) === Object.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(userFn) === Function.prototype → true（用户函数的原型面）", () => {
    const r = call(
      wrap(`function user(){} return Object.getPrototypeOf(user) === Function.prototype;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});

describe("Bug 307 — 负控制（报告的 typeof 勘误 + 相邻原型面不回归）", () => {
  it("typeof Function.prototype → \"function\"（原生同款；报告称 \"object\" 是**报告的错误**）", () => {
    // node v26.10.0：typeof Function.prototype === "function"
    // （Function.prototype 本身可调用——它就是「所有函数共用的那个函数」）。
    // 报告里的 "object" 无原生依据，**不得**据此写断言。
    const r = call(wrap(`return typeof Function.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("typeof Object.getPrototypeOf(Function.prototype) → \"object\"（原型对象本身是对象）", () => {
    // 原生：Object.getPrototypeOf(Function.prototype) === Object.prototype
    //       ⇒ typeof 是 "object"
    const r = call(wrap(`return typeof Object.getPrototypeOf(Function.prototype);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });

  it("Object.getPrototypeOf(Function) === Function.prototype → true（内建构造器自身的原型面）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Function) === Function.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(Object) === Function.prototype → true（内建构造器自身的原型面）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Object) === Function.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(function(){}) === Function.prototype → true（函数表达式）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(function(){}) === Function.prototype;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(Object.getPrototypeOf([])) === Object.prototype → true", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Object.getPrototypeOf([])) === Object.prototype;`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});
