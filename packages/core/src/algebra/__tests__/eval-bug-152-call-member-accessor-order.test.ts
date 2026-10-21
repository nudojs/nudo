/**
 * Bug 152 回归（core exec/transpile）：调用点成员**访问器**在**实参之后**才求值。
 *
 * 原生 CallExpression（`o.m(args)`）的求值顺序：
 *   ① 求 `o` → ② 取 `o.m`（**访问器 getter 在此触发**）→ ③ 求实参 → ④ 调用。
 * 修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入，
 * 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了
 * （`o.m(b())` 原生 "mbc" / 引擎 "bmc"）。
 *
 * 修法：发射调用表达式时把实参包成 **thunk**（`() => [args]`）——
 * $invoke 先读成员（预读），再求实参，最后派发；派发复用预读值
 * （不再二次读 ⇒ getter 只跑一次）。
 *
 * 负控制钉住：非访问器成员（数据槽方法）、普通函数调用、super 调用、
 * 私有名调用、数组方法——行为不变。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** 求值结果的字面量值 */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : `<not-lit:${(call(src, "f").result as { shape?: { k?: string } }).shape?.k}>`;
}

describe("Bug 152: 调用点成员访问器先于实参求值", () => {
  it("对象字面量访问器：getter 在实参之前跑（原生 mbc / 改前 bmc）", () => {
    const src = `export function f() {
      let s = "";
      const o = { get m() { s += "m"; return function () { s += "c"; }; } };
      function b() { s += "b"; }
      o.m(b());
      return s;
    }`;
    expect(v(src)).toBe("mbc");
  });

  it("对象字面量访问器 + 两个实参：getter → 实参 → 调用（原生 mabc）", () => {
    const src = `export function f() {
      let s = "";
      const o = { get m() { s += "m"; return function () { s += "c"; }; } };
      function a() { s += "a"; }
      function b() { s += "b"; }
      o.m(a(), b());
      return s;
    }`;
    expect(v(src)).toBe("mabc");
  });

  it("类访问器：getter 先于实参（原生 gmbc / 改前 bgmc）", () => {
    const src = `export function f() {
      let s = "";
      class A { get m() { s += "gm"; return () => { s += "c"; }; } }
      function b() { s += "b"; }
      new A().m(b());
      return s;
    }`;
    expect(v(src)).toBe("gmbc");
  });

  it("静态类访问器：getter 先于实参（原生 smbc / 改前 bsmc）", () => {
    const src = `export function f() {
      let s = "";
      class A { static get m() { s += "sm"; return function () { s += "c"; }; } }
      function b() { s += "b"; }
      A.m(b());
      return s;
    }`;
    expect(v(src)).toBe("smbc");
  });

  it("嵌套访问器：外层 getter → 内层 getter → 实参（原生 pmbc）", () => {
    const src = `export function f() {
      let s = "";
      const inner = { get m() { s += "m"; return function () { s += "c"; }; } };
      const o = { get p() { s += "p"; return inner; } };
      function b() { s += "b"; }
      o.p.m(b());
      return s;
    }`;
    expect(v(src)).toBe("pmbc");
  });

  it("计算键调用：键 → 成员读 → 实参（原生 kmbc / 改前 kbmc）", () => {
    const src = `export function f() {
      let s = "";
      const o = { get m() { s += "m"; return function () { s += "c"; }; } };
      function k() { s += "k"; return "m"; }
      function b() { s += "b"; }
      o[k()](b());
      return s;
    }`;
    expect(v(src)).toBe("kmbc");
  });

  it("getter 抛：实参**不**求值（原生 mT / 改前 bmT）", () => {
    const src = `export function f() {
      let s = "";
      const o = { get m() { s += "m"; throw new Error("x"); } };
      function b() { s += "b"; }
      try { o.m(b()); } catch (e) { s += "T"; }
      return s;
    }`;
    expect(v(src)).toBe("mT");
  });

  it("getter 返回非函数：getter → 实参 → TypeError（原生 mbT / 改前 bmT）", () => {
    const src = `export function f() {
      let s = "";
      const o = { get m() { s += "m"; return 42; } };
      function b() { s += "b"; }
      try { o.m(b()); } catch (e) { s += "T"; }
      return s;
    }`;
    expect(v(src)).toBe("mbT");
  });

  it("getter 只跑一次（不得因预读 + 派发各读一次而跑两遍）", () => {
    const src = `export function f() {
      let s = "";
      const o = { get m() { s += "m"; return function () { s += "c"; }; } };
      o.m();
      return s;
    }`;
    expect(v(src)).toBe("mc");
  });
});

describe("Bug 152 负控制：非访问器成员 / super / 私有名 / 数组方法不受影响", () => {
  it("数据槽方法：成员读无副作用，调用仍在实参之后（原生 bm）", () => {
    const src = `export function f() {
      let s = "";
      const o = { m() { s += "m"; } };
      function b() { s += "b"; }
      o.m(b());
      return s;
    }`;
    expect(v(src)).toBe("bm");
  });

  it("普通函数调用：实参从左到右（原生 abf）", () => {
    const src = `export function f() {
      let s = "";
      function g(x) { s += "f"; }
      function a() { s += "a"; }
      function b() { s += "b"; }
      g(a(), b());
      return s;
    }`;
    expect(v(src)).toBe("abf");
  });

  it("计算键 + 数据槽方法：键先求值（原生 kbm）", () => {
    const src = `export function f() {
      let s = "";
      const o = { m() { s += "m"; } };
      function k() { s += "k"; return "m"; }
      function b() { s += "b"; }
      o[k()](b());
      return s;
    }`;
    expect(v(src)).toBe("kbm");
  });

  it("super 调用：父类方法仍被派发（this 绑实例）", () => {
    const src = `export function f() {
      let s = "";
      class A { m(x) { s += "A" + x; } }
      class B extends A { m(x) { s += "B"; super.m(x); } }
      function b() { s += "b"; }
      new B().m(b());
      return s;
    }`;
    expect(v(src)).toBe("bBAundefined");
  });

  it("私有名方法调用：this.#m() 仍走类注册表派发", () => {
    const src = `export function f() {
      let s = "";
      class A { #m() { s += "m"; } run() { s += "r"; this.#m(); } }
      new A().run();
      return s;
    }`;
    expect(v(src)).toBe("rm");
  });

  it("数组方法：map 回调仍逐元素跑", () => {
    const src = `export function f() {
      let s = "";
      const a = [1, 2];
      a.map(function (v) { s += "m"; });
      return s;
    }`;
    expect(v(src)).toBe("mm");
  });

  it("this 绑定：对象方法体内的 this 仍是接收者", () => {
    const src = `export function f() {
      const o = { n: 7, m() { return this.n; } };
      return o.m();
    }`;
    expect(v(src)).toBe(7);
  });
});
