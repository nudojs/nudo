/**
 * Bug 230：`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性
 * → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。
 *
 * 根因：`delete` 的两个通道都在 `exec/runtime/members.ts`
 * （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是
 * **不可配置**自有属性」；`$delRes` 的 tuple 臂只查 `canonicalArrayIndex`
 * （"length" → undefined → 放行）⇒ 引擎把删除当成功（返回 `true`）。
 *
 * 修法（exec/runtime/members.ts + exec/runtime/array-length.ts 的判定接口
 * `arrayLengthIsNonConfigurable(o, key)`）：`$delRes` 与 `$del` 各加一行
 * `if (arrayLengthIsNonConfigurable(o, key)) throwStrictWrite();`
 * ——须放在 `st === "frozen" || st === "sealed"` 分支**之前**（数组 length
 * 与冻结档无关；否则 nonext 数组的 delete a.length 会被放行）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 230: delete a.length 必抛 TypeError", () => {
  it("delete a.length → TypeError（表达式位：不可配置自有属性）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        const r = delete a.length;
        return [r, a.length];
      }`),
    ).toBe(true);
  });

  it("delete a.length → TypeError（语句位写回通道 $del）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        delete a.length;
        return a.length;
      }`),
    ).toBe(true);
  });

  it("delete a[\"length\"]（计算键）→ TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        const r = delete a["length"];
        return [r, a.length];
      }`),
    ).toBe(true);
  });

  it("负控制：preventExtensions 数组 delete a.length → 仍 TypeError（length 恒不可配置）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.preventExtensions(a);
        delete a.length;
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：delete a[0]（元素可配置）→ true", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        const r = delete a[0];
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：delete 普通对象自有属性 → true", () => {
    expect(
      v(`export function f() {
        const o = { x: 1 };
        const r = delete o.x;
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：delete 不存在的属性 → true", () => {
    expect(
      v(`export function f() {
        const o = { x: 1 };
        const r = delete o.zzz;
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：delete 普通对象的 length 属性（可配置）→ true（数组专属规则）", () => {
    expect(
      v(`export function f() {
        const o = { length: 5 };
        const r = delete o.length;
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：frozen 对象删自有属性 → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const o = Object.freeze({ x: 1 });
        delete o.x;
        return "nothrow";
      }`),
    ).toBe(true);
  });
});
