/**
 * 语句位 `delete o[k]` 的 Proxy deleteProperty 陷阱**恰好派发一次**回归
 * （Bug 172）。
 *
 * 根因：`runtime/members.ts` 的 $del（语句位写回通道 `o = $del(o, k)`）与
 * $delRes（delete 表达式值通道）**各自**派发一次 deleteProperty 陷阱 ⇒
 * Proxy 的陷阱被调用两次（原生恰好一次），陷阱副作用翻倍。
 *
 * 修法：陷阱的**派发**唯一发生在 $delRes；$del 只探测陷阱在场（不调用），
 * 在场 → 删除责任在陷阱、靶不动、原样返回。
 *
 * 锚定值均为 node 原生实测（各断言注释）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("delete 的 Proxy deleteProperty 陷阱恰好派发一次", () => {
  it("语句位 delete → 陷阱日志一条（修前 \"del:a,del:a\"）", () => {
    const r = call(
      `export function f() { const log = []; const p = new Proxy({}, { deleteProperty(t, k){ log.push("del:" + String(k)); return true; } }); delete p.a; return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "del:a" });
  });

  it("语句位 delete → 陷阱计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const p = new Proxy({ a: 1 }, { deleteProperty(t, k){ n = n + 1; return true; } }); delete p.a; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("表达式位 delete → 陷阱计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const p = new Proxy({ a: 1 }, { deleteProperty(t, k){ n = n + 1; return true; } }); const v = delete p.a; return [v, n].join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,1" });
  });

  it("陷阱返回 false → strict TypeError 且陷阱只被调一次", () => {
    const r = call(
      `export function f() { const log = []; const p = new Proxy({}, { deleteProperty(t, k){ log.push("del:" + String(k)); return false; } }); try { delete p.a; return "no-throw|" + log.join(","); } catch (e) { return "threw|" + log.join(","); } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "threw|del:a" });
  });

  it("嵌套成员 delete 的内层 Proxy 陷阱也只派发一次", () => {
    const r = call(
      `export function f() { let n = 0; const inner = new Proxy({ b: 1 }, { deleteProperty(t, k){ n = n + 1; return true; } }); const o = { a: inner }; delete o.a.b; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});

describe("delete 的非 Proxy 语义不受影响", () => {
  it("普通对象删键 → 槽消失", () => {
    const r = call(`export function f() { const o = { a: 1 }; delete o.a; return "a" in o ? "still" : "gone"; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "gone" });
  });

  it("普通对象 delete 的表达式值 → true", () => {
    const r = call(
      `export function f() { const o = { a: 1 }; const v = delete o.a; return [v, "a" in o].join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,false" });
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
});
