/**
 * `Object.defineProperty` 实参只求值一次（137）+ `delete` / `defineProperty`
 * 的写回在**求值点**发生（176）回归。
 *
 * Bug 137：语句位 defineProperty 的「写回」**重发整条调用** —— 除第一实参外
 * 每个实参都被求值两次（计算键 / 描述符里的副作用翻倍）。
 *
 * Bug 176：`delete` / `Object.defineProperty` 是**两段式**发射——表达式段发
 * 只读值通道（$delRes），真正的变更被收成一条**语句位**写回行 ⇒ 出现在更大
 * 表达式里时，写回只能挂在整条语句之后 ⇒ 同一条表达式里排在它后面的读看到
 * **变更前**的状态。
 *
 * 修法：两者都下沉到**求值点**（表达式位自包含 IIFE）——实参/键只求值一次，
 * 删除与布尔值同点产出，写回同点完成。
 *
 * 锚定值均为 node 原生实测（各断言注释）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("Object.defineProperty 的实参只求值一次", () => {
  it("计算键实参 → \"k\"（修前 \"k,k\"）", () => {
    const r = call(
      `export function f() { let log = []; const o = {}; Object.defineProperty(o, (log.push("k"), "a"), { value: 1 }); return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "k" });
  });

  it("描述符里的表达式 → \"v\"（修前 \"v,v\"）", () => {
    const r = call(
      `export function f() { let log = []; const o = {}; Object.defineProperty(o, "a", { value: (log.push("v"), 1) }); return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "v" });
  });

  it("键与描述符各一次 → \"k,v\"（修前 \"k,v,k,v\"）", () => {
    const r = call(
      `export function f() { let log = []; const o = {}; Object.defineProperty(o, (log.push("k"), "a"), { value: (log.push("v"), 1) }); return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "k,v" });
  });

  it("描述符是调用 → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let calls = 0; function desc(){ calls++; return { value: 1 }; } const o = {}; Object.defineProperty(o, "a", desc()); return calls; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("defineProperties 的描述符 → \"v\"（修前 \"v,v\"）", () => {
    const r = call(
      `export function f() { let log = []; class A{} const o = new A(); Object.defineProperties(o, { a: { value: (log.push("v"), 1) } }); return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "v" });
  });

  it("表达式位的 defineProperty 实参也只求值一次 → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let calls = 0; function desc(){ calls++; return { value: 1 }; } const o = {}; const r = Object.defineProperty(o, "a", desc()); return calls; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});

describe("delete / defineProperty 的写回在求值点发生", () => {
  it("表达式内 delete 后的 in 读 → \"true,false\"（修前 \"true,true\"）", () => {
    const r = call(
      `export function f() { const a = [1, 2]; return String(delete a[0]) + "," + String(0 in a); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,false" });
  });

  it("表达式内 delete 后的下标读 → \"true,undefined\"（修前 \"true,1\"）", () => {
    const r = call(
      `export function f() { const a = [1, 2]; return String(delete a[0]) + "," + String(a[0]); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,undefined" });
  });

  it("表达式内 delete 后的属性读 → \"true:undefined\"（修前 \"true:1\"）", () => {
    const r = call(`export function f() { const o = { x: 1 }; return delete o.x + ":" + o.x; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "true:undefined" });
  });

  it("表达式内 defineProperty 后的 in 读 → \"2,true\"（修前 \"2,false\"）", () => {
    const r = call(
      `export function f() { const o = {}; return String(Object.defineProperty(o, "b", { value: 2 }).b) + "," + String("b" in o); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "2,true" });
  });

  it("表达式内 defineProperty 后的属性读 → 9（修前 undefined）", () => {
    const r = call(
      `export function f() { const o = {}; return (Object.defineProperty(o, "y", { value: 9 }), o.y); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("赋值位的 delete 仍正确 → \"true,false\"", () => {
    const r = call(
      `export function f() { const a = [1, 2]; const r = delete a[0]; return String(r) + "," + String(0 in a); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,false" });
  });

  it("语句位的 delete 仍正确 → \"false\"", () => {
    const r = call(`export function f() { const a = [1, 2]; delete a[0]; return String(0 in a); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "false" });
  });

  it("成员赋值对照不受影响 → \"2,2\"", () => {
    const r = call(`export function f() { const o = { a: 1 }; return String(o.a = 2) + "," + o.a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "2,2" });
  });
});

describe("delete / defineProperty 的非回归对照", () => {
  it("普通对象删键 → 槽消失", () => {
    const r = call(`export function f() { const o = { a: 1 }; delete o.a; return "a" in o ? "still" : "gone"; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "gone" });
  });

  it("嵌套成员 delete → 内层槽消失", () => {
    const r = call(
      `export function f() { const o = { a: { b: 1 } }; delete o.a.b; return "b" in o.a ? "still" : "gone"; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "gone" });
  });

  it("可选链 delete o?.a → 槽消失", () => {
    const r = call(`export function f() { const o = { a: 1 }; delete o?.a; return "a" in o ? "still" : "gone"; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "gone" });
  });

  it("类实例 delete → 槽消失", () => {
    const r = call(
      `export function f() { class C { constructor(){ this.a = 1; } } const c = new C(); delete c.a; return "a" in c ? "still" : "gone"; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "gone" });
  });

  it("数组 delete a[0] → 长度不变、读出 undefined", () => {
    const r = call(`export function f() { const a = [1, 2]; delete a[0]; return a.length + "," + String(a[0]); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "2,undefined" });
  });

  it("Proxy deleteProperty 陷阱仍恰好一次 → 1", () => {
    const r = call(
      `export function f() { let n = 0; const p = new Proxy({ a: 1 }, { deleteProperty(t, k){ n = n + 1; return true; } }); delete p.a; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("语句位 defineProperty 后属性就位 → \"yes\"", () => {
    const r = call(
      `export function f() { const o = {}; Object.defineProperty(o, "b", { value: 2 }); return "b" in o ? "yes" : "no"; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "yes" });
  });

  it("member 目标的 defineProperty → 属性就位 → \"yes\"", () => {
    const r = call(
      `export function f() { const o = { p: {} }; Object.defineProperty(o.p, "b", { value: 2 }); return "b" in o.p ? "yes" : "no"; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "yes" });
  });

  it("defineProperty 装访问器 → 读出 7", () => {
    const r = call(
      `export function f() { const o = {}; Object.defineProperty(o, "b", { get(){ return 7; } }); return o.b; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });
});
