/**
 * Bug 125：TypedArray 枚举视图——整数索引异质属性（ECMA-262 §10.4.5）是
 * 自有 { writable, enumerable, configurable: true } 键 "0".."length-1"；
 * length 是 %TypedArray%.prototype 访问器（非自有键，gOPN 不含）。
 * 此前 BUILTIN_BRAND_NO_ENUM_KEYS 整族折空：Object.keys/values/entries/
 * gOPN/for-in 全部 wrong-exact 折 []，entries[0] 下标读被证 always-throw
 * （false-throw）。修复口径：typedArrayEnumKeyView（enum-entries.ts）读
 * makeTypedArrayAbs 装入内层的 length 槽（数字形态 + 字面量源形态）——
 * exact → "0".."n-1" 精确投影（values/entries 走元素域）；无槽/抽象长度 →
 * partial 开放域（不折空）。
 * Controls：Map/Date/ArrayBuffer/DataView 零可枚举自有键（原生同）；
 * 元素读/spread 不经枚举视图（域投影维持）。
 */
import { describe, it, expect } from "vitest";
import { call, tupleEls, isNever } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import type { Abs } from "../abs.ts";

/** 调用结果的 Abs（shape 探针用） */
function result(src: string): Abs {
  return call(src, "run").result;
}

/** TA 枚举视图产物的 shape 面（tuple/arr + 键串/元素域） */
function shapeOf(src: string): { k: string; elements?: Abs[]; element?: Abs } {
  const s = result(src).shape as { k: string; elements?: Abs[]; element?: Abs };
  return s;
}

