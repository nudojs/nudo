/**
 * 求值引擎 for-in：此前 transpile 无 ForInStatement case，整体 skip——
 * 循环体零迭代（对象/数组/字符串键遍历全部丢失）。修复：生成
 * $forOf($forInKeys(obj), …)，键序按原生（整数键升序 → 字符串键插入序），
 * 数组 hole 槽不出键，循环内 break/continue 同信号机制生效。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

describe("evaluator for-in", () => {
  it("iterates object keys in insertion order", () => {
    const r = call(
      `export function f() { let s = ""; for (const x in { a: 1, b: 2 }) s += x; return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ab" });
  });

  it("integer keys come first in ascending order", () => {
    const r = call(
      `export function f() { let s = ""; for (const x in { 10: "a", 2: "b" }) s += x; return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "210" });
  });

  it("iterates array indices as strings", () => {
    const r = call(`export function f() { let s = ""; for (const x in [9, 8]) s += x; return s; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "01" });
  });

  it("iterates string indices", () => {
    const r = call(`export function f() { let s = ""; for (const x in "abc") s += x; return s; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "012" });
  });

  it("reads values through the loop key", () => {
    const r = call(
      `export function f() { let s = 0; const o = { a: 1, b: 2 }; for (const k in o) s += o[k]; return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("break exits for-in", () => {
    const r = call(
      `export function f() { let s = 0; const o = { a: 1, b: 2, c: 3 }; for (const k in o) { if (k === "b") break; s += o[k]; } return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("continue skips in for-in", () => {
    const r = call(
      `export function f() { let s = 0; const o = { a: 1, b: 2, c: 3 }; for (const k in o) { if (k === "b") continue; s += o[k]; } return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("empty object iterates zero times", () => {
    const r = call(`export function f() { let n = 0; for (const k in {}) n++; return n; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("deleted array slot does not appear", () => {
    const r = call(
      `export function f() { let s = ""; const a = [1, 2, 3]; delete a[1]; for (const x in a) s += x; return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "02" });
  });
});

describe("Bug 98：for-in 访问已被删除的键（快照后逐迭代重查在场）", () => {
  it("体内 delete 未访问键 → 不再被访问（node 实测 n=1）", () => {
    const r = call(
      `export function f() { const o = { a: 1, b: 2 }; let n = 0; for (const k in o) { delete o.b; n++; } return n; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("键序列是进体前快照——删除当前键不跳后续（ks=\"ab\"），删未访问键跳过（n=1）", () => {
    const r = call(
      `export function f() { const o = { a: 1, b: 2 }; const ks = []; for (const k in o) { delete o[k]; ks.push(k); } return ks.join(""); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ab" });
  });

  it("delete 多个未访问键（n=1）", () => {
    const r = call(
      `export function f() { const o = { a: 1, b: 2, c: 3 }; let n = 0; for (const k in o) { if (k === "a") { delete o.b; delete o.c; } n++; } return n; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("成员表达式接收者：体内删除经属性链可见（n=1）", () => {
    const r = call(
      `export function f() { const o = { sub: { a: 1, b: 2 } }; let n = 0; for (const k in o.sub) { delete o.sub.b; n++; } return n; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("数组下标键同样跳过体内删除（native s=\"013\"）", () => {
    const r = call(
      `export function f() { const a = [1, 2, 3, 4]; let s = ""; for (const k in a) { delete a[2]; s += k; } return s; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "013" });
  });

  it("控制组：删除已访问键不影响后续计数（n=2）", () => {
    const r = call(
      `export function f() { const o = { a: 1, b: 2 }; let n = 0; for (const k in o) { delete o.a; n++; } return n; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("控制组：无 delete 行为不变（n=2）", () => {
    const r = call(
      `export function f() { const o = { a: 1, b: 2 }; let n = 0; for (const k in o) n++; return n; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("控制组：先值读后删除键（seen.length=1）", () => {
    const r = call(
      `export function f() { const o = { a: 1, b: 2 }; const seen = []; for (const k in o) { seen.push(o[k]); delete o.b; } return seen.length; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("副作用接收者单次求值（(c++, o) 序列表达式 / 调用形态）", () => {
    const r = call(
      `export function f() { let c = 0; const o = { a: 1 }; for (const k in (c++, o)) { c += 10; } return c; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 11 });
    const r2 = call(
      `export function f() { let c = 0; function mk() { c++; return { x: 1 }; } for (const k in mk()) { c += 10; } return c; }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: 11 });
  });

  it("同块多个副作用接收者 for-in（临时名唯一化，不重复声明）", () => {
    const r = call(
      `export function f() { let c = 0; for (const k in (c++, { a: 1 })) {} for (const k in (c++, { b: 2 })) {} return c; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});
