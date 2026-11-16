/**
 * 模块套件：转译器内部临时名必须避开用户标识符（不变量级回归面）。
 *
 * 本文件是可空链 / 成员路径 / 赋值 / fork / switch / this 载体等全部
 * 发射点的**唯一归属**：缺陷编号只保留在 it 标题的 provenance 中，不再作为
 * 文件名。表内 61 条求值面用例由原六个 part 的 `expect(v(SRC)).toBe(...)`
 * 机械提升而来；其余断言（check 门禁 / 产物确定性 / 成对改名）保持原样，
 * 按发射点分组。
 *
 * 漂移门禁：从 `exec/transpile/**` 枚举分配器基名；新增基名必须进
 * COLLISION_COVERED（本套件有撞名例）或 KNOWN_GAPS（已登记缺口），否则红。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { litValue } from "../abs.ts";
import { call, resetEngineCaches, val, throwsError, tupleEls } from "./eval-helpers.ts";
import { checkSource, pTrue, transpileSource } from "../index.ts";
import { takeRefineDiags } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { sigOf } from "./nudo-constraints.ts";
import { $lit } from "../exec/runtime/state.ts";
import { safeTmpName, userIdentInfo } from "../exec/transpile/helper/tmp-names.ts";
import { readFileSync as readSource, readdirSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";

/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = litValue(call(src, "f").result);
  return lv.ok ? lv.value : lv;
}

/** 引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用） */
function refError(src: string): boolean {
  return throwsError(call(src, "f").throws, "ReferenceError");
}

type EvalCase = {label: string; src: string; expected: unknown; refError?: boolean};

const EVAL_CASES: readonly EvalCase[] = [
  {label: "触发 1：__nudoMpRoot 撞名 → 4（原生 4；修前：ReferenceError）", src: "export function f() {\n  let __nudoMpRoot = { c: 1 };\n  __nudoMpRoot.c++;\n  __nudoMpRoot.c += 2;\n  return __nudoMpRoot.c;\n}", expected: 4},
  {label: "触发 2：__nudoMpOld 撞名 → 12（原生 12；修前：13）", src: "export function f() {\n  let __nudoMpOld = 5;\n  const o = { x: 1 };\n  o.x = __nudoMpOld + 1;\n  o.x += __nudoMpOld;\n  o.x++;\n  return o.x;\n}", expected: 12},
  {label: "触发 3：__nudoMpRoot 撞名 + 计算键 → 7（原生 7；修前：1）", src: "export function f() {\n  const o = { k: 1 };\n  const __nudoMpRoot = \"k\";\n  o[__nudoMpRoot]++;\n  o[__nudoMpRoot] += 5;\n  return o.k;\n}", expected: 7},
  {label: "触发 1：值实参读用户同名绑定 → 5（原生 5；修前：ReferenceError）", src: "export function f() {\n  const __nudoDefR = 5;\n  const o = {};\n  Object.defineProperty(o, \"x\", { value: __nudoDefR });\n  return o.x;\n}", expected: 5, refError: false},
  {label: "触发 2：目标实参是用户同名绑定 → \"2|1\"（原生同款；修前：ReferenceError）", src: "export function f() {\n  const __nudoDefR = { a: 1 };\n  Object.defineProperty(__nudoDefR, \"b\", { value: 2 });\n  return __nudoDefR.b + \"|\" + __nudoDefR.a;\n}", expected: "2|1", refError: false},
  {label: "触发 3：成员路径目标 + 用户同名绑定 → 3（原生 3；修前：ReferenceError）", src: "export function f() {\n  const __nudoDefR = 3;\n  const o = { n: { m: 1 } };\n  Object.defineProperty(o.n, \"m\", { value: __nudoDefR });\n  return o.n.m;\n}", expected: 3, refError: false},
  {label: "触发 4：模块级同名绑定 → 9（原生 9；修前：ReferenceError）", src: "const __nudoDefR = 9;\nexport function f() {\n  const o = {};\n  Object.defineProperty(o, \"x\", { value: __nudoDefR });\n  return o.x;\n}", expected: 9, refError: false},
  {label: "触发 5：__nudoReArgs → true（原生 true；修前：ReferenceError）", src: "export function f() {\n  const r = /a/;\n  const __nudoReArgs = \"a\";\n  return r.test(__nudoReArgs);\n}", expected: true, refError: false},
  {label: "触发 6：__v → true（原生 true；修前：ReferenceError）", src: "export function f() {\n  const r = /a/;\n  const __v = \"a\";\n  return r.test(__v);\n}", expected: true, refError: false},
  {label: "触发 7：exec + __nudoReArgs → \"7\"（原生 \"7\"；修前：ReferenceError）", src: "export function f() {\n  const r = /(\\d)/;\n  const __nudoReArgs = \"7\";\n  const m = r.exec(__nudoReArgs);\n  return m[1];\n}", expected: "7", refError: false},
  {label: "触发 A1：__nudoReArgs → true（原生 true；修前：ReferenceError）", src: "export function f() {\n  const r = /a/;\n  const __nudoReArgs = \"a\";\n  return r?.test(__nudoReArgs);\n}", expected: true, refError: false},
  {label: "触发 A2：__v → true（原生 true；修前：ReferenceError）", src: "export function f() {\n  const r = /a/;\n  const __v = \"a\";\n  return r?.test(__v);\n}", expected: true, refError: false},
  {label: "触发 A3：exec + __nudoReArgs → \"7\"（原生 \"7\"；修前：ReferenceError）", src: "export function f() {\n  const r = /(\\d)/;\n  const __nudoReArgs = \"7\";\n  const m = r?.exec(__nudoReArgs);\n  return m[1];\n}", expected: "7", refError: false},
  {label: "触发 B1：fork 臂 __v → \"a\"（原生 \"a\"；修前：ReferenceError）", src: "export function f() {\n  const __v = /a/;\n  let out = null;\n  const r = (1 && (out = \"abc\".match(__v)));\n  return out[0];\n}", expected: "a", refError: false},
  {label: "触发 C1：默认值形参 → 15（原生 15；修前：20）", src: "export function f() {\n  const __v = 5;\n  let out = 0;\n  const o = { set x(a = 3) { out = a + __v; } };\n  o.x = 10;\n  return out;\n}", expected: 15},
  {label: "触发 C2：解构形参 → 15（原生 15；修前：非 15）", src: "export function f() {\n  const __v = 5;\n  let out = 0;\n  const o = { set x({ a }) { out = a + __v; } };\n  o.x = { a: 10 };\n  return out;\n}", expected: 15},
  {label: "触发 D1：左绑定 __test → \"a\"（原生 \"a\"；修前：ReferenceError）", src: "export function f() {\n  const __test = 42;\n  const __v = /a/;\n  let out = null;\n  const r = (__test && (out = \"abc\".match(__v)));\n  return out[0];\n}", expected: "a", refError: false},
  {label: "触发 D2：左绑定 __sc0 → 42（原生 42；修前：1）", src: "export function f() {\n  const __sc0 = 42;\n  function g() { return 1; }\n  const r = (g() && __sc0);\n  return r;\n}", expected: 42},
  {label: "触发 D3：哨兵撞用户标识符 __test → 5（原生 5；修前：1）", src: "export function f() {\n  const a = 1;\n  const __test = 5;\n  const r = (a && __test);\n  return r;\n}", expected: 5},
  {label: "触发 D4：删除键载体 __nudoDelK → 1（原生 1；修前：ReferenceError）", src: "export function f() {\n  const __nudoDelK = \"a\";\n  const o = { a: 1, b: 2 };\n  delete o?.[__nudoDelK];\n  return Object.keys(o).length;\n}", expected: 1, refError: false},
  {label: "触发 D5：守卫基绑定 $__oc → 1（原生 1；修前：undefined）", src: "export function f() {\n  const $__oc = \"a\";\n  const o = { a: 1 };\n  return o?.[$__oc];\n}", expected: 1},
  {label: "触发 D6：proto 盒子 __nudoProtoBox → true（原生 true；修前：false）", src: "export function f() {\n  const p = { x: 1 };\n  const __nudoProtoBox = p;\n  const o = { __proto__: __nudoProtoBox };\n  return Object.getPrototypeOf(o) === p;\n}", expected: true},
  {label: "触发 D7：计算键形参 __k → 5（原生 5；修前：\"b\"）", src: "export function f() {\n  const __k = 5;\n  const k = \"a\";\n  const k2 = \"b\";\n  const o = { get [k]() { return 1; }, [k2]: __k };\n  return o.b;\n}", expected: 5},
  {label: "触发 A1：类 setter 默认值形参 → 15（原生 15；修前：20）", src: "export function f() {\n  const __v = 5;\n  let out = 0;\n  class C { set x(a = 3) { out = a + __v; } }\n  const c = new C();\n  c.x = 10;\n  return out;\n}", expected: 15},
  {label: "触发 A2：类 setter 解构形参 → 15（原生 15；修前：非 15）", src: "export function f() {\n  const __v = 5;\n  let out = 0;\n  class C { set x({ a }) { out = a + __v; } }\n  const c = new C();\n  c.x = { a: 10 };\n  return out;\n}", expected: 15},
  {label: "触发 A3：静态类 setter → 15（原生 15；修前：20）", src: "export function f() {\n  const __v = 5;\n  let out = 0;\n  class C { static set x(a = 3) { out = a + __v; } }\n  C.x = 10;\n  return out;\n}", expected: 15},
  {label: "触发 A4：类表达式 setter → 15（原生 15；修前：20）", src: "export function f() {\n  const __v = 5;\n  let out = 0;\n  const C = class { set x(a = 3) { out = a + __v; } };\n  const c = new C();\n  c.x = 10;\n  return out;\n}", expected: 15},
  {label: "触发 B1：fork 快照名 __fk0_a → 42（原生 42；修前：0）", src: "export function f() {\n  const __fk0_a = 42;\n  let a = 0;\n  let out = 0;\n  if (a === 0) { out = __fk0_a; a = 1; }\n  return out;\n}", expected: 42},
  {label: "触发 B2：fork 臂标志 __cont → 42（原生 42；修前：true）", src: "export function f() {\n  const __cont = 42;\n  let a = 0;\n  let out = 0;\n  if (a === 0) { out = __cont; a = 1; }\n  return out;\n}", expected: 42},
  {label: "触发 B4：早退提升路径臂标志 __cont → 42（原生 42；修前：true）", src: "export function f() {\n  const __cont = 42;\n  let a = 0;\n  let out = 0;\n  if (a === 0) { out = __cont; return out; }\n  return out;\n}", expected: 42},
  {label: "触发 C1：赋值目标 __v → 5（原生 5；修前：1）", src: "export function f() {\n  let __v = 1;\n  __v = 5;\n  return __v;\n}", expected: 5},
  {label: "触发 C2：计算 super 键 __v → \"5\"（原生 \"5\"；修前：\"1\"）", src: "export function f() {\n  const __v = 5;\n  class B extends Object { m() { super[__v] = 1; } }\n  const b = new B();\n  b.m();\n  return Object.keys(b).join(\",\");\n}", expected: "5"},
  {label: "触发 C3：RHS（IIFE 实参）读用户 __v → 5（原生 5；修前：5 ⇒ 实参面不遮蔽）", src: "export function f() {\n  const __v = 5;\n  let y = 0;\n  y = __v;\n  return y;\n}", expected: 5},
  {label: "函数声明形参同名 ⇒ 42（原生 42；修前：整模块 SyntaxError）", src: "const __this = 100;\nexport function f() {\n  function g(__this) { return this.x; }\n  return g.call({ x: 42 }, 7);\n}", expected: 42},
  {label: "函数表达式形参同名 ⇒ 42（原生 42；修前：整模块 SyntaxError）", src: "const __this = 100;\nexport function f() {\n  const g = function (__this) { return this.x; };\n  return g.call({ x: 42 }, 7);\n}", expected: 42},
  {label: "生成器声明形参同名 ⇒ 42（原生 42；修前：never）", src: "const __this = 100;\nexport function f() {\n  function* g(__this) { return this.x; }\n  return g.call({ x: 42 }, 7).next().value;\n}", expected: 42},
  {label: "生成器表达式体读形参 ⇒ 99（原生 99；修前：7 = 接收者）", src: "const __this = 5;\nexport function f() {\n  const g = function* (__this) { this; return __this; };\n  return g.call(7, 99).next().value;\n}", expected: 99},
  {label: "方法读外层同名 ⇒ 5（原生 5；修前：实例 brand）", src: "const __this = 5;\nexport function f() {\n  class C { m() { return __this; } }\n  return new C().m();\n}", expected: 5},
  {label: "方法体内块级同名 + this ⇒ 42（原生 42；修前：undefined）", src: "const __this = 5;\nexport function f() {\n  class C { m() { { let __this = 99; return this.x; } } }\n  const c = new C(); c.x = 42;\n  return c.m();\n}", expected: 42},
  {label: "方法默认参数读外层同名 ⇒ 5（原生 5；修前：载体）", src: "const __this = 5;\nexport function f() {\n  class C { m(a = __this) { return a; } }\n  return new C().m();\n}", expected: 5},
  {label: "构造器形参同名 ⇒ 7（原生 7；修前：重复形参 SyntaxError）", src: "const __this = 100;\nexport function f() {\n  class C { constructor(__this) { this.x = __this; } }\n  return new C(7).x;\n}", expected: 7},
  {label: "静态方法读外层同名 + super.m() ⇒ 6（原生 6；修前：sum）", src: "const __this = 5;\nclass A { static m() { return 1; } }\nexport function f() {\n  class B extends A { static n() { return __this + super.m(); } }\n  return B.n();\n}", expected: 6},
  {label: "静态方法读外层同名 ⇒ 5（原生 5；修前：类值 brand）", src: "const __this = 5;\nexport function f() {\n  class C { static m() { return __this; } }\n  return C.m();\n}", expected: 5},
  {label: "类 getter 读外层同名 ⇒ 5（原生 5；修前：载体）", src: "const __this = 5;\nexport function f() {\n  class C { get y() { return __this; } }\n  return new C().y;\n}", expected: 5},
  {label: "类 setter 读外层同名 ⇒ 15（原生 15；修前：sum）", src: "const __this = 5;\nexport function f() {\n  let out = 0;\n  class C { set y(v) { out = __this + v; } }\n  new C().y = 10;\n  return out;\n}", expected: 15},
  {label: "类 setter 形参同名 ⇒ 10（原生 10；修前：重复形参 SyntaxError）", src: "const __this = 100;\nexport function f() {\n  let out = 0;\n  class C { set y(__this) { out = __this; } }\n  new C().y = 10;\n  return out;\n}", expected: 10},
  {label: "静态 getter 读外层同名 ⇒ 5（原生 5；修前：类值 brand）", src: "const __this = 5;\nexport function f() {\n  class C { static get y() { return __this; } }\n  return C.y;\n}", expected: 5},
  {label: "实例字段读外层同名 + this ⇒ 47（原生 47；修前：sum）", src: "const __this = 5;\nexport function f() {\n  class C { y = 42; x = __this + this.y; }\n  return new C().x;\n}", expected: 47},
  {label: "类名恰为 `__this`：实例字段引用类名 ⇒ true（原生 true；修前：false）", src: "export function f() {\n  class __this { x = __this; }\n  return new __this().x === __this;\n}", expected: true},
  {label: "静态字段读外层同名 ⇒ 5（原生 5；修前：类值 brand）", src: "const __this = 5;\nexport function f() {\n  class C { static x = __this; }\n  return C.x;\n}", expected: 5},
  {label: "具名类静态块读外层同名 ⇒ 5（原生 5；修前：类值 brand）", src: "const __this = 5;\nexport function f() {\n  let out = 0;\n  class C { static { out = __this; } }\n  return out;\n}", expected: 5},
  {label: "静态块顶层 let 同名 ⇒ 1（原生 1；修前：重复声明 SyntaxError）", src: "const __this = 100;\nexport function f() {\n  let out = 0;\n  class C { static { let __this = 9; out = this === C ? 1 : 2; } }\n  return out;\n}", expected: 1},
  {label: "类名恰为 `__this`：静态块 this / 类名同指 ⇒ \"__this:__this\"（原生同；修前：SyntaxError）", src: "export function f() {\n  let out = 0;\n  class __this { static { out = this.name + \":\" + __this.name; } }\n  return out;\n}", expected: "__this:__this"},
  {label: "@@hasInstance 静态字段安装 thunk 读外层同名 ⇒ 5（原生 5；修前：类值 brand）", src: "const __this = 5;\nexport function f() {\n  class C { static \"@@hasInstance\" = __this; }\n  return C[\"@@hasInstance\"];\n}", expected: 5},
  {label: "@@hasInstance 静态方法安装 thunk 体内读外层同名 ⇒ 5（原生 5；修前：类值 brand）", src: "const __this = 5;\nexport function f() {\n  class C { static \"@@hasInstance\"() { return __this; } }\n  return C[\"@@hasInstance\"]();\n}", expected: 5},
  {label: "对象方法默认参数读外层同名 ⇒ 5（原生 5；修前：载体）", src: "const __this = 5;\nexport function f() {\n  const o = { m(a = __this) { return a; } };\n  return o.m();\n}", expected: 5},
  {label: "对象 getter 读外层同名 ⇒ 5（原生 5；修前：对象 Abs）", src: "const __this = 5;\nexport function f() {\n  const o = { get y() { return __this; } };\n  return o.y;\n}", expected: 5},
  {label: "对象 setter 读外层同名 ⇒ 15（原生 15；修前：sum）", src: "const __this = 5;\nexport function f() {\n  let out = 0;\n  const o = { set y(v) { out = __this + v; } };\n  o.y = 10;\n  return out;\n}", expected: 15},
  {label: "对象 setter 形参同名 ⇒ 10（原生 10；修前：重复形参 SyntaxError）", src: "const __this = 100;\nexport function f() {\n  let out = 0;\n  const o = { set y(__this) { out = __this; } };\n  o.y = 10;\n  return out;\n}", expected: 10},
  {label: "箭头形参同名 ⇒ 49（原生 49；修前：NaN）", src: "const __this = 5;\nexport function f() {\n  class C { m() { const g = (__this) => this.x + __this; return g(7); } }\n  const c = new C(); c.x = 42;\n  return c.m();\n}", expected: 49},
  {label: "箭头默认参数同名 ⇒ 49（原生 49；修前：NaN）", src: "const __this = 5;\nexport function f() {\n  class C { m() { const g = (__this = 7) => this.x + __this; return g(); } }\n  const c = new C(); c.x = 42;\n  return c.m();\n}", expected: 49},
];

