/**
 * Bug 736 —— `refactor.extract` 把新函数**插到非语句位置**（箭头初始化式 / 对象字面量
 * 方法 / class 方法）⇒ 产物**根本不可解析**（3 宿主全中）。
 *
 * 根因（`packages/lsp/src/extract-function.ts`）：插入点的选取**只考虑了「宿主是函数
 * 声明」这一种情形**（`containingFnBox.fn.loc.start`）⇒ 对 `VariableDeclarator.init`
 * 是箭头 / `ObjectProperty.value` 是方法 / `ClassMethod`，节点起点落在**表达式内部**
 * ⇒ 插一条 `function … {}` 声明就打断了宿主表达式。
 *
 * 修法：插入点取「最近祖先的**语句位置**」（Program / BlockStatement / SwitchCase /
 * StaticBlock 的直接子节点）⇒ 箭头初始化式 ⇒ 整条 `export const f = …` 声明之前；
 * 对象字面量方法 / class 方法 ⇒ 所在声明之前。
 *
 * oracle（改前 → 改后，三宿主）：
 *   改前 insertAt = {0,17} / {1,2} / {1,2}
 *        ⇒ Babel: Missing semicolon. (4:3) / Unexpected keyword 'function'. (2:2)
 *           / Unexpected token (2:11)
 *   改后 insertAt = {0,0}（三者都落在宿主声明之前）⇒ 产物可解析。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { extractFunction } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

const ARROW_SRC = `export const f = (y) => {
  return y + 1;
};
`;
const OBJECT_SRC = `export const o = {
  m() {
    return this.v * 2;
  },
};
`;
const CLASS_SRC = `export class A {
  m() {
    return secret + 1;
  }
}
`;

describe("Bug 736 · Extract 的新函数只能插在语句位置", () => {
  it("箭头初始化式：插在整条声明之前，产物可解析", () => {
    const r = extractFunction(ARROW_SRC, {
      start: { line: 1, character: 9 },
      end: { line: 1, character: 14 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 {line:0, character:17}（`=` 之后的箭头起点）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export const f"),
    );
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("对象字面量方法：插在宿主声明之前，产物可解析", () => {
    const r = extractFunction(OBJECT_SRC, {
      start: { line: 2, character: 11 },
      end: { line: 2, character: 21 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 {line:1, character:2}（对象字面量的 `{` 之后）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export const o"),
    );
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("class 方法：插在宿主声明之前，产物可解析", () => {
    const r = extractFunction(CLASS_SRC, {
      start: { line: 2, character: 11 },
      end: { line: 2, character: 21 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 {line:1, character:2}（class body 里）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export class A"),
    );
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("协议面：codeAction 给箭头宿主下发的文本可解析", async () => {
    await withLspServer({ "m.mjs": ARROW_SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: { start: { line: 1, character: 9 }, end: { line: 1, character: 14 } },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText.indexOf("function extracted")).toBeLessThan(
        newText.indexOf("export const f"),
      );
      expect(() => parse(newText)).not.toThrow();
    });
  });
});
