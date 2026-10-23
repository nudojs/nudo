/**
 * Bug 408 —— 返回 inlay 的锚点对**表达式体**箭头函数落在表达式**内部**
 * （把源码行劈开）。
 *
 * 改前：`collectAbsInlays` 无条件取 `fnNode.body?.loc.start` 作为返回 inlay
 * 的锚点。对**块体**它等于 `{` 的位置（正确）；对**表达式体**它等于**表达式
 * 的起点** ⇒ 标注被插到 `=>` 与表达式之间：
 *
 *   export const arrow = (v) => : v * 2  · derived   v * 2;
 *
 * 改后：块体 ⇒ `{` 位置（不变）；表达式体 ⇒ **整个表达式的结束**位置
 * （标注落在表达式之后，不劈开源码行；口径同 TypeScript 自身的返回类型
 * inlay —— 提示落在被标注表达式之后）。
 *
 * 既有 `inlay.test.ts` / `inlay-interface-tier.test.ts` 只断言 label **内容**，
 * **无任何落点位置断言** ⇒ 本钉补落点断言。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

const retInlay = (src: string) => {
  const inlays = collectAbsInlays(src, { fromFile: "/t/a.js" });
  const ret = inlays.find((i) => i.kind === "type");
  expect(ret).toBeDefined();
  return ret!;
};

describe("Bug 408：表达式体箭头函数的返回 inlay 锚点", () => {
  it("表达式体：锚点在表达式结束处（改前 = 表达式起点 ⇒ 劈开源码行）", () => {
    const src = `export const arrow = (v) => v * 2;`;
    const expr = "v * 2";
    const exprStart = src.indexOf(expr);
    const exprEnd = exprStart + expr.length;
    const ret = retInlay(src);

    expect(ret.line).toBe(1);
    // 落点 = 表达式结束列
    expect(ret.character).toBe(exprEnd);
    // 改前的落点（表达式起点）必须不再是落点
    expect(ret.character).not.toBe(exprStart);
    // 标注不得插在表达式内部
    expect(ret.character).toBeGreaterThan(exprStart);
    // 落点之前的源码文本必须**完整包含**该表达式（没被劈开）
    expect(src.slice(0, ret.character)).toContain(expr);
    // 返回计算形仍在（label 内容不被落点修复牵连）
    expect(ret.label).toContain("v * 2");
  });

  it("块体：锚点仍是 `{` 的位置（不变）", () => {
    const src = `export function plain(a, b) {\n  return a + b;\n}`;
    const ret = retInlay(src);
    expect(ret.line).toBe(1);
    expect(ret.character).toBe(src.indexOf("{"));
  });

  it("箭头块体：锚点仍是 `{` 的位置（不变）", () => {
    const src = `export const blk = (v) => {\n  return v * 2;\n}`;
    const ret = retInlay(src);
    expect(ret.line).toBe(1);
    expect(ret.character).toBe(src.indexOf("{"));
  });

  it("表达式体（对象字面量）：锚点在字面量之后（不插进字面量内部）", () => {
    const src = `export const mk = (v) => ({ v });`;
    // Babel 的 body 节点是 `ObjectExpression`（不含外层包裹括号）⇒ 锚点落在
    // 字面量末尾（包裹括号内），但**不在字面量内部**。
    const lit = "{ v }";
    const litStart = src.indexOf(lit);
    const ret = retInlay(src);
    expect(ret.character).toBeGreaterThanOrEqual(litStart + lit.length);
    expect(ret.character).not.toBe(litStart);
    expect(ret.character).not.toBe(src.indexOf("({ v })"));
  });
});
