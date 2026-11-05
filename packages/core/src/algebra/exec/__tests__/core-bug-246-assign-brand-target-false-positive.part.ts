/**
 * Bug 246 —— **假阳性钉**（反向钉）：`Object.assign` 目标为 brand
 * （类实例 / 内建实例 / 函数构造实例）时**静默丢弃**源属性。
 *
 * 报告结论复核：brand 目标的合并分支**已在位**
 * （`exec/class/assign.ts` 的 `assignIntoBrandInner` —— 修入 e3b8791a），
 * 报告引用的「其余 continue 丢弃」代码不存在 ⇒ **不改实现**，只钉住
 * 「已修」的行为（本钉在 HEAD 只读副本上**必须通过**）。
 *
 * 残余（不在本钉范围，见 E6 报告「越界发现」）：**数组 / 元组**目标上的
 * 非索引键（expando）仍被丢弃——Abs 数组 shape 本身不存 expando 槽，
 * 属模型层限制，与 brand 分支不同源。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call } from "../../__tests__/eval-helpers.ts";

describe("Bug 246 (false positive): Object.assign into brand targets keeps source props", () => {
  it("类实例目标：源属性不丢", () => {
    const r = call(
      `export function f() {
         class A { constructor() { this.a = 1; } }
         const x = Object.assign(new A(), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("类实例目标：自有键集合含源属性", () => {
    const r = call(
      `export function f() {
         class A { constructor() { this.a = 1; } }
         const x = Object.assign(new A(), { b: 2 });
         return Object.keys(x).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a,b" });
  });

  it("Error 实例目标：源属性不丢", () => {
    const r = call(
      `export function f() {
         const e = new Error("m");
         const x = Object.assign(e, { code: "EACCES" });
         return x.code;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "EACCES" });
  });

  it("Date 实例目标：源属性不丢", () => {
    const r = call(
      `export function f() {
         const x = Object.assign(new Date(0), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("Map 实例目标：源属性不丢", () => {
    const r = call(
      `export function f() {
         const x = Object.assign(new Map(), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("函数构造实例目标：源属性不丢", () => {
    const r = call(
      `export function f() {
         function A() { this.a = 1; }
         const x = Object.assign(new A(), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});
