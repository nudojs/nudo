/**
 * Bug 1151 回归钉：类 setter thunk 形参载体 + fork 绑定名的内部临时名避让。
 *
 * 背景：Bug 1058 / 1059 / 1127 / 1146 / 1149 已建立统一口径——**引擎内部临时名
 * 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒
 * **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**；模块级同名还会撞出
 * 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。
 * 统一做法：用 `exec/transpile/helpers.ts` 的 `internalTmpName(base, opts)` /
 * `internalTmpNameSet(bases, opts)` 分配实际名（避让集 = 源文本词形 ∪
 * `opts.userIdents`；撞名加 `_k` 后缀）；**无碰撞时基名原样返回 ⇒ 产物逐字
 * 不变**。本条落在**类访问器**与**fork 协议**两族。
 *
 * - 1151-a（`exec/transpile/class-emit.ts`）：**类 setter thunk 的形参载体
 *   `__v`**。setter thunk（`(__this, <v>) => {…}`）在**自身作用域**里求值
 *   用户表达式（setter 体）⇒ 写死名 `__v` 会**遮蔽**用户同名外层绑定 ⇒
 *   setter 体读到引擎临时量（自信错值 ⇒ 闸门**假绿**）。
 *   修法：形参名走 `internalTmpName`（与 Bug 1149 已修好的
 *   `exec/transpile/expr/object.ts` setter 路径**同款**——照它的做法抄）。
 * - 1151-b（`exec/transpile/emit.ts` + `stmt/statement.ts` +
 *   `stmt/fn-body.ts` + `expr/short-circuit.ts`）：**fork 协议绑定名**
 *   （`__fk0_${n}` / `__fk1_${n}` / `__fk2_${n}` / `__fk1_set_${n}` /
 *   `__fk2_set_${n}` / `__cont` / `__fkT` / `__fkR`；switch 族 `__sw0_${n}` /
 *   `__sw${i}_${n}` / `__sw${i}set_${n}` / `__swD` / `__swR` / `__p`）。`n` 是
 *   **用户绑定名** ⇒ 用户标识符恰为 `__fk0_a` 时即撞。**已修**（原生 42 /
 *   引擎 0 与 `true` ⇒ 修后 42）：
 *   新增**共享分配器** `emit.ts` 的 `forkTmpNames` / `switchTmpNames`（走
 *   `internalTmpNameSet` / `internalTmpName`）——声明点（`forkBindingDecls`）
 *   与**全部**引用点（`forkArmThunk` / `forkJoinBindings` /
 *   `stmt/statement.ts` 与 `stmt/fn-body.ts` 的 inline `wrapArm` 副本 /
 *   `expr/short-circuit.ts` 的调用点）**同源分配** ⇒ 「成对一致」不破。
 *   覆盖三条发射路径：`if` 分叉（statement.ts）、**早退提升**（fn-body.ts）、
 *   **短路协议**（short-circuit.ts）+ switch 臂。
 * - 1151-c（`exec/transpile/expr/assignment.ts`）：赋值 IIFE 形参 `__v`
 *   **遮蔽赋值目标**与 **super 计算键**——IIFE 体内求值用户表达式（写目标
 *   / 计算键）⇒ 写死名 `__v` 会遮蔽用户同名绑定 ⇒ 自信错值 ⇒ 闸门**假绿**。
 *   **已修**：形参名走 `internalTmpName`（照 `class-emit.ts` 的 `SETTER_V_BASE`
 *   路径抄）；**实参面保持原样**（IIFE 实参在作用域外求值 ⇒ 不遮蔽）。
 *
 * 锚定值均为 **node v26.10.0** 原生实测（见各断言注释）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { val } from "./eval-helpers.ts";
import { $lit } from "../exec/runtime/state.ts";
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
 * 触发 B4：**早退提升路径**（`stmt/fn-body.ts` 的 inline `wrapArm` 副本）臂标志
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

describe("Bug 1151：类 setter thunk 形参载体（__v）避开用户标识符", () => {
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

  describe("1151-a：求值面（原生 = 引擎）", () => {
    it("触发 A1：类 setter 默认值形参 → 15（原生 15；修前：20）", () => {
      expect(v(SRC_A1)).toBe(15);
    });

    it("触发 A2：类 setter 解构形参 → 15（原生 15；修前：非 15）", () => {
      expect(v(SRC_A2)).toBe(15);
    });

    it("触发 A3：静态类 setter → 15（原生 15；修前：20）", () => {
      expect(v(SRC_A3)).toBe(15);
    });

    it("触发 A4：类表达式 setter → 15（原生 15；修前：20）", () => {
      expect(v(SRC_A4)).toBe(15);
    });
  });

  describe("1151-a：check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面拿到精确值 15（修前：20）", () => {
      expect(sig(SRC_A1)).toBe("15");
      expect(sig(SRC_A2)).toBe("15");
      expect(sig(SRC_A3)).toBe("15");
      expect(sig(SRC_A4)).toBe("15");
    });

    it("撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）", () => {
      for (const src of [SRC_A1, SRC_A2, SRC_A3, SRC_A4]) {
        expect(issueCodes(src)).not.toContain("nudo:entry-may-throw");
      }
    });

    it("撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
      for (const src of [SRC_A1, SRC_A2, SRC_A3, SRC_A4]) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    });
  });

  describe("1151-a：产物逐字不变 / 确定性", () => {
    it("无碰撞时 setter thunk 形参名逐字保持基名 `__v`（无 `_k` 后缀）", () => {
      const src = `export function f() {
        let out = 0;
        class C { set x(a = 3) { out = a + 1; } }
        const c = new C();
        c.x = 10;
        return out;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("(__this, __v) => {");
      expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\b/);
    });

    it("无碰撞时解构 setter thunk 形参名逐字保持基名 `__v`", () => {
      const src = `export function f() {
        let out = 0;
        class C { set x({ a }) { out = a + 1; } }
        const c = new C();
        c.x = { a: 10 };
        return out;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("(__this, __v) => {");
      expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\b/);
    });

    it("撞名时改名（`__v` → `__v_1`）且仍确定（同源两次逐字相同）", () => {
      const a = transpileSource(SRC_A1, { source: SRC_A1 });
      const b = transpileSource(SRC_A1, { source: SRC_A1 });
      expect(a).toBe(b);
      expect(a).toContain("__v_1");
    });

    it("撞名时改名后 thunk 形参与 args 槽引用同名（成对一致）", () => {
      const js = transpileSource(SRC_A1, { source: SRC_A1 });
      // thunk 形参：(__this, __v_1) => {
      expect(js).toContain("(__this, __v_1) => {");
      // args 槽载同名：$arguments([__v_1])
      expect(js).toContain("$arguments([__v_1])");
      expect(js).not.toContain("__v_1_1");
    });
  });

  describe("1151-b：fork 协议绑定名（已修）", () => {
    it("触发 B1：fork 快照名 __fk0_a → 42（原生 42；修前：0）", () => {
      expect(v(SRC_B1)).toBe(42);
    });

    it("触发 B2：fork 臂标志 __cont → 42（原生 42；修前：true）", () => {
      expect(v(SRC_B2)).toBe(42);
    });

    it("触发 B3：switch 臂标志 __cont → 42（原生 42；修前：true）", () => {
      expect(vArgs(SRC_B3, 1)).toBe(42);
    });

    it("触发 B4：早退提升路径臂标志 __cont → 42（原生 42；修前：true）", () => {
      expect(v(SRC_B4)).toBe(42);
    });

    it("撞名时快照名改名（`__fk0_a` → `__fk0_a_1`）且声明点与引用点同名", () => {
      const js = transpileSource(SRC_B1, { source: SRC_B1 });
      // 声明点：const __fk0_a_1 = $copy(a);
      expect(js).toContain("const __fk0_a_1 = $copy(a);");
      // 引用点（臂入口恢复基线）：a = $copy(__fk0_a_1);
      expect(js).toContain("a = $copy(__fk0_a_1);");
      // 用户绑定仍是 __fk0_a（未被引擎改名）
      expect(js).toContain("let __fk0_a = $lit(42);");
      expect(js).not.toContain("const __fk0_a = $copy(a);");
    });

    it("撞名时臂标志名改名（`__cont` → `__cont_1`）且成对一致", () => {
      const js = transpileSource(SRC_B2, { source: SRC_B2 });
      expect(js).toContain("let __cont_1 = true;");
      expect(js).toContain("if ($isForkExit(e)) __cont_1 = false;");
      expect(js).toContain("if (__cont_1) {");
      // 用户绑定仍是 __cont
      expect(js).toContain("let __cont = $lit(42);");
    });

    it("无碰撞时 fork 协议名逐字保持基名（产物逐字不变面）", () => {
      const src = `export function f() {
        let a = 0;
        let out = 0;
        if (a === 0) { out = 1; a = 1; }
        return out;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("const __fk0_out = $copy(out);");
      expect(js).toContain("let __cont = true;");
      expect(js).toContain("const __fkT = ($eq(a, $lit(0)));");
    });
  });

  describe("1151-c：赋值 IIFE 形参 __v（已修）", () => {
    it("触发 C1：赋值目标 __v → 5（原生 5；修前：1）", () => {
      expect(v(SRC_C1)).toBe(5);
    });

    it("触发 C2：计算 super 键 __v → \"5\"（原生 \"5\"；修前：\"1\"）", () => {
      expect(v(SRC_C2)).toBe("5");
    });

    it("触发 C3：RHS（IIFE 实参）读用户 __v → 5（原生 5；修前：5 ⇒ 实参面不遮蔽）", () => {
      expect(v(SRC_C3)).toBe(5);
    });

    it("撞名时 IIFE 形参改名（`__v` → `__v_1`）且写目标仍写用户绑定", () => {
      const js = transpileSource(SRC_C1, { source: SRC_C1 });
      expect(js).toContain("((__v_1) =>");
      expect(js).toContain("return __v = __v_1;");
    });

    it("无碰撞时 IIFE 形参名逐字保持基名 `__v`（产物逐字不变面）", () => {
      const src = `export function f() {
        let a = 1;
        a = 5;
        return a;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("((__v) =>");
      expect(js).toContain("return a = __v;");
      expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\b/);
    });
  });
});
