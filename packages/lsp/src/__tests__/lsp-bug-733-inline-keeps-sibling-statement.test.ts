/**
 * Bug 733 —— `Inline variable 'x'` 把声明所在**整行**删掉 ⇒ 同行兄弟语句被静默删除。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `inlineVariableAt` 删除范围段）：
 * 删除范围被**无条件扩到整行**（`character: 0` → 该行长度）来覆盖「声明独占一行」的
 * 常态 ⇒ 声明与其它语句**同行**时（`const a = 1; doSomething(a);`）同行其余内容被
 * 一并删掉 ⇒ 副作用调用（`doSomething(a);`）**静默消失**（文件仍可解析，IDE 无提示）。
 *
 * 修法：删除范围取**声明语句自身**的区间（`const a = 1;`），只有当声明**独占一行**
 * 时才扩到整行（含换行）；同行兄弟语句保留，并被内联展开为 `doSomething(1);`。
 *
 * oracle（动作面 / 语义面）：
 *   改前 edit[2] = [5:0 → 6:0] ""   ⇒ 应用后 `doSomething(a);` 整句消失
 *                                  ⇒ 运行时 `calls` = 0（副作用被静默删掉）
 *   改后 edit[2] = [5:2 → 5:15] ""  ⇒ 应用后 `doSomething(1);` 保留
 *                                  ⇒ 运行时 `calls` = 1
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt } from "../refactor-b2.ts";
import { withLspServer } from "./helpers.ts";
import { anyOverlap, applyEdits, nodeCheck, runModule, type Edit } from "./lsp-bug-r90b-harness.ts";

const SRC = `export let calls = 0;
export function doSomething(x) {
  calls++;
}
export function f() {
  const a = 1; doSomething(a);
  return a + 2;
}
`;

/** 光标：第 6 行（1 基）的 `a`（0 基列 8） */
const LINE = 6;
const COLUMN = 8;

function inline(): { title: string; edits: Edit[] } | null {
  const r = inlineVariableAt(SRC, LINE, COLUMN);
  if (!r || !("edits" in r)) return null;
  return r;
}

describe("Bug 733 · inline 不删同行兄弟语句", () => {
  it("删除范围只覆盖声明语句本身（不扩到整行）", () => {
    const r = inline();
    expect(r).not.toBeNull();
    const edits = r!.edits;
    const del = edits.find((e) => e.newText === "");
    expect(del).toBeDefined();
    // 「const a = 1;」在 0 基第 5 行的 2..15
    expect(del!.range).toEqual({
      start: { line: 5, character: 2 },
      end: { line: 5, character: 15 },
    });
    // 不得覆盖整行（整行会把 `doSomething(a);` 一起删掉）
    expect(del!.range.start.character).not.toBe(0);
  });

  it("edit 集合互不重叠（LSP WorkspaceEdit 合法性）", () => {
    const r = inline();
    expect(anyOverlap(r!.edits)).toBe(false);
  });

  it("应用后：兄弟语句保留并被内联展开，副作用不再丢失", () => {
    const r = inline();
    const patched = applyEdits(SRC, r!.edits);
    expect(patched).toContain("doSomething(1);");
    expect(patched).not.toContain("const a = 1;");
    expect(nodeCheck(patched)).toBe("OK");
    // 改前：`calls` = 0（副作用被静默删掉）；改后：`calls` = 1
    expect(runModule(patched, "[M.f(), M.calls]")).toBe("[3,1]");
  });

  it("协议面：codeAction 提供的 Inline action 不含整行删除", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: LINE - 1, character: COLUMN },
          end: { line: LINE - 1, character: COLUMN },
        },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>> };
      }>;
      const inlineAction = actions.find((a) => a.kind === "refactor.inline");
      expect(inlineAction).toBeDefined();
      const edits = inlineAction!.edit!.changes[uri("a.js")]!;
      const del = edits.find((e) => e.newText === "");
      expect(del!.range.start.character).not.toBe(0);
      expect(anyOverlap(edits)).toBe(false);
    });
  });
});
