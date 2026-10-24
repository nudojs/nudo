/**
 * Bug 1077 回归：`Object.setPrototypeOf(Object.prototype, null)` /
 * `Reflect.setPrototypeOf(Object.prototype, null)` 被**过拒绝**——把合法程序
 * 判成必抛 ⇒ L1/L2 门禁假红。
 *
 * 修前（探针实测）：
 * - `Object.setPrototypeOf(Object.prototype, null)` ⇒ **抛 TypeError**
 *   （原生 node v26.10.0：**不抛**——Object.prototype 的 [[Prototype]] 本来
 *   就是 null ⇒ 空操作）；
 * - `Reflect.setPrototypeOf(Object.prototype, null)` ⇒ **false**（原生：true）。
 *
 * 规范依据（ES2024 10.4.1.2 的 Object.prototype.[[SetPrototypeOf]]）：**只在
 * V 非 null 时抛** TypeError ⇒ 置 null 本就合法（与 node v26 实测一致）。
 * 置**非 null** 仍拒（原生 TypeError: Immutable prototype object
 * 'Object.prototype' cannot have their prototype set）。
 *
 * 修后（`builtins/object/methods.ts` 的 `protoChangeAllowed` 单一事实源：
 * Object 面不抛 / Reflect 面返 true）：
 * - 置 null ⇒ 放行；
 * - 置非 null ⇒ 仍拒（Object 面抛 TypeError、Reflect 面返 false）；
 * - `Object.prototype` 的原型链面**不变**（不落 null-proto 标记 ⇒ 原生
 *   `"toString" in Object.prototype === true` 仍成立）。
 *
 * oracle：node v26.10.0 实测。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 1077 — Object.prototype 置 null 原型：放行（native：不抛 / true）", () => {
  it("Object.setPrototypeOf(Object.prototype, null) ⇒ 不抛（native：no-throw；修前：threw）", () => {
    expect(
      val(
        wrap(
          `try { Object.setPrototypeOf(Object.prototype, null); return "no-throw"; } catch { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "no-throw" });
  });

  it("Reflect.setPrototypeOf(Object.prototype, null) ⇒ true（native：true；修前：false）", () => {
    expect(val(wrap(`return Reflect.setPrototypeOf(Object.prototype, null);`))).toEqual({
      ok: true,
      value: true,
    });
  });
});

describe("Bug 1077 — 负控制（置非 null 仍拒 + 原型链面不变）", () => {
  it("Object.setPrototypeOf(Object.prototype, {}) ⇒ 仍抛 TypeError（native：同款）", () => {
    expect(
      val(
        wrap(
          `try { Object.setPrototypeOf(Object.prototype, {}); return "no-throw"; } catch { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("Reflect.setPrototypeOf(Object.prototype, {}) ⇒ 仍返 false（native：false）", () => {
    expect(val(wrap(`return Reflect.setPrototypeOf(Object.prototype, {});`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("Object.prototype 的原型链面不变：typeof Object.prototype.toString === \"function\"（native 同款）", () => {
    expect(val(wrap(`return typeof Object.prototype.toString;`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("其余内建原型照旧可改：Object.setPrototypeOf(Array.prototype, {}) 不抛（native：no-throw）", () => {
    expect(
      val(
        wrap(
          `try { Object.setPrototypeOf(Array.prototype, {}); return "no-throw"; } catch { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "no-throw" });
  });
});