describe("撞名求值面（发射点 × 用户同名绑定）", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it.each(EVAL_CASES)("$label", ({src, expected, refError: wantsRefError}) => {
    expect(v(src)).toBe(expected);
    if (wantsRefError !== undefined) expect(refError(src)).toBe(wantsRefError);
  });
});

// ---------------------------------------------------------------------------
// 成员路径 / 赋值族（__nudoMp*）
// ---------------------------------------------------------------------------
describe("成员路径 / 赋值族（__nudoMp*）", () => {
/**
 * 回归钉：成员路径 / 赋值族的引擎**内部临时名**（`__nudoMp*`）必须
 * 与用户标识符**避让**。
 *
 * 背景： 已约定「生成名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName`）。但 `__nudoMp*` 族此前是
 * **写死**的 ⇒ 用户源码里写了同名标识符时两种失效形态都成立：
 *
 * - **遮蔽**（本条主形态）：成员路径 IIFE **在自身作用域里求值用户表达式**
 * （计算键 / RHS）⇒ IIFE 里的 `const __nudoMpRoot = …` / `const
 * __nudoMpOld = …` 遮蔽用户同名绑定 ⇒ 用户的表达式读到**引擎临时量**
 * （自信的错值）——原生值被算成别的值 ⇒ 签名面写错 ⇒ 门禁**假绿**；
 * - **TDZ ReferenceError**：`const __nudoMpK0 = __nudoMpDelK;`（引擎自引用）
 * 或 `const __nudoMpRoot = __nudoMpRoot;` ⇒ 求值期 ReferenceError ⇒ 整条
 * 表达式退化为 unknown / 抛。
 *
 * 修法：生成名经 `internalTmpNameSet` 分配（`userIdentInfoOf(opts)` 避让集 =
 * 源文本词形 ∪ `opts.userIdents`；撞名加 `_k` 后缀）——与 同款
 * 口径，**不造第二套命名机制**。无碰撞时基名原样返回 ⇒ 产物逐字不变；
 * 同一源文本 ⇒ 同一名 ⇒ 产物确定性（缓存键 / 差分语料依赖它）。
 *
 * 锚定值均为 node v26.10.0 原生实测（见各断言注释）。
 */







/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = litValue(call(src, "f").result);
  return lv.ok ? lv.value : lv;
}

/** check 门禁的签名面（函数名 → display） */
function sigOf(src: string, name = "f"): string | undefined {
  const r = checkSource("/t/bug1127.js", src, pTrue, {});
  return r.signatures.find((s) => s.name === name)?.display;
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  return checkSource("/t/bug1127.js", src, pTrue, {}).issues.map((i) => i.code);
}

// --- 报告 3 条触发（原生实测：4 / 12 / 7） ---

/** 触发 1：根载体 `__nudoMpRoot` 与用户同名 ⇒ 原生 4（修前：ReferenceError） */
const SRC_ROOT = `export function f() {
  let __nudoMpRoot = { c: 1 };
  __nudoMpRoot.c++;
  __nudoMpRoot.c += 2;
  return __nudoMpRoot.c;
}`;

/** 触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） */
const SRC_OLD = `export function f() {
  let __nudoMpOld = 5;
  const o = { x: 1 };
  o.x = __nudoMpOld + 1;
  o.x += __nudoMpOld;
  o.x++;
  return o.x;
}`;

/** 触发 3：根载体遮蔽用户**计算键** ⇒ 原生 7（修前：1） */
const SRC_KEY = `export function f() {
  const o = { k: 1 };
  const __nudoMpRoot = "k";
  o[__nudoMpRoot]++;
  o[__nudoMpRoot] += 5;
  return o.k;
}`;

describe("__nudoMp* 内部临时名与用户标识符避让", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  ;

  describe("临时名族全覆盖（member-path 层 + assignment 兜底臂）", () => {
    it("__nudoMpObj（assignment 兜底臂的对象载体）→ 8（原生 8；修前：unknown）；__nudoMpOld（assignment 兜底臂的旧值载体）→ 11（原生 11；修前：2）；__nudoMpKey（assignment 兜底臂的计算键载体）→ 11（原生 11；修前：1）；__nudoMpK0（层键载体）→ 2（原生 2；修前：ReferenceError）；__nudoMpC0（中间层持有者载体）→ 6（原生 6；修前：unknown）；__n", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let __nudoMpObj = 7;
        const mk = () => ({ x: 1 });
        const v = mk().x = __nudoMpObj + 1;
        return v;
      }`;
      expect(v(src)).toBe(8);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let __nudoMpOld = 10;
        const mk = () => ({ x: 1 });
        const v = mk().x += __nudoMpOld;
        return v;
      }`;
      expect(v(src)).toBe(11);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let __nudoMpKey = 10;
        const i = 0;
        const mk = () => [1];
        const v = mk()[i] += __nudoMpKey;
        return v;
      }`;
      expect(v(src)).toBe(11);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { k: 1 };
        const __nudoMpK0 = "k";
        o[__nudoMpK0]++;
        return o.k;
      }`;
      expect(v(src)).toBe(2);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { a: { b: 1 } };
        const __nudoMpC0 = 5;
        o.a.b += __nudoMpC0;
        return o.a.b;
      }`;
      expect(v(src)).toBe(6);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { p: 1 };
        const __nudoMpVal = 10;
        o.p = o.p + __nudoMpVal;
        return o.p;
      }`;
      expect(v(src)).toBe(11);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { p: 1 };
        const __nudoMpNew = 10;
        o.p += __nudoMpNew;
        return o.p;
      }`;
      expect(v(src)).toBe(11);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { k: 1 };
        const __nudoMpDelK = "k";
        const r = delete o[__nudoMpDelK];
        return r + "|" + o.k;
      }`;
      expect(v(src)).toBe("true|undefined");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { p: 1 };
        const __nudoMpRes = 10;
        o.p = o.p + __nudoMpRes;
        return o.p;
      }`;
      expect(v(src)).toBe(11);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      // 派生路径用对象字面量重建 MemberPath（丢 MemberPath 上的字段）⇒
      // 临时名须经**共享的层对象**继承，否则前缀路径仍写死名。
      const src = `export function f() {
        const __nudoMpRoot = "a";
        const o = { a: { b: 1 } };
        const r = delete o?.[__nudoMpRoot]?.b;
        return r + "|" + JSON.stringify(o);
      }`;
      expect(v(src)).toBe('true|{"a":{}}');
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const __nudoMpK0 = "a";
        const o = { a: { b: 1 } };
        const r = delete o?.[__nudoMpK0]?.b;
        return r + "|" + JSON.stringify(o);
      }`;
      expect(v(src)).toBe('true|{"a":{}}');
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
  });

  describe("check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面仍拿到精确值（修前：unknown / 错值）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(sigOf(SRC_ROOT)).toBe("4");
      expect(sigOf(SRC_OLD)).toBe("12");
      expect(sigOf(SRC_KEY)).toBe("7");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of [SRC_ROOT, SRC_OLD, SRC_KEY]) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    })();
});;

    ;
  });

  describe("确定性 / 产物逐字不变", () => {
    it("无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）；撞名时改名（`__nudoMpRoot` → `__nudoMpRoot_1`）且仍确定（同源两次逐字相同）；同一源码转译两次 ⇒ 产物逐字相同（确定性）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = { p: 1 };
        o.p += 2;
        return o.p;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoMpRoot");
      expect(js).not.toMatch(/__nudoMp[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_ROOT, { source: SRC_ROOT });
      const b = transpileSource(SRC_ROOT, { source: SRC_ROOT });
      expect(a).toBe(b);
      expect(a).toContain("__nudoMpRoot_1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_KEY, { source: SRC_KEY });
      const b = transpileSource(SRC_KEY, { source: SRC_KEY });
      expect(a).toBe(b);
    })();
});;

    ;

    ;
  });
});
});

