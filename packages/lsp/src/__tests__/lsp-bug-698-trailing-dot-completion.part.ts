/**
 * Bug 698：尾随点号（编辑中间态）⇒ 补全整面清零。
 *
 * 症状：用户刚敲下 `obj.` 时 buffer 文本语法非法 ⇒ 原文分析直接抛
 * （parse 不容错）⇒ completion 返回 [] 并在 console 报错。
 * 期望：尾随点号与「已敲出部分成员名」表现一致（都给出 obj 的成员）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";

const SRC = "export const obj = { alpha: 1, beta: 2 };\nobj.\n";

describe("Bug 698 — 尾随点号补全不再清零", () => {
  it("尾随点号：给出 obj 的成员，且不报 console 错", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-698/a.js");
    const items = requestCompletion(mock, uri, 1, 4);
    expect(items.map((i) => i.label)).toEqual(["alpha", "beta"]);
    expect(mock.consoleErrors).toEqual([]);
  });

  it("已敲出部分成员名：行为不变（同样给出成员）", async () => {
    const src = "export const obj = { alpha: 1, beta: 2 };\nobj.al\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-698/b.js");
    const items = requestCompletion(mock, uri, 1, 6);
    expect(items.map((i) => i.label)).toEqual(["alpha", "beta"]);
  });

  it("尾随点号与部分成员名的结果一致（补全面不因编辑中间态塌掉）", async () => {
    const dot = await openLspDocument(SRC, "file:///tmp/nudo-698/c.js");
    const partial = await openLspDocument(
      "export const obj = { alpha: 1, beta: 2 };\nobj.al\n",
      "file:///tmp/nudo-698/d.js",
    );
    expect(requestCompletion(dot.mock, dot.uri, 1, 4)).toEqual(
      requestCompletion(partial.mock, partial.uri, 1, 6),
    );
  });
});
