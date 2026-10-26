/**
 * Object.assign × 目标不变性（frozen / sealed / nonext）回归。
 *
 * D1（回归 vs main）：frozen 目标的抛错门此前在**读源之前**按「每个源实参」
 * 无条件硬抛。原生 Object.assign 只在**实际执行 Set(target, key, value,
 * true)** 时失败（node 26 oracle）：
 *   Object.assign(Object.freeze({}), {})     → 不抛
 *   Object.assign(Object.freeze({}), null)   → 不抛
 *   Object.assign(Object.freeze({}), {a:1})  → TypeError
 * 现改为**源的可枚举自有键贡献分类**：零键 ⇒ 跳过（不写不抛）；键集不可判
 * ⇒ 记 may-throw（不定抛）；键集已知非空 ⇒ 逐键 [[Set]] 判定（新建键 /
 * 不可写数据属性 / 改原型 ⇒ TypeError；自有·继承 setter 派发 ⇒ 成功——
 * 原生 freeze 不禁访问器机制）。
 *
 * D2：sealed/nonext 的「新键」判定此前只看 `shape.slots`——自有访问器住
 * accessorTable 侧表（槽位只是占位，可能缺席）⇒ 访问器键被误判成新键硬抛。
 * 原生 Object.seal 不改访问器机制：自有 setter 仍然可用。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, anyAbs, litValue, type Abs } from "../abs.ts";
import { call, val, throwsError, effects } from "./eval-helpers.ts";
import { $objAccessor } from "../accessors.ts";
import { markExtState } from "../builtins/invariants.ts";
import { performObjectAssign } from "../builtins/object/descriptor.ts";

/** 直调面的返回值：不抛 → { ok: true, value } */
function throwsTypeError(src: string): boolean {
  return throwsError(call(src).throws, "TypeError");
}

