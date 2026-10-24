/**
 * Bug 205 回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器
 * **名字**匹配折 exact true。
 *
 * ES 语义：`Object.setPrototypeOf(f, null)` 之后 `f instanceof F` → false
 * （[[Prototype]] 链终止，OrdinaryHasInstance 无从命中 `F.prototype`）。
 * 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用
 * `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true
 * （unsound 的肯定判断——类型守卫会走错分支）。
 *
 * 原型**替换**面（`F.prototype = {}` / `= 5`）需要「实例记录真实
 * [[Prototype]]」的建模（构造期捕获 + 写面更新）——S22 落地：
 * - `member.ts`：`$set` 对**宿主函数**建 facade，让 `F.prototype = {}` 的写
 *   落进槽（此前写穿后引擎完全无感）；
 * - `declare.ts`：实例**构造期**记录 [[Prototype]]（brand 实例带一条原型
 *   链记录）；
 * - `objects.ts`：`setPrototypeOf` 对 **brand 接收者**也记（此前只对 obj
 *   接收者记）；
 * - `members.ts`：`$instanceof` 沿**记录的链**做**身份**比较（RHS 的
 *   prototype 身份，不是名字）；原型不可判时降 boolean（不得 exact true）；
 *   RHS 的 `prototype` 为非对象时按 spec 抛 TypeError。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛面探针：throws 是 brand 且 name 匹配 */
function threw(src: string, name: string): boolean {
  return throwsError(call(src, "f").throws, name);
}

describe("Bug 205 — 原型被改写后 instanceof 不得折 exact true", () => {
  it("函数构造器实例：Object.setPrototypeOf(f, null) → false", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,null); return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("类实例：Object.setPrototypeOf(a, null) → false", () => {
    expect(
      v(wrap(`class A{} const a=new A(); Object.setPrototypeOf(a,null); return a instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("负控制：未改写原型的实例仍折 exact true", () => {
    expect(v(wrap(`function F(){} const f=new F(); return f instanceof F;`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`class A{} const a=new A(); return a instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：派生类实例 instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} class B extends A{} const b=new B(); return b instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：原型对象 instanceof 自身 → false；instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} return A.prototype instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A{} class B extends A{} return B.prototype instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("F.prototype = {} 之后 f instanceof F → false（实例记录真实 [[Prototype]]）", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); F.prototype={}; return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("F.prototype = 5 之后 f instanceof F → TypeError（RHS prototype 非对象）", () => {
    expect(
      threw(
        wrap(`function F(){} const f=new F(); F.prototype=5; return f instanceof F;`),
        "TypeError",
      ),
    ).toBe(true);
  });

  it("换原型前造的旧实例与换后造的新实例可区分（原生 \"false|true\"）", () => {
    expect(
      v(
        wrap(
          `function F(){} const f=new F(); F.prototype={x:1}; const g=new F(); return (f instanceof F)+"|"+(g instanceof F);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false|true" });
  });

  it("原型替换后新造的实例仍 instanceof 构造器 → true", () => {
    expect(
      v(wrap(`function F(){} F.prototype={}; const g=new F(); return g instanceof F;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("原型替换写成 null → TypeError（RHS prototype 非对象）", () => {
    expect(
      threw(wrap(`function F(){} const f=new F(); F.prototype=null; return f instanceof F;`), "TypeError"),
    ).toBe(true);
  });

  it("setPrototypeOf 到普通对象后不再折 exact true（原型链不可判 → 降 boolean）", () => {
    const r = call(
      wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,{}); return f instanceof F;`),
      "f",
    );
    // 原生 false；引擎不得折 exact true（链不可判 → boolean），也不得折
    // exact false（那需要「替换进来的原型」的 [[Prototype]] 链可判）
    expect(litValue(r.result)).not.toEqual({ ok: true, value: true });
    expect(litValue(r.result)).not.toEqual({ ok: true, value: false });
  });

  it("负控制：原型替换后 fn 仍可调用、prototype 读回是新原型", () => {
    expect(v(wrap(`function F(){ return 7; } F.prototype={}; return F();`))).toEqual({
      ok: true,
      value: 7,
    });
  });
});