// ---------------------------------------------------------------------------
// defineProperty / RegExp 状态写回族
// ---------------------------------------------------------------------------
describe("defineProperty / RegExp 状态写回族", () => {
/**
 * 回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名**
 * 必须与用户标识符**避让**。
 *
 * 背景： 已约定「引擎内部临时名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到
 * `__nudoMp*` 族（member-path / assignment）。本条落到**调用族**：
 *
 * - `Object.defineProperty(o, "x", { value: __nudoDefR })` 的**实参在
 * `const __nudoDefR = $invoke(…)` 的初始化器内求值** ⇒ 用户源码里的同名
 * 绑定被引擎临时量遮蔽（读到引擎临时量 ⇒ 自信的错值 ⇒ 签名面写错 ⇒ 门禁
 * **假绿**）或撞上引擎自引用（TDZ ⇒ ReferenceError ⇒ 原生值被算成
 * `never throws ReferenceError` ⇒ 门禁**假红**）；
 * - 正则状态写回 IIFE 同款（`const __nudoReArgs = [实参]` / `const __v = …`）。
 *
 * 修法：生成名经 `internalTmpName` / `internalTmpNameSet` 分配（与 Bug
 * 1058/1059 / 1127 同款避让口径 = `userIdentInfoOf(opts)` 避让集 ∪
 * `opts.userIdents`，撞名加 `_k` 后缀）——**不造第二套命名机制**。无碰撞时
 * 基名原样返回 ⇒ 产物逐字不变；同一源文本 ⇒ 同一名 ⇒ 产物确定性（缓存键 /
 * 差分语料依赖它）。
 *
 * 锚定值均为 node v26.10.0 原生实测（见各断言注释）。
 */







/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = val(src);
  return lv.ok ? lv.value : lv;
}

/** 引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用） */
function refError(src: string): boolean {
  return throwsError(call(src, "f").throws, "ReferenceError");
}

/** check 门禁的签名面（函数名 → display） */
function sig(src: string, name = "f"): string {
  return sigOf(checkSource("/t/bug1146.js", src, pTrue, {}), name);
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  return checkSource("/t/bug1146.js", src, pTrue, {}).issues.map((i) => i.code);
}

// --- Object.defineProperty 族（引擎临时名 `__nudoDefR`） ---

/** 触发 1：值实参读用户同名绑定 ⇒ 原生 5（修前：ReferenceError） */
const SRC_VALUE = `export function f() {
  const __nudoDefR = 5;
  const o = {};
  Object.defineProperty(o, "x", { value: __nudoDefR });
  return o.x;
}`;

/** 触发 2：目标实参是用户同名绑定 ⇒ 原生 "2|1"（修前：ReferenceError） */
const SRC_TARGET = `export function f() {
  const __nudoDefR = { a: 1 };
  Object.defineProperty(__nudoDefR, "b", { value: 2 });
  return __nudoDefR.b + "|" + __nudoDefR.a;
}`;

/** 触发 3：成员路径目标 + 用户同名绑定 ⇒ 原生 3（修前：ReferenceError） */
const SRC_NESTED = `export function f() {
  const __nudoDefR = 3;
  const o = { n: { m: 1 } };
  Object.defineProperty(o.n, "m", { value: __nudoDefR });
  return o.n.m;
}`;

/** 触发 4：模块级同名绑定（函数体内读）⇒ 原生 9（修前：ReferenceError） */
const SRC_MODULE_SCOPE = `const __nudoDefR = 9;
export function f() {
  const o = {};
  Object.defineProperty(o, "x", { value: __nudoDefR });
  return o.x;
}`;

// --- RegExp 状态写回族（引擎临时名 `__nudoReArgs` / `__v`） ---

/** 触发 5：实参读用户同名 `__nudoReArgs` ⇒ 原生 true（修前：ReferenceError） */
const SRC_RE_ARGS = `export function f() {
  const r = /a/;
  const __nudoReArgs = "a";
  return r.test(__nudoReArgs);
}`;

/** 触发 6：实参读用户同名 `__v` ⇒ 原生 true（修前：ReferenceError） */
const SRC_RE_RES = `export function f() {
  const r = /a/;
  const __v = "a";
  return r.test(__v);
}`;

/** 触发 7：exec + 同名 `__nudoReArgs` ⇒ 原生 "7"（修前：ReferenceError） */
const SRC_RE_EXEC = `export function f() {
  const r = /(\\d)/;
  const __nudoReArgs = "7";
  const m = r.exec(__nudoReArgs);
  return m[1];
}`;

const ALL_SOURCES = [
  SRC_VALUE,
  SRC_TARGET,
  SRC_NESTED,
  SRC_MODULE_SCOPE,
  SRC_RE_ARGS,
  SRC_RE_RES,
  SRC_RE_EXEC,
];

describe("调用族内部临时名（__nudoDefR / __nudoReArgs / __v）与用户标识符避让", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  ;

  ;

  describe("check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面拿到精确值（修前：never throws ReferenceError）；撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(sig(SRC_VALUE)).toBe("5");
      expect(sig(SRC_TARGET)).toBe('"2|1"');
      expect(sig(SRC_NESTED)).toBe("3");
      expect(sig(SRC_MODULE_SCOPE)).toBe("9");
      expect(sig(SRC_RE_ARGS)).toBe("true");
      expect(sig(SRC_RE_RES)).toBe("true");
      expect(sig(SRC_RE_EXEC)).toBe('"7"');
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:entry-may-throw");
      }
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    })();
});;

    ;

    ;
  });

  describe("确定性 / 产物逐字不变", () => {
    it("无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）；无碰撞时正则族临时名逐字保持基名（`__nudoReArgs` / `__v`）；撞名时改名（`__nudoDefR` → `__nudoDefR_1`）且仍确定（同源两次逐字相同）；正则族撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const o = {};
        Object.defineProperty(o, "x", { value: 5 });
        return o.x;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoDefR");
      expect(js).not.toMatch(/__nudoDefR[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const r = /a/;
        return r.test("a");
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoReArgs");
      expect(js).toContain("__v");
      expect(js).not.toMatch(/__nudoReArgs[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_VALUE, { source: SRC_VALUE });
      const b = transpileSource(SRC_VALUE, { source: SRC_VALUE });
      expect(a).toBe(b);
      expect(a).toContain("__nudoDefR_1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_RE_ARGS, { source: SRC_RE_ARGS });
      const b = transpileSource(SRC_RE_ARGS, { source: SRC_RE_ARGS });
      expect(a).toBe(b);
      expect(a).toContain("__nudoReArgs_1");
    })();
});;

    ;

    ;

    ;
  });
});
});

