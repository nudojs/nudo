/**
 * N2：类值继承静态成员读——原生静态成员挂构造器 [[Prototype]] 链
 * （B.__proto__ = A），own 槽优先后须沿 extends 链上溯：
 * - 静态字段（声明 / 计算键 / static 块 / 动态写）——此前 own 槽 miss
 *   直接落闭 obj 面折 unknown（显示 "undefined"），B.x 丢精度；
 * - 内建父构造器静态（B extends Object → B.keys / E extends Error →
 *   E.captureStackTrace）——此前折精确 undefined（wrong-exact）；
 * - presence（`"m2" in A` / `"x" in B`）——此前实例/静态面混判
 * （`"m" in B`（实例方法）折 true、`"m2" in B`（静态）折 false，双 wrong）。
 * 修复：$get 类值臂链走（祖先类值槽——同一 Abs 引用，B.x === A.x 恒等
 * 保持）+ builtinSuperCtorOf 宿主通道（superBuiltinHost 标记放行，mock
 * 同名父类无通道 → sound unknown）；实例接收者不再误派发静态方法
 * （a.staticM() 原生定抛 TypeError，此前折静态结果 wrong-definite）。
 */
import { describe, it, expect } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

const v = (src: string) => val(`function f() { ${src} }`);

describe("N2: inherited static field reads walk the extends chain", () => {
  it("B.x ← A static x → 1（声明字段）", () => {
    expect(v(`class A { static x = 1; } class B extends A {} return B.x;`)).toEqual({ ok: true, value: 1 });
  });
  it("own 遮蔽：B 自有 static x = 2 → 2", () => {
    expect(v(`class A { static x = 1; } class B extends A { static x = 2; } return B.x;`)).toEqual({ ok: true, value: 2 });
  });
  it("多级链 B extends M extends A 传递", () => {
    expect(
      v(`class A { static x = 1; } class M extends A {} class B extends M {} return B.x;`),
    ).toEqual({ ok: true, value: 1 });
  });
  it("中间层遮蔽：M 自有 x → B.x 取 M 的", () => {
    expect(
      v(`class A { static x = 1; } class M extends A { static x = 5; } class B extends M {} return B.x;`),
    ).toEqual({ ok: true, value: 5 });
  });
  it("经变量间接读（const g = B; g.x）", () => {
    expect(v(`class A { static x = 1; } class B extends A {} const g = B; return g.x;`)).toEqual({ ok: true, value: 1 });
  });
  it("计算键静态字段继承", () => {
    expect(v(`class A { static ["x"] = 1; } class B extends A {} return B.x;`)).toEqual({ ok: true, value: 1 });
  });
  it("static 块写入的字段继承", () => {
    expect(v(`class A { static { this.x = 3; } } class B extends A {} return B.x;`)).toEqual({ ok: true, value: 3 });
  });
  it("动态写父类槽（A.y = 7 后 B.y）", () => {
    expect(v(`class A {} class B extends A {} A.y = 7; return B.y;`)).toEqual({ ok: true, value: 7 });
  });
  it("同一 Abs 引用：B.o === A.o → true（对象字段恒等）", () => {
    expect(v(`class A { static o = {k: 1}; } class B extends A {} return B.o === A.o;`)).toEqual({ ok: true, value: true });
  });
  it("子类自有写不落父类（B.x = 9 → B.x 9 / A.x 1）", () => {
    expect(
      v(`class A { static x = 1; } class B extends A {} B.x = 9; return "" + B.x + A.x;`),
    ).toEqual({ ok: true, value: "91" });
  });
  it("继承静态字段是函数：B.f() → 5（receiver = 调用类）", () => {
    expect(v(`class A { static f = () => 5; } class B extends A {} return B.f();`)).toEqual({ ok: true, value: 5 });
  });
  it("name/length/prototype 不经链继承（own 面优先）", () => {
    // B.name 自有 → "B"（不取 A 的）；prototype 走 own 原型品牌
    expect(v(`class A { static name = "nope"; } class B extends A {} return B.name;`)).toEqual({ ok: true, value: "B" });
  });
});

