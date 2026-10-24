/**
 * Bug 284：Proxy 的 `isExtensible` 陷阱**从不派发** ⇒ `Object.isExtensible(proxy)`
 * 折**确定 true**（原生必抛 TypeError：陷阱报 false 而靶实际可扩展 ⇒ 规范
 * 不变量冲突），且陷阱的副作用整体丢失（假绿 + 错值）。
 *
 * 修复（packages/core/src/algebra/builtins/object/methods.ts）：
 * - "isExtensible" 分支接线 Proxy 臂 → `proxyIsExtensible`：
 *   GetMethod(handler, "isExtensible") → 缺席回退**靶**的 [[IsExtensible]]；
 *   ToBoolean(陷阱结果) 与靶的实际可扩展性不一致 ⇒ TypeError。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 284: Object.isExtensible 派发 Proxy 的 isExtensible 陷阱", () => {
  it("陷阱报 false 而靶可扩展 → TypeError（此前恒折 true）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return false; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|ie" });
  });

  it("陷阱报 true 而靶可扩展 → true（陷阱被调用，副作用保留）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return true; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "true|ie" });
  });

  it("靶已不可扩展：陷阱报 false → false（不变量一致，不抛）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const t = Object.preventExtensions({ a: 1 });
        const p = new Proxy(t, { isExtensible(x) { log.push("ie"); return false; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "false|ie" });
  });

  it("靶已不可扩展：陷阱报 true → TypeError（不变量冲突）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const t = Object.preventExtensions({ a: 1 });
        const p = new Proxy(t, { isExtensible(x) { log.push("ie"); return true; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|ie" });
  });

  it("陷阱副作用保留（此前陷阱从未被调用）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return true; } });
        Object.isExtensible(p);
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "ie" });
  });

  it("无陷阱 → 回退靶语义（控制组）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, {});
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "true|" });
  });

  it("控制组：普通对象 → true；不可扩展普通对象 → false", () => {
    expect(v(`export function f() { return Object.isExtensible({ a: 1 }); }`)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      v(`export function f() { const o = Object.preventExtensions({ a: 1 }); return Object.isExtensible(o); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("陷阱内抛出的 TypeError 透出（throws 面）", () => {
    const r = call(
      `export function f() {
        const p = new Proxy({ a: 1 }, { isExtensible() { throw new TypeError("boom"); } });
        return Object.isExtensible(p);
      }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("可扩展性不变量冲突 → throws 面是 TypeError（此前恒折 true、不记抛）", () => {
    const r = call(
      `export function f() {
        const p = new Proxy({ a: 1 }, { isExtensible() { return false; } });
        return Object.isExtensible(p);
      }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("陷阱结果非布尔 → ToBoolean（1 折 true）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return 1; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "true|ie" });
  });

  it("Object.preventExtensions(proxy) 之后 → false（原生冻结的是**靶**）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1 }, {});
        Object.preventExtensions(p);
        return String(Object.isExtensible(p));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("Object.freeze(proxy) 之后 → false（原生冻结的是**靶**）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1 }, {});
        Object.freeze(p);
        return String(Object.isExtensible(p));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("preventExtensions 陷阱自己冻结靶 → 陷阱报 false 与靶一致 → false", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1 }, {
          preventExtensions(t) { Object.preventExtensions(t); return true; },
          isExtensible() { return false; },
        });
        Object.preventExtensions(p);
        return String(Object.isExtensible(p));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });
});
