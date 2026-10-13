/**
 * Bug 59：JSON.stringify 的 callable replacer 此前不调用、不记 may-throw——
 * 抛错 replacer 静默「成功」（L2 盲区）。修复：fn 形 replacer 逐项桥接
 * （原生 SerializeJSONProperty 语义：每个键——含根 ""——先调
 * replacer.call(holder, key, value)，再对返回值递归序列化）。逐层剥离
 * 保证调用序：replacer 可把环/bigint 变换掉（不误抛），抛错 replacer
 * 定抛传播；不可折返回值 → 值域 partial + 未见深层键 may-throw 记账。
 * 可能 callable 的抽象 replacer（any/brand/sum…）→ may-throw 记账。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, effects, throwsError } from "./eval-helpers.ts";

describe("Bug 59: JSON.stringify callable replacer", () => {
  it("throwing replacer propagates the definite throw (native parity)", () => {
    const r = call(
      `export function f() {
        try { JSON.stringify({a:1}, (k, v) => { throw new Error("x"); }); return "no-throw"; }
        catch (e) { return e.message; }
      }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });

  it("transforming replacer folds the transformed output exactly", () => {
    const r = call(
      `export function f() { return JSON.stringify({a:1,b:2}, (k,v) => typeof v === "number" ? v*10 : v); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":10,"b":20}' });
  });

  it("replacer returning undefined omits the key (native semantics)", () => {
    const r = call(
      `export function f() { return JSON.stringify({a:1,b:2}, (k,v) => k === "a" ? undefined : v); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"b":2}' });
  });

  it("root call receives key \"\" — replacer can salvage a function receiver", () => {
    // 原生：JSON.stringify(()=>1, () => 5) → "5"（replacer 先于顶层省略）
    const r = call(`export function f() { return JSON.stringify(() => 1, () => 5); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "5" });
  });

  it("space applies on top of the replacer walk", () => {
    const r = call(`export function f() { return JSON.stringify({a:1}, (k,v) => v, 2); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: '{\n  "a": 1\n}' });
  });

  it("replacer can filter a cyclic edge away (no false definite throw)", () => {
    // 环检测在 replacer 之后：原生返回 "{}"，不得先抛 cyclic TypeError
    const r = call(
      `export function f() {
        const o = {}; o.self = o;
        return JSON.stringify(o, (k,v) => k === "self" ? undefined : v);
      }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "{}" });
  });

  it("replacer can transform a bigint member away (no false definite throw)", () => {
    const r = call(
      `export function f() { return JSON.stringify({a: 1n}, (k,v) => typeof v === "bigint" ? 0 : v); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":0}' });
  });

  it("identity replacer on a cycle still throws TypeError (native parity)", () => {
    const r = call(
      `export function f() { const o = {}; o.self = o; return JSON.stringify(o, (k,v) => v); }`,
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("abstract replacer return degrades to partial string + may-throw for unseen entries", () => {
    // x 抽象 → replacer 返回抽象 → 值域 partial 占位（注册 skip），
    // 未见深层键的条件抛 replacer → may-throw 记账（不再静默 no-throw）
    const r = call(
      `export function f(x) { return JSON.stringify({a: x, b: {c: x}}, (k,v) => typeof v === "number" ? v*10 : v); }`,
      "f",
    );
    expect(r.result).toBeTruthy(); // string 值域（非 never）
    const eff = effects(
      `export function f(x) { return JSON.stringify({a: x}, (k,v) => typeof v === "number" ? v*10 : v); }`,
    );
    expect(eff).toContain("Error");
  });
});
