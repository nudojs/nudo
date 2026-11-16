/**
 * 模块套件：exec/transpile 运行时面（类/代理/迭代/构造/作用域）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError, val, effects } from "../../__tests__/eval-helpers.ts";
import { litValue, anyAbs } from "../../abs.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { formatAbs } from "../../format/format.ts";

// ---------------------------------------------------------------------------
// 类值接收者的派发先查静态面
// ---------------------------------------------------------------------------
describe("类值接收者的派发先查静态面", () => {
/**
 * 类值接收者（`A.m()`）的方法派发**先查实例方法表** ⇒ 跑错方法
 * 体、抛错方向**双向反转** ⇒ L2 门禁既**假绿**又**假红**。
 *
 * 原生：类值是构造器函数，`A.m` 沿构造器 [[Prototype]] 链解析（= 静态方法
 * 面）；**实例方法面不在其链上**（实例方法挂 A.prototype）⇒
 * - 同名 static + 实例方法并存 ⇒ `A.m()` 跑**静态**体；
 * - 类值上无该静态成员 ⇒ `A.m is not a function` **定抛 TypeError**。
 *
 * 引擎此前：先查实例方法表 ⇒ `A.m()` 跑实例体（"I"）；类值上无静态成员时
 * 也跑实例体（不抛）。
 *
 * 钉：改前 engine="I" / native="S"（MISMATCH）；类值上无静态成员时
 * engine="I" / native=THROW（MISMATCH）。
 */





function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

function expectTypeError(src: string) {
  const rec = call(src, "f");
  expect(isNever(rec.result)).toBe(true);
  expect(throwsError(rec.throws, "TypeError")).toBe(true);
}

