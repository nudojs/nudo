/**
 * Bug 1160 回归钉：this 载体名（`__this`）必须避开用户标识符。
 *
 * 背景：Bug 1058 / 1059 / 1127 / 1146 / 1149 / 1151 / 1159 已约定「引擎内部
 * 临时名必须避开用户标识符」——撞名的两种失效形态（同作用域重复词法声明
 * ⇒ 产物非法 JS ⇒ 整模块 fail-closed；内层遮蔽用户同名绑定 ⇒ 自信错值）。
 * 附录 A#4 把 `__this` 载体登记为「实测无害」并显式留到独立一波——本条实测
 * **全部可达**：`__this` 是函数 prologue（`let __this = $rawThis(this)` 或
 * 宿主生成器 hoist）与类/对象方法、构造器、访问器 thunk、字段 / 静态块 /
 * `@@hasInstance` 安装 thunk 首参之间的**跨发射器协议**，而 thunk / 方法体
 * 作用域里求值的是用户源码 ⇒ 用户声明同名绑定即相撞：
 *
 * - 真函数（声明 / 表达式 / 生成器）：形参同名 ⇒ `let __this` 与形参重复
 *   声明 SyntaxError；外层 / 块级同名 ⇒ 体内 `this` 读到用户绑定（或用户
 *   读载体）⇒ 自信错值。
 * - 类方法 / 构造器 / 对象方法（含函数表达式值）：宿主签名是
 *   `(__this, <用户形参>)` ⇒ 用户形参同名 ⇒ 箭头重复形参 SyntaxError；
 *   体内 / 默认参数 / 访问器 / 字段初始化器 / 静态块读外层 `__this` ⇒
 *   读到载体。
 * - 静态块 / 字段 thunk 首参 + `@@hasInstance` 安装 thunk：同款遮蔽；具名类
 *   的 `let C = __this` 绑定也随载体改名。
 * - 构造器 `super()` 的接收者重绑（`<载体> = $super(<载体>, …)`）与
 *   `super.x` 读：载体改名必须与声明同名，块级 `let __this` 不得劫持重绑。
 *
 * 修法：**单一来源** `exec/transpile/helpers.ts` 的 `thisCarrierOf(opts)`——
 * 根转译单元（`transpileFile` / `transpileBodyNode`）经
 * `internalTmpName("__this", opts)` 分配一次写入 `opts.thisSlot`，全部发射器
 * 读同名（避让集 = 源文本词形 ∪ `opts.userIdents`，撞名加 `_k` 后缀）；
 * 无碰撞时基名 `__this` 原样返回 ⇒ 产物逐字不变（9485 条差分语料 + 手写
 * 方法/访问器/字段/静态块/super/new.target 语料对拍 HEAD 旧发射器 0 diff）。
 *
 * 锚定值均为 node v26.10.0 原生实测（`"use strict"` vm，与引擎同源程序）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = val(src);
  return lv.ok ? lv.value : lv;
}

/** 引擎求值结果的元组具体元素（数组形态） */
function tuple(src: string): unknown[] | undefined {
  return tupleEls(call(src).result);
}

// --- 真函数族：prologue / 生成器 hoist ---

/** 函数声明形参同名 ⇒ 原生 42（修前：整模块 SyntaxError） */
const SRC_FN_DECL = `const __this = 100;
export function f() {
  function g(__this) { return this.x; }
  return g.call({ x: 42 }, 7);
}`;

/** 函数表达式形参同名 ⇒ 原生 42（修前：整模块 SyntaxError） */
const SRC_FN_EXPR = `const __this = 100;
export function f() {
  const g = function (__this) { return this.x; };
  return g.call({ x: 42 }, 7);
}`;

/** 生成器声明形参同名（宿主生成器 hoist） ⇒ 原生 42（修前：never） */
const SRC_GEN_DECL = `const __this = 100;
export function f() {
  function* g(__this) { return this.x; }
  return g.call({ x: 42 }, 7).next().value;
}`;