describe("Object.assign × frozen 目标：只在真正 [[Set]] 时抛（D1）", () => {
  it("空源 {} → 不抛（此前假阳 TypeError）", () => {
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze({}), {});
      return 1;
    }`)).toBe(false);
  });

  it("null / undefined 源 → 不抛（原生跳过）", () => {
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze({}), null, undefined);
      return 1;
    }`)).toBe(false);
  });

  it("空源仍返回同一目标（目标可读回）", () => {
    const r = call(`export function f() {
      const t = Object.freeze({ a: 1 });
      const back = Object.assign(t, {});
      return back.a;
    }`);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("已知非空源 {a:1} → 仍抛 TypeError（新建键 / 不可扩展）", () => {
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze({}), { a: 1 });
      return 1;
    }`)).toBe(true);
  });

  it("已有键覆写 → 仍抛 TypeError（数据属性不可写）", () => {
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze({ a: 1 }), { a: 2 });
      return 1;
    }`)).toBe(true);
  });

  it("空字符串源（零下标键）→ 不抛；非空字符串源 → TypeError", () => {
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze({}), "");
      return 1;
    }`)).toBe(false);
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze({}), "ab");
      return 1;
    }`)).toBe(true);
  });

  it("frozen 数组目标：空源不抛 / 下标源 TypeError / length 源 TypeError", () => {
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze([1, 2]), {});
      return 1;
    }`)).toBe(false);
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze([1, 2]), [3]);
      return 1;
    }`)).toBe(true);
    expect(throwsTypeError(`export function f() {
      Object.assign(Object.freeze([1, 2]), { length: 1 });
      return 1;
    }`)).toBe(true);
  });

  it("自有 setter 在 frozen 目标上仍派发（原生 freeze 不禁 setter）", () => {
    expect(
      val(`export function f() {
        let g = 0;
        const t = { set x(v) { g = v; } };
        Object.freeze(t);
        Object.assign(t, { x: 7 });
        return g;
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("second-class 面（const g = Object.assign）同口径：零键源不抛、非空源抛", () => {
    expect(throwsTypeError(`export function f() {
      const g = Object.assign;
      const t = Object.freeze({ a: 1 });
      g(t, {});
      g(t, null);
      return 1;
    }`)).toBe(false);
    expect(throwsTypeError(`export function f() {
      const g = Object.assign;
      g(Object.freeze({ a: 1 }), { b: 2 });
      return 1;
    }`)).toBe(true);
  });

  it("键集不可判的源 → may-throw（不是定抛）", () => {
    const src = `export function f(s) {
      Object.assign(Object.freeze({}), s);
      return 1;
    }`;
    const r = call(src, "f", [anyAbs]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(effects(src)).toEqual(["TypeError"]);
  });

  it("函数源（键集不可判）→ may-throw，不折定抛", () => {
    const src = `export function f() {
      Object.assign(Object.freeze({}), Object.assign(function () {}, { a: 1 }));
      return 1;
    }`;
    expect(throwsTypeError(src)).toBe(false);
    expect(effects(src)).toEqual(["TypeError"]);
  });
});

describe("Object.assign × sealed/nonext 目标：自有访问器不是「新键」（D2）", () => {
  it("sealed + 自有访问器（无槽，仅侧表）→ setter 派发、不抛", () => {
    const target = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    const seen: Abs[] = [];
    $objAccessor(target, "x", null, (_t, v) => {
      seen.push(v);
      return v;
    });
    markExtState(target, "sealed");
    const src = abs(
      { k: "obj", slots: { x: { value: numLit(7) } } },
      undefined,
      undefined,
      "exact",
    );
    expect(() => performObjectAssign([target, src])).not.toThrow();
    expect(seen.length).toBe(1);
    expect(litValue(seen[0]!)).toEqual({ ok: true, value: 7 });
  });

  it("nonext + 自有访问器（无槽，仅侧表）→ setter 派发、不抛", () => {
    const target = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    const seen: Abs[] = [];
    $objAccessor(target, "y", null, (_t, v) => {
      seen.push(v);
      return v;
    });
    markExtState(target, "nonext");
    const src = abs(
      { k: "obj", slots: { y: { value: numLit(3) } } },
      undefined,
      undefined,
      "exact",
    );
    expect(() => performObjectAssign([target, src])).not.toThrow();
    expect(seen.length).toBe(1);
  });

  it("sealed + 无 setter 的自有访问器 → TypeError（getter-only 拒写）", () => {
    const target = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    $objAccessor(target, "x", () => numLit(1), null);
    markExtState(target, "sealed");
    const src = abs(
      { k: "obj", slots: { x: { value: numLit(7) } } },
      undefined,
      undefined,
      "exact",
    );
    expect(() => performObjectAssign([target, src])).toThrow();
  });

  it("sealed + 真新键 → 仍抛 TypeError（防止放开过头）", () => {
    expect(throwsTypeError(`export function f() {
      const o = { y: 0 };
      Object.seal(o);
      Object.assign(o, { x: 7 });
      return o.y;
    }`)).toBe(true);
  });

  it("nonext + 真新键 → 仍抛 TypeError", () => {
    expect(throwsTypeError(`export function f() {
      const o = { y: 0 };
      Object.preventExtensions(o);
      Object.assign(o, { x: 7 });
      return o.y;
    }`)).toBe(true);
  });

  it("sealed + defineProperty 装的 setter 仍可用（产品面）", () => {
    expect(
      val(`export function f() {
        const o = { y: 0 };
        Object.defineProperty(o, "x", { set(v) { this.y = v; }, configurable: true });
        Object.seal(o);
        Object.assign(o, { x: 7 });
        return o.y;
      }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("sealed + 对象字面量 setter 仍可用（产品面）", () => {
    expect(
      val(`export function f() {
        const o = { y: 0, set x(v) { this.y = v; } };
        Object.seal(o);
        Object.assign(o, { x: 5 });
        return o.y;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("sealed + 既有数据键覆写 → 不抛（writable 未收紧）", () => {
    expect(
      val(`export function f() {
        const o = { z: 1 };
        Object.seal(o);
        Object.assign(o, { z: 5 });
        return o.z;
      }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("frozen + 无槽自有 setter → 派发不抛（与 sealed 同口径）", () => {
    const target = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    const seen: Abs[] = [];
    $objAccessor(target, "x", null, (_t, v) => {
      seen.push(v);
      return v;
    });
    markExtState(target, "frozen");
    const src = abs(
      { k: "obj", slots: { x: { value: numLit(9) } } },
      undefined,
      undefined,
      "exact",
    );
    expect(() => performObjectAssign([target, src])).not.toThrow();
    expect(seen.length).toBe(1);
  });
});
