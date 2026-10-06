/**
 * issue #110（class extends Error 的 super 槽落地）：
 * `constructClass` 的 `!spec` 分支（env/宿主内建构造器无注册 spec）此前
 * 原样返回 thisVal——`super(message)` 静默 no-op，args 被丢弃，派生实例
 * `e.message` / `e.name` 折假精确 undefined（原生为 message 字符串 /
 * 原型链 "Error"）。
 *
 * 修复：Error 家族（isErrorCtorName）在该分支按 errorBrandAbs 落
 * name/message 槽（与 new Error(...) 同口径：lit message 保精确、ToString
 * 折叠、AggregateError errors/cause 实参序），brand 名保持被构造实例
 * thisVal（B extends A extends Error 中间用户类链不换名、方法派发不断链）。
 * name 槽是基类名（原生 Error.prototype.name 经原型链可见；子类自有
 * name 字段/赋值后落地覆盖，源序在 super 之后）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName: string, args: Parameters<typeof callTranspiledExportFull>[2] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

const API = `
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
`;

describe("#110 class extends Error: super(message) slots land", () => {
  it("super(lit) → e.message 保精确字面量（修复前 undefined #exact）", () => {
    const r = call(`${API} export function f() { return new ApiError(500, "boom").message; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "boom" });
  });

  it("e.name → 基类名 \"Error\"（原生经原型链，非派生类名）", () => {
    const r = call(`${API} export function f() { return new ApiError(500, "boom").name; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "Error" });
  });

  it("子类自有槽（this.status）与基类槽共存", () => {
    const r = call(`${API} export function f() { return new ApiError(500, "boom").status; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 500 });
  });

  it("message ToString 口径与 new Error 同：number → \"5\"、缺省 → \"\"", () => {
    const n = call(`${API} export function f() { return new ApiError(1, 5).message; }`, "f");
    expect(litValue(n.result)).toEqual({ ok: true, value: "5" });
    const e = call(`${API} export function f() { return new ApiError(1).message; }`, "f");
    expect(litValue(e.result)).toEqual({ ok: true, value: "" });
  });

  it("extends TypeError：name → \"TypeError\"", () => {
    const r = call(
      `export class TE extends TypeError { constructor(m) { super(m); } }
       export function f() { return new TE("bad").name; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it("隐式 ctor（class X extends Error {}）：args 透传、槽落地", () => {
    const src = `
export class Implicit extends Error { m() { return 7; } }
export function msg() { return new Implicit("imp").message; }
export function name() { return new Implicit("imp").name; }
export function meth() { return new Implicit("imp").m(); }
`;
    expect(litValue(call(src, "msg").result)).toEqual({ ok: true, value: "imp" });
    expect(litValue(call(src, "name").result)).toEqual({ ok: true, value: "Error" });
    expect(litValue(call(src, "meth").result)).toEqual({ ok: true, value: 7 });
  });

  it("中间用户类链（B extends A extends Error）：brand 不换名、A 字段落地", () => {
    const src = `
export class A extends Error { aField = 1; }
export class B extends A { bField = 2; }
export function msg() { return new B("deep").message; }
export function name() { return new B("deep").name; }
export function a() { return new B("deep").aField; }
export function b() { return new B("deep").bField; }
`;
    expect(litValue(call(src, "msg").result)).toEqual({ ok: true, value: "deep" });
    expect(litValue(call(src, "name").result)).toEqual({ ok: true, value: "Error" });
    expect(litValue(call(src, "a").result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(src, "b").result)).toEqual({ ok: true, value: 2 });
  });

  it("子类自有 name 实例字段覆盖基类 name 槽（源序在 super 后）", () => {
    const r = call(
      `export class N extends Error { name = "N"; constructor(m) { super(m); } }
       export function f() { return new N("x").name; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "N" });
  });

  it("AggregateError 作基类：实参序 errors/message/cause 与 new 同口径", () => {
    const src = `
export class Agg extends AggregateError { constructor(errors, message, options) { super(errors, message, options); } }
export function msg() { return new Agg(["e1"], "x", { cause: 9 }).message; }
export function err0() { return new Agg(["e1"], "x", { cause: 9 }).errors[0]; }
export function cause() { return new Agg(["e1"], "x", { cause: 9 }).cause; }
export function name() { return new Agg(["e1"], "x", { cause: 9 }).name; }
`;
    expect(litValue(call(src, "msg").result)).toEqual({ ok: true, value: "x" });
    expect(litValue(call(src, "err0").result)).toEqual({ ok: true, value: "e1" });
    expect(litValue(call(src, "cause").result)).toEqual({ ok: true, value: 9 });
    expect(litValue(call(src, "name").result)).toEqual({ ok: true, value: "AggregateError" });
  });

  it("options.cause 经 super 透传（Error 基类第二实参）", () => {
    const r = call(
      `export class C extends Error { constructor(m, o) { super(m, o); } }
       export function f() { return new C("x", { cause: 7 }).cause; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("throw new 派生错误 → catch 形参可读 message/name", () => {
    const r = call(
      `${API} export function f() { try { throw new ApiError(500, "boom"); } catch (e) { return e.message; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "boom" });
  });
});
