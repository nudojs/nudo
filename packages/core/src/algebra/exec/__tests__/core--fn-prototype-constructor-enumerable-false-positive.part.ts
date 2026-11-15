/**
 * Bug 271 —— **假阳性钉**（反向钉）：函数表达式原型对象的 `constructor` 槽
 * 被折成「可枚举」⇒ `Object.keys(F.prototype)` 折 exact `"constructor"`
 * （原生 `""`）、`Object.assign` 把 `constructor` 复制出去。
 *
 * 报告结论复核：原型对象的 `constructor` 槽**已按原生不可枚举建模**
 * ⇒ **不改实现**，只钉住「已修」的行为（本钉在 HEAD 只读副本上**必须通过**）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call } from "../../__tests__/eval-helpers.ts";

describe("Bug 271 (false positive): fn-expression prototype constructor is non-enumerable", () => {
  it("Object.keys(F.prototype) → ''（原生空）", () => {
    const r = call(
      `export function f() { return Object.keys((function () {}).prototype).join(","); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  });

  it("constructor 描述符 enumerable → false", () => {
    const r = call(
      `export function f() {
         return Object.getOwnPropertyDescriptor((function () {}).prototype, "constructor").enumerable;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("Object.getOwnPropertyNames(F.prototype) → 'constructor'（自有但在枚举视图外）", () => {
    const r = call(
      `export function f() {
         return Object.getOwnPropertyNames((function () {}).prototype).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "constructor" });
  });

  it("Object.assign 不复制 constructor（原生不复制不可枚举键）", () => {
    const r = call(
      `export function f() {
         const proto = (function () {}).prototype;
         return Object.keys(Object.assign({}, proto)).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  });

  it("复制出的对象上 constructor !== 原型（原生不复制）", () => {
    const r = call(
      `export function f() {
         return Object.assign({}, (function () {}).prototype).constructor === (function () {});
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("spread 同样不复制 constructor", () => {
    const r = call(
      `export function f() {
         const proto = (function () {}).prototype;
         return Object.keys({ ...proto }).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  });
});
