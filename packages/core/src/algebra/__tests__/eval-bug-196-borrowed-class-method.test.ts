/**
 * Bug 196 回归：**借用类方法**（`.call` / `.apply` / `.bind` / HOF 传递）按
 * **接收者成员表**反查被调用者 ⇒ 非本类实例的接收者一律假抛 TypeError。
 *
 * 修复前：`class A { m(){ return this.x; } } const m = new A().m;
 * m.call({ x: 1 })` → 折 never + throws=TypeError；原生 → 1（方法体是那个
 * 函数，`this` = 调用位给的接收者）。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts 的 protoMethodDispatch
 * 注册回调）：用户类方法值按**方法体 + this = 接收者**执行——借用调用不再
 * 反查接收者的成员表；接收者 brand 校验只在**私有名**（#m）时保留。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

describe("Bug 196 — 借用类方法按方法体执行（this = 接收者），不按接收者成员表反查", () => {
  it(".call(外来对象) → 方法体以该对象为 this 执行", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call({ x: 1 });`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it(".apply(外来对象) → 同口径", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.apply({ x: 2 });`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it(".bind(外来对象)() → 同口径", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const f = a.m.bind({ x: 3 }); return f();`)),
    ).toEqual({ ok: true, value: 3 });
  });

  it(".call(undefined) → this=undefined，方法体不碰 this 时不抛", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const a = new A(); const m = a.m; return m.call(undefined);`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("静态方法借用（.call）→ 静态方法体 + 该接收者", () => {
    expect(
      v(wrap(`class A { static sm(){ return 1; } } return A.sm.call({});`)),
    ).toEqual({ ok: true, value: 1 });
    expect(
      v(wrap(`class A { static sm(){ return this.x; } } return A.sm.call({ x: 7 });`)),
    ).toEqual({ ok: true, value: 7 });
  });

  it("静态方法摘下后借用 → 静态方法体", () => {
    expect(
      v(wrap(`class A { static sm(){ return 1; } } const { sm } = A; return sm.call({});`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("HOF 传递（数组 map 回调）→ 方法体正常执行（this=undefined 不抛）", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const a = new A(); const { m } = a; return [1].map(m).length;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("派生类实例的方法借用 → 沿派生类方法体执行", () => {
    expect(
      v(wrap(`class B extends Object { m(){ return this.x; } } const b = new B(); const m = b.m; return m.call({ x: 9 });`)),
    ).toEqual({ ok: true, value: 9 });
  });

  it("借用给本类实例 → this = 该实例（this.x 为 undefined）", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call(a);`)),
    ).toEqual({ ok: true, value: undefined });
  });

  it("借用不记 may-throw（throws 域干净）", () => {
    const rec = call(
      wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call({ x: 1 });`),
      "f",
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  });

  it("负控制：对象字面量方法的借用不受影响（原本就正确）", () => {
    expect(
      v(wrap(`const o = { m(){ return this.x; } }; const m = o.m; return m.call({ x: 5 });`)),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：方法体真读 undefined 接收者的 this 时定抛 TypeError", () => {
    expect(
      throwName(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call(undefined);`)),
    ).toBe("TypeError");
  });
});
