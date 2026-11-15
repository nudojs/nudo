/**
 * Bug 292 回归：`Object.defineProperty` 实现 ValidateAndApplyPropertyDescriptor
 * （ES2024 10.4.9）——不可配置属性的标志/值不可变、不可扩展目标不建新键、
 * ToPropertyDescriptor 的**字段存在性**语义。
 *
 * 原生（node v26 实测）：
 * - `Object.defineProperty(o,"a",{value:1,writable:false})` → 该属性
 *   **不可配置**（新建属性未指定的字段缺省 false）⇒ 再次
 *   `defineProperty(o,"a",{value:2})` 抛 TypeError（同值则允许）；
 * - 不可配置属性改 writable/configurable/enumerable → TypeError；
 * - seal / freeze / preventExtensions 之后 defineProperty **新键** → TypeError；
 * - `{get: undefined, value: 1}` → TypeError（Invalid property descriptor：
 *   get 字段与 value 字段共存——`get: undefined` 仍是「有 get 字段」）；
 * - 已有（可配置）属性：未指定字段保持当前值，显式字段**双向**覆盖
 *   （enumerable:false → enumerable:true 可恢复）。
 *
 * 修复前：只校验「数据 ↔ 访问器」机制切换，标志单向收紧、值可被改写、
 * 不可扩展目标静默建键 ⇒ 假绿（门禁恒绿且行为与原生相反）。
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

describe("Bug 292 — defineProperty 实现 ValidateAndApplyPropertyDescriptor", () => {
  it("不可写属性被改值 → TypeError（改前静默改写成功）", () => {
    expect(
      thrown(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: false }); Object.defineProperty(o, "a", { value: 2 });`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("不可写属性**同值**重定义 → 允许（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: false }); Object.defineProperty(o, "a", { value: 1 }); return String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("不可配置属性改 writable / configurable / enumerable → TypeError", () => {
    expect(
      thrown(wrap(`const o = {}; Object.defineProperty(o, "a", { value: 1 }); Object.defineProperty(o, "a", { writable: true });`)),
    ).toBe("TypeError");
    expect(
      thrown(wrap(`const o = {}; Object.defineProperty(o, "a", { value: 1 }); Object.defineProperty(o, "a", { configurable: true });`)),
    ).toBe("TypeError");
    expect(
      thrown(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, enumerable: true }); Object.defineProperty(o, "a", { enumerable: false });`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("不可配置属性改访问机制（data → accessor）→ TypeError", () => {
    expect(
      thrown(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: true }); Object.defineProperty(o, "a", { get(){ return 9; } });`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("seal / freeze / preventExtensions 之后建新键 → TypeError（改前静默建键）", () => {
    expect(
      thrown(wrap(`const o = {}; Object.seal(o); Object.defineProperty(o, "a", { value: 1 });`)),
    ).toBe("TypeError");
    expect(
      thrown(wrap(`const o = {}; Object.freeze(o); Object.defineProperty(o, "a", { value: 1 });`)),
    ).toBe("TypeError");
    expect(
      thrown(
        wrap(`const o = {}; Object.preventExtensions(o); Object.defineProperties(o, { a: { value: 1 } });`),
      ),
    ).toBe("TypeError");
  });

  it("冻结对象上**同值**重定义 → 允许（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.freeze(o); Object.defineProperty(o, "a", { value: 1 }); return String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("{get: undefined, value: 1} → TypeError（字段存在性语义；改前静默折 1）", () => {
    expect(
      thrown(wrap(`const o = {}; Object.defineProperty(o, "a", { get: undefined, value: 1 });`)),
    ).toBe("TypeError");
  });

  it("已有可配置属性：未指定字段保持原值、显式字段双向覆盖（enumerable 可恢复）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.defineProperty(o, "a", { enumerable: false }); Object.defineProperty(o, "a", { enumerable: true }); return Object.keys(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.defineProperty(o, "a", { value: 2 }); return String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });

  it("新建属性未指定字段缺省 false（原生描述符面）", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1 }); const d = Object.getOwnPropertyDescriptor(o, "a"); return String(d.writable) + ":" + String(d.enumerable) + ":" + String(d.configurable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false:false:false" });
  });
});
