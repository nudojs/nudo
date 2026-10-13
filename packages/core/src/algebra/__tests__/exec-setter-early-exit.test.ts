/**
 * setter 体早退控制流回归（F3 家族）：
 * - 裸 `return;`/带值 return/throw 臂不得顶掉接收者——原生 setter 返回值被
 *   丢弃（赋值表达式值 = RHS），thunk 契约恒返回 __this。此前体内早退 if
 *   提升折 `return $fork(...)`，joined 臂值被当接收者 → $set 把 c 重绑成
 *   undefined → 后续成员读 TypeError（差分 knownFalseThrows 项）。
 * - 接收者回收：体内经别名绑定写接收者（o._v / c._v / C._v——标识符根成员
 *   写进 fork 协议，臂 copy/join 重绑别名绑定）时，赋值点 `root = $set(root, …)`
 *   不得拿过时 __this 冲掉 join（否则成员读折 undefined）。
 * 每条断言与 Node 真实执行对齐（值域 + throws 域双钉）。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "./eval-helpers.ts";

describe("setter early-exit control flow", () => {
  it("class setter bare early return: write survives, no throw (F3)", () => {
    const src = `export function f() {
class C { set x(v) { if (v < 0) { return; } this._v = v; } get x() { return this._v; } }
const c = new C(); c.x = 3; return c.x;
}`;
    const r = call(src, "f");
    expect(val(src, [])).toEqual({ ok: true, value: 3 });
    expect(isNever(r.throws)).toBe(true);
  });

  it("class setter guard-negative path skips write", () => {
    expect(
      val(`export function f() {
class C { set x(v) { if (v < 0) { return; } this._v = v; } get x() { return this._v; } }
const c = new C(); c.x = -1; return c.x;
}`, []),
    ).toEqual({ ok: true, value: undefined });
  });

  it("class setter throw arm: guard passes writes, guard fails throws", () => {
    expect(
      val(`export function f() {
class C { set x(v) { if (v < 0) { throw new Error("neg"); } this._v = v; } get x() { return this._v; } }
const c = new C(); c.x = 3; return c.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
    const r = call(`export function f() {
class C { set x(v) { if (v < 0) { throw new Error("neg"); } this._v = v; } get x() { return this._v; } }
const c = new C(); c.x = -1; return c.x;
}`, "f");
    expect(throwsError(r.throws, "Error")).toBe(true);
  });

  it("class setter valued return discarded: assignment expr value = RHS", () => {
    expect(
      val(`export function f() {
class C { set x(v) { this._v = v; return v; } get x() { return this._v; } }
const c = new C(); return (c.x = 3) + c.x;
}`, []),
    ).toEqual({ ok: true, value: 6 });
  });

  it("class setter early-exit lift + valued return does not rebind receiver", () => {
    // 早退 if 提升 + 带值 return：臂值（"number"）不得顶掉接收者（object）
    expect(
      val(`export function f() {
class C { set x(v) { if (v < 0) { return v; } this._v = v; } get x() { return this._v; } }
const c = new C(); c.x = 3; return c.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("object literal setter bare early return (F3 objlit form)", () => {
    expect(
      val(`export function f() {
const o = { set x(v) { if (v < 0) { return; } this._v = v; }, get x() { return this._v; } };
o.x = 3; return o.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("static setter early-exit guard via this", () => {
    expect(
      val(`export function f() {
class C { static set x(v) { if (v < 0) { return; } this._v = v; } static get x() { return this._v; } }
C.x = 3; return C.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("static setter early-exit guard via class name (alias recovery)", () => {
    expect(
      val(`export function f() {
class C { static set x(v) { if (v < 0) { return; } C._v = v; } static get x() { return C._v; } }
C.x = 3; return C.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("object literal setter alias write + guard (alias recovery)", () => {
    expect(
      val(`export function f() {
const o = { set x(v) { if (v < 0) { return; } o._v = v; }, get x() { return o._v; } };
o.x = 3; return o.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("class setter alias write via instance binding + guard (alias recovery)", () => {
    expect(
      val(`export function f() {
class C { set x(v) { if (v < 0) { return; } c._v = v; } get x() { return this._v; } }
const c = new C(); c.x = 3; return c.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("setter unrelated free write does not disturb receiver", () => {
    expect(
      val(`export function f() {
let n = 0;
class C { set x(v) { if (v < 0) { return; } n = v; this._v = v; } get x() { return this._v; } }
const c = new C(); c.x = 3; return n + c.x;
}`, []),
    ).toEqual({ ok: true, value: 6 });
  });

  it("setter writing a non-receiver binding keeps both effects", () => {
    expect(
      val(`export function f() {
const other = {};
class C { set x(v) { if (v < 0) { return; } other._v = v; this._w = v; } get x() { return this._w + other._v; } }
const c = new C(); c.x = 3; return c.x;
}`, []),
    ).toEqual({ ok: true, value: 6 });
  });

  it("inherited static setter: classname write lands on defining class", () => {
    // B.x = 3 走 A 的 setter：A._v = 3；B.x 读 A 的 getter（return A._v）→ 3
    expect(
      val(`export function f() {
class A { static set x(v) { if (v < 0) { return; } A._v = v; } static get x() { return A._v; } }
class B extends A {}
B.x = 3; return B.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("inherited static setter: this-write lands on the receiver subclass", () => {
    // B.x = 3 走 A 的 setter，this=B：B._v = 3；A.x 读 A._v → undefined
    expect(
      val(`export function f() {
class A { static set x(v) { if (v < 0) { return; } this._v = v; } static get x() { return this._v; } }
class B extends A {}
B.x = 3; return A.x;
}`, []),
    ).toEqual({ ok: true, value: undefined });
  });

  it("super setter dispatch with early-exit guard", () => {
    expect(
      val(`export function f() {
class A { set x(v) { this._v = v; } }
class B extends A { set x(v) { if (v < 0) { return; } super.x = v; } get x() { return this._v; } }
const b = new B(); b.x = 3; return b.x;
}`, []),
    ).toEqual({ ok: true, value: 3 });
  });

  it("getter bare early return folds undefined", () => {
    expect(
      val(`export function f() {
class C { get x() { if (this._v) { return 5; } return; } }
return new C().x;
}`, []),
    ).toEqual({ ok: true, value: undefined });
  });

  it("constructor bare early return keeps subsequent writes", () => {
    expect(
      val(`export function f() {
class C { constructor() { if (this.a) { return; } this.b = 2; } }
return new C().b;
}`, []),
    ).toEqual({ ok: true, value: 2 });
  });
});
