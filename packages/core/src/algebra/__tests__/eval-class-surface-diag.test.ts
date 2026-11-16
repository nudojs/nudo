/**
 * P4 类面诊断（两项）：
 *
 * P4a —— 实例接收者调「类注册面证明 STATIC-ONLY」的成员：
 * 实例的 [[Prototype]] 是 X.prototype，静态成员不在其链上，原生
 * `c.m()` c.m === undefined → 调用定抛 TypeError（class.ts $invoke：
 * 实例 brand 分支 + 链完整 + 实例面缺席 + 非 Object.prototype 名 +
 * 静态面在场 → NudoThrow(TypeError)；N2 曾折 unknown 的精确化）。
 * 控制面：实例方法调用 / instanceof / 成员读（typeof c.m → undefined）/
 * ctor 自有 fn 槽 / 实例字段 / OP 名（c.toString()）/ 可选调用
 * （c.m?.() 短路 undefined）/ 原型链实例方法同名遮蔽静态——全部不受影响。
 *
 * P4b —— 类体词法自有名是**不可变**绑定（ClassDefinitionEvaluation
 * CreateImmutableBinding）：方法/访问器/静态块/字段初始化器体内
 * `C = v` 原生 TypeError（N4 曾以 thunk 内 let 静默通过 = sound 过近似；
 * 现 methodOptsBase/accBodyOpts 注入 constNames 复用 $throwConstAssign，
 * thunk 的 `let C = __this` 仍服务 memberPathOf 根重绑不受影响）。
 * 注意：**外层**类绑定原生是可再绑的（ClassDeclaration
 * IsConstantDeclaration = false——Node 26 实测 `class C {}; C = 5`
 * no-throw 且 C 变 number），引擎外层 let 口径即原生口径，勿改。
 * 连带：函数边界参数遮蔽 / catch 参数遮蔽必须从继承 constNames 扣除
 * （`function f(K) { K = 5 }` 外层 const K 原生写参数绑定 no-throw）。
 * 每条断言与 Node 真实执行对齐（diffBody 双钉值域 + throws 域）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, tupleEls } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

const throwName = (body: string): string =>
  `try { ${body}; return "no-throw"; } catch (e) { return e.name; }`;

describe("P4a: static-only member invoked on instance receiver → definite TypeError", () => {
  it("repro: c.m()（static m）→ TypeError（原生 c.m undefined → 调用抛）；继承静态同折：b.m()（B extends A，static m 在 A）→ TypeError；静态访问器同折：c.m()（static get m）→ TypeError；静态数据字段同折：c.v()（static v = 3，statics 表）→ TypeError；计算键静态方法：c['m']()（static ['m']）→ TypeError；动", () => {
(() => {

    const r = call(
      `class C { static m() { return 1; } } export function f() { const c = new C(); ${throwName("c.m()")} }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(
      diffBody(
        `class C { static m() { return 1; } } const c = new C(); ${throwName("c.m()")}`,
      ),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class A { static m() { return 1; } } class B extends A {} export function f() { const b = new B(); ${throwName("b.m()")} }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(
      diffBody(
        `class A { static m() { return 1; } } class B extends A {} const b = new B(); ${throwName("b.m()")}`,
      ),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static get m() { return 1; } } export function f() { const c = new C(); ${throwName("c.m()")} }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class C { static v = 3; } export function f() { const c = new C(); ${throwName("c.v()")} }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(
      diffBody(`class C { static v = 3; } const c = new C(); ${throwName("c.v()")}`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static ["m"]() { return 1; } } export function f() { const c = new C(); ${throwName('c["m"]()')} }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class C { static n = 1; } export function f() { C.m = function () { return 1; }; const c = new C(); ${throwName("c.m()")} }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(
      diffBody(
        `class C { static n = 1; } C.m = function () { return 1; }; const c = new C(); ${throwName("c.m()")}`,
      ),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } } export function f() { const c = new C(); return c.m(); }`,
    );
    expect(r.result.shape.k).toBe("never");
  })();
(() => {

    const r = call(`class C { m() { return 7; } } export function f() { return new C().m(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } } export function f() { return new C() instanceof C; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } } export function f() { return typeof new C().m; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "undefined" });
    expect(
      diffBody(`class C { static m() { return 1; } } return typeof new C().m;`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } } export function f() { return new C().m?.(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
    expect(diffBody(`class C { static m() { return 1; } } return new C().m?.();`)).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } constructor() { this.m = function () { return 42; }; } } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } m = () => 99; } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 99 });
  })();
(() => {

    const r = call(
      `class C { static m() { return 1; } get m() { return 5; } } export function f() { return new C().m; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  })();
(() => {

    const r = call(
      `class C { static toString() { return "x"; } } export function f() { return typeof new C().toString(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  })();
(() => {

    const r = call(
      `class A { m() { return 1; } } class B extends A { static m() { return 2; } } export function f() { return new B().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  })();
(() => {

    const r = call(`class C { static m() { return 1; } } export function f() { return C.m(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  })();
(() => {

    const r = call(
      `class C { static n = 1; } export function f() { C.q = 5; C.n += 5; C.n++; C.n ??= 9; return [C.q, C.n]; }`,
    );
    expect(tupleEls(r.result)).toEqual([5, 7]);
    expect(
      diffBody(
        `class C { static n = 1; } C.q = 5; C.n += 5; C.n++; C.n ??= 9; return [C.q, C.n];`,
      ),
    ).toBeNull();
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});

describe("P4b: class-body self-name binding is immutable (outer binding stays mutable)", () => {
  it("repro: 静态方法体内 C = v → TypeError（ClassDefinitionEvaluation 不可变绑定）；实例方法体内 C = v → TypeError；静态字段初始化器内 C = v → TypeError（thunk 内 let C = __this 不再静默吸收）；方法内箭头捕获：const f = () => { D = 3 } → TypeError；方法内嵌套函数：function g() { D = 3 } → TypeError；静态", () => {
(() => {

    const r = call(
      `class D { static m() { ${throwName("D = 3")} } } export function f() { return D.m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(diffBody(`class D { static m() { ${throwName("D = 3")} } } return D.m();`)).toBeNull();
  })();
(() => {

    const r = call(
      `class D { m() { ${throwName("D = 3")} } } export function f() { return new D().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(
      diffBody(`class D { m() { ${throwName("D = 3")} } } return new D().m();`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class D { static x = (() => { ${throwName("D = 3")} })(); } export function f() { return D.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
    expect(
      diffBody(`class D { static x = (() => { ${throwName("D = 3")} })(); } return D.x;`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class D { m() { const f = () => { ${throwName("D = 3")} }; return f(); } } export function f() { return new D().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class D { m() { function g() { ${throwName("D = 3")} } return g(); } } export function f() { return new D().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class C { static r = "init"; static { try { C = 1; } catch (e) { C.r = e.name; } } } export function f() { return C.r; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class C { m() { ${throwName("C++")} } } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class C { get g() { ${throwName("C = 1")} } } export function f() { return new C().g; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class C { m(a = (() => { ${throwName("C = 1")} })()) { return a; } } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(
      `class A { m() { class B {} ${throwName("B = 1")} } } export function f() { return new A().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "no-throw" });
    const inner = call(
      `class A { m() { class B { static s() { ${throwName("B = 1")} } } return B.s(); } } export function f() { return new A().m(); }`,
    );
    expect(litValue(inner.result)).toEqual({ ok: true, value: "TypeError" });
  })();
(() => {

    const r = call(`class C { static v = 1; } export function f() { C = 5; return typeof C; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "number" });
    expect(diffBody(`class C { static v = 1; } C = 5; return typeof C;`)).toBeNull();
  })();
(() => {

    const r = call(
      `export function g() { class E {} E = 5; return typeof E; } export function f() { return g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "number" });
    expect(
      diffBody(`function g() { class E {} E = 5; return typeof E; } return g();`),
    ).toBeNull();
  })();
(() => {

    const r = call(`export function f() { let D = class {}; D = 5; return typeof D; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "number" });
    expect(diffBody(`let D = class {}; D = 5; return typeof D;`)).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static v = 1; } export function f(C) { C = 5; return "ok:" + C; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok:5" });
    expect(
      diffBody(`class C { static v = 1; } function g(C) { C = 5; return "ok:" + C; } return g(1);`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { m(C) { C = 1; return "ok:" + C; } } export function f() { return new C().m(0); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok:1" });
  })();
(() => {

    const r = call(
      `class C { m() { let C = 1; C = 2; return "ok:" + C; } } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok:2" });
  })();
(() => {

    const r = call(
      `class C { m() { function C() {} C = 2; return "ok"; } } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  })();
(() => {

    const r = call(
      `class C { m() { try { throw 1; } catch (C) { C = 5; return "ok:" + C; } } } export function f() { return new C().m(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok:5" });
  })();
(() => {

    const r = call(
      `export function f() { const K = 1; try { throw 1; } catch (K) { K = 5; return "ok:" + K; } }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok:5" });
    expect(
      diffBody(`const K = 1; try { throw 1; } catch (K) { K = 5; return "ok:" + K; }`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `export function f() { const K = 1; function g(K) { K = 5; return "ok"; } return g(1); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
    expect(
      diffBody(`const K = 1; function g(K) { K = 5; return "ok"; } return g(1);`),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static n = 1; static x = (C.k = 7, C.k); m() { C.q = 5; return [C.q, C.x, C.k]; } } export function f() { return new C().m(); }`,
    );
    expect(tupleEls(r.result)).toEqual([5, 7, 7]);
    expect(
      diffBody(
        `class C { static n = 1; static x = (C.k = 7, C.k); m() { C.q = 5; return [C.q, C.x, C.k]; } } return new C().m();`,
      ),
    ).toBeNull();
  })();
(() => {

    const r = call(
      `class C { static n = 3; static y = (C.q = 7, C.n); } export function f() { return [C.y, C.q]; }`,
    );
    expect(tupleEls(r.result)).toEqual([3, 7]);
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});