describe("Bug 125: TypedArray 枚举视图（Object.keys/values/entries/gOPN + for-in）", () => {
  it("Object.keys：数字形态精确 0..n-1；gOPN 同键集且不含 length", () => {
    expect(tupleEls(result(`export function run() { return Object.keys(new Uint8Array(3)); }`))).toEqual(["0", "1", "2"]);
    expect(tupleEls(result(`export function run() { return Object.keys(new Uint8Array(0)); }`))).toEqual([]);
    // gOPN：node 实测 gOPN(new Uint8Array(3)) → ["0","1","2"]——length 是
    // 原型访问器非自有键，不在返回面（与数组 gOPN 含 length 不同）
    expect(tupleEls(result(`export function run() { return Object.getOwnPropertyNames(new Uint8Array(3)); }`))).toEqual(["0", "1", "2"]);
  });

  it("Object.keys/gOPN：字面量源形态精确投影（length 槽 = 源元数，hole 计长）", () => {
    expect(tupleEls(result(`export function run() { return Object.keys(new Uint8Array([1, 2, 3])); }`))).toEqual(["0", "1", "2"]);
    expect(tupleEls(result(`export function run() { return Object.keys(new Int16Array([1, 2])); }`))).toEqual(["0", "1"]);
    expect(tupleEls(result(`export function run() { return Object.keys(new Float64Array([1.5])); }`))).toEqual(["0"]);
    expect(tupleEls(result(`export function run() { return Object.getOwnPropertyNames(new Uint8Array([1, 2])); }`))).toEqual(["0", "1"]);
    expect(litValue(result(`export function run() { return Object.keys(new Uint8Array([1, , 3])).length; }`))).toEqual({ ok: true, value: 3 });
  });

  it("Object.values/entries：长度精确 + 元素域值（number/bigint 家族）", () => {
    const vals = result(`export function run() { return Object.values(new Uint8Array(3)); }`);
    expect(vals.shape.k).toBe("tuple");
    expect((vals.shape as { elements: Abs[] }).elements.length).toBe(3);
    for (const e of (vals.shape as { elements: Abs[] }).elements) {
      expect(e.shape).toMatchObject({ k: "prim", type: "number" });
    }
    // 枚举键全在界内——元素读不并入越界 undefined 臂
    const biVals = result(`export function run() { return Object.values(new BigInt64Array(2)); }`);
    for (const e of (biVals.shape as { elements: Abs[] }).elements) {
      expect(e.shape).toMatchObject({ k: "prim", type: "bigint" });
    }
    const entries = result(`export function run() { return Object.entries(new Uint8Array(3)); }`);
    expect(entries.shape.k).toBe("tuple");
    const pairs = (entries.shape as { elements: Abs[] }).elements;
    expect(pairs.length).toBe(3);
    // 键精确（"0"）；值是元素域（无 lit 项）
    expect(litValue((pairs[0]!.shape as { elements: Abs[] }).elements[0] as never)).toEqual({ ok: true, value: "0" });
    expect((pairs[0]!.shape as { elements: Abs[] }).elements[1]!.shape).toMatchObject({ k: "prim", type: "number" });
  });

  it("entries[0] 不再被证 always-throw（此前空视图 false-throw）", () => {
    const r = call(`export function run() { return Object.entries(new Uint8Array([1, 2, 3]))[0].join(":"); }`, "run");
    expect(isNever(r.result)).toBe(false);
  });

  it("for-in：数字/字面量源形态精确 n 次；空 TA 0 次", () => {
    expect(litValue(result(`export function run() { let n = 0; for (const k in new Uint8Array(3)) n++; return n; }`))).toEqual({ ok: true, value: 3 });
    expect(litValue(result(`export function run() { let n = 0; for (const k in new Uint8Array([1, 2, 3])) n++; return n; }`))).toEqual({ ok: true, value: 3 });
    expect(litValue(result(`export function run() { let n = 0; for (const k in new Uint8Array(0)) n++; return n; }`))).toEqual({ ok: true, value: 0 });
  });

  it("零可枚举自有键内建 brand controls（Map/Date/ArrayBuffer/DataView）", () => {
    for (const recv of [
      `new Map([["a", 1]])`,
      `new Date(0)`,
      `new ArrayBuffer(8)`,
      `new DataView(new ArrayBuffer(8))`,
    ]) {
      expect(tupleEls(result(`export function run() { return Object.keys(${recv}); }`))).toEqual([]);
      expect(litValue(result(`export function run() { return Object.keys(${recv}).length; }`))).toEqual({ ok: true, value: 0 });
    }
  });

  it("元素读/spread controls：不经枚举视图，域投影维持", () => {
    // 数字形态下标读：元素域 ∪ 越界 undefined（长度未建模口径不变）
    const r = call(`export function run() { return new Uint8Array([1, 2, 3])[0]; }`, "run");
    expect(isNever(r.result)).toBe(false);
    // spread：抽象域（不因枚举视图变化折精确）
    const sp = shapeOf(`export function run() { return [...new Uint8Array(2)]; }`);
    expect(["arr", "tuple"]).toContain(sp.k);
  });

  it("长度未建模形态（from/of 静态面）→ 开放域不折空", () => {
    // Uint8Array.from(...)：无 length 槽 → partial string[]（诚实开放，
    // 不得折 []——键集非空不可排除）
    const k = shapeOf(`export function run() { return Object.keys(Uint8Array.from([1, 2])); }`);
    if (k.k === "tuple") {
      // from 源若被折入槽（未来精度提升）则键集精确——只断言不折空
      expect((k.elements ?? []).length).toBeGreaterThan(0);
    } else {
      expect(k.k).toBe("arr");
    }
  });

  it("assign/spread 的 TA 源键投影（Bug 125 残余：CopyDataProperties 同口径）", () => {
    expect(
      litValue(call(`export function f() { return Object.keys(Object.assign({}, new Uint8Array([1, 2, 3]))).join(","); }`).result),
    ).toEqual({ ok: true, value: "0,1,2" });
    expect(
      litValue(call(`export function f() { return Object.keys({ ...new Uint8Array([1, 2, 3]) }).join(","); }`).result),
    ).toEqual({ ok: true, value: "0,1,2" });
  });
});
