/**
 * Bug 300 回归：**`Object.getOwnPropertyDescriptor(proxy, k)` 派发 Proxy 的
 * getOwnPropertyDescriptor 陷阱**（[[GetOwnProperty]]）。
 *
 * 本文件钉的是**主 agent 刚完成的接线**：`builtins/object/methods.ts` 的
 * `getOwnPropertyDescriptor` 分支改为先调 `proxyGetOwnPropDescTrap(a0, args[1])`
 * （`builtins/object/descriptor.ts`——与 Reflect 面**同款单一实现**：陷阱派发 +
 * ToPropertyDescriptor 非对象定抛 + CompletePropertyDescriptor 描述符补全），
 * 返回 `desc` 用它、`opaque` 折 unknown；非 Proxy 接收者折 absent ⇒ **既有
 * 分支不变**。
 *
 * 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒
 * 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。
 *
 * 原生依据（node v26.10.0 实测）：
 * - `Object.getOwnPropertyDescriptor(new Proxy({a:1}, {getOwnPropertyDescriptor(){
 *   return {value:42,writable:true,enumerable:true,configurable:true}}}), "a").value`
 *   === `42`（陷阱返回的描述符被**补全**后原样给出）；
 * - 陷阱对**任意键**派发（实参 (target, key)）⇒ 键 "zz" 也得到 value 42；
 * - `Object.getOwnPropertyDescriptor({a:1}, "a").value` === `1`；
 *   `Object.getOwnPropertyDescriptor({a:1}, "b")` === `undefined`；
 * - `Reflect.getOwnPropertyDescriptor(proxy, "a").value` === `42`（Reflect 面
 *   本来就有 ⇒ 两面口径一致）；
 * - 陷阱返回 `undefined` ⇒ 原生返回 `undefined`（**引擎当前折 unknown**——
 *   精度缺口，见下方 TODO(族05)）；
 * - 陷阱返回**非对象** ⇒ TypeError（原生
 *   "'getOwnPropertyDescriptor' on proxy: trap returned neither object nor
 *   undefined for property 'a'"）；
 * - `Object.getOwnPropertyDescriptor({}, "toString")` === `undefined`
 *   （原型链上的键**不是自有属性** ⇒ 负控制）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果的 shape.k（unknown 判定用） */
function shapeK(r: unknown): string | undefined {
  return (r as { shape?: { k?: string } } | undefined)?.shape?.k;
}

describe("Bug 300 — Object.getOwnPropertyDescriptor 派发 Proxy 陷阱", () => {
  it("陷阱派发：value 42（修前读 .value 定抛 TypeError）", () => {
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 42, writable: true, enumerable: true, configurable: true }) }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("陷阱派发：描述符被**补全**（value/writable/enumerable/configurable 原生同款）", () => {
    // 原生返回的是补全后的描述符对象（不是 handler 的原对象）。
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 42, writable: true, enumerable: true, configurable: true }) }); const d = Object.getOwnPropertyDescriptor(p, "a"); return String(d.value) + ":" + String(d.writable) + ":" + String(d.enumerable) + ":" + String(d.configurable);`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "42:true:true:true" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("陷阱对任意键派发：实参 (target, key) 里的 key 透传（原生同款）", () => {
    // 原生：陷阱以 (target, key) 被调用 ⇒ 键 "zz" 也走陷阱（不是靶的键集）。
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: (t, k) => ({ value: String(k), writable: true, enumerable: true, configurable: true }) }); return Object.getOwnPropertyDescriptor(p, "zz").value;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "zz" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("非 Proxy 路径不受影响：{a:1} 的自有键 value 1、缺失键 undefined", () => {
    const hit = call(wrap(`return Object.getOwnPropertyDescriptor({ a: 1 }, "a").value;`), "f");
    expect(litValue(hit.result)).toEqual({ ok: true, value: 1 });
    expect(throwsError(hit.throws, "TypeError")).toBe(false);
    const miss = call(wrap(`return Object.getOwnPropertyDescriptor({ a: 1 }, "b");`), "f");
    expect(litValue(miss.result)).toEqual({ ok: true, value: undefined });
    expect(throwsError(miss.throws, "TypeError")).toBe(false);
  });

  it("Reflect 面一致：同一陷阱经 Reflect 面拿到同一个 42", () => {
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 42, writable: true, enumerable: true, configurable: true }) }); return Reflect.getOwnPropertyDescriptor(p, "a").value;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("陷阱返回 undefined：不抛，且不假精确（精度缺口 TODO(族05)）", () => {
    // 原生：陷阱返回 undefined ⇒ Object.getOwnPropertyDescriptor 返回
    // **undefined**。引擎当前折 **unknown**（更保守，不是错值）——精度缺口，
    // 不在本次接线的范围内。
    // TODO(族05): 引擎与原生不一致（unknown vs undefined）——只钉「不抛」+
    // 「不假精确」，**不钉**「等于 undefined」。
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => undefined }); return Object.getOwnPropertyDescriptor(p, "a");`,
      ),
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    const lv = litValue(r.result);
    expect(shapeK(r.result) === "unknown" || (lv.ok && lv.value === undefined)).toBe(true);
  });

  it("陷阱返回非对象 → TypeError（ToPropertyDescriptor 前置，原生同款）", () => {
    const r = call(
      wrap(
        `const p = new Proxy({}, { getOwnPropertyDescriptor: () => "nope" }); return Object.getOwnPropertyDescriptor(p, "a");`,
      ),
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});

describe("Bug 300 — 负控制（邻近形态不回归）", () => {
  it("原型链上的键不是自有属性：gOPD({}, \"toString\") === undefined", () => {
    const r = call(wrap(`return typeof Object.getOwnPropertyDescriptor({}, "toString");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "undefined" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("普通对象的描述符三标志不变（writable/enumerable/configurable 全 true）", () => {
    const r = call(
      wrap(
        `const d = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); return String(d.writable) + ":" + String(d.enumerable) + ":" + String(d.configurable);`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true:true:true" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});
