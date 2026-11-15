/**
 * Bug 700：`@nudo:sample` 补全项的 detail / insertText 不实。
 *
 * 症状：detail 吹成「Control loop iteration sampling」，但该指令**只被解析、
 * 不被消费**（reserved / no-op）；insertText 是 `@nudo:sample `（缺 count）
 * ⇒ 接受补全即产生 `nudo:sample-count` 诊断。
 * 期望：detail 如实说明；insertText 带 count 占位 ⇒ 接受即干净。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";

// JSDoc 里的 ` * @nudo:` —— 光标在 `@nudo:` 之后
const SRC = "/**\n * @nudo:\n */\nexport const k = 1;\n";

describe("Bug 700 — @nudo:sample 补全项如实描述", () => {
  it("detail 说明是 reserved / no-op", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-700/a.js");
    const items = requestCompletion(mock, uri, 1, 9);
    const sample = items.find((i) => i.label === "@nudo:sample");
    expect(sample).toBeDefined();
    expect(sample!.detail).toMatch(/reserved/i);
    expect(sample!.detail).not.toMatch(/sampling/i);
  });

  it("insertText 带 count 占位（接受后不产生诊断）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-700/b.js");
    const items = requestCompletion(mock, uri, 1, 9);
    const sample = items.find((i) => i.label === "@nudo:sample");
    expect(sample!.insertText).toBe("@nudo:sample 1");
  });

  it("textEdit 区间 = [前缀起点, 光标]（接受后源码恰是 `@nudo:sample 1`）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-700/c.js");
    // 第 1 行是 ` * @nudo:` —— 光标在第 9 列（行尾）
    const items = requestCompletion(mock, uri, 1, 9);
    const sample = items.find((i) => i.label === "@nudo:sample")!;
    const edit = (sample as unknown as { textEdit: { range: any; newText: string } }).textEdit;
    expect(edit.newText).toBe("@nudo:sample 1");
    expect(edit.range.start).toEqual({ line: 1, character: 3 });
    expect(edit.range.end).toEqual({ line: 1, character: 9 });
  });
});
