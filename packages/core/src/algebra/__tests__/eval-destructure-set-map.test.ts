/**
 * Bug 82 回归：数组解构绑定 Set/Map 元素——$idx/$arrRest 此前无 Set/Map
 * brand 臂，落 inner obj 槽 miss 折 undefined（元素绑 undefined、rest 折
 * undef、后续成员读假抛 TypeError）。修复：与 spread / for-of /
 * Array.from 口径一致，消费同源侧表（setElementsAbs / mapEntriesAbs）；
 * Map 解构元素是 [k,v] 对。
 */
import { describe, it, expect } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";

describe("Bug 82：数组解构绑定 Set/Map 元素", () => {
  it("Set 解构逐位绑元素（值使用不再 NaN / undefined）", () => {
    expect(val(`export function f() { const [a, b] = new Set([1, 2]); return a + b; }`))
      .toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { const [a, b] = new Set(["p", "q"]); return a + b; }`))
      .toEqual({ ok: true, value: "pq" });
  });

  it("Map 解构元素是 [k,v] 对（tuple 精确）", () => {
    expect(tupleEls(call(`export function f() { const [a, b] = new Map([["a", 1], ["b", 2]]); return b; }`).result))
      .toEqual(["b", 2]);
    expect(val(`export function f() { const [a] = new Map([["a", 1]]); return a.join(":"); }`))
      .toEqual({ ok: true, value: "a:1" });
  });

  it("对象元素经解构读成员（假抛消除）", () => {
    expect(val(`export function f() { const [x] = new Set([{ v: 1 }]); return x.v; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const [x, y] = new Set([{ v: 1 }, { v: 2 }]); return x.v + y.v; }`))
      .toEqual({ ok: true, value: 3 });
  });

  it("typeof 面（number,string）", () => {
    expect(val(`export function f() { const [a, b] = new Set([1, "s"]); return typeof a + "," + typeof b; }`))
      .toEqual({ ok: true, value: "number,string" });
  });

  it("参数模式解构 Set 实参", () => {
    expect(val(`export function f() { function g([a, b]) { return a + b; } return g(new Set([3, 4])); }`))
      .toEqual({ ok: true, value: 7 });
  });

  it("rest 模式绑元素数组（长度精确）", () => {
    expect(val(`export function f() { const [...all] = new Set([1, 2, 3]); return all.length; }`))
      .toEqual({ ok: true, value: 3 });
  });

  it("Array.isArray(解构出的 Map 条目) → true", () => {
    expect(val(`export function f() { const [e] = new Map([["a", 1]]); return Array.isArray(e); }`))
      .toEqual({ ok: true, value: true });
  });

  it("越界位绑 undefined（空 Set / OOB）", () => {
    expect(val(`export function f() { const [a] = new Set(); return typeof a; }`))
      .toEqual({ ok: true, value: "undefined" });
    expect(val(`export function f() { const [a, b, c] = new Set([1]); return typeof c; }`))
      .toEqual({ ok: true, value: "undefined" });
  });

  it("洞模式跳位", () => {
    expect(val(`export function f() { const [a, , c] = new Set([1, 2, 3]); return a + c; }`))
      .toEqual({ ok: true, value: 4 });
  });

  it("影子写入后解构（m.set 追加可见）", () => {
    expect(val(`export function f() { const m = new Map(); m.set("k", 5); const [[, v]] = [...m]; return v; }`))
      .toEqual({ ok: true, value: 5 });
  });

  it("控制组：字符串/迭代器方法解构不回归", () => {
    expect(val(`export function f() { const [a, b] = "xy"; return a + b; }`))
      .toEqual({ ok: true, value: "xy" });
    expect(val(`export function f() { const ks = [...new Map([["a", 1]]).keys()]; return ks.join(""); }`))
      .toEqual({ ok: true, value: "a" });
    expect(val(`export function f() { const es = [...new Map([["a", 1]]).entries()]; return es[0].join(":"); }`))
      .toEqual({ ok: true, value: "a:1" });
    expect(val(`export function f() { const vs = [...new Map([["a", 1]]).values()]; return vs.join(""); }`))
      .toEqual({ ok: true, value: "1" });
    expect(val(`export function f() { let s = 0; for (const [k, v] of new Map([["a", 1], ["b", 2]])) s += v; return s; }`))
      .toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { return [...new Set([1, 2, 2])].join(","); }`))
      .toEqual({ ok: true, value: "1,2" });
  });
});
