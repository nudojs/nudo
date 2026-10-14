/**
 * N4：静态字段初始化器内类名引用——类体自有词法绑定（host TDZ 修复）。
 *
 * 此前静态字段 thunk 求值于 $class 内、`let C = $class(…)` 尚未赋值：
 * `static x = this === C` 的自由标识符 C 命中宿主 let TDZ → 装载期
 * ReferenceError（原生 ClassDefinitionEvaluation 先初始化类体自有绑定
 * 再跑静态字段初始化器，折 true）。连带：`static y = C.n`（同胞字段读）、
 * 具名类表达式 `class D { … D.name }`、内嵌类静态引用外层类名全部同炸。
 *
 * 修复（stmt.ts classSpecOf 静态字段分支）：自有名类在 thunk 顶部发射
 * `let C = __this;` 复刻类体词法绑定——遮蔽（内层参数/具名函数）、闭包
 * 捕获、嵌套类沿生成代码词法链免费对齐；let 而非 const（`C.q = v` 经
 * memberPathOf 根重绑 C = $set(C,…) 不得假 TypeError）。匿名类表达式不
 * 引入绑定（外层名引用保持 TDZ，与原生一致）；计算键原生求值于绑定
 * 初始化前（引用类名原生亦 ReferenceError）——保持裸表达式。
 * 连带修复（class.ts $class）：name 槽落地从尾部前移到静态字段求值前
 * ——初始化器内 `C.name` 可读 "C"，用户 `static name = "custom"` 不再
 * 被尾置 strLit(name) 冲回类名。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, tupleEls } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

describe("N4: static-field initializer referencing the class by name", () => {
  it("repro1: static x = this === C → true（原生绑定初始化先于初始化器）", () => {
    const r = call(
      `class C { static n = 3; static x = this === C; } export function f() { return C.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(diffBody(`class C { static n = 3; static x = this === C; } return C.x;`)).toBeNull();
  });

  it("repro2: static y = C.n → 3（类名 + 前序同胞字段读）", () => {
    const r = call(`class C { static n = 3; static y = C.n; } export function f() { return C.y; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    expect(diffBody(`class C { static n = 3; static y = C.n; } return C.y;`)).toBeNull();
  });

  it("函数级类声明同机制（let C 在函数体内 TDZ）", () => {
    const r = call(
      `export function f() { class C { static n = 3; static x = this === C; } return C.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("初始化器内闭包迟到读：static g = () => C.n → 后序字段可见（共享槽）", () => {
    const r = call(
      `class C { static g = () => C.n; static n = 7; } export function f() { return C.g(); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
    expect(diffBody(`class C { static g = () => C.n; static n = 7; } return C.g();`)).toBeNull();
  });

  it("成员写不假抛：static y = (C.q = 7, C.n)（let 承接 memberPathOf 根重绑）", () => {
    const r = call(
      `class C { static n = 3; static y = (C.q = 7, C.n); } export function f() { return [C.y, C.q]; }`,
    );
    expect(tupleEls(r.result)).toEqual([3, 7]);
    expect(
      diffBody(`class C { static n = 3; static y = (C.q = 7, C.n); } return [C.y, C.q];`),
    ).toBeNull();
  });

  it("内嵌类静态引用外层类名（沿生成代码词法链 → 外层 thunk 绑定）", () => {
    const r = call(
      `class A { static n = 1; static inner = class { static x = A.n; }; } export function f() { return A.inner.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(
      diffBody(`class A { static n = 1; static inner = class { static x = A.n; }; } return A.inner.x;`),
    ).toBeNull();
  });

  it("内嵌同名类遮蔽：内层 C 的静态体 C 引用内层类值（.n → undefined）", () => {
    const r = call(
      `class C { static n = 1; static i = class C { static x = C.n; }; } export function f() { return C.i.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
    expect(
      diffBody(`class C { static n = 1; static i = class C { static x = C.n; }; } return C.i.x;`),
    ).toBeNull();
  });

  it("具名类表达式：static x = D.name → \"D\"（IIFE 内 $class 同 TDZ 面）", () => {
    const r = call(
      `const K = class D { static x = D.name; }; export function f() { return K.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "D" });
    expect(
      diffBody(`const K = class D { static x = D.name; }; return K.x;`),
    ).toBeNull();
  });

  it("遮蔽：内层箭头参数/具名函数表达式照常遮蔽类名（JS 词法免费对齐）", () => {
    const r1 = call(
      `class C { static x = ((C) => C)(5); } export function f() { return C.x; }`,
    );
    expect(litValue(r1.result)).toEqual({ ok: true, value: 5 });
    expect(diffBody(`class C { static x = ((C) => C)(5); } return C.x;`)).toBeNull();
    const r2 = call(
      `class C { static x = function C() { return 9; }; } export function f() { return C.x(); }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: 9 });
    expect(diffBody(`class C { static x = function C() { return 9; }; } return C.x();`)).toBeNull();
  });

  it("name 槽前移：初始化器内 C.name → \"C\"；static name = \"custom\" 覆写生效", () => {
    const r1 = call(`class C { static x = C.name; } export function f() { return C.x; }`);
    expect(litValue(r1.result)).toEqual({ ok: true, value: "C" });
    expect(diffBody(`class C { static x = C.name; } return C.x;`)).toBeNull();
    const r2 = call(`class C { static name = "custom"; } export function f() { return C.name; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: "custom" });
    expect(diffBody(`class C { static name = "custom"; } return C.name;`)).toBeNull();
  });
});

describe("N4: 控制组（不引入绑定的面保持原生）", () => {
  it("匿名类表达式：static x = 1 正常；static x = K 外层名 TDZ（原生同抛）", () => {
    const r = call(`const K = class { static x = 1; }; export function f() { return K.x; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(() =>
      call(`const K = class { static x = K; }; export function f() { return K.x; }`),
    ).toThrow(/before initialization/);
    expect(diffBody(`const K = class { static x = K; }; return K.x;`)).toBeNull();
  });

  it("实例字段引用类名（构造期求值，类绑定已初始化）→ 3 不变", () => {
    const r = call(`class C { static n = 3; f = C.n; } export function f() { return new C().f; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    expect(diffBody(`class C { static n = 3; f = C.n; } return new C().f;`)).toBeNull();
  });

  it("this-only 静态字段（R5 面不回归）→ true", () => {
    const r = call(
      `class C { static s = this; static t = this === C; } export function f() { return C.t; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    expect(diffBody(`class C { static s = this; static t = this === C; } return C.t;`)).toBeNull();
  });

  it("静态块（类绑定后执行）引用类名 → 2 不变", () => {
    const r = call(
      `class C { static n = 1; static { C.m = C.n + 1; } } export function f() { return C.m; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    expect(diffBody(`class C { static n = 1; static { C.m = C.n + 1; } } return C.m;`)).toBeNull();
  });

  it("计算键引用类名：原生求值于绑定初始化前 → 双方 ReferenceError", () => {
    expect(() =>
      call(`class C { static [C.name] = 1; } export function f() { return C.C; }`),
    ).toThrow(/before initialization/);
    expect(diffBody(`class C { static [C.name] = 1; } return C.C;`)).toBeNull();
  });

  it("class C extends C：extends 求值于类体作用域外 → 双方 ReferenceError", () => {
    expect(() => call(`class C extends C {} export function f() { return 1; }`)).toThrow(
      /before initialization/,
    );
    expect(diffBody(`class C extends C {} return 1;`)).toBeNull();
  });
});
