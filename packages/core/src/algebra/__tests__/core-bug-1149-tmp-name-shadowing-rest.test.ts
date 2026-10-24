/**
 * Bug 1149 回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。
 *
 * 背景：Bug 1058 / 1059 已约定「引擎内部临时名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`），
 * Bug 1127 落到 `__nudoMp*` 族，Bug 1146 落到调用族（`expr/call.ts`）。
 * 本条落到**其余落点**：
 *
 * - `expr/optional-chain.ts`（1149-a）：可选链整链短路的 IIFE 在**自身作用域
 *   里求值用户表达式**（正则实参 / 删除键 / 计算键 / 接收者剪枝源）⇒ 写死名
 *   （`__nudoReArgs` / `__v` / `__nudoDelP` / `__nudoDelK` / `__oc` / `$__oc`
 *   / `$__fn`）会与用户同名绑定相撞：
 *   - **遮蔽** ⇒ 用户表达式读到引擎临时量（自信的错值 ⇒ 签名面写错 ⇒ 门禁
 *     **假绿**）；
 *   - **TDZ ReferenceError** ⇒ 原生值被算成 `never throws ReferenceError`
 *     ⇒ 门禁**假红**；
 * - `expr/short-circuit.ts`（1149-b）：fork 臂 IIFE 同款（`__v` 臂值载体 /
 *   `__test` 左绑定 / `__sc0` 左绑定 / `__r` fork 结果载体）；另「复用左绑定」
 *   哨兵 `"__test"` **只按字符串比对** ⇒ 用户标识符恰好叫 `__test` 时被误判
 *   成哨兵 ⇒ 臂返回左绑定而不是用户的值（自信错值 ⇒ 假绿）；
 * - `expr/object.ts`（1149-b）：setter thunk 的首参载体（`__v`）/ 计算键 IIFE
 *   形参（`__k` / `__nudoObjBase`）/ proto 段链 IIFE 形参（`__nudoProtoBox`）
 *   ——thunk/IIFE 在自身作用域求值用户表达式 ⇒ 同款相撞。
 *
 * 修法：生成名经 `internalTmpName` / `internalTmpNameSet` 分配（与 Bug
 * 1058/1059 / 1127 / 1146 同款避让口径 = `userIdentInfoOf(opts)` 避让集 ∪
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

describe("Bug 1149：剩余族内部临时名（可选链 / 短路 / 对象）与用户标识符避让", () => {
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

  describe("1149-a：可选链正则状态写回族（__nudoReArgs / __v）", () => {
    it("触发 A1：__nudoReArgs → true（原生 true；修前：ReferenceError）", () => {
      expect(v(SRC_A1)).toBe(true);
      expect(refError(SRC_A1)).toBe(false);
    });

    it("触发 A2：__v → true（原生 true；修前：ReferenceError）", () => {
      expect(v(SRC_A2)).toBe(true);
      expect(refError(SRC_A2)).toBe(false);
    });

    it("触发 A3：exec + __nudoReArgs → \"7\"（原生 \"7\"；修前：ReferenceError）", () => {
      expect(v(SRC_A3)).toBe("7");
      expect(refError(SRC_A3)).toBe(false);
    });
  });

  describe("1149-b：短路臂值载体族（__v）", () => {
    it("触发 B1：fork 臂 __v → \"a\"（原生 \"a\"；修前：ReferenceError）", () => {
      expect(v(SRC_B1)).toBe("a");
      expect(refError(SRC_B1)).toBe(false);
    });
  });

  describe("1149-b：对象 setter 首参载体族（__v）", () => {
    it("触发 C1：默认值形参 → 15（原生 15；修前：20）", () => {
      expect(v(SRC_C1)).toBe(15);
    });

    it("触发 C2：解构形参 → 15（原生 15；修前：非 15）", () => {
      expect(v(SRC_C2)).toBe(15);
    });
  });

  describe("同族落点：短路协议族（__test / __sc0 / 哨兵）", () => {
    it("触发 D1：左绑定 __test → \"a\"（原生 \"a\"；修前：ReferenceError）", () => {
      expect(v(SRC_D1)).toBe("a");
      expect(refError(SRC_D1)).toBe(false);
    });

    it("触发 D2：左绑定 __sc0 → 42（原生 42；修前：1）", () => {
      expect(v(SRC_D2)).toBe(42);
    });

    it("触发 D3：哨兵撞用户标识符 __test → 5（原生 5；修前：1）", () => {
      expect(v(SRC_D3)).toBe(5);
    });
  });

  describe("同族落点：可选链删除族（__nudoDelK）与守卫基绑定族（$__oc）", () => {
    it("触发 D4：删除键载体 __nudoDelK → 1（原生 1；修前：ReferenceError）", () => {
      expect(v(SRC_D4)).toBe(1);
      expect(refError(SRC_D4)).toBe(false);
    });

    it("触发 D5：守卫基绑定 $__oc → 1（原生 1；修前：undefined）", () => {
      expect(v(SRC_D5)).toBe(1);
    });
  });

  describe("同族落点：对象族（__nudoProtoBox / __k）", () => {
    it("触发 D6：proto 盒子 __nudoProtoBox → true（原生 true；修前：false）", () => {
      expect(v(SRC_D6)).toBe(true);
    });

    it("触发 D7：计算键形参 __k → 5（原生 5；修前：\"b\"）", () => {
      expect(v(SRC_D7)).toBe(5);
    });
  });

  describe("check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面拿到精确值（修前：never throws ReferenceError / 错值）", () => {
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
    it("无碰撞时可选链族临时名逐字保持基名（无 `_k` 后缀）", () => {
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
    });

    it("无碰撞时短路族临时名逐字保持基名（`__sc0` / `__test` / `__v` / `__r`）", () => {
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
    });

    it("无碰撞时对象族临时名逐字保持基名（`__v` / `__k` / `__nudoProtoBox`）", () => {
      const src = `export function f() {
        const p = { x: 1 };
        const o = { __proto__: p, y: 2 };
        return o.y;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoProtoBox");
      expect(js).not.toMatch(/__nudoProtoBox[A-Za-z0-9_]*_1\b/);
    });

    it("撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定（同源两次逐字相同）", () => {
      const a = transpileSource(SRC_A1, { source: SRC_A1 });
      const b = transpileSource(SRC_A1, { source: SRC_A1 });
      expect(a).toBe(b);
      expect(a).toContain("__nudoReArgs_1");
    });

    it("撞名时短路族改名（`__test` → `__test_1`）且仍确定", () => {
      const a = transpileSource(SRC_D1, { source: SRC_D1 });
      const b = transpileSource(SRC_D1, { source: SRC_D1 });
      expect(a).toBe(b);
      expect(a).toContain("__test_1");
    });

    it("撞名时对象族改名（`__v` → `__v_1`）且仍确定", () => {
      const a = transpileSource(SRC_C1, { source: SRC_C1 });
      const b = transpileSource(SRC_C1, { source: SRC_C1 });
      expect(a).toBe(b);
      expect(a).toContain("__v_1");
    });
  });
});
