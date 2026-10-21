/**
 * Bug 207 回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须
 * 读得到内建原型面（方法值读 / `@@iterator` / `size`）。
 *
 * ES 语义：派生类实例的 [[Prototype]] 是内建父类的.prototype ⇒ 内建方法
 * （`s.add`）经原型链可见。
 *
 * 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名**
 * 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS["M"]`
 * 不存在）→ 折 exact `"undefined"`；而 `in` 面走 `brandHasProtoMember`
 * （沿 `evalClassChain`）→ 折 true —— 同一对象两面自相矛盾。
 *
 * 修复：值读按**类链**解析内建 owner（与 `in` 面同口径）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 207 — 内建父类子类实例的内建原型面", () => {
  it("Set / Map / WeakMap 子类实例读得到内建方法", () => {
    expect(v(wrap(`class M extends Set {} const s = new M([1,2]); return String(typeof s.add);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends Map {} const m = new M([["a",1]]); return String(typeof m.get);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends WeakMap {} const w = new M(); return String(typeof w.get);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("Date / RegExp 子类实例读得到内建方法", () => {
    expect(v(wrap(`class M extends Date {} const d = new M(0); return String(typeof d.getTime);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends RegExp {} const r = new M("a"); return String(typeof r.test);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("prim 包装父类（Number / String）子类实例读得到原型方法", () => {
    expect(v(wrap(`class M extends Number {} const n = new M(5); return String(typeof n.toFixed);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends String {} const s = new M("ab"); return String(typeof s.toUpperCase);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("@@iterator：子类实例经原型链继承（typeof → function）", () => {
    expect(v(wrap(`class M extends Set {} const s = new M(); return String(typeof s[Symbol.iterator]);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("读面与 in 面一致（不再「in 说有、读说 undefined」）", () => {
    const src = wrap(`class M extends Set {} const s = new M(); return String("add" in s) + ":" + String(typeof s.add);`);
    expect(v(src)).toEqual({ ok: true, value: "true:function" });
  });

  it("size 不再折 exact undefined（集合状态丢失时诚实降级为 number）", () => {
    expect(v(wrap(`class M extends Set {} const s = new M([1,2]); return String(s.size === undefined);`))).toEqual({
      ok: true,
      value: "false",
    });
    expect(v(wrap(`class M extends Set {} const s = new M([1,2]); return String(typeof s.size);`))).toEqual({
      ok: true,
      value: "number",
    });
  });

  it("派生类自己定义的同名成员优先（原生覆盖内建）", () => {
    expect(v(wrap(`class M extends Set { add(x) { return 42; } } const s = new M(); return String(s.add(1));`))).toEqual({
      ok: true,
      value: "42",
    });
  });

  it("负控制：内建父类本身的实例面不变", () => {
    expect(v(wrap(`const s = new Set([1,2]); return String(typeof s.add) + ":" + String(s.size);`))).toEqual({
      ok: true,
      value: "function:2",
    });
  });

  it("负控制：用户类父的子类实例面不变", () => {
    expect(v(wrap(`class A { m() { return 1; } } class B extends A {} return String(typeof new B().m);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
