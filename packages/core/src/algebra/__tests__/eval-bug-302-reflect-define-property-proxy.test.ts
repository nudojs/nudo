/**
 * Bug 302 回归：`Reflect.defineProperty` 走**反射口径**——失败返 **false
 * 不抛**（Object.defineProperty 才是定抛 TypeError）。
 *
 * 原生（node v26 实测）：
 * - `Reflect.defineProperty(proxy, "a", desc)` 走 handler 的 defineProperty
 *   陷阱 → 返回 ToBoolean(陷阱结果)（false ⇒ 返 false，**不抛**）；
 * - 普通对象上重定义失败（不可配置属性改值）⇒ 返 **false**（不抛）；
 * - 描述符**非法**（非对象 / get-set 与 value 共存）⇒ 仍定抛 TypeError
 *   （ToPropertyDescriptor 前置，与 Object 面同款）。
 *
 * 修复前：Reflect 复用 Object 面 ⇒ 陷阱返 false 时定抛 TypeError；成功时
 * 返回抽象 boolean（恒真不可判）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 302 — Reflect.defineProperty 的反射口径（失败返 false 不抛）", () => {
  it("Proxy defineProperty 陷阱返 false → 返 false（改前定抛 TypeError）", () => {
    expect(
      v(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => false }); return String(Reflect.defineProperty(p, "a", { value: 2 }));`)),
    ).toEqual({ ok: true, value: "false" });
    expect(
      thrown(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => false }); Reflect.defineProperty(p, "a", { value: 2 });`)),
    ).toBeUndefined();
  });

  it("Proxy defineProperty 陷阱返 true → 返 true", () => {
    expect(
      v(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => true }); return String(Reflect.defineProperty(p, "a", { value: 2 }));`)),
    ).toEqual({ ok: true, value: "true" });
  });

  it("普通对象：成功 → true 且值落地", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; const r = Reflect.defineProperty(o, "a", { value: 2 }); return String(r) + ":" + String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "true:2" });
  });

  it("普通对象：重定义失败（不可配置属性改值）→ 返 false（不抛）", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1 }); return String(Reflect.defineProperty(o, "a", { value: 2 }));`,
        ),
      ),
    ).toEqual({ ok: true, value: "false" });
  });

  it("描述符非法（非对象）→ 仍定抛 TypeError（原生同款）", () => {
    expect(
      thrown(wrap(`Reflect.defineProperty({}, "a", null);`)),
    ).toBe("TypeError");
  });

  it("Object 面保持定抛口径（负控制：Object.defineProperty 仍抛）", () => {
    expect(
      thrown(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => false }); Object.defineProperty(p, "a", { value: 2 });`)),
    ).toBe("TypeError");
  });
});
