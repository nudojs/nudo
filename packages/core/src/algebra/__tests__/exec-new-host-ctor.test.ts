/**
 * Bug 16 / Bug 17（运行时内建建模）：宿主函数 new 的 [[Construct]] 语义。
 *
 * Bug 16：用户 function 声明/表达式/var 绑定函数的 new F(…) 此前落
 * $new 尾部空 brand——函数体从未执行，成员读全 undefined。修复：按原生
 * [[Construct]] 新建空 brand this → 调函数体（$rawThis 承接 Abs this）→
 * 返回 Abs 对象（brand/obj）优先，否则 this（宿主函数皆基类构造器，
 * 原始返回值忽略）。宿主内建构造器（Object/Function/Boolean…）不走体
 * 执行（Abs 实参喂真 JS 构造器会产宿主原值），维持空 brand 口径。
 *
 * Bug 17：构造器原始值返回——此前只判 brand/nullish。修复：ES [[Construct]]
 * undefined → this；其余原始值基类忽略（→ this）、派生类 TypeError
 * （Derived constructors may only return object or undefined）。
 */
import { describe, it, expect } from "vitest";
import { type Abs, runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function call(src: string, name: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, name, args);
}

function throwsName(r: { throws: { shape: { k: string; name?: string } } }): string | undefined {
  return r.throws.shape.k === "brand" ? r.throws.shape.name : undefined;
}

describe("Bug 16: new on host user functions executes the constructor body", () => {
  it("函数声明形态：function F(a,b){this.s=a+b;} new F(1,2).s → 3", () => {
    const r = call(
      `export function declNew() { function F(a, b) { this.s = a + b; } return new F(1, 2).s; }`,
      "declNew",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("函数表达式形态（const）：new F(1,2).s → 3", () => {
    const r = call(
      `export function feNew() { const F = function(a, b) { this.s = a + b; }; return new F(1, 2).s; }`,
      "feNew",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("var 绑定形态：new F(1,2).s → 3", () => {
    const r = call(
      `export function varNew() { var F = function(a, b) { this.s = a + b; }; return new F(1, 2).s; }`,
      "varNew",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("对象返回优先：function F(){ return {s:7}; } new F().s → 7", () => {
    const r = call(
      `export function newObjRet() { function F() { return { s: 7 }; } return new F().s; }`,
      "newObjRet",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("原始返回值忽略（基类）：function F(){this.x=1; return 5;} new F().x → 1", () => {
    const r = call(
      `export function newPrimIgnored() { function F() { this.x = 1; return 5; } return new F().x; }`,
      "newPrimIgnored",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("构造调用体内多字段写入均落地", () => {
    const r = call(
      `export function f() { function P(a) { this.sum = a; this.double = a * 2; } const p = new P(4); return p.sum + p.double; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 12 });
  });

  it("箭头函数 new 仍 TypeError（可构造性 facet 不回归）", () => {
    const r = call(
      `export function f() { const A = () => 1; return new A(); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });
});

describe("Bug 17: constructor primitive return follows [[Construct]]", () => {
  it("派生类 return 5 → throws TypeError（Derived constructors …）", () => {
    const r = call(
      `export function derivedPrim() { class A { constructor() { this.x = 1; } } class B extends A { constructor() { super(); return 5; } } return new B(); }`,
      "derivedPrim",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("基类 return 5 → 原始值忽略，new 得实例（.x 正常）", () => {
    const r = call(
      `export function basePrim() { class A { constructor() { this.x = 1; return 5; } } const a = new A(); return a.x; }`,
      "basePrim",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("派生类 return null → 同样 TypeError（null 非 object 非 undefined）", () => {
    const r = call(
      `export function derivedNull() { class A {} class B extends A { constructor() { super(); return null; } } return new B(); }`,
      "derivedNull",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("基类 return null → 忽略，得实例", () => {
    const r = call(
      `export function baseNull() { class A { constructor() { this.x = 2; return null; } } return new A().x; }`,
      "baseNull",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("派生类 return undefined → 得 this（不抛）", () => {
    const r = call(
      `export function derivedUndef() { class A { constructor() { this.x = 3; } } class B extends A { constructor() { super(); return undefined; } } return new B().x; }`,
      "derivedUndef",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("对象返回（brand/obj）优先语义不回归", () => {
    const r = call(
      `export function objRet() { class A { constructor() { return { x: 7 }; } } return new A().x; }`,
      "objRet",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });
});
