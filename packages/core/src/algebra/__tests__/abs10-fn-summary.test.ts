/**
 * ABS-10：摘要式模块化分析（跨 PolyFn 实例的后置摘要）。
 *
 * 口径（保守起点，计划 §ABS-10 风险段）：
 * - 摘要 = 一次 body 求值的后置 Abs + α 变元顺序；键 = 函数身份（源码 +
 *   名字 + 依赖/侧车指纹）× 实例键（α-规范化实参 + Φ，含 conf 摘要）。
 * - 只有纯上下文（无 refine / inject / 自定义 budget、依赖指纹可信）才
 *   进摘要；其它上下文直接走 body（不进不出）。
 * - 命中结果与 body 路径逐字节一致（同实例 memo 仍为第一层）。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs } from "../abs.ts";
import { v } from "../term.ts";
import { formatAbs } from "../format/format.ts";
import {
  generalizeFromAst,
  resetGeneralizeMemo,
} from "../generalize.ts";
import {
  fnSummaryStats,
  resetFnSummaryCache,
} from "../key/fn-summary.ts";

function arg(id: string) {
  return makeAbs({ k: "prim", type: "number" }, v(id), undefined, "path");
}

describe("ABS-10 跨实例后置摘要", () => {
  it("同函数两次 generalize（不同实例）共享摘要：结果逐字节一致且命中", () => {
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const src = `export function f(x) { return x + 1; }`;
    const g1 = generalizeFromAst("f", src, { label: "a" })!;
    const g2 = generalizeFromAst("f", src, { label: "b" })!;
    expect(g1).not.toBe(g2); // 不同 L0 键 ⇒ 不同 PolyFn 实例
    const a = arg("q");
    const r1 = g1.instantiate([a]);
    const r2 = g2.instantiate([a]);
    expect(formatAbs(r2)).toBe(formatAbs(r1));
    const stats = fnSummaryStats();
    expect(stats.stores).toBeGreaterThanOrEqual(1);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    // 摘要层不改变精度：与清空摘要后重跑 body 的结果一致
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const g3 = generalizeFromAst("f", src)!;
    expect(formatAbs(g3.instantiate([arg("q")]))).toBe(formatAbs(r1));
  });

  it("α-同构实参共享同一条目（变元名按调用方恢复）", () => {
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const src = `export function id(x) { return x; }`;
    const g1 = generalizeFromAst("id", src, { label: "a" })!;
    const rExact = g1.instantiate([arg("vq")]);
    const hitsBefore = fnSummaryStats().hits;
    const rOther = g1.instantiate([arg("vp")]);
    // 键按 α-规范化：q 与 p 同构 ⇒ 同一条目（+ symbolic 面各自一条）；
    // 结果把变元名恢复成调用方名字
    expect(fnSummaryStats().size).toBeLessThanOrEqual(2);
    expect(formatAbs(rOther)).toBe("number  = vp  #path");
    expect(formatAbs(rOther).replace("vp", "V")).toBe(
      formatAbs(rExact).replace("vq", "V"),
    );
    // 第二次实例化命中实例 memo（不重复求值/存储）
    expect(fnSummaryStats().hits).toBe(hitsBefore);
  });

  it("refine 上下文不进摘要（闭包身份不可哈希 ⇒ 直接走 body）", () => {
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const src = `export function g(x) { return x * 2; }
`;
    const g1 = generalizeFromAst("g", src, {
      label: "a",
      refine: { fromFile: "/t/abs10.js" },
    })!;
    g1.instantiate([arg("q")]);
    const stats = fnSummaryStats();
    expect(stats.size).toBe(0);
    expect(stats.stores).toBe(0);
  });

  it("递归函数：同一实例重复实例化仍由实例 memo 命中（不重复存储）", () => {
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const src = `export function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }`;
    const g1 = generalizeFromAst("fact", src, { label: "a" })!;
    const r1 = g1.instantiate([arg("q")]);
    const before = fnSummaryStats().stores;
    const r2 = g1.instantiate([arg("q")]);
    expect(formatAbs(r2)).toBe(formatAbs(r1));
    // 同实例第二次命中实例 memo ⇒ 不新增摘要条目
    expect(fnSummaryStats().stores).toBe(before);
  });
});
