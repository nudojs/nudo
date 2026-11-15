/**
 * Bug 386 —— `Object.setPrototypeOf(Object.prototype, …)` **不查不可变原型**：
 * 引擎**静默改写** `Object.prototype` 的原型并声称「不会抛」（假绿）。
 *
 * 修前（HEAD）：`protoChangeAllowed` 只查 extensibility + SameValue ⇒
 * `Object.setPrototypeOf(Object.prototype, {})` **不抛**（native：TypeError:
 * Immutable prototype object 'Object.prototype' cannot have their prototype set）。
 *
 * 修后：**同一事实源**（`protoChangeAllowed`，builtins/object/methods.ts——
 * 与 Bug 385 的原型环判定同处）——
 *   - `Object.setPrototypeOf` 据此**抛 TypeError**（native 同款）
 *   - `Reflect.setPrototypeOf` 据此**返 false**（native 口径：Reflect 不抛）
 *
 * 不可变原型的范围（规范 + V8 实测）：**仅 `Object.prototype`**——其余内建
 * 原型（Array / Function / String / … .prototype）**可**改（native 不抛）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("Bug 386 · 不可变原型 Object.prototype：Object.setPrototypeOf 抛 TypeError", () => {
  it("`Object.setPrototypeOf(Object.prototype, {})` ⇒ 抛 TypeError（native：同款）", () => {
    const rec = call(`export function f() { Object.setPrototypeOf(Object.prototype, {}); return 1; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("用户 try/catch 捕到（native：\"threw\"）", () => {
    expect(
      val(
        `export function f() { try { Object.setPrototypeOf(Object.prototype, {}); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("设为自身原型同样拒绝（native：同款）", () => {
    expect(
      val(
        `export function f() { try { Object.setPrototypeOf(Object.prototype, Object.prototype); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  });
});

describe("Bug 386 · 不可变原型：Reflect.setPrototypeOf 返 false（Reflect 口径不抛）", () => {
  it("`Reflect.setPrototypeOf(Object.prototype, {})` ⇒ false（native：false）", () => {
    expect(
      val(`export function f() { return Reflect.setPrototypeOf(Object.prototype, {}); }`),
    ).toEqual({ ok: true, value: false });
  });
});

describe("Bug 386 · 对照组（其余内建原型可改）不得回归", () => {
  it("`Object.setPrototypeOf(Array.prototype, {})` 不抛（native：可改）", () => {
    expect(
      val(`export function f() { try { Object.setPrototypeOf(Array.prototype, {}); return "no-throw"; } catch { return "threw"; } }`),
    ).toEqual({ ok: true, value: "no-throw" });
  });

  it("`Reflect.setPrototypeOf(Array.prototype, {})` 返 true（native：true）", () => {
    expect(
      val(`export function f() { return Reflect.setPrototypeOf(Array.prototype, {}); }`),
    ).toEqual({ ok: true, value: true });
  });
});
