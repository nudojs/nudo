/**
 * Bug 245：派生类构造器**未调 super()** / **重复调 super()** ⇒ ReferenceError。
 *
 * 原生（node 实测）：
 * - `class B extends A { constructor(){ this.x = 1; } }` → `new B()` 抛
 *   ReferenceError（"Must call super constructor in derived class before
 *   accessing 'this' or returning from derived constructor"）。
 * - `class B extends A { constructor(){ super(); super(); } }` → `new B()` 抛
 *   ReferenceError（"Super constructor may only be called once"）。
 * - 基类构造器 / 隐式派生构造器（无显式 ctor）⇒ 不抛。
 *
 * 引擎此前无「本帧已调 super」状态通道 ⇒ 不调 super 的派生构造器静默构造
 * 成功（假绿），重复调 super 也静默通过。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 245：派生构造器的 super() 通道", () => {
  it("派生构造器不调 super()：new B() 定抛 ReferenceError", () => {
    const r = call(
      `class A { constructor(){ this.x = 1; } }
       class B extends A { constructor(){ this.y = 2; } }
       export function f(){ return new B().x; }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "ReferenceError")).toBe(true);
  });

  it("派生构造器重复调 super()：第二次定抛 ReferenceError", () => {
    const r = call(
      `class A { constructor(){ this.x = 1; } }
       class B extends A { constructor(){ super(); super(); } }
       export function f(){ return new B().x; }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "ReferenceError")).toBe(true);
  });

  it("正常 super() 路径不受影响（值仍精确）", () => {
    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         class B extends A { constructor(){ super(); this.y = 2; } }
         export function f(){ return new B().x; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("基类构造器不受影响（无 super 需求）", () => {
    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         export function f(){ return new A().x; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("隐式派生构造器（无显式 ctor）不受影响", () => {
    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         class B extends A { }
         export function f(){ return new B().x; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("多层派生链：内层 super() 不得被误判成外层「已调」（各层各记各的）", () => {
    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         class B extends A { constructor(){ super(); this.b = 2; } }
         class C extends B { constructor(){ super(); this.c = 3; } }
         export function f(){ const o = new C(); return o.x + o.b + o.c; }`,
      ),
    ).toEqual({ ok: true, value: 6 });
  });
});
