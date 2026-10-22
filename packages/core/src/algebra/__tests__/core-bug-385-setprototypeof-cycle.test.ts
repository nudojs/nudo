/**
 * Bug 385 —— `Object.setPrototypeOf` **不做原型环检测**：引擎建出一棵**活原型环**，
 * native 在建环瞬间抛 `TypeError: Cyclic __proto__ value`。
 *
 * 修前（HEAD）：`setProtoAbs` 直接 `protoTable.set(o, proto)` ⇒ 环被静默建出
 * （native 不存在该状态）⇒ 之后所有原型链观察都跑在环上，产出与 native 不可比的值。
 *
 * 修后：**同一事实源**（`protoChangeAllowed`，builtins/object/methods.ts）——
 *   - `Object.setPrototypeOf` 据此**抛 TypeError**（native 同款）
 *   - `Reflect.setPrototypeOf` 据此**返 false**（native 口径：Reflect 不抛，返 boolean）
 * 环检测本体在 objects.ts（`protoChainContains`：沿新原型的 [[Prototype]] 链上溯）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("Bug 385 · 原型环：Object.setPrototypeOf 抛 TypeError", () => {
  it("`a→b` 后 `b→a` ⇒ 抛 TypeError（native：TypeError: Cyclic __proto__ value）", () => {
    const rec = call(
      `export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); Object.setPrototypeOf(b, a); return 1; }`,
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("用户 try/catch 捕到（native：\"threw\"）", () => {
    expect(
      val(
        `export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); try { Object.setPrototypeOf(b, a); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("自环 `Object.setPrototypeOf(a, a)` ⇒ 抛 TypeError（native：同款）", () => {
    expect(
      val(`export function f() { const a = {}; try { Object.setPrototypeOf(a, a); } catch { return "threw"; } return "no-throw"; }`),
    ).toEqual({ ok: true, value: "threw" });
  });
});

describe("Bug 385 · 原型环：Reflect.setPrototypeOf 返 false（Reflect 口径不抛）", () => {
  it("`Reflect.setPrototypeOf(b, a)`（a→b 已成环）⇒ false（native：false）", () => {
    expect(
      val(`export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); return Reflect.setPrototypeOf(b, a); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("自环 ⇒ false（native：false）", () => {
    expect(
      val(`export function f() { const a = {}; return Reflect.setPrototypeOf(a, a); }`),
    ).toEqual({ ok: true, value: false });
  });
});

describe("Bug 385 · 对照组（合法原型设定）不得回归", () => {
  it("`Object.setPrototypeOf(a, b)` 生效（native：getPrototypeOf(a) === b）", () => {
    expect(
      val(`export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); return Object.getPrototypeOf(a) === b; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("`Reflect.setPrototypeOf(a, b)` 返 true（native：true）", () => {
    expect(
      val(`export function f() { const a = {}, b = {}; return Reflect.setPrototypeOf(a, b); }`),
    ).toEqual({ ok: true, value: true });
  });
});
