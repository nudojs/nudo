/**
 * 「第三种」· service 侧回归钉：元素域同源投影 + 返回注解一致性诊断。
 *
 * 两条纪律：
 * ① `iteratorTSType` 的 T 优先取 `facets.genElements`（完整序列）；
 *    字段缺省时**严格 fallback** 到 shape 数字槽 ⇒ 手工夹具 / harvest
 *    / 旧 Abs 的产物逐字不变。
 * ② 实现是事实、声明是断言：冲突只落 `nudo:return-annotation-mismatch`
 *    台账，**绝不覆盖观测产物**（避免 BUG-168 在形参位修掉的「两面相反」
 *    在返回位复现）。判据刻意收窄到「两侧都是单一基类型且互斥」，
 *    联合 / 泛型 / 字面量 / unknown 一律不判 ⇒ 零假阳性。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "../../analyzer.ts";

function fnSlot(): { value: Abs; internal: boolean } {
  return { value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"), internal: true };
}

/** 生成器形态的手工 Abs（无 facets ⇒ 走旧数字槽路径）。 */
function structuralGen(elems: Abs[]): Abs {
  const slots: Record<string, { value: Abs; internal?: boolean }> = { next: fnSlot() };
  elems.forEach((v, i) => {
    slots[String(i)] = { value: v, internal: true };
  });
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

function dtsOf(source: string, path = "/test/third.ts"): string {
  return generateDts(analyzeFile(path, source));
}

describe("元素域同源投影", () => {
  it("只有 facets.genElements、无数字槽 ⇒ 仍投影出精确元素类型", () => {
    const g = structuralGen([]);
    g.facets = { brand: "Generator", genElements: [numLit(7)] };
    expect(absToTSType(g)).toBe("Generator<number>");
  });

  it("无 facets 的旧 Abs ⇒ 严格 fallback 到数字槽，产物逐字不变", () => {
    expect(absToTSType(structuralGen([numLit(3)]))).toBe("IterableIterator<number>");
  });

  it("fork 分支生成器：完整序列救回被 shape 折成 unknown 的联合", () => {
    const out = dtsOf(
      `export function* m(flag: boolean) { if (flag) yield 1; else yield "s"; }`,
    );
    expect(out).toContain("Generator<number | string");
    expect(out).not.toContain("Generator<unknown");
  });

  it("facets.genElements 优先于数字槽（两者不一致时以承载位为准）", () => {
    const g = structuralGen([numLit(1)]);
    g.facets = { brand: "Generator", genElements: [numLit(2)] };
    expect(absToTSType(g)).toContain("Generator<number>");
  });
});

describe("返回注解：只做一致性校验，不覆盖产物", () => {
  it("declaredReturnType 透传到 FunctionAnalysis", () => {
    const r = analyzeFile(
      "/test/third.ts",
      `export function* a(): Generator<number> { yield 1; }`,
    );
    expect(r.functions.find((f) => f.name === "a")?.declaredReturnType).toBe(
      "Generator<number>",
    );
  });

  it("声明与观测冲突 ⇒ 出台账，产物仍是观测类型", () => {
    const out = dtsOf(`export function* i(): Generator<number> { yield "s"; }`);
    expect(out).toContain("nudo:return-annotation-mismatch i");
    expect(out).toContain('declared element "number", observed "string"');
    expect(out).toContain("kept the observed type");
    expect(out).toContain("Generator<string");
    expect(out).not.toContain("function i(): Generator<number>");
  });

  it("声明与观测一致 ⇒ 无台账", () => {
    const out = dtsOf(`export function* a(): Generator<number> { yield 1; yield 2; }`);
    expect(out).not.toContain("return-annotation-mismatch");
    expect(out).toContain("Generator<number");
  });

  it("窄判据：字面量联合 / 泛型 / widen 口径差异不误报", () => {
    const out = dtsOf(
      `export function* l(): Generator<1 | 2> { yield 1; yield 2; }
export function* j<T>(): Generator<T> { yield 1; }`,
    );
    expect(out).not.toContain("return-annotation-mismatch");
    expect(out).toContain("Generator<number");
  });

  it(".js 源 / 无返回注解 ⇒ 零影响", () => {
    const out = dtsOf(`export function* g() { yield 1; }`, "/test/third.js");
    expect(out).not.toContain("return-annotation-mismatch");
    expect(out).toContain("Generator<number");
  });
});
