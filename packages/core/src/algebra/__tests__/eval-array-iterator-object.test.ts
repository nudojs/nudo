/**
 * Bug 63：Array.prototype.entries/keys/values 返回元素序列（tuple），
 * 而非迭代器对象。Array.isArray 折 true、Object.keys 折 ["0","1","2"]、
 * typeof .next 折 "undefined"——三面全 wrong-exact。
 * 修复：tuple 接收者走 Map/Set 的 collectionIteratorAbs 协议面（next/
 * @@iterator 槽 + 元素侧表——均不可枚举：原生 next 在 %ArrayIteratorPrototype%
 * 上）；长度未知（arr 接收者）走 abstractSeqIteratorAbs 保守面（不挂侧表，
 * spread/for-of 不折精确长度）。
 */
import { describe, it, expect } from "vitest";
import { litValue, abs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

/** arr 形态（长度未知）实参：invokeArrMethod 非 tuple 臂的接收者 */
const abstractArr = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "partial",
);

describe("Bug 63: entries/keys/values return iterator objects", () => {
  it("Array.isArray → false（迭代器对象非数组）", () => {
    expect(v(`export function f() { return Array.isArray([1,2,3].entries()); }`)).toBe(false);
    expect(v(`export function f() { return Array.isArray([1,2,3].keys()); }`)).toBe(false);
    expect(v(`export function f() { return Array.isArray([1,2,3].values()); }`)).toBe(false);
  });

  it("Object.keys → []（next 在原型上，非自有可枚举）", () => {
    expect(v(`export function f() { return Object.keys([1,2,3].entries()).length; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys([1,2,3].keys()).length; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys([1,2,3].values()).length; }`)).toBe(0);
  });

  it("typeof .next → \"function\"", () => {
    expect(v(`export function f() { return typeof [1,2,3].entries().next; }`)).toBe("function");
    expect(v(`export function f() { return typeof [1,2,3].keys().next; }`)).toBe("function");
    expect(v(`export function f() { return typeof [1,2,3].values().next; }`)).toBe("function");
  });

  it("next() 协议：按调用序折 {value, done}", () => {
    expect(v(`export function f() { return [1,2,3].entries().next().value[1]; }`)).toBe(1);
    expect(v(`export function f() { return [1,2,3].keys().next().value; }`)).toBe(0);
    expect(v(`export function f() { return [1,2,3].values().next().value; }`)).toBe(1);
    expect(v(`export function f() { return [1,2,3].values().next().done; }`)).toBe(false);
    expect(v(`export function f() { const it = [1].values(); it.next(); return it.next().done; }`)).toBe(true);
    expect(v(`export function f() { const it = [1].values(); it.next(); return it.next().value === undefined; }`)).toBe(true);
  });

  it("spread 精确展开（含 hole / entries 条目元组）", () => {
    expect(v(`export function f() { return [...[1,2,3].entries()].length; }`)).toBe(3);
    expect(v(`export function f() { const e = [...[1,2,3].entries()]; return e[0][0] + "," + e[0][1] + "," + e[2][1]; }`)).toBe("0,1,3");
    expect(v(`export function f() { return [...[1,2,3].keys()].join(","); }`)).toBe("0,1,2");
    expect(v(`export function f() { const vs = [...[1,2,3].values()]; return vs[0] + vs[1] + vs[2]; }`)).toBe(6);
    // hole：keys 覆盖全下标；values/entries 按 Get 语义产出 undefined
    expect(v(`export function f() { return [...[1,,3].keys()].join(","); }`)).toBe("0,1,2");
    expect(v(`export function f() { return [...[1,,3].values()].length; }`)).toBe(3);
    expect(v(`export function f() { return [...[1,,3].values()][1] === undefined; }`)).toBe(true);
    expect(v(`export function f() { return [...[1,,3].entries()][1][1] === undefined; }`)).toBe(true);
  });

  it("for-of / 解构 消费链路（Array.from 同引擎既有精度：元素域数组）", () => {
    expect(v(`export function f() { let s = 0; for (const k of [10,20].keys()) s += k; return s; }`)).toBe(1);
    expect(v(`export function f() { let out = []; for (const [i, x] of [1,2,3].entries()) out.push(i * x); return out.join(","); }`)).toBe("0,2,6");
    expect(v(`export function f() { const [[i, x]] = [7,8].entries(); return i + x; }`)).toBe(7);
    const af = call(`export function f() { return Array.from([5,6].values()).join("+"); }`);
    expect(litValue(af.result).ok).toBe(false); // 引擎 Array.from 面恒元素域（同 Array.from([5,6])）
  });

  it("消费位同步（Bug 54 同款）：next 后 spread 取剩余并排空", () => {
    expect(v(`export function f() { const it = [1,2,3].values(); it.next(); return [...it].join(""); }`)).toBe("23");
    expect(v(`export function f() { const it = [1,2,3].values(); it.next(); let s = 0; for (const v of it) s += v; return s; }`)).toBe(5);
    expect(v(`export function f() { const it = [1,2,3].values(); const a = [...it]; const b = [...it]; return a.length + b.length; }`)).toBe(3);
  });

  it("回调三参 a.entries() 是迭代器对象（非条目数组）", () => {
    expect(v(`export function f() { return [1,2].map((x, i, a) => Array.isArray(a.entries())).join(","); }`)).toBe("false,false");
    expect(v(`export function f() { return [1,2].map((x, i, a) => typeof a.entries().next).join(","); }`)).toBe("function,function");
  });

  it("抽象数组（arr 形态，长度未知）：迭代器对象保守面，不折精确长度", () => {
    const r = call(`export function f(a) { let out = []; for (const k of a.keys()) { out.push(k); } return out; }`, "f", [abstractArr]);
    expect(litValue(r.result).ok).toBe(false); // 出口 join 非具体（0..maxIters）
    const isArr = call(`export function f(a) { return Array.isArray(a.entries()); }`, "f", [abstractArr]);
    expect(litValue(isArr.result)).toEqual({ ok: true, value: false });
    const nextFn = call(`export function f(a) { return typeof a.values().next; }`, "f", [abstractArr]);
    expect(litValue(nextFn.result)).toEqual({ ok: true, value: "function" });
    const keysLen = call(`export function f(a) { return Object.keys(a.keys()).length; }`, "f", [abstractArr]);
    expect(litValue(keysLen.result)).toEqual({ ok: true, value: 0 });
    // spread 不折精确长度（无元素侧表 → arr/unknown 面）
    const spread = call(`export function f(a) { return [...a.values()].length; }`, "f", [abstractArr]);
    expect(litValue(spread.result).ok).toBe(false);
  });

  it("Map/Set 迭代器 Object.keys → []（共享 collectionIteratorAbs 修复）", () => {
    expect(v(`export function f() { return Object.keys(new Map().keys()).length; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys(new Set().values()).length; }`)).toBe(0);
  });
});
