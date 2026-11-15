/**
 * BUG-278 回归：Error 实例上公有覆写原型链 `inherited` 槽 `name` 后，
 * `Object.getOwnPropertyNames` 的**次序**必须与宿主一致。
 *
 * 根因：`packages/core/src/algebra/exec/runtime/containers/member.ts`（`$set`
 * 的 brand 内层 obj 臂）对 inherited→own 的公有覆写走 `setSlot` **原地改槽
 * 值**（插入序不变），而原生是**新建一个自有属性**（CreateDataProperty）⇒
 * 追加到自有属性序**末尾**。`error-family.ts` 的槽表字面量把 `name` 夹在
 * `stack` 与 `message` 之间 ⇒ 覆写后次序与宿主相反
 * （引擎 `["stack","name","message"]` vs 宿主 `["stack","message","name"]`），
 * 并被 dts 产物原样发布（自信的确切错元组）。
 *
 * 修法：inherited→own 的公有覆写先删槽再写回 ⇒ 键重新追加到槽表末尾
 * （= 原生自有属性序）。
 */
import { describe, it, expect } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";

const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

describe("BUG-278：inherited→own 覆写后 gOPN 次序", () => {
  it("e.name = \"CustomError\" ⇒ [\"stack\",\"message\",\"name\"]（宿主次序）", () => {
    const r = call(`export function f() {
      const e = new TypeError("boom");
      e.name = "CustomError";
      return Object.getOwnPropertyNames(e);
    }`);
    expect(tupleEls(r.result)).toEqual(["stack", "message", "name"]);
  });

  it("键数不变：覆写后仍是三个键（只是次序）", () => {
    expect(
      tupleEls(
        call(`export function f() {
          const e = new TypeError("boom");
          e.name = "CustomError";
          return Object.getOwnPropertyNames(e);
        }`).result,
      )?.length,
    ).toBe(3);
  });

  it("对照组：不覆写 name ⇒ [\"stack\",\"message\"]（name 是 inherited，不在自有面）", () => {
    const r = call(`export function f() {
      const e = new TypeError("boom");
      return Object.getOwnPropertyNames(e);
    }`);
    expect(tupleEls(r.result)).toEqual(["stack", "message"]);
  });

  it("覆写后 name 是自有且**可枚举**属性（原生语义不变）", () => {
    expect(
      lit(`export function f() {
        const e = new TypeError("boom");
        e.name = "CustomError";
        return e.hasOwnProperty("name") && Object.getOwnPropertyDescriptor(e, "name").enumerable;
      }`),
    ).toBe(true);
  });

  it("覆写后的 name 值可读回", () => {
    expect(
      lit(`export function f() {
        const e = new TypeError("boom");
        e.name = "CustomError";
        return e.name;
      }`),
    ).toBe("CustomError");
  });
});