// ---------------------------------------------------------------------------
// 可选链 / 短路 / 对象族
// ---------------------------------------------------------------------------
describe("可选链 / 短路 / 对象族", () => {
/**
 * 回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。
 *
 * 背景： 已约定「引擎内部临时名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`），
 * 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。
 * 本条落到**其余落点**：
 *
 * - `expr/optional-chain.ts`（1149-a）：可选链整链短路的 IIFE 在**自身作用域
 * 里求值用户表达式**（正则实参 / 删除键 / 计算键 / 接收者剪枝源）⇒ 写死名
 * （`__nudoReArgs` / `__v` / `__nudoDelP` / `__nudoDelK` / `__oc` / `$__oc`
 * / `$__fn`）会与用户同名绑定相撞：
 * - **遮蔽** ⇒ 用户表达式读到引擎临时量（自信的错值 ⇒ 签名面写错 ⇒ 门禁
 * **假绿**）；
 * - **TDZ ReferenceError** ⇒ 原生值被算成 `never throws ReferenceError`
 * ⇒ 门禁**假红**；
 * - `expr/short-circuit.ts`（1149-b）：fork 臂 IIFE 同款（`__v` 臂值载体 /
 * `__test` 左绑定 / `__sc0` 左绑定 / `__r` fork 结果载体）；另「复用左绑定」
 * 哨兵 `"__test"` **只按字符串比对** ⇒ 用户标识符恰好叫 `__test` 时被误判
 * 成哨兵 ⇒ 臂返回左绑定而不是用户的值（自信错值 ⇒ 假绿）；
 * - `expr/object.ts`（1149-b）：setter thunk 的首参载体（`__v`）/ 计算键 IIFE
 * 形参（`__k` / `__nudoObjBase`）/ proto 段链 IIFE 形参（`__nudoProtoBox`）
 * ——thunk/IIFE 在自身作用域求值用户表达式 ⇒ 同款相撞。
 *
 * 修法：生成名经 `internalTmpName` / `internalTmpNameSet` 分配（与 Bug
 * 1058/1059 / 1127 / 1146 同款避让口径 = `userIdentInfoOf(opts)` 避让集 ∪
 * `opts.userIdents`，撞名加 `_k` 后缀）——**不造第二套命名机制**。无碰撞时
 * 基名原样返回 ⇒ 产物逐字不变；同一源文本 ⇒ 同一名 ⇒ 产物确定性（缓存键 /
 * 差分语料依赖它）。
 *
 * 锚定值均为 node v26.10.0 原生实测（见各断言注释）。
 */







/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = val(src);
  return lv.ok ? lv.value : lv;
}

/** 引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用） */
function refError(src: string): boolean {
  return throwsError(call(src, "f").throws, "ReferenceError");
}

/** check 门禁的签名面（函数名 → display） */
function sig(src: string, name = "f"): string {
  return sigOf(checkSource("/t/bug1149.js", src, pTrue, {}), name);
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  return checkSource("/t/bug1149.js", src, pTrue, {}).issues.map((i) => i.code);
}

// --- 1149-a：可选链正则状态写回族（`__nudoReArgs` / `__v`） ---

/** 触发 A1：可选链正则实参读用户同名 `__nudoReArgs` ⇒ 原生 true（修前：ReferenceError） */
const SRC_A1 = `export function f() {
  const r = /a/;
  const __nudoReArgs = "a";
  return r?.test(__nudoReArgs);
}`;

/** 触发 A2：可选链正则实参读用户同名 `__v` ⇒ 原生 true（修前：ReferenceError） */
const SRC_A2 = `export function f() {
  const r = /a/;
  const __v = "a";
  return r?.test(__v);
}`;

/** 触发 A3：可选链 exec + 同名 `__nudoReArgs` ⇒ 原生 "7"（修前：ReferenceError） */
const SRC_A3 = `export function f() {
  const r = /(\\d)/;
  const __nudoReArgs = "7";
  const m = r?.exec(__nudoReArgs);
  return m[1];
}`;

// --- 1149-b：短路臂值载体族（`__v`） ---

/** 触发 B1：fork 臂值载体 `__v` 遮蔽用户同名绑定 ⇒ 原生 "a"（修前：ReferenceError） */
const SRC_B1 = `export function f() {
  const __v = /a/;
  let out = null;
  const r = (1 && (out = "abc".match(__v)));
  return out[0];
}`;

// --- 1149-b：对象 setter 首参载体族（`__v`） ---

/** 触发 C1：setter 首参默认值 + 外层同名 `__v` ⇒ 原生 15（修前：20） */
const SRC_C1 = `export function f() {
  const __v = 5;
  let out = 0;
  const o = { set x(a = 3) { out = a + __v; } };
  o.x = 10;
  return out;
}`;

/** 触发 C2：setter 首参解构 + 外层同名 `__v` ⇒ 原生 15（修前：非 15） */
const SRC_C2 = `export function f() {
  const __v = 5;
  let out = 0;
  const o = { set x({ a }) { out = a + __v; } };
  o.x = { a: 10 };
  return out;
}`;

// --- 同族落点：短路协议族（`__test` / `__sc0` / 哨兵） ---

/** 触发 D1：mutator 路径的左绑定 `__test` 遮蔽用户同名绑定 ⇒ 原生 "a"（修前：ReferenceError） */
const SRC_D1 = `export function f() {
  const __test = 42;
  const __v = /a/;
  let out = null;
  const r = (__test && (out = "abc".match(__v)));
  return out[0];
}`;

/** 触发 D2：简单 $fork 的左绑定 `__sc0` 遮蔽用户同名绑定 ⇒ 原生 42（修前：1） */
const SRC_D2 = `export function f() {
  const __sc0 = 42;
  function g() { return 1; }
  const r = (g() && __sc0);
  return r;
}`;

/** 触发 D3：「复用左绑定」哨兵撞用户标识符 `__test` ⇒ 原生 5（修前：1） */
const SRC_D3 = `export function f() {
  const a = 1;
  const __test = 5;
  const r = (a && __test);
  return r;
}`;

// --- 同族落点：可选链删除族（`__nudoDelK`）与守卫基绑定族（`$__oc`） ---

/** 触发 D4：可选链 delete 的键载体 `__nudoDelK` 撞 TDZ ⇒ 原生 1（修前：ReferenceError） */
const SRC_D4 = `export function f() {
  const __nudoDelK = "a";
  const o = { a: 1, b: 2 };
  delete o?.[__nudoDelK];
  return Object.keys(o).length;
}`;

/** 触发 D5：可选链守卫基绑定 `$__oc` 遮蔽用户同名绑定 ⇒ 原生 1（修前：undefined） */
const SRC_D5 = `export function f() {
  const $__oc = "a";
  const o = { a: 1 };
  return o?.[$__oc];
}`;

// --- 同族落点：对象族（`__nudoProtoBox` / `__k` / `__nudoObjBase`） ---

/** 触发 D6：proto 段链 IIFE 形参 `__nudoProtoBox` 遮蔽用户同名绑定 ⇒ 原生 true（修前：false） */
const SRC_D6 = `export function f() {
  const p = { x: 1 };
  const __nudoProtoBox = p;
  const o = { __proto__: __nudoProtoBox };
  return Object.getPrototypeOf(o) === p;
}`;

/** 触发 D7：计算键 IIFE 形参 `__k` 遮蔽用户同名绑定 ⇒ 原生 5（修前："b"） */
const SRC_D7 = `export function f() {
  const __k = 5;
  const k = "a";
  const k2 = "b";
  const o = { get [k]() { return 1; }, [k2]: __k };
  return o.b;
}`;

const ALL_SOURCES = [
  SRC_A1,
  SRC_A2,
  SRC_A3,
  SRC_B1,
  SRC_C1,
  SRC_C2,
  SRC_D1,
  SRC_D2,
  SRC_D3,
  SRC_D4,
  SRC_D5,
  SRC_D6,
  SRC_D7,
];

describe("剩余族内部临时名（可选链 / 短路 / 对象）与用户标识符避让", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  ;

  ;

  ;

  ;

  ;

  ;

  describe("check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面拿到精确值（修前：never throws ReferenceError / 错值）；撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(sig(SRC_A1)).toBe("true");
      expect(sig(SRC_A2)).toBe("true");
      expect(sig(SRC_A3)).toBe('"7"');
      expect(sig(SRC_B1)).toBe('"a"');
      expect(sig(SRC_C1)).toBe("15");
      expect(sig(SRC_C2)).toBe("15");
      expect(sig(SRC_D1)).toBe('"a"');
      expect(sig(SRC_D2)).toBe("42");
      expect(sig(SRC_D3)).toBe("5");
      expect(sig(SRC_D4)).toBe("1");
      expect(sig(SRC_D5)).toBe("1");
      expect(sig(SRC_D6)).toBe("true");
      expect(sig(SRC_D7)).toBe("5");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:entry-may-throw");
      }
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    })();
});;

    ;

    ;
  });

  describe("确定性 / 产物逐字不变", () => {
    it("无碰撞时可选链族临时名逐字保持基名（无 `_k` 后缀）；无碰撞时短路族临时名逐字保持基名（`__sc0` / `__test` / `__v` / `__r`）；无碰撞时对象族临时名逐字保持基名（`__v` / `__k` / `__nudoProtoBox`）；撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定（同源两次逐字相同）；撞名时短路族改名（`__test` → `__test_1`）且仍确定；撞名时对象族改名（`__v` →", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const r = /a/;
        const o = { a: 1 };
        return r?.test("a") && o?.a;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoReArgs");
      expect(js).toContain("$__oc");
      expect(js).not.toMatch(/__nudoReArgs[A-Za-z0-9_]*_1\b/);
      expect(js).not.toMatch(/\$__oc[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      // 简单 $fork 路径（无 mutator 绑定）⇒ 左绑定名 `__sc0`
      const simple = `export function f() {
        function g() { return 1; }
        return g() && 2;
      }`;
      const jsSimple = transpileSource(simple, { source: simple });
      expect(jsSimple).toContain("__sc0");
      expect(jsSimple).not.toMatch(/__sc0[A-Za-z0-9_]*_1\b/);
      // mutator 路径（臂内有绑定写）⇒ 左绑定名 `__test` + fork 结果载体 `__r`
      const mutator = `export function f() {
        let out = null;
        const re = /x/;
        const r = (1 && (out = "abc".match(re)));
        return r;
      }`;
      const jsMutator = transpileSource(mutator, { source: mutator });
      expect(jsMutator).toContain("__test");
      expect(jsMutator).toContain("__r");
      expect(jsMutator).not.toMatch(/__test[A-Za-z0-9_]*_1\b/);
      expect(jsMutator).not.toMatch(/__r[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        const p = { x: 1 };
        const o = { __proto__: p, y: 2 };
        return o.y;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoProtoBox");
      expect(js).not.toMatch(/__nudoProtoBox[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_A1, { source: SRC_A1 });
      const b = transpileSource(SRC_A1, { source: SRC_A1 });
      expect(a).toBe(b);
      expect(a).toContain("__nudoReArgs_1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_D1, { source: SRC_D1 });
      const b = transpileSource(SRC_D1, { source: SRC_D1 });
      expect(a).toBe(b);
      expect(a).toContain("__test_1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_C1, { source: SRC_C1 });
      const b = transpileSource(SRC_C1, { source: SRC_C1 });
      expect(a).toBe(b);
      expect(a).toContain("__v_1");
    })();
});;

    ;

    ;

    ;

    ;

    ;
  });
});
});

