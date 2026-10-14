/**
 * R2b（新鲜实例身份）：对象值 === 按创建事件折 false——async 方法每次
 * 调用产出新 promise、Promise.resolve / then 链 / 生成器对象 / 迭代器
 * 对象 / new 实例 / 对象/数组字面量同理（native：不同创建事件必不同
 * 引用）。控制组：同绑定别名 / 采纳（Promise.resolve(p) 透传 p）/
 * 原始值 === 保持 true。
 *
 * 机制：instance-id.ts WeakMap 侧表（与 symbol-id.ts 同构）——创建点打
 * 递增 id，strictEqAbs 对「双方已打 id 且不同」折 false。健全性依赖
 * 引用传播不变量：同一运行时对象的别名复用同一 Abs 引用（同 ref / 同
 * var 臂先折 true）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

function v(src: string): unknown {
  const r = call(src);
  const lv = litValue(r.result);
  return lv.ok ? lv.value : undefined;
}

describe("R2b: async 方法 promise 身份", () => {
  it("o.m() === o.m()（async 方法两次调用）→ false", () => {
    expect(v(`export function f() { const o = { async m() {} }; return o.m() === o.m(); }`)).toBe(false);
  });

  it("async 函数声明两次调用 → false", () => {
    expect(v(`async function h() { return 1; } export function f() { return h() === h(); }`)).toBe(false);
  });

  it("async 箭头两次调用 → false", () => {
    expect(v(`export function f() { const a = async () => 1; return a() === a(); }`)).toBe(false);
  });

  it("确定拒绝的 async（体 throw）promise 同样每次新对象 → false", () => {
    expect(v(`export function f() { const o = { async m() { throw new Error("x"); } }; return o.m() === o.m(); }`)).toBe(false);
  });
});

describe("R2b: Promise 静态/实例面", () => {
  it("Promise.resolve(1) === Promise.resolve(1) → false（报告控制组）", () => {
    expect(v(`export function f() { return Promise.resolve(1) === Promise.resolve(1); }`)).toBe(false);
  });

  it("Promise.reject(1) === Promise.reject(1) → false", () => {
    expect(v(`export function f() { return Promise.reject(1) === Promise.reject(1); }`)).toBe(false);
  });

  it("then 链产物 vs 原 promise → false", () => {
    expect(v(`export function f() { const p = Promise.resolve(1); return p.then(() => 2) === p; }`)).toBe(false);
  });

  it("withResolvers().promise 两次 → false", () => {
    expect(v(`export function f() { return Promise.withResolvers().promise === Promise.withResolvers().promise; }`)).toBe(false);
  });

  it("采纳（Promise.resolve(既有 promise)）→ 同对象 true", () => {
    expect(v(`export function f() { const p = Promise.resolve(1); return Promise.resolve(p) === p; }`)).toBe(true);
  });

  it("采纳（async 调用结果再 resolve）→ true", () => {
    expect(v(`async function h() { return 1; } export function f() { const p = h(); return Promise.resolve(p) === p; }`)).toBe(true);
  });
});

describe("R2b: 生成器 / 迭代器 / 实例 / 字面量", () => {
  it("生成器对象两次调用 → false", () => {
    expect(v(`export function f() { const g = function* () { yield 1; }; return g() === g(); }`)).toBe(false);
  });

  it("[].values() 迭代器两次 → false", () => {
    expect(v(`export function f() { return [1].values() === [1].values(); }`)).toBe(false);
  });

  it("new C() 两次（空类/带字段派生类）→ false", () => {
    expect(v(`export function f() { class A {} return new A() === new A(); }`)).toBe(false);
    expect(v(`export function f() { class A { x = 1; } class B extends A { y = 2; } return new B() === new B(); }`)).toBe(false);
  });

  it("对象/数组字面量两次 → false", () => {
    expect(v(`export function f() { return {} === {}; }`)).toBe(false);
    expect(v(`export function f() { return [] === []; }`)).toBe(false);
    expect(v(`export function f() { return [1, 2] === [1, 2]; }`)).toBe(false);
  });
});

describe("R2b: 控制组（恒等面不回归）", () => {
  it("同绑定别名 === → true（promise/生成器/实例/字面量）", () => {
    expect(v(`export function f() { const o = { async m() {} }; const a = o.m(); const b = a; return a === b; }`)).toBe(true);
    expect(v(`export function f() { const g = function* () { yield 1; }; const it = g(); return it === it; }`)).toBe(true);
    expect(v(`export function f() { class A {} const a = new A(); const b = a; return a === b; }`)).toBe(true);
    expect(v(`export function f() { const o = {}; const p = o; return p === o; }`)).toBe(true);
  });

  it("槽位/数组往返别名 → true（引用传播不变量）", () => {
    expect(v(`export function f() { const o = { async m() {} }; const p = o.m(); return [p][0] === p; }`)).toBe(true);
    expect(v(`export function f() { const s = {}; class A { constructor(o) { this.o = o; } } return new A(s).o === new A(s).o; }`)).toBe(true);
  });

  it("原始值 === 不受影响", () => {
    expect(v(`export function f() { return 1 === 1; }`)).toBe(true);
    expect(v(`export function f() { return "a" === "a"; }`)).toBe(true);
    expect(v(`export function f() { return 1 === 2; }`)).toBe(false);
    expect(v(`export function f() { return NaN === NaN; }`)).toBe(false);
  });

  it("方法值同读恒等不回归（o.m === o.m → true）", () => {
    expect(v(`export function f() { const o = { m() {} }; return o.m === o.m; }`)).toBe(true);
  });
});

describe("R2b: differential native 对照（隐式 return 体）", () => {
  const corpus = [
    `const o = { async m() {} }; return o.m() === o.m();`,
    `return Promise.resolve(1) === Promise.resolve(1);`,
    `const o = { async m() {} }; const a = o.m(); const b = a; return a === b;`,
    `const p = Promise.resolve(1); return Promise.resolve(p) === p;`,
    `const p = Promise.resolve(1); return p.then(() => 2) === p;`,
    `const g = function* () { yield 1; }; return g() === g();`,
    `return [1].values() === [1].values();`,
    `class A {} return new A() === new A();`,
    `class A { x = 1; } class B extends A { y = 2; } return new B() === new B();`,
    `return {} === {};`,
    `return [] === [];`,
    `async function h() { return 1; } const p = h(); return p === h();`,
    `class A {} class B extends A { inc() { super.x += 5; } } const b = new B(); b.inc(); return b.x;`,
  ];
  it.each(corpus.map((body, i) => [i, body] as const))(
    "语料 #%i 与 native 一致",
    (_i, body) => {
      expect(diffBody(body)).toBeNull();
    },
  );
});
