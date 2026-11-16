/**
 * 模块套件：求值面：控制流/迭代/守卫/作用域。
 */
import { describe, it, expect } from "vitest";
import { litValue, anyAbs, abs, num, type Abs as Abs_____abs_ts, absLit, type Abs as Abs_____abs_ts_1 } from "../abs.ts";
import { transpileSource, checkSource, pTrue } from "../index.ts";
import { callLit, call, val, isNever, throwsError } from "./eval-helpers.ts";
import { formatAbs } from "../format/format.ts";
import { litValue as litValue___nudojs_core, checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core, litValue as litValue___nudojs_core_1, type Abs, litValue as litValue___nudojs_core_2, checkSource as checkSource___nudojs_core_1, pTrue as pTrue___nudojs_core_1, checkSource as checkSource___nudojs_core_2, pTrue as pTrue___nudojs_core_2, litValue as litValue___nudojs_core_3, checkSource as checkSource___nudojs_core_3, pTrue as pTrue___nudojs_core_3, litValue as litValue___nudojs_core_4, litValue as litValue___nudojs_core_5, transpileSource as transpileSource___nudojs_core, litValue as litValue___nudojs_core_6, litValue as litValue___nudojs_core_7 } from "@nudojs/core";
import { l2Count, sigOf, sidecarOpts, withStdImport, stdOpts } from "./nudo-constraints.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { $lit, withInvariantSpecs } from "../exec/runtime/state.ts";
import { transpileSource as transpileSource_____exec_transpile_ts } from "../exec/transpile.ts";
import { pTrue as pTrue_____pred_ts, ge, le, predToString, pTrue as pTrue_____pred_ts_1 } from "../pred.ts";
import { joinAbs } from "../objects.ts";
import { applyInvariantsToPack } from "../exec/runtime/invariant-apply.ts";
import { lit, v } from "../term.ts";
import { checkSource as checkSource_____check_check_ts, resetCheckSourceMemo } from "../check/check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

// ---------------------------------------------------------------------------
// try 内 return 载体 __nudoRet 不遮蔽用户同名绑定
// ---------------------------------------------------------------------------
describe("try 内 return 载体 __nudoRet 不遮蔽用户同名绑定", () => {
/**
 * / 回归：引擎**内部临时名**必须与用户标识符**避让**。
 *
 * 同根因（的修复只装在了解构临时名族上 ⇒ 这里只装了一半）：
 * 引擎为转译生成的内部绑定（`arguments` 槽 `__nudoArgs` / try 标记
 * `__nudoTm_{n}` / catch 载体 `__nudoE_{n}` / try 内 return 载体
 * `__nudoRet` / 写回载体 `__mutRet` / 函数体 catch 载体 `__nudoFnRet` …）
 * 一律用**固定名**发射 ⇒ 用户源码里写了同名标识符时两种失效形态都成立：
 *
 * - **同作用域重复词法声明**（）⇒ 产物不是合法 JS ⇒ `new Function`
 * 编译期 SyntaxError ⇒ 求值器 fail-closed ⇒ **整模块**导出退化 unknown +
 * **假** `nudo:opaque-result`（「path not covered, or native」——误导诊断）
 * ⇒ 门禁 exit 0 **假绿**；连**无关**的导出也失去签名。
 * - **内层遮蔽**用户同名外层绑定（）⇒ 引擎的 `const __nudoRet =
 * <用户表达式>` 在**自己的初始化器**里读 `__nudoRet` ⇒ TDZ
 * ReferenceError ⇒ 被用户自己的 `catch` 吞掉 ⇒ 原生 `15` 被算成 `0`
 * （wrong-exact）⇒ 签名面写成 `=> 0` ⇒ 门禁假绿。
 *
 * 修法（`transpile/helpers.ts` 的 `internalTmpName`）：生成内部名时用
 * `userIdentInfo(source).names`（源文本里出现过的**全部标识符词形**，保守
 * 超集）做避让——撞名则加 `_k` 后缀（跳过已占用名）。避让在**整个转译单元**
 * 生效（不做作用域分析：内层声明的用户名也会遮蔽外层生成的临时名）⇒ 生成名
 * 与用户标识符词形永不相撞；**无碰撞时原名返回** ⇒ 产物逐字不变；同一源文本
 * ⇒ 同一名 ⇒ 产物**确定性**（缓存键 / 差分语料依赖它）。
 *
 * 锚定值均为 node 原生实测：
 * - `f(5)`：原生 `15`（`const __nudoRet = 10; try { return __nudoRet + x; }
 * catch (e) { return 0; }`）
 * - `f(1)`：原生 `8`（`const __nudoTm_0 = 7; try { throw … } catch (e) {
 * return __nudoTm_0 + x; }`）
 * - `f()`：原生 `0`（`const __nudoArgs = 1; return arguments.length;`）
 */





/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

/** check 门禁的签名面（函数名 → display） */
function sigOf(src: string, name = "f"): string | undefined {
  const r = checkSource("/t/collide.js", src, pTrue, {});
  return r.signatures.find((s) => s.name === name)?.display;
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  const r = checkSource("/t/collide.js", src, pTrue, {});
  return r.issues.map((i) => i.code);
}

// --- 1059：try 内 return 载体 `__nudoRet` 遮蔽用户同名外层绑定 ---
const SRC_RET = `export function f(x) {
  const __nudoRet = 10;
  try { return __nudoRet + x; } catch (e) { return 0; }
}`;
/** 对照：用户标识符不同名 ⇒ 不遮蔽（原生同值） */
const SRC_RET_CTRL = `export function f(x) {
  const __nudoRetX = 10;
  try { return __nudoRetX + x; } catch (e) { return 0; }
}`;
/** 字面量版：签名面可精确到 15（`x: any` 时只能给 `number | string`） */
const SRC_RET_LIT = `export function f() {
  const __nudoRet = 10;
  try { return __nudoRet + 5; } catch (e) { return 0; }
}`;

// --- 1058：try 标记 / catch 载体 / arguments 槽 与用户同名 ---
const SRC_TM = `export function f(x) {
  const __nudoTm_0 = 7;
  try { throw new Error("x"); } catch (e) { return __nudoTm_0 + x; }
}
export function g(x) { return x * 2; }`;
/** 对照：用户标识符不同名（行为基线——含 try 内 throw 的 may-throw 面） */
const SRC_TM_CTRL = `export function f(x) {
  const __nudoTm_0x = 7;
  try { throw new Error("x"); } catch (e) { return __nudoTm_0x + x; }
}
export function g(x) { return x * 2; }`;
const SRC_E = `export function f(x) {
  const __nudoE_0 = 7;
  try { throw new Error("x"); } catch (e) { return __nudoE_0 + x; }
}
export function g(x) { return x * 2; }`;
const SRC_E_CTRL = `export function f(x) {
  const __nudoE_0x = 7;
  try { throw new Error("x"); } catch (e) { return __nudoE_0x + x; }
}
export function g(x) { return x * 2; }`;
const SRC_ARGS = `export function f() {
  const __nudoArgs = 1;
  return arguments.length;
}
export function g() { return 7; }`;


  it("引擎结果 = 原生 15（修前：TDZ ReferenceError 被用户 catch 吞掉 ⇒ 0）；签名面写 15（不是 => 0）；参数版签名面与无碰撞对照逐字一致（修前：=> 0）；无假 nudo:opaque-result（修前：模块 fail-closed ⇒ unknown + 假 opaque）", () => {
  {
    expect(v(SRC_RET, 5)).toEqual({ ok: true, value: 15 });
  }
  {
    expect(sigOf(SRC_RET_LIT)).toBe("15");
  }
  {
    expect(sigOf(SRC_RET)).toBe("number | string");
    expect(sigOf(SRC_RET)).toBe(sigOf(SRC_RET_CTRL));
  }
  {
    expect(issueCodes(SRC_RET)).not.toContain("nudo:opaque-result");
  }
});





describe("内部临时名（__nudoTm_ / __nudoE_ / __nudoArgs）与用户标识符避让", () => {
  it("用户写 __nudoTm_0：模块不退化 unknown（结果 = 原生 8）；用户写 __nudoE_0：catch 载体不遮蔽用户绑定（结果 = 原生 8）；用户写 __nudoArgs：arguments 槽不重复声明（结果 = 原生 0）；整模块不再 fail-closed：无关导出 g 仍拿到签名（与无碰撞对照逐字一致）；无假 nudo:opaque-result（修前：整模块 unknown + 2 条假 opaque）；不退化 unknown（修前：f/g 全 ", () => {
  {
    expect(v(SRC_TM, 1)).toEqual({ ok: true, value: 8 });
  }
  {
    expect(v(SRC_E, 1)).toEqual({ ok: true, value: 8 });
  }
  {
    expect(v(SRC_ARGS)).toEqual({ ok: true, value: 0 });
  }
  {
    expect(sigOf(SRC_TM, "g")).toBe(sigOf(SRC_TM_CTRL, "g"));
    expect(sigOf(SRC_E, "g")).toBe(sigOf(SRC_E_CTRL, "g"));
    expect(sigOf(SRC_ARGS, "g")).toBe("7");
  }
  {
    expect(issueCodes(SRC_TM)).not.toContain("nudo:opaque-result");
    expect(issueCodes(SRC_E)).not.toContain("nudo:opaque-result");
    expect(issueCodes(SRC_ARGS)).not.toContain("nudo:opaque-result");
  }
  {
    expect(sigOf(SRC_TM, "f")).not.toBe("unknown");
    expect(sigOf(SRC_E, "f")).not.toBe("unknown");
    expect(sigOf(SRC_ARGS, "f")).not.toBe("unknown");
  }
});





});

describe("负控 / 确定性 — 用户标识符不撞名时行为逐字不变", () => {
  const CTRL = `export function f(x) {
  const a = 10;
  try { return a + x; } catch (e) { return 0; }
}
export function g() { return arguments.length; }`;

  it("内部临时名逐字保持原形（__nudoTm_0 / __nudoRet / __nudoArgs，无后缀改名）；同一源码转译两次 ⇒ 产物逐字相同（确定性：缓存键 / 差分语料依赖它）；撞名时改名后仍确定（同源两次转译逐字相同）", () => {
  {
    const js = transpileSource(CTRL, { source: CTRL });
    expect(js).toContain("const __nudoTm_0 = $tryMark();");
    expect(js).toContain("const __nudoRet = $add(a, x);");
    expect(js).toContain("let __nudoArgs = $arguments(arguments);");
    // 无避让后缀（撞名时才改名）
    expect(js).not.toMatch(/__nudo[A-Za-z0-9_]*_1\b/);
  }
  {
    const a = transpileSource(CTRL, { source: CTRL });
    const b = transpileSource(CTRL, { source: CTRL });
    expect(a).toBe(b);
  }
  {
    const a = transpileSource(SRC_RET, { source: SRC_RET });
    const b = transpileSource(SRC_RET, { source: SRC_RET });
    expect(a).toBe(b);
    expect(a).toContain("const __nudoRet_1 = $add(__nudoRet, x);");
  }
});


});
});

