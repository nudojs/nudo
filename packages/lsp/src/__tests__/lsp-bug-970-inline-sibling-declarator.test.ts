/**
 * Bug 970 —— LSP codeAction「Inline variable 'a'」取**整条 `VariableDeclaration`**
 * 作删除范围 ⇒ **同一声明的兄弟 declarator 被一起删掉** ⇒ 产物**语法合法但运行即
 * `ReferenceError`**（IDE/CI 的语法检查发现不了）。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `inlineVariableAt`）：删除范围取自
 * `path.parent`（**整条声明语句**）而不是**被内联的那个 declarator**
 * ⇒ 一条 `const a = 1, b = 2;` 里内联 `a` 时 `b` 的**声明**一起消失
 * ⇒ 兄弟变量变成自由标识符。
 *
 * 修法（`declarationEdit`）：**多 declarator 时改写整条声明** —— 去掉被内联的
 * 那个 declarator（含它的分隔逗号）、**保留兄弟**；逗号手术按 **declarator 节点
 * 区间**（`a = 1` / `b = 2`，不是标识符区间）做 ⇒ 既不留 `const , b = 2;` 的语法错，
 * 也不把兄弟的声明删掉。
 *
 * oracle（动作面 / 语义面）：
 *   改前 edit[1] = [1:0 → 3:0] ""（跨两行 ⇒ 取自 `path.parent`）
 *        ⇒ 应用后 `return 1 + b;` ⇒ `node --check` **OK** 但运行即
 *           `ReferenceError: b is not defined`
 *   改后 edit[1] = [1:2 → 2:10] "const b = 2;"
 *        ⇒ 应用后 `const b = 2;` 保留 ⇒ 运行 `f()` = 3
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt } from "../refactor-b2.ts";
import { withLspServer } from "./helpers.ts";
import { anyOverlap, applyEdits, nodeCheck, runModule } from "./lsp-bug-r90b-harness.ts";

/** 跨行声明 */
const SRC_MULTILINE = `export function f() {
  const a = 1,
    b = 2;
  return a + b;
}
`;

/** 同行声明 */
const SRC_SAMELINE = `export function f() {
  const a = 1, b = 2;
  return a + b;
}
`;

describe("Bug 970 · inline 保留兄弟 declarator", () => {
  it("跨行声明：改写整条声明，保留兄弟", () => {
    const r = inlineVariableAt(SRC_MULTILINE, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    const declEdit = r.edits.find((e) => e.newText !== "1")!;
    expect(declEdit.newText).toBe("const b = 2;");
    expect(declEdit.range).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 2, character: 10 },
    });
  });

  it("同行声明：改写整条声明，保留兄弟", () => {
    const r = inlineVariableAt(SRC_SAMELINE, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    const declEdit = r.edits.find((e) => e.newText !== "1")!;
    expect(declEdit.newText).toBe("const b = 2;");
  });

  it("应用后：兄弟声明仍在，语法合法，运行时不再 ReferenceError", () => {
    for (const src of [SRC_MULTILINE, SRC_SAMELINE]) {
      const r = inlineVariableAt(src, 2, 8);
      expect(r && "edits" in r).toBe(true);
      if (!r || !("edits" in r)) return;
      expect(anyOverlap(r.edits)).toBe(false);
      const patched = applyEdits(src, r.edits);
      expect(patched).toContain("const b = 2;");
      expect(patched).not.toContain("const , ");
      expect(patched).not.toContain("const a = 1,");
      expect(nodeCheck(patched)).toBe("OK");
      expect(runModule(patched, "M.f()")).toBe("3");
    }
  });

  it("协议面：codeAction 的 inline edit 不删掉兄弟声明", async () => {
    await withLspServer({ "a.js": SRC_MULTILINE }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 8 },
        },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: {
          changes: Record<
            string,
            Array<{
              range: { start: { line: number; character: number }; end: { line: number; character: number } };
              newText: string;
            }>
          >;
        };
      }>;
      const inlineAction = actions.find((a) => a.kind === "refactor.inline");
      expect(inlineAction).toBeDefined();
      const edits = inlineAction!.edit!.changes[uri("a.js")]!;
      const declEdit = edits.find((e) => e.newText !== "1")!;
      expect(declEdit.newText).toBe("const b = 2;");
      expect(anyOverlap(edits)).toBe(false);
    });
  });

  it("语义面：改前删掉整条声明 ⇒ 语法合法但运行即 ReferenceError（钉住根因形态）", () => {
    const patched = `export function f() {
  return 1 + b;
}
`;
    expect(nodeCheck(patched)).toBe("OK");
    expect(runModule(patched, "M.f()")).toBe("Error: b is not defined");
  });
});
