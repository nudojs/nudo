/**
 * Bug 1146 回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名**
 * 必须与用户标识符**避让**。
 *
 * 背景：Bug 1058 / 1059 已约定「引擎内部临时名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName`），Bug 1127 把该口径落到
 * `__nudoMp*` 族（member-path / assignment）。本条落到**调用族**：
 *
 * - `Object.defineProperty(o, "x", { value: __nudoDefR })` 的**实参在
 *   `const __nudoDefR = $invoke(…)` 的初始化器内求值** ⇒ 用户源码里的同名
 *   绑定被引擎临时量遮蔽（读到引擎临时量 ⇒ 自信的错值 ⇒ 签名面写错 ⇒ 门禁
 *   **假绿**）或撞上引擎自引用（TDZ ⇒ ReferenceError ⇒ 原生值被算成
 *   `never throws ReferenceError` ⇒ 门禁**假红**）；
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
import { describe, it, expect, beforeEach } from "vitest";
import { call, val, throwsError } from "./eval-helpers.ts";
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

describe("Bug 1146：调用族内部临时名（__nudoDefR / __nudoReArgs / __v）与用户标识符避让", () => {
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

  describe("Object.defineProperty 族（__nudoDefR）", () => {
    it("触发 1：值实参读用户同名绑定 → 5（原生 5；修前：ReferenceError）", () => {
      expect(v(SRC_VALUE)).toBe(5);
      expect(refError(SRC_VALUE)).toBe(false);
    });

    it("触发 2：目标实参是用户同名绑定 → \"2|1\"（原生同款；修前：ReferenceError）", () => {
      expect(v(SRC_TARGET)).toBe("2|1");
      expect(refError(SRC_TARGET)).toBe(false);
    });

    it("触发 3：成员路径目标 + 用户同名绑定 → 3（原生 3；修前：ReferenceError）", () => {
      expect(v(SRC_NESTED)).toBe(3);
      expect(refError(SRC_NESTED)).toBe(false);
    });

    it("触发 4：模块级同名绑定 → 9（原生 9；修前：ReferenceError）", () => {
      expect(v(SRC_MODULE_SCOPE)).toBe(9);
      expect(refError(SRC_MODULE_SCOPE)).toBe(false);
    });
  });

  describe("RegExp 状态写回族（__nudoReArgs / __v）", () => {
    it("触发 5：__nudoReArgs → true（原生 true；修前：ReferenceError）", () => {
      expect(v(SRC_RE_ARGS)).toBe(true);
      expect(refError(SRC_RE_ARGS)).toBe(false);
    });

    it("触发 6：__v → true（原生 true；修前：ReferenceError）", () => {
      expect(v(SRC_RE_RES)).toBe(true);
      expect(refError(SRC_RE_RES)).toBe(false);
    });

    it("触发 7：exec + __nudoReArgs → \"7\"（原生 \"7\"；修前：ReferenceError）", () => {
      expect(v(SRC_RE_EXEC)).toBe("7");
      expect(refError(SRC_RE_EXEC)).toBe(false);
    });
  });

  describe("check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面拿到精确值（修前：never throws ReferenceError）", () => {
      expect(sig(SRC_VALUE)).toBe("5");
      expect(sig(SRC_TARGET)).toBe('"2|1"');
      expect(sig(SRC_NESTED)).toBe("3");
      expect(sig(SRC_MODULE_SCOPE)).toBe("9");
      expect(sig(SRC_RE_ARGS)).toBe("true");
      expect(sig(SRC_RE_RES)).toBe("true");
      expect(sig(SRC_RE_EXEC)).toBe('"7"');
    });

    it("撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）", () => {
      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:entry-may-throw");
      }
    });

    it("撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
      for (const src of ALL_SOURCES) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    });
  });

  describe("确定性 / 产物逐字不变", () => {
    it("无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）", () => {
      const src = `export function f() {
        const o = {};
        Object.defineProperty(o, "x", { value: 5 });
        return o.x;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoDefR");
      expect(js).not.toMatch(/__nudoDefR[A-Za-z0-9_]*_1\b/);
    });

    it("无碰撞时正则族临时名逐字保持基名（`__nudoReArgs` / `__v`）", () => {
      const src = `export function f() {
        const r = /a/;
        return r.test("a");
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoReArgs");
      expect(js).toContain("__v");
      expect(js).not.toMatch(/__nudoReArgs[A-Za-z0-9_]*_1\b/);
    });

    it("撞名时改名（`__nudoDefR` → `__nudoDefR_1`）且仍确定（同源两次逐字相同）", () => {
      const a = transpileSource(SRC_VALUE, { source: SRC_VALUE });
      const b = transpileSource(SRC_VALUE, { source: SRC_VALUE });
      expect(a).toBe(b);
      expect(a).toContain("__nudoDefR_1");
    });

    it("正则族撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定", () => {
      const a = transpileSource(SRC_RE_ARGS, { source: SRC_RE_ARGS });
      const b = transpileSource(SRC_RE_ARGS, { source: SRC_RE_ARGS });
      expect(a).toBe(b);
      expect(a).toContain("__nudoReArgs_1");
    });
  });
});
