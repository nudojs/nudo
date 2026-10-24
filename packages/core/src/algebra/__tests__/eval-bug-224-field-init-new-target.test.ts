/**
 * Bug 224 回归：**实例字段初始化器里的 `new.target`** 折成类值（原生恒为
 * undefined）。
 *
 * 修复前：`class A { f = new.target; }` → `new A().f` 是类值（原生 undefined
 * ——`new.target` 只在**构造器体**里有值；字段初始化器是普通函数）。
 * 根因：`$new` 的 ctor 帧覆盖「构造器体 + 实例字段初始化器」整段，而字段
 * 初始化器**不走调用边界**（不经 $call/$invoke ⇒ withNewTargetReset 不触发）
 * ⇒ 继承外层 ctor 帧。
 *
 * 修法（packages/core/src/algebra/exec/class/declare.ts 的 applyInstanceFields）：
 * 字段初始化器求值期清掉 new.target 帧（构造器帧只在构造器体内成立）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 224 — 实例字段初始化器里的 new.target 恒为 undefined", () => {
  it("字段初始化器直接读 new.target → undefined", () => {
    expect(
      v(wrap(`class A { f = new.target; } return new A().f === undefined;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("字段初始化器里 typeof new.target → \"undefined\"", () => {
    expect(
      v(wrap(`class A { f = (new.target); } return typeof new A().f;`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("字段初始化器里的箭头函数读 new.target → undefined", () => {
    expect(
      v(wrap(`class A { f = (() => new.target)(); } return String(new A().f);`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("派生类的字段初始化器 → undefined", () => {
    expect(
      v(wrap(`class A { f = new.target; } class B extends A {} return String(new B().f);`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("静态字段初始化器里的 new.target → undefined（原生 class 定义期求值）", () => {
    expect(
      v(wrap(`class A { static s = new.target; } return typeof A.s;`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("负控制：构造器体里的 new.target 仍是类值（不得被一起清掉）", () => {
    // 构造器体内 new.target === 构造器（原生）——以「是本类实例」间接断言：
    // 构造器体里 new.target.name 恒为类名。
    expect(
      v(wrap(`class A { constructor(){ this.n = new.target.name; } } return new A().n;`)),
    ).toEqual({ ok: true, value: "A" });
  });

  it("负控制：字段初始化器的值本身照常落地（不是 undefined 化）", () => {
    expect(
      v(wrap(`class A { f = 42; } return new A().f;`)),
    ).toEqual({ ok: true, value: 42 });
  });
});