describe("N2: inherited static methods / accessors（既有 Bug 18 面控制）", () => {
  it("B.m() ← A static m → 1；typeof B.m → function", () => {
    expect(v(`class A { static m() { return 1; } } class B extends A {} return B.m();`)).toEqual({ ok: true, value: 1 });
    expect(v(`class A { static m() { return 1; } } class B extends A {} return typeof B.m;`)).toEqual({ ok: true, value: "function" });
  });
  it("静态 getter 继承 + receiver = 调用类（B.g === B）", () => {
    expect(
      v(`class A { static get g() { return this; } } class B extends A {} return B.g === B;`),
    ).toEqual({ ok: true, value: true });
  });
  it("静态 setter 继承（B.s = 9 落接收者）", () => {
    expect(
      v(`class A { static set s(v) { this._v = v; } } class B extends A {} B.s = 9; return B._v;`),
    ).toEqual({ ok: true, value: 9 });
  });
  it("getter 链上 this 派发取遮蔽层（B.h 用 B.g）", () => {
    expect(
      v(`class A { static get g() { return 1; } static get h() { return this.g + 1; } } class B extends A { static get g() { return 10; } } return B.h;`),
    ).toEqual({ ok: true, value: 11 });
  });
});

describe("N2: builtin-parent statics（宿主通道派发）", () => {
  it("B extends Object：B.keys({a:1}) → [\"a\"]", () => {
    const r = call(`function f() { class B extends Object {} return B.keys({a: 1}); }`);
    expect(tupleEls(r.result)).toEqual(["a"]);
  });
  it("E extends Error：typeof E.captureStackTrace → function（此前折 \"undefined\" wrong-exact）", () => {
    expect(v(`class E extends Error {} return typeof E.captureStackTrace;`)).toEqual({ ok: true, value: "function" });
  });
  it("P extends Promise：typeof P.all → function", () => {
    expect(v(`class P extends Promise {} return typeof P.all;`)).toEqual({ ok: true, value: "function" });
  });
  it("TA 家族父类：typeof A2.from → function", () => {
    expect(v(`class A2 extends Uint8Array {} return typeof A2.from;`)).toEqual({ ok: true, value: "function" });
  });
  it("presence 沿宿主链：\"keys\" in B / \"captureStackTrace\" in E → true", () => {
    expect(v(`class B extends Object {} return "keys" in B;`)).toEqual({ ok: true, value: true });
    expect(v(`class E extends Error {} return "captureStackTrace" in E;`)).toEqual({ ok: true, value: true });
  });
  it("同名用户类遮蔽内建（用户 Error 注册面优先）", () => {
    expect(
      v(`class Error { static m() { return 1; } } class E extends Error {} return E.m();`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("N2: presence（$in）类值静态面", () => {
  it("自有静态方法：\"m2\" in A → true", () => {
    expect(v(`class A { static m2() { return 1; } } return "m2" in A;`)).toEqual({ ok: true, value: true });
  });
  it("继承静态字段：\"x\" in B → true", () => {
    expect(v(`class A { static x = 1; } class B extends A {} return "x" in B;`)).toEqual({ ok: true, value: true });
  });
  it("实例方法不在类值链：\"m\" in B → false（原生 false；此前折 true wrong-exact）", () => {
    expect(v(`class A { m() { return 1; } } class B extends A {} return "m" in B;`)).toEqual({ ok: true, value: false });
  });
  it("类值是函数：\"call\" in B → true", () => {
    expect(v(`class B {} return "call" in B;`)).toEqual({ ok: true, value: true });
  });
  it("缺席键（链完整）→ false", () => {
    expect(v(`class A { static x = 1; } class B extends A {} return "nope" in B;`)).toEqual({ ok: true, value: false });
  });
  it("链洞（未注册父名）→ 不可判不折精确", () => {
    const r = call(`function f() { function Foo() {} Foo.k = 5; class B extends Foo {} return "k" in B; }`);
    expect(r.result?.shape?.k).toBe("prim");
    expect(litValue(r.result).ok).toBe(false); // 布尔域无字面量（非精确 true/false）
  });
});

describe("N2: 实例接收者不派发静态成员（原生 TypeError 面）", () => {
  it("a.staticM() 不再折静态结果（sound unknown；此前折 \"static\" wrong-definite）", () => {
    const r = call(`function f() { class A { static m2() { return "static"; } } const a = new A(); return a.m2(); }`);
    expect(r.result?.shape?.k).toBe("unknown");
  });
  it("类值接收者静态派发不受影响（B.m2() → static）", () => {
    expect(v(`class A { static m2() { return "static"; } } class B extends A {} return B.m2();`)).toEqual({ ok: true, value: "static" });
  });
});
