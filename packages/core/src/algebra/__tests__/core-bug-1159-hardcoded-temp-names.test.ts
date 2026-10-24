/**
 * Bug 1159 回归钉：附录 A#4「同族写死名残留」—— 登记为「实测无害」的三处，
 * 经本条实测**全部可触发**（体内确有用户表达式），另在同文件内发现两处同族
 * 残留。
 *
 * 背景：Bug 1058/1059 已约定「引擎内部临时名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`），
 * Bug 1127 / 1146 / 1149 / 1151 陆续落到 `__nudoMp*` / 调用族 / 可选链 /
 * 短路 / 对象 / 类形参。本条的落点：
 *
 * - `stmt/statement.ts`（1159-a）：switch 的 **case 测试辅助族**（`__swT` /
 *   `__swTV` / `__swTD` / `__swAllDone` / `__swTestRead` / `__swEval` /
 *   `__swEvalAll`，及其形参 `__swI` / 循环变量 `__swJ`）与**共享体名**
 *   `__swBody{n}` 是**块级词法绑定**，而 case 测试 thunk
 *   （`() => (用户 case 表达式)`）与臂 thunk 都在该块作用域里求值用户表达式
 *   ⇒ 写死名会：
 *   - **遮蔽**用户同名外层绑定 ⇒ 臂体读到引擎临时量（自信错值 ⇒ 闸门假绿）：
 *     `const __swAllDone = 42` 被读成引擎的 `false`；
 *   - 撞 **TDZ ReferenceError**：臂入口注入的 `if (!__swTestRead)` 在用户
 *     `let __swTestRead` 声明之前读 ⇒ 原生值被算成 never。
 * - `stmt/statement.ts`（1159-b）：switch 臂的 break 标签 `__nudoSw{n}` 是
 *   **信号字符串**（`$loopBreak(标签)` / `$isBreakTo` 按字符串比对）⇒ 与用户
 *   同名标签块相撞时，臂内**无标签** `break` 的信号被用户的标签块 catch
 *   吸收 ⇒ switch 不退出、块后续语句照跑（自信错值）。
 * - `expr/operators.ts`（1159-c）：私有名自增 IIFE 形参 `__v` / `__old`——
 *   IIFE 体**重复发射接收者表达式**（用户源码）⇒ 遮蔽用户同名绑定；同文件
 *   另两处同族残留：标识符后缀 IIFE 的 `__old`（体内含**写目标标识符**）与
 *   非路径 delete IIFE 的 `__nudoDelP` / `__nudoDelK` / `__nudoDelD`（体内
 *   求值父对象 / 计算键 ⇒ TDZ）。
 * - `stmt/statement.ts`（1159-c 补）：for-in 接收者临时名 `__fir{n}`（按
 *   grep 指令同文件发现的第 4 处）——`const __fir{n} = (用户接收者表达式)`
 *   的初始化器与循环体都在该块里求值用户代码；首轮编译失败后的 Bug 1139
 *   重试只是**碰巧**推高计数器躲开单名碰撞，两次尝试的序号都落在用户占用面
 *   时重试仍 SyntaxError ⇒ 宿主异常冒出（`runTranspiled` 直接抛）。
 * - `stmt/statement.ts`（1159-c 再补）：循环协议的两处写死名——`for` fallback
 *   的 `$for` 状态线程形参 `__n`（测试 / 体 thunk 都内联用户源码）与 do-while
 *   首轮标记 `__nudoDwFirst`（块级绑定 + 体 thunk 内联用户体）⇒ 遮蔽用户同名
 *   绑定（条件 / 体读合成计数器或引擎布尔 ⇒ 自信错值）。
 * - `class-emit.ts`（1159-d）：setter thunk 的别名载体 `__nab{i}` / 回收载体
 *   `__nabs`——thunk 体内求值用户 setter 体 ⇒ 遮蔽用户同名外层绑定。
 * - `expr/function.ts` / `expr/assignment.ts`（1159-d 补，按同族 grep 指令
 *   扩展）：宿主 rest 形参名 `__rest_raw`（与用户同名 rest 形参**重复声明**
 *   ⇒ SyntaxError）与解构赋值 IIFE 形参 `__d`（默认值表达式在 IIFE 体内求值
 *   ⇒ 读成 IIFE 实参对象）。
 *
 * 未纳入（**另族**）：宿主注入的 `$` / `__nudo*` 运行时族（附录 A#3，可解析
 * 面爆炸半径过大）。`__this` 载体当时也留到独立一波，**已由 Bug 1160 收口**
 * （`thisCarrierOf` 单元共享分配；1149 / 1151 中钉 `(__this, …)` 字面形态的
 * 断言已按行为不变口径改写/删除）。
 *
 * 修法：全部改经 `internalTmpName` / `internalTmpNameSet`（与 Bug 1149 同款
 * 避让口径 = `userIdentInfoOf(opts)` 避让集 ∪ `opts.userIdents`，撞名加 `_k`
 * 后缀）——**不造第二套命名机制**。无碰撞时基名原样返回 ⇒ 产物逐字不变
 * （9507 条差分语料 + 手写 switch / label / 类 / 私有名 / delete 语料，旧发射器
 * 对拍 0 diff）；撞名时基名加 `_k` 后缀（分配器确定性，计数器行为未变）。
 *
 * 锚定值均为 node v26.10.0 原生实测（见各断言注释）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { call, val, tupleEls, throwsError } from "./eval-helpers.ts";
import { sigOf } from "./nudo-constraints.ts";
import { checkSource, pTrue, transpileSource } from "../index.ts";
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
 * 另发现）撞用户声明 ⇒ 原生 3（修前：首轮重复声明 SyntaxError + Bug 1139
 * 重试后再撞 ⇒ 宿主 SyntaxError 冒出）。
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

describe("Bug 1159：附录 A#4 残留写死名（switch 辅助族 / break 标签 / 自增 IIFE / 类 setter 别名）", () => {
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

  describe("1159-a：switch case 测试辅助族 / 共享体名", () => {
    it("触发 A1：__swAllDone → 42（原生 42；修前：false）", () => {
      expect(v(SRC_A1)).toBe(42);
      expect(sig(SRC_A1)).toBe("42");
    });

    it("触发 A2：臂体 __swTestRead → 5（原生 5；修前：ReferenceError / never）", () => {
      expect(v(SRC_A2)).toBe(5);
      expect(refError(SRC_A2)).toBe(false);
      expect(sig(SRC_A2)).toBe("5");
    });

    it("触发 A3：__swEval → 7（原生 7；修前：引擎内部函数 Abs）", () => {
      expect(v(SRC_A3)).toBe(7);
      expect(sig(SRC_A3)).toBe("7");
    });

    it("触发 A4：case 测试读 __swT → \"hit\"（原生 \"hit\"；修前：\"miss\"）", () => {
      expect(v(SRC_A4)).toBe("hit");
      expect(sig(SRC_A4)).toBe('"hit"');
    });

    it("触发 A5：共享体名 __swBody0 → 11（原生 11；修前：函数 Abs）", () => {
      expect(v(SRC_A5)).toBe(11);
      expect(sig(SRC_A5)).toBe("11");
    });

    it("对照 A0：无同名绑定 ⇒ 测试 / 共享臂路径同值（\"hit\"）", () => {
      expect(v(CTRL_A)).toBe("hit");
      expect(sig(CTRL_A)).toBe('"hit"');
    });
  });

  describe("1159-b：switch 臂 break 标签（信号字符串）", () => {
    it("触发 B1：用户标签块 __nudoSw0 不再吸收 switch break → 1（原生 1；修前：3）", () => {
      expect(v(SRC_B1)).toBe(1);
      expect(sig(SRC_B1)).toBe("1");
    });

    it("对照 B0：标签名不撞内部标签 ⇒ 1（原生 1）", () => {
      expect(v(CTRL_B)).toBe(1);
      expect(sig(CTRL_B)).toBe("1");
    });
  });

  describe("1159-c：operators.ts（delete IIFE / 标识符后缀 / 私有名自增 IIFE）", () => {
    it("触发 C1：delete 父对象表达式读 __nudoDelP → true（原生 true；修前：ReferenceError）", () => {
      expect(v(SRC_C1)).toBe(true);
      expect(refError(SRC_C1)).toBe(false);
      expect(sig(SRC_C1)).toBe("true");
    });

    it("触发 C2：delete 计算键表达式读 __nudoDelK → true（原生 true；修前：ReferenceError）", () => {
      expect(v(SRC_C2)).toBe(true);
      expect(refError(SRC_C2)).toBe(false);
      expect(sig(SRC_C2)).toBe("true");
    });

    it("触发 C3：标识符后缀 __old → [5, 6]（原生 [5, 6]；修前：[6, 5]）", () => {
      expect(tuple(SRC_C3)).toEqual([5, 6]);
      expect(sig(SRC_C3)).toBe("[5, 6]");
    });

    it("触发 C4：私有名前缀自增（接收者形参 __v）→ 1（原生 1；修前：TypeError）", () => {
      expect(v(SRC_C4)).toBe(1);
      expect(sig(SRC_C4)).toBe("1");
    });

    it("触发 C5：私有名后缀自增（接收者形参 __old）→ [0, 1]（原生 [0, 1]；修前：TypeError）", () => {
      expect(tuple(SRC_C5)).toEqual([0, 1]);
      expect(sig(SRC_C5)).toBe("[0, 1]");
    });

    it("触发 C6：for-in 接收者 __fir{n} 撞用户声明 → 3（原生 3；修前：宿主 SyntaxError）", () => {
      expect(v(SRC_C6)).toBe(3);
      expect(sig(SRC_C6)).toBe("3");
    });

    it("触发 C7：for fallback 状态形参 __n → 0（原生 0；修前：3）", () => {
      expect(v(SRC_C7)).toBe(0);
      expect(sig(SRC_C7)).toBe("0");
    });

    it("触发 C8：do-while 首轮标记 __nudoDwFirst → 7（原生 7；修前：false）", () => {
      expect(v(SRC_C8)).toBe(7);
      expect(sig(SRC_C8)).toBe("7");
    });

    it("触发 C9：rest 形参 __rest_raw → 3（原生 3；修前：SyntaxError）", () => {
      expect(v(SRC_C9)).toBe(3);
      expect(sig(SRC_C9)).toBe("3");
    });

    it("触发 C10：解构 IIFE 形参 __d → 5（原生 5；修前：对象）", () => {
      expect(v(SRC_C10)).toBe(5);
      expect(sig(SRC_C10)).toBe("5");
    });

    it("对照 C0：无同名绑定 ⇒ delete / 后缀 / 私有名自增 / for-in 接收者同值", () => {
      expect(v(CTRL_C1)).toBe(true);
      expect(tuple(CTRL_C2)).toEqual([5, 6]);
      expect(v(CTRL_C3)).toBe(1);
      expect(v(CTRL_C4)).toBe(2);
      expect(v(CTRL_C5)).toBe(0);
      expect(v(CTRL_C6)).toBe(7);
      expect(v(CTRL_C7)).toBe(3);
      expect(v(CTRL_C8)).toBe(5);
    });
  });

  describe("1159-d：class setter thunk 别名载体（__nab{i} / __nabs）", () => {
    it("触发 D1：别名载体 __nab0 → 100（原生 100；修前：undefined）", () => {
      expect(v(SRC_D1)).toBe(100);
      expect(sig(SRC_D1)).toBe("100");
    });

    it("触发 D2：回收载体 __nabs（多名别名）→ 100（原生 100；修前：ReferenceError）", () => {
      expect(v(SRC_D2)).toBe(100);
      expect(refError(SRC_D2)).toBe(false);
      expect(sig(SRC_D2)).toBe("100");
    });

    it("对照 D0：无同名绑定 ⇒ setter 别名写回收同值（5）", () => {
      expect(v(CTRL_D)).toBe(5);
      expect(sig(CTRL_D)).toBe("5");
    });
  });

  describe("check 门禁面（不假绿 / 不假红）", () => {
    it("撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前 TDZ 路径是假红）", () => {
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
    });

    it("撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    });
  });

  describe("确定性（同一源文本 ⇒ 同一产物）", () => {
    it("撞名时分配器改名确定：同源两次转译逐字相同（无 switch 计数器的源）", () => {
      for (const src of [SRC_C4, SRC_C5, SRC_D1, SRC_D2]) {
        expect(transpileSource(src, { source: src })).toBe(transpileSource(src, { source: src }));
      }
    });
  });
});