// ---------------------------------------------------------------------------
// 数组解构对用户 iterable 按迭代序（不按索引）
// ---------------------------------------------------------------------------
describe("数组解构对用户 iterable 按迭代序（不按索引）", () => {
/**
 * 回归：数组解构对**用户 iterable**（对象带自有 `@@iterator` 方法）
 * 必须按迭代序取元素（GetIterator + IteratorNext），**不得**按索引读。
 *
 * 修复前：解构 lowering 一律 `$idx(recv, i)`（按索引属性读）——用户 iterable
 * 没有索引槽 ⇒ 折出**确定 undefined**（精确错值；原生是迭代序的第 2 个值）。
 * 修复后（用户迭代器协议）：`exec/runtime/containers/iterate.ts` 的
 * `$iterCheck` 兼做两件事——①可迭代性守卫；②返回**迭代序元素读取器**
 * （`get(i)` / `rest(i)`），生成码（`exec/transpile/emit.ts`）按需取元素。
 * 元素域与原生**逐值一致**（不再是 sound 的 unknown 折）。
 *
 * 副产物回归：`noBody` 必须是**全局唯一**占位 body 单例——否则
 * 「占位 fn 判据」（按身份比较）跨模块失配 ⇒ 引擎原生迭代器
 * （`abstractSeqIteratorAbs`）的 `@@iterator` 占位被误判为「真实现」⇒
 * 跑用户协议调占位 fn ⇒ `[...Array.from('ab').keys()]` **假抛** TypeError。
 *
 * 负控制：内建可迭代体（tuple / 字符串 / Set / Map）的解构**不受影响**
 * （仍是精确值）；`any` 接收者仍保持 any 面；非可迭代接收者仍抛 TypeError。
 */





/** 用户 iterable：对象带自有 @@iterator 方法（原生按迭代序产 1,2,3…） */
const USER_ITER = `const it = { [Symbol.iterator]() { let i = 0; return { next: () => (i < 3 ? { value: ++i, done: false } : { done: true }) }; } };`;


  it("单元素解构：值面 = 迭代序第 1 个值（原生 1，此前折确定 undefined）；多元素解构：第 1 位 = 迭代序第 1 个值；多元素解构：第 2 位 = 迭代序第 2 个值（原生 2，此前折确定 undefined）；赋值形态（[p, q] = it）同样按迭代序；形参位解构（function h([a, b]) {…} h(userIter)）同样按迭代序；用户**迭代器**对象（自带 next + @@iterator）按迭代序取值；副产物：引擎原生迭代器不被误判", () => {
  {
    expect(val(`export function f() { ${USER_ITER} const [a] = it; return a; }`)).toEqual({
      ok: true,
      value: 1,
    });
  }
  {
    expect(
      val(`export function f() { ${USER_ITER} const [a, b] = it; return a; }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(`export function f() { ${USER_ITER} const [a, b] = it; return b; }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(`export function f() { ${USER_ITER} let p, q; [p, q] = it; return q; }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(
        `export function f() { const g = { [Symbol.iterator]: function() { return [1, 2][Symbol.iterator](); } }; function h([a, b]) { return b; } return h(g); }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(
        `export function f() { const it = { i: 0, next() { return this.i < 2 ? { value: "n" + (++this.i), done: false } : { done: true }; }, [Symbol.iterator]() { return this; } }; const [a, b] = it; return a + b; }`,
      ),
    ).toEqual({ ok: true, value: "n1n2" });
  }
  {
    // 原生：[...Array.from('ab').keys()] → [0,1]（不抛）
    const r = call(`export function f() { return [...Array.from('ab').keys()]; }`);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    // for-of 同口径
    const r2 = call(
      `export function f() { const it = Array.from('ab').keys(); for (const x of it) return x; return 'none'; }`,
    );
    expect(isNever(r2.result)).toBe(false);
    expect(throwsError(r2.throws, "TypeError")).toBe(false);
  }
  {
    expect(val(`export function f() { const [a, b] = [1, 2]; return a + b; }`)).toEqual({
      ok: true,
      value: 3,
    });
    expect(val(`export function f() { const [a, b] = "xy"; return a + b; }`)).toEqual({
      ok: true,
      value: "xy",
    });
    expect(val(`export function f() { const [a, b] = new Set([1, 2]); return a + b; }`)).toEqual({
      ok: true,
      value: 3,
    });
    expect(
      val(`export function f() { const [a] = new Map([["k", 1]]); return a[1]; }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    const r = call(`export function f(x) { const [y] = x; return y; }`, "f", [anyAbs]);
    expect(formatAbs(r.result)).toContain("any");
  }
  {
    const r = call(`export function f() { const [x] = 1; return x; }`);
    expect(formatAbs(r.throws as never)).toContain("TypeError");
  }
  {
    expect(
      val(`export function f() { function* g() { yield 4; yield 5; } const [a, b] = g(); return a + b; }`),
    ).toEqual({ ok: true, value: 9 });
    expect(
      val(`export function f() { const [a, b] = [1, 2].entries(); return a[0] + b[1]; }`),
    ).toEqual({ ok: true, value: 2 });
  }
});











});

// ---------------------------------------------------------------------------
// switch 臂内（含 if 臂内）的 break 退出 switch
// ---------------------------------------------------------------------------
describe("switch 臂内（含 if 臂内）的 break 退出 switch", () => {
/**
 * 回归（core 转译层）：switch 臂内（含 **if 臂内**）的 break 必须
 * **退出 switch**。
 *
 * 修复前：switch 臂内的 break 发射 `return;`——只结束**最近的 thunk**。
 * 于是 if 臂里的 break 只结束 if 臂 thunk ⇒ 臂内后续语句照跑（静态贯穿
 * 合流也照串）：`switch (1) { case 1: if (true) break; r += "x"; }` 原生
 * 返回 ""，修复前返回 "x"。
 *
 * 修复后：switch 臂内的 break 发射**带标签**的 break 信号
 * （`$loopBreak(<switch 标签>)`）——信号穿过嵌套 thunk（if 臂），由 switch
 * 臂入口的 catch 吸收 ⇒ 臂结束、switch 随之结束；带标签 ⇒ 外层循环不吸收
 * （`$isBreakTo` 只匹配同标签）。
 *
 * 负控制钉住：① 循环内的 break 仍退出**循环**（不是 switch）；② 循环内的
 * continue 仍退出**循环**；③ 带标签 break 仍指向带标签块；④ 裸 break（臂
 * 顶层）仍退出 switch。
 */




/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string): unknown {
  const r = call(`export function f() { ${body} }`, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}


  it("if 臂里的 break 退出 switch（原生 \"\"）；if 臂里的 break 退出 switch（块形态）；if/else 形态：else 分支的 break 也退出 switch；命中第二个 case 时，if 臂里的 break 不影响 default 臂；条件 break：假分支继续贯穿（原生 \"bb\"）；条件 break：真分支退出 switch（原生 \"\"）；负控制：臂内循环的 break 退出循环（不是 switch）；负控制：臂内循环的 continue", () => {
  {
    const body = `let r = ""; switch (1) { case 1: if (true) break; r += "x"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  }
  {
    const body = `let r = ""; switch (1) { case 1: if (true) { break; } r += "x"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  }
  {
    const body = `let r = ""; switch (1) { case 1: if (false) { r += "n"; } else { break; } r += "y"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  }
  {
    const body = `let r = ""; switch (2) { case 1: r += "1"; break; case 2: if (true) break; r += "2"; default: r += "d"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  }
  {
    const body = `function f(c) { let r = ""; switch (1) { case 1: if (c) break; r += "b"; case 2: r += "b"; break; } return r; } return f(false);`;
    expect(native(body)).toBe("bb");
    expect(engine(body)).toBe("bb");
  }
  {
    const body = `function f(c) { let r = ""; switch (1) { case 1: if (c) break; r += "b"; case 2: r += "b"; break; } return r; } return f(true);`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  }
  {
    const body = `let r = ""; switch (1) { case 1: for (let i = 0; i < 3; i++) { if (i === 1) break; r += "f"; } r += "g"; } return r;`;
    expect(native(body)).toBe("fg");
    expect(engine(body)).toBe("fg");
  }
  {
    const body = `let r = ""; switch (1) { case 1: for (let i = 0; i < 3; i++) { if (i === 1) continue; r += "f"; } r += "g"; } return r;`;
    expect(native(body)).toBe("ffg");
    expect(engine(body)).toBe("ffg");
  }
  {
    const body = `let r = ""; outer: { switch (1) { case 1: break outer; } r += "x"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  }
  {
    const body = `let r = ""; switch (1) { case 1: r += "a"; break; } r += "b"; return r;`;
    expect(native(body)).toBe("ab");
    expect(engine(body)).toBe("ab");
  }
});






  // --- 负控制 ---------------------------------------------------------




});

// ---------------------------------------------------------------------------
// for (var x of …) 头绑定是函数级共享绑定
// ---------------------------------------------------------------------------
describe("for (var x of …) 头绑定是函数级共享绑定", () => {
/**
 * 回归：`for (var x of …)` / `for (var k in …)` 的**头绑定作用域**。
 *
 * ES 语义（ForIn/OfHeadEvaluation）：
 * - `var` 头是**函数级**绑定（提升到函数体/模块体顶部）——循环**共享同一
 * 个绑定**，循环**之后仍可见**，且值 = 最后一次迭代的项；
 * - `let` / `const` 头是**块级、每轮新绑定**（per-iteration）——循环后
 * 不可见，闭包各捕获各的轮次值。
 *
 * 修复前：头绑定一律实现成「回调形参」⇒ ① 形参遮蔽函数级 `var` 槽 ⇒
 * 循环外读 `x` 恒 `undefined`；② 每轮是**新形参绑定** ⇒ 闭包捕获值错
 * （原生 `var` 共享 ⇒ 全部看到末轮值）。
 *
 * 不变量（负控制钉住）：`let` / `const` 头的 per-iteration 语义不变；
 * `var` 头在**循环体内**可见；模块级 `var` 头同样提升。
 */





/** 引擎求值结果字面量值 */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 原生 oracle（new Function，strict ESM 语义） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("循环后 var 头仍可见（typeof x === number）；循环后 var 头持有末轮值；for (var k in …) 头同样是函数级绑定；for (var k in …) 头持有末轮键；var 头共享同一绑定（闭包全部看到末轮值）；for (var k in …) 头共享同一绑定（闭包看到末轮键）；var 头在循环体内可见（逐轮读到当轮项）；var 头可再赋（var 是可写绑定）；var 头解构：子名同样是函数级绑定（末轮值）；var 头解构：子名在循环后仍可见", () => {
  {
    const src = wrap(`for (var x of [1,2]) {} return typeof x;`);
    expect(v(src)).toEqual({ ok: true, value: "number" });
    expect(native(`for (var x of [1,2]) {} return typeof x;`)).toBe("number");
  }
  {
    const src = wrap(`for (var x of [1,2]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
    expect(native(`for (var x of [1,2]) {} return x;`)).toBe(2);
  }
  {
    const src = wrap(`for (var k in {a:1}) {} return typeof k;`);
    expect(v(src)).toEqual({ ok: true, value: "string" });
    expect(native(`for (var k in {a:1}) {} return typeof k;`)).toBe("string");
  }
  {
    const src = wrap(`for (var k in {a:1,b:2}) {} return k;`);
    expect(v(src)).toEqual({ ok: true, value: "b" });
    expect(native(`for (var k in {a:1,b:2}) {} return k;`)).toBe("b");
  }
  {
    const src = wrap(`const fs=[]; for (var x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "2,2" });
    expect(native(`const fs=[]; for (var x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`)).toBe(
      "2,2",
    );
  }
  {
    const src = wrap(`const fs=[]; for (var k in {a:1}) fs.push(()=>k); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "a" });
  }
  {
    const src = wrap(`let seen=[]; for (var x of [1,2]) { seen.push(x); } return seen.join(",")+"|"+x;`);
    expect(v(src)).toEqual({ ok: true, value: "1,2|2" });
    expect(native(`let seen=[]; for (var x of [1,2]) { seen.push(x); } return seen.join(",")+"|"+x;`)).toBe(
      "1,2|2",
    );
  }
  {
    const src = wrap(`for (var x of [1,2]) { x = x + 10; } return x;`);
    expect(v(src)).toEqual({ ok: true, value: 12 });
  }
  {
    const src = wrap(`for (var {a} of [{a:1},{a:2}]) {} return a;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
    expect(native(`for (var {a} of [{a:1},{a:2}]) {} return a;`)).toBe(2);
  }
  {
    const src = wrap(`for (var {a} of [{a:1}]) {} return typeof a;`);
    expect(v(src)).toEqual({ ok: true, value: "number" });
  }
  {
    const src = wrap(`{ for (var y of [1,2]) {} } return typeof y;`);
    expect(v(src)).toEqual({ ok: true, value: "number" });
    expect(native(`{ for (var y of [1,2]) {} } return typeof y;`)).toBe("number");
  }
});












describe("产品面：nudo check 签名不再折出 undefined", () => {
  const NUDO_SRC = `
export const numArr = array(number());
export const numOrUndef = union(number(), lit(undefined));
`;
  const opts = sidecarOpts("std163c", NUDO_SRC, "/t/b163.js");
  const IMP = `/// @nudo:import { numArr, numOrUndef } from "./std163c.nudo.js"\n`;

  it("for (var x of items) 后的 x 折出 number 臂（不再是恒 undefined）", () => {
    const r = checkSource___nudojs_core(
      "/t/b163.js",
      IMP +
        `
/**
 * @nudo:contract items numArr
 */
export function f(items) {
  for (var x of items) {}
  return x;
}
`,
      pTrue___nudojs_core,
      opts,
    );
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).toMatch(/number/);
    expect(sigOf(r, "f")).not.toMatch(/=> undefined$/);
  });
});

describe("负控制：let / const 头的 per-iteration 语义不变", () => {
  it("for (let x of …) 循环后不可见；for (const x of …) 循环后不可见；for (let x of …) 闭包各捕获各轮（per-iteration）；for (const x of …) 闭包各捕获各轮；for (let k in …) 循环后不可见；普通 var（非头）提升语义不变", () => {
  {
    const src = wrap(`for (let x of [1,2]) {} return typeof x;`);
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
    expect(native(`for (let x of [1,2]) {} return typeof x;`)).toBe("undefined");
  }
  {
    const src = wrap(`for (const x of [1,2]) {} return typeof x;`);
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  }
  {
    const src = wrap(`const fs=[]; for (let x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "1,2" });
    expect(native(`const fs=[]; for (let x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`)).toBe(
      "1,2",
    );
  }
  {
    const src = wrap(`const fs=[]; for (const x of [1,2]) fs.push(()=>x); return fs.map(f=>f()).join(",");`);
    expect(v(src)).toEqual({ ok: true, value: "1,2" });
  }
  {
    const src = wrap(`for (let k in {a:1}) {} return typeof k;`);
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  }
  {
    const src = wrap(`var y = 5; return y + 1;`);
    expect(v(src)).toEqual({ ok: true, value: 6 });
  }
});





});
});

// ---------------------------------------------------------------------------
// 指令作用范围按 AST 节点身份（字符区间）
// ---------------------------------------------------------------------------
describe("指令作用范围按 AST 节点身份（字符区间）", () => {
/**
 * 回归（core 转译层）：@nudo:as / @nudo:replace 的作用范围按
 * **AST 节点身份**（源文本字符区间）判定，不是「同一行号窗口」。
 *
 * 修复前：`matchAsOverride` / `matchReplacement` 只看行号
 * （`line >= stmtStart && line <= stmtEnd`）→ 同一行号窗口里的其它子表达式
 * （同行下一条语句、嵌套块、嵌套函数体）被误覆盖/误替换。
 *
 * 修复后：登记的是**具体节点**的字符区间 → 只有那个节点命中。
 * 负控制钉住：被登记的节点**仍**被覆盖/替换（本次修复不削弱指令效果）。
 */





/** 结果字面量值（非字面量 → "not-lit"） */
function lit(a: Abs): unknown {
  const r = litValue___nudojs_core_1(a);
  return r.ok ? r.value : "not-lit";
}

/** 源文本中某个片段的字符区间（AST 节点身份） */
function rangeOf(src: string, needle: string, len = needle.length): { start: number; end: number } {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  return { start, end: start + len };
}

/** `= <ident>;` 里的标识符区间（该语句的绑定名节点） */
function identRangeOf(src: string, needle: string): { start: number; end: number } {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`needle not found: ${needle}`);
  const start = at + 2; // "= " 之后
  return { start, end: start + 1 };
}


  it("@nudo:as 只覆盖被登记的那条语句（同行下一条不受影响）；@nudo:as 仍覆盖被登记的那条语句（负控制）；@nudo:replace 只命中被登记的那个节点（同行同文本的兄弟节点不受影响）；@nudo:replace 仍替换被登记的那个节点（负控制：兄弟节点不被波及）", () => {
  {
    const src = `export function f(a) {
  const x = a; const y = a;
  return y;
}
`;
    const first = rangeOf(src, "const x = a;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: first.start, stmtEnd: first.end }],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    // 被登记的是第一条语句 → 第二条（const y = a）**未**被覆盖 → 返回 a 的值 5
    expect(lit(rec.result)).toBe(5);
  }
  {
    const src = `export function f(a) {
  const x = a; const y = a;
  return y;
}
`;
    const second = rangeOf(src, "const y = a;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs },
      asOverrideTargets: [{ varName: "__as0", stmtStart: second.start, stmtEnd: second.end }],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    expect(lit(rec.result)).toBe("s");
  }
  {
    const src = `export function f(a) {
  const x = a; const y = a;
  return x * 10 + y;
}
`;
    const first = identRangeOf(src, "= a;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      replacements: { __rep0: $lit(100) as Abs },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: first.start, stmtEnd: first.end },
      ],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    // 只有第一条语句的 a 被替换 → 100 * 10 + 5
    expect(lit(rec.result)).toBe(1005);
  }
  {
    const src = `export function f(a) {
  const x = a; const y = a;
  return x * 10 + y;
}
`;
    const secondStart = src.lastIndexOf("= a;") + 2;
    const exports = runTranspiled(src, {
      mode: "analyze",
      replacements: { __rep0: $lit(100) as Abs },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: secondStart, stmtEnd: secondStart + 1 },
      ],
    });
    const rec = callTranspiledExportFull(exports, "f", [$lit(5) as Abs]);
    // 只有第二条语句的 a 被替换 → 5 * 10 + 100
    expect(lit(rec.result)).toBe(150);
  }
});




});

// ---------------------------------------------------------------------------
// switch 的 case 测试命中即停
// ---------------------------------------------------------------------------
describe("switch 的 case 测试命中即停", () => {
/**
 * 回归（core 转译层）：`switch` 的 **case 测试按源码序求值，命中即停**。
 *
 * 修复前：发射面把 case 测试当**普通实参内联**——`$switch(disc, [{ test: t(1) },
 * { test: t(2) }])` 的实参数组在**进入 switch 之前**全部求值（JS 实参语义）
 * ⇒ 命中第一个 case 后**后续 case 测试仍会执行**（求值顺序 / 副作用错）。
 *
 * 修复后：case 测试改为 **getter**（`{ get test() { … } }`）——`$switch` 按序
 * 匹配时才读 `c.test` ⇒ 只求值到命中为止（原生 CaseBlock 语义）。抽象判别式
 * 路径（`$switch` 不读 getter）由臂入口补求值全部 case 测试（上界）。
 *
 * 负控制钉住：① 每个 case 测试**只求值一次**；② 抽象判别式下 case 测试
 * 仍全部求值（副作用不丢）；③ 相邻形态（if/else 判别）不受影响。
 */





/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string, args: unknown[] = []): unknown {
  const r = call(
    `export function f(x) { ${body} }`,
    "f",
    args.map(() => anyAbs),
  );
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}


  it("命中第一个 case：后续 case 测试不求值（原生 1）；命中第二个 case：第一个 case 测试仍求值（原生 2）；全不命中：所有 case 测试都求值（原生 2）；命中即停：命中后的 case 测试的副作用不发生（原生 \"t1,one\"）；命中即停：命中后的 case 体的副作用也不发生（原生 101）；负控制：每个 case 测试只求值一次（原生 1）；负控制：抽象判别式下 case 测试全部求值（副作用不丢）；负控制：相邻形态（if/else 判别）不受影响", () => {
  {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (1){case t(1):break; case t(2):break;} return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  }
  {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (2){case t(1):break; case t(2):break;} return n;`;
    expect(native(body)).toBe(2);
    expect(engine(body)).toBe(2);
  }
  {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (9){case t(1):break; case t(2):break;} return n;`;
    expect(native(body)).toBe(2);
    expect(engine(body)).toBe(2);
  }
  {
    const body = `const log=[]; function t(v){log.push("t"+v);return v;} switch (1){case t(1):log.push("one");break; case t(2):log.push("two");break;} return log.join(",");`;
    expect(native(body)).toBe("t1,one");
    expect(engine(body)).toBe("t1,one");
  }
  {
    const body = `let n=0; function t(v){n=n+1;return v;} switch (1){case t(1): n+=100; break; case t(2): n+=200; break;} return n;`;
    expect(native(body)).toBe(101);
    expect(engine(body)).toBe(101);
  }
  {
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (1){case t(1):break;} return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  }
  {
    // 判别式为抽象值 ⇒ 判不出命中 ⇒ 全部 case 测试求值 = 原生上界
    const body = `let n = 0; function t(v){n=n+1;return v;} switch (x){case t(1):break; case t(2):break;} return n;`;
    expect(engine(body)).toBe(2);
  }
  {
    const body = `let n=0; function t(v){n=n+1;return v;} if (1===1) { n+=t(1); } return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  }
});





  // --- 负控制 ---------------------------------------------------------



});

// ---------------------------------------------------------------------------
// switch 的 case 测试副作用不被臂入口快照抹掉
// ---------------------------------------------------------------------------
describe("switch 的 case 测试副作用不被臂入口快照抹掉", () => {
/**
 * 回归（core 转译层）：`switch` 的 **case 测试副作用不被臂入口快照抹掉**。
 *
 * 修复前：臂入口按「switch 前的快照」恢复绑定（`n = $copy(__sw0_n)`）——而
 * case 测试的副作用发生在**快照之后、臂体之前** ⇒ 被恢复动作**整体抹掉**：
 * `switch (1) { case t(1): n = n + 10; break; }` 原生 n = 11，修复前 n = 10。
 *
 * 修复后：case 测试求值后**刷新基线**（`__sw0_*`）⇒ 臂入口恢复的是「case
 * 测试之后」的状态 ⇒ 测试里的写保留（臂体仍以基线为起点 ⇒ 臂间隔离不变）。
 *
 * 负控制钉住：① 臂体的写仍以基线为起点（臂间隔离不破）；② 无 case 测试的
 * switch 不受影响；③ case 测试求值**恰好一次**（不重复计数）。
 */





/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string, withArg = false): unknown {
  const r = call(`export function f(x) { ${body} }`, "f", withArg ? [anyAbs] : []);
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}


  it("case 测试的写保留（原生 11）；case 测试的副作用日志保留（原生 \"t1,one\"）；未命中时前面 case 测试的副作用保留（原生 \"t1,t2,two\"）；抽象判别式下 case 测试的副作用同样保留（上界）；负控制：case 测试只求值一次（不重复计数，原生 1）；负控制：无 case 测试的 switch 不受影响（原生 5）；负控制：臂体的写仍以基线为起点（臂间隔离不破）", () => {
  {
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (1){case t(1): n = n + 10; break;} return n;`;
    expect(native(body)).toBe(11);
    expect(engine(body)).toBe(11);
  }
  {
    const body = `const log=[]; function t(v){log.push("t"+v);return v;} switch (1){case t(1): log.push("one"); break;} return log.join(",");`;
    expect(native(body)).toBe("t1,one");
    expect(engine(body)).toBe("t1,one");
  }
  {
    const body = `const log=[]; function t(v){log.push("t"+v);return v;} switch (2){case t(1): log.push("one"); break; case t(2): log.push("two"); break;} return log.join(",");`;
    expect(native(body)).toBe("t1,t2,two");
    expect(engine(body)).toBe("t1,t2,two");
  }
  {
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (x){case t(1): break; case t(2): break;} return n;`;
    expect(engine(body, true)).toBe(2);
  }
  {
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (1){case t(1): break;} return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  }
  {
    const body = `let n = 0; switch (1){default: n = 5;} return n;`;
    expect(native(body)).toBe(5);
    expect(engine(body)).toBe(5);
  }
  {
    // 命中 case 1 时：t(1) 的写（n=1）在基线里 ⇒ 臂体 n = 1 + 10 = 11
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (1){case t(1): n = n + 10; break; case t(2): n = n + 20; break;} return n;`;
    expect(native(body)).toBe(11);
    expect(engine(body)).toBe(11);
  }
});




  // --- 负控制 ---------------------------------------------------------



});

// ---------------------------------------------------------------------------
// do-while 体的 break / continue 不逃出函数
// ---------------------------------------------------------------------------
describe("do-while 体的 break / continue 不逃出函数", () => {
/**
 * 回归（core 转译层）：do-while 体的 `break` / `continue` **只作用于
 * 该循环**，不得逃出整个函数。
 *
 * 修复前：do-while 被降级成「先跑一份体，再跑 `$whileSeq(() => T, () => {体})`」
 * ——首份体在**任何循环运行时之外**执行 ⇒ 其 `break` / `continue` 发射的
 * `$loopBreak()` / `$loopContinue()` 无人吸收 ⇒ 信号冒泡出函数体 ⇒ 被记成
 * 「函数抛 NudoLoopSignal」（L2 门禁假红 + 签名退化成 unknown）。
 *
 * 修复后：体**恒在循环 thunk 内**执行（首轮用「首轮标记」把首份体移进
 * thunk）⇒ break 跳出循环、continue 转到条件求值，与原生一致。
 *
 * 负控制钉住：while / for 的 break（本就正确）、无 break/continue 的
 * do-while（轮数与返回值不变）、do-while 内的嵌套 do-while。
 */





/** 调用结果的字面量值（val 返回 litValue 的 {ok,value} 包装） */
function valOf(src: string): unknown {
  const r = val(src);
  return r.ok ? r.value : "not-lit";
}


  it("体里的 break 跳出循环（不是跳出函数）；体里的 continue 转到条件求值（首轮后不再执行体）；条件里的 break（事实臂）同样只跳出循环；负控制：无 break/continue 的 do-while 轮数与返回值不变；负控制：嵌套 do-while 的 break 只跳出内层循环；负控制：while / for 的 break 语义不受影响", () => {
  {
    const rec = call(
      `export function f() {
  let c = 0;
  do { c = c + 1; break; } while (true);
  return c;
}`,
    );
    // 修复前：throws 面 = NudoLoopSignal，结果 unknown
    expect(throwsError(rec.throws, "NudoLoopSignal")).toBe(false);
    expect(valOf(`export function f() {
  let c = 0;
  do { c = c + 1; break; } while (true);
  return c;
}`)).toBe(1);
  }
  {
    const rec = call(
      `export function f() {
  let c = 0;
  do { c = c + 1; continue; } while (false);
  return c;
}`,
    );
    expect(throwsError(rec.throws, "NudoLoopSignal")).toBe(false);
    expect(valOf(`export function f() {
  let c = 0;
  do { c = c + 1; continue; } while (false);
  return c;
}`)).toBe(1);
  }
  {
    const rec = call(
      `export function f() {
  let c = 0;
  do { if (c === 0) { c = c + 1; break; } c = c + 1; } while (true);
  return c;
}`,
    );
    expect(throwsError(rec.throws, "NudoLoopSignal")).toBe(false);
    expect(valOf(`export function f() {
  let c = 0;
  do { if (c === 0) { c = c + 1; break; } c = c + 1; } while (true);
  return c;
}`)).toBe(1);
  }
  {
    expect(valOf(`export function f() {
  let c = 0;
  do { c = c + 1; } while (c < 3);
  return c;
}`)).toBe(3);
    // 成员写 + 计数：原生 "3,3"
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  do { o.n++; c++; } while (o.n < 3);
  return [o.n, c].join(",");
}`)).toBe("3,3");
  }
  {
    expect(valOf(`export function f() {
  let c = 0;
  do { let d = 0; do { d = d + 1; break; } while (true); c = c + d; break; } while (true);
  return c;
}`)).toBe(1);
  }
  {
    expect(valOf(`export function f() {
  let c = 0;
  while (true) { c = c + 1; break; }
  return c;
}`)).toBe(1);
    expect(valOf(`export function f() {
  let c = 0;
  for (let i = 0; i < 3; i++) { c = c + 1; break; }
  return c;
}`)).toBe(1);
  }
});






});

// ---------------------------------------------------------------------------
// [merged] destructure-tmp-names
// ---------------------------------------------------------------------------
describe("destructure-tmp-names", () => {
// MERGED (topic-related bug pins): destructure-tmp-names + tmp-name-first-alloc
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>





{
/**
 * 回归：转译器的**解构临时名**（`_d0` / `_n1` / `_p0` / `_rest0`）
 * 必须与**用户标识符**避让。
 *
 * 修复前：临时名不带任何避让——用户自己声明同名标识符时，生成码出现
 * `const _d0`（用户已有 `let _d0`）⇒ **重复声明 SyntaxError** ⇒ 整个模块
 * 求值失败 ⇒ 全模块导出退化为 unknown（假 opaque-result）；另一面，函数体里
 * 的 `const _d0` 会**遮蔽**模块级同名绑定 ⇒ 用户读到错值。
 *
 * 修复后：临时名避开用户已占用的标识符（源文本里出现过的标识符词形，保守
 * 超集）；模块可正常求值，用户绑定读回真值。
 */




/** 带实参调用 f 的字面量结果 */
const v = (src: string, ...args: unknown[]): { ok: boolean; value?: unknown } =>
  litValue(callLit(src, "f", ...args).result) as { ok: boolean; value?: unknown };

describe("解构临时名与用户标识符避让", () => {
  it("用户声明 _d0：模块仍可求值（不再重复声明 SyntaxError）；用户声明 _n1（嵌套解构临时名）：模块仍可求值；用户声明 _p0（形参占位名）：模块仍可求值；用户声明 _rest0（rest 形参占位名）：模块仍可求值；用户声明 _pd0（默认参解构临时名）：模块仍可求值；负控制：无撞名时解构行为不变（精确值）", () => {
  {
    expect(
      val(`export function f() { let _d0 = 5; const { a } = { a: 1 }; return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      val(`export function f() { let _n1 = 5; const { a: { b } } = { a: { b: 1 } }; return b + _n1; }`),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      v(`export function f({ a }) { let _p0 = 5; return a + _p0; }`, { a: 1 }),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      v(`export function f([...xs]) { let _rest0 = 5; return xs.length + _rest0; }`, [1, 2]),
    ).toEqual({ ok: true, value: 7 });
  }
  {
    expect(
      v(`export function f({ a } = { a: 1 }) { let _pd0 = 5; return a + _pd0; }`, undefined),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(val(`export function f() { const { a } = { a: 1 }; return a; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const [a, b] = [1, 2]; return a + b; }`))
      .toEqual({ ok: true, value: 3 });
    expect(v(`export function f({ a }) { return a; }`, { a: 1 }))
      .toEqual({ ok: true, value: 1 });
  }
});





});
}

describe("tmp-name-first-alloc", () => {
/**
 * 收尾（批次 r21-w15）：解构临时名的**首次分配**也必须避让用户
 * 标识符。
 *
 * 背景：主体修复（本体）把避让接在**解构发射入口**
 * （emit.ts 的 emitDestructure / 形参绑定）——但模块**首条语句**即解构
 * 声明时，`_d{n}` 这个名字在避让生效**之前**就被分配（statement.ts 的
 * 首次取号处）⇒ 用户自己声明了 `_d0` 时，生成码出现**重复词法声明**
 * （`const _d0` + 用户的 `let _d0`）⇒ SyntaxError ⇒ **整个模块**求值
 * 失败 ⇒ 全部导出退化为 unknown（假 nudo:opaque-result）。
 *
 * 修法：共享计数器在**创建处**（transpile.ts）即预置避让（序号推过用户
 * 占用的 `_d{n}` / `_n{n}`），且首次取号处再走一次避让路径（覆盖自带
 * 计数器的转译单元）。
 */





/** 带实参调用 f 的字面量结果 */
const v = (src: string, ...args: unknown[]): { ok: boolean; value?: unknown } =>
  litValue(callLit(src, "f", ...args).result) as { ok: boolean; value?: unknown };

/** 调用具名导出的字面量结果 */
const callName = (
  src: string,
  name: string,
  ...args: unknown[]
): { ok: boolean; value?: unknown } =>
  litValue(callLit(src, name, ...args).result) as { ok: boolean; value?: unknown };

describe("收尾：解构临时名首次分配的避让", () => {
  it("模块首条语句即解构声明 + 用户模块级 _d0：模块可求值且值正确；后续语句解构 + 用户模块级 _d0：模块可求值且值正确；模块首条语句即嵌套解构 + 用户模块级 _n1：模块可求值且值正确；模块级 fail-closed 面解除：无关函数不再被拖成 unknown；两处解构 + 用户模块级 _d0：模块可求值且值正确；产物不与用户同名绑定重复声明（临时名让开）；负控制：无撞名时临时名与行为不变；负控制：用户 _d0 在函数体内（跨作用域）不受影响；负控制：形参占位名族（_", () => {
  {
    expect(
      val(`const { a } = { a: 1 };
const _d0 = 5;
export function f() { return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      val(`const _d0 = 5;
const { a } = { a: 1 };
export function f() { return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      val(`const { a: { b } } = { a: { b: 1 } };
const _n1 = 5;
export function f() { return b + _n1; }`),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    const src = `const { a } = { a: 1 };
const _d0 = 5;
export function g() { return 42; }
export function f() { return a + _d0; }`;
    // 撞名时整模块求值失败 ⇒ g 也退化；修后 g 可正常调用
    expect(callName(src, "g")).toEqual({ ok: true, value: 42 });
    expect(callName(src, "f")).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      val(`const { a } = { a: 1 };
const { c } = { c: 2 };
const _d0 = 5;
export function f() { return a + c + _d0; }`),
    ).toEqual({ ok: true, value: 8 });
  }
  {
    const js = transpileSource_____exec_transpile_ts(`const { a } = { a: 1 };
const _d0 = 5;
export function f() { return a + _d0; }`);
    // 引擎的解构临时名不得取用户已占用的 _d0（否则重复词法声明）
    expect(js).not.toMatch(/const _d0\b/);
    // 用户自己的声明仍在（转译器把 const 降为 let）
    expect(js).toMatch(/let _d0 =/);
  }
  {
    expect(val(`const { a } = { a: 1 }; export function f() { return a; }`)).toEqual({
      ok: true,
      value: 1,
    });
    const js = transpileSource_____exec_transpile_ts(
      `const { a } = { a: 1 }; const { b } = { b: 2 }; export function f() { return a + b; }`,
    );
    const names = [...js.matchAll(/const (_d\d+) =/g)].map((m) => m[1]);
    expect(names).toEqual(["_d0", "_d1"]);
  }
  {
    expect(
      val(`const { a } = { a: 1 };
export function f() { let _d0 = 5; return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      v(`const { a } = { a: 1 };
export function f({ b }) { let _p0 = 5; return a + b + _p0; }`, { b: 2 }),
    ).toEqual({ ok: true, value: 8 });
    expect(
      v(`const { a } = { a: 1 };
export function f([...xs]) { let _rest0 = 5; return a + xs.length + _rest0; }`, [1, 2]),
    ).toEqual({ ok: true, value: 8 });
  }
});








});
});
});

// ---------------------------------------------------------------------------
// : 早返回形态的后续路径不断言否定界（与三元写法同口径）
// ---------------------------------------------------------------------------
describe(": 早返回形态的后续路径不断言否定界（与三元写法同口径）", () => {
/**
 * 回归（core 转译层 + 契约执法面）——**判据已被
 * 修正**：早返回形态的**后续路径**上**不断言否定关系界**。
 *
 * 的做法（已撤销）：事实臂以 return/throw 结束 ⇒ else 臂（尾句全终止
 * 时 `completeElseChains` 把它收进合成的 else）即**后续路径** ⇒ 后续路径上
 * 断言**否定关系界**（`x <= 0` 为假 ⇒ `x > 0`）。
 *
 * ⚠ 该做法**不健全**：JS 里 `¬(x <= 0)` 还含 `x` 为 NaN 的情形（NaN 与任何
 * 比较皆假）⇒ 后续路径只能断定 `x > 0 ∨ x is NaN` ⇒ 断言 `x > 0` **排除了
 * NaN** ⇒ 假绿：`if (x < 0) return 0; return x;` + `return nonNeg` 被判「证成」
 * （0 诊断），而原生 x=NaN ⇒ `NaN < 0` 为假 ⇒ `return x` ⇒ 返回 NaN ⇒ 违约。
 *
 * 后续路径**不断言否定界**（事实臂窄化保留——那一侧「测试为真」⇒
 * NaN 不可达）⇒ 与三元写法（`return x < 0 ? 0 : x;`，else 臂本就无否定界
 * 窄化）**同口径**。
 *
 * ⚠ 本文件原先的头注声称 `if (x <= 0) { return 1; } return x;` 与
 * `if (x > 0) { return x; } else { return 1; }`「语义完全等价」——**不成立**：
 * 二者只在 NaN 上分叉（前者对 NaN 返回 NaN，后者返回 1）。
 *
 * 后续路径的返回项是**声明域参数**（值域已知：任意 number）⇒ 契约
 * `positive` 不蕴含 ⇒ 契约不成立（存在违约输入：x=0 / x=NaN）⇒ 判
 * `nudo:constraint-violated`（error）。
 *
 * 负控制钉住：事实臂**不**终止的普通 if/else 同样不断言否定界；返回字面量的
 * 早退形态仍判违约；四种关系算子的后续路径**同口径**（都判违约——四种形态在
 * NaN 上都违约）。
 */




/** 带 return 契约的 check（契约来自标准约束库：positive = number().gt(0)） */
function check(body: string) {
  const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
${body}`);
  return checkSource("/t/bug182.js", src, pTrue, stdOpts);
}

/** 契约违例（error 级）条数 */
function violations(r: { issues: { code: string; severity: string }[] }): number {
  return r.issues.filter((i) => i.severity === "error" && i.code === "nudo:constraint-violated").length;
}

describe("早返回形态的后续路径不断言否定界（与三元写法同口径）", () => {
  it("早返回形态：后续路径不排除 NaN ⇒ return number().gt(0) 不成立（error）；语义等价的事实臂写法仍证得（结论一致）；尾句非全终止的早退形态（早退提升路径）同口径（error）；负控制：返回字面量的早退形态仍判违约（0 不满足 positive）；负控制：事实臂不终止的普通 if/else 同样不断言否定界（判违约的依据不是否定界）；负控制：四种关系算子的后续路径**同口径**（四种形态都在 NaN 上违约）", () => {
  {
    const r = check(`export function f(x) {
  if (x <= 0) { return 1; }
  return x;
}`);
    // 原生：x=NaN ⇒ `NaN <= 0` 为假 ⇒ `return x` ⇒ 返回 NaN ⇒ 违反 positive
    // ⇒ 真违规 ⇒ error。修前（否定界窄化）判 0 error = **假绿**。
    expect(violations(r)).toBe(1);
  }
  {
    const r = check(`export function f(x) {
  if (x > 0) { return x; } else { return 1; }
}`);
    expect(violations(r)).toBe(0);
  }
  {
    const r = check(`export function f(x) {
  if (x <= 0) { return 1; }
  console.log(x);
  return x;
}`);
    expect(violations(r)).toBe(1);
  }
  {
    const r = check(`export function f(x) {
  if (x > 0) { return x; }
  return 0;
}`);
    expect(violations(r)).toBe(1);
  }
  {
    // 事实臂不终止 ⇒ else 臂**不**建立否定界（x ≤ 0 / NaN）⇒ 该臂的返回项
    // 值域 = 任意 number（**不是**「x ≤ 0」）⇒ 声明域参数的值域
    // 已知 ⇒ `positive` 不蕴含 ⇒ 契约不成立（x=0 即违约）⇒ error。
    // 判违约的**依据**是「值域 ⊄ 契约域」，不是「断言了否定界」⇒ 非假红。
    const r = check(`export function f(x) {
  if (x > 0) { console.log("pos"); } else { return x; }
  return 1;
}`);
    expect(violations(r)).toBe(1);
    expect(
      r.issues.filter((i) => i.code === "nudo:unproven-return").length,
    ).toBe(0);
  }
  {
    // 之后：后续路径**不再**断言否定界 ⇒ 四种形态同口径。
    // 四者都在 NaN 上违约（`NaN` 与任何比较皆假 ⇒ 走 `return x` ⇒ 返回 NaN
    // ⇒ 违反 positive）⇒ 四个都是 error。
    for (const op of [">=", ">", "<", "<="]) {
      expect(
        violations(
          check(`export function f(x) {
  if (x ${op} 0) { return 1; }
  return x;
}`),
        ),
      ).toBe(1);
    }
  }
});





});
});

// ---------------------------------------------------------------------------
// for 循环体接 nullish 守卫（零 L2 / 不报 may-throw）
// ---------------------------------------------------------------------------
describe("for 循环体接 nullish 守卫（零 L2 / 不报 may-throw）", () => {
/**
 * 回归：`for` 循环体**接守卫事实**（nullish + 关系）。
 *
 * ES 语义：`for (; test; )` 的测试在**每轮迭代前**求值、为真则进体 ⇒
 * 「测试为真 ⇒ 体内成立」与 `while (test) { … }` / `if (test) { … }` 的
 * 事实臂**完全等价**。
 *
 * 修复前：`ForStatement` 分支**一条守卫都没接**（`if` 接了四种、只接了
 * nullish 的 `while` 接了一种）⇒ 同一守卫事实在 `for` 被丢弃 ⇒
 * - L2 假红：`for (; v !== null; ) { return v.length; }` 报
 * 「property 'length' on null」（native 永不抛）；
 * - L1 假红：`for (; x > 0; ) { return x; }` 的返回值域丢 `> 0` 事实。
 *
 * 不变量（负控制钉住）：无守卫的 for 仍报 L2；体侧写守卫名 ⇒ 跳过收窄
 * （影子参数会吞体侧写）仍报 L2；for 主路径的循环变量（状态线程）不被
 * 影子参数顶掉。
 */





/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue___nudojs_core_2(callLit(src, "f", ...args).result);
}

const NUDO_SRC = `
export const strOrNull = union(string(), lit(null));
export const num = number();
export const posNum = number().gt(0);
`;
const opts = sidecarOpts("std183c", NUDO_SRC, "/t/b183.js");
const IMP = `/// @nudo:import { strOrNull, num, posNum } from "./std183c.nudo.js"\n`;

function check(src: string) {
  return checkSource___nudojs_core_1("/t/b183.js", IMP + src, pTrue___nudojs_core_1, opts);
}


  it("for (; v !== null; ) { return v.length; } 零 L2（native 永不抛）；与 while 写法结论一致（同守卫同机制）；for 体内的 nullish 守卫对成员读生效（v.length 不撞 null 臂）", () => {
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (; v !== null; ) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  while (v !== null) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (; v !== null; ) {
    const n = v.length;
    if (n < 0) return 0;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
  }
});




describe("for 循环体接关系守卫（L1 契约成立）", () => {
  it("for (; x > 0; ) { return x; } 满足 return number().gt(0)；与 if 写法结论一致（同守卫同机制）", () => {
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  for (; x > 0; ) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  if (x > 0) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
  }
});

});

describe("引擎求值：for 头的测试语义不变", () => {
  it("for (; v !== null; ) 在 v 为 null 时不进体（返回 0）；for (; v !== null; ) 在 v 为字符串时进体（返回长度）；for 主路径的循环变量不被影子参数顶掉（i 逐轮递增）", () => {
  {
    const src = `export function f(v) { for (; v !== null; ) { return v.length; } return 0; }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
  }
  {
    const src = `export function f(v) { for (; v !== null; ) { return v.length; } return 0; }`;
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `export function f() { let s = 0; for (let i = 0; i < 3; i++) { s = s + i; } return s; }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  }
});


});

describe("负控制：无守卫 / 体侧写守卫名 ⇒ 仍报 L2", () => {
  it("无守卫的 for 体内读 null 臂成员仍报 L2；体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L2", () => {
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (let i = 0; i < 1; i++) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (; v !== null; ) {
    v = null;
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  }
});

});
});

// ---------------------------------------------------------------------------
// switch 的 case 标签产生窄化事实
// ---------------------------------------------------------------------------
describe("switch 的 case 标签产生窄化事实", () => {
/**
 * 回归（core 转译层）：`switch` 的 **case 标签产生窄化事实**。
 *
 * 修复前：case 标签不产生任何窄化事实 ⇒ 臂内既不知道「本臂命中哪个字面量」，
 * 也不知道「其它臂排除了哪些字面量」：
 * - 命中事实缺失：`switch (x) { case 1: return x; default: return 2; }` 的返回
 * 域含未窄化的 number ⇒ L1 契约 `return number().gt(0)` 假红；
 * - 排除事实缺失：`switch (v) { case null: return 0; default: return v.length; }`
 * 的 default 臂仍可能 v === null ⇒ `v.length` 判 may-throw ⇒ L2 假红。
 *
 * 修复后：case 标签产出**命中事实**（判别值在本臂等于该字面量）与**排除事实**
 * （本臂之外的标签值在本臂被排除）：
 * - 标识符判别式：命中事实以影子重绑表达（臂内判别值 = 该字面量）；排除事实
 * 只有 nullish 标签可表达（$removeNull / $removeUndefined / $removeNullish）。
 * - 成员判别式（`switch (o.kind)`）：命中 / 排除事实均走 $narrowMemberEq。
 *
 * 负控制钉住：① 臂内写判别绑定时**跳过**窄化（影子参数会吞掉臂内写）；② 非
 * 字面量 case 标签不产事实；③ 相邻形态（if/else 判别）不受影响。
 */










/** 抽象 number 判别值（非字面量 ⇒ switch 走抽象路径） */
const NUMBER_ABS = abs({ k: "prim", type: "number" }, undefined, pTrue_____pred_ts, "exact");
/** string | null 判别值 */
const STR_OR_NULL = joinAbs(
  abs({ k: "prim", type: "string" }, undefined, pTrue_____pred_ts, "exact"),
  $lit(null),
);

/** 引擎求值（结果面 + throws 面） */
function engine(src: string, arg: unknown): { result: string; throws: string } {
  const r = call(src, "f", [arg as never]);
  return {
    result: formatAbs(r.result as never),
    throws: formatAbs((r as { throws?: unknown }).throws as never),
  };
}

/** 不相交判别联合（TS 判别联合正典形态：两 lit 臂）——成员判别式窄化用 */
const DISJOINT_SRC = `
import { string, shape, union, lit, nullable, array } from "@nudojs/core";
const asUnion = union(
  shape({ type: lit('Identifier'), name: string() }),
  shape({ type: lit('TemplateLiteral'),
          expressions: array(shape({})),
          quasis: array(shape({ value: shape({ cooked: string().optional() }) })) }),
);
export const nodeParam = nullable(asUnion);
`;
const DISC_IMP = `/// @nudo:import { nodeParam } from "./std126.nudo.js"\n`;

/** checkSource + 判别联合侧车 */
function checkDisc(src: string) {
  return checkSource(
    "/t/disc-narrow-184.js",
    DISC_IMP + src,
    pTrue_____pred_ts,
    sidecarOpts("std126", DISJOINT_SRC),
  );
}


  it("命中事实：`case 1:` 臂内判别值 = 字面量 1（返回域 1 | 2）；排除事实：`default:` 臂排除 `case null` ⇒ v.length 不判 may-throw；排除事实：`case null:` 之外的臂（`case 1:`）同样排除 null；多个 case 标签：命中事实取并集（1 | 2 | 3）；负控制：臂内写判别绑定 ⇒ 跳过窄化（影子参数会吞掉臂内写）；负控制：非字面量 case 标签不产事实（臂内判别值不被改写）；负控制：相邻形态", () => {
  {
    const src = `export function f(x) { switch (x) { case 1: return x; default: return 2; } }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.result).toContain("1");
    expect(r.result).toContain("2");
    expect(r.throws).toContain("never");
  }
  {
    const src = `export function f(v) { switch (v) { case null: return 0; default: return v.length; } }`;
    const r = call(src, "f", [STR_OR_NULL]);
    expect(throwsError((r as { throws?: unknown }).throws, "TypeError")).toBe(false);
  }
  {
    const src = `export function f(v) { switch (v) { case 1: return v.length; default: return 0; } }`;
    const r = call(src, "f", [STR_OR_NULL]);
    expect(throwsError((r as { throws?: unknown }).throws, "TypeError")).toBe(false);
  }
  {
    const src = `export function f(x) { switch (x) { case 1: return x; case 2: return x; default: return 3; } }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.result).toContain("1");
    expect(r.result).toContain("2");
    expect(r.result).toContain("3");
  }
  {
    const src = `export function f(x) { switch (x) { case 1: x = 5; return x; default: return 2; } }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.result).toContain("5");
  }
  {
    const src = `export function f(x) { switch (x) { case x + 1: return x; default: return 2; } }`;
    const r = engine(src, NUMBER_ABS);
    // 未窄化：返回域含未窄化的 number（不是字面量 1）
    expect(r.result).not.toContain("1 |");
  }
  {
    const src = `export function f(x) { if (x === 1) { return x; } return 2; }`;
    const r = engine(src, NUMBER_ABS);
    expect(r.throws).toContain("never");
  }
  {
    const r = checkDisc(`/**
 * @nudo:contract node nodeParam
 */
export function switchForm(node) {
  if (!node) return null;
  switch (node.type) {
    case 'TemplateLiteral': return node.quasis[0];
    default: return null;
  }
}`);
    expect(l2Count(r, "switchForm")).toBe(0);
  }
  {
    const r = checkDisc(`/**
 * @nudo:contract node nodeParam
 */
export function switchFormNonLit(node) {
  if (!node) return null;
  switch (node.type) {
    case 'Template' + 'Literal': return node.quasis[0];
    default: return null;
  }
}`);
    expect(l2Count(r, "switchFormNonLit")).toBe(1);
  }
});




  // --- 负控制 ---------------------------------------------------------



  // --- 成员判别式（switch (o.kind)）--------------------------------------


});

// ---------------------------------------------------------------------------
// [merged] dowhile-rel-guard
// ---------------------------------------------------------------------------
describe("dowhile-rel-guard", () => {
// MERGED (topic-related bug pins): dowhile-rel-guard + while-rel-guard
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * 同构缺口回归：`do-while` 分支的**关系守卫**接线。
 *
 * ES 语义：`do { B } while (T)` —— 体 B **先**执行一次，之后每轮迭代前求
 * 测试 T；T 为真则再进体 ⇒ 「T 为真 ⇒ 体内成立」与 `if (T) { B }` 的事实臂
 * 等价（**第 2 轮起**）；**首轮**先于任何测试求值 ⇒ 首轮体内无该事实。
 *
 * 修复前：do-while 分支的守卫只取 `nullishGuardsOf` ⇒ **关系守卫**
 * （`relGuardOf`：`x > 0`）一次都没接进体侧 ⇒ 体内 x 折不出 > 0 事实 ⇒
 * `@nudo:contract return number().gt(0)` 被判违约（L1 假红），而同机制的
 * `for` / `while`（含 nullish 守卫）都是绿的 ⇒ 同一机制内部不自洽。
 *
 * 不变量（负控制钉住）：**首轮**拷贝保持未收窄（先于测试求值 ⇒ 无事实，
 * sound）；体侧写守卫名 ⇒ 跳过收窄（影子参数会吞体侧写）仍报 L1；nullish
 * 守卫接线不回归；循环体外的读不携带关系事实；引擎求值语义不变。
 */





/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

const NUDO_SRC = `
export const num = number();
export const posNum = number().gt(0);
export const posOrZero = union(number().gt(0), lit(0));
export const strOrNull = union(string(), lit(null));
`;
const opts = sidecarOpts("std185dw", NUDO_SRC, "/t/b185dw.js");
const IMP = `/// @nudo:import { num, posNum, posOrZero, strOrNull } from "./std185dw.nudo.js"\n`;

function check(src: string) {
  return checkSource___nudojs_core_2("/t/b185dw.js", IMP + src, pTrue___nudojs_core_2, opts);
}

/** L1 契约违约数 */
function l1(r: ReturnType<typeof check>): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

/**
 * L1 **返回义务**诊断数（违约 error + 证不出 warning）。
 * `x: number()` 是**无界** prim ⇒ 返回义务「既证不出、也反证不了」
 * ⇒ 无界证据下判 `nudo:unproven-return`（warning）而非 `nudo:constraint-violated`
 * （error，确定违约）。「仍报 L1」的不变量按**返回义务诊断**计。
 */
function l1Return(r: ReturnType<typeof check>): number {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return",
  ).length;
}

describe("同构缺口 — do-while 体侧接关系守卫（L1 契约成立）", () => {
  it("第 2 轮起体内成立 x > 0 事实 ⇒ return x 满足契约；与 while 写法结论一致（同守卫换结构结论相同）", () => {
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posOrZero
 */
export function f(x) {
  let n = 0;
  do {
    n = n + 1;
    if (n === 2) return x;
  } while (x > 0);
  return 0;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(l1(r)).toBe(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(l1(r)).toBe(0);
  }
});

});

describe("同构缺口 — 负控制：收窄不越界 / 接线不回归", () => {
  it("首轮拷贝保持未收窄（先于测试求值 ⇒ 无 > 0 事实，仍报 L1）；体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1；循环体外的读不携带关系事实（仍报 L1）；do-while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）", () => {
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  do {
    return x;
  } while (x > 0);
}
`);
    // 无界证据（无 > 0 事实）⇒ 判「证不出」（warning）而非「确定违约」
    expect(l1Return(r)).toBeGreaterThan(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  do {
    x = 0;
    return x;
  } while (x > 0);
}
`);
    expect(l1(r)).toBeGreaterThan(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  do {
    const y = 1;
    if (y < 0) return 0;
  } while (x > 0);
  return x;
}
`);
    // 循环体外的读不携带关系事实 ⇒ 无界证据 ⇒ 判「证不出」（warning）
    expect(l1Return(r)).toBeGreaterThan(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  let n = 0;
  do {
    n = n + 1;
    if (n === 1) return 0;
    return v.length;
  } while (v !== null);
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
});



});

describe("同构缺口 — 引擎求值：do-while 语义不变", () => {
  it("do-while 体至少执行一次（先于测试）；第 2 轮的 return 取到 x（运行时取值不变）", () => {
  {
    const src = `export function f(x) { let n = 0; do { n = n + 1; if (n === 3) return n; } while (x > 0); return n; }`;
    expect(v(src, -1)).toEqual({ ok: true, value: 1 });
    expect(v(src, 5)).toEqual({ ok: true, value: 3 });
  }
  {
    const src = `export function f(x) {
      let n = 0;
      do {
        n = n + 1;
        if (n === 2) return x;
      } while (x > 0);
      return 0;
    }`;
    expect(v(src, 5)).toEqual({ ok: true, value: 5 });
    expect(v(src, -1)).toEqual({ ok: true, value: 0 });
  }
});

});
}

describe("while-rel-guard", () => {
/**
 * 回归：`while` 循环体接**关系守卫**（`x > 0`）。
 *
 * ES 语义：`while (test)` 的测试在每轮迭代前求值、为真则进体 ⇒ 「测试为
 * 真 ⇒ 体内成立」与 `if (test) { … }` 的事实臂**完全等价**。
 *
 * 修复前：`while` 分支的 `loopGuards` **只**取 `nullishGuardsOf` ⇒ 关系
 * 守卫（`relGuardOf`）在 `while`/`do-while` 分支里一次都没出现 ⇒
 * `while (x > 0) { return x; }` 的体内 x 仍是入口处的 `number`（无 `> 0`
 * 事实）⇒ `@nudo:contract return number().gt(0)` 被判违约（L1 假红），
 * 而同机制的 `while (v !== null)`（nullish 守卫）是**绿**的 ⇒ 同一机制
 * 内部不自洽。
 *
 * 不变量（负控制钉住）：nullish 守卫接线不回归；体侧写守卫名 ⇒ 跳过收窄
 * （影子参数会吞体侧写）仍报 L1；循环体外的读不携带关系事实。
 */





/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

const NUDO_SRC = `
export const num = number();
export const posNum = number().gt(0);
export const strOrNull = union(string(), lit(null));
`;
const opts = sidecarOpts("std185c", NUDO_SRC, "/t/b185.js");
const IMP = `/// @nudo:import { num, posNum, strOrNull } from "./std185c.nudo.js"\n`;

function check(src: string) {
  return checkSource___nudojs_core_2("/t/b185.js", IMP + src, pTrue___nudojs_core_2, opts);
}

describe("while 循环体接关系守卫（L1 契约成立）", () => {
  it("while (x > 0) { return x; } 满足 return number().gt(0)；与 if 写法结论一致（同守卫换结构结论相同）；while (x >= 0) 的关系事实同样接进体内", () => {
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  if (x > 0) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return num
 */
export function f(x) {
  while (x >= 0) {
    return x;
  }
  return 0;
}
`);
    expect(r.summary.errors).toBe(0);
  }
});


});

describe("负控制：nullish 守卫接线不回归 / 收窄不越界", () => {
  it("while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）；体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1；循环体外的读不携带关系事实（仍报 L1）", () => {
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  while (v !== null) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    x = 0;
    return x;
  }
  return 1;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    const y = 1;
    if (y < 0) return 0;
  }
  return x;
}
`);
    // 无界证据（循环体外的读不携带关系事实）⇒ 判「证不出」
    // （nudo:unproven-return，warning）而非「确定违约」（error）
    expect(
      r.issues.filter(
        (i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return",
      ).length,
    ).toBeGreaterThan(0);
  }
});


});

describe("引擎求值：while 语义不变", () => {
  it("while (x > 0) 在 x 为正时进体（返回 x）；while (x > 0) 在 x 为负时进不了体（返回 1）；while (v !== null) 的 nullish 收窄不改变取值", () => {
  {
    const src = `export function f(x) { while (x > 0) { return x; } return 1; }`;
    expect(v(src, 5)).toEqual({ ok: true, value: 5 });
  }
  {
    const src = `export function f(x) { while (x > 0) { return x; } return 1; }`;
    expect(v(src, -5)).toEqual({ ok: true, value: 1 });
  }
  {
    const src = `export function f(v) { while (v !== null) { return v.length; } return 0; }`;
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
  }
});


});
});
});

// ---------------------------------------------------------------------------
// 裸块 / try / catch / finally 内的早退补集窄化生效
// ---------------------------------------------------------------------------
describe("裸块 / try / catch / finally 内的早退补集窄化生效", () => {
/**
 * 回归：早退补集窄化的**送达范围**（嵌套语句表）。
 *
 * ES 语义：`if (v === null) { return 0; }` 早退 ⇒ **后续路径**上
 * 「v 不再是 null」⇒ 后续的 `v.length` 不撞 null 臂。这条补集事实与
 * 「早退 if 在语句表的哪一层」无关——裸块 / try 块 / catch 块 / finally 块
 * 里的同一段代码必须得到**同一**结论。
 *
 * 修复前：补集窄化只挂在「函数体顶层语句表」上（`transpileFnBodyStmts`
 * 的同层提升：同层有 `if` 早退 + 其后 `rest` 才提升）⇒ 裸块 / try / catch /
 * finally 四种形态的早退补集**全部失效** ⇒ 同一段代码换位置结论相反
 * （L2 假红：报「property 'length' on null」，而 native 永不抛）。
 *
 * 不变量（负控制钉住）：无早退守卫的嵌套块仍报 L2；非 nullish 早退守卫
 * 不产生补集窄化；块内有词法声明时不摊平（作用域不外泄）。
 */





/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue___nudojs_core_3(callLit(src, "f", ...args).result);
}

const NUDO_SRC = `
export const strOrNull = union(string(), lit(null));
export const num = number();
`;
const opts = sidecarOpts("std186c", NUDO_SRC, "/t/b186.js");
const IMP = `/// @nudo:import { strOrNull, num } from "./std186c.nudo.js"\n`;

function check(src: string) {
  return checkSource___nudojs_core_3("/t/b186.js", IMP + src, pTrue___nudojs_core_3, opts);
}


  it("裸块：{ if (v === null) { return 0; } } return v.length; 零 L2；try 块：同段代码零 L2；catch 块：同段代码零 L2；finally 块：同段代码零 L2；对照组：函数体顶层同段代码零 L2（既有口径不回归）；四种嵌套形态与顶层形态签名一致", () => {
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  {
    if (v === null) { return 0; }
  }
  return v.length;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  try {
    if (v === null) { return 0; }
    return v.length;
  } catch (e) {
    return 0;
  }
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  try {
    throw 1;
  } catch (e) {
    if (v === null) { return 0; }
    return v.length;
  }
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  try {
    return 9;
  } finally {
    if (v === null) { return 0; }
    return v.length;
  }
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  if (v === null) { return 0; }
  return v.length;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  }
  {
    const sigs = [
      `if (v === null) { return 0; } return v.length;`,
      `{ if (v === null) { return 0; } } return v.length;`,
      `try { if (v === null) { return 0; } return v.length; } catch (e) { return 0; }`,
      `try { throw 1; } catch (e) { if (v === null) { return 0; } return v.length; }`,
      `try { return 9; } finally { if (v === null) { return 0; } return v.length; }`,
    ].map((body) =>
      sigOf(
        check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  ${body}
}
`),
        "f",
      ),
    );
    for (const s of sigs) expect(s).toBe(sigs[0]);
    expect(sigs[0]).not.toMatch(/throws/);
  }
});







describe("引擎求值：嵌套形态的返回值与原生一致", () => {
  it("裸块：v 为 null → 0；v 为字符串 → 长度；try 块：v 为 null → 0；v 为字符串 → 长度；catch 块：v 为 null → 0；v 为字符串 → 长度；finally 块：v 为 null → 0；v 为字符串 → 长度", () => {
  {
    const src = `export function f(v) { { if (v === null) { return 0; } } return v.length; }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `export function f(v) { try { if (v === null) { return 0; } return v.length; } catch (e) { return 0; } }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `export function f(v) { try { throw 1; } catch (e) { if (v === null) { return 0; } return v.length; } }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `export function f(v) { try { return 9; } finally { if (v === null) { return 0; } return v.length; } }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  }
});



});

describe("负控制：无早退守卫 / 非 nullish 守卫 ⇒ 仍报 L2", () => {
  it("嵌套块内无早退守卫 → 仍报 L2；非 nullish 早退守卫（v === 1）不产生补集窄化 → 仍报 L2；块内有词法声明时不摊平（名字不外泄到函数作用域）", () => {
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  {
    const w = v;
    return w.length;
  }
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  }
  {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  {
    if (v === 1) { return 0; }
  }
  return v.length;
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  }
  {
    const src = `export function f(v) { { const w = 1; if (v === null) { return 0; } } return typeof w; }`;
    // 原生：块内 const 不在函数作用域 ⇒ typeof w === "undefined"
    expect(v(src, "ab")).toEqual({ ok: true, value: "undefined" });
  }
});


});
});

// ---------------------------------------------------------------------------
// 可选调用命中 nullish 时整链短路（剩余成员读不再求值）
// ---------------------------------------------------------------------------
describe("可选调用命中 nullish 时整链短路（剩余成员读不再求值）", () => {
/**
 * 回归：可选「调用」`o.b?.()` 命中 nullish 时必须**整链**短路。
 *
 * ES 语义：`o.b?.().c` 里 `o.b` 为 nullish ⇒ **整条链**求值为 undefined，
 * 后续的 `.c` 不得再求值、不得抛（`o.b` 非 nullish 时才调用并继续 `.c`）。
 *
 * 修复前：调用跳（invoke / invokeKey hop）的 nullish 短路臂只发
 * `$lit(void 0)`，**剩余链留在 fork 之外** ⇒ `undefined.c` 记定抛 TypeError
 * （`nudo check` 门禁假红：entry-may-throw / `property 'c' on undefined`）。
 * 成员跳（`o.b?.c`）一直是整链短路（shortCircuitHop 把剩余链放进短路臂），
 * 本次修复让调用跳与成员跳同口径。
 *
 * 不变量（负控制钉住）：非 nullish 链仍正常求值；调用跳**无尾随成员**时
 * 发射形态不变；真正该抛的 TypeError（调用结果为 null 时的 `.c`）不被吞。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_4(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

/** 整链短路：不得抛，且结果必须是精确 undefined */
function expectChainUndefined(src: string) {
  expect(throwName(src), `throws for: ${src}`).toBe("");
  expect(v(src), `result for: ${src}`).toEqual({ ok: true, value: undefined });
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("o.b?.().c on {b:null} → undefined（不抛）；o.b?.().c on {b:undefined} → undefined；o.b?.().c on {}（b 缺失） → undefined；o.b?.()['c'] on {b:null} → undefined（计算成员读同口径）；o.b?.().c.d on {b:null} → undefined（多级尾随读）；o.b?.().c?.d on {b:null} → undefined（尾随", () => {
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c;`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: undefined }; return o.b?.().c;`));
  }
  {
    expectChainUndefined(wrap(`const o = {}; return o.b?.().c;`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.()["c"];`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c.d;`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c?.d;`));
  }
  {
    expectChainUndefined(wrap(`const o = {}; return o?.m?.().c;`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; const k = "b"; return o[k]?.().c;`));
  }
  {
    expectChainUndefined(wrap(`const o = {}; const k = "b"; return o?.[k]?.().c;`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.()();`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c();`));
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.()[0];`));
  }
});













describe("负控制：非 nullish 链仍正常求值 / 既有 hop 语义不回归", () => {
  it("o.b?.().c on 函数 b → 读到 c；o.b?.().c 方法体 this 仍绑 o；o.b?.().c on 函数 b 返回 {c:{d:8}} → 多级读通；o?.m?.().c on {m:()=>({c:4})} → 读到 c；o[k]?.().c on {b:()=>({c:5})} → 读到 c；调用跳无尾随成员：o.b?.() on {b:null} → undefined；调用跳无尾随成员：o.b?.() 仍调用方法；成员跳既有语义：o?.b.c ", () => {
  {
    expect(v(wrap(`const o = { b: () => ({ c: 9 }) }; return o.b?.().c;`))).toEqual({ ok: true, value: 9 });
  }
  {
    expect(v(wrap(`const o = { v: 3, b() { return { c: this.v }; } }; return o.b?.().c;`))).toEqual({ ok: true, value: 3 });
  }
  {
    expect(v(wrap(`const o = { b: () => ({ c: { d: 8 } }) }; return o.b?.().c.d;`))).toEqual({ ok: true, value: 8 });
  }
  {
    expect(v(wrap(`const o = { m: () => ({ c: 4 }) }; return o?.m?.().c;`))).toEqual({ ok: true, value: 4 });
  }
  {
    expect(v(wrap(`const o = { b: () => ({ c: 5 }) }; const k = "b"; return o[k]?.().c;`))).toEqual({ ok: true, value: 5 });
  }
  {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.();`));
  }
  {
    expect(v(wrap(`const o = { b: () => 1 }; return o.b?.();`))).toEqual({ ok: true, value: 1 });
  }
  {
    expectChainUndefined(wrap(`const o = null; return o?.b.c;`));
  }
  {
    expect(v(wrap(`const o = { b: { c: 1 } }; return o?.b.c;`))).toEqual({ ok: true, value: 1 });
  }
  {
    expectChainUndefined(wrap(`const o = null; return o?.m();`));
  }
  {
    expect(v(wrap(`const o = { v: 5, m() { return this.v; } }; return o?.m();`))).toEqual({ ok: true, value: 5 });
  }
  {
    expect(throwName(wrap(`const o = { b: () => null }; return o.b?.().c;`))).toBe("TypeError");
  }
  {
    expect(v(wrap(`const o = { b: () => ({ c: null }) }; return o.b?.().c;`))).toEqual({ ok: true, value: null });
  }
  {
    expect(throwName(wrap(`const o = { b: null }; return o?.b().c;`))).toBe("TypeError");
  }
});













});
});

// ---------------------------------------------------------------------------
// 表达式体的写回排在表达式取值之后
// ---------------------------------------------------------------------------
describe("表达式体的写回排在表达式取值之后", () => {
/**
 * 回归：箭头 / 函数表达式**表达式体**的成员目标写回被排在
 * `return <表达式>` 之前 ⇒ `() => o.n++` 返回**写后**值（原生是写前值）。
 *
 * 修复前（表达式体发射，expr/function.ts）：先发 rebinds（写回），再
 * `return <表达式>` ⇒ 表达式读到的是**写后**状态。
 *
 * 现状说明：成员臂自增（`o.n++`）与可选链 delete 的写回都已「下沉到求值
 * 点」——表达式自身捕获写前值 / 完成删除与写回，不再有语句级补正排在
 * 表达式求值之后或之前。本回归钉住该口径：可选链 delete 的箭头表达式体
 * 直接返回自包含 IIFE，不再出现 `__mutRet` 语句级捕获与二次 `$fork` 写回；
 * async 表达式体的删除/写回仍在 `$async` thunk 内。
 *
 * 不变量（负控制钉住）：块体箭头的写回照旧发生；只读箭头取值不变；函数
 * 表达式的块体体不受影响；捕获临时名避让用户标识符（用户自己有
 * `__mutRet` 时不得 TDZ）。
 */




/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue___nudojs_core_5(callLit(src, "f", ...args).result);
}


  it("`() => o.n++` 返回写前值 0（原生同），写回仍发生（o.n = 1）；可选链 delete 的写回已下沉到表达式内（无语句级二次发射）；async 表达式体的删除/写回同在 $async thunk 内（写回不逸出 thunk）", () => {
  {
    const src = `export function f() {
      const o = { n: 0 };
      const g = () => o.n++;
      const r = g();
      return r * 100 + o.n;
    }`;
    expect(v(src)).toEqual({ ok: true, value: 1 });
  }
  {
    const js = transpileSource___nudojs_core(`export function f() {
      const o = { a: 1 };
      const g = () => delete o?.a;
      return g();
    }`);
    // 表达式体直接返回自包含删除/写回 IIFE；不再有 __mutRet 捕获与
    // 独立的语句级 $fork 写回（那会二次求值计算键 / 二次派发 Proxy 陷阱）。
    expect(js).not.toContain("let __mutRet =");
    const del = js.indexOf("$del(");
    const write = js.indexOf("o = __nudoDelN");
    expect(del).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(del);
  }
  {
    const js = transpileSource___nudojs_core(`export function f() {
      const o = { a: 1 };
      const g = async () => delete o?.a;
      return g();
    }`);
    const thunk = js.indexOf("$async(() =>");
    const del = js.indexOf("$del(");
    const write = js.indexOf("o = __nudoDelN");
    expect(thunk).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(thunk);
    expect(write).toBeGreaterThan(del);
  }
});




describe("负控制：写回 / 取值语义不被改写", () => {
  it("块体箭头的写回照旧发生；只读箭头取值不变；函数表达式的块体体不受影响（返回写前值）；捕获临时名避让用户标识符（用户自己有 __mutRet 不得 TDZ）", () => {
  {
    const src = `export function f() {
      const o = { n: 0 };
      const g = () => { o.n++; };
      g();
      return o.n;
    }`;
    expect(v(src)).toEqual({ ok: true, value: 1 });
  }
  {
    const src = `export function f() {
      const o = { n: 7 };
      const g = () => o.n;
      return g();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 7 });
  }
  {
    const src = `export function f() {
      const o = { n: 0 };
      const g = function () { return o.n++; };
      const r = g();
      return r * 100 + o.n;
    }`;
    expect(v(src)).toEqual({ ok: true, value: 1 });
  }
  {
    const src = `export function f() {
      const __mutRet = 5;
      const o = { a: 1 };
      const g = () => delete o?.a;
      const r = g();
      return r + ":" + __mutRet;
    }`;
    expect(v(src)).toEqual({ ok: true, value: "true:5" });
  }
});



});
});

// ---------------------------------------------------------------------------
// 摘下方法引用后调用不得假抛（FALSE-THROW）
// ---------------------------------------------------------------------------
describe("摘下方法引用后调用不得假抛（FALSE-THROW）", () => {
/**
 * 回归：**摘下方法引用后调用**被误判为必抛（FALSE-THROW）。
 *
 * 修复前：`const m = new A().m; m()` 折 never + throws=TypeError——原生恒不抛
 * （方法体不碰 `this` 时，`this` 只是 undefined）。根因在方法值读通道的 apply
 * 钩子：它把调用**按接收者的成员表反查**（`$invoke(recv, name, args)`），
 * 接收者不是本类实例（摘下调用时压根没有接收者）⇒「取不到方法」⇒ 假抛。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts 的 protoMethodDispatch
 * 注册回调）：用户类方法值按**方法体 + this = 接收者**执行——摘下调用时
 * `this` 恒 undefined（strict 语义），方法体真去读 `this.x` 时才定抛
 * TypeError（原生同口径）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_6(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}


  it("实例方法摘下后调用 → 正常返回（原生 this=undefined，方法体不碰 this）；静态方法摘下后调用 → 正常返回；从原型对象上摘下后调用 → 正常返回；摘下后仍是函数值（typeof → function）；摘下后调用不记 may-throw（throws 域干净——L2 门禁不再假报）；方法体真读 this 时仍定抛 TypeError（原生 this=undefined ⇒ this.x 抛）；负控制：直接调用（a.m()）不受影响", () => {
  {
    expect(
      v(wrap(`class A { m(){ return 1; } } const m = new A().m; return m();`)),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(wrap(`class A { static sm(){ return 1; } } const { sm } = A; return sm();`)),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(wrap(`class A { m(){ return 1; } } const { m } = A.prototype; return m();`)),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(wrap(`class A { m(){ return 1; } } const m = new A().m; return typeof m;`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    const rec = call(
      wrap(`class A { m(){ return 1; } } const m = new A().m; return m();`),
      "f",
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  }
  {
    expect(
      throwName(wrap(`class A { m(){ return this.x; } } const m = new A().m; return m();`)),
    ).toBe("TypeError");
  }
  {
    expect(
      v(wrap(`class A { m(){ return 1; } } return new A().m();`)),
    ).toEqual({ ok: true, value: 1 });
  }
});







});

// ---------------------------------------------------------------------------
// 非正常出口触发 IteratorClose
// ---------------------------------------------------------------------------
describe("非正常出口触发 IteratorClose", () => {
/**
 * 回归：**非正常出口必须 IteratorClose**（对用户迭代器调 `return()`）。
 *
 * ES 语义（IteratorClose / ForInOfBodyEvaluation / 数组解构）：
 * - `for-of` 循环体 `break` / `return` / `throw`（含 label break）⇒ 迭代器
 * 的 `return()` 被调用（**副作用可见**）；
 * - 数组解构模式被**填满**而迭代器尚未耗尽 ⇒ 同样 IteratorClose；
 * - `continue` 与**自然耗尽** ⇒ **不**调用 `return()`；
 * - 无 `return` 槽 ⇒ 不调用（原生无副作用）；
 * - `return` 槽是**非可调用值** ⇒ GetMethod 定抛 TypeError；
 * - `return()` 的返回值**必须是对象** ⇒ 否则定抛 TypeError（`return(){}` 无
 * 返回值即抛——原生实测）。
 *
 * 修复前：引擎从不调 `return()` ⇒ 迭代器的清理副作用**丢失**
 * （`forOfCloseOnBreak() => ""`，原生 `"ret"`）。
 */



/** 迭代器夹具：next 产 1,2,3（done 于第 4 次），return() 记 "ret" */
const IT = `const log = [];
  const it = {
    i: 0,
    next() { return { value: ++this.i, done: this.i > 3 }; },
    return() { log.push("ret"); return { done: true }; },
    [Symbol.iterator]() { return this; },
  };`;


  it("for-of 里 break ⇒ 调 return()；for-of 里条件 break ⇒ 调 return()；for-of 循环体抛错 ⇒ 调 return()（抛错被捕获后副作用可见）；label break ⇒ 调 return()；循环体里 return ⇒ 调 return()（函数返回值先算，close 副作用后置可见）；解构模式填满而迭代器未耗尽 ⇒ 调 return()；return() 的返回值不是对象 ⇒ 原生定抛 TypeError；return 槽", () => {
  {
    expect(val(`export function f() { ${IT} for (const v of it) { break; } return log.join(","); }`)).toEqual({
      ok: true,
      value: "ret",
    });
  }
  {
    expect(
      val(`export function f() { ${IT} for (const v of it) { if (v === 2) break; } return log.join(","); }`),
    ).toEqual({ ok: true, value: "ret" });
  }
  {
    expect(
      val(`export function f() { ${IT} try { for (const v of it) { throw new Error("x"); } } catch (e) { log.push("caught"); } return log.join(","); }`),
    ).toEqual({ ok: true, value: "ret,caught" });
  }
  {
    expect(
      val(`export function f() { ${IT} outer: for (const v of it) { for (let j = 0; j < 2; j++) { break outer; } } return log.join(","); }`),
    ).toEqual({ ok: true, value: "ret" });
  }
  {
    expect(
      val(`export function f() { ${IT} function g() { for (const v of it) { return "r" + v; } } const r = g(); return r + "|" + log.join(","); }`),
    ).toEqual({ ok: true, value: "r1|ret" });
  }
  {
    expect(val(`export function f() { ${IT} const [a, b] = it; return a + "," + b + "|" + log.join(","); }`)).toEqual({
      ok: true,
      value: "1,2|ret",
    });
  }
  {
    const src = `export function f() {
      const log = [];
      const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, return() { log.push("ret"); }, [Symbol.iterator]() { return this; } };
      for (const v of it) { break; }
      return log.join(",");
    }`;
    const rec = call(src, "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const src = `export function f() {
      const log = [];
      const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, return: 5, [Symbol.iterator]() { return this; } };
      for (const v of it) { break; }
      return log.join(",");
    }`;
    const rec = call(src, "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      val(`export function f() {
        const log = [];
        const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, return() { log.push("ret"); throw new Error("boom"); }, [Symbol.iterator]() { return this; } };
        try { for (const v of it) { break; } } catch (e) { log.push("caught"); }
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "ret,caught" });
  }
  {
    expect(
      val(`export function f() { ${IT} for (const v of it) { if (v === 2) continue; } return log.join(","); }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(val(`export function f() { ${IT} for (const v of it) { } return log.join(","); }`)).toEqual({
      ok: true,
      value: "",
    });
  }
  {
    expect(
      val(`export function f() {
        const log = [];
        const it = { i: 0, next() { return { value: ++this.i, done: this.i > 3 }; }, [Symbol.iterator]() { return this; } };
        for (const v of it) { break; }
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(val(`export function f() { ${IT} const [a, ...rest] = it; return a + "|" + rest.length + "|" + log.join(","); }`)).toEqual({
      ok: true,
      value: "1|2|",
    });
  }
});













});

// ---------------------------------------------------------------------------
// 用户自定义 @@iterator 被驱动（回归钉，根因由族 01 关闭）
// ---------------------------------------------------------------------------
describe("用户自定义 @@iterator 被驱动（回归钉，根因由族 01 关闭）", () => {
/**
 * 回归**钉**（不宣称新修）：用户自定义 `@@iterator` 必须被驱动。
 *
 * ── 归属说明 ─────────────────────────────────────────────────────────────
 * 本条的**根因已由族 01 的 顺带关闭**：`exec/runtime/containers/iterate.ts`
 * 在 `elemsOf` / `$iterCheck` 里实现了用户迭代器协议（`collectUserIterElems`：
 * GetIterator + IteratorNext，元素按**迭代序**取），并把迭代器对象登记到侧表
 * 供 IteratorClose 使用（见 的回归）。
 *
 * 当前 HEAD（族 01 提交 `7fea13a1` 后）**已不复现**本条症状 ⇒ 本文件只作
 * **回归钉**（防止该协议被后续改动回退），**不宣称本分片新修了 **。
 *
 * ── 已知残留（不在 S4 可改文件内）────────────────────────────────────────
 * `Array.from(userIterable)` 仍**不驱动**用户迭代器（`builtins/array.ts` 的
 * `evalArrayFrom` 只认内建可迭代面）——需 array.ts 另修。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ES 语义：对象自带 `@@iterator` 方法 ⇒ `for-of` / spread / rest 参数 /
 * 解构都必须调用它（GetIterator + IteratorNext），元素按**迭代序**取。
 */



/** 用户 iterable：@@iterator 记一次调用，next 记每次调用（产 0、1） */
const USER_ITER = `let n = 0;
  const o = {
    [Symbol.iterator]() {
      n++;
      let i = 0;
      return { next() { n++; return { value: i, done: i++ >= 2 }; } };
    },
  };`;


  it("for-of 调用 @@iterator 与 next（原生 1 + 3 = 4 次）；spread 调用 @@iterator 与 next；rest 参数展开调用 @@iterator 与 next；混合 spread（数组 + 用户 iterable）调用 @@iterator 与 next；解构只取第 1 个元素 ⇒ 只驱动到第 1 次 next；for-of 取到的是迭代序的值（不是索引序）；负控制：内建可迭代体的 next 计数不变", () => {
  {
    expect(val(`export function f() { ${USER_ITER} for (const v of o) {} return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(val(`export function f() { ${USER_ITER} const a = [...o]; return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(val(`export function f() { ${USER_ITER} function g(...a) {} g(...o); return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(val(`export function f() { ${USER_ITER} const a = [0, ...o]; return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(val(`export function f() { ${USER_ITER} const [x] = o; return n; }`)).toEqual({
      ok: true,
      value: 2,
    });
  }
  {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x", "y"][Symbol.iterator](); } };
        const out = [];
        for (const v of o) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
  }
  {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a[Symbol.iterator]();
        let n = 0;
        while (!it.next().done) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  }
});








/**
 * `Array.from(userIterable)` **必须驱动用户迭代器**（GetIterator +
 * IteratorNext）——与 for-of / spread / rest / 解构同款协议。
 *
 * 修复前：`evalArrayFrom` 的 obj 臂只判「可迭代」却**不实际调**
 * `@@iterator` / `next()` ⇒ 迭代器体内的副作用（计数 / 写状态）整体丢失，
 * 元素域折 unknown（wrong-exact 的 0 / undefined）。
 */
describe("Array.from 驱动用户 @@iterator", () => {
  it("Array.from(o) 调用 @@iterator 与 next（原生 1 + 3 = 4 次）；Array.from(o) 取到的是迭代序的元素；Array.from(o, mapFn) 逐位应用 mapper（下标自 0 起）；Array.from(o).length = 迭代出的元素数；负控制：array-like 接收者（无 @@iterator）仍走索引读路径；负控制：内建可迭代体不受影响（Array / Set / 字符串路径不驱动用户迭代器）", () => {
  {
    expect(val(`export function f() { ${USER_ITER} const a = Array.from(o); return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  }
  {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x", "y"][Symbol.iterator](); } };
        return Array.from(o).join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
  }
  {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return [7, 8][Symbol.iterator](); } };
        return Array.from(o, (v, i) => v + i).join(",");
      }`),
    ).toEqual({ ok: true, value: "7,9" });
  }
  {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return [7, 8][Symbol.iterator](); } };
        return Array.from(o).length;
      }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(`export function f() { return Array.from({length: 2, 0: "a", 1: "b"}).join(","); }`),
    ).toEqual({ ok: true, value: "a,b" });
  }
  {
    expect(
      val(`export function f() { ${USER_ITER} Array.from([1,2]); Array.from("ab"); Array.from(new Set([1,2])); return n; }`),
    ).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { return Array.isArray(Array.from([1,2])); }`)).toEqual({
      ok: true,
      value: true,
    });
  }
});





});
});

// ---------------------------------------------------------------------------
// try 块里的 break / continue 不被 catch 体吞掉
// ---------------------------------------------------------------------------
describe("try 块里的 break / continue 不被 catch 体吞掉", () => {
/**
 * 回归（core 运行时）：`try` 块里的 `break` / `continue` **不是异常**——
 * catch 体不得吞掉控制流信号。
 *
 * 修复前：循环信号（NudoLoopSignal，Error 子类）能被 catch 接住，catch 体的
 * 逃逸门只重抛 NudoReturn（`$rethrowIfNudoReturn`）⇒ 信号被「吃掉」：
 * catch 体的副作用照样执行、循环还不退出。
 * `for (let i=0;i<4;i++){ try{ if(i===1) break; s+=i; } catch(e){ s+="c"; } }`
 * 原生 "0"，修复前 "0c23"（catch 体跑了 3 次，循环跑满 4 轮）。
 *
 * 修复后：catch 体的取值入口 `$catchVal` 遇控制流信号**重抛** ⇒ catch 体不执行、
 * 信号透传到循环捕获点（原生：break 是控制流完成值，根本到不了 catch 处理器）。
 *
 * 负控制钉住：① 真异常仍被 catch 吞掉（catch 体照跑）；② 无 try 的 break/continue
 * 不变；③ try/finally 路径不变（finally 照跑）；④ catch 体内的 break 仍透传
 * （不被 catch 自身的内层 try 吞掉）。
 */




/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string): unknown {
  const r = call(`export function f() { ${body} }`, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}


  it("try 里的 break：catch 体不跑、循环退出；try 里的 break：循环计数停在 break 点；try 里的 continue：catch 体不跑、迭代继续；嵌套循环：try 里的 break 退出**内层**循环（外层继续）；负控制：真异常仍被 catch 吞掉（catch 体照跑）；负控制：无 try 的 break 仍退出循环；负控制：try/finally 路径不变（finally 照跑、break 生效）；负控制：try 块正常路径不受影响；负控制：", () => {
  {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ if(i===1) break; s+=i; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("0");
    expect(engine(body)).toBe("0");
  }
  {
    const body = `let c=0; for(let i=0;i<100;i++){ try{ if(i===3) break; c++; }catch(e){ } } return c;`;
    expect(native(body)).toBe(3);
    expect(engine(body)).toBe(3);
  }
  {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ if(i===1) continue; s+=i; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("023");
    expect(engine(body)).toBe("023");
  }
  {
    const body = `let s=""; for(let i=0;i<3;i++){ for(let j=0;j<3;j++){ try{ if(j===1) break; s+="x"; }catch(e){ s+="c"; } } s+="|"; } return s;`;
    expect(native(body)).toBe("x|x|x|");
    expect(engine(body)).toBe("x|x|x|");
  }
  {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ throw 1; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("cccc");
    expect(engine(body)).toBe("cccc");
  }
  {
    const body = `let s=""; for(let i=0;i<4;i++){ if(i===1) break; s+=i; } return s;`;
    expect(native(body)).toBe("0");
    expect(engine(body)).toBe("0");
  }
  {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ if(i===1) break; s+=i; }finally{ s+="f"; } } return s;`;
    expect(native(body)).toBe("0ff");
    expect(engine(body)).toBe("0ff");
  }
  {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ s+=i; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("0123");
    expect(engine(body)).toBe("0123");
  }
  {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ throw 1; }catch(e){ if(i===1) break; s+=i; } } return s;`;
    expect(native(body)).toBe("0");
    expect(engine(body)).toBe("0");
  }
});




  // --- 负控制 ---------------------------------------------------------





});

// ---------------------------------------------------------------------------
// @nudo:invariant 在四种循环形态同口径生效
// ---------------------------------------------------------------------------
describe("@nudo:invariant 在四种循环形态同口径生效", () => {
/**
 * （族 02 / tmp/bugs/02-core-exec-runtime.md）：@nudo:invariant 在
 * **while / do-while / for-of** 三种循环里被静默丢弃 ⇒ 门禁对**用户自己的
 * 公理本可证明**的函数报红（假红）。
 *
 * 根因：不变式只在**循环 join / 宽化位**实施（issue #176 的设计——用户公理
 * 是循环携带界的唯一通道）。历史上的实施点只有两处：
 * - control.ts `$for` 的 applyExtJoin → widenLoopJoin（内接 applyInvariantsToPack）
 * - loop-widen.ts `widenFinal`（抽象预算耗尽路径）
 * `$whileSeq`（while / do-while）与 `$forOf`（for-of）的**具体出口**路径
 * （循环条件可判定为假 → 无快照 join → 不经 widenFinal）两条路都不通 ⇒
 * 出口 join 上的绑定包从未被强化 ⇒ 公理无诊断地消失（假红）。
 *
 * 修法（跨文件）：control.ts `$whileSeq.applyExitJoin` 与
 * containers/iterate.ts `$forOf.applyExitJoin` 在解包前接上
 * `applyExitJoinInvariants`（invariant-apply.ts 新增的统一入口）；具体出口
 * 路径（无快照 join）仅当**有公理**时才取绑定包，且仅当公理真的改写了绑定
 * 包时才解包 ⇒ 零行为变化（无公理 / 公理不适用时恒等；取包会暴露转译侧
 * pack 闭包引用体内作用域解构绑定的既有缺陷——见 tmp/probe/fix-r22-s10 报告）。
 *
 * ⚠️ 本文件在上述**跨文件补丁**（tmp/probe/fix-r22-s10/patch-215.patch）
 * 合入前为**红**（预期）——合入后全绿。
 *
 * 全部相对路径导入（单一模块实例）：会话槽（state.ts 模块级 let）跨实例
 * 不可见（#152 教训）。
 */



const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/invariant.js",
});

function checkOf(src: string, opts: Record<string, unknown> = {}) {
  return checkSource("/t/invariant.js", src, pTrue, opts);
}

const SIDECAR = `export const f = fn({ n: number() }, number().ge(0));`;

/** 四种循环形态：只差写法，同一份公理（`@nudo:invariant last >= 0`） */
const FORMS: Array<{ id: string; body: string }> = [
  {
    id: "for",
    body: `
  let last = 0;
  for (let j = 0; j < 3; j++) last = n;
  return last;`,
  },
  {
    id: "while",
    body: `
  let last = 0;
  let j = 0;
  while (j < 3) { last = n; j = j + 1; }
  return last;`,
  },
  {
    id: "do-while",
    body: `
  let last = 0;
  let j = 0;
  do { last = n; j = j + 1; } while (j < 3);
  return last;`,
  },
  {
    id: "for-of",
    body: `
  let last = 0;
  for (const x of [1, 2, 3]) { last = n; }
  return last;`,
  },
];

const srcOf = (body: string, directive: string | null): string => `
${directive ? `/**\n * ${directive}\n */` : ""}
export function f(n) {${body}}
`;

{
  it.each(FORMS.map((f) => [f.id, f.body] as const))(
    "%s：公理 last >= 0 → 返回契约 ge(0) 证得（无 error）+ invariant-relied 审计",
    (_id, body) => {
      const r = checkOf(srcOf(body, "@nudo:invariant last >= 0"), sidecarOpts(SIDECAR));
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
      const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
      expect(relied).toBeDefined();
      expect(relied!.severity).toBe("info");
      expect(relied!.message).toContain("proved via @nudo:invariant last >= 0");
      // 签名面：出口绑定带上了公理界（n ≥ 0）
      // ⚠ 证据在 `detail` 的 pred 行（`display` 自 起是**人类面口径**
      // 的 shape 渲染，不再带 term / pred 注记）
      const sig = r.signatures.find((s) => s.name === "f");
      expect(sig).toBeDefined();
      expect(sig!.detail).toContain("n ≥ 0");
    },
  );

  it.each(FORMS.map((f) => [f.id, f.body] as const))(
    "%s 对照（无公理）：证不出 → 返回义务未证得（负控制：不得被本修复波及）",
    (_id, body) => {
      const r = checkOf(srcOf(body, null), sidecarOpts(SIDECAR));
      // 无公理时 `last` 是**声明域参数**（值域已知：任意 number）⇒
      // 返回契约 `ge(0)` 不蕴含 ⇒ 契约不成立（存在违约输入）⇒ 判
      // `nudo:constraint-violated`（error）。判 warning 会让门禁空转
      // （warning 不改 exit code）。
      expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
      expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
      expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
      expect(r.issues.some((i) => i.code.startsWith("nudo:invariant"))).toBe(false);
    },
  );

  it("弱公理不得证明强契约（方向性诚实）：@nudo:invariant last >= 0 vs 契约 ge(1)；抽象预算耗尽路径（不可判定条件）不受影响：公理照常实施", () => {
  {
    const r = checkOf(
      srcOf(FORMS[1]!.body, "@nudo:invariant last >= 0"),
      sidecarOpts(`export const f = fn({ n: number() }, number().ge(1));`),
    );
    // 公理被实施（n ≥ 0）但不足以蕴含 ge(1) → 仍报违约（不得假绿）
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
  }
  {
    const body = `
  let last = 0;
  let j = 0;
  while (j < n) { last = n; j = j + 1; }
  return last;`;
    const r = checkOf(srcOf(body, "@nudo:invariant last >= 0"), sidecarOpts(SIDECAR));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(true);
  }
});

}
});

// ---------------------------------------------------------------------------
// 矛盾公理不得烘进 Abs（ex falso 假绿）
// ---------------------------------------------------------------------------
describe("矛盾公理不得烘进 Abs（ex falso 假绿）", () => {
/**
 * （族 02 / tmp/bugs/02-core-exec-runtime.md）：@nudo:invariant 把
 * **矛盾谓词**烘进 Abs ⇒ **ex falso**：真正的契约违例被判为「已证明」，
 * 门禁**绿灯**（假绿）。
 *
 * 根因：invariant-apply.ts 的 strengthenLeaf 把叶子既有 pred 与公理界
 * **直接 AND**（`and(a.pred, rel)`），不检查二者是否相容。叶子已带与公理
 * 冲突的界（侧车参数契约给的 `le(n,-5)` + 公理 `ge(n,0)`）时，结果是矛盾
 * 谓词 `n ≤ -5 ∧ n ≥ 0`；证明器对矛盾 pred 能对任意约束放电 ⇒ 整个返回
 * 契约「证得」⇒ 一条真正该红的门禁变绿。lit 叶子守卫本就为防这个而加，
 * 但它只覆盖「值是字面量」的叶子——带数值 pred 的参数 / 局部变量照样穿过。
 *
 * 修法：strengthenLeaf 在 AND 之前做**相容性检查**（证明器双向试判
 * `pred ⊨ ¬rel` / `rel ⊨ ¬pred`）：可证矛盾 ⇒ **不得**把公理烘进 Abs
 * （保持叶子原 pred，该不变式不参与本次证明）——公理与观测冲突时引擎站
 * 在观测一侧（少一条公理证据 ≠ 多一条假证据）。
 *
 * 全部相对路径导入（单一模块实例）：会话槽（state.ts 模块级 let）跨实例
 * 不可见（#152 教训）。
 */








const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/invariant.js",
});

function checkOf(src: string, opts: Record<string, unknown> = {}) {
  return checkSource("/t/invariant.js", src, pTrue, opts);
}

/** 循环携带 `last` = 侧车参数 `n`（pred 来自参数契约） */
const BODY = `
  let last = 0;
  for (let j = 0; j < 3; j++) last = n;
  return last;
`;

const srcOf = (directive: string | null): string => `
${directive ? `/**\n * ${directive}\n */` : ""}
export function f(n) {${BODY}}
`;

const SIDECAR_CONFLICT = `export const f = fn({ n: number().le(-5) }, number().ge(0).le(1));`;


  it("矛盾公理（last >= 0 vs 参数契约 n ≤ -5）：门禁红（constraint-violated），不得判绿；签名面：矛盾合取不得出现在返回值的 pred 上（n ≤ -5 ∧ n ≥ 0 是 ex falso 指纹）；对照（无公理）：同样的红（公理被拒后行为与「没写公理」同口径）；非矛盾公理照常实施（负控制：不得把公理一律丢掉）", () => {
  {
    const r = checkOf(srcOf("@nudo:invariant last >= 0"), sidecarOpts(SIDECAR_CONFLICT));
    // 假绿回归钉：改前此处只有 nudo:invariant-relied info、门禁 exit=0
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(1);
    const err = r.issues.find((i) => i.severity === "error");
    expect(err!.code).toBe("nudo:constraint-violated");
  }
  {
    const r = checkOf(srcOf("@nudo:invariant last >= 0"), sidecarOpts(SIDECAR_CONFLICT));
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.detail).toContain("n ≤ -5");
    expect(sig!.detail).not.toContain("n ≥ 0");
  }
  {
    const r = checkOf(srcOf(null), sidecarOpts(SIDECAR_CONFLICT));
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(1);
    expect(r.issues.find((i) => i.severity === "error")!.code).toBe(
      "nudo:constraint-violated",
    );
    expect(r.issues.some((i) => i.code.startsWith("nudo:invariant"))).toBe(false);
  }
  {
    const r = checkOf(
      srcOf("@nudo:invariant last >= 0"),
      sidecarOpts(`export const f = fn({ n: number() }, number().ge(0));`),
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(true);
  }
});





describe("单元：strengthenLeaf 的相容性检查", () => {
  const packOf = (leaf: Abs_____abs_ts): Abs_____abs_ts =>
    abs({ k: "obj", slots: { last: { value: leaf } } }, undefined, undefined, "path");

  it("矛盾叶子（le(n,-5) + 公理 ge 0）：pred 保持原样，不得并入 ≥ 0；相容叶子（ge(n,1) + 公理 le 10）：两个界都在（不得误拒）；反向矛盾（ge(n,0) + 公理 le -5）：同样被拒；字面量叶子不改写（既有守卫仍在）：具体值自带真值", () => {
  {
    const leaf = abs(num().shape, v("n"), le(v("n"), lit(-5)), "path");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "ge", value: 0 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs_____abs_ts }> }).slots.last!.value;
    expect(out.pred).toBe(leaf.pred);
    expect(predToString(out.pred!)).not.toContain("≥ 0");
  }
  {
    const leaf = abs(num().shape, v("n"), ge(v("n"), lit(1)), "path");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "le", value: 10 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs_____abs_ts }> }).slots.last!.value;
    const s = predToString(out.pred!);
    expect(s).toContain("≥ 1");
    expect(s).toContain("≤ 10");
  }
  {
    const leaf = abs(num().shape, v("n"), ge(v("n"), lit(0)), "path");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "le", value: -5 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs_____abs_ts }> }).slots.last!.value;
    expect(out.pred).toBe(leaf.pred);
    expect(predToString(out.pred!)).not.toContain("≤ -5");
  }
  {
    const leaf = abs(num().shape, lit(-1), undefined, "exact");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "ge", value: 0 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs_____abs_ts }> }).slots.last!.value;
    expect(out).toBe(leaf);
    expect(out.pred).toBeUndefined();
  }
});



});
});

// ---------------------------------------------------------------------------
// [merged] switch-literal-disc-abs-test
// ---------------------------------------------------------------------------
describe("switch-literal-disc-abs-test", () => {
// MERGED (topic-related bug pins): switch-literal-disc-abs-test + switch-miss-path-narrowing
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>









{
/**
 * 回归（core 运行时）：`$switch` 在「**字面量判别式 + 非字面量 case
 * 测试**」下不得把该臂整条丢弃。
 *
 * 修复前：判别式是字面量（`switch (true)`）时走「严格相等匹配」路径，只有
 * **case 测试本身也是字面量**的臂才可能被比较；`case x > 0:` 这类臂的测试
 * 是抽象值 ⇒ 该臂**永不命中** ⇒ 臂内返回值从返回域/签名里彻底消失：
 * - 签名谎报：`switch (true) { case x > 0: return 0; default: return 1; }`
 * 的返回域原生是 `0 | 1`，引擎只给 `1`；
 * - L1 门禁假绿：契约 `return number().gt(0)` 被判「满足」（原生在 x=5 时
 * 返回 0 ⇒ 真实违约）。
 *
 * 修复后：非字面量 case 测试 ⇒ **分叉**（命中该臂 / 不命中继续后续臂与
 * default），两路结果并入返回域 ⇒ 签名诚实 + 违约被报出。
 *
 * 负控制钉住：① 全字面量 case 的 switch 仍精确匹配（不进入分叉）；
 * ② 同语义的 if 写法结论不变；③ 抽象判别式（switch (x)）路径不变；
 * ④ 非字面量 case 测试的**值**求值仍按序惰性（口径）。
 */








/** 抽象 number 判别值（非字面量） */
const NUMBER_ABS = abs({ k: "prim", type: "number" }, undefined, pTrue_____pred_ts_1, "exact");

/** 引擎返回域（formatAbs 渲染） */
function domain(src: string, arg: unknown): string {
  const r = call(src, "f", [arg as never]);
  return formatAbs(r.result as never);
}

/** L1 契约门禁：sidecar 声明 `f: (x: number) => number().gt(0)` */
function checkSwitch(src: string, file: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource_____check_check_ts(
    file,
    src,
    pTrue_____pred_ts_1,
    {
      loadModule: (spec: string): string | undefined =>
        spec.includes("s241")
          ? `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number().gt(0));\n`
          : undefined,
      fromFile: file,
    },
  );
}

describe("字面量判别式 + 非字面量 case 测试 ⇒ 该臂不得被丢弃", () => {
  it("返回域含被丢掉的分支（0 | 1）；返回域含被丢掉的分支（无 default ⇒ 隐式 no-match 臂）；返回域含多个非字面量 case 臂；L1 门禁：契约真实违约被报出（不再假绿）；负控制：全字面量 case 的 switch 仍精确匹配（返回域不含未命中臂）；负控制：同语义的 if 写法结论不变（同样报违约）；负控制：字面量判别式 + 字面量 case ⇒ 仍是精确命中（单一分支）；负控制：非字面量 case 测试仍按序惰性求值（命中即停，Bug 168 口径）", () => {
  {
    const src = `export function f(x) { switch (true) { case x > 0: return 0; default: return 1; } }`;
    const d = domain(src, NUMBER_ABS);
    expect(d).toContain("0");
    expect(d).toContain("1");
  }
  {
    const src = `export function f(x) { switch (true) { case x > 0: return 0; } }`;
    const d = domain(src, NUMBER_ABS);
    expect(d).toContain("0");
  }
  {
    const src = `export function f(x) { switch (true) { case x > 0: return 0; case x < 0: return 2; default: return 1; } }`;
    const d = domain(src, NUMBER_ABS);
    expect(d).toContain("0");
    expect(d).toContain("1");
    expect(d).toContain("2");
  }
  {
    const src = `export function f(x) {
  switch (true) {
    case x > 0:
      return 0;
    default:
      return 1;
  }
}`;
    const r = checkSwitch(src, "/t/s241-switch.js");
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  }
  {
    const src = `export function f(x) { switch (x) { case 1: return "one"; case 2: return "two"; default: return "other"; } }`;
    const r = call(src, "f", [NUMBER_ABS]);
    const lv = litValue(r.result);
    // 抽象判别式 ⇒ 抽象路径（全部臂参与）——行为与修复前一致
    expect(lv.ok).toBe(false);
  }
  {
    const src = `export function f(x) {
  if (x > 0) {
    return 0;
  }
  return 1;
}`;
    const r = checkSwitch(src, "/t/s241-if.js");
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  }
  {
    const src = `export function f(x) { switch (true) { case true: return "t"; default: return "f"; } }`;
    const r = call(src, "f", [NUMBER_ABS]);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(lv.ok ? lv.value : undefined).toBe("t");
  }
  {
    const src = `export function f(x) { let n = 0; switch (true) { case (n++, true): return n; default: return 0; } }`;
    const r = call(src, "f", [NUMBER_ABS]);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(lv.ok ? lv.value : undefined).toBe(1);
  }
});




  // --- 负控制 ---------------------------------------------------------



});
}

describe("switch-miss-path-narrowing", () => {
/**
 * 回归（第二形态）：**非字面量 case 测试**（`case v === null:`）的
 * **miss 路径**未按「该 case 测试不成立」收窄 ⇒ 后续臂（default）里的
 * `v.length` 报 may-throw（L2 假红：原生该路径不抛）。
 *
 * ES 语义（原生）：
 * - `switch (true) { case v === null: …; default: … }`——case 测试是**运行
 * 时求值的表达式**（不是「判别值等于某标签」）：判别值是布尔 true 且测试
 * 是布尔值时，「该臂未命中」⟺「该测试为假」⇒ default 路径上 v **不是**
 * null（`v.length` 安全）；
 * - 判别值是其它值（false / 数字 / 标识符）时，「未命中」**不**蕴含「测试
 * 为假」⇒ 不产事实（宁缺毋假）。
 *
 * 修复前：miss 路径无收窄 ⇒ default 臂的 `v.length` 报 may-throw（L2 假红）。
 * 修法（transpile/stmt-predicates.ts）：`switchCaseFacts` 为 nullish 比较
 * （`v === null` / `v == null` / `v === undefined`）产出**否定关系**事实
 * （$removeNull / $removeNullish / $removeUndefined），由
 * `narrowCaseLabelArmThunk` 以影子重绑施加到后续臂。
 */





/** 抽象实参 string | null（契约面同形：union(string(), lit(null))） */
const strOrNull: Abs_____abs_ts_1 = joinAbs(absLit("ab"), absLit(null));

/** may-throw 面（never = 不抛） */
function mayThrow(src: string, args: Abs_____abs_ts_1[]): boolean {
  const rec = call(src, "f", args);
  return !isNever(rec.throws);
}

describe("$switch 的 miss 路径按 case 测试收窄（非字面量 case 测试）", () => {
  it("`case v === null:` 的 miss 路径 → default 臂的 v.length 不报 may-throw；`case v == null:`（松散）的 miss 路径 → 收窄到非 nullish；两个 nullish 比较臂：default 路径排除 null 与 undefined；`case v === undefined:` 的 miss 路径只排除 undefined（null 仍在 ⇒ 仍可抛）；负向比较 `case v !== null:`", () => {
  {
    const src = `export function f(v) {
      switch (true) {
        case v === null:
          return 0;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  }
  {
    const src = `export function f(v) {
      switch (true) {
        case v == null:
          return 0;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  }
  {
    const src = `export function f(v) {
      switch (true) {
        case v === null:
          return 0;
        case v === undefined:
          return 1;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  }
  {
    const src = `export function f(v) {
      switch (true) {
        case v === undefined:
          return 0;
        default:
          return v.length;
      }
    }`;
    // v 可能是 null ⇒ 原生该路径会抛 ⇒ may-throw 是**正确**的（不得过度收窄）
    expect(mayThrow(src, [strOrNull])).toBe(true);
  }
  {
    const src = `export function f(v) {
      switch (true) {
        case v !== null:
          return 0;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(true);
  }
  {
    const src = `export function f(v) {
      switch (v) {
        case v === null:
          return 0;
        default:
          return v.length;
      }
    }`;
    // 原生：v === null 时判别值 null ≠ true ⇒ 走 default ⇒ v.length 抛
    expect(mayThrow(src, [strOrNull])).toBe(true);
  }
  {
    const src = `export function f(v) {
      switch (true) {
        case v === null:
          return 0;
        default:
          return 1;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  }
});






});
});
});

// ---------------------------------------------------------------------------
// match/exec 结果的可迭代面（原生数组 exotic）
// ---------------------------------------------------------------------------
describe("match/exec 结果的可迭代面（原生数组 exotic）", () => {
/**
 * 回归：RegExp `exec` / 非全局 `match` 的结果对象是**数组 exotic**
 * （原生 IsArray = true，继承 Array.prototype）⇒ 既有**数组方法面**
 * （join / slice / map…，族 01 的 已修），也有**可迭代面**
 * （spread / for-of / 数组解构）。
 *
 * 修前：结果只是「带下标槽的 obj」⇒ 迭代面按 obj 臂判 **definite 不可
 * 迭代** ⇒ `[...m]` / `for (const x of m)` / `const [a, b] = m` **定抛
 * TypeError**（原生全部正常返回 ⇒ 假抛 + L1/L2 假红）。
 *
 * 修法（regexp.ts）：匹配结果补「@@iterator 槽（非枚举）+ 下标元素侧表」
 * ——同 的标签模板对象口径（iterabilityKind 判 total、elemsOf 取
 * 到精确下标序列）；形状仍是 obj（#136 的槽读面依赖它）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */




function v(src: string) {
  return litValue___nudojs_core_7(call(src, "f").result);
}


  it("spread 展开下标序列（node: \"abc,b\"）；for-of 逐元素累加（node: \"abcb\"）；数组解构取捕获组（node: \"123123\"）；spread 保持未参与捕获组的 undefined 槽（node: [\"az\",null] 的展开面）；非全局 match 的结果同样可迭代（node: \"a\"）；matchAll 的每个匹配项可迭代（node: \"ab\"）；indices 镜像（/d 标志）原生同为 Array ⇒ 同样可迭代（node: 2）", () => {
  {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return [...m].join(","); }`)).toEqual({
      ok: true,
      value: "abc,b",
    });
  }
  {
    expect(
      v(`export function f() { const m = /a(b)c/.exec("abc"); let s = ""; for (const x of m) s += x; return s; }`),
    ).toEqual({ ok: true, value: "abcb" });
  }
  {
    expect(
      v(
        `export function f() { const m = /(\\d+)/.exec("abc123"); if (!m) return "no"; const [whole, g1] = m; return whole + g1; }`,
      ),
    ).toEqual({ ok: true, value: "123123" });
  }
  {
    expect(
      v(`export function f() { const m = /a(x)?z/.exec("az"); return [...m].length; }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(v(`export function f() { return [...("a b".match(/\\w+/))].join(","); }`)).toEqual({
      ok: true,
      value: "a",
    });
  }
  {
    expect(
      v(
        `export function f() { const it = "a b".matchAll(/\\w+/g); let s = ""; for (const m of it) s += [...m][0]; return s; }`,
      ),
    ).toEqual({ ok: true, value: "ab" });
  }
  {
    expect(
      v(`export function f() { const m = /(?<y>\\d{4})/d.exec("2024"); return [...m.indices].length; }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(`export function f() { const m = /(?<y>\\d{4})/d.exec("2024"); return JSON.stringify(m.indices); }`),
    ).toEqual({ ok: true, value: "[[0,4],[0,4]]" });
  }
  {
    const r = call(`export function f() { const o = { a: 1 }; return [...o]; }`, "f");
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m[0]; }`)).toEqual({
      ok: true,
      value: "abc",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.length; }`)).toEqual({
      ok: true,
      value: 2,
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.index; }`)).toEqual({
      ok: true,
      value: 0,
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.input; }`)).toEqual({
      ok: true,
      value: "abc",
    });
  }
  {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return JSON.stringify(m); }`)).toEqual({
      ok: true,
      value: '["abc","b"]',
    });
  }
  {
    const r = call(
      `export function f() { const m = /a(b)c/.exec("abc"); return Object.keys(m).join(","); }`,
      "f",
    );
    const lv = litValue___nudojs_core_7(r.result);
    expect(lv.ok).toBe(true);
    expect(String(lv.ok ? lv.value : undefined)).toBe("0,1,index,input,groups");
  }
  {
    expect(v(`export function f() { return "a b".match(/\\w+/g).join("-"); }`)).toEqual({
      ok: true,
      value: "a-b",
    });
    expect(v(`export function f() { const m = /zzz/.exec("abc"); return m === null; }`)).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.join(","); }`)).toEqual({
      ok: true,
      value: "abc,b",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.slice(1).join(""); }`)).toEqual({
      ok: true,
      value: "b",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.toString(); }`)).toEqual({
      ok: true,
      value: "abc,b",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return Array.isArray(m); }`)).toEqual({
      ok: true,
      value: true,
    });
  }
});













});