/** 生成器表达式体读形参（内层 let 载体遮蔽） ⇒ 原生 99（修前：7 = 接收者） */
const SRC_GEN_EXPR = `const __this = 5;
export function f() {
  const g = function* (__this) { this; return __this; };
  return g.call(7, 99).next().value;
}`;

// --- 类方法族：宿主签名 / thisParam ---

/** 类方法形参同名 ⇒ 原生 [42, 7]（修前：重复形参 SyntaxError） */
const SRC_METHOD_PARAM = `const __this = 100;
export function f() {
  class C { m(__this) { return [this.x, __this]; } }
  const c = new C(); c.x = 42;
  return c.m(7);
}`;

/** 类方法读外层同名 ⇒ 原生 5（修前：载体 = 实例 brand） */
const SRC_METHOD_OUTER = `const __this = 5;
export function f() {
  class C { m() { return __this; } }
  return new C().m();
}`;

/** 类方法体内块级同名 + this ⇒ 原生 42（修前：undefined） */
const SRC_METHOD_BLOCK = `const __this = 5;
export function f() {
  class C { m() { { let __this = 99; return this.x; } } }
  const c = new C(); c.x = 42;
  return c.m();
}`;

/** 方法默认参数读外层同名 ⇒ 原生 5（修前：载体） */
const SRC_METHOD_DEFAULT_OUTER = `const __this = 5;
export function f() {
  class C { m(a = __this) { return a; } }
  return new C().m();
}`;

/** 方法非简单形参同名（rest 槽绑定路径） ⇒ 原生 [42, 7]（修前：SyntaxError） */
const SRC_METHOD_DEFAULT_SELF = `const __this = 100;
export function f() {
  class C { m(__this = 7) { return [this.x, __this]; } }
  const c = new C(); c.x = 42;
  return c.m();
}`;

/** 构造器形参同名 ⇒ 原生 7（修前：重复形参 SyntaxError） */
const SRC_CTOR_PARAM = `const __this = 100;
export function f() {
  class C { constructor(__this) { this.x = __this; } }
  return new C(7).x;
}`;

/** 构造器形参同名 + super() ⇒ 原生 [1, 7]（修前：SyntaxError） */
const SRC_CTOR_SUPER = `const __this = 100;
class A { constructor() { this.a = 1; } }
export function f() {
  class B extends A { constructor(__this) { super(); this.b = __this; } }
  const b = new B(7);
  return [b.a, b.b];
}`;

/** 构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） */
const SRC_CTOR_SUPER_BLOCK = `const __this = 5;
class A { constructor() { this.a = 1; } }
export function f() {
  class B extends A {
    constructor() { { let __this = 9; super(); this.b = __this; } }
  }
  const b = new B();
  return [b.a, b.b];
}`;

/** 静态方法形参同名 ⇒ 原生 [true, 7]（修前：SyntaxError） */
const SRC_STATIC_METHOD_PARAM = `const __this = 100;
export function f() {
  class C { static m(__this) { return [this === C, __this]; } }
  return C.m(7);
}`;

/** 静态方法读外层同名 + super ⇒ 原生 6（修前：载体 + 1 = sum） */
const SRC_STATIC_SUPER = `const __this = 5;
class A { static m() { return 1; } }
export function f() {
  class B extends A { static n() { return __this + super.m(); } }
  return B.n();
}`;

/** 静态方法读外层同名 ⇒ 原生 5（修前：类值 brand） */
const SRC_STATIC_METHOD_OUTER = `const __this = 5;
export function f() {
  class C { static m() { return __this; } }
  return C.m();
}`;

// --- 访问器族：getter / setter thunk 首参 ---

/** 类 getter 读外层同名 ⇒ 原生 5（修前：载体） */
const SRC_CLASS_GETTER = `const __this = 5;
export function f() {
  class C { get y() { return __this; } }
  return new C().y;
}`;

/** 类 setter 读外层同名 ⇒ 原生 15（修前：载体 + v = sum） */
const SRC_CLASS_SETTER = `const __this = 5;
export function f() {
  let out = 0;
  class C { set y(v) { out = __this + v; } }
  new C().y = 10;
  return out;
}`;

