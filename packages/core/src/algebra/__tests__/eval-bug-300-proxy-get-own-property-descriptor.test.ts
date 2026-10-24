/**
 * Bug 300 回归：Proxy 的 **getOwnPropertyDescriptor 陷阱**派发
 * （[[GetOwnProperty]]）——此前陷阱名并集里没有它 ⇒ 陷阱**从不派发**，
 * handler 提供的描述符被完全忽略（描述符面退化成「靶面 | undefined」并定抛）。
 *
 * 原生（node v26 实测）：
 * - `Reflect.getOwnPropertyDescriptor(proxy, "a")` 走 handler 的
 *   getOwnPropertyDescriptor 陷阱（实参 (target, key)）→ 返回**补全后**的
 *   描述符对象（缺省字段取原生默认）；
 * - 陷阱返回**非对象** → TypeError（ToPropertyDescriptor 前置）。
 *
 * 修复前：Reflect 面恒走「靶面 | undefined」并集 ⇒ 读 .value 定抛 TypeError。
 * 注：`Object.getOwnPropertyDescriptor(proxy, k)` 面在
 * builtins/object/methods.ts（A 分片地盘）——越界诉求见分片报告。
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

describe("Bug 300 — Proxy getOwnPropertyDescriptor 陷阱派发", () => {
  it("Reflect 面：陷阱派发并返回补全后的描述符（改前定抛 TypeError）", () => {
    expect(
      v(
        wrap(
          `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 9, enumerable: true, configurable: true }) }); const d = Reflect.getOwnPropertyDescriptor(p, "a"); return String(d.value) + ":" + String(d.enumerable) + ":" + String(d.configurable) + ":" + String(d.writable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "9:true:true:false" });
  });

  it("Reflect 面：陷阱返回非对象 → TypeError（原生同款）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({}, { getOwnPropertyDescriptor: () => "nope" }); Reflect.getOwnPropertyDescriptor(p, "a");`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("Reflect 面：无该陷阱 → 落回靶的 [[GetOwnProperty]]（原生同款）", () => {
    expect(
      v(wrap(`const p = new Proxy({ a: 1 }, {}); return String(Reflect.getOwnPropertyDescriptor(p, "a").value);`)),
    ).toEqual({ ok: true, value: "1" });
  });

  it("非 Proxy 目标不受影响（负控制）", () => {
    expect(
      v(wrap(`return String(Reflect.getOwnPropertyDescriptor({ a: 1 }, "a").value);`)),
    ).toEqual({ ok: true, value: "1" });
  });
});