describe("类值接收者的派发先查静态面", () => {
  it("同名 static + 实例方法并存 ⇒ A.m() 跑静态体（native \"S\"）；类值上无该静态成员 ⇒ 定抛 TypeError（native: A.m is not a function）；control：实例接收者仍跑实例体（native \"I\"）；control：只有静态方法 ⇒ A.m() 跑静态体（native \"S\"）；control：静态方法沿构造器继承链（B extends A ⇒ B.m() → \"S\"）；差分对账（native oracle）：改前", () => {
(() => {

    expectLit(
      `export function f() { class A1035a { m(){ return "I"; } static m(){ return "S"; } } return A1035a.m(); }`,
      "S",
    );
  })();
(() => {

    expectTypeError(
      `export function f() { class A1035d { m(){ return "I"; } } return A1035d.m(); }`,
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1035b { m(){ return "I"; } } return new A1035b().m(); }`,
      "I",
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1035c { static m(){ return "S"; } } return A1035c.m(); }`,
      "S",
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1035f { static m(){ return "S"; } } class B1035f extends A1035f { } return B1035f.m(); }`,
      "S",
    );
  })();
(() => {

    expect(
      diffBody(
        `class A1035a { m(){ return "I"; } static m(){ return "S"; } } return A1035a.m();`,
      ),
    ).toBeNull();
    expect(diffBody(`class A1035d { m(){ return "I"; } } return A1035d.m();`)).toBeNull();
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 摘下的一等方法值按来源侧定方法体
// ---------------------------------------------------------------------------
describe("摘下的一等方法值按来源侧定方法体", () => {
/**
 * 「摘下的一等方法值」（`const f = A.m`）在**同名 static + 实例
 * 方法并存**时定抛 TypeError ⇒ 原生**正常返回**的调用被判「必抛」。
 *
 * 原生：`A.m` 取到的是**构造器上的静态方法**，`a.m` 取到的是**原型上的
 * 实例方法**——两个不同函数对象 ⇒ 摘下调用各跑各自的方法体（接收者恒
 * undefined，但方法体是确定的）。
 *
 * 引擎此前：方法值的派发按 (home, name) 反查注册表 ⇒ 同名并存时**不可判**
 * ⇒ 一律「取不到方法」⇒ 假抛 TypeError（FALSE-THROW）。
 *
 * 修法：方法值的**来源侧**（static / inst）随值传到派发面
 * （member.ts 的 classMethodValueAbs → protoMethodDispatch 的 origin 参数）
 * ⇒ 摘下调用不再「不可判」。
 *
 * 钉：改前 engine=never（throws=TypeError）/ native="S"（FALSE-THROW）。
 */





function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

describe("摘下的一等方法值按来源侧定方法体", () => {
  it("const g = A.m（静态侧）⇒ g() 跑静态体（native \"S\"）；const g = new A().m（实例侧）⇒ g() 跑实例体（native \"I\"）；借用调用：g.call(A) ⇒ 跑静态体（native \"S\"）；control：只有静态方法 ⇒ 摘下调用跑静态体（native \"S\"）；control：只有实例方法 ⇒ 摘下调用跑实例体（native \"I\"）；差分对账（native oracle）：改前 FALSE-THROW / 改后一致", () => {
(() => {

    expectLit(
      `export function f() { class A1041a { m(){ return "I"; } static m(){ return "S"; } } const g = A1041a.m; return g(); }`,
      "S",
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1041b { m(){ return "I"; } static m(){ return "S"; } } const g = new A1041b().m; return g(); }`,
      "I",
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1041e { m(){ return "I"; } static m(){ return "S"; } } const g = A1041e.m; return g.call(A1041e); }`,
      "S",
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1041c { static m(){ return "S"; } } const g = A1041c.m; return g(); }`,
      "S",
    );
  })();
(() => {

    expectLit(
      `export function f() { class A1041d { m(){ return "I"; } } const g = new A1041d().m; return g(); }`,
      "I",
    );
  })();
(() => {

    expect(
      diffBody(
        `class A1041a { m(){ return "I"; } static m(){ return "S"; } } const g = A1041a.m; return g();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A1041b { m(){ return "I"; } static m(){ return "S"; } } const g = new A1041b().m; return g();`,
      ),
    ).toBeNull();
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// charAt/charCodeAt/codePointAt/at take no second argument
// ---------------------------------------------------------------------------
describe("charAt/charCodeAt/codePointAt/at take no second argument", () => {
/**
 * `String.prototype.charAt` / `charCodeAt` / `codePointAt` /
 * `at` **没有第二实参**（元数均为 1）。
 *
 * 根因：`algebra/methods.ts` 的字符串方法表把 7 个**元数不同**的方法塞进
 * 同一 case 分支，且该分支**无条件**校验 `args[1]`：
 * `validateIndexArg(args[1], "end")` ⇒ `"abc".charAt(0, 1n)` 凭空判「必抛
 * TypeError」（原生正常返回 "a"）⇒ throws 域折 never ⇒ **L2 门禁假红**。
 *
 * 修法：按各方法**真实元数**分流校验——`slice` / `substring` / `substr`
 * 校验第二实参；`charAt` / `charCodeAt` / `codePointAt` / `at` **只校验
 * `args[0]`**（多余实参按原生丢弃）。
 */




describe("charAt/charCodeAt/codePointAt/at take no second argument", () => {
  it("charAt(0, 1n) → \"a\"（此前判「必抛 TypeError」）；charCodeAt(0, 1n) → 97；codePointAt(0, 1n) → 97；at(0, 1n) → \"a\"；对照组：真有两实参的方法仍校验第二实参（slice / substring / substr）；对照组：单参调用仍正常折叠", () => {
(() => {

    const r = call(`export function f() { return "abc".charAt(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".charCodeAt(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 97 });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".codePointAt(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 97 });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".at(0, 1n); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  })();
(() => {

    for (const m of ["slice", "substring", "substr"]) {
      const r = call(`export function f() { return "abc".${m}(0, 1n); }`);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  })();
(() => {

    const r = call(`export function f() { return "abc".charAt(0); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 跨模块同名类按值身份解析（不是裸名 last-wins）
// ---------------------------------------------------------------------------
describe("跨模块同名类按值身份解析（不是裸名 last-wins）", () => {
/**
 * 跨模块同名用户类 ⇒ 类注册表**裸名键**静默 clobber。
 *
 * 夹具（与 tmp/bug-report/sections/.md 的 repro 同构）：
 * - a.js 定义 `class Config { this.a = 1 }` + `kind() { return "A" }`
 * - b.js 定义 `class Config { this.b = 2 }` + `kind() { return "B" }`
 * - d2.js 同时 import 两个模块，各自 `new Config()` 后读成员
 *
 * 修前（注册表裸名 last-wins）：
 * - `mkA()` 的构造体解析到 **B 的 spec** ⇒ `this.b = 2` 落地、`this.a` 从未
 * 初始化 ⇒ `mkA().a` 判 `undefined`（真成员被判不存在）、`mkA().b` 判 `2`
 * （不存在的成员被判有值）；
 * - 方法查表同样按裸名 ⇒ `mkA().kind()` 判 `"B"`（读成 B 模块的方法体）。
 *
 * 修后：类规格**随值携带**（class-registry.ts 的 attachClassSpec /
 * classSpecOfAbs；副本经 carryClassSpec 过户），构造分派与成员链首环用
 * 值自己的规格 ⇒ 两个模块的 `Config` 是不同的类。
 */





const MOD_A = `
export class Config {
  constructor() { this.a = 1; }
  kind() { return "A"; }
}
export function mkA() { return new Config(); }
`;

const MOD_B = `
export class Config {
  constructor() { this.b = 2; }
  kind() { return "B"; }
}
export function mkB() { return new Config(); }
`;

const MOD_D = `
import { mkA } from "./a.js";
import { mkB } from "./b.js";
export function readA() { const x = mkA(); return x.a; }
export function readB() { const x = mkB(); return x.b; }
export function absentA() { const x = mkA(); return x.b; }
export function absentB() { const x = mkB(); return x.a; }
export function kindA() { return mkA().kind(); }
export function kindB() { return mkB().kind(); }
`;

/** 两个模块各注册一份 `Config`，第三模块同时 import 二者后读成员。 */
function runGraph(): Record<string, unknown> {
  const a = runTranspiled(MOD_A, { mode: "analyze" });
  const b = runTranspiled(MOD_B, { mode: "analyze" });
  return runTranspiled(MOD_D, {
    mode: "analyze",
    modules: { "./a.js": a, "./b.js": b },
  });
}

/** 调导出函数并取字面量值（非字面量 ⇒ 抛：测试要的是**精确**判定）。 */
function lit(exports: Record<string, unknown>, fn: string): unknown {
  const r = callTranspiledExportFull(exports, fn, []);
  const v = litValue(r.result);
  if (!v.ok) {
    throw new Error(`expected literal result for ${fn}, got conf=${r.result.conf}`);
  }
  return v.value;
}

describe("跨模块同名类按值身份解析（不是裸名 last-wins）", () => {
  it("A 模块实例的构造体与自有字段不被 B 模块的同名类顶掉；B 模块实例保持自己的字段（对照：不是把两边都改坏）；A 模块实例上不存在的成员判 undefined（不读到 B 的槽）；B 模块实例上不存在的成员判 undefined（不读到 A 的槽）；实例方法链首环用值自己的规格：mkA().kind() 恒为 A 的方法体", () => {
(() => {

    const d = runGraph();
    expect(lit(d, "readA")).toBe(1);
  })();
(() => {

    const d = runGraph();
    expect(lit(d, "readB")).toBe(2);
  })();
(() => {

    const d = runGraph();
    expect(lit(d, "absentA")).toBe(undefined);
  })();
(() => {

    const d = runGraph();
    expect(lit(d, "absentB")).toBe(undefined);
  })();
(() => {

    const d = runGraph();
    expect(lit(d, "kindA")).toBe("A");
    expect(lit(d, "kindB")).toBe("B");
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 无界用户迭代器的代表元不得取首个具体元素
// ---------------------------------------------------------------------------
describe("无界用户迭代器的代表元不得取首个具体元素", () => {
/**
 * 无界（next() 永不报 done）用户迭代器的 for-of 代表元必须是
 * **元素域**（已采集元素 join / unknown），不得取首个具体元素去**决定**分支。
 *
 * 修前：`$forOf` 的 unbounded 单代表迭代取 `items[Math.min(i, items.length - 1)]`
 * ＝**首元素**；`for (const x of o) { if (x > 0) break }` 的首元素 `0` 把条件
 * 决定性判假 ⇒ then 臂（连同其 IteratorClose `return()`）根本没被求值 ⇒
 * 引擎印 `"NOT" #exact`，宿主是 `"CLOSED"`（引擎结论与宿主相反 + 必发副作用
 * 被吞）。
 * 修后：代表元 = 整个未知元素域（采集触顶 / 条目过多折 unknown）⇒ 条件两侧
 * 都探索 ⇒ break 臂可达，`return()` 对出口绑定的写不再丢失。
 */





const probe = (src: string) => call(src, "probe", []);

describe("无界用户迭代器的代表元不得取首个具体元素", () => {
  it("a) 无界迭代器：break 臂可达 ⇒ IteratorClose 的 return() 计入出口（宿主同结论）；b) 有界迭代器（报 done）仍逐元素精确展开：break 关闭 ⇒ CLOSED，自然耗尽 ⇒ 不关闭 ⇒ NOT；b2) 有界迭代仍精确：0+1+2 折 3 #exact（不得因代表元抽象而宽化）；c) 循环变量 = 元素域抽象（不折首元素 0）——修前 `return x` 折 0 #exact；c2) 代表元抽象后分支两侧都探索——修前 out 折 \"", () => {
(() => {

    // 原始复现器（宿主 returns CLOSED；修前引擎 "NOT" #exact）
    const r = probe(`export function probe() {
  let closed = false;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return { value: i++, done: false }; },
        return() { closed = true; return {}; },
      };
    },
  };
  for (const x of o) {
    if (x > 0) break;
  }
  return closed ? "CLOSED" : "NOT";
}`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "CLOSED" });
  })();
(() => {

    const withBreak = probe(`export function probe() {
  let closed = false;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
        return() { closed = true; return {}; },
      };
    },
  };
  for (const x of o) {
    if (x > 0) break;
  }
  return closed ? "CLOSED" : "NOT";
}`);
    expect(litValue(withBreak.result)).toEqual({ ok: true, value: "CLOSED" });

    const exhausted = probe(`export function probe() {
  let closed = false;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
        return() { closed = true; return {}; },
      };
    },
  };
  for (const x of o) { }
  return closed ? "CLOSED" : "NOT";
}`);
    expect(litValue(exhausted.result)).toEqual({ ok: true, value: "NOT" });
  })();
(() => {

    const r = probe(`export function probe() {
  let acc = 0;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
      };
    },
  };
  for (const x of o) { acc += x; }
  return acc;
}`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    expect(formatAbs(r.result)).toContain("#exact");
  })();
(() => {

    const r = probe(`export function probe() {
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return { next() { return { value: i++, done: false }; } };
    },
  };
  for (const x of o) { return x; }
  return -1;
}`);
    expect(r.result.shape.k).toBe("unknown");
    expect(litValue(r.result)).not.toEqual({ ok: true, value: 0 });
  })();
(() => {

    const r = probe(`export function probe() {
  let out = "miss";
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return { value: i++, done: false }; },
        return() { return {}; },
      };
    },
  };
  for (const x of o) {
    if (x > 0) { out = "hit"; break; }
  }
  return out;
}`);
    // 修前：首元素 0 ⇒ 条件判假 ⇒ then 臂（out = "hit"）根本不进 ⇒ "miss" #exact
    expect(litValue(r.result)).not.toEqual({ ok: true, value: "miss" });
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 原型 / 实例上的方法写参与派发（monkey-patch 生效）
// ---------------------------------------------------------------------------
describe("原型 / 实例上的方法写参与派发（monkey-patch 生效）", () => {
/**
 * 原型 / 实例上的方法**写**（monkey-patch）被派发面忽略。
 *
 * 原生属性查找序 own → prototype：`A.prototype.m = fn`（写原型对象的自有
 * 属性）、`a.m = fn` / `this.m = fn`（写实例的自有属性）都**遮住**类注册表
 * 里的方法体 ⇒ `new A().m()` 跑的是用户写的函数。
 *
 * 引擎此前：写侧（$set / this 成员写 / defineProperty）把值落进 brand 内层 obj
 * 槽面（读面 chainProtoSlotOf 看得见），但**派发面只查注册表** ⇒ monkey-patch
 * 全部静默失效（跑的还是旧方法体）；写成非函数时也**不抛** TypeError。
 *
 * 钉：改前 engine=1 / native=2、3、5、4（全部 MISMATCH）+ 非函数写不抛。
 */





/** 断言结果折成具体字面量并值相等 */
function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

/** 断言调用定抛 TypeError（结果 never + throws 面是 TypeError） */
function expectTypeError(src: string) {
  const rec = call(src, "f");
  expect(isNever(rec.result)).toBe(true);
  expect(throwsError(rec.throws, "TypeError")).toBe(true);
}

describe("原型 / 实例上的方法写参与派发（monkey-patch 生效）", () => {
  it("A.prototype.m = fn ⇒ new A().m() 跑用户函数（native 2）；a.m = fn ⇒ a.m() 跑用户函数（native 5）；ctor 内 this.m = fn ⇒ new A().m() 跑用户函数（native 3）；A.prototype.m = 5 ⇒ 调用定抛 TypeError（native: not a function）；Object.defineProperty(A.prototype,'m',{value:fn}) ", () => {
(() => {

    expectLit(
      `export function f() { class A244a { m(){ return 1; } } A244a.prototype.m = function(){ return 2; }; return new A244a().m(); }`,
      2,
    );
  })();
(() => {

    expectLit(
      `export function f() { class A244b { m(){ return 1; } } const a = new A244b(); a.m = function(){ return 5; }; return a.m(); }`,
      5,
    );
  })();
(() => {

    expectLit(
      `export function f() { class A244c { constructor(){ this.m = function(){ return 3; }; } m(){ return 1; } } return new A244c().m(); }`,
      3,
    );
  })();
(() => {

    expectTypeError(
      `export function f() { class A244d { m(){ return 1; } } A244d.prototype.m = 5; return new A244d().m(); }`,
    );
  })();
(() => {

    expectLit(
      `export function f() { class A244e { m(){ return 1; } } Object.defineProperty(A244e.prototype, "m", { value: function(){ return 4; } }); return new A244e().m(); }`,
      4,
    );
  })();
(() => {

    expectLit(
      `export function f() { class A244h { m(){ return 1; } } const a = new A244h(); a.m = function(){ return 6; }; A244h.prototype.m = function(){ return 2; }; return a.m(); }`,
      6,
    );
  })();
(() => {

    expectLit(`export function f() { class A244f { m(){ return 1; } } return new A244f().m(); }`, 1);
  })();
(() => {

    expectLit(
      `export function f() { class A244g { } A244g.prototype.n = function(){ return 7; }; return new A244g().n(); }`,
      7,
    );
  })();
(() => {

    expect(
      diffBody(
        `class A244d1 { m(){ return 1; } } A244d1.prototype.m = function(){ return 2; }; return new A244d1().m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d2 { m(){ return 1; } } const a = new A244d2(); a.m = function(){ return 5; }; return a.m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d3 { constructor(){ this.m = function(){ return 3; }; } m(){ return 1; } } return new A244d3().m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d4 { m(){ return 1; } } A244d4.prototype.m = 5; return new A244d4().m();`,
      ),
    ).toBeNull();
    expect(
      diffBody(
        `class A244d5 { m(){ return 1; } } Object.defineProperty(A244d5.prototype, "m", { value: function(){ return 4; } }); return new A244d5().m();`,
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
});
});

// ---------------------------------------------------------------------------
// 派生构造器的 super() 通道
// ---------------------------------------------------------------------------
describe("派生构造器的 super() 通道", () => {
/**
 * 派生类构造器**未调 super()** / **重复调 super()** ⇒ ReferenceError。
 *
 * 原生（node 实测）：
 * - `class B extends A { constructor(){ this.x = 1; } }` → `new B()` 抛
 * ReferenceError（"Must call super constructor in derived class before
 * accessing 'this' or returning from derived constructor"）。
 * - `class B extends A { constructor(){ super(); super(); } }` → `new B()` 抛
 * ReferenceError（"Super constructor may only be called once"）。
 * - 基类构造器 / 隐式派生构造器（无显式 ctor）⇒ 不抛。
 *
 * 引擎此前无「本帧已调 super」状态通道 ⇒ 不调 super 的派生构造器静默构造
 * 成功（假绿），重复调 super 也静默通过。
 */



describe("派生构造器的 super() 通道", () => {
  it("派生构造器不调 super()：new B() 定抛 ReferenceError；派生构造器重复调 super()：第二次定抛 ReferenceError；正常 super() 路径不受影响（值仍精确）；基类构造器不受影响（无 super 需求）；隐式派生构造器（无显式 ctor）不受影响；多层派生链：内层 super() 不得被误判成外层「已调」（各层各记各的）", () => {
(() => {

    const r = call(
      `class A { constructor(){ this.x = 1; } }
       class B extends A { constructor(){ this.y = 2; } }
       export function f(){ return new B().x; }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "ReferenceError")).toBe(true);
  })();
(() => {

    const r = call(
      `class A { constructor(){ this.x = 1; } }
       class B extends A { constructor(){ super(); super(); } }
       export function f(){ return new B().x; }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "ReferenceError")).toBe(true);
  })();
(() => {

    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         class B extends A { constructor(){ super(); this.y = 2; } }
         export function f(){ return new B().x; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  })();
(() => {

    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         export function f(){ return new A().x; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  })();
(() => {

    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         class B extends A { }
         export function f(){ return new B().x; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  })();
(() => {

    expect(
      val(
        `class A { constructor(){ this.x = 1; } }
         class B extends A { constructor(){ super(); this.b = 2; } }
         class C extends B { constructor(){ super(); this.c = 3; } }
         export function f(){ const o = new C(); return o.x + o.b + o.c; }`,
      ),
    ).toEqual({ ok: true, value: 6 });
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// (false positive): Object.assign into brand targets keeps source props
// ---------------------------------------------------------------------------
describe("(false positive): Object.assign into brand targets keeps source props", () => {
/**
 * **假阳性钉**（反向钉）：`Object.assign` 目标为 brand
 * （类实例 / 内建实例 / 函数构造实例）时**静默丢弃**源属性。
 *
 * 报告结论复核：brand 目标的合并分支**已在位**
 * （`exec/class/assign.ts` 的 `assignIntoBrandInner` —— 修入 e3b8791a），
 * 报告引用的「其余 continue 丢弃」代码不存在 ⇒ **不改实现**，只钉住
 * 「已修」的行为（本钉在 HEAD 只读副本上**必须通过**）。
 *
 * 残余（不在本钉范围，见 E6 报告「越界发现」）：**数组 / 元组**目标上的
 * 非索引键（expando）仍被丢弃——Abs 数组 shape 本身不存 expando 槽，
 * 属模型层限制，与 brand 分支不同源。
 */




describe("(false positive): Object.assign into brand targets keeps source props", () => {
  it("类实例目标：源属性不丢；类实例目标：自有键集合含源属性；Error 实例目标：源属性不丢；Date 实例目标：源属性不丢；Map 实例目标：源属性不丢；函数构造实例目标：源属性不丢", () => {
(() => {

    const r = call(
      `export function f() {
         class A { constructor() { this.a = 1; } }
         const x = Object.assign(new A(), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  })();
(() => {

    const r = call(
      `export function f() {
         class A { constructor() { this.a = 1; } }
         const x = Object.assign(new A(), { b: 2 });
         return Object.keys(x).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a,b" });
  })();
(() => {

    const r = call(
      `export function f() {
         const e = new Error("m");
         const x = Object.assign(e, { code: "EACCES" });
         return x.code;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "EACCES" });
  })();
(() => {

    const r = call(
      `export function f() {
         const x = Object.assign(new Date(0), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  })();
(() => {

    const r = call(
      `export function f() {
         const x = Object.assign(new Map(), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  })();
(() => {

    const r = call(
      `export function f() {
         function A() { this.a = 1; }
         const x = Object.assign(new A(), { b: 2 });
         return x.b;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 实例字段落地 = 自有数据属性（不派发原型 setter）
// ---------------------------------------------------------------------------
describe("实例字段落地 = 自有数据属性（不派发原型 setter）", () => {
/**
 * 实例字段落地必须是 **CreateDataPropertyOrThrow**（原生
 * DefineField）——在接收者上**创建自有数据属性**，**不沿原型链派发
 * setter**。
 *
 * 原生（node 实测）：
 * - `class A { get x(){ return 1; } } class B extends A { x = 2; }`
 * → `new B().x === 2`（字段是 B 实例的自有数据属性，父类 getter 不参与）。
 * - 父类 setter-only：字段落地**不**调父类 setter（`b._v` 仍是 undefined）。
 * - `Object.keys(new B())` → ["x"]（字段是自有可枚举属性）。
 *
 * 引擎此前走 `$set` = `[[Set]]` ⇒ 父类同名访问器拦截字段落地：getter-only
 * 时**假抛 TypeError**，setter-only 时把字段写穿到父类 setter（错值）。
 */



describe("实例字段落地 = 自有数据属性（不派发原型 setter）", () => {
  it("父类 getter-only 同名访问器不拦截子类字段落地；父类 setter-only：字段落地不调父类 setter（父类侧槽保持缺席）；父类 getter+setter 同款：字段落地仍不派发父类访问器；字段是自有可枚举属性（Object.keys 可见）；无访问器干扰的普通字段路径不受影响", () => {
(() => {

    const r = call(
      `class A { get x(){ return 1; } }
       class B extends A { x = 2; }
       export function f(){ return new B().x; }`,
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(val(
      `class A { get x(){ return 1; } }
       class B extends A { x = 2; }
       export function f(){ return new B().x; }`,
    )).toEqual({ ok: true, value: 2 });
  })();
(() => {

    expect(
      val(
        `class A { set x(v){ this._v = v * 10; } }
         class B extends A { x = 4; }
         export function f(){ const b = new B(); return b.x + "|" + b._v; }`,
      ),
    ).toEqual({ ok: true, value: "4|undefined" });
  })();
(() => {

    expect(
      val(
        `class A { get x(){ return 1; } set x(v){ this._v = v*10; } }
         class B extends A { x = 2; }
         export function f(){ const b = new B(); return b.x + "|" + b._v; }`,
      ),
    ).toEqual({ ok: true, value: "2|undefined" });
  })();
(() => {

    expect(
      val(
        `class A { get x(){ return 1; } }
         class B extends A { x = 2; }
         export function f(){ return Object.keys(new B()).join(","); }`,
      ),
    ).toEqual({ ok: true, value: "x" });
  })();
(() => {

    expect(
      val(
        `class A { x = 1; }
         class B extends A { x = 2; }
         export function f(){ return new B().x; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// matchAll result exposes the iterator protocol face
// ---------------------------------------------------------------------------
describe("matchAll result exposes the iterator protocol face", () => {
/**
 * `String.prototype.matchAll` 的结果必须**是迭代器**。
 *
 * 原生 `matchAll` 返回 **RegExp String Iterator**：
 * - `typeof it.next` → "function"（此前折 exact **"undefined"**——wrong-exact）
 * - `typeof it[Symbol.iterator]` → "function"（协议面缺失）
 * - `it.next()` → `{value: <匹配项 RegExpExecArray>, done: false}`；
 * 逐次推进同一游标（第二次 → 第二项）；耗尽 → `{value: undefined, done: true}`
 * - `Object.prototype.toString.call(it)` → "[object RegExp String Iterator]"
 *
 * 根因：`exec/class-regex.ts` 的 `stringRegexMethod` matchAll 尾段只挂了
 * brand 名 + **元素侧表**（`exec/match-iter.ts`）⇒ 协议面全缺。展开 / for-of
 * 之所以仍对，是因为它们**读侧表**，与迭代器协议本身无关。
 *
 * 修法：`class-regex.ts` 的 `matchIteratorAbs` 给 brand 建协议面（内层 obj
 * 的 internal 槽：next / @@iterator / @@toStringTag；游标走闭包，元素面仍
 * 挂 match-iter.ts 侧表——两侧同源）。
 */




describe("matchAll result exposes the iterator protocol face", () => {
  it("typeof it.next → \"function\"（原生协议面；此前 \"undefined\"）；typeof it[Symbol.iterator] → \"function\"；it.next().value[0] → 首个匹配项；it.next() 逐次推进同一游标（第二次 → 第二项）；耗尽后 done → true、value → undefined；Object.prototype.toString.call(it) → \"[object RegExp String", () => {
(() => {

    const r = call(`export function f() {
      const it = "a1b2".matchAll(/\\d/g);
      return typeof it.next;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  })();
(() => {

    const r = call(`export function f() {
      const it = "a1b2".matchAll(/\\d/g);
      return typeof it[Symbol.iterator];
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  })();
(() => {

    const r = call(`export function f() {
      return "a1b2".matchAll(/\\d/g).next().value[0];
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
  })();
(() => {

    const r = call(`export function f() {
      const it = "a1b2".matchAll(/\\d/g);
      it.next();
      return it.next().value[0];
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "2" });
  })();
(() => {

    const r = call(`export function f() {
      const it = "a".matchAll(/a/g);
      it.next();
      return it.next().done;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    const r2 = call(`export function f() {
      const it = "a".matchAll(/a/g);
      it.next();
      return String(it.next().value);
    }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: "undefined" });
  })();
(() => {

    const r = call(`export function f() {
      return Object.prototype.toString.call("a1b2".matchAll(/\\d/g));
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "[object RegExp String Iterator]" });
  })();
(() => {

    const r = call(`export function f() {
      const it = "ab".matchAll(/a/g);
      return Object.keys(it).length;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
    const r2 = call(`export function f() {
      const it = "ab".matchAll(/a/g);
      return it.hasOwnProperty("next");
    }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: false });
    const r3 = call(`export function f() {
      const it = "ab".matchAll(/a/g);
      return "next" in it;
    }`);
    expect(litValue(r3.result)).toEqual({ ok: true, value: true });
  })();
(() => {

    const r = call(`export function f() {
      return [..."a1b2".matchAll(/\\d/g)].length;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    const r2 = call(`export function f() {
      let n = 0;
      for (const m of "a1b2".matchAll(/\\d/g)) n++;
      return n;
    }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 构造器返回值是对象就用它（不窄化成 brand|obj）
// ---------------------------------------------------------------------------
describe("构造器返回值是对象就用它（不窄化成 brand|obj）", () => {
/**
 * 原生 [[Construct]] 的返回值判定——「返回值**是 Object** 就用它」。
 *
 * 原生（node 实测）：
 * - `function F(){ this.a=1; return [1,2]; }` → `new F()` 是**数组**
 * （`Array.isArray` true、`JSON.stringify` → "[1,2]"），且
 * `new F() instanceof F` **false**（原型取 newTarget，构造器返回对象
 * 替换 this）。
 * - 构造器返回**函数** → `typeof new F()` === "function"。
 * - 构造器返回**原始值** → 忽略，返回 this（`typeof` 仍是 "object"）。
 *
 * 引擎此前把「对象」窄化成 `brand|obj` 两个形态 ⇒ 数组 / 函数返回被静默
 * 换回 this（`Array.isArray` 假 false、`instanceof` 假 true）。
 */



describe("构造器返回值是对象就用它（不窄化成 brand|obj）", () => {
  it("宿主构造器返回数组：new F() 是数组；宿主构造器返回数组：内容可读（不是被换回的 this）；宿主构造器返回函数：typeof new F() === 'function'；宿主构造器返回箭头函数：typeof new F() === 'function'；宿主构造器返回原始值：忽略并返回 this（typeof 仍 'object'）；宿主构造器返回普通对象：仍用它（既有口径不退化）；类构造器返回数组：new C() 是数组（既有口径不退化）", () => {
(() => {

    expect(
      val(
        `export function f(){ function F(){ this.a=1; return [1,2]; } const x = new F(); return Array.isArray(x); }`,
      ),
    ).toEqual({ ok: true, value: true });
  })();
(() => {

    expect(
      val(
        `export function f(){ function F(){ this.a=1; return [1,2]; } const x = new F(); return JSON.stringify(x); }`,
      ),
    ).toEqual({ ok: true, value: "[1,2]" });
  })();
(() => {

    expect(
      val(
        `export function f(){ function F(){ return function inner(){ return 1; }; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "function" });
  })();
(() => {

    expect(
      val(
        `export function f(){ function F(){ return ()=>1; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "function" });
  })();
(() => {

    expect(
      val(
        `export function f(){ function F(){ return 5; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "object" });
  })();
(() => {

    expect(
      val(
        `export function f(){ function F(){ return {a:1}; } return typeof new F(); }`,
      ),
    ).toEqual({ ok: true, value: "object" });
  })();
(() => {

    expect(
      val(`export function f(){ class C { constructor(){ return [1,2]; } } return Array.isArray(new C()); }`),
    ).toEqual({ ok: true, value: true });
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// toLocaleString value (ICU) + locales argument validation
// ---------------------------------------------------------------------------
describe("toLocaleString value (ICU) + locales argument validation", () => {
/**
 * `toLocaleString` / `toLocale*` 家族的**值**与**locales 实参校验**。
 *
 * 两处根因（族 03 报告 + 实测）：
 * 1. `exec/class/invoke.ts` number 臂把 `toLocaleString` **重定向成宿主
 * `toString`** ⇒ 值错（丢千分位 / `-0` / 指数形态）：
 * `(1234567.5).toLocaleString()` 原生 "1,234,567.5"、引擎 "1234567.5"；
 * `(-0).toLocaleString()` 原生 "-0"、引擎 "0"；
 * `(1e21).toLocaleString()` 原生 "1,000,000,000,000,000,000,000"、
 * 引擎 "1e+21"。
 * 2. 三臂（number / bigint / 字符串 `toLocaleUpperCase|toLocaleLowerCase`）
 * **都不校验 locales 实参** ⇒ `null`（原生 TypeError）、非法 language
 * tag（原生 RangeError）全不抛 ⇒ throws 域折 never（假 no-throw）。
 *
 * 修法：number/bigint 臂改走**宿主 `toLocaleString`**（ICU）+ 透传 locales
 * 实参（宿主 `CanonicalizeLocaleList` 校验同款）；字符串 `toLocale*` 臂在
 * 入口校验档补 `validateLocalesArg`（null → TypeError、非法 tag →
 * RangeError；number/bool/bigint/symbol 实参原生被忽略）。
 *
 * 值断言一律用**显式 locale**（"en-US"）——默认 locale 随宿主环境变化
 * （本机实测 resolved locale = zh-CN），不可作确定性断言。
 */




describe("toLocaleString value (ICU) + locales argument validation", () => {
  it("Number.prototype.toLocaleString 保留千分位（此前折成 toString）；Number.prototype.toLocaleString 保留 -0 的符号；Number.prototype.toLocaleString 保留指数形态的分组展开；BigInt.prototype.toLocaleString 保留千分位；默认 locale 也不再折成 toString 的裸数字串；locales 为 null → 确定 TypeError（nu", () => {
(() => {

    const r = call(`export function f() { return (1234567.5).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,234,567.5" });
  })();
(() => {

    const r = call(`export function f() { return (-0).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "-0" });
  })();
(() => {

    const r = call(`export function f() { return (1e21).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,000,000,000,000,000,000,000" });
  })();
(() => {

    const r = call(`export function f() { return (1234567n).toLocaleString("en-US"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,234,567" });
  })();
(() => {

    const r = call(`export function f() { return (1234567.5).toLocaleString(); }`);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(lv.ok ? lv.value : undefined).not.toBe("1234567.5");
  })();
(() => {

    const r = call(`export function f() { return (1.5).toLocaleString(null); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return (1234567n).toLocaleString(null); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "ABC".toLocaleUpperCase(null); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "ABC".toLocaleUpperCase("b"); }`);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".toLocaleUpperCase(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ABC" });
    const r2 = call(`export function f() { return (1).toLocaleString(Symbol()); }`);
    expect(r2.throws === undefined || r2.throws.shape.k === "never").toBe(true);
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
});
});

// ---------------------------------------------------------------------------
// invalid string pattern is a definite SyntaxError
// ---------------------------------------------------------------------------
describe("invalid string pattern is a definite SyntaxError", () => {
/**
 * `String.prototype.search` / `match` 的**无效字符串模式**必须
 * 进 throws 面（确定 SyntaxError）。
 *
 * 根因：`exec/class-regex.ts` 的 `stringRegexMethod` 把模式编译失败
 * `catch { return undefined }` ——「编译失败」与「本臂不接管」混成同一
 * 哨兵 ⇒ 回落抽象臂（search → numPrim / match → matchResultDomain）
 * ⇒ **throws 域折 never**（假 no-throw，L2 门禁假绿）。
 *
 * 原生：`"abc".search("(")` / `.match("(")` / `.match("*")` 全部抛
 * **SyntaxError**（RegExpCreate 步 2：编译非法模式）。
 *
 * 修法：
 * - `class-regex.ts`：编译失败 → `throw new NudoThrow(errorTypeAbs("SyntaxError"))`
 * （模式在此恒为**字面量** ⇒ 编译结果运行时同款 ⇒ 定抛，可被 try/catch 吸收）。
 * - `algebra/methods.ts`：抽象接收者路径（`stringRegexMethod` 在其 sv 检查
 * 处提前 return，够不到编译点）补 `literalPatternString` +
 * `regexPatternCompiles` 判定 ⇒ 同样定抛。
 */




describe("invalid string pattern is a definite SyntaxError", () => {
  it("search(\"(\") → SyntaxError（此前 throws 域折 never）；match(\"(\") → SyntaxError；match(\"*\") → SyntaxError（非法量词）；matchAll(\"(\") → SyntaxError；抽象接收者路径同样进 throws 面；合法模式不受影响（对照组）；try/catch 可吸收（原生同款）", () => {
(() => {

    const r = call(`export function f() { return "abc".search("("); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".match("("); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".match("*"); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return [..."abc".matchAll("(")].length; }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return String("abc").search("("); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return "abc".search("b"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  })();
(() => {

    const r = call(`export function f() {
      try { return "abc".search("("); } catch (e) { return e.constructor.name; }
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "SyntaxError" });
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// bind 产物的构造语义
// ---------------------------------------------------------------------------
describe("bind 产物的构造语义", () => {
/**
 * `Function.prototype.bind` 产物**可构造**——原生
 * `new (f.bind(thisArg, ...bound))()` 走**绑定目标的 [[Construct]]**：
 * 以 newTarget.prototype 建新实例、绑定实参前置、`this` = 新实例
 * （**忽略**绑定的 thisArg）。
 *
 * 原生（node 实测）：
 * - `function F(a){ this.a = a; } const B = F.bind(null, 7); new B().a === 7`
 * - `class A { constructor(v){ this.v = v; } } const B = A.bind(null, 3);
 * new B().v === 3`
 * - 二次 bind（`B.bind(null)`）仍可构造、`new C().a === 7`。
 *
 * 引擎此前 bind 产物只带 apply 钩子 ⇒ `$new` 复用 `impl.apply` ⇒ 目标
 * 构造器在 `this === boundThis`（null）上执行 ⇒ `new B()` 假抛 TypeError
 * （never）。构造 facet 走 declare.ts 的模块级 WeakMap 侧表（不改公共
 * 类型 AbsFnImpl）。
 */



describe("bind 产物的构造语义", () => {
  it("宿主函数 bind 产物：new B() 的 this = 新实例（绑定实参前置）；类值 bind 产物：new B() 造的是目标类的实例；二次 bind 产物仍可构造（绑定实参逐层前置）；普通调用面不受影响（B(9) 走绑定 thisArg——原生同口径抛 TypeError）", () => {
(() => {

    const r = call(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); const o = new B(); return o.a; }`,
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(val(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); const o = new B(); return o.a; }`,
    )).toEqual({ ok: true, value: 7 });
  })();
(() => {

    expect(val(
      `export function f(){ class A { constructor(v){ this.v = v; } } const B = A.bind(null, 3); const o = new B(); return o.v; }`,
    )).toEqual({ ok: true, value: 3 });
  })();
(() => {

    expect(val(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); const C = B.bind(null); const o = new C(); return o.a; }`,
    )).toEqual({ ok: true, value: 7 });
  })();
(() => {

    // 原生 strict：this 为 null → `this.a = a` 抛 TypeError
    const r = call(
      `export function f(){ function F(a){ this.a = a; } const B = F.bind(null, 7); return B(9); }`,
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// Proxy construct 的靶可构造性判定
// ---------------------------------------------------------------------------
describe("Proxy construct 的靶可构造性判定", () => {
/**
 * `$new` 的 Proxy 分支必须先判 **IsConstructor(target)**。
 *
 * 原生（node 实测）：
 * - `new Proxy(() => 1, { construct(){ ... } })` → **TypeError**（"not a
 * constructor"），且**构造陷阱不派发**（陷阱副作用不发生）。
 * - `new Proxy({}, { construct(){ ... } })` → 同抛 TypeError。
 * - 靶**可构造**时（函数 / 类）⇒ 陷阱照常派发。
 *
 * 引擎此前**先查陷阱再派发**，无 IsConstructor 判定 ⇒ 靶非构造器时引擎
 * 照样派发 construct 陷阱（副作用发生、构造"成功"）⇒ 假绿 + 假值。
 */



describe("Proxy construct 的靶可构造性判定", () => {
  it("靶不可构造（箭头函数）：定抛 TypeError；靶不可构造（普通对象）：定抛 TypeError；靶不可构造：construct 陷阱**不派发**（副作用不发生）；靶可构造（函数表达式）：construct 陷阱照常派发", () => {
(() => {

    const r = call(
      `export function f(){ const t = () => 1; const p = new Proxy(t, { construct(){ return {a:9}; } }); return new p(); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(
      `export function f(){ const t = {}; const p = new Proxy(t, { construct(){ return {a:9}; } }); return new p(); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    expect(val(
      `export function f(){ let seen = 0; const t = () => 1; const p = new Proxy(t, { construct(){ seen = 1; return {a:9}; } }); try { new p(); } catch (e) {} return seen; }`,
    )).toEqual({ ok: true, value: 0 });
  })();
(() => {

    expect(val(
      `export function f(){ const t = function(){ this.a = 1; }; const p = new Proxy(t, { construct(){ return {a:9}; } }); return new p().a; }`,
    )).toEqual({ ok: true, value: 9 });
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// apply 的 array-like 实参按 length 展开
// ---------------------------------------------------------------------------
describe("apply 的 array-like 实参按 length 展开", () => {
/**
 * `Function.prototype.apply` 传 **array-like** 实参时只传进 1 个实参。
 *
 * 原生 `CreateListFromArrayLike`：ToLength(argArray.length) → 逐下标 Get ⇒
 * `f.apply(null, {length: 2, 0: 1, 1: 2})` 传 **2 个**实参。
 *
 * 引擎此前：array-like 实参（非 tuple / 非 arr）一律折 `[unknown]`（1 个未知
 * 实参）⇒ 实参面塌陷（`arguments.length` 折 1；`a + b` 折未知和）。
 *
 * 钉：改前 engine=1 / native=2（MISMATCH）。
 */





function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

describe("apply 的 array-like 实参按 length 展开", () => {
  it("apply({length:2,0:1,1:2}) ⇒ 2 个实参（native 2）；apply 的实参值参与运算（native 3）；apply({length:0}) ⇒ 0 个实参（native 0）；apply({length:1,0:9}) ⇒ 1 个实参（native 1）；control：apply 真数组 ⇒ 3 个实参（native 3）；差分对账（native oracle）：改前 MISMATCH / 改后一致", () => {
(() => {

    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, { length: 2, 0: 1, 1: 2 }); }`,
      2,
    );
  })();
(() => {

    expectLit(
      `export function f() { function g(a, b){ return a + b; } return g.apply(null, { length: 2, 0: 1, 1: 2 }); }`,
      3,
    );
  })();
(() => {

    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, { length: 0 }); }`,
      0,
    );
  })();
(() => {

    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, { length: 1, 0: 9 }); }`,
      1,
    );
  })();
(() => {

    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, [1, 2, 3]); }`,
      3,
    );
  })();
(() => {

    expect(
      diffBody(
        `function g(){ return arguments.length; } return g.apply(null, { length: 2, 0: 1, 1: 2 });`,
      ),
    ).toBeNull();
    expect(
      diffBody(`function g(a, b){ return a + b; } return g.apply(null, { length: 2, 0: 1, 1: 2 });`),
    ).toBeNull();
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// derived static field shadows inherited static method
// ---------------------------------------------------------------------------
describe("derived static field shadows inherited static method", () => {
/**
 * 派生类的 `static` 字段**不遮蔽**继承的 `static` 方法
 * → `B.m()` 调到父类方法（原生是 `TypeError: B.m is not a function`）。
 *
 * 根因：`findStaticMethod`（`exec/class/declare.ts`）只查类注册表
 * `spec.staticMethods` 并沿 `superName` 链走，**不看类值 own 槽**——静态
 * 字段 `static m = 2` 落在类值 own 槽里（原生 own 属性优先于
 * [[Prototype]] 链上的继承静态成员），于是被继承的静态方法遮蔽。
 *
 * 修复：每级链先查**类值 own 静态槽**——可调用则调用它；确定非可调用则
 * 原生 `TypeError`；抽象值保守（仍遮蔽继承链）。
 */




describe("derived static field shadows inherited static method", () => {
  it("派生类 static 字段遮蔽继承的 static 方法 → 原生 TypeError；三级链同样遮蔽（C extends B extends A）；读面不受影响：B.m 仍是 own 静态字段值 2；无自有静态字段时不回归：空派生类继承父类 static 方法；自有静态方法覆盖不回归（own static method wins）；祖先的静态字段同样遮蔽（原生 own 查找序：B.__proto__ = A）；own 静态字段值可调用 → 调用它（this = 类值）；Ty", () => {
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = 2; }
         return B.m();
       }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'A'; } }
         class B extends A {}
         class C extends B { static m = 7; }
         return C.m();
       }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = 2; }
         return B.m;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A {}
         return B.m();
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "base" });
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m() { return 'own'; } }
         return B.m();
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "own" });
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m = 5; }
         class B extends A {}
         return B.m();
       }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = () => 'field'; }
         return B.m();
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "field" });
  })();
(() => {

    const r = call(
      `export function f() {
         class A { static m() { return 'base'; } }
         class B extends A { static m = 2; }
         try { return String(B.m()); } catch (e) { return 'throw'; }
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "throw" });
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// union 成员按方法名判定（prim 原型方法表）
// ---------------------------------------------------------------------------
describe("union 成员按方法名判定（prim 原型方法表）", () => {
/**
 * core 的 **union 方法分派**用 `memberLikelyHasMethod` 过滤成员，
 * 而该判据**只认 `string`**（`method` 形参根本没被使用）。
 *
 * 原生：`u.m()`（u : string | number）逐成员按**该成员自己的原型面**解析
 * `m`——number 侧有 toFixed / toPrecision / toExponential ⇒ 跑出值；string
 * 侧没有 ⇒ 该分支调用 undefined ⇒ **定抛 TypeError**。
 *
 * 引擎此前：
 * - number 成员被**无条件排除** ⇒ 值域塌成 unknown（且 L2 门禁把「成员
 * 不支持该方法」误报成「成员缺方法」——诊断点名的是 string 侧）；
 * - string 成员被**无条件放行** ⇒ string 上不存在的方法也被判「有」⇒
 * 派发到 string 成员 ⇒ 报「missing on string receiver」。
 *
 * 钉：改前 union-toFixed 的值 = unknown + 误导诊断（点名 string 侧）；
 * union-toUpperCase 无 throws 记录（假绿）。
 */





/** 以 any 实参调用导出函数（抽象实参 ⇒ 逼出 union 分支） */
function callAny(src: string, fn: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fn, [anyAbs]);
}

describe("union 成员按方法名判定（prim 原型方法表）", () => {
  it("number 侧成员不再被排除：pick(y).toFixed() 的值是 number 分支结果（native \"1\"）；string 侧缺该方法 ⇒ 该分支记 TypeError may-throw（原生该分支定抛）；number 侧缺该方法（toUpperCase）⇒ 同样记 TypeError may-throw（改前无记录 = 假绿）；两侧都有该方法（toString）⇒ 不记 throws，值域是两侧的并；control：字面量 number 的 toFixed ", () => {
(() => {

    const rec = callAny(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useNum(y) { return pick(y).toFixed(); }`,
      "useNum",
    );
    const r = litValue(rec.result);
    if (!r.ok) {
      throw new Error(
        `expected literal "1" (number 分支的 toFixed 结果), got non-literal result`,
      );
    }
    expect(r.value).toEqual("1");
  })();
(() => {

    const eff = effects(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useNum(y) { return pick(y).toFixed(); }`,
      "useNum",
    );
    expect(eff).toContain("TypeError");
  })();
(() => {

    const eff = effects(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useUp(y) { return pick(y).toUpperCase(); }`,
      "useUp",
    );
    expect(eff).toContain("TypeError");
  })();
(() => {

    const eff = effects(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useStr(y) { return pick(y).toString(); }`,
      "useStr",
    );
    expect(eff).not.toContain("TypeError");
    const rec = callAny(
      `export function pick(x) { if (x) { return 1; } return "a"; }
export function useStr(y) { return pick(y).toString(); }`,
      "useStr",
    );
    // 两侧结果 "1" | "a" ⇒ 并集形态（sum），不是 unknown
    expect(rec.result.shape.k).toEqual("sum");
  })();
(() => {

    const r = litValue(call(`export function f() { return (1).toFixed(); }`, "f").result);
    expect(r.ok).toBe(true);
    expect(r.ok ? r.value : undefined).toEqual("1");
  })();
(() => {

    const eff = effects(`export function f() { return ("a").toFixed(); }`, "f");
    expect(eff).toContain("TypeError");
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 命名空间上不存在的静态方法定抛 TypeError
// ---------------------------------------------------------------------------
describe("命名空间上不存在的静态方法定抛 TypeError", () => {
/**
 * 内建**命名空间对象**上调用**不存在**的静态方法 ⇒ 引擎不记
 * may-throw ⇒ L2 门禁**假绿**（原生确定抛 TypeError）。
 *
 * 原生：`Math.clamp(1,0,2)` / `JSON.foo(1)` / `Object.foo(1)` /
 * `Number.foo(1)` / `Reflect.foo(1)` 全部抛 TypeError（not a function）；
 * 成员**存在**但不是函数（`Math.PI()`）也抛。
 *
 * 引擎此前：命名空间分支回落 `unknown` 且**不记 throws** ⇒ 引擎声称
 * 「不可能抛」（throws 面 = never）⇒ L2 门禁放行。
 *
 * 钉：改前 engine=unknown / throws=never（MISSED-THROW，engineNoThrow）。
 */




/** 断言调用定抛 TypeError（结果 never + throws 面是 TypeError） */
function expectTypeError(src: string) {
  const rec = call(src, "f");
  expect(isNever(rec.result)).toBe(true);
  expect(throwsError(rec.throws, "TypeError")).toBe(true);
}

describe("命名空间上不存在的静态方法定抛 TypeError", () => {
  it("Math.clamp(1,0,2) ⇒ TypeError；JSON.foo(1) ⇒ TypeError；Object.foo(1) ⇒ TypeError；Number.foo(1) ⇒ TypeError；Reflect.foo(1) ⇒ TypeError；成员存在但不是函数（Math.PI()）⇒ TypeError；control：Math.max(1,3) ⇒ 3（原生一致）；control：JSON.parse(\"2\") ⇒ 2（原生一致）；差分对账（nati", () => {
(() => {

    expectTypeError(`export function f() { return Math.clamp(1, 0, 2); }`);
  })();
(() => {

    expectTypeError(`export function f() { return JSON.foo(1); }`);
  })();
(() => {

    expectTypeError(`export function f() { return Object.foo(1); }`);
  })();
(() => {

    expectTypeError(`export function f() { return Number.foo(1); }`);
  })();
(() => {

    expectTypeError(`export function f() { return Reflect.foo(1); }`);
  })();
(() => {

    expectTypeError(`export function f() { return Math.PI(); }`);
  })();
(() => {

    const rec = call(`export function f() { return Math.max(1, 3); }`, "f");
    expect(rec.result.term?.op).toEqual("lit");
  })();
(() => {

    const rec = call(`export function f() { return JSON.parse("2"); }`, "f");
    expect(rec.result.term?.op).toEqual("lit");
  })();
(() => {

    expect(diffBody(`return Math.clamp(1, 0, 2);`)).toBeNull();
    expect(diffBody(`return JSON.foo(1);`)).toBeNull();
    expect(diffBody(`return Object.foo(1);`)).toBeNull();
    expect(diffBody(`return Number.foo(1);`)).toBeNull();
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
});
});

// ---------------------------------------------------------------------------
// missing method on non-prim / non-obj receivers throws
// ---------------------------------------------------------------------------
describe("missing method on non-prim / non-obj receivers throws", () => {
/**
 * **非 prim / 非 obj** 接收者（数组元组 / 内建 brand / 用户类实例）
 * 上调用**确实不存在**的方法 ⇒ 引擎**不记 may-throw** ⇒ L2 门禁**假绿**
 * （原生恒抛 `TypeError`）。
 *
 * 根因：「缺失方法终判」链只覆盖 prim / obj / 注册用户类实例
 * （`callSiteHasNoCallableTarget`）——tuple / arr / 内建 brand 一律折
 * unknown 且不记 throws。
 *
 * 修复：`invoke.ts` 的缺失方法终判新增「已知形状」分支
 * （`knownSurfaceMemberAbsent`）——tuple / arr 查 Array.prototype 封闭面
 * （ARRAY_PROTO_METHOD_NAMES），内建 brand 查 BUILTIN_BRAND_METHODS 全列；
 * 命中「确定不存在」→ 原生 TypeError（与 P4a 分支同口径）。
 */




describe("missing method on non-prim / non-obj receivers throws", () => {
  it("数组元组上调用不存在的方法 → 原生 TypeError；内建 brand 上调用不存在的方法 → 原生 TypeError；TypeError 可被 try/catch 吸收（原生同口径）；原型面内的方法不回归：数组方法照常派发；原型面内的方法不回归：内建 brand 方法照常派发；Object.prototype 名不回归（数组上的 toString / hasOwnProperty）；注册用户类实例不回归（域不同：callSiteHasNoCallableTarget ", () => {
(() => {

    for (const src of [
      `export function f() { return [].missing(); }`,
      `export function f() { return [1, 2].missing(); }`,
      `export function f() { const a = [1]; return a.missing(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  })();
(() => {

    for (const src of [
      `export function f() { return new Map().missing(); }`,
      `export function f() { return new Set().missing(); }`,
      `export function f() { return new Date().missing(); }`,
      `export function f() { return new Error("x").missing(); }`,
      `export function f() { return new RegExp("a").missing(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  })();
(() => {

    const r = call(
      `export function f() { try { return [].missing(); } catch (e) { return 'throw'; } }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "throw" });
  })();
(() => {

    const r = call(
      `export function f() { const a = [1, 2]; return a.map((x) => x + 1).join(","); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "2,3" });
  })();
(() => {

    const r = call(
      `export function f() { const m = new Map(); m.set("a", 1); return m.get("a"); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  })();
(() => {

    const r = call(
      `export function f() { const a = [1]; return String(a.hasOwnProperty("length")); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true" });
  })();
(() => {

    const r = call(
      `export class PlainBox { constructor() { this.v = 1; } present() { return this.v; } }
       export function f() { return new PlainBox().absent(); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return ({}).missing(); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return (5).missing(); }`);
    expect(isNever(r.result)).toBe(false);
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
});
});

// ---------------------------------------------------------------------------
// super.constructor 取父类构造器
// ---------------------------------------------------------------------------
describe("super.constructor 取父类构造器", () => {
/**
 * `super.constructor` 必须是**父类构造器本身**（原生父类原型上的
 * "constructor" 自有属性 ⇒ 父类值）。
 *
 * 原生（node 实测）：
 * - `class Base {} class Sub extends Base { who(){ return super.constructor.name; } }`
 * → "Base"（引擎此前折 "Object"——确定错值）。
 * - `super.constructor === Base` → true（引擎此前假 false）。
 *
 * 根因：`$getSuper` 只在 `spec.methods` 里找 "constructor" ⇒ 父类构造器
 * 记在 `spec.ctor` / 类值注册表 ⇒ 查找失败回落内置 `Object`。
 */



describe("super.constructor 取父类构造器", () => {
  it("super.constructor.name = 父类名；super.constructor === 父类（引用恒等）；无显式构造器的父类同样取到父类名", () => {
(() => {

    expect(val(
      `class Base { constructor(){ this.tag = "Base"; } }
       class Sub extends Base { who(){ return super.constructor.name; } }
       export function f(){ return new Sub().who(); }`,
    )).toEqual({ ok: true, value: "Base" });
  })();
(() => {

    expect(val(
      `class Base { constructor(){ this.tag = "Base"; } }
       class Sub extends Base { isBase(){ return super.constructor === Base; } }
       export function f(){ return new Sub().isBase(); }`,
    )).toEqual({ ok: true, value: true });
  })();
(() => {

    expect(val(
      `class Base { }
       class Sub extends Base { who(){ return super.constructor.name; } }
       export function f(){ return new Sub().who(); }`,
    )).toEqual({ ok: true, value: "Base" });
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// (false positive): explicit undefined pattern is the empty pattern
// ---------------------------------------------------------------------------
describe("(false positive): explicit undefined pattern is the empty pattern", () => {
/**
 * **假阳性钉**（反向钉）：`String.prototype.search` / `match`
 * 传**显式 undefined** 模式时按 ES2023 `RegExpCreate` 语义折叠。
 *
 * 报告结论复核：`exec/class-regex.ts` 的 `stringRegexMethod` 里
 * `litTerm.value === undefined ? "" : String(litTerm.value)` —— 这**已是
 * 的空模式修复**（修入 6ec8afc6）：ES2023 `RegExpCreate` 规定
 * pattern 为 undefined ⇒ P = ""（**不是** "undefined"）。报告引用的
 * 「`String(litTerm.value)` 把 undefined 变 "undefined"」在当前树**不成立**
 * ⇒ **不改实现**，只钉住「已修」的行为（本钉在 HEAD 只读副本上**必须通过**）。
 *
 * 原生：`"abc".search(undefined)` → 0（空模式在 0 处匹配）；
 * `"abc".match(undefined)` → [""]（长度 1、下标 0 是空串）。
 */




describe("(false positive): explicit undefined pattern is the empty pattern", () => {
  it("search(undefined) → 0（空模式在 0 处匹配）；search(void 0) → 0；match(undefined)[0] → \"\"；match(undefined).length → 1", () => {
(() => {

    const r = call(`export function f() { return "abc".search(undefined); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  })();
(() => {

    const r = call(`export function f() { return "abc".search(void 0); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  })();
(() => {

    const r = call(`export function f() { return "abc".match(undefined)[0]; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  })();
(() => {

    const r = call(`export function f() { return "abc".match(undefined).length; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// (false positive): fn-expression prototype constructor is non-enumerable
// ---------------------------------------------------------------------------
describe("(false positive): fn-expression prototype constructor is non-enumerable", () => {
/**
 * **假阳性钉**（反向钉）：函数表达式原型对象的 `constructor` 槽
 * 被折成「可枚举」⇒ `Object.keys(F.prototype)` 折 exact `"constructor"`
 * （原生 `""`）、`Object.assign` 把 `constructor` 复制出去。
 *
 * 报告结论复核：原型对象的 `constructor` 槽**已按原生不可枚举建模**
 * ⇒ **不改实现**，只钉住「已修」的行为（本钉在 HEAD 只读副本上**必须通过**）。
 */




describe("(false positive): fn-expression prototype constructor is non-enumerable", () => {
  it("Object.keys(F.prototype) → ''（原生空）；constructor 描述符 enumerable → false；Object.getOwnPropertyNames(F.prototype) → 'constructor'（自有但在枚举视图外）；Object.assign 不复制 constructor（原生不复制不可枚举键）；复制出的对象上 constructor !== 原型（原生不复制）；spread 同样不复制 constructor", () => {
(() => {

    const r = call(
      `export function f() { return Object.keys((function () {}).prototype).join(","); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  })();
(() => {

    const r = call(
      `export function f() {
         return Object.getOwnPropertyDescriptor((function () {}).prototype, "constructor").enumerable;
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  })();
(() => {

    const r = call(
      `export function f() {
         return Object.getOwnPropertyNames((function () {}).prototype).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "constructor" });
  })();
(() => {

    const r = call(
      `export function f() {
         const proto = (function () {}).prototype;
         return Object.keys(Object.assign({}, proto)).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  })();
(() => {

    const r = call(
      `export function f() {
         return Object.assign({}, (function () {}).prototype).constructor === (function () {});
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  })();
(() => {

    const r = call(
      `export function f() {
         const proto = (function () {}).prototype;
         return Object.keys({ ...proto }).join(",");
       }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});