/** 类 setter 形参同名 ⇒ 原生 10（修前：重复形参 SyntaxError） */
const SRC_CLASS_SETTER_PARAM = `const __this = 100;
export function f() {
  let out = 0;
  class C { set y(__this) { out = __this; } }
  new C().y = 10;
  return out;
}`;

/** 静态 getter 读外层同名 ⇒ 原生 5（修前：类值 brand） */
const SRC_STATIC_GETTER = `const __this = 5;
export function f() {
  class C { static get y() { return __this; } }
  return C.y;
}`;

// --- 字段 / 静态块 / @@hasInstance 安装 thunk ---

/** 实例字段初始化器读外层同名 + this ⇒ 原生 47（修前：sum） */
const SRC_INSTANCE_FIELD = `const __this = 5;
export function f() {
  class C { y = 42; x = __this + this.y; }
  return new C().x;
}`;

/** 类名恰为 `__this`：实例字段引用类名 ⇒ 原生 true（修前：false = 载体） */
const SRC_CLASS_NAMED_SELF = `export function f() {
  class __this { x = __this; }
  return new __this().x === __this;
}`;

/** 静态字段初始化器读外层同名 ⇒ 原生 5（修前：类值 brand） */
const SRC_STATIC_FIELD = `const __this = 5;
export function f() {
  class C { static x = __this; }
  return C.x;
}`;

/** 具名类静态块读外层同名 ⇒ 原生 5（修前：类值 brand） */
const SRC_STATIC_BLOCK = `const __this = 5;
export function f() {
  let out = 0;
  class C { static { out = __this; } }
  return out;
}`;

/** 具名类表达式静态块：外层同名 + 类名 this 双面 ⇒ 原生 [5, "CC"]（修前：tuple 含载体） */
const SRC_STATIC_BLOCK_EXPR = `const __this = 5;
export function f() {
  let out = 0;
  const D = class CC { static { out = [__this, this.name]; } };
  return out;
}`;

/** 静态块顶层 `let __this`（thunk 形参重复声明） ⇒ 原生 1（修前：SyntaxError） */
const SRC_STATIC_BLOCK_LET = `const __this = 100;
export function f() {
  let out = 0;
  class C { static { let __this = 9; out = this === C ? 1 : 2; } }
  return out;
}`;

/** 类名恰为 `__this`：静态块内 this / 类名同指一处 ⇒ 原生 "__this:__this"（修前：SyntaxError） */
const SRC_CLASS_NAMED_BLOCK = `export function f() {
  let out = 0;
  class __this { static { out = this.name + ":" + __this.name; } }
  return out;
}`;

/** `static "@@hasInstance" = v` 安装 thunk 读外层同名 ⇒ 原生 5（修前：类值 brand） */
const SRC_HASINSTANCE_FIELD = `const __this = 5;
export function f() {
  class C { static "@@hasInstance" = __this; }
  return C["@@hasInstance"];
}`;

/** `static "@@hasInstance"(){}` 安装 thunk 体内读外层同名 ⇒ 原生 5（修前：类值 brand） */
const SRC_HASINSTANCE_METHOD = `const __this = 5;
export function f() {
  class C { static "@@hasInstance"() { return __this; } }
  return C["@@hasInstance"]();
}`;

// --- 对象字面量族：方法 / 访问器 / 函数表达式值 ---

/** 对象方法形参同名 ⇒ 原生 [42, 7]（修前：重复形参 SyntaxError） */
const SRC_OBJ_METHOD = `const __this = 100;
export function f() {
  const o = { x: 42, m(__this) { return [this.x, __this]; } };
  return o.m(7);
}`;

/** 对象方法解构形参含同名 ⇒ 原生 [42, 7]（修前：SyntaxError） */
const SRC_OBJ_METHOD_DESTR = `const __this = 100;
export function f() {
  const o = { x: 42, m({ __this }) { return [this.x, __this]; } };
  return o.m({ __this: 7 });
}`;

