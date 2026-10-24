/**
 * Bug 1127 回归钉：成员路径 / 赋值族的引擎**内部临时名**（`__nudoMp*`）必须
 * 与用户标识符**避让**。
 *
 * 背景：Bug 1058 / 1059 已约定「生成名必须避开用户标识符」
 * （`transpile/helpers.ts` 的 `internalTmpName`）。但 `__nudoMp*` 族此前是
 * **写死**的 ⇒ 用户源码里写了同名标识符时两种失效形态都成立：
 *
 * - **遮蔽**（本条主形态）：成员路径 IIFE **在自身作用域里求值用户表达式**
 *   （计算键 / RHS）⇒ IIFE 里的 `const __nudoMpRoot = …` / `const
 *   __nudoMpOld = …` 遮蔽用户同名绑定 ⇒ 用户的表达式读到**引擎临时量**
 *   （自信的错值）——原生值被算成别的值 ⇒ 签名面写错 ⇒ 门禁**假绿**；
 * - **TDZ ReferenceError**：`const __nudoMpK0 = __nudoMpDelK;`（引擎自引用）
 *   或 `const __nudoMpRoot = __nudoMpRoot;` ⇒ 求值期 ReferenceError ⇒ 整条
 *   表达式退化为 unknown / 抛。
 *
 * 修法：生成名经 `internalTmpNameSet` 分配（`userIdentInfoOf(opts)` 避让集 =
 * 源文本词形 ∪ `opts.userIdents`；撞名加 `_k` 后缀）——与 Bug 1058/1059 同款
 * 口径，**不造第二套命名机制**。无碰撞时基名原样返回 ⇒ 产物逐字不变；
 * 同一源文本 ⇒ 同一名 ⇒ 产物确定性（缓存键 / 差分语料依赖它）。
 *
 * 锚定值均为 node v26.10.0 原生实测（见各断言注释）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { checkSource, pTrue, transpileSource } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

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

describe("Bug 1127：__nudoMp* 内部临时名与用户标识符避让", () => {
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

  describe("报告 3 条触发（逐条）", () => {
    it("触发 1：__nudoMpRoot 撞名 → 4（原生 4；修前：ReferenceError）", () => {
      expect(v(SRC_ROOT)).toBe(4);
    });

    it("触发 2：__nudoMpOld 撞名 → 12（原生 12；修前：13）", () => {
      expect(v(SRC_OLD)).toBe(12);
    });

    it("触发 3：__nudoMpRoot 撞名 + 计算键 → 7（原生 7；修前：1）", () => {
      expect(v(SRC_KEY)).toBe(7);
    });
  });

  describe("临时名族全覆盖（member-path 层 + assignment 兜底臂）", () => {
    it("__nudoMpObj（assignment 兜底臂的对象载体）→ 8（原生 8；修前：unknown）", () => {
      const src = `export function f() {
        let __nudoMpObj = 7;
        const mk = () => ({ x: 1 });
        const v = mk().x = __nudoMpObj + 1;
        return v;
      }`;
      expect(v(src)).toBe(8);
    });

    it("__nudoMpOld（assignment 兜底臂的旧值载体）→ 11（原生 11；修前：2）", () => {
      const src = `export function f() {
        let __nudoMpOld = 10;
        const mk = () => ({ x: 1 });
        const v = mk().x += __nudoMpOld;
        return v;
      }`;
      expect(v(src)).toBe(11);
    });

    it("__nudoMpKey（assignment 兜底臂的计算键载体）→ 11（原生 11；修前：1）", () => {
      const src = `export function f() {
        let __nudoMpKey = 10;
        const i = 0;
        const mk = () => [1];
        const v = mk()[i] += __nudoMpKey;
        return v;
      }`;
      expect(v(src)).toBe(11);
    });

    it("__nudoMpK0（层键载体）→ 2（原生 2；修前：ReferenceError）", () => {
      const src = `export function f() {
        const o = { k: 1 };
        const __nudoMpK0 = "k";
        o[__nudoMpK0]++;
        return o.k;
      }`;
      expect(v(src)).toBe(2);
    });

    it("__nudoMpC0（中间层持有者载体）→ 6（原生 6；修前：unknown）", () => {
      const src = `export function f() {
        const o = { a: { b: 1 } };
        const __nudoMpC0 = 5;
        o.a.b += __nudoMpC0;
        return o.a.b;
      }`;
      expect(v(src)).toBe(6);
    });

    it("__nudoMpVal（写入值载体）→ 11（原生 11；修前：unknown）", () => {
      const src = `export function f() {
        const o = { p: 1 };
        const __nudoMpVal = 10;
        o.p = o.p + __nudoMpVal;
        return o.p;
      }`;
      expect(v(src)).toBe(11);
    });

    it("__nudoMpNew（新值载体）→ 11（原生 11；修前：ReferenceError）", () => {
      const src = `export function f() {
        const o = { p: 1 };
        const __nudoMpNew = 10;
        o.p += __nudoMpNew;
        return o.p;
      }`;
      expect(v(src)).toBe(11);
    });

    it("__nudoMpDelK（delete 键载体）→ \"true|undefined\"（原生同款；修前：ReferenceError）", () => {
      const src = `export function f() {
        const o = { k: 1 };
        const __nudoMpDelK = "k";
        const r = delete o[__nudoMpDelK];
        return r + "|" + o.k;
      }`;
      expect(v(src)).toBe("true|undefined");
    });

    it("__nudoMpRes（写回结果载体）→ 11（原生 11；修前：unknown）", () => {
      const src = `export function f() {
        const o = { p: 1 };
        const __nudoMpRes = 10;
        o.p = o.p + __nudoMpRes;
        return o.p;
      }`;
      expect(v(src)).toBe(11);
    });

    it("派生路径（optional 链 delete 的前缀路径）→ \"true|{\\\"a\\\":{}}\"（原生同款）", () => {
      // 派生路径用对象字面量重建 MemberPath（丢 MemberPath 上的字段）⇒
      // 临时名须经**共享的层对象**继承，否则前缀路径仍写死名。
      const src = `export function f() {
        const __nudoMpRoot = "a";
        const o = { a: { b: 1 } };
        const r = delete o?.[__nudoMpRoot]?.b;
        return r + "|" + JSON.stringify(o);
      }`;
      expect(v(src)).toBe('true|{"a":{}}');
    });

    it("派生路径 + 层键载体 __nudoMpK0 → \"true|{\\\"a\\\":{}}\"（原生同款）", () => {
      const src = `export function f() {
        const __nudoMpK0 = "a";
        const o = { a: { b: 1 } };
        const r = delete o?.[__nudoMpK0]?.b;
        return r + "|" + JSON.stringify(o);
      }`;
      expect(v(src)).toBe('true|{"a":{}}');
    });
  });

  describe("check 门禁面（不假红 / 不假绿）", () => {
    it("撞名时签名面仍拿到精确值（修前：unknown / 错值）", () => {
      expect(sigOf(SRC_ROOT)).toBe("4");
      expect(sigOf(SRC_OLD)).toBe("12");
      expect(sigOf(SRC_KEY)).toBe("7");
    });

    it("撞名时无假 nudo:opaque-result（整模块 fail-closed 面）", () => {
      for (const src of [SRC_ROOT, SRC_OLD, SRC_KEY]) {
        expect(issueCodes(src)).not.toContain("nudo:opaque-result");
      }
    });
  });

  describe("确定性 / 产物逐字不变", () => {
    it("无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）", () => {
      const src = `export function f() {
        const o = { p: 1 };
        o.p += 2;
        return o.p;
      }`;
      const js = transpileSource(src, { source: src });
      expect(js).toContain("__nudoMpRoot");
      expect(js).not.toMatch(/__nudoMp[A-Za-z0-9_]*_1\b/);
    });

    it("撞名时改名（`__nudoMpRoot` → `__nudoMpRoot_1`）且仍确定（同源两次逐字相同）", () => {
      const a = transpileSource(SRC_ROOT, { source: SRC_ROOT });
      const b = transpileSource(SRC_ROOT, { source: SRC_ROOT });
      expect(a).toBe(b);
      expect(a).toContain("__nudoMpRoot_1");
    });

    it("同一源码转译两次 ⇒ 产物逐字相同（确定性）", () => {
      const a = transpileSource(SRC_KEY, { source: SRC_KEY });
      const b = transpileSource(SRC_KEY, { source: SRC_KEY });
      expect(a).toBe(b);
    });
  });
});
