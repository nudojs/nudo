/**
 * 短路表达式左操作数单次求值回归（报告 Bug 134）。
 *
 * $fork 只保证**测试**单次求值并惰性跑臂，测试值本身不回传给臂——把左
 * 操作数的源码回填到臂里等于再求值一次：getter / 函数调用 / 计算键各跑
 * 两次（嵌套 `??` 跑四次）；自增 getter 第二次读到**不同的值**，返回值与
 * 后续状态随之全错。
 *
 * 修法：左操作数 impure（getter / 调用 / 计算键 …）且被臂复用时，先绑到
 * 临时量（__sc0 / fork 协议的 __test），测试与臂一律引用该绑定；纯左
 * （标识符 / 字面量 / this）重复读不可观测，保持原形态。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("短路左操作数单次求值（?? / || / &&）", () => {
  it("?? 的 getter 只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get x() { n++; return 1; } }; const v = o.x ?? 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("|| 的 getter 只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get x() { n++; return 1; } }; const v = o.x || 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("&& 的 getter 只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get x() { n++; return 1; } }; const v = o.x && 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("自增 getter：?? 的值是第一次读到的 1（修前折 2）", () => {
    const r = call(
      `export function f() { const o = { _v: 0, get x() { return ++this._v; } }; const v = o.x ?? 5; return v; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("计算键只求值一次：a[i++] ?? \"d\" → \"x|1\"（修前 \"undefined|2\"）", () => {
    const r = call(
      `export function f() { let i = 0; const a = ["x"]; return (a[i++] ?? "d") + "|" + i; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "x|1" });
  });

  it("嵌套 ?? 只跑一次（修前 4）", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get a() { n++; return 1; } }; const v = (o.a ?? 0) ?? 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("&& 的调用只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const g = () => { n++; return 0; }; const v = g() && 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("|| 的调用只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const g = () => { n++; return 0; }; const v = g() || 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("?? 的调用只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const g = () => { n++; return null; }; const v = g() ?? 5; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("纯左（标识符）语义不变：x ?? 5 → 5", () => {
    const r = call(`export function f() { let x = null; const v = x ?? 5; return v; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("纯左（标识符）语义不变：x || 5 → 1", () => {
    const r = call(`export function f() { let x = 1; const v = x || 5; return v; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("三元不受影响：o.x ? 1 : 2 的 getter 只跑一次", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get x() { n++; return 1; } }; const v = o.x ? 1 : 2; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});