/** 对象方法默认参数读外层同名 ⇒ 原生 5（修前：载体） */
const SRC_OBJ_METHOD_DEFAULT = `const __this = 5;
export function f() {
  const o = { m(a = __this) { return a; } };
  return o.m();
}`;

/** 对象 getter 读外层同名 ⇒ 原生 5（修前：对象 Abs） */
const SRC_OBJ_GETTER = `const __this = 5;
export function f() {
  const o = { get y() { return __this; } };
  return o.y;
}`;

/** 对象 setter 读外层同名 ⇒ 原生 15（修前：载体 + v = sum） */
const SRC_OBJ_SETTER = `const __this = 5;
export function f() {
  let out = 0;
  const o = { set y(v) { out = __this + v; } };
  o.y = 10;
  return out;
}`;

/** 对象 setter 形参同名 ⇒ 原生 10（修前：重复形参 SyntaxError） */
const SRC_OBJ_SETTER_PARAM = `const __this = 100;
export function f() {
  let out = 0;
  const o = { set y(__this) { out = __this; } };
  o.y = 10;
  return out;
}`;

/** 对象属性 = 函数表达式（宿主签名带首参）形参同名 ⇒ 原生 [42, 7]（修前：SyntaxError） */
const SRC_OBJ_FNEXPR = `const __this = 100;
export function f() {
  const o = { x: 42, m: function (__this) { return [this.x, __this]; } };
  return o.m(7);
}`;

// --- 嵌套 / 箭头捕获 ---

/** 箭头形参同名遮蔽方法载体 ⇒ 原生 49（修前：NaN） */
const SRC_ARROW_PARAM = `const __this = 5;
export function f() {
  class C { m() { const g = (__this) => this.x + __this; return g(7); } }
  const c = new C(); c.x = 42;
  return c.m();
}`;

/** 箭头默认参数同名 + 方法 this ⇒ 原生 49（修前：NaN） */
const SRC_ARROW_DEFAULT = `const __this = 5;
export function f() {
  class C { m() { const g = (__this = 7) => this.x + __this; return g(); } }
  const c = new C(); c.x = 42;
  return c.m();
}`;

/** 方法内嵌套真函数形参同名 ⇒ 原生 [1, 2]（修前：SyntaxError） */
const SRC_NESTED_FN = `const __this = 100;
export function f() {
  class C { m() { function g(__this) { return [this.x, __this]; } return g.call({ x: 1 }, 2); } }
  return new C().m();
}`;

// --- 对照：无同名绑定 ⇒ 同一路径行为不变 ---

const CTRL_FN = `export function f() {
  function g() { return this.x; }
  return g.call({ x: 42 });
}`;

const CTRL_CLASS = `export function f() {
  class C {
    y = 42;
    x = this.y;
    static s = 1;
    static { C.t = C.s + 1; }
    get z() { return this.x + 5; }
    m() { return this.x; }
    static n() { return this.s; }
  }
  return [new C().m(), new C().z, C.t, C.n()];
}`;

const CTRL_OBJ = `export function f() {
  const o = { x: 42, get y() { return this.x; }, m() { return this.x; }, set y(v) { this.x = v; } };
  o.y = 7;
  return [o.y, o.m()];
}`;

const CTRL_ARROW = `export function f() {
  class C { m() { const g = (n) => this.x + n; return g(7); } }
  const c = new C(); c.x = 42;
  return c.m();
}`;



