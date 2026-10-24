/**
 * Bug 1158（附录 A#1）：模块顶层**必然抛** ⇒ 求值回落 `module-throw` ⇒ 导出
 * 全丢。旧口径：**零诊断 + exit 0**（签名退化成 `f() => unknown`，L2 无证据）
 * ⇒ 引擎**完全没能分析**的模块被判绿 = fail-open。
 *
 * 修法：发一条**模块级** error 级 `nudo:module-throw`，定位 = 顶层 `throw`。
 *
 * **判据只认句法证据**（`check-may-throw.ts` 的 `definiteModuleThrowOf`）：
 * 顶层语句序列里**无条件**执行的 `throw`。为什么不用引擎的「抽象上必抛」结论：
 * 真实包实测（node_modules 的 6 个文件：`typescript/lib/_tsserver.js`、
 * `react-dom/cjs/*`、`vitest/dist/chunks/*`）顶层**没有** `throw` 语句却回落
 * `module-throw` —— 那是宿主 API 近似（缺失依赖 → 闭合对象 → 方法不可调用）
 * 的产物，不是程序自己的抛（react-dom 的两个 cjs bundle 原生 `require()` 实测
 * 成功）⇒ 拿引擎结论做门禁 = **假红**。本文件同时钉住两侧：显式顶层 `throw`
 * ⇒ 报；引擎近似抛 / 条件抛 / try 内抛 ⇒ 不报（现状不变）。
 *
 * 抑制口径与 L2 同源：`entryThrows: "off"` 关闸（零 FP 语料库同款）、
 * `"warning"` 降档、`ignoreThrows` 按抛出类型名放行（`Error` 盖整族）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { tryRunTranspiledDetailed } from "../exec/run.ts";
import { l2Count, sigOf } from "./nudo-constraints.ts";

/** `nudo:module-throw` 诊断全集（模块级：无 `fn`） */
function moduleThrowIssues(r: { issues: { code: string; severity: string; message: string; fn?: string; line?: number; column?: number }[] }) {
  return r.issues.filter((i) => i.code === "nudo:module-throw");
}

