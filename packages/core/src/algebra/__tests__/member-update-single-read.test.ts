/**
 * 成员目标自增自减自包含回归（报告 Bug 155）。
 *
 * 原生 `o.p++` 是**一次 Get + 一次 Put**。引擎把更新拆成「表达式位求新值」+
 * 「语句级 rebind 写回」两段，两段各自独立发了一次 `readPathSrc(path)` ⇒
 * **读了两遍**：getter 跑两次（副作用翻倍）；有状态 getter 第二次读到不同值
 * ⇒ 连返回值也错。
 *
 * 修法：成员目标与标识符臂同口径**自包含**——读一次、写回下沉到表达式内，
 * 语句级 rebind pass 不再补写（否则双倍自增）。
 *
 * 注：计算键（`o[k()]++`）的键仍求值两次——那是 Bug 136 的**计算键内联**
 * 根因（member-path 层），本条只覆盖静态成员路径上的重复读。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, throwsError } from "./eval-helpers.ts";

describe("成员目标自增自减自包含（一次 Get + 一次 Put）", () => {
  it("o.p++ 的 getter 只调一次：\"gs\"（修前 \"ggs\"）", () => {
    const r = call(
      `export function f() { let log = ""; const o = { get p(){ log += "g"; return 1; }, set p(v){ log += "s"; } }; o.p++; return log; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "gs" });
  });

  it("++o.p 的 getter 只调一次：\"gs\"（修前 \"ggs\"）", () => {
    const r = call(
      `export function f() { let log = ""; const o = { get p(){ log += "g"; return 1; }, set p(v){ log += "s"; } }; ++o.p; return log; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "gs" });
  });

  it("有状态 getter：o.p++ 后再读 p → \"1:1\"（修前 \"1:2\"）", () => {
    const r = call(
      `export function f() { let log = ""; const o = { get p(){ log += "g"; return 1; }, set p(v){ log += "s"; } }; o.p++; return "1:" + o.p; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1:1" });
  });

  it("复合赋值不受影响：o.p += 1 → \"gs\"", () => {
    const r = call(
      `export function f() { let log = ""; const o = { get p(){ log += "g"; return 1; }, set p(v){ log += "s"; } }; o.p += 1; return log; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "gs" });
  });

  it("纯读 / 纯写不受影响：\"g\" / \"s\"", () => {
    const a = call(
      `export function f() { let log = ""; const o = { get p(){ log += "g"; return 1; }, set p(v){ log += "s"; } }; const v = o.p; return log; }`,
      "f",
    );
    expect(litValue(a.result)).toEqual({ ok: true, value: "g" });
    const b = call(
      `export function f() { let log = ""; const o = { get p(){ log += "g"; return 1; }, set p(v){ log += "s"; } }; o.p = 1; return log; }`,
      "f",
    );
    expect(litValue(b.result)).toEqual({ ok: true, value: "s" });
  });

  it("数据属性：o.p++ → 2（不自增两次）", () => {
    const r = call(`export function f() { const o = { p: 1 }; o.p++; return o.p; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("只读访问器上自增仍抛 TypeError（原生同款）", () => {
    const r = call(`export function f() { const o = { get p(){ return 5; } }; o.p++; return "" + o.p; }`, "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("表达式值：o.p++ → \"1|2\"；++o.p → \"2|2\"", () => {
    const a = call(`export function f() { const o = { p: 1 }; const v = o.p++; return v + "|" + o.p; }`, "f");
    expect(litValue(a.result)).toEqual({ ok: true, value: "1|2" });
    const b = call(`export function f() { const o = { p: 1 }; const v = ++o.p; return v + "|" + o.p; }`, "f");
    expect(litValue(b.result)).toEqual({ ok: true, value: "2|2" });
  });

  it("下标 / 嵌套成员目标不受影响：a[0]++ → 2、o.inner.p++ → 2", () => {
    const a = call(`export function f() { const a = [1]; a[0]++; return a[0]; }`, "f");
    expect(litValue(a.result)).toEqual({ ok: true, value: 2 });
    const b = call(`export function f() { const o = { inner: { p: 1 } }; o.inner.p++; return o.inner.p; }`, "f");
    expect(litValue(b.result)).toEqual({ ok: true, value: 2 });
  });
});
