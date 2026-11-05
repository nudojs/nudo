/**
 * Bug 558：quickfix「[silence] Declare @nudo:throws X」按**名字首匹配**定位
 * 声明 ⇒ 注解落进**别的函数体** ⇒ 门禁**完全不变**（一个「点了也没用」的
 * quickfix）。
 *
 * 根因：findFnDeclStart 用行级正则找**首个**同名命中——别的函数体里的同名
 * 局部绑定（`const alpha = 1`）也会命中。
 *
 * 本钉：定位按**作用域**（模块顶层的同名声明）；同名局部绑定不再命中。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import {
  addThrowsAnnotation,
  applyTextEdits,
  findFnDeclStart,
} from "../quickfix-edits.ts";

const SRC = `export function beta() {
  const alpha = 1;
  return alpha;
}

/**
 * alpha docs
 */
export function alpha(x) {
  return x.toFixed(2);
}
`;

describe("Bug 558 — quickfix 定位按作用域（最近的同名声明）", () => {
  it("同名局部绑定不再命中：定位到顶层声明", () => {
    const lines = SRC.split("\n");
    // 契约：返回**附着的 JSDoc 起点**（alpha 的 JSDoc 在第 5 行，声明在第 8 行）
    expect(findFnDeclStart(lines, "alpha")).toBe(5);
    expect(findFnDeclStart(lines, "beta")).toBe(0);
    // 改前形态：旧的行级正则首匹配会命中 `  const alpha = 1;`（第 1 行）
    expect(lines[1]).toContain("const alpha = 1;");
  });

  it("注解落进顶层 alpha 的 JSDoc（不是 beta 的函数体）", () => {
    const r = addThrowsAnnotation(SRC, "alpha", "TypeError");
    expect(r).toBeDefined();
    const next = applyTextEdits(SRC, r!.edits);
    expect(() => parse(next)).not.toThrow();
    // tag 在 alpha 的 JSDoc 里（beta 的函数体里不得出现）
    const betaEnd = next.indexOf("return alpha;");
    const tag = next.indexOf("@nudo:throws TypeError");
    expect(tag).toBeGreaterThan(betaEnd);
    expect(next).toContain(" * alpha docs\n * @nudo:throws TypeError\n */");
  });

  it("改前形态：旧实现把注解写进 beta 的函数体（回归有效性自证）", () => {
    // 旧实现（行级正则首匹配）会命中 `  const alpha = 1;` 那一行
    const legacyLine = SRC.split("\n").findIndex((l) => l.includes("const alpha = 1;"));
    expect(legacyLine).toBeGreaterThan(-1);
    expect(legacyLine).toBeLessThan(findFnDeclStart(SRC.split("\n"), "alpha"));
  });

  it("负控制：顶层 const 箭头函数仍可定位（既有行为不变）", () => {
    const src = `export const gamma = (y) => y + 1;
`;
    expect(findFnDeclStart(src.split("\n"), "gamma")).toBe(0);
    const r = addThrowsAnnotation(src, "gamma", "TypeError");
    expect(r).toBeDefined();
    const next = applyTextEdits(src, r!.edits);
    expect(() => parse(next)).not.toThrow();
    expect(next).toContain("@nudo:throws TypeError");
  });

  it("负控制：函数体里的同名局部 const 不是目标函数 → 不定位", () => {
    const src = `export function outer() {
  const inner = 1;
  return inner;
}
`;
    expect(findFnDeclStart(src.split("\n"), "inner")).toBe(-1);
    expect(addThrowsAnnotation(src, "inner", "TypeError")).toBeUndefined();
  });
});
