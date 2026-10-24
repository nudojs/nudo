/**
 * Bug 1130（并发 review F24 / P2）—— 生成的 guard 对 `new Proxy(...)` **抛错**。
 *
 * 现象：`new Proxy({}, {})` 的 brand 是 `"Proxy"`
 * （`packages/core/src/algebra/builtins/error/error-family.ts` 的
 * `makeProxyAbs`）⇒ `denote.ts` 的 brand 身份子句生成
 * `v instanceof Reflect.get(globalThis, "Proxy")` ⇒ 而原生
 * `x instanceof Proxy` **抛 TypeError**（`Proxy.prototype` 是 `undefined`
 * ⇒ `Get(C, "prototype")` 结果非对象 ⇒ instanceof 抛）⇒ 守卫产物一跑就炸
 * ⇒ 守卫**不可用**。
 *
 * 修法：**没有可用 prototype** 的全局构造器 ⇒ 跳过身份子句（身份信息在守卫
 * 面无法表达 ⇒ 只保留内层 shape 判定；守卫必须能跑）。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "../abs.ts";
import { denoteGuard } from "../denote.ts";

/** brand 形态 Abs（内层默认是空槽对象面） */
const brandOf = (name: string, inner?: Abs): Abs =>
  abs(
    {
      k: "brand",
      name,
      shape: inner ?? abs({ k: "obj", slots: {} }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );

/** 把守卫表达式当运行时函数跑（守卫产物的语义面） */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("Bug 1130 — 没有可用 prototype 的构造器 ⇒ 守卫跳过 brand 身份子句", () => {
  it("原生 oracle：x instanceof Proxy 抛 TypeError（Proxy 没有 prototype）", () => {
    const proxyCtor = Reflect.get(globalThis, "Proxy") as unknown as Function;
    expect((proxyCtor as unknown as { prototype?: unknown }).prototype).toBeUndefined();
    expect(() => ({} instanceof proxyCtor)).toThrow(TypeError);
  });

  it("Proxy brand 的守卫不含 instanceof 身份子句", () => {
    const g = denoteGuard(brandOf("Proxy"), "data");
    expect(g).not.toContain("instanceof");
    expect(g).not.toContain('Reflect.get(globalThis, "Proxy")');
  });

  it("Proxy brand 的守卫跑在真 Proxy 上不抛错", () => {
    const g = denoteGuard(brandOf("Proxy"), "data");
    const check = runner(g);
    const p = new Proxy({ a: 1 }, {});
    expect(() => check(p)).not.toThrow();
  });

  it("Proxy brand 的守卫仍保留内层 shape 判定（不是「恒真」）", () => {
    const inner = abs(
      { k: "obj", slots: { a: { value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") } } },
      undefined,
      undefined,
      "exact",
    );
    const g = denoteGuard(brandOf("Proxy", inner), "data");
    const check = runner(g);
    // 内层必填槽 a 缺失 ⇒ 拒
    expect(check(new Proxy({}, {}))).toBe(false);
    // 内层满足 ⇒ 放行（身份子句已跳过）
    expect(check(new Proxy({ a: 1 }, {}))).toBe(true);
  });

  it("负控制：有 prototype 的构造器（Date）仍保留身份子句（Bug 407 不回退）", () => {
    const g = denoteGuard(brandOf("Date"), "data");
    expect(g).toContain('Reflect.get(globalThis, "Date")');
    expect(g).toMatch(/instanceof Reflect\.get\(globalThis, "Date"\)/);
    const check = runner(g);
    expect(check(new Date(0))).toBe(true);
    expect(check({})).toBe(false);
  });

  it("不可调用的标准全局（Math）同样跳过身份子句（原生 instanceof 抛「not callable」）", () => {
    // 原生 oracle
    expect(() => ({} instanceof (Math as unknown as Function))).toThrow(TypeError);
    const g = denoteGuard(brandOf("Math"), "data");
    expect(g).not.toContain("instanceof");
    expect(() => runner(g)({})).not.toThrow();
  });
});