// ---------------------------------------------------------------------------
// 类 setter thunk / fork 协议 / 赋值 IIFE
// ---------------------------------------------------------------------------
describe("类 setter thunk / fork 协议 / 赋值 IIFE", () => {
/**
 * 回归钉：类 setter thunk 形参载体 + fork 绑定名的内部临时名避让。
 *
 * 背景： 已建立统一口径——**引擎内部临时名
 * 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒
 * **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**；模块级同名还会撞出
 * 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。
 * 统一做法：用 `exec/transpile/helpers.ts` 的 `internalTmpName(base, opts)` /
 * `internalTmpNameSet(bases, opts)` 分配实际名（避让集 = 源文本词形 ∪
 * `opts.userIdents`；撞名加 `_k` 后缀）；**无碰撞时基名原样返回 ⇒ 产物逐字
 * 不变**。本条落在**类访问器**与**fork 协议**两族。
 *
 * - 1151-a（`exec/transpile/class-emit.ts`）：**类 setter thunk 的形参载体
 * `__v`**。setter thunk（`(__this, <v>) => {…}`）在**自身作用域**里求值
 * 用户表达式（setter 体）⇒ 写死名 `__v` 会**遮蔽**用户同名外层绑定 ⇒
 * setter 体读到引擎临时量（自信错值 ⇒ 闸门**假绿**）。
 * 修法：形参名走 `internalTmpName`（与 已修好的
 * `exec/transpile/expr/object.ts` setter 路径**同款**——照它的做法抄）。
 * - 1151-b（`exec/transpile/emit.ts` + `stmt/statement.ts` +
 * `stmt/fn-body.ts` + `expr/short-circuit.ts`）：**fork 协议绑定名**
 * （`__fk0_${n}` / `__fk1_${n}` / `__fk2_${n}` / `__fk1_set_${n}` /
 * `__fk2_set_${n}` / `__cont` / `__fkT` / `__fkR`；switch 族 `__sw0_${n}` /
 * `__sw${i}_${n}` / `__sw${i}set_${n}` / `__swD` / `__swR` / `__p`）。`n` 是
 * **用户绑定名** ⇒ 用户标识符恰为 `__fk0_a` 时即撞。**已修**（原生 42 /
 * 引擎 0 与 `true` ⇒ 修后 42）：
 * 新增**共享分配器** `emit.ts` 的 `forkTmpNames` / `switchTmpNames`（走
 * `internalTmpNameSet` / `internalTmpName`）——声明点（`forkBindingDecls`）
 * 与**全部**引用点（`forkArmThunk` / `forkArmThunkExpr` /
 * `forkJoinBindings` / `expr/short-circuit.ts` 的调用点）**同源分配**
 * ⇒ 「成对一致」不破（`stmt/statement.ts` 与 `stmt/fn-body.ts` 共用
 * `forkArmThunkExpr`，不再各自内联副本）。
 * 覆盖三条发射路径：`if` 分叉（statement.ts）、**早退提升**（fn-body.ts）、
 * **短路协议**（short-circuit.ts）+ switch 臂。
 * - 1151-c（`exec/transpile/expr/assignment.ts`）：赋值 IIFE 形参 `__v`
 * **遮蔽赋值目标**与 **super 计算键**——IIFE 体内求值用户表达式（写目标
 * / 计算键）⇒ 写死名 `__v` 会遮蔽用户同名绑定 ⇒ 自信错值 ⇒ 闸门**假绿**。
 * **已修**：形参名走 `internalTmpName`（照 `class-emit.ts` 的 `SETTER_V_BASE`
 * 路径抄）；**实参面保持原样**（IIFE 实参在作用域外求值 ⇒ 不遮蔽）。
 *
 * 锚定值均为 **node v26.10.0** 原生实测（见各断言注释）。
 */








/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = val(src);
  return lv.ok ? lv.value : lv;
}

/** 带实参的引擎求值结果（字面量值；失败面原样返回） */
function vArgs(src: string, ...args: unknown[]): unknown {
  const lv = val(src, args.map((a) => $lit(a as never)));
  return lv.ok ? lv.value : lv;
}

/** check 门禁的签名面（函数名 → display） */
function sig(src: string, name = "f"): string {
  return sigOf(checkSource("/t/bug1151.js", src, pTrue, {}), name);
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  return checkSource("/t/bug1151.js", src, pTrue, {}).issues.map((i) => i.code);
}

// --- 1151-a：类 setter thunk 形参载体族（`__v`） ---

/** 触发 A1：类 setter 默认值形参 + 外层同名 `__v` ⇒ 原生 15（修前：20） */
const SRC_A1 = `export function f() {
  const __v = 5;
  let out = 0;
  class C { set x(a = 3) { out = a + __v; } }
  const c = new C();
  c.x = 10;
  return out;
}`;

/** 触发 A2：类 setter 解构形参 + 外层同名 `__v` ⇒ 原生 15（修前：非 15） */
const SRC_A2 = `export function f() {
  const __v = 5;
  let out = 0;
  class C { set x({ a }) { out = a + __v; } }
  const c = new C();
  c.x = { a: 10 };
  return out;
}`;

/** 触发 A3：静态类 setter 默认值形参 + 外层同名 `__v` ⇒ 原生 15（修前：20） */
const SRC_A3 = `export function f() {
  const __v = 5;
  let out = 0;
  class C { static set x(a = 3) { out = a + __v; } }
  C.x = 10;
  return out;
}`;

/** 触发 A4：类表达式（绑定到常量）上的同名 `__v` ⇒ 原生 15（修前：20） */
const SRC_A4 = `export function f() {
  const __v = 5;
  let out = 0;
  const C = class { set x(a = 3) { out = a + __v; } };
  const c = new C();
  c.x = 10;
  return out;
}`;

// --- 1151-b：fork 协议绑定名族（`__fk0_${n}` / `__cont`） ---

/**
 * 触发 B1：fork 快照名 `__fk0_a` 遮蔽用户同名绑定 ⇒ 原生 42（修前：0）。
 *
 * **已修**：快照名走共享分配器（`emit.ts` 的 `forkTmpNames`）⇒ 撞名时改名
 * （`__fk0_a` → `__fk0_a_1`）⇒ 臂内读到的仍是用户的 42。
 */
const SRC_B1 = `export function f() {
  const __fk0_a = 42;
  let a = 0;
  let out = 0;
  if (a === 0) { out = __fk0_a; a = 1; }
  return out;
}`;

/**
 * 触发 B2：fork 臂标志 `__cont` 遮蔽用户同名绑定 ⇒ 原生 42（修前：true）。
 * **已修**（同 B1——臂标志名 `__cont` 走同一分配器）。
 */
const SRC_B2 = `export function f() {
  const __cont = 42;
  let a = 0;
  let out = 0;
  if (a === 0) { out = __cont; a = 1; }
  return out;
}`;

/**
 * 触发 B3：**switch 臂**标志 `__cont` 遮蔽用户同名绑定 ⇒ 原生 42（修前：true）。
 * **已修**（switch 族走同一分配器 `switchTmpNames`）。
 */
const SRC_B3 = `export function f(x) {
  const __cont = 42;
  let a = 0;
  let out = 0;
  switch (x) {
    case 1: out = __cont; break;
    default: a = 5;
  }
  return out;
}`;

/**
 * 触发 B4：**早退提升路径**（`stmt/fn-body.ts` 的早退提升臂）臂标志
 * `__cont` 遮蔽用户同名绑定 ⇒ 原生 42（修前：true）。**已修**。
 */
const SRC_B4 = `export function f() {
  const __cont = 42;
  let a = 0;
  let out = 0;
  if (a === 0) { out = __cont; return out; }
  return out;
}`;

// --- 1151-c：赋值 IIFE 形参 `__v`（写目标 / super 计算键） ---

/**
 * 触发 C1：赋值 IIFE 形参 `__v` 遮蔽**赋值目标** ⇒ 原生 5（修前：1）。
 * **已修**：IIFE 形参名走 `internalTmpName`（撞名时 `__v` → `__v_1`）⇒
 * 用户绑定被真正写回。
 */
const SRC_C1 = `export function f() {
  let __v = 1;
  __v = 5;
  return __v;
}`;

/**
 * 触发 C2：赋值 IIFE 形参 `__v` 遮蔽**计算 super 键** ⇒ 原生 "5"（修前："1"）。
 * **已修**（同 C1——键表达式在 IIFE 体内求值 ⇒ 形参改名后读到用户绑定）。
 */
const SRC_C2 = `export function f() {
  const __v = 5;
  class B extends Object { m() { super[__v] = 1; } }
  const b = new B();
  b.m();
  return Object.keys(b).join(",");
}`;

/**
 * 触发 C3：赋值 IIFE 的**实参（RHS）** 读用户同名 `__v` ⇒ 原生 5（修前：5）。
 * 「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住：
 * 修复**不得**改动实参面的语义）。
 */
const SRC_C3 = `export function f() {
  const __v = 5;
  let y = 0;
  y = __v;
  return y;
}`;

describe("类 setter thunk 形参载体（__v）避开用户标识符", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  ;

  describe("1151-a：check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面拿到精确值 15（修前：20）；撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(sig(SRC_A1)).toBe("15");
      expect(sig(SRC_A2)).toBe("15");
      expect(sig(SRC_A3)).toBe("15");
      expect(sig(SRC_A4)).toBe("15");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of [SRC_A1, SRC_A2, SRC_A3, SRC_A4]) {
        expect(issueCodes(src)).not.toContain("nudo:entry-may-throw");
      }
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of [SRC_A1, SRC_A2, SRC_A3, SRC_A4]) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    })();
});;

    ;

    ;
  });

  describe("1151-a：产物逐字不变 / 确定性", () => {
    it("无碰撞时 setter thunk 形参名逐字保持基名 `__v`（无 `_k` 后缀）；无碰撞时解构 setter thunk 形参名逐字保持基名 `__v`；撞名时改名（`__v` → `__v_1`）且仍确定（同源两次逐字相同）；撞名时改名后 thunk 形参与 args 槽引用同名（成对一致）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let out = 0;
        class C { set x(a = 3) { out = a + 1; } }
        const c = new C();
        c.x = 10;
        return out;
      }`;
      const js = transpileSource(src, { source: src });
      // 载体名（起经单元共享分配）不属于本测试的断言面——只钉
      // 1151 自己的 `__v` 基名不遭改名。
      expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let out = 0;
        class C { set x({ a }) { out = a + 1; } }
        const c = new C();
        c.x = { a: 10 };
        return out;
      }`;
      const js = transpileSource(src, { source: src });
      // 载体名（起经单元共享分配）不属于本测试的断言面——只钉
      // 1151 自己的 `__v` 基名不遭改名。
      expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\b/);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const a = transpileSource(SRC_A1, { source: SRC_A1 });
      const b = transpileSource(SRC_A1, { source: SRC_A1 });
      expect(a).toBe(b);
      expect(a).toContain("__v_1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const js = transpileSource(SRC_A1, { source: SRC_A1 });
      // thunk 形参：<载体>, __v_1（载体名不钉；只钉 `__v_1` 位与 args 槽成对）
      expect(js).toMatch(/\([A-Za-z_$][\w$]*, __v_1\) => \{/);
      // args 槽载同名：$arguments([__v_1])
      expect(js).toContain("$arguments([__v_1])");
      expect(js).not.toContain("__v_1_1");
    })();
});;

    ;

    ;

    ;
  });

  describe("1151-b：fork 协议绑定名（已修）", () => {
    ;

    ;

    it("触发 B3：switch 臂标志 __cont → 42（原生 42；修前：true）；撞名时快照名改名（`__fk0_a` → `__fk0_a_1`）且声明点与引用点同名；撞名时臂标志名改名（`__cont` → `__cont_1`）且成对一致；无碰撞时 fork 协议名逐字保持基名（产物逐字不变面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(vArgs(SRC_B3, 1)).toBe(42);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const js = transpileSource(SRC_B1, { source: SRC_B1 });
      // 声明点：const __fk0_a_1 = $copy(a, __fkCopyMemo);（一次分支快照共享身份图）
      expect(js).toContain("const __fk0_a_1 = $copy(a, __fkCopyMemo);");
      // 引用点（臂入口恢复基线）：a = $copy(__fk0_a_1, __fkArmMemo);
      expect(js).toContain("a = $copy(__fk0_a_1, __fkArmMemo);");
      // 用户绑定仍是 __fk0_a（未被引擎改名）
      expect(js).toContain("let __fk0_a = $lit(42);");
      expect(js).not.toContain("const __fk0_a = $copy(a);");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const js = transpileSource(SRC_B2, { source: SRC_B2 });
      expect(js).toContain("let __cont_1 = true;");
      expect(js).toContain("if ($isForkExit(e)) __cont_1 = false;");
      expect(js).toContain("if (__cont_1) {");
      // 用户绑定仍是 __cont
      expect(js).toContain("let __cont = $lit(42);");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let a = 0;
        let out = 0;
        if (a === 0) { out = 1; a = 1; }
        return out;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("const __fk0_out = $copy(out, __fkCopyMemo);");
      expect(js).toContain("let __cont = true;");
      expect(js).toContain("const __fkT = ($eq(a, $lit(0)));");
    })();
});;

    ;

    ;

    ;

    ;
  });

  describe("1151-c：赋值 IIFE 形参 __v（已修）", () => {
    ;

    ;

    ;

    it("撞名时 IIFE 形参改名（`__v` → `__v_1`）且写目标仍写用户绑定；无碰撞时 IIFE 形参名逐字保持基名 `__v`（产物逐字不变面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const js = transpileSource(SRC_C1, { source: SRC_C1 });
      expect(js).toContain("((__v_1) =>");
      expect(js).toContain("return __v = __v_1;");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      const src = `export function f() {
        let a = 1;
        a = 5;
        return a;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("((__v) =>");
      expect(js).toContain("return a = __v;");
      expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\b/);
    })();
});;

    ;
  });
});
});

// ---------------------------------------------------------------------------
// switch 辅助 / 标签 / 自增 / 类 setter 别名
// ---------------------------------------------------------------------------
describe("switch 辅助 / 标签 / 自增 / 类 setter 别名", () => {
/**
 * 回归钉：附录 A#4「同族写死名残留」—— 登记为「实测无害」的三处，
 * 经本条实测**全部可触发**（体内确有用户表达式），另在同文件内发现两处同族
 * 残留。
 *
 * 背景： 已约定「引擎内部临时名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`），
 * 陆续落到 `__nudoMp*` / 调用族 / 可选链 /
 * 短路 / 对象 / 类形参。本条的落点：
 *
 * - `stmt/statement.ts`（1159-a）：switch 的 **case 测试辅助族**（`__swT` /
 * `__swTV` / `__swTD` / `__swAllDone` / `__swTestRead` / `__swEval` /
 * `__swEvalAll`，及其形参 `__swI` / 循环变量 `__swJ`）与**共享体名**
 * `__swBody{n}` 是**块级词法绑定**，而 case 测试 thunk
 * （`() => (用户 case 表达式)`）与臂 thunk 都在该块作用域里求值用户表达式
 * ⇒ 写死名会：
 * - **遮蔽**用户同名外层绑定 ⇒ 臂体读到引擎临时量（自信错值 ⇒ 闸门假绿）：
 * `const __swAllDone = 42` 被读成引擎的 `false`；
 * - 撞 **TDZ ReferenceError**：臂入口注入的 `if (!__swTestRead)` 在用户
 * `let __swTestRead` 声明之前读 ⇒ 原生值被算成 never。
 * - `stmt/statement.ts`（1159-b）：switch 臂的 break 标签 `__nudoSw{n}` 是
 * **信号字符串**（`$loopBreak(标签)` / `$isBreakTo` 按字符串比对）⇒ 与用户
 * 同名标签块相撞时，臂内**无标签** `break` 的信号被用户的标签块 catch
 * 吸收 ⇒ switch 不退出、块后续语句照跑（自信错值）。
 * - `expr/operators.ts`（1159-c）：私有名自增 IIFE 形参 `__v` / `__old`——
 * IIFE 体**重复发射接收者表达式**（用户源码）⇒ 遮蔽用户同名绑定；同文件
 * 另两处同族残留：标识符后缀 IIFE 的 `__old`（体内含**写目标标识符**）与
 * 非路径 delete IIFE 的 `__nudoDelP` / `__nudoDelK` / `__nudoDelD`（体内
 * 求值父对象 / 计算键 ⇒ TDZ）。
 * - `stmt/statement.ts`（1159-c 补）：for-in 接收者临时名 `__fir{n}`（按
 * grep 指令同文件发现的第 4 处）——`const __fir{n} = (用户接收者表达式)`
 * 的初始化器与循环体都在该块里求值用户代码；首轮编译失败后的 * 重试只是**碰巧**推高计数器躲开单名碰撞，两次尝试的序号都落在用户占用面
 * 时重试仍 SyntaxError ⇒ 宿主异常冒出（`runTranspiled` 直接抛）。
 * - `stmt/statement.ts`（1159-c 再补）：循环协议的两处写死名——`for` fallback
 * 的 `$for` 状态线程形参 `__n`（测试 / 体 thunk 都内联用户源码）与 do-while
 * 首轮标记 `__nudoDwFirst`（块级绑定 + 体 thunk 内联用户体）⇒ 遮蔽用户同名
 * 绑定（条件 / 体读合成计数器或引擎布尔 ⇒ 自信错值）。
 * - `class-emit.ts`（1159-d）：setter thunk 的别名载体 `__nab{i}` / 回收载体
 * `__nabs`——thunk 体内求值用户 setter 体 ⇒ 遮蔽用户同名外层绑定。
 * - `expr/function.ts` / `expr/assignment.ts`（1159-d 补，按同族 grep 指令
 * 扩展）：宿主 rest 形参名 `__rest_raw`（与用户同名 rest 形参**重复声明**
 * ⇒ SyntaxError）与解构赋值 IIFE 形参 `__d`（默认值表达式在 IIFE 体内求值
 * ⇒ 读成 IIFE 实参对象）。
 *
 * 未纳入（**另族**）：宿主注入的 `$` / `__nudo*` 运行时族（附录 A#3，可解析
 * 面爆炸半径过大）。`__this` 载体当时也留到独立一波，**已由 收口**
 * （`thisCarrierOf` 单元共享分配；1149 / 1151 中钉 `(__this, …)` 字面形态的
 * 断言已按行为不变口径改写/删除）。
 *
 * 修法：全部改经 `internalTmpName` / `internalTmpNameSet`（与 同款
 * 避让口径 = `userIdentInfoOf(opts)` 避让集 ∪ `opts.userIdents`，撞名加 `_k`
 * 后缀）——**不造第二套命名机制**。无碰撞时基名原样返回 ⇒ 产物逐字不变
 * （9507 条差分语料 + 手写 switch / label / 类 / 私有名 / delete 语料，旧发射器
 * 对拍 0 diff）；撞名时基名加 `_k` 后缀（分配器确定性，计数器行为未变）。
 *
 * 锚定值均为 node v26.10.0 原生实测（见各断言注释）。
 */







/** 引擎求值结果的字面量值（失败面原样返回） */
function v(src: string): unknown {
  const lv = val(src);
  return lv.ok ? lv.value : lv;
}

/** 引擎求值结果的元组具体元素（数组形态） */
function tuple(src: string): unknown[] | undefined {
  return tupleEls(call(src).result);
}

/** 引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用） */
function refError(src: string): boolean {
  return throwsError(call(src, "f").throws, "ReferenceError");
}

/** check 门禁的签名面（函数名 → display） */
function sig(src: string, name = "f"): string {
  return sigOf(checkSource("/t/bug1159.js", src, pTrue, {}), name);
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  return checkSource("/t/bug1159.js", src, pTrue, {}).issues.map((i) => i.code);
}

// --- 1159-a：switch case 测试辅助族 / 共享体名 ---

/** 触发 A1：`__swAllDone` 遮蔽用户同名绑定 ⇒ 原生 42（修前：false） */
const SRC_A1 = `export function f() {
  const __swAllDone = 42;
  switch (1) {
    case 1: return __swAllDone;
    default: return 0;
  }
}`;

/** 触发 A2：臂体顶层 `let __swTestRead` 撞臂入口读 TDZ ⇒ 原生 5（修前：ReferenceError / never） */
const SRC_A2 = `export function f() {
  switch (2) {
    case 2: {
      let __swTestRead = 5;
      return __swTestRead;
    }
  }
  return 0;
}`;

/** 触发 A3：`__swEval` 遮蔽用户同名绑定 ⇒ 原生 7（修前：引擎内部函数 Abs） */
const SRC_A3 = `export function f() {
  const __swEval = 7;
  switch (3) {
    case 3: return __swEval;
    default: return 0;
  }
}`;

/** 触发 A4：case 测试表达式（测试 thunk 内求值）读用户 `__swT` ⇒ 原生 "hit"（修前："miss"） */
const SRC_A4 = `export function f() {
  let __swT = 2;
  switch (2) {
    case __swT: return "hit";
    default: return "miss";
  }
}`;

/** 触发 A5：共享体名 `__swBody0` 遮蔽用户同名绑定 ⇒ 原生 11（修前：函数 Abs） */
const SRC_A5 = `export function f() {
  const __swBody0 = 11;
  switch (1) {
    case 1:
    case 2:
      return __swBody0;
    default:
      return 0;
  }
}`;

/** 对照 A0：无同名绑定 ⇒ 同一路径求值不变 */
const CTRL_A = `export function f() {
  switch (2) {
    case 1:
    case 2:
      return "hit";
    default:
      return "miss";
  }
}`;

// --- 1159-b：switch 臂 break 标签（信号字符串） ---

/** 触发 B1：用户标签块 `__nudoSw0` 吸收臂内无标签 break ⇒ 原生 1（修前：3） */
const SRC_B1 = `export function f() {
  let r = 0;
  switch (1) {
    case 1:
      __nudoSw0: {
        r = 1;
        break;
        r = 2;
      }
      r = 3;
  }
  return r;
}`;

/** 对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） */
const CTRL_B = `export function f() {
  let r = 0;
  switch (1) {
    case 1:
      blk: {
        r = 1;
        break;
        r = 2;
      }
      r = 3;
  }
  return r;
}`;

// --- 1159-c：operators.ts（私有名自增 / 标识符后缀 / delete IIFE） ---

/** 触发 C1：delete IIFE 的父对象表达式读用户 `__nudoDelP` ⇒ TDZ（修前：ReferenceError） */
const SRC_C1 = `function get(k) { return { a: k }; }
export function f() {
  const __nudoDelP = 1;
  return delete get(__nudoDelP).a;
}`;

/** 触发 C2：delete IIFE 的计算键表达式读用户 `__nudoDelK` ⇒ TDZ（修前：ReferenceError） */
const SRC_C2 = `function get() { return { a: 1 }; }
export function f() {
  const __nudoDelK = "a";
  return delete get()[__nudoDelK];
}`;

/** 触发 C3：标识符后缀 IIFE 的 `__old` 吃掉写目标（用户绑定也叫 `__old`）⇒ 原生 [5, 6]（修前：[6, 5]） */
const SRC_C3 = `export function f() {
  let __old = 5;
  const a = __old++;
  return [a, __old];
}`;

/** 触发 C4：私有名前缀自增 IIFE 形参 `__v` 遮蔽接收者（用户方法形参叫 `__v`）⇒ 原生 1（修前：TypeError） */
const SRC_C4 = `class C { #x = 0; inc(__v) { ++__v.#x; return __v.#x; } }
export function f() { const c = new C(); return c.inc(c); }`;

/** 触发 C5：私有名后缀自增 IIFE 形参 `__old` 遮蔽接收者 ⇒ 原生 [0, 1]（修前：TypeError） */
const SRC_C5 = `class C { #x = 0; inc(__old) { const a = __old.#x++; return [a, __old.#x]; } }
export function f() { const c = new C(); return c.inc(c); }`;

/**
 * 触发 C6：for-in 接收者临时名 `__fir{n}`（同族第 4 处，grep 在 statement.ts
 * 另发现）撞用户声明 ⇒ 原生 3（修前：首轮重复声明 SyntaxError + * 重试后再撞 ⇒ 宿主 SyntaxError 冒出）。
 *
 * 声明 1..80：模块级计数器跨转译单调递增且重试会再推 3 格 ⇒ 宽区间保证
 * 首轮/重试两次尝试的序号都落在用户占用面上（修前可触发；修后经分配器避让，
 * 与计数器当前值无关）。
 */
const FIR_DECLS = Array.from({ length: 80 }, (_, i) => `  const __fir${i + 1} = ${i + 1};`).join("\n");
const SRC_C6 = `function get(o) { return { a: o }; }
export function f() {
${FIR_DECLS}
  let n = 0;
  for (const k in get(1)) { n++; }
  for (const k in get(2)) { n++; }
  for (const k in get(3)) { n++; }
  return n;
}`;

/** 触发 C7：`for` fallback 的 `$for` 状态线程形参 `__n` 遮蔽用户同名绑定 ⇒ 原生 0（修前：3） */
const SRC_C7 = `export function f() {
  let __n = 100;
  let hits = 0;
  let i = 0;
  for (i = 0; __n < 3; i++) { hits++; }
  return hits;
}`;

/** 触发 C8：do-while 首轮标记 `__nudoDwFirst` 遮蔽用户同名绑定 ⇒ 原生 7（修前：false） */
const SRC_C8 = `export function f() {
  let __nudoDwFirst = 7;
  let r = 0;
  do { r = __nudoDwFirst; } while (false);
  return r;
}`;

/** 触发 C9：宿主 rest 形参名 `__rest_raw` 撞用户同名 rest 形参 ⇒ 原生 3（修前：重复声明 SyntaxError） */
const SRC_C9 = `export function f() {
  const g = (...__rest_raw) => __rest_raw.length;
  return g(1, 2, 3);
}`;

/** 触发 C10：解构赋值 IIFE 形参 `__d` 遮蔽用户同名绑定（默认值表达式在体内求值）⇒ 原生 5（修前：对象） */
const SRC_C10 = `export function f() {
  const __d = 5;
  let a;
  ({ a = __d } = { b: 1 });
  return a;
}`;

/** 对照 C0：无同名绑定 ⇒ delete / 后缀 / 私有名自增 / for-in 接收者 / 循环协议 / rest / 解构同值 */
const CTRL_C1 = `function get() { return { a: 1 }; }
export function f() { return delete get().a; }`;
const CTRL_C2 = `export function f() { let x = 5; const a = x++; return [a, x]; }`;
const CTRL_C3 = `class C { #x = 0; inc() { ++this.#x; return this.#x; } }
export function f() { const c = new C(); return c.inc(); }`;
const CTRL_C4 = `function get(o) { return { a: o }; }
export function f() {
  let n = 0;
  for (const k in get(1)) { n++; }
  for (const k in get(2)) { n++; }
  return n;
}`;
const CTRL_C5 = `export function f() {
  let limit = 100;
  let hits = 0;
  let i = 0;
  for (i = 0; limit < 3; i++) { hits++; }
  return hits;
}`;
const CTRL_C6 = `export function f() {
  let v = 7;
  let r = 0;
  do { r = v; } while (false);
  return r;
}`;
const CTRL_C7 = `export function f() {
  const g = (...xs) => xs.length;
  return g(1, 2, 3);
}`;
const CTRL_C8 = `export function f() {
  const def = 5;
  let a;
  ({ a = def } = { b: 1 });
  return a;
}`;

// --- 1159-d：class setter thunk 的别名载体（`__nab{i}` / `__nabs`） ---

/** 触发 D1：别名载体 `__nab0` 遮蔽用户同名外层绑定 ⇒ 原生 100（修前：undefined） */
const SRC_D1 = `let out;
const __nab0 = 100;
class C { set x(v) { out = __nab0; } }
export function f() {
  const c = new C();
  c.x = 5;
  return out;
}`;

/** 触发 D2：回收载体 `__nabs`（多名别名路径）遮蔽用户同名绑定 ⇒ 原生 100（修前：ReferenceError） */
const SRC_D2 = `let out;
let a;
let b;
const __nabs = 100;
class C { set x(v) { out = __nabs; a = 1; b = 2; } }
export function f() {
  const c = new C();
  c.x = 5;
  return out;
}`;

/** 对照 D0：无同名绑定 ⇒ setter 别名写回收同值（原生 5） */
const CTRL_D = `let out;
class C { set x(v) { out = v; } }
export function f() {
  const c = new C();
  c.x = 5;
  return out;
}`;

const ALL_SOURCES = [
  SRC_A1,
  SRC_A2,
  SRC_A3,
  SRC_A4,
  SRC_A5,
  SRC_B1,
  SRC_C1,
  SRC_C2,
  SRC_C3,
  SRC_C4,
  SRC_C5,
  SRC_C6,
  SRC_C7,
  SRC_C8,
  SRC_C9,
  SRC_C10,
  SRC_D1,
  SRC_D2,
];

describe("附录 A#4 残留写死名（switch 辅助族 / break 标签 / 自增 IIFE / 类 setter 别名）", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  describe("1159-a：switch case 测试辅助族 / 共享体名", () => {
    it("触发 A1：__swAllDone → 42（原生 42；修前：false）；触发 A2：臂体 __swTestRead → 5（原生 5；修前：ReferenceError / never）；触发 A3：__swEval → 7（原生 7；修前：引擎内部函数 Abs）；触发 A4：case 测试读 __swT → \"hit\"（原生 \"hit\"；修前：\"miss\"）；触发 A5：共享体名 __swBody0 → 11（原生 11；修前：函数 Abs）；对照 A0：无同名绑定 ", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_A1)).toBe(42);
      expect(sig(SRC_A1)).toBe("42");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_A2)).toBe(5);
      expect(refError(SRC_A2)).toBe(false);
      expect(sig(SRC_A2)).toBe("5");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_A3)).toBe(7);
      expect(sig(SRC_A3)).toBe("7");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_A4)).toBe("hit");
      expect(sig(SRC_A4)).toBe('"hit"');
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_A5)).toBe(11);
      expect(sig(SRC_A5)).toBe("11");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(CTRL_A)).toBe("hit");
      expect(sig(CTRL_A)).toBe('"hit"');
    })();
});;

    ;

    ;

    ;

    ;

    ;
  });

  describe("1159-b：switch 臂 break 标签（信号字符串）", () => {
    it("触发 B1：用户标签块 __nudoSw0 不再吸收 switch break → 1（原生 1；修前：3）；对照 B0：标签名不撞内部标签 ⇒ 1（原生 1）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_B1)).toBe(1);
      expect(sig(SRC_B1)).toBe("1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(CTRL_B)).toBe(1);
      expect(sig(CTRL_B)).toBe("1");
    })();
});;

    ;
  });

  describe("1159-c：operators.ts（delete IIFE / 标识符后缀 / 私有名自增 IIFE）", () => {
    it("触发 C1：delete 父对象表达式读 __nudoDelP → true（原生 true；修前：ReferenceError）；触发 C2：delete 计算键表达式读 __nudoDelK → true（原生 true；修前：ReferenceError）；触发 C3：标识符后缀 __old → [5, 6]（原生 [5, 6]；修前：[6, 5]）；触发 C4：私有名前缀自增（接收者形参 __v）→ 1（原生 1；修前：TypeError）；触发 C5：私有名后缀自增", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C1)).toBe(true);
      expect(refError(SRC_C1)).toBe(false);
      expect(sig(SRC_C1)).toBe("true");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C2)).toBe(true);
      expect(refError(SRC_C2)).toBe(false);
      expect(sig(SRC_C2)).toBe("true");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_C3)).toEqual([5, 6]);
      expect(sig(SRC_C3)).toBe("[5, 6]");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C4)).toBe(1);
      expect(sig(SRC_C4)).toBe("1");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_C5)).toEqual([0, 1]);
      expect(sig(SRC_C5)).toBe("[0, 1]");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C6)).toBe(3);
      expect(sig(SRC_C6)).toBe("3");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C7)).toBe(0);
      expect(sig(SRC_C7)).toBe("0");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C8)).toBe(7);
      expect(sig(SRC_C8)).toBe("7");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C9)).toBe(3);
      expect(sig(SRC_C9)).toBe("3");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_C10)).toBe(5);
      expect(sig(SRC_C10)).toBe("5");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(CTRL_C1)).toBe(true);
      expect(tuple(CTRL_C2)).toEqual([5, 6]);
      expect(v(CTRL_C3)).toBe(1);
      expect(v(CTRL_C4)).toBe(2);
      expect(v(CTRL_C5)).toBe(0);
      expect(v(CTRL_C6)).toBe(7);
      expect(v(CTRL_C7)).toBe(3);
      expect(v(CTRL_C8)).toBe(5);
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
  });

  describe("1159-d：class setter thunk 别名载体（__nab{i} / __nabs）", () => {
    it("触发 D1：别名载体 __nab0 → 100（原生 100；修前：undefined）；触发 D2：回收载体 __nabs（多名别名）→ 100（原生 100；修前：ReferenceError）；对照 D0：无同名绑定 ⇒ setter 别名写回收同值（5）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_D1)).toBe(100);
      expect(sig(SRC_D1)).toBe("100");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(SRC_D2)).toBe(100);
      expect(refError(SRC_D2)).toBe(false);
      expect(sig(SRC_D2)).toBe("100");
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(CTRL_D)).toBe(5);
      expect(sig(CTRL_D)).toBe("5");
    })();
});;

    ;

    ;
  });

  describe("check 门禁面（不假绿 / 不假红）", () => {
    it("撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前 TDZ 路径是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      // 只对不含类的源断言该码：同一进程内多次 checkSource 会复用**同名类**
      // （`C`）的注册表条目 ⇒ 后一次可能读到前一次无私有字段的类规格 ⇒
      // 与本条无关的既有 `entry-may-throw`（TypeError）噪声。类源的证据由
      // 上面的精确签名断言承担（`100` / `1` / `[0, 1]`）。
      const nonClass = {
        A1: SRC_A1,
        A2: SRC_A2,
        A3: SRC_A3,
        A4: SRC_A4,
        A5: SRC_A5,
        B1: SRC_B1,
        C1: SRC_C1,
        C2: SRC_C2,
        C3: SRC_C3,
        C6: SRC_C6,
        C7: SRC_C7,
        C8: SRC_C8,
        C9: SRC_C9,
        C10: SRC_C10,
      };
      for (const [name, src] of Object.entries(nonClass)) {
        expect(issueCodes(src), name).not.toContain("nudo:entry-may-throw");
      }
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    })();
});;

    ;
  });

  describe("确定性（同一源文本 ⇒ 同一产物）", () => {
    it("撞名时分配器改名确定：同源两次转译逐字相同（无 switch 计数器的源）", () => {
      for (const src of [SRC_C4, SRC_C5, SRC_D1, SRC_D2]) {
        expect(transpileSource(src, { source: src })).toBe(transpileSource(src, { source: src }));
      }
    });
  });
});
});

