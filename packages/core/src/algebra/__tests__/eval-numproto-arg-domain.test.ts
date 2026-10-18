/**
 * 求值引擎 Number.prototype digits/radix 实参域检查提升（Bug 107）：
 * 此前字面量实参域检查在各方法臂的接收者字面量守卫之内——抽象 number
 * 接收者（Math.random() 等）先折抽象 string 早退，Math.random().toFixed(500)
 * 的确定 RangeError 被漏（throws 域 never 假 total）。修复：字面量
 * digits/radix 检查提升到接收者守卫之前（enforceNumProtoArgDomain）。
 * 界：toFixed/toExponential [0,100]、toPrecision [1,100]、toString radix
 * [2,36]（ToIntegerOrInfinity：NaN→0、截断小数、Infinity 保持）；
 * symbol/bigint 字面量实参 ToNumber 定抛 TypeError。toLocaleString 的
 * ICU 路径不转换实参——不在提升面。断言与 node v26 ground truth 对齐。
 */
import { describe, it, expect } from "vitest";
import { call, val } from "./eval-helpers.ts";

const throwsName = (r: { throws: unknown }): string | undefined =>
  (r.throws as { shape?: { k?: string; name?: string } })?.shape?.k === "never"
    ? undefined
    : (r.throws as { shape?: { name?: string } })?.shape?.name;

const litOf = (src: string): unknown => {
  const r = val(src) as { ok: boolean; value: unknown };
  return r.ok ? r.value : undefined;
};

describe("Bug 107: literal digits/radix domain hoisted above receiver guard", () => {
  it("抽象 number 接收者（Math.random()）+ 界外字面量 → definite RangeError", () => {
    for (const src of [
      `export function f() { return Math.random().toFixed(500); }`,
      `export function f() { return Math.random().toFixed(101); }`,
      `export function f() { return Math.random().toFixed(-1); }`,
      `export function f() { return Math.random().toPrecision(0); }`,
      `export function f() { return Math.random().toPrecision(101); }`,
      `export function f() { return Math.random().toExponential(101); }`,
      `export function f() { return Math.random().toString(1); }`,
      `export function f() { return Math.random().toString(99); }`,
    ]) {
      const r = call(src);
      expect((r.result as { shape?: { k?: string } })?.shape?.k, src).toBe("never");
      expect(throwsName(r), src).toBe("RangeError");
    }
  });

  it("抽象接收者 + bigint 字面量 → definite TypeError（ToNumber）", () => {
    const r = call(`export function f() { return Math.random().toFixed(1n); }`);
    expect((r.result as { shape?: { k?: string } })?.shape?.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("ToIntegerOrInfinity 口径：NaN→0 合法 / 截断小数 / -0.5 合法 / Infinity 越界", () => {
    expect(litOf(`export function f() { return (1.5).toFixed(NaN); }`)).toBe("2");
    expect(litOf(`export function f() { return (1.5).toFixed(100.9); }`)).toBe(
      (1.5).toFixed(100),
    );
    expect(litOf(`export function f() { return (1.5).toFixed(-0.5); }`)).toBe("2");
    expect(litOf(`export function f() { return (1.5).toFixed("abc"); }`)).toBe("2");
    const r = call(`export function f() { return (1.5).toFixed(Infinity); }`);
    expect(throwsName(r)).toBe("RangeError");
  });

  it("toLocaleString 不在提升面：symbol/bigint 实参原生不抛（ICU 不转换）", () => {
    for (const src of [
      `export function f() { return Math.random().toLocaleString(Symbol()); }`,
      `export function f() { return (1.5).toLocaleString(1n); }`,
    ]) {
      const r = call(src);
      expect((r.result as { shape?: { k?: string } })?.shape?.k, src).not.toBe("never");
      expect(throwsName(r), src).toBeUndefined();
    }
  });

  it("字面量接收者原有精确面不回归（control）", () => {
    expect(litOf(`export function f() { return (255).toString(16); }`)).toBe("ff");
    expect(litOf(`export function f() { return (1.5).toFixed(2); }`)).toBe("1.50");
    expect(litOf(`export function f() { return (5).toPrecision(2); }`)).toBe("5.0");
    const r = call(`export function f() { return (1.5).toFixed(500); }`);
    expect(throwsName(r)).toBe("RangeError");
  });
});
