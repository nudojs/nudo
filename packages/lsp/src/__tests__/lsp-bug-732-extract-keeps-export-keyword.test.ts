/**
 * Bug 732 —— 「Extract to function 'extracted'」把原函数的 `export` 关键字**偷给新函数**
 * ⇒ 模块公开 API 静默变（导出集合 `['f']` → `['extracted']`，文件仍可解析 ⇒ IDE 不报错）。
 *
 * 根因（`packages/lsp/src/extract-function.ts`）：插入点用的是 **Babel 节点 `loc.start`**
 * （`export function` 里 `function` 关键字的列 = 7），**不是语句起始列**（`export` 的列 = 0）
 * ⇒ 新函数正好落在 `export` 与 `function` 之间 ⇒ `export` 被新函数认领。
 *
 * 修法：插入点取「最近祖先的**语句起点**」（`export function f` ⇒ ExportNamedDeclaration，
 * 起点 = `export` 的列）⇒ 新函数插在 `export` **之前**，`export` 仍属原函数。
 *
 * oracle（改前 → 改后）：
 *   改前 insertAt = {line:0, character:7} ⇒ newText = "export function extracted(a) {…}\nfunction f(a) {…}"
 *   改后 insertAt = {line:0, character:0} ⇒ newText = "function extracted(a) {…}\nexport function f(a) {…}"
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { extractFunction } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

const SRC = `export function f(a) {
  const t = a + 1;
  return t;
}
`;

/** 选区 = 第 2 行（0 基）的 `a + 1` */
const SEL = { start: { line: 1, character: 12 }, end: { line: 1, character: 17 } };

describe("Bug 732 · Extract 不偷走原函数的 export 关键字", () => {
  it("插入点是语句起点（export 的列），不是 function 关键字的列", () => {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 {line:0, character:7}（`export ` 之后）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
  });

  it("产物里 export 仍属原函数（模块公开 API 不变）", () => {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newText).toContain("export function f(a) {");
    expect(r.newText).not.toContain("export function extracted");
    // 新函数排在 export 之前
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export function f"),
    );
    // 产物仍可解析
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("协议面：codeAction 下发的整文件替换保留 export", async () => {
    await withLspServer({ "m.mjs": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText).toContain("export function f(a) {");
      expect(newText).not.toContain("export function extracted");
    });
  });
});
