/**
 * 转译打印保真修复回归（bug-report Bug 4/5/8/9/13/14/15/19/21）。
 *
 * 每条测试锁定「转译产物与源程序语义等价」的一个此前破坏面：
 * - Bug 4  多行 export default 不再被导出重写正则静默丢弃（runTranspiled 边界）
 * - Bug 5  逗号运算符（SequenceExpression）括号化——嵌入箭头体/数组元素/
 *          初始化/for-init 不再改变外层语法结构
 * - Bug 8  for (let a=…, b=…) 多声明 init 不丢弃后续声明
 * - Bug 9  对象字面量计算键方法/访问器 {[m](){}} 键按 m 的值注册
 * - Bug 13 命名函数表达式（NFE）自身名绑定（typeof g / 递归）
 * - Bug 14 静态方法内 super.x / super.m() 接收者 = 父类构造器
 * - Bug 15 同一作用域同行/相邻解构临时名不撞车（含 prologue _n 面）
 * - Bug 19 对象字面量方法内 super.m() 沿 home object 原型链派发
 * - Bug 21 var 函数作用域提升（块内 var / 重声明 / 跨块写 / while 内 var）
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  transpileSource,
  litValue,
  absToString,
  $lit,
  $obj,
} from "../index.ts";

/** 引擎边界执行：transpile + run + 按名调用导出，收字面量结果与 throws 面 */
const evalFn = (source: string, name: string, args: unknown[] = []) => {
  const exports = runTranspiled(source);
  const r = callTranspiledExportFull(exports, name, args as never[]);
  const lv = litValue(r.result);
  return {
    ok: lv.ok,
    value: lv.ok ? lv.value : undefined,
    desc: absToString(r.result),
    throws: absToString(r.throws),
  };
};

describe("Bug 4：多行 export default 导出重写", () => {
  it("块体箭头默认导出跨行——default 槽保留（此前整条漏改写）", () => {
    const exports = runTranspiled(`export default (x) => { return x + 1; };`);
    expect(Object.hasOwn(exports, "default")).toBe(true);
    // 值是 fn Abs（非字面量）——按函数面断言
    expect(absToString(exports.default as never)).toContain("fn(x)");
  });

  it("含方法对象的默认导出跨行——default 槽保留", () => {
    const exports = runTranspiled(`export default { a: 1, m() { return 2; } };`);
    expect(Object.hasOwn(exports, "default")).toBe(true);
  });

  it("单行默认导出（42 / 表达式体箭头）不回归", () => {
    const e1 = runTranspiled(`export default 42;`);
    expect(litValue(e1.default as never)).toEqual({ ok: true, value: 42 });
    const e2 = runTranspiled(`export default (x) => x + 1;`);
    expect(Object.hasOwn(e2, "default")).toBe(true);
  });
});

