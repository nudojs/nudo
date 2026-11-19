/**
 * / （运行时内建建模）：宿主函数 new 的 [[Construct]] 语义。
 *
 * 用户 function 声明/表达式/var 绑定函数的 new F(…) 此前落
 * $new 尾部空 brand——函数体从未执行，成员读全 undefined。修复：按原生
 * [[Construct]] 新建空 brand this → 调函数体（$rawThis 承接 Abs this）→
 * 返回 Abs 对象（brand/obj）优先，否则 this（宿主函数皆基类构造器，
 * 原始返回值忽略）。宿主内建构造器（Object/Function/Boolean…）不走体
 * 执行（Abs 实参喂真 JS 构造器会产宿主原值），维持空 brand 口径。
 *
 * 构造器原始值返回——此前只判 brand/nullish。修复：ES [[Construct]]
 * undefined → this；其余原始值基类忽略（→ this）、派生类 TypeError
 * （Derived constructors may only return object or undefined）。
 */
import { describe, it, expect } from "vitest";
import { litValue,  } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function throwsName(r: { throws: { shape: { k: string; name?: string } } }): string | undefined {
  return r.throws.shape.k === "brand" ? r.throws.shape.name : undefined;
}

describe("new on host user functions executes the constructor body", () => {
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

describe("constructor primitive return follows [[Construct]]", () => {
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

describe("new 的 IsConstructor 门（brand 形 callee）", () => {
  /**
   * BUG-151：brand 形 callee 无构造器证据（非类值）时，原生 IsConstructor
   * 恒 false ⇒ 定抛 TypeError。修复前 `new (new C())` 按 brand 名回表类 spec
   * 真的构造出新实例（签名给 C），`C.prototype` / `Array.prototype` /
   * `Object.prototype` 静默折 unknown。
   */
  const clsSrc = `class C { constructor(n) { this.n = n; } m() { return this.n; } }`;

  it("BUG-151：new (new C()) 抛 TypeError（不再构造出 C 实例）", () => {
    const r = call(
      `export function f() { ${clsSrc} const inst = new C(1); return new inst(); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("BUG-151：new C.prototype() 抛 TypeError", () => {
    const r = call(`export function f() { ${clsSrc} return new C.prototype(); }`, "f");
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("BUG-151：new Array.prototype() 抛 TypeError", () => {
    const r = call(`export function f() { return new Array.prototype(); }`, "f");
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("BUG-151：new Object.prototype() 抛 TypeError", () => {
    const r = call(`export function f() { return new Object.prototype(); }`, "f");
    expect(r.result.shape.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("BUG-151 不回归：类值本身（ctor 旗标）照常构造", () => {
    const r = call(`export function f() { ${clsSrc} return new C(2).m(); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("BUG-151 不回归：匿名类表达式值照常构造", () => {
    const r = call(
      `export function f() { const K = class { m() { return 1; } }; return new K().m(); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("BUG-151 不回归：实例的 .constructor 是构造器值（可 new）", () => {
    const r = call(
      `export function f() { ${clsSrc} const inst = new C(1); return new (inst.constructor)(3).n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });
});

describe("new 未建模宿主构造器的实例成员面", () => {
  /**
   * BUG-168：无 `@nudo:env` 时宿主全局构造器（Headers / FormData / Blob /
   * EventTarget / AbortController / Request）铸空 brand ⇒ 实例成员读折
   * exact undefined（typeof 折 "undefined"、链式调用折 never/必抛 TypeError）。
   * 修复：按宿主原型链采成员名（方法 = 不可判返回值的一等 fn，访问器 /
   * 数据属性 = honest unknown），槽打 inherited（自有键面按原生剔除）。
   */
  const six: Array<[string, string, string]> = [
    ["Headers", `new Headers().get`, "get"],
    ["FormData", `new FormData().append`, "append"],
    ["Blob", `new Blob([]).text`, "text"],
    ["EventTarget", `new EventTarget().addEventListener`, "addEventListener"],
    ["AbortController", `new AbortController().abort`, "abort"],
    ["Request", `new Request("http://x/").clone`, "clone"],
  ];

  for (const [ctorName, expr, member] of six) {
    it(`BUG-168：typeof ${expr} === "function"（${ctorName}.prototype.${member}）`, () => {
      const r = call(`export function f() { return typeof ${expr}; }`, "f");
      expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
    });
  }

  it("BUG-168：new Headers().get('x') 不再折 never / 必抛 TypeError", () => {
    const r = call(
      `export function f() { const h = new Headers(); return h.get("x"); }`,
      "f",
    );
    // 成员值诚实 unknown（不猜 string | null），但绝不折 never / 记抛
    expect(r.result.shape.k).toBe("unknown");
    expect(r.result.shape.k).not.toBe("never");
  });

  it("BUG-168：访问器值诚实 unknown（不折 exact number/undefined）", () => {
    const r = call(`export function f() { return typeof new Blob([]).size; }`, "f");
    // typeof 的是 unknown ⇒ 不是确定字面量（原生 "number"，引擎不冒充）
    expect(litValue(r.result).ok).toBe(false);
  });

  it("BUG-168：继承原型链上的成员同面（Request.prototype.clone → function）", () => {
    const r = call(`export function f() { const q = new Request("http://x/"); return typeof q.json; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("BUG-168：成员是原型面而非自有面（hasOwnProperty false / in true）", () => {
    const own = call(`export function f() { return new Headers().hasOwnProperty("get"); }`, "f");
    expect(litValue(own.result)).toEqual({ ok: true, value: false });
    const has = call(`export function f() { return "get" in new Headers(); }`, "f");
    expect(litValue(has.result)).toEqual({ ok: true, value: true });
  });

  it("BUG-168：同原型方法跨实例恒等（new Headers().get === new Headers().get）", () => {
    const r = call(`export function f() { return new Headers().get === new Headers().get; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});
