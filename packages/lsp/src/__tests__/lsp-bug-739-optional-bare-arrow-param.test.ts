/**
 * Bug 739 —— 「Change signature: make `'x'` optional」打在**无括号箭头形参**上
 * ⇒ 产出 `x = undefined => …`（被重新解析成**赋值**）⇒ 运行时 `ReferenceError`。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `makeParamOptionalAt`）：编辑文本
 * **无条件**把 `${name} = undefined` 插到形参位，**不检查该形参是否被括号包裹**
 * ⇒ `items.map(v => …)` 的 `v` 变成 `v = undefined => …`。
 *
 * 修法（`isBareArrowParam`）：先判该形参是否被括号包裹；**无括号箭头形参必须补括号**
 * ⇒ 产出 `(v = undefined) => …`（两种形态都合法，且语义是「可选形参」）。
 *
 * oracle（动作面 / 语义面）：
 *   改前 edit[0] = [1:24 → 1:25] "v = undefined" ⇒ 应用后 `items.map(v = undefined => v * 3)`
 *        ⇒ `node --check` 仍 OK，但运行即 `ReferenceError: v is not defined`
 *   改后 edit[0] = [1:24 → 1:25] "(v = undefined)" ⇒ 应用后 `items.map((v = undefined) => v * 3)`
 *        ⇒ 运行 `scale([1,2,3])` = [3,6,9]
 */
import { describe, it, expect } from "vitest";
import { makeParamOptionalAt } from "../refactor-b2.ts";
import { withLspServer } from "./helpers.ts";
import { applyEdits, nodeCheck, runModule } from "./lsp-bug-r90b-harness.ts";

const SRC = `export function scale(items) {
  const out = items.map(v => v * 3);
  return out;
}
`;

/** 光标：第 2 行（1 基）的 `v`（0 基列 24） */
const LINE = 2;
const COLUMN = 24;

describe("Bug 739 · make optional 必须补括号（无括号箭头形参）", () => {
  it("无括号箭头形参 ⇒ 新文本带括号", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toBe("Change signature: make 'v' optional");
    expect(r.edits[0]!.newText).toBe("(v = undefined)");
    expect(r.edits[0]!.range).toEqual({
      start: { line: 1, character: 24 },
      end: { line: 1, character: 25 },
    });
  });

  it("应用后：箭头形参合法，运行时结果不变", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    if (!r || !("edits" in r)) return;
    const patched = applyEdits(SRC, r.edits);
    expect(patched).toContain("items.map((v = undefined) => v * 3)");
    expect(patched).not.toContain("v = undefined =>");
    expect(nodeCheck(patched)).toBe("OK");
    expect(runModule(patched, "M.scale([1,2,3])")).toBe("[3,6,9]");
  });

  it("协议面：codeAction 给出的 rewrite 文本带括号", async () => {
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
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const rewrite = actions.find((a) => a.kind === "refactor.rewrite");
      expect(rewrite).toBeDefined();
      expect(rewrite!.edit!.changes[uri("a.js")]![0]!.newText).toBe("(v = undefined)");
    });
  });

  it("对照：已带括号的箭头形参保持原行为（不重复加括号）", () => {
    const paren = `export function scale(items) {
  const out = items.map((v) => v * 3);
  return out;
}
`;
    const r = makeParamOptionalAt(paren, 2, 25);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.edits[0]!.newText).toBe("v = undefined");
    const patched = applyEdits(paren, r.edits);
    expect(patched).toContain("items.map((v = undefined) => v * 3)");
    expect(runModule(patched, "M.scale([1,2,3])")).toBe("[3,6,9]");
  });
});
