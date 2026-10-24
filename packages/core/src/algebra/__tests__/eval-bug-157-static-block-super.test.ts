/**
 * Bug 157 回归：static 块里的 `super`（home object = 类自身）。
 *
 * ES 语义：static 块/静态字段/静态方法体内的 `super` 以**类自身**为 home
 * object——`super.<父类静态成员>` 读父类构造器面。
 *
 * 修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型
 * 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 157 — static 块内 super 读父类静态成员", () => {
  it("static { this.x = super.m } → 父类静态成员值（原生 1）", () => {
    expect(
      v(wrap(`class A { static m = 1; } class B extends A { static { this.x = super.m; } } return B.x;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("static 块内 super.m 参与运算（原生 3）", () => {
    expect(
      v(
        wrap(
          `class A { static m = 2; } class B extends A { static { this.x = super.m + 1; } } return B.x;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("负控制：静态字段里的 super 仍读父类静态成员", () => {
    expect(
      v(wrap(`class A { static m = 1; } class B extends A { static z = super.m; } return B.z;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：静态方法里的 super 仍读父类静态成员", () => {
    expect(
      v(
        wrap(
          `class A { static m = 1; } class B extends A { static z() { return super.m; } } return B.z();`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：实例方法里的 super 仍读父类原型链（不被静态口径污染）", () => {
    expect(
      v(
        wrap(
          `class A { m() { return 1; } } class B extends A { m() { return super.m(); } } return new B().m();`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });
});
