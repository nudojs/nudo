/**
 * Bug 121 回归：Reflect.construct 校验错槽位。
 *
 * apply/construct 共用一条 enforceArgsList(args[2])——apply 的 argsList 在
 * args[2]，construct 的在 args[1]：2 参合法形 Reflect.construct(A, []) 被
 * 缺省 newTarget ≡ undefined 的 prim 分类定抛成假 never（gate 面
 * signature `never → "threw"`）；argsList 本体与 newTarget 可构造性从未
 * 校验（Reflect.construct(A,"s",A) / (A,[],{}) 漏抛）。
 *
 * 修复：argsList 槽位按方法索引（apply=2 / construct=1）+ newTarget 在场
 * 时的 IsConstructor 三档（nullish 字面量/obj/ctor:false fn 定抛；类值
 * brand ctor facet 精确；不可判面 may）。
 *
 * 原生 ground truth（node 实测）见各断言注释。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError, effects } from "./eval-helpers.ts";

function expectTypeError(src: string): void {
  const r = call(src);
  expect(isNever(r.result), src).toBe(true);
  expect(throwsError(r.throws, "TypeError"), src).toBe(true);
}

describe("Bug 121：Reflect.construct 2 参合法形不再假抛", () => {
  it("typeof → \"object\" 域（原生 object）；try/catch 走 no 臂", () => {
    const src = `export function f() { class A{} return typeof Reflect.construct(A, []); }`;
    const r = call(src);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    // 引擎保守不复放 construct：值域是抽象 string（typeof 面），非假精确
    expect(val(src)).toEqual({ ok: false });
    expect(val(`export function f() { class A{} try { Reflect.construct(A, []); return "no"; } catch { return "threw"; } }`))
      .toEqual({ ok: true, value: "no" });
  });

  it("3 参控制组（newTarget = 类值）保持原口径", () => {
    const r = call(`export function f() { class A{} return typeof Reflect.construct(A, [], A); }`);
    expect(isNever(r.result)).toBe(false); // 不抛
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 121：argsList（args[1]）本体校验——此前漏抛面", () => {
  it("非对象 argsList → 定抛 TypeError（原生 CreateListFromArrayLike）", () => {
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, "s"); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, "s", A); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, 1, A); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A); }`);
  });
});

describe("Bug 121：newTarget（args[2] 在场）IsConstructor 校验——此前漏抛面", () => {
  it("普通对象 / nullish 字面量 / 非构造 fn → 定抛 TypeError（原生）", () => {
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, [], {}); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, {}, {}); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, [], undefined); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, [], null); }`);
    expectTypeError(`export function f() { class A{} return Reflect.construct(A, [], () => {}); }`);
  });

  it("抽象 newTarget → may TypeError（值域不折假）", () => {
    const eff = effects(`export function f(x) { class A{} return Reflect.construct(A, [], x); }`);
    expect(eff).toContain("TypeError");
  });
});

describe("Bug 121：apply 面控制组（槽位索引不回归）", () => {
  it("Reflect.apply 3 参合法形照常；argsList 缺省仍定抛", () => {
    expect(val(`export function f() { return typeof Reflect.apply(Math.max, null, [1]); }`))
      .toEqual({ ok: true, value: "number" });
    expectTypeError(`export function f() { return Reflect.apply(Math.max, null); }`);
    expectTypeError(`export function f() { return Reflect.apply(Math.max, null, 1); }`);
    // 既有 target 校验（wave11 Bug 19 钉面）
    expectTypeError(`export function f() { return Reflect.construct(1, []); }`);
  });
});