// ---------------------------------------------------------------------------
// this 载体（__this）
// ---------------------------------------------------------------------------
describe("this 载体（__this）", () => {
/**
 * 回归钉：this 载体名（`__this`）必须避开用户标识符。
 *
 * 背景： 已约定「引擎内部
 * 临时名必须避开用户标识符」——撞名的两种失效形态（同作用域重复词法声明
 * ⇒ 产物非法 JS ⇒ 整模块 fail-closed；内层遮蔽用户同名绑定 ⇒ 自信错值）。
 * 附录 A#4 把 `__this` 载体登记为「实测无害」并显式留到独立一波——本条实测
 * **全部可达**：`__this` 是函数 prologue（`let __this = $rawThis(this)` 或
 * 宿主生成器 hoist）与类/对象方法、构造器、访问器 thunk、字段 / 静态块 /
 * `@@hasInstance` 安装 thunk 首参之间的**跨发射器协议**，而 thunk / 方法体
 * 作用域里求值的是用户源码 ⇒ 用户声明同名绑定即相撞：
 *
 * - 真函数（声明 / 表达式 / 生成器）：形参同名 ⇒ `let __this` 与形参重复
 * 声明 SyntaxError；外层 / 块级同名 ⇒ 体内 `this` 读到用户绑定（或用户
 * 读载体）⇒ 自信错值。
 * - 类方法 / 构造器 / 对象方法（含函数表达式值）：宿主签名是
 * `(__this, <用户形参>)` ⇒ 用户形参同名 ⇒ 箭头重复形参 SyntaxError；
 * 体内 / 默认参数 / 访问器 / 字段初始化器 / 静态块读外层 `__this` ⇒
 * 读到载体。
 * - 静态块 / 字段 thunk 首参 + `@@hasInstance` 安装 thunk：同款遮蔽；具名类
 * 的 `let C = __this` 绑定也随载体改名。
 * - 构造器 `super()` 的接收者重绑（`<载体> = $super(<载体>, …)`）与
 * `super.x` 读：载体改名必须与声明同名，块级 `let __this` 不得劫持重绑。
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



describe("this 载体名（`__this`）避开用户标识符", () => {
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  ;

  describe("类方法 / 构造器 / 静态方法（宿主签名 + thisParam）", () => {
    it("方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）；方法非简单形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）；构造器形参同名 + super() ⇒ [1, 7]（原生 [1, 7]；修前：SyntaxError）；构造器块级同名 + super() 不劫持接收者重绑 ⇒ [1, 9]（原生 [1, 9]；修前：never）；静态方法形参同名 ⇒ [true, 7]（原生 [true, 7]；修", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_METHOD_PARAM)).toEqual([42, 7]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_METHOD_DEFAULT_SELF)).toEqual([42, 7]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_CTOR_SUPER)).toEqual([1, 7]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_CTOR_SUPER_BLOCK)).toEqual([1, 9]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_STATIC_METHOD_PARAM)).toEqual([true, 7]);
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
  });

  ;

  describe("字段 / 静态块 / @@hasInstance 安装 thunk", () => {
    ;

    ;

    ;

    ;

    it("类表达式静态块：外层同名 + 类名 this ⇒ [5, \"CC\"]（原生 [5, \"CC\"]；修前：tuple 含载体）", () => {
      expect(tuple(SRC_STATIC_BLOCK_EXPR)).toEqual([5, "CC"]);
    });

    ;

    ;

    ;

    ;
  });

  describe("对象字面量族（方法 / 访问器 / 函数表达式值）", () => {
    it("对象方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）；对象方法解构形参含同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）；对象属性 = 函数表达式形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_OBJ_METHOD)).toEqual([42, 7]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_OBJ_METHOD_DESTR)).toEqual([42, 7]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(SRC_OBJ_FNEXPR)).toEqual([42, 7]);
    })();
});;

    ;

    ;

    ;

    ;

    ;

    ;
  });

  describe("嵌套 / 箭头捕获", () => {
    ;

    ;

    it("方法内嵌套真函数形参同名 ⇒ [1, 2]（原生 [1, 2]；修前：SyntaxError）", () => {
      expect(tuple(SRC_NESTED_FN)).toEqual([1, 2]);
    });
  });

  describe("对照：无同名绑定 ⇒ 行为不变", () => {
    it("真函数 this 载体；类方法 / 字段 / 静态块 / 访问器；对象方法 / 访问器；箭头捕获方法 this", () => {
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(CTRL_FN)).toBe(42);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(CTRL_CLASS)).toEqual([42, 47, 2, 1]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(tuple(CTRL_OBJ)).toEqual([7, 7]);
    })();
(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  

      expect(v(CTRL_ARROW)).toBe(49);
    })();
});;

    ;

    ;

    ;
  });

});
});

// ---------------------------------------------------------------------------
// 漂移门禁：分配器基名 ⊆ 本套件撞名覆盖 ∪ 已登记缺口
// ---------------------------------------------------------------------------

/** 本套件已有撞名例的分配器基名（覆盖 = 表行或分组内用例）。 */
const COLLISION_COVERED = new Set([
  "__d",
  "__n",
  "__nudoDelK",
  "__nudoDelP",
  "__nudoDwFirst",
  "__nudoMpKey",
  "__nudoMpObj",
  "__nudoMpOld",
  "__nudoMpVal",
  "__old",
  "__rest_raw",
  "__swAllDone",
  "__swEval",
  "__swT",
  "__swTestRead",
  "__this",
  "__v",
  "__nabs",
  "__cont"
]);

/**
 * 无端到端撞名例、但由**分配器 + 发射点**双重门禁覆盖的基名。
 *
 * 这不是白名单：新增基名必须要么补端到端撞名例进 COLLISION_COVERED，要么
 * 显式登记到本表并说明端到端不可构造的理由。
 */
const ALLOCATOR_GATED = new Set([
  "__allArgs",
  "__fkArmMemo",
  "__fkCons",
  "__fkCopyMemo",
  "__fkR",
  "__fkT",
  "__gCopyMemo",
  "__gSnapMemo",
  "__gSnapVals",
  "__margs",
  "__mutRet",
  "__nudoArgs",
  "__nudoDefaultClass",
  "__nudoDefaultFn",
  "__nudoDelD",
  "__nudoFnRet",
  "__nudoRet",
  "__p",
  "__packCopyMemo",
  "__swArmMemo",
  "__swCopyMemo",
  "__swD",
  "__swEvalAll",
  "__swI",
  "__swJ",
  "__swR",
  "__swRefreshMemo",
  "__swTD",
  "__swTV",
  "__xs"
]);

function transpilerFiles(): string[] {
  const root = dirname(fileURLToPath(import.meta.url));
  const execDir = joinPath(root, "..", "exec");
  const files: string[] = [joinPath(execDir, "transpile.ts")];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, {withFileTypes: true})) {
      const p = joinPath(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(joinPath(execDir, "transpile"));
  return files;
}

/** 从转译器源码枚举「作为分配器入参」的基名（字面量 / 数组元素）。 */
function allocatorBases(): Set<string> {
  const out = new Set<string>();
  const re = /(?:internalTmpName|internalTmpNameSet|safeTmpName|forkTmpNames|switchTmpNames)\s*\(\s*(\[[\s\S]*?\]|["'][^"']+["'])/g;
  for (const f of transpilerFiles()) {
    const text = readSource(f, "utf8");
    for (const m of text.matchAll(re)) {
      for (const lit of m[1].matchAll(/["']([^"']+)["']/g)) out.add(lit[1]);
    }
  }
  return out;
}

const CONST_INIT_RE = /const\s+([A-Za-z_$][\w$]*)[^=]*=\s*([^;]+);/g;
/** 非发射位的协议字面量（哨兵 / 宿主内建名 / 模块前导簿记名）。 */
const ALLOWED_HARDCODED = new Set([
  // 短路协议哨兵（只按字符串比对，且带 nodes-empty 守卫；见 short-circuit.ts）
  "__test",
  // 宿主内建 / 属性键
  "__proto__", "__dirname", "__filename",
  // analyze 模式的簿记调用名（host 函数名，不是词法绑定）
  "__nudoExport", "__nudoExportLazy", "__nudoExportStar",
  "__nudoRecordBinding", "__nudoRecordAssign", "__nudoRegisterImportRefresh",
  // CJS 前导名的预留集（collectTopLevelNames 负责，不经分配器）
  "__nudoCjsOrig", "__nudoCjsThis",
]);

/** 从分配器调用起点起做括号配平，返回完整实参窗口 [start, end]。 */
function allocatorCallWindows(text: string): Array<[number, number]> {
  const startRe = /(?:internalTmpName|internalTmpNameSet|safeTmpName|forkTmpNames|switchTmpNames)\s*\(/g;
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(startRe)) {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    let quote: string | null = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push([start, i]);
  }
  return out;
}

/**
 * 发射点门禁：`__` 基名字面量必须出现在分配器调用实参内，或经 const
 * 间接作为分配器入参（含数组/对象常量的一层闭包）。写死发射会在此红。
 */
function hardcodedInternalNames(): string[] {
  const bad: string[] = [];
  for (const f of transpilerFiles()) {
    const text = readSource(f, "utf8");
    const windows = allocatorCallWindows(text);
    const argText = windows.map(([s, e]) => text.slice(s, e)).join("\n");
    const consts = new Map<string, string>();
    for (const m of text.matchAll(CONST_INIT_RE)) consts.set(m[1], m[2]);
    // const 闭包：被分配器引用的常量，其初始化式里的名字也算被引用。
    const referenced = new Set<string>();
    for (const m of argText.matchAll(/[A-Za-z_$][\w$]*/g)) referenced.add(m[0]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [name, init] of consts) {
        if (referenced.has(name)) continue;
        if (![...referenced].some((tok) => init.includes(tok))) continue;
        referenced.add(name);
        for (const m of init.matchAll(/[A-Za-z_$][\w$]*/g)) referenced.add(m[0]);
        changed = true;
      }
    }
    const inWindow = (at: number): boolean => windows.some(([s, e]) => at >= s && at <= e);
    for (const m of text.matchAll(/(["'])(__[A-Za-z][^"']*)\1/g)) {
      const value = m[2];
      if (ALLOWED_HARDCODED.has(value)) continue;
      const at = m.index!;
      if (inWindow(at)) continue;
      const constName = [...consts].find(([, init]) => init.includes(`"${value}"`) || init.includes(`'${value}'`) || init.includes("`" + value + "`"))?.[0];
      if (constName && referenced.has(constName)) continue;
      bad.push(`${f}:${text.slice(0, at).split("\n").length} ${value}`);
    }
  }
  return bad;
}

describe("漂移门禁：分配器基名必须登记撞名覆盖", () => {
  it("分配器基名 ⊆ COLLISION_COVERED ∪ ALLOCATOR_GATED；COLLISION_COVERED 不残留已删除的基名；分配器本身对每个基名都避让（撞名 ⇒ <base>_1；无撞名 ⇒ 原名）；发射点不写死内部名（字面量 ⊆ 分配器调用 / const 间接）", () => {
(() => {

    const uncovered = [...allocatorBases()].filter(
      (b) => !COLLISION_COVERED.has(b) && !ALLOCATOR_GATED.has(b),
    );
    expect(uncovered).toEqual([]);
  })();
(() => {

    const bases = allocatorBases();
    expect([...COLLISION_COVERED].filter((b) => !bases.has(b))).toEqual([]);
  })();
(() => {

    const bad: string[] = [];
    for (const base of allocatorBases()) {
      if (safeTmpName(base, userIdentInfo(`const ${base} = 1;`)) !== `${base}_1`) bad.push(base);
      if (safeTmpName(base, userIdentInfo("const unrelated = 1;")) !== base) bad.push(`${base}(无撞名)`);
    }
    expect(bad).toEqual([]);
  })();
(() => {

    expect(hardcodedInternalNames()).toEqual([]);
  })();
});;

  ;

  ;

  ;
});
