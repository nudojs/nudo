/**
 * BUG-182 回归：宿主函数可构造性 facet 必须用**规范 IsConstructor 探针**
 * （`Reflect.construct(noop, [], v)` + 恒抛内建表），不得用「有无 prototype
 * 属性」代理。
 *
 * 「有 prototype」既非充分条件（`Symbol` / `BigInt` 有 prototype 但
 * `new Symbol()` 恒抛 TypeError——规范明写「If NewTarget is not undefined,
 * throw」）也非必要条件（`Proxy` 无 prototype 但是合法构造器）。代理判据的
 * 后果：`Reflect.construct(Proxy, …)` 假红 / `Reflect.construct(Symbol, [])`
 * 假绿，且同一值在 `new` 面（走 $new 的宿主探针）与 `Reflect.construct` 面
 * 给出**相反**结论。
 */
import { describe, it, expect } from "vitest";
import { call, effects, isNever, throwsError } from "./eval-helpers.ts";
import { hostFnCtorFacet } from "../abs-fn.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("BUG-182 — hostFnCtorFacet 的 IsConstructor 判据", () => {
  it("Proxy：无 prototype 但可构造 ⇒ true（旧 prototype 启发式给 false）", () => {
    expect(hostFnCtorFacet(Proxy)).toBe(true);
  });

  it("Symbol / BigInt：有 prototype 但 [[Construct]] 恒抛 ⇒ false", () => {
    expect(hostFnCtorFacet(Symbol)).toBe(false);
    expect(hostFnCtorFacet(BigInt)).toBe(false);
  });

  it("其余方向保持：箭头/内建方法不可构造，普通函数/类可构造", () => {
    expect(hostFnCtorFacet(() => 1)).toBe(false);
    expect(hostFnCtorFacet(parseInt)).toBe(false);
    expect(hostFnCtorFacet(Math.max)).toBe(false);
    expect(hostFnCtorFacet(function regular() {})).toBe(true);
    expect(hostFnCtorFacet(class K {})).toBe(true);
    expect(hostFnCtorFacet(Array)).toBe(true);
  });
});

describe("BUG-182 — Reflect.construct 面的假红/假绿", () => {
  it("construct(Proxy, [target, handler]) 不抛（此前假红 never）", () => {
    const src = wrap(`return Reflect.construct(Proxy, [{}, {}]);`);
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  });

  it("Proxy 作 newTarget 不抛（此前假红 never）", () => {
    const src = wrap(`return Reflect.construct(Array, [], Proxy);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  });

  it("construct(Symbol, []) 定抛 TypeError（此前假绿 unknown）", () => {
    const src = wrap(`return Reflect.construct(Symbol, []);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(true);
    expect(isNever(call(src).result)).toBe(true);
  });

  it("new 面与 Reflect.construct 面对 Symbol 结论一致（同为定抛）", () => {
    expect(throwsError(call(wrap(`return new Symbol();`)).throws, "TypeError")).toBe(true);
    expect(throwsError(call(wrap(`return Reflect.construct(Symbol, []);`)).throws, "TypeError"))
      .toBe(true);
  });

  it("new Proxy / new Symbol 既有结论不变（Proxy 可构造、Symbol 定抛）", () => {
    expect(throwsError(call(wrap(`return new Proxy({}, {});`)).throws, "TypeError")).toBe(false);
    expect(throwsError(call(wrap(`return new Symbol();`)).throws, "TypeError")).toBe(true);
  });
});