describe("Bug 1158：模块装载期必抛 ⇒ nudo:module-throw（fail-closed）", () => {
  it("顶层无条件 throw ⇒ 1 条 error（改前：零诊断 + ok=true）", () => {
    const src = `throw new TypeError("boom");
export function f(){ return 1; }`;
    const r = checkSource("b1158-1.js", src, pTrue);
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    // 抛出类型名进文案（jump 到 throw 的 loc，无 fn——模块级）
    expect(hits[0]!.message).toContain("TypeError");
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.column).toBe(0);
    expect(hits[0]!.fn).toBeUndefined();
    // 门禁面：error ⇒ 报告不 ok（改前这里 ok=true / exit 0 = 假绿）
    expect(r.ok).toBe(false);
    // 旧口径的退化面仍在（诊断解释它，不是把签名「修好」）
    expect(sigOf(r, "f")).toBe("unknown");
  });

  it("裸块 { throw } 无条件下钻 ⇒ 报（loc 指向 throw 而非块首）", () => {
    const r = checkSource(
      "b1158-2.js",
      `{ throw new RangeError("r"); }
export function f(){ return 1; }`,
      pTrue,
    );
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("RangeError");
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.column).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("多个入口 / 入口前后的 throw ⇒ **一条**模块级诊断（不按入口重复）", () => {
    const before = checkSource(
      "b1158-3a.js",
      `throw new Error("boom");
export function a(){ return 1; }
export function b(x){ return x; }`,
      pTrue,
    );
    expect(moduleThrowIssues(before)).toHaveLength(1);
    expect(l2Count(before)).toBe(0);
    expect(before.ok).toBe(false);

    const after = checkSource(
      "b1158-3b.js",
      `export function a(){ return 1; }
export function b(x){ return x; }
throw new Error("late");`,
      pTrue,
    );
    expect(moduleThrowIssues(after)).toHaveLength(1);
    expect(moduleThrowIssues(after)[0]!.line).toBe(3);
  });

  it("CJS 入口形态同样覆盖（exports.f 后顶层 throw）", () => {
    const r = checkSource(
      "b1158-4.cjs",
      `exports.f = function(){ return 1; };
throw new Error("cjs boom");`,
      pTrue,
    );
    expect(moduleThrowIssues(r)).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it("负控：条件抛（未知宿主守卫）⇒ 不报，行为逐字不变", () => {
    const src = `if (typeof window === "undefined") throw new Error("no window");
export function f(){ return 1; }`;
    const r = checkSource("b1158-5.js", src, pTrue);
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(sigOf(r, "f")).toBe("1");
  });

  it("负控：try/catch 吸收的 throw ⇒ 模块可正常装载，不报", () => {
    const r = checkSource(
      "b1158-6.js",
      `try { throw new Error("x"); } catch { }
export function f(){ return 1; }`,
      pTrue,
    );
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("负控：函数体内的 throw 不是装载期抛（L2 entry-may-throw 负责）", () => {
    const r = checkSource(
      "b1158-7.js",
      `export function f(){ throw new Error("x"); }`,
      pTrue,
    );
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("负控：不抛的模块 ⇒ 零诊断 / ok（不假红）", () => {
    const r = checkSource("b1158-8.js", `export function f(){ return 1; }`, pTrue);
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(sigOf(r, "f")).toBe("1");
  });

  it("FP 锚点缩形：引擎近似抛（原生可装载）⇒ **不报**", () => {
    // `typescript/lib/_tsserver.js` 的最小机制复现：缺失依赖经 `__toESM`
    // 变成**闭合对象** ⇒ 引擎认为 `dep.setStackTraceLimit` 一定不可调用 ⇒
    // hard throw。原生（依赖存在时）完全正常 ⇒ 不得算程序的账。
    const src = `var __defProp = Object.defineProperty;
var __copyProps = (to, from) => {
  if (from && typeof from === "object") {
    for (let key of Object.getOwnPropertyNames(from))
      if (!Object.prototype.hasOwnProperty.call(to, key))
        __defProp(to, key, { get: () => from[key], enumerable: true });
  }
  return to;
};
var __toESM = (mod) => __copyProps(mod != null ? Object.create(Object.getPrototypeOf(mod)) : {}, mod);
const dep = __toESM(require("./typescript.js"));
dep.setStackTraceLimit();
export function f(){ return 1; }`;
    // 前提：引擎**确实**回落 `module-throw`（否则本负控失去意义）
    expect(tryRunTranspiledDetailed(src, { mode: "analyze" }).fallback?.reason).toBe(
      "module-throw",
    );
    const r = checkSource("b1158-9.js", src, pTrue);
    expect(moduleThrowIssues(r)).toEqual([]);
  });

  it("负控：无 throw 语句的定抛形态（JSON.parse 坏字面量 / null 成员）⇒ 不报", () => {
    const json = `export const v = JSON.parse("{");
export function f(){ return 1; }`;
    expect(tryRunTranspiledDetailed(json, { mode: "analyze" }).fallback?.reason).toBe(
      "module-throw",
    );
    const rj = checkSource("b1158-10a.js", json, pTrue);
    expect(moduleThrowIssues(rj)).toEqual([]);

    const nullish = `const o = null;
export const v = o.x;
export function f(){ return 1; }`;
    expect(
      tryRunTranspiledDetailed(nullish, { mode: "analyze" }).fallback?.reason,
    ).toBe("module-throw");
    const rn = checkSource("b1158-10b.js", nullish, pTrue);
    expect(moduleThrowIssues(rn)).toEqual([]);
  });

  it("真实包锚点缩形：React Server 入口 stub（确定要抛）⇒ 报 Error", () => {
    // react-dom/client.react-server.js 原文（同一语义的缩形）：无任何入口，
    // 装载即抛 ⇒ 模块不可导入。这是**程序自己的** fail-fast，不是引擎近似。
    const r = checkSource(
      "b1158-11.js",
      `'use strict';

throw new Error(
  'react-dom/client is not supported in React Server Components.'
);`,
      pTrue,
    );
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("Error");
    expect(hits[0]!.line).toBe(3);
    expect(r.ok).toBe(false);
  });

  it("抑制口径：entryThrows off 关闸 / warning 降档 / ignore-throws 按类型放行", () => {
    const src = `throw new TypeError("boom");
export function f(){ return 1; }`;

    const off = checkSource("b1158-12a.js", src, pTrue, { entryThrows: "off" });
    expect(moduleThrowIssues(off)).toEqual([]);
    expect(off.ok).toBe(true);

    const warn = checkSource("b1158-12b.js", src, pTrue, { entryThrows: "warning" });
    expect(moduleThrowIssues(warn).map((i) => i.severity)).toEqual(["warning"]);
    expect(warn.ok).toBe(true);

    const ignored = checkSource("b1158-12c.js", src, pTrue, {
      ignoreThrows: ["TypeError"],
    });
    expect(moduleThrowIssues(ignored)).toEqual([]);

    // `Error` 盖整族（TypeError ⊂ Error 族）
    const family = checkSource("b1158-12d.js", src, pTrue, {
      ignoreThrows: ["Error"],
    });
    expect(moduleThrowIssues(family)).toEqual([]);

    // 负控：不相干的 ignore 名不得放行
    const other = checkSource("b1158-12e.js", src, pTrue, {
      ignoreThrows: ["RangeError"],
    });
    expect(moduleThrowIssues(other)).toHaveLength(1);
  });
});
