/**
 * Bug 744 —— `refactor.inline` 对**导出绑定**产出**互相重叠的两条 TextEdit**
 * ⇒ 客户端应用后**源码被毁**（`node --check` ⇒ SyntaxError），且**两种应用顺序都毁**。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `inlineVariableAt` refs 循环）：
 * Babel 对**导出绑定**的 `binding.referencePaths` 里**多塞了「声明本身」**
 * （`ExportNamedDeclaration` / `ExportSpecifier`）⇒ inline 的 refs 循环**不区分
 * 节点类型** ⇒ 为声明本身再生成一条「整条声明 → 初值」的替换 edit，与删除 edit
 * **区间重叠**。
 *
 * 修法（两道）：
 * 1. **收集阶段拒绝导出绑定**（`isExportedBinding`）—— 内联会**删除声明** ⇒
 *    导出绑定被内联 = 模块公开 API 变化 ⇒ 本来就不该内联；
 * 2. refs 循环**跳过非「真正的引用」节点**（只接受 `Identifier` 且父节点不是
 *    `ExportSpecifier` / `ExportNamedDeclaration` / `ExportDefaultDeclaration`）；
 * 3. 生成 edits 后加一道**区间重叠自检**（相交即放弃该动作）⇒ 绝不产出非法
 *    WorkspaceEdit。
 *
 * oracle（动作面 / 语义面）：
 *   改前 `export const X = 42;` ⇒ 3 条 edit，其中 [0:0→0:20] ∩ [0:0→1:0] **重叠**
 *        ⇒ 应用后源码变成 `42) {` ⇒ `node --check` FAIL
 *   改后 result = null（**不提供该动作** ⇒ 不产出重叠 edit，源码不被毁）
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt } from "../refactor-b2.ts";
import { withLspServer } from "./helpers.ts";
import { anyOverlap, applyEdits, nodeCheck, runModule } from "./lsp-bug-r90b-harness.ts";

/** `export const X = 42;` —— 声明本身被 Babel 塞进 referencePaths */
const SRC_EXPORT_DECL = `export const X = 42;
export function use() {
  return X;
}
`;

/** `const X = 42; export { X };` —— 导出说明符在 referencePaths 里 */
const SRC_EXPORT_SPEC = `const X = 42;
export { X };
export function use() {
  return X;
}
`;

/** 对照：非导出绑定 */
const SRC_PLAIN = `const X = 42;
export function use() {
  return X;
}
`;

describe("Bug 744 · inline 不产出重叠 edit（导出绑定）", () => {
  it("`export const X = …` ⇒ 不提供 Inline 动作", () => {
    expect(inlineVariableAt(SRC_EXPORT_DECL, 1, 13)).toBeNull();
  });

  it("`export { X }` ⇒ 不提供 Inline 动作", () => {
    expect(inlineVariableAt(SRC_EXPORT_SPEC, 1, 7)).toBeNull();
  });

  it("协议面：导出绑定上 codeAction 不含 refactor.inline", async () => {
    await withLspServer({ "a.js": SRC_EXPORT_DECL }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 13 },
        },
        context: { diagnostics: [] },
      }) as Array<{ title: string; kind?: string }>;
      expect(actions.find((a) => a.kind === "refactor.inline")).toBeUndefined();
    });
  });

  it("对照：非导出绑定仍可内联，且 edit 集合互不重叠", () => {
    const r = inlineVariableAt(SRC_PLAIN, 1, 7);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("Inline variable 'X'");
    expect(anyOverlap(r.edits)).toBe(false);
    const patched = applyEdits(SRC_PLAIN, r.edits);
    expect(nodeCheck(patched)).toBe("OK");
    expect(runModule(patched, "M.use()")).toBe("42");
  });

  it("语义面：改前两条 edit 重叠 ⇒ 应用后源码被毁（钉住根因形态）", () => {
    // 改前的 edit 集合：声明本身被当成「一个使用点」⇒ 多一条与删除 edit 重叠的替换
    const before = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 20 },
        },
        newText: "42",
      },
      {
        range: {
          start: { line: 2, character: 9 },
          end: { line: 2, character: 10 },
        },
        newText: "42",
      },
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: "",
      },
    ];
    expect(anyOverlap(before)).toBe(true);
    const patched = applyEdits(SRC_EXPORT_DECL, before);
    expect(nodeCheck(patched)).not.toBe("OK");
  });
});