describe("Bug 5：逗号运算符（SequenceExpression）括号化", () => {
  it("箭头简洁体序列取末元（不再逸出成 $fnVal 多余实参）", () => {
    expect(
      evalFn(`export function seq() { const f = () => (1, 2, 3); return f(); }`, "seq"),
    ).toMatchObject({ ok: true, value: 3 });
  });

  it("数组元素序列不增元素个数", () => {
    expect(
      evalFn(`export function elemLen() { const f = () => [(1, 2), 3]; return f().length; }`, "elemLen"),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("for-init 序列取末元", () => {
    expect(
      evalFn(`export function f() { for (let i = (0, 1); i < 2; i++) { return i; } return -1; }`, "f"),
    ).toMatchObject({ ok: true, value: 1 });
  });

  it("初始化位置序列（此前整模块 SyntaxError fail-closed）", () => {
    expect(
      evalFn(`export function init() { let x = (1, 2); return x; }`, "init"),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("箭头体实参序列（此前 ReferenceError）", () => {
    expect(
      evalFn(`export function pair() { const f = (a, b) => (a, b); return f(5, 6); }`, "pair"),
    ).toMatchObject({ ok: true, value: 6 });
  });
});

describe("Bug 8：for-init 多声明", () => {
  it("let i=0, j=10 双绑定都可用（此前 j 丢失 → ReferenceError）", () => {
    expect(
      evalFn(`export function f() { let s = 0; for (let i = 0, j = 10; i < j; i++, j--) { s++; } return s; }`, "f"),
    ).toMatchObject({ ok: true, value: 5 });
  });

  it("无逗号 update 的多声明 init 同样不丢", () => {
    expect(
      evalFn(`export function f2() { for (let i = 0, j = 5; i < j; i++) {} return j; }`, "f2"),
    ).toMatchObject({ ok: true, value: 5 });
  });

  it("var 多声明 for-init（fallback 路径）不回归", () => {
    expect(
      evalFn(`export function f3() { let c = 0; for (var i = 0, j = 2; i < j; i++) { c++; } return c; }`, "f3"),
    ).toMatchObject({ ok: true, value: 2 });
  });
});

describe("Bug 9：对象字面量计算键方法/访问器", () => {
  it('{ [m]() {} } 键按 m 的值注册（此前挂 "m" 键 → o.g undefined → TypeError）', () => {
    expect(
      evalFn(`export function f() { const m = "g"; const o = { [m]() { return 5; } }; return o.g(); }`, "f"),
    ).toMatchObject({ ok: true, value: 5 });
  });

  it("计算键访问器 get [m]() 同口径", () => {
    expect(
      evalFn(`export function f2() { const m = "g"; const o = { get [m]() { return 7; } }; return o.g; }`, "f2"),
    ).toMatchObject({ ok: true, value: 7 });
  });

  it("[Symbol.iterator]() 计算符号键投影不回归", () => {
    expect(
      evalFn(
        `export function f3() { const o = { [Symbol.iterator]() { return 1; } }; return typeof o[Symbol.iterator]; }`,
        "f3",
      ),
    ).toMatchObject({ ok: true, value: "function" });
  });
});

describe("Bug 13：命名函数表达式自身名绑定", () => {
  it('typeof g === "function"（此前折 "undefined"）', () => {
    expect(
      evalFn(`export function selfName() { const f = function g() { return typeof g; }; return f(); }`, "selfName"),
    ).toMatchObject({ ok: true, value: "function" });
  });

  it("递归经自身名可用（此前 ReferenceError）", () => {
    expect(
      evalFn(`export function rec() { const f = function g(n) { return n <= 1 ? 1 : n * g(n - 1); }; return f(5); }`, "rec"),
    ).toMatchObject({ ok: true, value: 120 });
  });

  it("g === f（自身名与外层绑定同值）", () => {
    expect(
      evalFn(`export function selfEq() { const f = function g() { return g; }; return f() === f; }`, "selfEq"),
    ).toMatchObject({ ok: true, value: true });
  });
});

describe("Bug 14：静态方法内 super", () => {
  it("super.m() 派发到父类静态方法（此前哨兵注释 → 整模块 SyntaxError）", () => {
    expect(
      evalFn(
        `export function f() { class A { static m() { return 1; } } class B extends A { static m() { return super.m() + 1; } } return B.m(); }`,
        "f",
      ),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("super.p 读父类静态字段", () => {
    expect(
      evalFn(
        `export function f2() { class A { static p = 2; } class B extends A { static m() { return super.p; } } return B.m(); }`,
        "f2",
      ),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("产物无 super 哨兵注释逸出", () => {
    const js = transpileSource(
      `export function f() { class A { static m() { return 1; } static p = 2; } class B extends A { static m() { return super.m() + super.p; } } return B.m(); }`,
    );
    expect(js).not.toContain("/* super */");
  });
});

describe("Bug 19：对象字面量方法内 super", () => {
  it("Object.setPrototypeOf 形式：super.m() 沿原型链派发", () => {
    expect(
      evalFn(
        `export function f() { const base = { m() { return 1; } }; const o = { m() { return super.m() + 1; } }; Object.setPrototypeOf(o, base); return o.m(); }`,
        "f",
      ),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("__proto__ 字面量形式：super.m() 派发", () => {
    expect(
      evalFn(
        `export function f2() { const base = { m() { return 1; } }; const o = { __proto__: base, m() { return super.m() + 1; } }; return o.m(); }`,
        "f2",
      ),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("__proto__ + 访问器：super.v 属性读", () => {
    expect(
      evalFn(
        `export function f3() { const base = { get v() { return 5; } }; const o = { __proto__: base, get w() { return super.v + 1; } }; return o.w; }`,
        "f3",
      ),
    ).toMatchObject({ ok: true, value: 6 });
  });

  it("计算键 super[k]()：类实例 / 对象字面量两路都不再逸出哨兵", () => {
    expect(
      evalFn(
        `export function f4() { class A { m() { return 1; } } class B extends A { m() { const k = "m"; return super[k]() + 1; } } return new B().m(); }`,
        "f4",
      ),
    ).toMatchObject({ ok: true, value: 2 });
    expect(
      evalFn(
        `export function f5() { const base = { m() { return 1; } }; const o = { __proto__: base, m() { const k = "m"; return super[k]() + 1; } }; return o.m(); }`,
        "f5",
      ),
    ).toMatchObject({ ok: true, value: 2 });
  });
});

describe("Bug 15：同作用域解构临时名唯一化", () => {
  it("同行两条解构（此前 _d0_1 重复 const → 整模块 SyntaxError）", () => {
    expect(
      evalFn(`export function twoDestructure() { const {a = 1} = {}; const {b = 2} = {}; return a + b; }`, "twoDestructure"),
    ).toMatchObject({ ok: true, value: 3 });
  });

  it("if 块内同行两条解构", () => {
    expect(
      evalFn(`export function ifBlock() { if (true) { const {a = 1} = {}; const {b = 2} = {}; return a + b; } return -1; }`, "ifBlock"),
    ).toMatchObject({ ok: true, value: 3 });
  });

  it("prologue 与函数体的嵌套解构临时名（_n）不撞车", () => {
    expect(
      evalFn(`export function f({a:{b}}) { const {c:{d}} = {c:{d:1}}; return b + d; }`, "f", [
        $obj({ a: $obj({ b: $lit(1) }) }),
      ]),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("产物中 _d 临时名跨语句单调不重复", () => {
    const js = transpileSource(
      `const {a = 1} = {}; const {b = 2} = {}; const {c = 3} = {};`,
    );
    const names = [...js.matchAll(/const (_d\d+) =/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(3);
  });
});

describe("Bug 21：var 函数作用域提升", () => {
  it("块内 var 块外可读（此前臂 thunk 内 let → ReferenceError）", () => {
    expect(
      evalFn(`export function varIf() { if (true) { var w = 5; } return w; }`, "varIf"),
    ).toMatchObject({ ok: true, value: 5 });
  });

  it("跨块写共享绑定（此前静默错值 1）", () => {
    expect(
      evalFn(`export function varBlockWrite() { var x = 1; if (true) { var x = 2; } return x; }`, "varBlockWrite"),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("while 体内 var 块外可读", () => {
    expect(
      evalFn(
        `export function varWhile() { var s = 0; var i = 0; while (i < 3) { var t = i * 2; s += t; i++; } return s + t; }`,
        "varWhile",
      ),
    ).toMatchObject({ ok: true, value: 10 });
  });

  it("重声明 var a=1; var a=2（此前重复 let → 整模块 SyntaxError）", () => {
    expect(
      evalFn(`export function varRedecl() { var a = 1; var a = 2; return a; }`, "varRedecl"),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("for (var i…) fallback 路径不回归", () => {
    expect(
      evalFn(`export function varFor() { var c = 0; for (var i = 0; i < 3; i++) { c += i; } return c; }`, "varFor"),
    ).toMatchObject({ ok: true, value: 3 });
  });

  it("块内 var 解构（赋值模式写提升绑定）", () => {
    expect(
      evalFn(`export function varDestr() { if (true) { var {a} = {a: 7}; } return a; }`, "varDestr"),
    ).toMatchObject({ ok: true, value: 7 });
  });

  it('裸 var x; 块外 typeof 折 "undefined"', () => {
    expect(
      evalFn(`export function varBare() { if (false) { var z; } return typeof z; }`, "varBare"),
    ).toMatchObject({ ok: true, value: "undefined" });
  });

  it("参数名遮蔽：块内 var a=2 写参数绑定（原生语义）", () => {
    expect(
      evalFn(`export function varParam(a) { if (a) { var a = 2; } return a; }`, "varParam", [$lit(true)]),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("var 与顶层函数声明同名共存（var 写函数绑定）", () => {
    expect(
      evalFn(
        `export function varFn() { var g = 1; if (true) { var g = 2; } function g() {} return g; }`,
        "varFn",
      ),
    ).toMatchObject({ ok: true, value: 2 });
  });

  it("switch 臂内 var 提升后块外可读", () => {
    const r = evalFn(
      `export function varSwitch(k) { switch (k) { case 1: var sv = 9; } return sv; }`,
      "varSwitch",
      [$lit(1)],
    );
    expect(r.desc).toContain("9");
  });

  it("嵌套函数边界：内层 var 不穿越（外层 typeof 折 undefined——原生语义）", () => {
    expect(
      evalFn(
        `export function varNested() { const g = () => { var inner = 5; return inner; }; g(); return typeof inner; }`,
        "varNested",
      ),
    ).toMatchObject({ ok: true, value: "undefined" });
  });
});
