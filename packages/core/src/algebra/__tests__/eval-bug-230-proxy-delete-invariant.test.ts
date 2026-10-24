/**
 * Bug 230 回归（**Proxy [[Delete]] 不变量** + **字符串 prim 的 length 删除门**）：
 *
 * ① Proxy [[Delete]] 规范不变量（ES2024 10.5.9 step 10）——deleteProperty
 *    陷阱返回 **true** 时，若靶上该键是**不可配置**自有属性 ⇒ 原生定抛
 *    TypeError。此前引擎直接返 true（假绿：原生必抛的写门被当成"删除成功"）。
 *    落点：builtins/reflect.ts 的 Reflect.deleteProperty 臂（陷阱结果算出
 *    后过 builtins/object/descriptor.ts 的 enforceProxyDeleteInvariant）；
 *    `delete p.x` **运算符**路径（exec/runtime/members.ts 的 $delRes）已接线。
 *
 * ② `delete s.length`（**字符串 prim** 接收者）：String 包装对象的 length 是
 *    **不可配置**自有属性 ⇒ strict（ESM）下恒 TypeError。此前 prim 臂不拦
 *    ⇒ 引擎折 unknown（假绿）。落点：exec/runtime/array-length.ts 的
 *    arrayLengthIsNonConfigurable（prim 臂补齐）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 定抛探针：结果 never + throws 面是指定错误类型 */
function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 230 — Proxy [[Delete]] 不变量（不可配置属性）", () => {
  it("Reflect.deleteProperty(靶含不可配置键, 陷阱返 true) → TypeError", () => {
    expect(
      threw(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => true });
        Reflect.deleteProperty(p, "x");
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：靶上该键可配置 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = { x: 1 };
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(Reflect.deleteProperty(p, "x"));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制：靶上无该键 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = {};
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(Reflect.deleteProperty(p, "nope"));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制：陷阱返 false → 返 false（不抛；原生不变量不适用）", () => {
    expect(
      v(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => false });
        return String(Reflect.deleteProperty(p, "x"));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("delete p.x（运算符路径）→ TypeError（exec/runtime/members.ts 的 $delRes 陷阱臂过 enforceProxyDeleteInvariant）", () => {
    expect(
      threw(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => true });
        delete p.x;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制（运算符路径）：靶上该键可配置 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = { x: 1 };
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(delete p.x);
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制（运算符路径）：靶上无该键 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = {};
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(delete p.nope);
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制（运算符路径）：陷阱返 false → strict 定抛 TypeError（原生同）", () => {
    expect(
      threw(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => false });
        delete p.x;
        return "no-throw";
      }`),
    ).toBe(true);
  });
});

describe("Bug 230 — delete s.length（字符串 prim 接收者）", () => {
  it("delete 字符串字面量的 length → TypeError（此前折 unknown）", () => {
    expect(
      threw(`export function f() {
        const s = "ab";
        delete s.length;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：delete 数组的 length → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2];
        delete a.length;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：delete 字符串的其它键 → 不抛（length 之外的键不受管）", () => {
    expect(
      threw(`export function f() {
        const s = "ab";
        delete s.other;
        return "no-throw";
      }`),
    ).toBe(false);
  });
});
