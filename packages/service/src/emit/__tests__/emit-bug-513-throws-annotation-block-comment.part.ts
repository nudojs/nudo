/**
 * Bug 513：quickfix「[silence] Declare @nudo:throws X」在**块注释**场景写出
 * **语法错误**的文件。
 *
 * 根因：addThrowsAnnotation 从声明行**向下**扫「首个含 JSDoc 收尾标记的行」
 * 当 JSDoc 收尾——普通块注释（`/* note *\/`）同样含该标记 ⇒ 裸 tag（无 JSDoc
 * 外壳）被插到注释之外 ⇒ 文件不再是合法 JS。
 *
 * 本钉：产物必须**仍可解析**（@nudojs/parser 解析不抛），且 tag 必须落在
 * 声明**附着**的 JSDoc 里（不是函数体里的注释）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { addThrowsAnnotation, applyTextEdits } from "../quickfix-edits.ts";

function annotate(src: string, fn = "f", kind = "TypeError"): string {
  const r = addThrowsAnnotation(src, fn, kind);
  expect(r, "addThrowsAnnotation 必须给出编辑").toBeDefined();
  return applyTextEdits(src, r!.edits);
}

function parses(src: string): boolean {
  try {
    parse(src);
    return true;
  } catch {
    return false;
  }
}

describe("Bug 513 — @nudo:throws 注解不得写出语法错误文件", () => {
  it("函数体首行是普通块注释：产物仍可解析（改前失败）", () => {
    const src = `export function f(x) {
  /* note */
  return x + 1;
}
`;
    const next = annotate(src);
    // 改前：裸 tag 被插进 `/* note *\/` 里 → 解析失败
    expect(parses(next)).toBe(true);
    expect(next).toContain("@nudo:throws TypeError");
    // tag 必须落在声明上方的 JSDoc 里（不在函数体内）
    const docIdx = next.indexOf("@nudo:throws TypeError");
    const declIdx = next.indexOf("export function f");
    expect(docIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeLessThan(declIdx);
  });

  it("声明行尾带普通块注释：产物仍可解析（改前失败）", () => {
    const src = `export function f(x) { /* note */
  return x + 1;
}
`;
    const next = annotate(src);
    expect(parses(next)).toBe(true);
    expect(next).toContain("@nudo:throws TypeError");
    expect(next.indexOf("@nudo:throws TypeError")).toBeLessThan(
      next.indexOf("export function f"),
    );
  });

  it("多行 JSDoc 后的普通块注释：tag 落在 JSDoc 内（不落进注释外）", () => {
    const src = `/**
 * helper
 */
export function f(x) {
  /* note */
  return x + 1;
}
`;
    const next = annotate(src);
    expect(parses(next)).toBe(true);
    const lines = next.split("\n");
    const tagLine = lines.findIndex((l) => l.includes("@nudo:throws TypeError"));
    const closeLine = lines.findIndex((l) => l.trim().endsWith("*/"));
    expect(tagLine).toBeGreaterThan(0);
    expect(tagLine).toBeLessThan(closeLine); // tag 在 JSDoc 收尾之前
  });

  it("负控制：已有 JSDoc 的函数仍把 tag 插进 JSDoc（既有行为不变）", () => {
    const src = `/**
 * helper
 */
export function f(n) {
  return n.type;
}
`;
    const next = annotate(src, "f");
    expect(parses(next)).toBe(true);
    expect(next).toContain(" * helper\n * @nudo:throws TypeError\n */");
  });

  it("负控制：单行 JSDoc 仍展开成块（既有行为不变）", () => {
    const src = `/** helper */
export function f(n) {
  return n.type;
}
`;
    const next = annotate(src, "f");
    expect(parses(next)).toBe(true);
    expect(next).toContain("/**\n * helper\n * @nudo:throws TypeError\n */");
  });

  it("负控制：已有 @nudo:throws 时不重复插（既有行为不变）", () => {
    const src = `/**
 * @nudo:throws TypeError
 */
export function f(n) {
  return n.type;
}
`;
    const next = annotate(src, "f");
    expect(next).toBe(src);
  });
});