describe("Bug 1160：this 载体名（`__this`）避开用户标识符", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  describe("真函数族（prologue / 生成器 hoist）", () => {
    it("函数声明形参同名 ⇒ 42（原生 42；修前：整模块 SyntaxError）", () => {
      expect(v(SRC_FN_DECL)).toBe(42);
    });

    it("函数表达式形参同名 ⇒ 42（原生 42；修前：整模块 SyntaxError）", () => {
      expect(v(SRC_FN_EXPR)).toBe(42);
    });

    it("生成器声明形参同名 ⇒ 42（原生 42；修前：never）", () => {
      expect(v(SRC_GEN_DECL)).toBe(42);
    });

    it("生成器表达式体读形参 ⇒ 99（原生 99；修前：7 = 接收者）", () => {
      expect(v(SRC_GEN_EXPR)).toBe(99);
    });
  });

  describe("类方法 / 构造器 / 静态方法（宿主签名 + thisParam）", () => {
    it("方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）", () => {
      expect(tuple(SRC_METHOD_PARAM)).toEqual([42, 7]);
    });

    it("方法读外层同名 ⇒ 5（原生 5；修前：实例 brand）", () => {
      expect(v(SRC_METHOD_OUTER)).toBe(5);
    });

    it("方法体内块级同名 + this ⇒ 42（原生 42；修前：undefined）", () => {
      expect(v(SRC_METHOD_BLOCK)).toBe(42);
    });

    it("方法默认参数读外层同名 ⇒ 5（原生 5；修前：载体）", () => {
      expect(v(SRC_METHOD_DEFAULT_OUTER)).toBe(5);
    });

    it("方法非简单形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）", () => {
      expect(tuple(SRC_METHOD_DEFAULT_SELF)).toEqual([42, 7]);
    });

    it("构造器形参同名 ⇒ 7（原生 7；修前：重复形参 SyntaxError）", () => {
      expect(v(SRC_CTOR_PARAM)).toBe(7);
    });

    it("构造器形参同名 + super() ⇒ [1, 7]（原生 [1, 7]；修前：SyntaxError）", () => {
      expect(tuple(SRC_CTOR_SUPER)).toEqual([1, 7]);
    });

    it("构造器块级同名 + super() 不劫持接收者重绑 ⇒ [1, 9]（原生 [1, 9]；修前：never）", () => {
      expect(tuple(SRC_CTOR_SUPER_BLOCK)).toEqual([1, 9]);
    });

    it("静态方法形参同名 ⇒ [true, 7]（原生 [true, 7]；修前：SyntaxError）", () => {
      expect(tuple(SRC_STATIC_METHOD_PARAM)).toEqual([true, 7]);
    });

    it("静态方法读外层同名 + super.m() ⇒ 6（原生 6；修前：sum）", () => {
      expect(v(SRC_STATIC_SUPER)).toBe(6);
    });

    it("静态方法读外层同名 ⇒ 5（原生 5；修前：类值 brand）", () => {
      expect(v(SRC_STATIC_METHOD_OUTER)).toBe(5);
    });
  });

  describe("访问器族（getter / setter thunk 首参）", () => {
    it("类 getter 读外层同名 ⇒ 5（原生 5；修前：载体）", () => {
      expect(v(SRC_CLASS_GETTER)).toBe(5);
    });

    it("类 setter 读外层同名 ⇒ 15（原生 15；修前：sum）", () => {
      expect(v(SRC_CLASS_SETTER)).toBe(15);
    });

    it("类 setter 形参同名 ⇒ 10（原生 10；修前：重复形参 SyntaxError）", () => {
      expect(v(SRC_CLASS_SETTER_PARAM)).toBe(10);
    });

    it("静态 getter 读外层同名 ⇒ 5（原生 5；修前：类值 brand）", () => {
      expect(v(SRC_STATIC_GETTER)).toBe(5);
    });
  });

  describe("字段 / 静态块 / @@hasInstance 安装 thunk", () => {
    it("实例字段读外层同名 + this ⇒ 47（原生 47；修前：sum）", () => {
      expect(v(SRC_INSTANCE_FIELD)).toBe(47);
    });

    it("类名恰为 `__this`：实例字段引用类名 ⇒ true（原生 true；修前：false）", () => {
      expect(v(SRC_CLASS_NAMED_SELF)).toBe(true);
    });

    it("静态字段读外层同名 ⇒ 5（原生 5；修前：类值 brand）", () => {
      expect(v(SRC_STATIC_FIELD)).toBe(5);
    });

    it("具名类静态块读外层同名 ⇒ 5（原生 5；修前：类值 brand）", () => {
      expect(v(SRC_STATIC_BLOCK)).toBe(5);
    });

    it("类表达式静态块：外层同名 + 类名 this ⇒ [5, \"CC\"]（原生 [5, \"CC\"]；修前：tuple 含载体）", () => {
      expect(tuple(SRC_STATIC_BLOCK_EXPR)).toEqual([5, "CC"]);
    });

    it("静态块顶层 let 同名 ⇒ 1（原生 1；修前：重复声明 SyntaxError）", () => {
      expect(v(SRC_STATIC_BLOCK_LET)).toBe(1);
    });

    it("类名恰为 `__this`：静态块 this / 类名同指 ⇒ \"__this:__this\"（原生同；修前：SyntaxError）", () => {
      expect(v(SRC_CLASS_NAMED_BLOCK)).toBe("__this:__this");
    });

    it("@@hasInstance 静态字段安装 thunk 读外层同名 ⇒ 5（原生 5；修前：类值 brand）", () => {
      expect(v(SRC_HASINSTANCE_FIELD)).toBe(5);
    });

    it("@@hasInstance 静态方法安装 thunk 体内读外层同名 ⇒ 5（原生 5；修前：类值 brand）", () => {
      expect(v(SRC_HASINSTANCE_METHOD)).toBe(5);
    });
  });

  describe("对象字面量族（方法 / 访问器 / 函数表达式值）", () => {
    it("对象方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）", () => {
      expect(tuple(SRC_OBJ_METHOD)).toEqual([42, 7]);
    });

    it("对象方法解构形参含同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）", () => {
      expect(tuple(SRC_OBJ_METHOD_DESTR)).toEqual([42, 7]);
    });

    it("对象方法默认参数读外层同名 ⇒ 5（原生 5；修前：载体）", () => {
      expect(v(SRC_OBJ_METHOD_DEFAULT)).toBe(5);
    });

    it("对象 getter 读外层同名 ⇒ 5（原生 5；修前：对象 Abs）", () => {
      expect(v(SRC_OBJ_GETTER)).toBe(5);
    });

    it("对象 setter 读外层同名 ⇒ 15（原生 15；修前：sum）", () => {
      expect(v(SRC_OBJ_SETTER)).toBe(15);
    });

    it("对象 setter 形参同名 ⇒ 10（原生 10；修前：重复形参 SyntaxError）", () => {
      expect(v(SRC_OBJ_SETTER_PARAM)).toBe(10);
    });

    it("对象属性 = 函数表达式形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）", () => {
      expect(tuple(SRC_OBJ_FNEXPR)).toEqual([42, 7]);
    });
  });

  describe("嵌套 / 箭头捕获", () => {
    it("箭头形参同名 ⇒ 49（原生 49；修前：NaN）", () => {
      expect(v(SRC_ARROW_PARAM)).toBe(49);
    });

    it("箭头默认参数同名 ⇒ 49（原生 49；修前：NaN）", () => {
      expect(v(SRC_ARROW_DEFAULT)).toBe(49);
    });

    it("方法内嵌套真函数形参同名 ⇒ [1, 2]（原生 [1, 2]；修前：SyntaxError）", () => {
      expect(tuple(SRC_NESTED_FN)).toEqual([1, 2]);
    });
  });

  describe("对照：无同名绑定 ⇒ 行为不变", () => {
    it("真函数 this 载体", () => {
      expect(v(CTRL_FN)).toBe(42);
    });

    it("类方法 / 字段 / 静态块 / 访问器", () => {
      expect(tuple(CTRL_CLASS)).toEqual([42, 47, 2, 1]);
    });

    it("对象方法 / 访问器", () => {
      expect(tuple(CTRL_OBJ)).toEqual([7, 7]);
    });

    it("箭头捕获方法 this", () => {
      expect(v(CTRL_ARROW)).toBe(49);
    });
  });

});
